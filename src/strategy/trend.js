/**
 * روند‌گیریِ روزانه — «بالای EMA50 بمان». تنها استراتژی‌ای که در پژوهش روی
 * واچ‌لیست، سالِ آخر و ۲۰ نمادِ دیگر مثبت ماند (docs/research/).
 *
 *   ورود:  کلوزِ روزانه از زیر به بالای EMA، و کلوزِ روزِ بعد هم بالای EMA (کندلِ تأیید)
 *          — confirmBars=1؛ با 0 همان ورود روی کندلِ تقاطع (نسخه‌ی پژوهشِ اول)
 *   خروج:  اولین کلوزِ روزانه زیرِ EMA
 *   استاپِ فاجعه: ورود − ۳ × ATR(14) ِ روزانه، ثابت؛ روی low ِ روزهای بعد،
 *          پر شدن با min(استاپ, open) — گپِ رو به پایین بدتر از استاپ پر می‌شود.
 *
 * قواعد دقیقاً همان scripts/research/engine.js (خانواده‌ی C) است و
 * test/trend.test.js این برابری را روی یک سریِ طولانی می‌سنجد. هر تغییری
 * این‌جا یعنی استراتژیِ دیگری که آزموده نشده.
 *
 * ⚠️ «روز» یعنی روزِ UTC. کندلِ روزانه‌ی LBank و Bitget ساعتِ ۱۶:۰۰ UTC
 * بسته می‌شود (روزِ UTC+8) — آن سری‌ها با utcAligned رد می‌شوند.
 */

import { atr, ema } from './indicators.js';

export const DAY = 86_400_000;

export const TREND_DEFAULTS = {
  emaPeriod: 50,
  stopAtr: 3,
  atrPeriod: 14,
  // پژوهش ۲۱۰ روز گرم شدن داشت؛ EMA50 بعد از آن عملاً همگرا است
  minBars: 211,
  // ورود یک کلوز بعد از تقاطع، اگر آن کلوز هم بالای EMA بماند (docs/research/04-trend-robust.md:
  // «ورود یک روز دیرتر» در داخل، خارج و جهان امیدِ بالاتری داشت)
  confirmBars: 1,
  feePct: 0.1,
  slippagePct: 0.05,
};

/** همه‌ی کندل‌ها روی مرزِ روزِ UTC باز شده‌اند؟ */
export const utcAligned = (bars) => bars.length > 0 && bars.every((k) => k.t % DAY === 0);

/** EMA و ATR برای کلِ سری — یک بار، نه برای هر کندل */
export function indicators(bars, p = TREND_DEFAULTS) {
  return { ema: ema(bars.map((k) => k.c), p.emaPeriod), atr: atr(bars, p.atrPeriod) };
}

/**
 * وضعیتِ کندلِ i (پیش‌فرض: آخرین کندلِ بسته).
 * @returns {{ ok: false, reason } | { ok: true, t, closeT, close, ema, atr, above, crossUp, crossDown, entry, stop, distPct }}
 *   entry: سیگنالِ ورود روی همین کلوز — crossUp، یا با confirmBars=1 تقاطعِ دیروز + کلوزِ امروز بالای EMA
 */
export function evaluate(bars, p = TREND_DEFAULTS, ind = indicators(bars, p), i = bars.length - 1) {
  if (i + 1 < p.minBars) return { ok: false, reason: `فقط ${i + 1} کندلِ روزانه (حداقل ${p.minBars})` };
  const c = bars[i].c;
  const e = ind.ema[i];
  const a = ind.atr[i];
  if (!Number.isFinite(e) || !Number.isFinite(a) || !(a > 0)) return { ok: false, reason: 'اندیکاتور هنوز آماده نیست' };
  const cPrev = bars[i - 1].c;
  const ePrev = ind.ema[i - 1];
  const stop = c - p.stopAtr * a;
  const cross = (j) => bars[j].c > ind.ema[j] && bars[j - 1].c <= ind.ema[j - 1];
  const entry = (p.confirmBars ?? 0) > 0
    ? c > e && i >= 2 && Number.isFinite(ind.ema[i - 2]) && cross(i - 1)
    : c > e && cPrev <= ePrev;
  return {
    ok: true,
    t: bars[i].t,
    closeT: bars[i].t + DAY,
    close: c,
    ema: e,
    atr: a,
    above: c > e,
    crossUp: c > e && cPrev <= ePrev,
    crossDown: c < e && cPrev >= ePrev,
    entry,
    stop,
    stopPct: ((c - stop) / c) * 100,
    distPct: (c / e - 1) * 100,
  };
}

