/**
 * منطقِ بات: پنلِ شیشه‌ای، هشدار با دکمه‌ی تأیید/رد، و انتشار در کانال.
 *
 * پنل *یک* پیام است که با هر دکمه ویرایش می‌شود (panel.js صفحه‌ها را
 * می‌سازد). عکس‌ها — هشدار و «تحلیل روی چارت» — پیامِ جدا هستند چون پیامِ
 * متنی را نمی‌شود به عکس ویرایش کرد، و چون ادمین باید بتواند آن‌ها را نگه دارد.
 *
 * جریانِ هشدار:
 *   اسکن ← امتیاز ≥ آستانه، بدونِ شرطِ الزامیِ ناموفق، خارج از cooldown
 *   ← عکس + شواهد برای هر ادمین ← «انتشار» ← پستِ تحلیل + پیامِ سیگنال
 *   در کانال ← کپشنِ هشدار نزدِ همه‌ی ادمین‌ها به‌روز و دکمه‌ها برداشته.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SCAN_INTERVALS, TIMEFRAMES, parseSymbol, saveSettings, setParam, resetParams } from '../config.js';
import { scanOne, setupKey } from '../scanner.js';
import { fetchFrom } from '../exchanges/index.js';
import { TRACK_TF, MAX_5M, catchUp, needsCatchUp, newSignal, step } from '../tracker.js';
import { applyEdits, validatePlan, hasEdits, checkLivePrice } from '../planEdit.js';
import { renderChart } from '../chart/render.js';
import { store, dataDir } from '../store.js';
import { PARAMS, CONDITIONS, paramById, getPath, coerce, formatValue } from '../strategy/params.js';
import * as M from '../messages.js';
import * as UI from './panel.js';
import { utc } from '../format.js';
import { normalizeChannel, checkChannel } from '../channel.js';
import { webAppUrl } from '../web/server.js';

const CAPTION_MAX = 1024;

const STATUS_FA = {
  published: 'قبلاً منتشر شده.',
  rejected: 'قبلاً رد شده.',
  publishing: 'در حالِ انتشار است — ادمینِ دیگری همین الان زد.',
};

export function createBot({ api, env, cfg, log = console }) {
  // مالک‌ها از ADMIN_IDS ِ ریل‌وی می‌آیند و از پنل حذف‌شدنی نیستند — وگرنه یک
  // دکمه‌ی اشتباه همه را از بات بیرون می‌کرد. ادمین‌های پنل در settings.json‌اند.
  const owners = new Set(env.adminIds.map(String));
  cfg.admins ??= [];
  const adminIds = () => [...new Set([...owners, ...cfg.admins.map((a) => String(a.id))])];
  const isAdmin = (id) => adminIds().includes(String(id));
  const isOwner = (id) => owners.has(String(id));

  // کانال: اگر از پنل (با فوروارد) تعیین شده همان، وگرنه CHANNEL_ID ِ ریل‌وی، تمیزشده
  const envChannel = normalizeChannel(env.channelId);
  const channelId = () => cfg.channel?.id || envChannel.id;
  let botId = null;
  let channelStatus = null; // آخرین نتیجه‌ی checkChannel

  async function refreshChannel() {
    channelStatus = botId
      ? await checkChannel(api, channelId(), botId)
      : { ok: !!channelId(), error: channelId() ? null : 'کانال تنظیم نشده' };
    if (!channelId() && envChannel.error && env.channelId) channelStatus.error = `CHANNEL_ID: ${envChannel.error}`;
    return channelStatus;
  }
  let scanning = false;
  let timer = null;
  let nextScanAt = null;
  /** آخرین تحلیلِ هر نماد، با کندل‌ها — برای صفحه‌ی نماد و چارت */
  const rows = new Map();
  /** چتی که منتظرِ متن است: { kind: 'add' | 'param', id, panel: { chat, id } } */
  const waiting = new Map();

  const state = () => ({
    cfg,
    rows: cfg.watchlist.map((w) => rows.get(w.base)).filter(Boolean)
      // نمادی که فقط برای دیدن تحلیل شده (در واچ‌لیست نیست) هم در نتایج بماند
      .concat([...rows.values()].filter((r) => r.item.adhoc && !cfg.watchlist.some((w) => w.base === r.item.base))),
    lastScan: store.get().lastScan,
    nextScanAt,
    alerts: store.get().alerts,
    pending: Object.values(store.get().alerts).filter((a) => a.status === 'pending').length,
    owners: [...owners],
    admins: cfg.admins,
    names: store.get().names || {},
    signals: store.signals(),
    channel: { id: channelId(), status: channelStatus, fromPanel: !!cfg.channel?.id },
    webApp: webAppUrl(),
  });

  // ───────────────────────────── زمان‌بندی
  // اسکن روی مرزِ ساعت/۴ساعت/روزِ UTC — درست بعد از بسته شدنِ کندل —
  // به‌اضافه‌ی یک دقیقه تا صرافی کندلِ بسته را تحویل بدهد.
  function schedule() {
    clearTimeout(timer);
    const period = SCAN_INTERVALS[cfg.scanEvery] * 3_600_000;
    nextScanAt = Math.ceil((Date.now() - 60_000) / period) * period + 60_000;
    if (nextScanAt <= Date.now()) nextScanAt += period;
    timer = setTimeout(async () => {
      await runScan().catch((e) => log.error('[scan]', e));
      schedule();
    }, nextScanAt - Date.now());
    // حلقه‌ی polling پروسه را زنده نگه می‌دارد؛ تایمر نباید (در تست‌ها پروسه را قفل می‌کرد)
    timer.unref?.();
  }

  async function analyzeItem(item) {
    try {
      const r = await scanOne(item, cfg);
      rows.set(item.base, r);
      return r;
    } catch (e) {
      const r = { item, error: e.message, tried: e.tried || [] };
      rows.set(item.base, r);
      return r;
    }
  }

  /** @param onProgress (done, total, currentId) */
  async function runScan({ onProgress } = {}) {
    if (scanning) return null;
    scanning = true;
    try {
      const out = [];
      // پشت‌سرِ هم، نه موازی: درخواستِ هم‌زمان به صرافی برای یک باتِ ساعتی
      // هیچ سودی ندارد و فقط ریسکِ rate-limit می‌آورد.
      for (const [i, item] of cfg.watchlist.entries()) {
        await onProgress?.(i, cfg.watchlist.length, item.id);
        out.push(await analyzeItem(item));
      }
      let alerts = 0;
      for (const r of out) {
        if (!r.result || !r.result.alertable || r.result.score < cfg.alertThreshold) continue;
        const key = setupKey(r);
        if (store.onCooldown(key, cfg.cooldownHours)) continue;
        await sendAlert(r);
        store.markSent(key);
        alerts++;
      }
      // پیش‌هشدار: قیمت دارد به خط می‌رسد — فقط برای ادمین، بی‌دکمه‌ی انتشار
      if (cfg.nearAlerts) {
        for (const r of out) {
          const res = r.result;
          if (!res || res.line.state !== 'approach' || res.blocked.length) continue;
          const key = `near:${setupKey(r)}`;
          if (store.onCooldown(key, cfg.cooldownHours)) continue;
          for (const chat of adminIds()) {
            await api.sendMessage(chat, M.nearAlert(r), {
              buttons: [[{ text: '🖼 دیدنِ چارت', callback_data: `act:chart:${r.item.base}` }]],
            }).catch((e) => log.warn('[near]', e.message));
          }
          store.markSent(key);
        }
      }

      const s = store.get();
      s.lastScan = {
        at: Date.now(), alerts,
        rows: out.map((r) => ({ id: r.item.id, score: r.result?.score ?? null, error: r.error || null, exchange: r.data?.exchange })),
      };
      store.save();
      log.info(`[scan] ${out.length} نماد، ${alerts} هشدار`);
      return out;
    } finally {
      scanning = false;
    }
  }

  // ───────────────────────────── عکس و هشدار
  function chartFor(r) {
    return renderChart({
      candles: r.data.candles, result: r.result, minBars: cfg.chart.minBars,
      meta: { pretty: r.data.pretty, exchange: r.data.exchange, timeframe: cfg.timeframe, watermark: cfg.chart.watermark },
    });
  }

  /** هشدار با دکمه‌ی انتشار — فقط وقتی پلنِ معامله وجود دارد */
  async function sendAlert(r, { to = adminIds() } = {}) {
    const id = randomBytes(5).toString('hex');
    const png = chartFor(r);
    const dir = join(dataDir(), 'charts');
    mkdirSync(dir, { recursive: true });
    const chartPath = join(dir, `${id}.png`);
    writeFileSync(chartPath, png);

    store.saveSnapshot(id, r);
    const caption = M.adminAlert(r, cfg);
    const buttons = alertButtons(id);
    const messages = [];
    for (const chat of to) {
      try {
        messages.push(await sendPhotoWithText(chat, png, caption, buttons));
      } catch (e) {
        log.error(`[alert] به ${chat} نرسید:`, e.message);
      }
    }
    store.putAlert({
      id, key: setupKey(r), status: 'pending', createdAt: Date.now(),
      symbol: r.item.id, pretty: r.data.pretty, score: r.result.score,
      chartPath, caption,
      analysis: M.channelAnalysis(r, cfg),
      signal: r.result.plan ? M.channelSignal(r, cfg) : null,
      messages,
    });
    return id;
  }

  function alertButtons(id) {
    return [
      [{ text: '✅ انتشار در کانال', callback_data: `ok:${id}` }, { text: '❌ رد', callback_data: `no:${id}` }],
      [{ text: '✏️ ویرایش پیش از انتشار', callback_data: `ed:${id}:open` }],
    ];
  }

  /** «تحلیل روی چارت» از پنل — با پلن ← هشدارِ کامل با دکمه‌ی انتشار؛ بی‌پلن ← فقط عکس و توضیح */
  async function sendChart(chat, r) {
    if (r.error) return api.sendMessage(chat, M.coinReport(r, cfg));
    if (r.result?.plan) return sendAlert(r, { to: [chat] });
    const png = renderChart({
      candles: r.data.candles, result: r.result, minBars: cfg.chart.minBars,
      meta: { pretty: r.data.pretty, exchange: r.data.exchange, timeframe: cfg.timeframe, watermark: '' },
    });
    return sendPhotoWithText(chat, png, M.coinReport(r, cfg), [[{ text: '🗑 بستن', callback_data: 'act:close' }]]);
  }

  /** کپشنِ بلند جا نمی‌شود ← عکس با عنوان، و متن + دکمه‌ها در پیامِ بعدی. */
  async function sendPhotoWithText(chat, png, text, buttons) {
    if (visibleLength(text) <= CAPTION_MAX) {
      const m = await api.sendPhoto(chat, png, text, { buttons });
      return { chat, id: m.message_id, kind: 'caption' };
    }
    await api.sendPhoto(chat, png, text.split('\n')[0]);
    const m = await api.sendMessage(chat, text, { buttons });
    return { chat, id: m.message_id, kind: 'text' };
  }

  async function decide(cb, approve, alertId) {
    const a = store.alert(alertId);
    if (!a) return api.answer(cb.id, 'این هشدار پیدا نشد (شاید سرور ری‌استارت شده).', true);
    if (a.status !== 'pending') return api.answer(cb.id, STATUS_FA[a.status] || 'این هشدار دیگر باز نیست.', true);

    const who = cb.from.username ? `@${cb.from.username}` : cb.from.first_name;
    if (!approve) {
      store.updateAlert(alertId, { status: 'rejected', by: who });
      await api.answer(cb.id, 'رد شد');
      return closeAlert(a, `❌ رد شد توسطِ ${who}`);
    }

    const ageH = (Date.now() - a.createdAt) / 3_600_000;
    if (ageH > cfg.alertTtlHours) {
      return api.answer(cb.id, `این هشدار ${ageH.toFixed(1)} ساعت پیش آمده و قیمت جابه‌جا شده. از پنل «تحلیلِ دوباره» بزن.`, true);
    }
    if (!channelId()) return api.answer(cb.id, 'کانال تنظیم نشده. پنل ← ⚙️ تنظیمات ← 📢 کانال.', true);

    // پلنِ نهایی پیش از قفل سنجیده می‌شود: ویرایشِ نامعتبر نباید هشدار را قفل کند
    const final = finalRow(a);
    if (final.error) return api.answer(cb.id, final.error, true);

    // قیمتِ همین لحظه، از همان صرافی: پلن با قیمتِ لحظه‌ی اسکن ساخته شده
    const row0 = final.row;
    if (row0?.result.plan && row0.data.exchangeKey) {
      let live;
      try {
        live = (await fetchFrom(row0.data.exchangeKey, row0.data.symbol, TRACK_TF, 3)).at(-1)?.c;
      } catch (e) {
        log.warn('[publish] قیمتِ فعلی:', e.message);
      }
      if (!Number.isFinite(live)) return api.answer(cb.id, 'قیمتِ فعلی از صرافی نیامد. چند دقیقه بعد دوباره بزن.', true);
      const err = checkLivePrice(row0.result.plan, row0.result.direction, live, row0.result.atr, cfg.publishMaxDriftAtr ?? 0.5);
      if (err) return api.answer(cb.id, err, true);
      // در فاصله‌ی گرفتنِ قیمت شاید ادمینِ دیگری زده باشد
      if (store.alert(alertId).status !== 'pending') return api.answer(cb.id, STATUS_FA[store.alert(alertId).status], true);
    }

    // قفل پیش از تماسِ شبکه: دو ادمین که هم‌زمان بزنند نباید دو پست بسازند
    store.updateAlert(alertId, { status: 'publishing', publishingAt: Date.now() });
    await api.answer(cb.id, 'در حالِ انتشار…');
    try {
      const { row, png } = final;
      const analysis = row ? M.channelAnalysis(row, cfg, { note: a.edits?.note }) : a.analysis;
      const signal = row ? (row.result.plan ? M.channelSignal(row, cfg) : null) : a.signal;
      const post = await sendPhotoWithText(channelId(), png, analysis);
      let sigMsg = null;
      if (signal) sigMsg = await api.sendMessage(channelId(), signal, { replyTo: post.id });
      const now = Date.now();
      store.updateAlert(alertId, { status: 'published', by: who, publishedAt: now });
      // پیگیری: از همین لحظه، با همان صرافی و همان نماد
      if (row?.result.plan && sigMsg && row.data.exchangeKey) {
        store.putSignal(newSignal({
          id: alertId, item: row.item, data: row.data, direction: row.result.direction,
          plan: row.result.plan, publishedAt: now, channelMsgId: sigMsg.message_id, maxHoldHours: cfg.maxHoldHours,
        }));
      }
      const edited = hasEdits(a.edits) ? ' (با ویرایش)' : '';
      await closeAlert(a, `✅ منتشر شد${edited} توسطِ ${who} · ${utc(now)} UTC`);
      return true;
    } catch (e) {
      store.updateAlert(alertId, { status: 'pending' });
      log.error('[publish]', e.message);
      const st = await refreshChannel();
      await api.sendMessage(cb.from.id, [
        `❌ انتشار در کانال ناموفق بود: ${M.esc(e.description || e.message)}`,
        st.ok ? '' : `علت: ${M.esc(st.error)}`,
        '',
        'درست کردنش: پنل ← ⚙️ تنظیمات ← 📢 کانال ← یک پست از کانال را فوروارد کن. هشدار سرِ جایش می‌ماند؛ بعد دوباره «انتشار» را بزن.',
      ].filter((x, i) => x || i > 1).join('\n'), { buttons: [[{ text: '📢 تنظیمِ کانال', callback_data: 'nav:chan' }]] });
    }
  }

  /**
   * سطرِ نهایی برای انتشار: تحلیلِ لحظه‌ی هشدار + ویرایش‌های ادمین.
   * چارت فقط وقتی دوباره کشیده می‌شود که سطحی عوض شده باشد.
   */
  function finalRow(a) {
    const snap = store.snapshot(a.id);
    if (!snap) {
      // فایلِ snapshot نیست (هشدارِ نسخه‌ی قبلی) — همان متن و عکسِ ذخیره‌شده
      try {
        return { row: null, png: readFileSync(a.chartPath) };
      } catch {
        return { error: 'فایل‌های این هشدار دیگر موجود نیست. از پنل «تحلیلِ دوباره» بزن.' };
      }
    }
    if (!snap.result.plan) return { row: snap, png: chartFor(snap) };
    const e = a.edits || {};
    const plan = applyEdits(snap.result.plan, snap.result.direction, e);
    const err = validatePlan(plan, snap.result.direction);
    if (err) return { error: `پلنِ ویرایش‌شده نامعتبر است: ${err}` };
    const row = { ...snap, result: { ...snap.result, plan } };
    const levelsEdited = e.entry != null || e.sl != null || (e.tps && Object.keys(e.tps).length);
    let png;
    try {
      png = levelsEdited ? chartFor(row) : readFileSync(a.chartPath);
    } catch {
      png = chartFor(row);
    }
    return { row, png };
  }

  // ───────────────────────────── ویرایشگرِ سیگنال
  const FIELD_PROMPT = {
    e: 'قیمتِ ورودِ تازه را بفرست.',
    s: 'حد ضررِ تازه را بفرست.',
    n: 'یادداشتِ تحلیل را بفرست — زیرِ تحلیل در کانال می‌آید. برای حذف، «حذف» بفرست.',
  };
  const promptFor = (f) => FIELD_PROMPT[f] || `قیمتِ تارگتِ ${Number(f.slice(1)) + 1} را بفرست، یا «حذف» تا این تارگت برداشته شود.`;

  function editorView(a, snap, extra = {}) {
    const dir = snap.result.direction;
    return UI.editor({ alert: a, base: snap.result.plan, plan: applyEdits(snap.result.plan, dir, a.edits), direction: dir, ...extra });
  }

  async function onEditor(cb, alertId, f) {
    const chat = cb.message?.chat.id;
    const msgId = cb.message?.message_id;
    const a = store.alert(alertId);
    if (!a || a.status !== 'pending') return api.answer(cb.id, 'این هشدار دیگر در انتظار نیست.', true);
    const snap = store.snapshot(alertId);
    if (!snap?.result?.plan) return api.answer(cb.id, 'داده‌ی این هشدار دیگر موجود نیست. از پنل «تحلیلِ دوباره» بزن.', true);
    const editors = a.editors || {};
    const isEditorMsg = editors[chat] === msgId;

    if (f === 'open') {
      waiting.delete(String(chat));
      await api.answer(cb.id);
      const id = await show(chat, isEditorMsg ? msgId : editors[chat] || null, editorView(a, snap));
      store.updateAlert(alertId, { editors: { ...editors, [chat]: id } });
      return null;
    }
    if (f === 'e' || f === 's' || f === 'n' || /^t\d$/.test(f)) {
      waiting.set(String(chat), { kind: 'edit', alertId, field: f, panel: msgId });
      await api.answer(cb.id);
      return show(chat, msgId, editorView(a, snap, { prompt: promptFor(f) }));
    }
    if (f === 'rv') {
      store.updateAlert(alertId, { edits: {} });
      await api.answer(cb.id, 'به پلنِ بات برگشت');
      return show(chat, msgId, editorView(store.alert(alertId), snap));
    }
    if (f === 'pv') {
      const final = finalRow(a);
      if (final.error) return api.answer(cb.id, final.error, true);
      await api.answer(cb.id, 'پیش‌نمایش پایین می‌آید');
      const head = '👁 <b>پیش‌نمایش</b> — این‌ها هنوز در کانال نیستند.\n\n';
      await sendPhotoWithText(chat, final.png, head + M.channelAnalysis(final.row, cfg, { note: a.edits?.note }));
      return api.sendMessage(chat, head + M.channelSignal(final.row, cfg));
    }
    if (f === 'pub') {
      const ok = await decide(cb, true, alertId);
      if (ok === true) {
        await api.editText(chat, msgId, `✅ <b>${M.esc(a.pretty)}</b> با تغییرات منتشر شد.`, []).catch(() => {});
      }
      return null;
    }
    if (f === 'x') {
      waiting.delete(String(chat));
      await api.answer(cb.id);
      return api.deleteMessage(chat, msgId).catch(() => {});
    }
    return api.answer(cb.id);
  }

  async function onEditInput(msg, w) {
    const chat = msg.chat.id;
    api.deleteMessage(chat, msg.message_id).catch(() => {});
    const a = store.alert(w.alertId);
    const snap = store.snapshot(w.alertId);
    if (!a || a.status !== 'pending' || !snap?.result?.plan) {
      waiting.delete(String(chat));
      return show(chat, w.panel, { text: 'این هشدار دیگر در انتظار نیست.', buttons: [] });
    }
    const raw = (msg.text || '').trim();
    const edits = structuredClone(a.edits || {});
    const f = w.field;
    if (f === 'n') {
      if (/^(حذف|-|delete)$/i.test(raw)) delete edits.note;
      else edits.note = raw.slice(0, 400);
    } else {
      const remove = /^(حذف|delete|0)$/i.test(raw);
      const num = Number(raw.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[,٬\s]/g, '').replace('٫', '.'));
      if (f[0] === 't' && remove) {
        edits.tps = { ...edits.tps, [f.slice(1)]: null };
      } else if (!(num > 0)) {
        return show(chat, w.panel, editorView(a, snap, { prompt: promptFor(f), error: 'یک عددِ مثبت بفرست، مثلاً 79650.5' }));
      } else if (f === 'e') edits.entry = num;
      else if (f === 's') edits.sl = num;
      else edits.tps = { ...edits.tps, [f.slice(1)]: num };
    }
    const plan = applyEdits(snap.result.plan, snap.result.direction, edits);
    const err = validatePlan(plan, snap.result.direction);
    if (err) return show(chat, w.panel, editorView(a, snap, { prompt: promptFor(f), error: err }));
    waiting.delete(String(chat));
    store.updateAlert(w.alertId, { edits });
    return show(chat, w.panel, editorView(store.alert(w.alertId), snap));
  }

  // ───────────────────────────── پیگیریِ سیگنال‌ها
  let tracking = false;
  let trackTimer = null;

  async function runTracker(now = Date.now()) {
    if (tracking) return;
    tracking = true;
    try {
      for (const sig of store.signals().filter((x) => x.status === 'open')) {
        let candles;
        try {
          if (needsCatchUp(sig, now)) {
            const hours = Math.min(1000, Math.ceil((now - sig.lastT) / 3_600_000) + 2);
            const hourly = await fetchFrom(sig.exchangeKey, sig.exSymbol, '1h', hours);
            const recent = await fetchFrom(sig.exchangeKey, sig.exSymbol, TRACK_TF, MAX_5M);
            candles = catchUp(hourly, recent, sig.lastT);
          } else {
            const need = Math.ceil((now - sig.lastT) / 300_000) + 2;
            candles = await fetchFrom(sig.exchangeKey, sig.exSymbol, TRACK_TF, need);
          }
        } catch (e) {
          log.warn(`[track] ${sig.pretty}: ${e.message}`);
          continue;
        }
        const events = step(sig, candles, now);
        store.putSignal(sig);
        for (const e of events) {
          const text = M.trackEventText(sig, e);
          if (channelId()) {
            await api.sendMessage(channelId(), text, { replyTo: sig.channelMsgId })
              .catch((err) => log.error('[track] کانال:', err.message));
          }
          for (const chat of adminIds()) {
            api.sendMessage(chat, `📈 <b>${M.esc(sig.pretty)}</b>\n${text}`).catch(() => {});
          }
        }
      }
    } finally {
      tracking = false;
    }
  }

  async function closeAlert(a, footer) {
    for (const m of a.messages || []) {
      const text = `${a.caption}\n\n<b>${M.esc(footer)}</b>`;
      try {
        if (m.kind === 'caption' && visibleLength(text) <= CAPTION_MAX) await api.editCaption(m.chat, m.id, text);
        else if (m.kind === 'caption') await api.editCaption(m.chat, m.id, a.caption.split('\n')[0] + `\n\n<b>${M.esc(footer)}</b>`);
        else await api.editText(m.chat, m.id, text);
      } catch (e) {
        log.warn('[alert] ویرایش نشد:', e.message);
      }
    }
  }

  // ───────────────────────────── پنل
  async function show(chat, msgId, screen) {
    if (msgId) {
      try {
        await api.editText(chat, msgId, screen.text, screen.buttons);
        return msgId;
      } catch (e) {
        // دکمه‌ی صفحه‌ی فعلی دوباره زده شده — چیزی برای عوض کردن نیست
        if (/not modified/.test(e.message)) return msgId;
        // پیامِ پنل پاک شده یا خیلی قدیمی است ← پنلِ تازه
      }
    }
    const m = await api.sendMessage(chat, screen.text, { buttons: screen.buttons });
    return m.message_id;
  }

  async function scanFromPanel(chat, msgId) {
    if (scanning) return show(chat, msgId, { text: '⏳ یک اسکن همین الان در جریان است. چند لحظه‌ی دیگر «نتایج» را بزن.', buttons: [[{ text: '📊 نتایج', callback_data: 'nav:res' }]] });
    let lastEdit = 0;
    await runScan({
      onProgress: async (done, total, id) => {
        if (Date.now() - lastEdit < 1200) return; // سقفِ ویرایشِ تلگرام
        lastEdit = Date.now();
        await show(chat, msgId, UI.scanning(done, total, id)).catch(() => {});
      },
    });
    return show(chat, msgId, UI.results(state()));
  }

  async function navigate(chat, msgId, route, arg) {
    const s = state();
    switch (route) {
      case 'home': return show(chat, msgId, UI.home(s));
      case 'res': return show(chat, msgId, UI.results(s));
      case 'wl': waiting.delete(String(chat)); return show(chat, msgId, UI.watchlist(s));
      case 'st': return show(chat, msgId, UI.strategy(s));
      case 'set': return show(chat, msgId, UI.settings(s));
      case 'pend': return show(chat, msgId, UI.pendingList(s));
      case 'cond': return show(chat, msgId, UI.condition(s, arg));
      case 'grp': return show(chat, msgId, UI.group(s, arg));
      case 'par': waiting.delete(String(chat)); return show(chat, msgId, UI.param(s, arg));
      case 'adm': return show(chat, msgId, UI.admins(s, isOwner(chat)));
      case 'perf': return show(chat, msgId, UI.performance(s));
      case 'chan':
        await show(chat, msgId, { text: '⏳ در حالِ بررسیِ کانال…', buttons: [] });
        await refreshChannel();
        return show(chat, msgId, UI.channel(state(), isOwner(chat)));
      case 'chanset':
        if (!isOwner(chat)) return show(chat, msgId, UI.channel(s, false));
        waiting.set(String(chat), { kind: 'channel', panel: msgId });
        return show(chat, msgId, UI.channelPrompt());
      case 'admadd':
        if (!isOwner(chat)) return show(chat, msgId, UI.admins(s, false));
        waiting.set(String(chat), { kind: 'admin', panel: msgId });
        return show(chat, msgId, UI.adminPrompt());
      case 'add':
        waiting.set(String(chat), { kind: 'add', panel: msgId });
        return show(chat, msgId, UI.addPrompt());
      case 'coin': {
        if (!rows.has(arg)) {
          await show(chat, msgId, { text: `⏳ در حالِ تحلیلِ ${M.esc(arg)}…`, buttons: [] });
          const item = cfg.watchlist.find((w) => w.base === arg) || { ...parseSymbol(arg), adhoc: true };
          await analyzeItem(item);
        }
        return show(chat, msgId, UI.coin(state(), arg));
      }
      default: return show(chat, msgId, UI.home(s));
    }
  }

  /** تغییرِ یک پارامتر و برگشت به صفحه‌اش */
  function changeParam(p, value) {
    setParam(cfg, p.path, value);
    // وزنِ صفر یعنی خاموش — با دکمه‌ی خاموش کار کن، نه با وزن
    if (p.path.endsWith('.weight') && value <= 0) setParam(cfg, p.path, 5);
  }

  async function action(cb, chat, msgId, parts) {
    const [act, a1, a2] = parts;
    const s = () => state();
    switch (act) {
      case 'scan':
        await api.answer(cb.id, 'اسکن شروع شد');
        return scanFromPanel(chat, msgId);

      case 'chart': {
        await api.answer(cb.id, 'در حالِ ساختنِ چارت…');
        const r = rows.get(a1) || await analyzeItem(cfg.watchlist.find((w) => w.base === a1) || parseSymbol(a1));
        return sendChart(chat, r);
      }

      case 're': {
        await api.answer(cb.id, 'تحلیلِ دوباره…');
        await show(chat, msgId, { text: `⏳ در حالِ تحلیلِ ${M.esc(a1)}…`, buttons: [] });
        await analyzeItem(cfg.watchlist.find((w) => w.base === a1) || { ...parseSymbol(a1), adhoc: true });
        return show(chat, msgId, UI.coin(s(), a1));
      }

      case 'rm?':
        await api.answer(cb.id);
        return show(chat, msgId, UI.confirmRemove(a1));

      case 'rm':
        cfg.watchlist = cfg.watchlist.filter((w) => w.base !== a1);
        rows.delete(a1);
        saveSettings(cfg);
        await api.answer(cb.id, `${a1} حذف شد`);
        return show(chat, msgId, UI.watchlist(s()));

      case 'tg': case 'inc': case 'set': case 'def': {
        const p = paramById(a1);
        if (!p) return api.answer(cb.id);
        const cur = getPath(cfg, p.path);
        let next;
        if (act === 'tg') next = !cur;
        else if (act === 'def') next = structuredClone(getPath(cfg.defaults, p.path));
        else if (act === 'set') next = coerce(p, a2);
        else {
          const raw = cur + Number(a2) * p.step;
          next = Math.min(p.max, Math.max(p.min, Number(raw.toFixed(6))));
        }
        changeParam(p, next);
        await api.answer(cb.id, '✓ ذخیره شد');
        return show(chat, msgId, p.hidden ? UI.condition(s(), p.group) : UI.param(s(), p.id));
      }

      case 'in': {
        waiting.set(String(chat), { kind: 'param', id: Number(a1), panel: msgId });
        await api.answer(cb.id);
        return show(chat, msgId, UI.paramInput(s(), a1));
      }

      case 'rg':
        // نقطه‌ی ته لازم است: بدونش «divergence» شرطِ «divergence5m» را هم برمی‌گرداند
        resetParams(cfg, `strategy.conditions.${a1}.`);
        for (const p of PARAMS.filter((x) => x.group === a1)) resetParams(cfg, p.path);
        await api.answer(cb.id, 'به پیش‌فرض برگشت');
        return show(chat, msgId, UI.condition(s(), a1));

      case 'reset?':
        await api.answer(cb.id);
        return show(chat, msgId, UI.confirmReset());

      case 'reset':
        resetParams(cfg);
        await api.answer(cb.id, 'همه به پیش‌فرض برگشت');
        return show(chat, msgId, UI.strategy(s()));

      case 'every':
        if (!SCAN_INTERVALS[a1]) return api.answer(cb.id);
        cfg.scanEvery = a1;
        saveSettings(cfg);
        schedule();
        await api.answer(cb.id, `اسکنِ بعدی ${utc(nextScanAt)} UTC`);
        return show(chat, msgId, UI.settings(s()));

      case 'tf':
        if (!TIMEFRAMES.includes(a1)) return api.answer(cb.id);
        cfg.timeframe = a1;
        rows.clear(); // تحلیل‌های قبلی مالِ تایم‌فریمِ دیگری بودند
        saveSettings(cfg);
        await api.answer(cb.id, a1 === '1h' ? '✓' : 'استراتژی برای یک‌ساعته طراحی شده؛ این تغییر را با بک‌تست بسنج.', a1 !== '1h');
        return show(chat, msgId, UI.settings(s()));

      case 'chanenv':
        if (!isOwner(cb.from.id)) return api.answer(cb.id, 'فقط مالک‌ها.', true);
        delete cfg.channel;
        saveSettings(cfg);
        await refreshChannel();
        await api.answer(cb.id, 'به CHANNEL_ID ِ ریل‌وی برگشت');
        return show(chat, msgId, UI.channel(s(), true));

      case 'near':
        setParam(cfg, 'nearAlerts', !cfg.nearAlerts);
        await api.answer(cb.id, cfg.nearAlerts ? 'روشن شد' : 'خاموش شد');
        return show(chat, msgId, UI.settings(s()));

      case 'th': {
        // آستانه از صفحه‌ی تنظیمات — همان‌جا بماند
        const p = paramById(60);
        changeParam(p, Math.min(p.max, Math.max(p.min, cfg.alertThreshold + Number(a1) * p.step)));
        await api.answer(cb.id, '✓');
        return show(chat, msgId, UI.settings(s()));
      }

      case 'dir':
        cfg.directions = { long: ['long'], short: ['short'], both: ['long', 'short'] }[a1] || cfg.directions;
        saveSettings(cfg);
        await api.answer(cb.id, '✓');
        return show(chat, msgId, UI.settings(s()));

      case 'show': {
        const al = store.alert(a1);
        if (!al || al.status !== 'pending') return api.answer(cb.id, 'این هشدار دیگر در انتظار نیست.', true);
        await api.answer(cb.id);
        const m = await sendPhotoWithText(chat, readFileSync(al.chartPath), al.caption, alertButtons(al.id));
        store.updateAlert(al.id, { messages: [...(al.messages || []), m] });
        return null;
      }

      case 'arm?':
        if (!isOwner(cb.from.id)) return api.answer(cb.id, 'فقط مالک‌ها ادمین حذف می‌کنند.', true);
        await api.answer(cb.id);
        return show(chat, msgId, UI.confirmAdminRemove(s(), a1));

      case 'arm': {
        if (!isOwner(cb.from.id)) return api.answer(cb.id, 'فقط مالک‌ها ادمین حذف می‌کنند.', true);
        const gone = cfg.admins.find((a) => String(a.id) === a1);
        cfg.admins = cfg.admins.filter((a) => String(a.id) !== a1);
        saveSettings(cfg);
        waiting.delete(a1);
        await api.answer(cb.id, 'حذف شد');
        if (gone) api.sendMessage(a1, 'دسترسیِ ادمینیِ تو به این بات برداشته شد.').catch(() => {});
        return show(chat, msgId, UI.admins(s(), true));
      }

      case 'close':
        await api.answer(cb.id);
        return api.deleteMessage(chat, msgId).catch(() => {});

      default:
        return api.answer(cb.id);
    }
  }

  /** متنی که ادمین در جوابِ «افزودن» یا «مقدارِ دلخواه» فرستاده */
  async function onInput(msg, w) {
    const chat = msg.chat.id;
    api.deleteMessage(chat, msg.message_id).catch(() => {}); // پنل تمیز بماند
    if (w.kind === 'add') {
      const names = msg.text.split(/[\s,،]+/).filter(Boolean).slice(0, 10);
      await show(chat, w.panel, { text: `⏳ در حالِ جست‌وجوی ${M.esc(names.join(' '))} در صرافی‌ها…`, buttons: [] });
      const report = [];
      for (const n of names) {
        const item = parseSymbol(n);
        if (cfg.watchlist.some((x) => x.base === item.base)) { report.push(`▫️ ${item.id} از قبل در لیست بود`); continue; }
        const r = await analyzeItem(item);
        if (r.error) { report.push(`⚠️ ${item.id}: در هیچ صرافی‌ای پیدا نشد`); rows.delete(item.base); continue; }
        cfg.watchlist.push(item);
        report.push(`✅ ${item.id} ← ${r.data.exchange}`);
      }
      saveSettings(cfg);
      waiting.delete(String(chat));
      const screen = UI.watchlist(state());
      screen.text = `${M.esc(report.join('\n'))}\n\n${screen.text}`;
      return show(chat, w.panel, screen);
    }
    if (w.kind === 'edit') return onEditInput(msg, w);
    if (w.kind === 'channel') {
      api.deleteMessage(chat, msg.message_id).catch(() => {});
      const fchat = msg.forward_origin?.chat || msg.forward_from_chat;
      let id;
      if (fchat) id = String(fchat.id);
      else {
        const n = normalizeChannel(msg.text);
        if (!n.id) return show(chat, w.panel, UI.channelPrompt(`⚠️ ${M.esc(n.error)}`));
        id = n.id;
      }
      await show(chat, w.panel, { text: '⏳ در حالِ بررسیِ دسترسیِ بات در این کانال…', buttons: [] });
      const st = await checkChannel(api, id, botId);
      if (!st.ok) return show(chat, w.panel, UI.channelPrompt(`⚠️ ${M.esc(st.error)}`));
      cfg.channel = { id: String(st.chat.id), title: st.chat.title || '' };
      saveSettings(cfg);
      waiting.delete(String(chat));
      channelStatus = st;
      return show(chat, w.panel, UI.channel(state(), true, '✅ کانال ذخیره شد و بات می‌تواند در آن پست بگذارد.'));
    }
    if (w.kind === 'admin') {
      // شناسه‌ی عددی، یا پیامی که از آن شخص فوروارد شده
      const fwd = msg.forward_origin?.sender_user || msg.forward_from;
      const id = fwd?.id ? String(fwd.id) : (msg.text || '').trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
      if (!/^\d{5,15}$/.test(id)) {
        const hidden = msg.forward_origin?.type === 'hidden_user' || msg.forward_sender_name;
        return show(chat, w.panel, UI.adminPrompt(hidden
          ? '⚠️ این شخص فورواردِ پیامش را بسته و شناسه‌اش دیده نمی‌شود. از خودش بخواه به بات /id بدهد و عدد را بفرست.'
          : '⚠️ این شناسه‌ی عددی نیست. فقط عدد، مثلاً 5123456789.'));
      }
      waiting.delete(String(chat));
      if (isAdmin(id)) return show(chat, w.panel, withNote(UI.admins(state(), true), 'این شخص از قبل ادمین است.'));
      const name = fwd ? [fwd.first_name, fwd.last_name].filter(Boolean).join(' ') || fwd.username || '' : '';
      cfg.admins.push({ id, name, by: String(msg.from.id), at: Date.now() });
      saveSettings(cfg);
      // پیامِ خوش‌آمد هم آزمایشِ رسیدنِ هشدار است: اگر /start نزده، تلگرام رد می‌کند
      let note;
      try {
        await api.sendMessage(id, '👋 به‌عنوانِ ادمین به باتِ سیگنال اضافه شدی.\nهشدارها برایت می‌آید؛ پنل با /panel باز می‌شود.');
        note = '✅ اضافه شد و پیامِ خوش‌آمد رسید.';
      } catch {
        note = '✅ اضافه شد، ولی هنوز بات را /start نزده — تا نزند هشدار به او نمی‌رسد.';
      }
      return show(chat, w.panel, withNote(UI.admins(state(), true), note));
    }
    if (w.kind === 'param') {
      const p = paramById(w.id);
      let value;
      try {
        value = coerce(p, msg.text);
      } catch (e) {
        return show(chat, w.panel, UI.paramInput(state(), p.id, `\n⚠️ ${M.esc(e.message)} — دوباره بفرست.`));
      }
      changeParam(p, value);
      waiting.delete(String(chat));
      return show(chat, w.panel, UI.param(state(), p.id, '✓ ذخیره شد'));
    }
    return null;
  }

  // ───────────────────────────── ورودی‌ها
  async function openPanel(chat) {
    waiting.delete(String(chat));
    return show(chat, null, UI.home(state()));
  }

  const commands = {
    start: (msg) => openPanel(msg.chat.id),
    panel: (msg) => openPanel(msg.chat.id),
    menu: (msg) => openPanel(msg.chat.id),
    help: (msg) => openPanel(msg.chat.id),
    id: (msg) => api.sendMessage(msg.chat.id, `شناسه‌ی تو: <code>${msg.from.id}</code>\nشناسه‌ی این چت: <code>${msg.chat.id}</code>`),
    async scan(msg, args) {
      if (!args.length) {
        const id = await show(msg.chat.id, null, UI.scanning(0, cfg.watchlist.length));
        return scanFromPanel(msg.chat.id, id);
      }
      const base = parseSymbol(args[0]).base;
      const item = cfg.watchlist.find((w) => w.base === base) || { ...parseSymbol(args[0]), adhoc: true };
      const r = await analyzeItem(item);
      return sendChart(msg.chat.id, r);
    },
  };

  function rememberName(user) {
    if (!user || !isAdmin(user.id)) return;
    const names = (store.get().names ??= {});
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
    if (names[user.id] !== name) { names[user.id] = name; store.save(); }
  }

  async function onMessage(msg) {
    rememberName(msg.from);
    const text = msg.text || '';
    const chat = msg.chat.id;
    // پیامِ فورواردی (برای افزودنِ ادمین) همیشه ورودی است، حتی اگر با / شروع شود
    if (!text.startsWith('/') || msg.forward_origin || msg.forward_from) {
      const w = waiting.get(String(chat));
      if (w && isAdmin(msg.from.id)) return onInput(msg, w);
      if (isAdmin(msg.from.id)) return openPanel(chat);
      return null;
    }
    const [head, ...args] = text.trim().split(/\s+/);
    const name = head.slice(1).split('@')[0].toLowerCase();
    if (name === 'id') return commands.id(msg);
    if (!isAdmin(msg.from.id)) {
      if (name === 'start') return api.sendMessage(chat, `این بات خصوصی است.\nشناسه‌ی تو: <code>${msg.from.id}</code>`);
      return null;
    }
    const fn = commands[name];
    return fn ? fn(msg, args) : openPanel(chat);
  }

  async function onCallback(cb) {
    if (!isAdmin(cb.from.id)) return api.answer(cb.id, 'فقط ادمین.', true);
    const data = String(cb.data || '');
    const chat = cb.message?.chat.id;
    const msgId = cb.message?.message_id;
    const [kind, ...rest] = data.split(':');
    if (kind === 'ok' || kind === 'no') return decide(cb, kind === 'ok', rest[0]);
    if (kind === 'ed') return onEditor(cb, rest[0], rest[1]);
    if (kind === 'nav') {
      await api.answer(cb.id);
      return navigate(chat, msgId, rest[0], rest[1]);
    }
    if (kind === 'act') return action(cb, chat, msgId, rest);
    return api.answer(cb.id);
  }

  // ───────────────────────────── حلقه‌ی دریافت
  async function poll() {
    const st = store.get();
    for (;;) {
      let updates = [];
      try {
        updates = await api.getUpdates(st.updateOffset);
      } catch (e) {
        // 409 = نمونه‌ی دیگری از همین بات در حالِ اجراست (مثلاً دیپلوی قبلی
        // روی Railway هنوز خاموش نشده). صبر کن، کرش نکن.
        log.warn(`[poll] ${e.message}`);
        await new Promise((r) => setTimeout(r, e.code === 409 ? 15_000 : 5_000));
        continue;
      }
      for (const u of updates) {
        st.updateOffset = u.update_id + 1;
        try {
          if (u.message) await onMessage(u.message);
          else if (u.callback_query) await onCallback(u.callback_query);
        } catch (e) {
          log.error('[update]', e);
          const chat = u.message?.chat.id || u.callback_query?.message?.chat.id;
          if (u.callback_query) api.answer(u.callback_query.id, '⚠️ خطا — جزئیات در لاگِ سرور.', true).catch(() => {});
          else if (chat) await api.sendMessage(chat, '⚠️ این کار با خطا تمام شد. جزئیات در لاگِ سرور است.').catch(() => {});
        }
      }
      if (updates.length) store.save();
    }
  }

  /**
   * هشداری که وسطِ انتشار ماند (ری‌استارت یا دیپلوی) قفل می‌ماند و دیگر هیچ
   * دکمه‌ای کار نمی‌کرد. باز می‌شود — ولی شاید پستش در کانال رفته باشد، پس
   * مالک‌ها خبر می‌گیرند که پیش از انتشارِ دوباره کانال را نگاه کنند.
   */
  async function recoverStuck() {
    for (const a of Object.values(store.get().alerts)) {
      if (a.status !== 'publishing') continue;
      store.updateAlert(a.id, { status: 'pending', interrupted: true });
      for (const o of owners) {
        api.sendMessage(o, `⚠️ انتشارِ <b>${M.esc(a.pretty || a.symbol)}</b> نیمه‌کاره ماند (ری‌استارتِ سرور).
`
          + 'پیش از زدنِ دوباره‌ی «انتشار» کانال را نگاه کن؛ شاید پستِ تحلیل رفته باشد.').catch(() => {});
      }
    }
  }

  async function start() {
    const me = await api.getMe();
    botId = me.id;
    const ch = await refreshChannel();
    if (!ch.ok) {
      log.warn(`[channel] ${ch.error} (${channelId() || 'خالی'})`);
      for (const o of owners) {
        api.sendMessage(o, `⚠️ <b>کانالِ انتشار کار نمی‌کند:</b> ${M.esc(ch.error)}\nمقدارِ فعلی: <code>${M.esc(channelId() || env.channelId || 'خالی')}</code>\n\n`
          + 'یک پست از کانال را این‌جا فوروارد کن تا خودم شناسه را بردارم:', { buttons: [[{ text: '📢 تنظیمِ کانال', callback_data: 'nav:chan' }]] }).catch(() => {});
      }
    }
    await api.deleteWebhook();
    await api.setCommands([
      { command: 'panel', description: 'پنلِ مدیریت' },
      { command: 'scan', description: 'اسکنِ فوری (یا /scan SOL برای یک ارز)' },
      { command: 'id', description: 'شناسه‌ی عددی' },
    ]).catch(() => {});
    await recoverStuck();
    schedule();
    // پیگیری هر ۱۰ دقیقه — کندلِ ۵ دقیقه‌ای، پس دیرتر از ۱۵ دقیقه خبری نمی‌ماند
    trackTimer = setInterval(() => runTracker().catch((e) => log.error('[track]', e)), 10 * 60_000);
    setTimeout(() => runTracker().catch((e) => log.error('[track]', e)), 20_000).unref?.();
    // مثلِ تایمرِ اسکن: polling پروسه را زنده نگه می‌دارد، این‌ها نباید
    trackTimer.unref?.();
    log.info(`[bot] @${me.username} آماده است · ادمین‌ها: ${adminIds().join(', ') || '—'}`
      + ` · اسکنِ بعدی ${utc(nextScanAt)} UTC`);
    for (const a of adminIds()) {
      api.sendMessage(a, `🤖 بات روشن شد. اسکنِ بعدی ${utc(nextScanAt)} UTC (هر ${cfg.scanEvery}).\nبرای پنل /panel را بزن.`).catch(() => {});
    }
    return poll();
  }

  /** ذخیره از چارتِ زنده ← خبر به همه‌ی ادمین‌ها، تا تغییرِ استراتژی بی‌صدا نماند */
  function onWebSave(user, changes) {
    const who = M.esc([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id));
    const lines = changes.map((c) => {
      const where = CONDITIONS[c.p.group]?.fa;
      return `• ${M.esc(where ? `${where} ← ${c.p.fa}` : c.p.fa)}: ${M.esc(formatValue(c.p, c.from))} → <b>${M.esc(formatValue(c.p, c.to))}</b>`;
    });
    const text = `📈 <b>${who}</b> از چارتِ زنده استراتژی را عوض کرد:\n${lines.join('\n')}\n\nاز اسکنِ بعدی اعمال می‌شود.`;
    for (const a of adminIds()) api.sendMessage(a, text).catch(() => {});
  }

  return { start, runScan, runTracker, commands, decide, schedule, onCallback, onMessage, state, isAdmin, onWebSave };
}

function withNote(screen, note) {
  return { ...screen, text: `${M.esc(note)}\n\n${screen.text}` };
}

function visibleLength(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, '_').length;
}
