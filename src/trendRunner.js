/**
 * اجرای روزانه‌ی روند‌گیری (src/strategy/trend.js) در بات.
 *
 * حالت‌ها (cfg.trend.mode):
 *   off    هیچ کاری نمی‌کند.
 *   paper  هر روز بعد از کلوزِ ۰۰:۰۰ UTC، ورود و خروج‌ها خودکار در دفترِ
 *          کاغذی ثبت و فقط به ادمین‌ها خبر داده می‌شود. هیچ چیزی به کانال نمی‌رود.
 *   live   دفترِ کاغذی ادامه دارد (کارنامه‌ی بی‌طرفِ خودِ استراتژی، مستقل از
 *          تصمیمِ ادمین)، و هر ورود به‌علاوه یک هشدار با دکمه‌ی «انتشار» دارد.
 *          سیگنالِ منتشرشده: حد ضرر با کندلِ ۵ دقیقه (tracker.stopStep)، و
 *          خروجِ قاعده‌ای همین‌جا، با کلوزِ روزانه‌ی زیرِ EMA.
 *
 * ⚠️ هر نماد برای هر کندلِ روزانه فقط یک بار ورود می‌گیرد (store.trend().seen)،
 * پس اجرای دوباره — دکمه‌ی پنل یا ری‌استارت — تکراری نمی‌سازد. خروج‌ها با
 * pos.lastT همه‌ی کندل‌های جاافتاده (خاموشیِ بات) را هم می‌بینند؛ ورودِ روزِ
 * جاافتاده اما گرفته نمی‌شود — آن قیمت دیگر قابلِ اجرا نیست.
 */

import { randomBytes } from 'node:crypto';
import { fetchCandles, fetchFrom } from './exchanges/index.js';
import { DAY, TREND_DEFAULTS, utcAligned, indicators, evaluate, openPosition, advance, closePosition, replay } from './strategy/trend.js';
import { renderTrendChart, state as chartState } from './chart/trendChart.js';
import { ruleExit } from './tracker.js';
import { store } from './store.js';
import * as M from './messages.js';
import { utc } from './format.js';

export const TREND_MODES = ['off', 'paper', 'live'];
/** ورود روی کلوزی که بیش از این کهنه است گرفته نمی‌شود */
const STALE_MS = 36 * 3_600_000;
const CLOSED_KEEP = 1000;
const CAPTION_MAX = 1024;
/** طولِ متنِ دیده‌شده در تلگرام (بی‌تگ) — سقفِ کپشن روی همین است */
const visible = (html) => html.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot);/g, '_').length;

export const trendParams = (cfg) => ({ ...TREND_DEFAULTS, ...cfg.trend });

/** کندلِ روزانه از اولین صرافی‌ای که روزِ UTC دارد */
export function fetchDaily(item, cfg) {
  const p = trendParams(cfg);
  return fetchCandles(item, {
    exchanges: cfg.exchanges,
    timeframe: '1d',
    candles: p.candles,
    minCandles: p.minBars,
    accept: (rows) => (utcAligned(rows) ? null : 'کندلِ روزانه روی روزِ UTC بسته نمی‌شود'),
  });
}

/** زمانِ اجرای بعدی: چند دقیقه بعد از ۰۰:۰۰ UTC */
export function nextRunAt(cfg, now = Date.now()) {
  const off = (cfg.trend?.runAfterMinutes ?? 5) * 60_000;
  let t = Math.floor(now / DAY) * DAY + off;
  if (t <= now) t += DAY;
  return t;
}