/** پوزیشنِ تازه از یک ورود (قیمتِ ورود ممکن است قیمتِ لحظه‌ی انتشار باشد، نه کلوز) */
export function openPosition(ev, { entry = ev.close } = {}) {
  return { entry, stop: ev.stop, risk: entry - ev.stop, entryBarT: ev.t, lastT: ev.t, status: 'open' };
}

/**
 * کندل‌های روزانه‌ی بعد از pos.lastT را روی پوزیشن اعمال می‌کند.
 * @returns خروج { reason: 'stop' | 'ema', price, t (زمانِ بسته شدن), barT } یا null
 */
export function advance(pos, bars, p = TREND_DEFAULTS, ind = indicators(bars, p)) {
  if (pos.status !== 'open') return null;
  for (let i = 1; i < bars.length; i++) {
    const k = bars[i];
    if (k.t <= pos.lastT) continue;
    pos.lastT = k.t;
    if (k.l <= pos.stop) return { reason: 'stop', price: Math.min(pos.stop, k.o), t: k.t + DAY, barT: k.t };
    if (Number.isFinite(ind.ema[i]) && k.c < ind.ema[i]) return { reason: 'ema', price: k.c, t: k.t + DAY, barT: k.t };
  }
  return null;
}

/**
 * R ِ خالص با کارمزد و لغزش در هر دو طرف — همان فرمولِ پژوهش (scripts/research/lib.js).
 */
export function netR(entry, exit, risk, { feePct = 0.1, slippagePct = 0.05 } = {}) {
  const slip = slippagePct / 100;
  const fee = feePct / 100;
  const e = entry * (1 + slip);
  const x = exit * (1 - slip);
  return (x - e - fee * e - fee * x) / risk;
}

export function closePosition(pos, exit, p = TREND_DEFAULTS) {
  pos.status = 'closed';
  pos.exit = exit.price;
  pos.exitReason = exit.reason;
  pos.closedAt = exit.t;
  pos.grossR = (exit.price - pos.entry) / pos.risk;
  pos.r = netR(pos.entry, exit.price, pos.risk, p);
  return pos;
}

/**
 * کلِ سری را مثلِ موتورِ پژوهش اجرا می‌کند — برای آزمونِ برابری و بک‌تست.
 * @returns معامله‌ها: { entry, exit, risk, r, entryBarT, exitBarT, exitReason } — آخری با exitReason 'end' یعنی هنوز باز
 */
export function replay(bars, p = TREND_DEFAULTS) {
  const ind = indicators(bars, p);
  const out = [];
  let pos = null;
  for (let i = 1; i < bars.length; i++) {
    if (pos) {
      const exit = advance(pos, bars.slice(0, i + 1), p, { ema: ind.ema.slice(0, i + 1), atr: ind.atr });
      if (exit) {
        closePosition(pos, exit, p);
        out.push({ ...pos, exitBarT: exit.barT });
        pos = null;
      } else continue;
    }
    const ev = evaluate(bars, p, ind, i);
    if (ev.ok && ev.entry && ev.close - ev.stop > 0) pos = openPosition(ev);
  }
  if (pos) {
    // مثلِ موتور: آخرِ داده با کلوزِ آخر بسته می‌شود
    const k = bars.at(-1);
    closePosition(pos, { reason: 'end', price: k.c, t: k.t + DAY }, p);
    out.push({ ...pos, exitBarT: k.t });
  }
  return out;
}

/** آمارِ یک دفتر — وین‌ریت، جمع و میانگینِ R، PF */
export function bookStats(closed) {
  const n = closed.length;
  const wins = closed.filter((x) => x.r > 0);
  const sumW = wins.reduce((s, x) => s + x.r, 0);
  const sumL = -closed.filter((x) => x.r <= 0).reduce((s, x) => s + x.r, 0);
  return {
    n,
    wins: wins.length,
    winRate: n ? wins.length / n : null,
    totalR: sumW - sumL,
    avgR: n ? (sumW - sumL) / n : null,
    pf: sumL > 0 ? sumW / sumL : null,
  };
}
