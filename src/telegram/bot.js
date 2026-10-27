/**
 * منطقِ بات: دستورهای ادمین، هشدار با دکمه‌ی تأیید/رد، و انتشار در کانال.
 *
 * جریان:
 *   اسکن ← امتیاز ≥ آستانه و خارج از cooldown ← عکس + شواهد برای هر ادمین
 *   ← «انتشار» ← پستِ تحلیل (عکس) در کانال + پیامِ سیگنال در پاسخ به آن
 *   ← کپشنِ هشدار نزدِ همه‌ی ادمین‌ها به‌روز می‌شود و دکمه‌ها برداشته می‌شوند.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SCAN_INTERVALS, parseSymbol, saveSettings } from '../config.js';
import { scanAll, scanOne, setupKey } from '../scanner.js';
import { renderChart } from '../chart/render.js';
import { store, dataDir } from '../store.js';
import * as M from '../messages.js';
import { utc } from '../format.js';

const CAPTION_MAX = 1024;

export function createBot({ api, env, cfg, log = console }) {
  const admins = new Set(env.adminIds.map(String));
  const isAdmin = (id) => admins.has(String(id));
  let scanning = false;
  let timer = null;
  let nextScanAt = null;

  // ───────────────────────────── زمان‌بندی
  // اسکن روی مرزِ ساعت/۴ساعت/روزِ UTC — یعنی درست بعد از بسته شدنِ کندل —
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
  }

  async function runScan({ manual = false, replyTo = null } = {}) {
    if (scanning) {
      if (replyTo) await api.sendMessage(replyTo, 'یک اسکن همین الان در جریان است؛ چند لحظه‌ی دیگر نتیجه می‌رسد.');
      return;
    }
    scanning = true;
    try {
      const results = await scanAll(cfg);
      let alerts = 0;
      for (const r of results) {
        if (!r.result || r.result.score < cfg.alertThreshold) continue;
        const key = setupKey(r);
        if (store.onCooldown(key, cfg.cooldownHours)) continue;
        await sendAlert(r, key);
        store.markSent(key);
        alerts++;
      }
      const s = store.get();
      s.lastScan = {
        at: Date.now(), alerts,
        rows: results.map((r) => ({ id: r.item.id, score: r.result?.score ?? null, error: r.error || null, exchange: r.data?.exchange })),
      };
      store.save();
      log.info(`[scan] ${results.length} نماد، ${alerts} هشدار`);
      if (replyTo) await api.sendMessage(replyTo, M.scanSummary(results, cfg, { manual }));
    } finally {
      scanning = false;
    }
  }

  // ───────────────────────────── هشدار
  function chartFor(r) {
    return renderChart({
      candles: r.data.candles, result: r.result, minBars: cfg.chart.minBars,
      meta: { pretty: r.data.pretty, exchange: r.data.exchange, timeframe: cfg.timeframe, watermark: cfg.chart.watermark },
    });
  }

  async function sendAlert(r, key, { to = [...admins] } = {}) {
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
      id, key, status: 'pending', createdAt: Date.now(),
      symbol: r.item.id, pretty: r.data.pretty, score: r.result.score,
      chartPath, caption,
      analysis: M.channelAnalysis(r, cfg),
      signal: r.result.plan ? M.channelSignal(r) : null,
      messages,
    });
    return id;
  }

  /** کپشنِ بلند جا نمی‌شود → عکس با عنوان، و متن + دکمه‌ها در پیامِ بعدی. */
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
      return api.answer(cb.id, `این هشدار ${ageH.toFixed(1)} ساعت پیش آمده و قیمت جابه‌جا شده. /scan ${a.symbol} بزن تا تازه‌اش را بگیری.`, true);
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
        else await api.call('editMessageText', { chat_id: m.chat, message_id: m.id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
      } catch (e) {
        log.warn('[alert] ویرایش نشد:', e.message);
      }
    }
  }

  // ───────────────────────────── دستورها
  const commands = {
    async start(msg) {
      if (!isAdmin(msg.from.id)) {
        return api.sendMessage(msg.chat.id, `این بات خصوصی است.\nشناسه‌ی تو: <code>${msg.from.id}</code>`);
      }
      return api.sendMessage(msg.chat.id, `سلام! بات سیگنال فعال است.\n\n${M.HELP}`);
    },
    help: (msg) => api.sendMessage(msg.chat.id, M.HELP),
    id: (msg) => api.sendMessage(msg.chat.id, `شناسه‌ی تو: <code>${msg.from.id}</code>\nشناسه‌ی این چت: <code>${msg.chat.id}</code>`),

    async list(msg) {
      const rows = cfg.watchlist.map((w, i) => `${i + 1}. ${M.esc(w.id)}`);
      return api.sendMessage(msg.chat.id, [
        `<b>واچ‌لیست</b> (${cfg.watchlist.length})`, ...rows, '',
        `فاصله‌ی اسکن: <b>${cfg.scanEvery}</b> · تایم‌فریمِ تحلیل: <b>${cfg.timeframe}</b>`,
        `آستانه‌ی هشدار: <b>${cfg.alertThreshold}</b> · جهت: <b>${cfg.directions.join(' + ')}</b>`,
        `اولویتِ صرافی: ${cfg.exchanges.join(' ← ')}`,
      ].join('\n'));
    },

    async add(msg, args) {
      if (!args.length) return api.sendMessage(msg.chat.id, 'مثال: /add SOL');
      const added = [];
      const failed = [];
      for (const a of args) {
        const item = parseSymbol(a);
        if (cfg.watchlist.some((w) => w.base === item.base)) { failed.push(`${item.id} (از قبل هست)`); continue; }
        try {
          const r = await scanOne(item, cfg);
          cfg.watchlist.push(item);
          added.push(`${item.id} ← ${r.data.exchange}`);
        } catch {
          failed.push(`${item.id} (در هیچ صرافی‌ای پیدا نشد)`);
        }
      }
      saveSettings(cfg);
      return api.sendMessage(msg.chat.id, [
        ...added.map((x) => `✅ ${M.esc(x)}`), ...failed.map((x) => `⚠️ ${M.esc(x)}`),
      ].join('\n'));
    },

    async remove(msg, args) {
      if (!args.length) return api.sendMessage(msg.chat.id, 'مثال: /remove SOL');
      const bases = args.map((a) => parseSymbol(a).base);
      const before = cfg.watchlist.length;
      cfg.watchlist = cfg.watchlist.filter((w) => !bases.includes(w.base));
      saveSettings(cfg);
      return api.sendMessage(msg.chat.id, before === cfg.watchlist.length
        ? 'این نماد در واچ‌لیست نبود.'
        : `🗑 حذف شد. ${cfg.watchlist.length} نماد مانده.`);
    },

    async every(msg, args) {
      const v = (args[0] || '').toLowerCase();
      if (!SCAN_INTERVALS[v]) return api.sendMessage(msg.chat.id, 'یکی از این‌ها: /every 1h · /every 4h · /every 1d');
      cfg.scanEvery = v;
      saveSettings(cfg);
      schedule();
      return api.sendMessage(msg.chat.id, `⏱ اسکن هر <b>${v}</b>. اسکنِ بعدی: ${utc(nextScanAt)} UTC`);
    },

    async threshold(msg, args) {
      const v = Number(args[0]);
      if (!(v >= 30 && v <= 100)) return api.sendMessage(msg.chat.id, 'عددی بین 30 و 100. مثال: /threshold 70');
      cfg.alertThreshold = Math.round(v);
      saveSettings(cfg);
      return api.sendMessage(msg.chat.id, `آستانه‌ی هشدار: <b>${cfg.alertThreshold}</b>`);
    },

    async direction(msg, args) {
      const map = { long: ['long'], short: ['short'], both: ['long', 'short'] };
      const v = map[(args[0] || '').toLowerCase()];
      if (!v) return api.sendMessage(msg.chat.id, '/direction long · short · both');
      cfg.directions = v;
      saveSettings(cfg);
      return api.sendMessage(msg.chat.id, `جهت: <b>${v.join(' + ')}</b>`);
    },

    async scan(msg, args) {
      if (!args.length) {
        await api.sendMessage(msg.chat.id, '🔎 اسکنِ کلِ واچ‌لیست شروع شد…');
        return runScan({ manual: true, replyTo: msg.chat.id });
      }
      const item = cfg.watchlist.find((w) => w.base === parseSymbol(args[0]).base) || parseSymbol(args[0]);
      let r;
      try {
        r = await scanOne(item, cfg);
      } catch (e) {
        return api.sendMessage(msg.chat.id, `⚠️ ${M.esc(item.id)}: داده نیامد.\n<i>${M.esc(e.message)}</i>`);
      }
      if (!r.result) {
        return api.sendMessage(msg.chat.id, `▫️ ${M.esc(r.data.pretty)} (${r.data.exchange}): الان هیچ خطِ روندِ معتبری نزدیکِ قیمت نیست.`);
      }
      // اسکنِ دستیِ یک نماد همیشه با دکمه‌ی انتشار می‌آید، حتی زیرِ آستانه:
      // ادمین خودش دیده و تصمیمش را گرفته.
      return sendAlert(r, setupKey(r), { to: [msg.chat.id] });
    },

    async status(msg) {
      const s = store.get().lastScan;
      const pending = Object.values(store.get().alerts).filter((a) => a.status === 'pending').length;
      return api.sendMessage(msg.chat.id, [
        '<b>وضعیت</b>',
        `آخرین اسکن: ${s ? `${utc(s.at)} UTC · ${s.alerts} هشدار` : 'هنوز نه'}`,
        `اسکنِ بعدی: ${nextScanAt ? `${utc(nextScanAt)} UTC` : '—'} (هر ${cfg.scanEvery})`,
        `هشدارهای در انتظارِ تأیید: ${pending}`,
        `کانال: ${env.channelId ? M.esc(env.channelId) : '⚠️ تنظیم نشده'}`,
        ...(s?.rows || []).map((r) => `${r.error ? '⚠️' : '▫️'} ${M.esc(r.id)} ${r.score ?? '—'}${r.exchange ? ` · ${r.exchange}` : ''}`),
      ].join('\n'));
    },
  };

  const PUBLIC = new Set(['start', 'id']);

  async function onMessage(msg) {
    const text = msg.text || '';
    if (!text.startsWith('/')) return;
    const [head, ...args] = text.trim().split(/\s+/);
    const name = head.slice(1).split('@')[0].toLowerCase();
    const fn = commands[name];
    if (!fn) return;
    if (!PUBLIC.has(name) && !isAdmin(msg.from.id)) return;
    await fn(msg, args);
  }

  async function onCallback(cb) {
    if (!isAdmin(cb.from.id)) return api.answer(cb.id, 'فقط ادمین.', true);
    const [action, id] = String(cb.data || '').split(':');
    if (action === 'ok' || action === 'no') return decide(cb, action === 'ok', id);
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
          const chat = u.message?.chat.id;
          if (chat) await api.sendMessage(chat, '⚠️ این دستور با خطا تمام شد. جزئیات در لاگِ سرور است.').catch(() => {});
        }
      }
      if (updates.length) store.save();
    }
  }

  async function start() {
    const me = await api.getMe();
    await api.deleteWebhook();
    await api.setCommands([
      { command: 'scan', description: 'اسکنِ فوری' },
      { command: 'list', description: 'واچ‌لیست و تنظیمات' },
      { command: 'status', description: 'وضعیت' },
      { command: 'help', description: 'راهنما' },
    ]).catch(() => {});
    schedule();
    log.info(`[bot] @${me.username} آماده است · ادمین‌ها: ${[...admins].join(', ') || '—'}`
      + ` · اسکنِ بعدی ${utc(nextScanAt)} UTC`);
    for (const a of admins) {
      api.sendMessage(a, `🤖 بات روشن شد. اسکنِ بعدی ${utc(nextScanAt)} UTC (هر ${cfg.scanEvery}).`).catch(() => {});
    }
    return poll();
  }

  return { start, runScan, commands, decide, schedule, onCallback, onMessage };
}

function visibleLength(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, '_').length;
}
