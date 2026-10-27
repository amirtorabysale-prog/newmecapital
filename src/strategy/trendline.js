/**
 * خط روندِ صعودی با دو برخوردِ «ماژور».
 *
 * برخوردِ ماژور یعنی دو چیز با هم:
 *  ۱. کفِ چرخشیِ قوی: پایین‌ترین low در `pivotStrength` کندلِ دو طرف.
 *  ۲. واکنشِ واقعی: بعد از آن کف، قیمت دست‌کم `minBounceAtr` برابرِ ATR از
 *     خط فاصله گرفته. کفی که بعدش قیمت فقط کنارِ خط لرزیده، نویز است نه
 *     برخورد.
 *
 * خط معتبر است اگر از اولین برخورد تا کندلِ آخر هیچ کندلی زیرِ آن بسته نشده
 * باشد (با تحملِ `breakToleranceAtr`) و هیچ سایه‌ای بیش از `maxWickPierceAtr`
 * از آن عبور نکرده باشد.
 *
 * «برخوردِ سوم» — همان جایی که سیگنال می‌خواهیم — کمترین low در
 * `touchWindow` کندلِ آخر است. وضعیت:
 *   touch    : فاصله تا خط ≤ touchToleranceAtr
 *   approach : فاصله ≤ approachAtr — قیمت دارد نزدیک می‌شود
 */

import { pivotLows } from './indicators.js';

export function lineAt(line, i) {
  return line.p0 + line.slope * (i - line.a);
}

export function findTrendline(candles, atrNow, cfg) {
  const n = candles.length;
  const last = n - 1;
  const A = atrNow;
  if (!(A > 0) || n < cfg.minSpacing * 3) return null;

  const start = Math.max(0, n - cfg.lookback);
  const piv = pivotLows(candles, cfg.pivotStrength).filter((i) => i >= start);

  // برخوردِ فعلی: کمترین low در چند کندلِ آخر
  let k = last;
  for (let i = last - cfg.touchWindow + 1; i <= last; i++) if (candles[i].l < candles[k].l) k = i;

  let best = null;
  for (let ia = 0; ia < piv.length; ia++) {
    for (let ib = ia + 1; ib < piv.length; ib++) {
      const a = piv[ia];
      const b = piv[ib];
      if (b - a < cfg.minSpacing || k - b < cfg.minSpacing) continue;
      if (candles[b].l <= candles[a].l) continue;

      const line = { a, b, p0: candles[a].l, slope: (candles[b].l - candles[a].l) / (b - a) };
      const cand = evaluate(candles, line, k, A, piv, cfg);
      if (cand && better(cand, best)) best = cand;
    }
  }
  return best;
}

function evaluate(candles, line, k, A, piv, cfg) {
  const last = candles.length - 1;
  const { a, b } = line;

  // واکنشِ بعد از هر برخورد
  const bounceA = maxAbove(candles, line, a + 1, b - 1);
  if (bounceA.dist < cfg.minBounceAtr * A) return null;
  const bounceB = maxAbove(candles, line, b + 1, k - 1);
  if (bounceB.dist < cfg.minBounceAtr * A) return null;

  // اعتبار: نه بسته شدن زیرِ خط، نه سایه‌ی عمیق
  for (let i = a + 1; i <= last; i++) {
    const y = lineAt(line, i);
    if (candles[i].c < y - cfg.breakToleranceAtr * A) return null;
    if (candles[i].l < y - cfg.maxWickPierceAtr * A) return null;
  }

  const distAtr = (candles[k].l - lineAt(line, k)) / A;
  let state = null;
  if (distAtr <= cfg.touchToleranceAtr) state = 'touch';
  else if (distAtr <= cfg.approachAtr) state = 'approach';
  if (!state) return null;

  // برخوردهای اضافه (غیر از a و b) — خط را معتبرتر می‌کنند
  const extra = piv.filter((p) => p > a && p < k && p !== b
    && Math.abs(candles[p].l - lineAt(line, p)) <= 0.3 * A);

  return {
    ...line,
    touches: [a, ...extra.filter((p) => p < b), b, ...extra.filter((p) => p > b)],
    touchIdx: k,
    distAtr,
    state,
    highIdx: bounceB.idx,
  };
}

function maxAbove(candles, line, from, to) {
  let dist = -Infinity;
  let idx = -1;
  for (let i = from; i <= to; i++) {
    const d = candles[i].h - lineAt(line, i);
    if (d > dist) { dist = d; idx = i; }
  }
  return { dist, idx };
}

function better(x, y) {
  if (!y) return true;
  if (x.state !== y.state) return x.state === 'touch';
  if (x.touches.length !== y.touches.length) return x.touches.length > y.touches.length;
  const dx = Math.abs(x.distAtr);
  const dy = Math.abs(y.distAtr);
  if (Math.abs(dx - dy) > 0.05) return dx < dy;
  return x.b > y.b;
}
