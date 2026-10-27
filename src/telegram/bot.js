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
import { renderChart } from '../chart/render.js';
import { store, dataDir } from '../store.js';
import { PARAMS, paramById, getPath, coerce } from '../strategy/params.js';
import * as M from '../messages.js';
import * as UI from './panel.js';
import { utc } from '../format.js';

const CAPTION_MAX = 1024;

export function createBot({ api, env, cfg, log = console }) {
  const admins = new Set(env.adminIds.map(String));
  const isAdmin = (id) => admins.has(String(id));
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
  async function sendAlert(r, { to = [...admins] } = {}) {
    const id = randomBytes(5).toString('hex');
    const png = chartFor(r);
    const dir = join(dataDir(), 'charts');
    mkdirSync(dir, { recursive: true });
    const chartPath = join(dir, `${id}.png`);
    writeFileSync(chartPath, png);

    const caption = M.adminAlert(r, cfg);
    const buttons = [[
      { text: '✅ انتشار در کانال', callback_data: `ok:${id}` },
      { text: '❌ رد', callback_data: `no:${id}` },
    ]];
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
    if (a.status !== 'pending') return api.answer(cb.id, `قبلاً ${a.status === 'published' ? 'منتشر' : 'رد'} شده.`, true);

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
    if (!env.channelId) return api.answer(cb.id, 'CHANNEL_ID تنظیم نشده.', true);

    // قفل پیش از تماسِ شبکه: دو ادمین که هم‌زمان بزنند نباید دو پست بسازند
    store.updateAlert(alertId, { status: 'publishing' });
    await api.answer(cb.id, 'در حالِ انتشار…');
    try {
      const png = readFileSync(a.chartPath);
      const post = await sendPhotoWithText(env.channelId, png, a.analysis);
      if (a.signal) await api.sendMessage(env.channelId, a.signal, { replyTo: post.id });
      store.updateAlert(alertId, { status: 'published', by: who, publishedAt: Date.now() });
      await closeAlert(a, `✅ منتشر شد توسطِ ${who} · ${utc(Date.now())} UTC`);
    } catch (e) {
      store.updateAlert(alertId, { status: 'pending' });
      log.error('[publish]', e.message);
      await api.sendMessage(cb.from.id, `❌ انتشار در کانال ناموفق بود: ${M.esc(e.description || e.message)}\n`
        + 'بات باید ادمینِ کانال باشد و اجازه‌ی ارسالِ پیام داشته باشد.');
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
        resetParams(cfg, `strategy.conditions.${a1}`);
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
        const m = await sendPhotoWithText(chat, readFileSync(al.chartPath), al.caption, [[
          { text: '✅ انتشار در کانال', callback_data: `ok:${al.id}` },
          { text: '❌ رد', callback_data: `no:${al.id}` },
        ]]);
        store.updateAlert(al.id, { messages: [...(al.messages || []), m] });
        return null;
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

  async function onMessage(msg) {
    const text = msg.text || '';
    const chat = msg.chat.id;
    if (!text.startsWith('/')) {
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

  async function start() {
    const me = await api.getMe();
    await api.deleteWebhook();
    await api.setCommands([
      { command: 'panel', description: 'پنلِ مدیریت' },
      { command: 'scan', description: 'اسکنِ فوری (یا /scan SOL برای یک ارز)' },
      { command: 'id', description: 'شناسه‌ی عددی' },
    ]).catch(() => {});
    schedule();
    log.info(`[bot] @${me.username} آماده است · ادمین‌ها: ${[...admins].join(', ') || '—'}`
      + ` · اسکنِ بعدی ${utc(nextScanAt)} UTC`);
    for (const a of admins) {
      api.sendMessage(a, `🤖 بات روشن شد. اسکنِ بعدی ${utc(nextScanAt)} UTC (هر ${cfg.scanEvery}).\nبرای پنل /panel را بزن.`).catch(() => {});
    }
    return poll();
  }

  return { start, runScan, commands, decide, schedule, onCallback, onMessage, state };
}

function visibleLength(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, '_').length;
}