export function createTrendRunner({ api, cfg, log = console, adminIds, channelId, fetchDailyFn = fetchDaily }) {
  let running = false;
  const T = () => store.trend();
  const toAdmins = (text, extra) => Promise.all(adminIds().map((chat) => api.sendMessage(chat, text, extra)
    .then((m) => ({ chat, id: m.message_id }))
    .catch((e) => { log.warn('[trend]', e.message); return null; })))
    .then((xs) => xs.filter(Boolean));
  const photoToAdmins = (png, caption) => Promise.all(adminIds().map((chat) => Promise.resolve().then(() => api.sendPhoto(chat, png, caption))
    .catch((e) => { log.warn('[trend] عکس:', e.message); return null; })));

  /** پیام به ادمین‌ها، با چارت اگر ساخته شد. چارتِ خراب هیچ‌وقت جلوی پیام را نمی‌گیرد. */
  async function notifyAdmins(text, png) {
    if (png && visible(text) <= CAPTION_MAX) {
      const sent = await photoToAdmins(png, text);
      if (sent.every(Boolean)) return;
    }
    await toAdmins(text);
  }

  /**
   * پوزیشنِ بازِ این نماد برای چارت: سیگنالِ منتشرشده، بعد دفترِ کاغذی، بعد
   * خودِ قاعده (replay) — وقتی بات خاموش بوده و چیزی ثبت نکرده.
   */
  function openFor(item, tail) {
    const sig = store.signals().find((x) => x.kind === 'trend' && x.status === 'open' && x.symbol === item.id);
    if (sig) return { entry: sig.entry, stop: sig.sl, entryBarT: sig.entryBarT ?? sig.dailyT, source: 'live' };
    const pos = T().book[item.base];
    if (pos) return { entry: pos.entry, stop: pos.stop, entryBarT: pos.entryBarT, source: 'paper' };
    if (tail?.exitReason === 'end') return { entry: tail.entry, stop: tail.stop, entryBarT: tail.entryBarT, source: 'rule' };
    return null;
  }

  /**
   * @param override  پوزیشنی که باید کشیده شود (undefined ← خودش پیدا می‌کند، null ← هیچ)
   * @returns {{ png: Buffer|null, open, trades, ev }}
   */
  function drawChart(item, data, override) {
    const p = trendParams(cfg);
    const all = replay(data.candles, p);
    const trades = all.filter((t) => t.exitReason !== 'end');
    const open = override === undefined ? openFor(item, all.at(-1)) : override;
    let png = null;
    try {
      png = renderTrendChart({ bars: data.candles, p, trades, open, meta: { pretty: data.pretty, exchange: data.exchange, watermark: cfg.chart?.watermark } });
    } catch (e) {
      log.warn('[trend] چارت ساخته نشد:', e.message);
    }
    return { png, open, trades, ev: evaluate(data.candles, p) };
  }

  /** چارت و توضیحِ یک نماد، برای پنل — در هر حالتی، حتی خاموش */
  async function chart(item) {
    const data = await fetchDailyFn(item, cfg);
    const p = trendParams(cfg);
    const d = drawChart(item, data);
    if (!d.png) throw new Error('چارت ساخته نشد');
    const st = chartState({ open: d.open, ev: d.ev, last: data.candles.at(-1), p });
    const viewFrom = (data.candles.at(-240) ?? data.candles[0]).t;
    const shown = d.trades.filter((t) => t.exitBarT >= viewFrom);
    return {
      png: d.png,
      caption: M.trendChartCaption({ pretty: data.pretty, exchange: data.exchange, ev: d.ev, open: d.open, state: st.key, shown, lastExit: d.trades.at(-1)?.exitReason, emaPeriod: p.emaPeriod }),
    };
  }

  /**
   * یک دورِ روزانه. @returns خلاصه‌ی ردیف‌ها، یا null اگر خاموش/در حالِ اجرا
   */
  async function runDaily(now = Date.now()) {
    const p = trendParams(cfg);
    if (p.mode === 'off' || running) return null;
    running = true;
    try {
      const rows = [];
      for (const item of cfg.watchlist) {
        let data;
        try {
          data = await fetchDailyFn(item, cfg);
        } catch (e) {
          rows.push({ base: item.base, id: item.id, error: e.message });
          continue;
        }
        const bars = data.candles;
        const ind = indicators(bars, p);
        const ev = evaluate(bars, p, ind);
        rows.push(ev.ok
          ? { base: item.base, id: item.id, pretty: data.pretty, exchange: data.exchange, close: ev.close, ema: ev.ema, distPct: ev.distPct, above: ev.above, t: ev.t }
          : { base: item.base, id: item.id, pretty: data.pretty, error: ev.reason });
        await paperExit(item, data, ind, p);
        await liveExits(item, data, ind, p, now);
        if (!ev.ok) continue;
        const st = T();
        if ((st.seen[item.base] ?? -Infinity) >= ev.t) continue;
        st.seen[item.base] = ev.t;
        store.save();
        if (!ev.entry || now - ev.closeT > STALE_MS) continue;
        if (!st.book[item.base]) await paperEntry(item, data, ev, p);
        if (p.mode === 'live') await sendAlert(item, data, ev, p);
      }
      T().last = { at: now, rows };
      store.save();
      log.info(`[trend] ${rows.length} نماد · باز (کاغذی): ${Object.keys(T().book).length}`);
      return rows;
    } finally {
      running = false;
    }
  }

  async function paperEntry(item, data, ev, p) {
    const pos = {
      ...openPosition(ev),
      base: item.base, symbol: item.id, pretty: data.pretty, exchange: data.exchange, openedAt: Date.now(),
    };
    T().book[item.base] = pos;
    store.save();
    await notifyAdmins(M.trendPaperEntry(pos, p.emaPeriod), drawChart(item, data, { ...pos, source: 'paper' }).png);
  }

  async function paperExit(item, data, ind, p) {
    const bars = data.candles;
    const pos = T().book[item.base];
    if (!pos) return;
    const exit = advance(pos, bars, p, ind);
    if (!exit) {
      store.save(); // lastT جلو رفته
      return;
    }
    closePosition(pos, exit, p);
    delete T().book[item.base];
    T().closed.push(pos);
    if (T().closed.length > CLOSED_KEEP) T().closed.splice(0, T().closed.length - CLOSED_KEEP);
    store.save();
    await notifyAdmins(M.trendPaperExit(pos), drawChart(item, data, null).png);
  }

  /**
   * سیگنال‌های منتشرشده: خروج با کلوزِ زیرِ EMA. حد ضرر مالِ tracker است
   * (کندلِ ۵ دقیقه، از لحظه‌ی انتشار) و bot.js پیش از این دور tracker را
   * اجرا می‌کند، تا سیگنالی که استاپش خورده این‌جا دیگر باز نباشد.
   */
  async function liveExits(item, data, ind, p, now) {
    const bars = data.candles;
    for (const sig of store.signals()) {
      if (sig.kind !== 'trend' || sig.status !== 'open' || sig.symbol !== item.id) continue;
      for (let i = 1; i < bars.length; i++) {
        const k = bars[i];
        if (k.t <= sig.dailyT) continue;
        sig.dailyT = k.t;
        if (Number.isFinite(ind.ema[i]) && k.c < ind.ema[i]) {
          const e = ruleExit(sig, k.c, Math.min(now, k.t + DAY));
          store.putSignal(sig);
          await announce(sig, M.trendExitText(sig, e), drawChart(item, data, null).png);
          break;
        }
      }
      store.putSignal(sig);
    }
  }

  async function announce(sig, text, png) {
    if (channelId()) {
      const opts = { replyTo: sig.channelMsgId };
      const sent = png && await Promise.resolve().then(() => api.sendPhoto(channelId(), png, text, opts))
        .catch((e) => { log.warn('[trend] عکسِ کانال:', e.message); return null; });
      if (!sent) await api.sendMessage(channelId(), text, opts).catch((e) => log.error('[trend] کانال:', e.message));
    }
    await notifyAdmins(`📈 <b>${M.esc(sig.pretty)}</b>\n${text}`, png);
  }

  // ───────────────────────────── هشدار و انتشار
  const buttons = (id) => [[{ text: '✅ انتشار در کانال', callback_data: `tok:${id}` }, { text: '❌ رد', callback_data: `tno:${id}` }]];

  async function sendAlert(item, data, ev, p) {
    const id = randomBytes(5).toString('hex');
    const caption = M.trendAdminAlert({ pretty: data.pretty, exchange: data.exchange, ev, emaPeriod: p.emaPeriod, ttlHours: p.alertTtlHours });
    const preview = M.trendChannelSignal({ pretty: data.pretty, entry: ev.close, stop: ev.stop, ema: ev.ema, emaPeriod: p.emaPeriod });
    const text = `${caption}\n\n<b>پیش‌نمایشِ پیامِ کانال:</b>\n\n${preview}`;
    const { png } = drawChart(item, data, { entry: ev.close, stop: ev.stop, entryBarT: ev.t, source: 'alert' });
    if (png) await photoToAdmins(png, `📈 <b>${M.esc(data.pretty)}</b> · چارتِ روزانه با EMA${p.emaPeriod} و ورود/خروج‌های گذشته‌ی همین قاعده`);
    const messages = await toAdmins(text, { buttons: buttons(id) });
    T().alerts[id] = {
      id, status: 'pending', createdAt: Date.now(), base: item.base, symbol: item.id, pretty: data.pretty,
      exchangeKey: data.exchangeKey, exSymbol: data.symbol, ev, text, messages,
    };
    // هشدارهای قدیمی‌تر از دو هفته دور ریخته می‌شوند
    for (const [k, a] of Object.entries(T().alerts)) if (a.createdAt < Date.now() - 14 * DAY) delete T().alerts[k];
    store.save();
    return id;
  }

  async function closeAlert(a, footer) {
    for (const m of a.messages || []) {
      await api.editText(m.chat, m.id, `${a.text}\n\n<b>${M.esc(footer)}</b>`).catch((e) => log.warn('[trend] ویرایش نشد:', e.message));
    }
  }

  /** چارتِ پیامِ کانال با قیمتِ لحظه‌ی انتشار؛ هر خطایی ← بی‌عکس منتشر می‌شود */
  async function publishChart(a, live) {
    const item = { id: a.symbol, base: a.base };
    try {
      const data = await fetchDailyFn(item, cfg);
      if (data.candles.at(-1).t !== a.ev.t) return null; // کندلِ دیگری بسته شده؛ چارت با پیام نمی‌خواند
      return drawChart(item, data, { entry: live, stop: a.ev.stop, entryBarT: a.ev.t, source: 'live' }).png;
    } catch (e) {
      log.warn('[trend] چارتِ انتشار:', e.message);
      return null;
    }
  }

  async function decide(cb, approve, id) {
    const a = T().alerts[id];
    if (!a) return api.answer(cb.id, 'این هشدار پیدا نشد.', true);
    if (a.status !== 'pending') return api.answer(cb.id, `این هشدار دیگر باز نیست (${a.status}).`, true);
    const who = cb.from.username ? `@${cb.from.username}` : cb.from.first_name;
    if (!approve) {
      a.status = 'rejected';
      store.save();
      await api.answer(cb.id, 'رد شد');
      return closeAlert(a, `❌ رد شد توسطِ ${who}`);
    }
    const p = trendParams(cfg);
    const ageH = (Date.now() - a.ev.closeT) / 3_600_000;
    if (ageH > p.alertTtlHours) return api.answer(cb.id, `${ageH.toFixed(0)} ساعت از کلوز گذشته؛ حداکثر ${p.alertTtlHours} است. این ورود دیگر منتشر نمی‌شود.`, true);
    if (!channelId()) return api.answer(cb.id, 'کانال تنظیم نشده. پنل ← ⚙️ تنظیمات ← 📢 کانال.', true);

    let live;
    try {
      live = (await fetchFrom(a.exchangeKey, a.exSymbol, '5m', 3)).at(-1)?.c;
    } catch (e) {
      log.warn('[trend] قیمتِ فعلی:', e.message);
    }
    if (!Number.isFinite(live)) return api.answer(cb.id, 'قیمتِ فعلی از صرافی نیامد. چند دقیقه بعد دوباره بزن.', true);
    const err = livePriceError(a.ev, live, p.maxDriftAtr);
    if (err) return api.answer(cb.id, err, true);
    if (a.status !== 'pending') return api.answer(cb.id, 'ادمینِ دیگری همین الان تصمیم گرفت.', true);

    a.status = 'publishing';
    store.save();
    await api.answer(cb.id, 'در حالِ انتشار…');
    try {
      const text = M.trendChannelSignal({ pretty: a.pretty, entry: live, stop: a.ev.stop, ema: a.ev.ema, emaPeriod: p.emaPeriod });
      const png = visible(text) <= CAPTION_MAX ? await publishChart(a, live) : null;
      // عکس نرفت ← همان متن بی‌عکس؛ چارت هیچ‌وقت جلوی انتشار را نمی‌گیرد
      const msg = (png && await Promise.resolve().then(() => api.sendPhoto(channelId(), png, text))
        .catch((e) => { log.warn('[trend] عکسِ کانال:', e.message); return null; }))
        || await api.sendMessage(channelId(), text);
      const now = Date.now();
      store.putSignal({
        id, kind: 'trend', symbol: a.symbol, pretty: a.pretty, exchangeKey: a.exchangeKey, exSymbol: a.exSymbol,
        direction: 'long', entry: live, sl: a.ev.stop, slNow: a.ev.stop, risk: live - a.ev.stop, tps: [], hits: 0, realized: 0,
        status: 'open', publishedAt: now, lastT: now, expiresAt: null, dailyT: a.ev.t, entryBarT: a.ev.t, emaPeriod: p.emaPeriod,
        channelMsgId: msg.message_id, events: [],
      });
      a.status = 'published';
      a.by = who;
      store.save();
      return closeAlert(a, `✅ منتشر شد توسطِ ${who} · ورود ${live} · ${utc(now)} UTC`);
    } catch (e) {
      a.status = 'pending';
      store.save();
      log.error('[trend] انتشار:', e.message);
      return api.sendMessage(cb.from.id, `❌ انتشار ناموفق بود: ${M.esc(e.description || e.message)}`).catch(() => {});
    }
  }

  /** وضعیت برای پنل */
  function view() {
    const st = T();
    return {
      mode: trendParams(cfg).mode,
      emaPeriod: trendParams(cfg).emaPeriod,
      last: st.last || null,
      open: Object.values(st.book),
      closed: st.closed,
      live: store.signals().filter((s) => s.kind === 'trend'),
      pending: Object.values(st.alerts).filter((a) => a.status === 'pending'),
    };
  }

  return { runDaily, decide, view, chart, isRunning: () => running };
}

/**
 * قیمتِ لحظه‌ی انتشار هنوز همان ورود است؟
 * @returns خطای فارسی یا null
 */
export function livePriceError(ev, live, maxDriftAtr) {
  const P = (v) => M.esc(String(+v.toPrecision(6)));
  if (live <= ev.stop) return `قیمتِ فعلی (${P(live)}) زیرِ حد ضرر است.`;
  if (live < ev.ema) return `قیمتِ فعلی (${P(live)}) دوباره زیرِ EMA (${P(ev.ema)}) است؛ ورود معتبر نیست.`;
  const drift = Math.abs(live - ev.close) / ev.atr;
  if (drift > maxDriftAtr) return `قیمتِ فعلی (${P(live)}) ${drift.toFixed(2)} ATR از کلوز (${P(ev.close)}) دور شده؛ حداکثر ${maxDriftAtr} است.`;
  return null;
}
