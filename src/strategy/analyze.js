/**
 * استراتژی — در تایم‌فریمِ یک ساعته، هم‌زمانیِ چهار شرط:
 *
 *   ۱. خطِ روندِ صعودی با دو برخوردِ ماژور، و قیمتِ فعلی روی آن (برخوردِ سوم)
 *   ۲. هم‌پوشانیِ خط با سطحِ ۰.۶۱۸ فیبوناچیِ آخرین موجِ صعودی
 *   ۳. واگراییِ RSI (معمولی یا مخفی) روی همین کف
 *   ۴. الگوی کندلیِ برگشتی روی همین کف
 *
 * هر شرط امتیاز دارد (وزن‌ها در config). شرطِ ۱ پایه است: بدونِ خط، بقیه
 * معنایی ندارند و امتیاز صفر است. «نزدیک به ستاپ» یعنی امتیاز از آستانه
 * گذشته ولی یکی از چهار شرط کامل نیست — ادمین تصمیم می‌گیرد.
 *
 * فروش (short) با قرینه کردنِ قیمت‌ها اجرا می‌شود: همان کد، روی −قیمت.
 * خطِ روندِ صعودیِ قرینه همان خطِ روندِ نزولی است، کف همان سقف، و RSI
 * همان 100 − RSI. این‌طوری منطقِ خرید و فروش هرگز از هم جدا نمی‌افتند.
 */

import { atr, rsi } from './indicators.js';
import { findTrendline, lineAt } from './trendline.js';
import { findDivergence } from './divergence.js';
import { findReversal } from './patterns.js';

export function mirrorCandles(candles) {
  return candles.map((k) => ({ t: k.t, o: -k.o, h: -k.l, l: -k.h, c: -k.c, v: k.v }));
}

export function analyze(candles, cfg, direction = 'long') {
  const src = direction === 'short' ? mirrorCandles(candles) : candles;
  const res = analyzeLong(src, cfg);
  if (!res) return null;
  res.direction = direction;
  return direction === 'short' ? unmirror(res) : res;
}

function analyzeLong(candles, cfg) {
  const s = cfg.strategy;
  const W = s.weights;
  const last = candles.length - 1;
  const atrs = atr(candles, s.atrPeriod);
  const A = atrs[last];
  const r = rsi(candles.map((k) => k.c), s.rsiPeriod);

  const line = findTrendline(candles, A, s.trendline);
  if (!line) return null;

  const k = line.touchIdx;
  const touching = line.state === 'touch';
  const components = {};

  components.trendline = {
    points: touching ? W.trendline : W.trendline * 0.5,
    max: W.trendline,
    ok: touching,
  };

  // ── فیبوناچی: از کفِ موج (پس از برخوردِ دوم) تا سقفِ موج
  let lowIdx = line.b;
  for (let i = line.b; i <= line.highIdx; i++) if (candles[i].l < candles[lowIdx].l) lowIdx = i;
  const start = candles[lowIdx].l;
  const end = candles[line.highIdx].h;
  const fibPrice = end - s.fib.level * (end - start);
  const fibDist = Math.abs(fibPrice - lineAt(line, k)) / A;
  const fibOk = fibDist <= s.fib.toleranceAtr;
  const fibNear = !fibOk && fibDist <= s.fib.nearToleranceAtr;
  components.fib = {
    points: fibOk ? W.fib : fibNear ? W.fib * 0.5 : 0,
    max: W.fib,
    ok: fibOk,
    near: fibNear,
  };
  const fib = {
    lowIdx, highIdx: line.highIdx, start, end,
    level: s.fib.level, price: fibPrice, distAtr: fibDist,
    retrace: (end - candles[k].l) / (end - start),
  };

  // ── واگرایی
  const div = findDivergence(candles, r, k, s.divergence);
  components.divergence = { points: div ? W.divergence : 0, max: W.divergence, ok: !!div };

  // ── الگوی کندلی: فقط وقتی معنا دارد که قیمت واقعاً روی خط است
  const candle = touching ? findReversal(candles, A, s.candles.window) : null;
  components.candle = {
    points: candle ? W.candle * candle.strength : 0,
    max: W.candle,
    ok: !!candle,
  };

  const score = Math.round(Object.values(components).reduce((t, c) => t + c.points, 0));
  const maxScore = Object.values(W).reduce((t, v) => t + v, 0);

  return {
    score,
    maxScore,
    complete: Object.values(components).every((c) => c.ok),
    lastIdx: last,
    atr: A,
    close: candles[last].c,
    components,
    line: {
      a: line.a, b: line.b, p0: line.p0, slope: line.slope,
      touches: line.touches, touchIdx: k, distAtr: line.distAtr, state: line.state,
    },
    fib,
    div,
    candle,
    plan: touching ? buildPlan(candles, line, fib, A, s.plan) : null,
  };
}

function buildPlan(candles, line, fib, A, p) {
  const last = candles.length - 1;
  const entry = candles[last].c;
  let lo = Infinity;
  for (let i = line.touchIdx; i <= last; i++) lo = Math.min(lo, candles[i].l);
  const sl = Math.min(lo, lineAt(line, last)) - p.slBufferAtr * A;
  const risk = entry - sl;
  const leg = fib.end - fib.start;
  const labels = ['TP1', 'TP2', 'TP3'];
  const tps = p.tpExtensions.map((e, i) => {
    const price = fib.end + e * leg;
    return { label: labels[i] || `TP${i + 1}`, ext: 1 + e, price, rr: (price - entry) / risk };
  }).filter((t) => t.price > entry);
  return {
    entry,
    sl,
    risk,
    riskPct: (risk / entry) * 100,
    tps,
    invalidation: lineAt(line, last),
    rrWarning: !tps.length || tps[0].rr < p.minRR,
  };
}

function unmirror(res) {
  const neg = (v) => -v;
  res.close = neg(res.close);
  res.line.p0 = neg(res.line.p0);
  res.line.slope = neg(res.line.slope);
  res.fib.start = neg(res.fib.start);
  res.fib.end = neg(res.fib.end);
  res.fib.price = neg(res.fib.price);
  if (res.div) {
    res.div.priceP = neg(res.div.priceP);
    res.div.priceK = neg(res.div.priceK);
    res.div.rsiP = 100 - res.div.rsiP;
    res.div.rsiK = 100 - res.div.rsiK;
  }
  if (res.candle) {
    res.candle.name = res.candle.bearName;
    res.candle.fa = res.candle.faBear;
  }
  if (res.plan) {
    res.plan.entry = neg(res.plan.entry);
    res.plan.sl = neg(res.plan.sl);
    res.plan.invalidation = neg(res.plan.invalidation);
    res.plan.riskPct = (res.plan.risk / res.plan.entry) * 100;
    for (const t of res.plan.tps) t.price = neg(t.price);
  }
  return res;
}

export { lineAt };
