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
import { DAY, TREND_DEFAULTS, utcAligned, indicators, evaluate, openPosition, advance, closePosition } from './strategy/trend.js';
import { ruleExit } from './tracker.js';
import { store } from './store.js';
import * as M from './messages.js';
import { utc } from './format.js';

export const TREND_MODES = ['off', 'paper', 'live'];
/** ورود روی کلوزی که بیش از این کهنه است گرفته نمی‌شود */
const STALE_MS = 36 * 3_600_000;
const CLOSED_KEEP = 1000;

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
        await paperExit(item, bars, ind, p);
        await liveExits(item, bars, ind, p, now);
        if (!ev.ok) continue;
        const st = T();
        if ((st.seen[item.base] ?? -Infinity) >= ev.t) continue;
        st.seen[item.base] = ev.t;
        store.save();
        if (!ev.crossUp || now - ev.closeT > STALE_MS) continue;
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
    await toAdmins(M.trendPaperEntry(pos, p.emaPeriod));
  }

  async function paperExit(item, bars, ind, p) {
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
    await toAdmins(M.trendPaperExit(pos));
  }

  /**
   * سیگنال‌های منتشرشده: خروج با کلوزِ زیرِ EMA. حد ضرر مالِ tracker است
   * (کندلِ ۵ دقیقه، از لحظه‌ی انتشار) و bot.js پیش از این دور tracker را
   * اجرا می‌کند، تا سیگنالی که استاپش خورده این‌جا دیگر باز نباشد.
   */
  async function liveExits(item, bars, ind, p, now) {
    for (const sig of store.signals()) {
      if (sig.kind !== 'trend' || sig.status !== 'open' || sig.symbol !== item.id) continue;
      for (let i = 1; i < bars.length; i++) {
        const k = bars[i];
        if (k.t <= sig.dailyT) continue;
        sig.dailyT = k.t;
        if (Number.isFinite(ind.ema[i]) && k.c < ind.ema[i]) {
          const e = ruleExit(sig, k.c, Math.min(now, k.t + DAY));
          await announce(sig, M.trendExitText(sig, e));
          break;
        }
      }
      store.putSignal(sig);
    }
  }

  async function announce(sig, text) {
    if (channelId()) {
      await api.sendMessage(channelId(), text, { replyTo: sig.channelMsgId }).catch((e) => log.error('[trend] کانال:', e.message));
    }
    await toAdmins(`📈 <b>${M.esc(sig.pretty)}</b>\n${text}`);
  }

  // ───────────────────────────── هشدار و انتشار
  const buttons = (id) => [[{ text: '✅ انتشار در کانال', callback_data: `tok:${id}` }, { text: '❌ رد', callback_data: `tno:${id}` }]];

  async function sendAlert(item, data, ev, p) {
    const id = randomBytes(5).toString('hex');
    const caption = M.trendAdminAlert({ pretty: data.pretty, exchange: data.exchange, ev, emaPeriod: p.emaPeriod, ttlHours: p.alertTtlHours });
    const preview = M.trendChannelSignal({ pretty: data.pretty, entry: ev.close, stop: ev.stop, ema: ev.ema, emaPeriod: p.emaPeriod });
    const text = `${caption}\n\n<b>پیش‌نمایشِ پیامِ کانال:</b>\n\n${preview}`;
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
      const msg = await api.sendMessage(channelId(), text);
      const now = Date.now();
      store.putSignal({
        id, kind: 'trend', symbol: a.symbol, pretty: a.pretty, exchangeKey: a.exchangeKey, exSymbol: a.exSymbol,
        direction: 'long', entry: live, sl: a.ev.stop, slNow: a.ev.stop, risk: live - a.ev.stop, tps: [], hits: 0, realized: 0,
        status: 'open', publishedAt: now, lastT: now, expiresAt: null, dailyT: a.ev.t, emaPeriod: p.emaPeriod,
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

  return { runDaily, decide, view, isRunning: () => running };
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
