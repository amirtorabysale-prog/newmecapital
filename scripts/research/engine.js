/**
 * موتورِ شبیه‌سازیِ روزانه برای پژوهش: آماده‌سازیِ کندلِ روزانه، خانواده‌های
 * استراتژی، اجرای معامله‌به‌معامله با استاپ و خروج، و معیارِ خرید و نگهداری.
 * ورود با کلوزِ روزانه؛ استاپ روی high/low ِ روزهای بعد؛ استاپِ متحرک از روزِ بعد.
 */

import { aggregate } from '../../src/strategy/rsi3.js';
import { atr, ema, rsi } from '../../src/strategy/indicators.js';
import { netR, H1, DAY } from './lib.js';

export const COST = { feePct: 0.1, slippagePct: 0.05 };

export function prep(d) {
  const b = aggregate(d.candles, DAY);
  if (b.length && b[0].t < d.candles[0].t) b.shift();
  if (b.length && b.at(-1).t + DAY > d.candles.at(-1).t + H1) b.pop();
  const c = b.map((k) => k.c);
  const x = { id: d.id, b, c, startT: b[0].t + 210 * DAY, atr: atr(b, 14), rsi: rsi(c, 14), ema: {} };
  for (const n of [20, 50, 100, 200]) x.ema[n] = ema(c, n);
  x.ret30 = c.map((v, i) => (i >= 30 ? v / c[i - 30] - 1 : NaN));
  x.idx = new Map(b.map((k, i) => [k.t, i]));
  return x;
}

const hh = (b, i, n) => { let m = -Infinity; for (let j = i - n; j < i; j++) m = Math.max(m, b[j].h); return m; };
const ll = (b, i, n) => { let m = Infinity; for (let j = i - n; j < i; j++) m = Math.min(m, b[j].l); return m; };

/**
 * یک خانواده = { entry(x,i,p,ctx) → 'long'|'short'|null, stop0(x,i,dir,p), trail(x,i,pos,p) → استاپِ تازه یا null,
 *                exitNow(x,i,pos,p) → true برای خروج با کلوزِ همین روز, maxDays }
 */
export const FAMILIES = {
  A: {
    title: 'A. شکستِ دانچیان + استاپِ متحرکِ ATR',
    grid: [20, 55].flatMap((n) => [2, 3].flatMap((k) => [['long'], ['long', 'short']].map((dirs) => ({ n, k, dirs })))),
    label: (p) => `N=${p.n} · ${p.k}ATR · ${p.dirs.length > 1 ? 'دوطرفه' : 'فقط خرید'}`,
    entry: (x, i, p) => {
      if (i < p.n + 1 || !Number.isFinite(x.atr[i])) return null;
      if (x.c[i] > hh(x.b, i, p.n)) return 'long';
      if (p.dirs.includes('short') && x.c[i] < ll(x.b, i, p.n)) return 'short';
      return null;
    },
    stop0: (x, i, dir, p) => x.c[i] - (dir === 'long' ? 1 : -1) * p.k * x.atr[i],
    trail: (x, i, pos, p) => (pos.dir === 'long' ? pos.best - p.k * x.atr[i] : pos.best + p.k * x.atr[i]),
    exitNow: (x, i, pos, p) => (pos.dir === 'long' ? x.c[i] < ll(x.b, i, Math.round(p.n / 2)) : x.c[i] > hh(x.b, i, Math.round(p.n / 2))),
    maxDays: 365,
  },
  B: {
    title: 'B. برگشت به میانگینِ روزانه',
    grid: [25, 30].flatMap((L) => [false, true].map((trend) => ({ L, trend }))),
    label: (p) => `RSI≤${p.L} · فیلترِ EMA200 ${p.trend ? 'بله' : 'خیر'}`,
    entry: (x, i, p) => {
      if (!Number.isFinite(x.atr[i]) || x.rsi[i] > p.L) return null;
      if (p.trend && !(x.c[i] > x.ema[200][i])) return null;
      return 'long';
    },
    stop0: (x, i) => x.c[i] - 2.5 * x.atr[i],
    trail: () => null,
    exitNow: (x, i) => x.rsi[i] >= 50,
    maxDays: 10,
  },
  C: {
    title: 'C. رژیم: بالای EMA بمان',
    grid: [50, 100, 200].map((n) => ({ n })),
    label: (p) => `EMA${p.n}`,
    entry: (x, i, p) => (Number.isFinite(x.ema[p.n][i]) && x.c[i] > x.ema[p.n][i] && x.c[i - 1] <= x.ema[p.n][i - 1] ? 'long' : null),
    stop0: (x, i) => x.c[i] - 3 * x.atr[i], // فقط استاپِ فاجعه؛ خروجِ اصلی زیرِ EMA است
    trail: () => null,
    exitNow: (x, i, pos, p) => x.c[i] < x.ema[p.n][i],
    maxDays: 3650,
  },
  D: {
    title: 'D. مومنتومِ مقطعی (هفتگی)',
    grid: [1, 3].flatMap((top) => [false, true].map((abs) => ({ top, abs }))),
    label: (p) => `${p.top} نمادِ قوی‌تر · مومنتومِ مثبت لازم ${p.abs ? 'بله' : 'خیر'}`,
    // رتبه‌بندی در ctx از پیش انجام می‌شود (فقط دوشنبه‌ها)
    entry: (x, i, p, ctx) => {
      const t = x.b[i].t;
      if (new Date(t + DAY).getUTCDay() !== 1) return null; // کلوزِ یکشنبه = شروعِ دوشنبه
      const rank = ctx.rank.get(t)?.get(x.id);
      if (rank === undefined || rank >= p.top) return null;
      if (p.abs && !(x.ret30[i] > 0)) return null;
      return 'long';
    },
    stop0: (x, i) => x.c[i] - 3 * x.atr[i],
    trail: () => null,
    exitNow: () => false,
    maxDays: 7,
  },
};

export function crossRank(xs) {
  const byT = new Map();
  for (const x of xs) {
    x.b.forEach((k, i) => {
      if (!Number.isFinite(x.ret30[i]) || k.t < x.startT) return;
      if (!byT.has(k.t)) byT.set(k.t, []);
      byT.get(k.t).push([x.id, x.ret30[i]]);
    });
  }
  const rank = new Map();
  for (const [t, arr] of byT) {
    arr.sort((a, b) => b[1] - a[1]);
    rank.set(t, new Map(arr.map(([id], r) => [id, r])));
  }
  return { rank };
}

export function runSymbol(x, fam, p, ctx, from, to, cost = COST) {
  const trades = [];
  let pos = null;
  for (let i = 1; i < x.b.length; i++) {
    const k = x.b[i];
    if (pos) {
      const long = pos.dir === 'long';
      const s = long ? 1 : -1;
      let exitPx = null;
      if (long ? k.l <= pos.stop : k.h >= pos.stop) exitPx = long ? Math.min(pos.stop, k.o) : Math.max(pos.stop, k.o);
      else {
        // سیوِ سودِ اختیاری: سهمی از حجم در atR × ریسک، و استاپ به نقطه‌ی ورود
        const P = fam.partial?.(p);
        if (P && !pos.partialDone) {
          const target = pos.entry + s * P.atR * pos.risk;
          if (long ? k.h >= target : k.l <= target) {
            pos.fills.push({ px: target, w: P.w });
            pos.left -= P.w;
            pos.partialDone = true;
            if (P.be) pos.stop = long ? Math.max(pos.stop, pos.entry) : Math.min(pos.stop, pos.entry);
          }
        }
        if (fam.exitNow(x, i, pos, p) || i - pos.i >= fam.maxDays || i === x.b.length - 1) exitPx = k.c;
      }
      if (exitPx !== null) {
        const fills = [...pos.fills, { px: exitPx, w: pos.left }];
        const { r, gross } = netR(pos.dir, pos.entry, pos.risk, fills, cost);
        trades.push({ id: x.id, dir: pos.dir, t: pos.t, exitT: k.t + DAY, entry: pos.entry, risk: pos.risk, r, gross, days: i - pos.i });
        pos = null;
      } else {
        pos.best = long ? Math.max(pos.best, k.c) : Math.min(pos.best, k.c);
        const tr = fam.trail(x, i, pos, p);
        if (tr !== null) pos.stop = long ? Math.max(pos.stop, tr) : Math.min(pos.stop, tr);
        continue;
      }
    }
    const t = k.t + DAY;
    if (k.t < Math.max(from, x.startT) || k.t >= to) continue;
    const dir = fam.entry(x, i, p, ctx);
    if (!dir) continue;
    const entry = k.c;
    const stop = fam.stop0(x, i, dir, p);
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) continue;
    pos = { dir, i, t, entry, stop, risk, best: entry, fills: [], left: 1, partialDone: false };
  }
  return trades;
}

export function run(fam, p, xs, ctx, from, to, cost = COST) {
  return xs.flatMap((x) => runSymbol(x, fam, p, ctx, from, to, cost));
}

/** خرید و نگهداری با وزنِ برابر — معیارِ مقایسه (بازده‌ی سالانه و افتِ حداکثر، ٪) */
export function buyHold(xs, from, to) {
  const days = new Map();
  for (const x of xs) {
    for (let i = 1; i < x.b.length; i++) {
      const t = x.b[i].t;
      if (t < Math.max(from, x.startT) || t >= to) continue;
      if (!days.has(t)) days.set(t, []);
      days.get(t).push(x.c[i] / x.c[i - 1] - 1);
    }
  }
  const ts = [...days.keys()].sort((a, b) => a - b);
  let eq = 1; let peak = 1; let dd = 0;
  const rets = [];
  for (const t of ts) {
    const v = days.get(t);
    const r = v.reduce((a, b) => a + b, 0) / v.length;
    rets.push(r);
    eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  const yrs = ts.length / 365;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
  return { annualPct: (eq ** (1 / yrs) - 1) * 100, maxDDPct: dd * 100, sharpe: (m / sd) * Math.sqrt(365) };
}
