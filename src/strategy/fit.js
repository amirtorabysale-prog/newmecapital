/**
 * «خطِ استاد ← تنظیماتِ بات»: استاد دو کف را روی چارت می‌زند؛ این‌جا
 * نزدیک‌ترین تنظیماتی پیدا می‌شود که با آن findTrendline همان خط را انتخاب کند.
 *
 * دو مرحله:
 *  ۱. شرط‌های لازم مستقیم از خودِ کندل‌ها حساب می‌شوند — قدرتِ کف، فاصله‌ی دو
 *     برخورد، واکنش، بازه، شکست و سایه. هر کدام که با تنظیمِ فعلی نمی‌خواند،
 *     کمترین تغییرِ لازم را می‌گیرد.
 *  ۲. اگر با آن هنوز خطِ دیگری «بهتر» است (مثلاً به قیمت نزدیک‌تر)، روی یک
 *     شبکه‌ی کوچک سخت‌گیرتر می‌شویم (کفِ قوی‌تر، واکنشِ بیشتر، فاصله‌ی بیشتر)
 *     و تنظیمی که کمترین فاصله را با فعلی دارد برمی‌گردد.
 *
 * هم در مرورگر (Mini App) اجرا می‌شود هم در Node؛ هیچ import ِ Node ای ندارد.
 * فروش: کندل‌ها را بیرون قرینه کن (mirrorCandles) و همین را صدا بزن.
 */

import { atr } from './indicators.js';
import { findTrendline, lineAt } from './trendline.js';
import { paramByPath } from './params.js';

const P = 'strategy.trendline.';

/** کفِ نزدیکِ کلیکِ استاد: پایین‌ترین low در ±radius کندل */
export function snapLow(candles, i, radius = 3) {
  let best = Math.max(0, Math.min(candles.length - 1, i));
  for (let j = Math.max(0, i - radius); j <= Math.min(candles.length - 1, i + radius); j++) {
    if (candles[j].l < candles[best].l) best = j;
  }
  return best;
}

/** بزرگ‌ترین s که i با آن هنوز کفِ چرخشی است — همان تعریفِ pivotLows */
function pivotStrengthAt(candles, i, cap = 20) {
  const v = candles[i].l;
  let s = 0;
  while (s < cap) {
    const n = s + 1;
    if (i - n < 0 || i + n > candles.length - 1) break;
    if (candles[i - n].l <= v || candles[i + n].l < v) break;
    s = n;
  }
  return s;
}

const stepOf = (path) => paramByPath(path)?.step || 1;
const floorTo = (v, path) => { const s = stepOf(path); return Number((Math.floor(v / s + 1e-9) * s).toFixed(4)); };
const ceilTo = (v, path) => { const s = stepOf(path); return Number((Math.ceil(v / s - 1e-9) * s).toFixed(4)); };

/**
 * @returns {{ ok: boolean, a: number, b: number, reasons: string[],
 *            changes: {path: string, from: any, to: any}[], line: object|null, rival: object|null }}
 */
export function fitLine(candles, strategy, a, b) {
  if (a > b) [a, b] = [b, a];
  const T = strategy.trendline;
  const n = candles.length;
  const last = n - 1;
  const A = atr(candles, strategy.atrPeriod)[last];
  const reasons = [];
  const out = { ok: false, a, b, reasons, changes: [], line: null, rival: null };

  if (candles[b].l <= candles[a].l) {
    reasons.push('کفِ دوم پایین‌تر از کفِ اول است؛ خطِ روندِ صعودی نیست.');
    return out;
  }
  let k = last;
  for (let i = last - T.touchWindow + 1; i <= last; i++) if (candles[i].l < candles[k].l) k = i;
  const line = { a, b, p0: candles[a].l, slope: (candles[b].l - candles[a].l) / (b - a) };

  // ── ۱. حدودی که خودِ کندل‌ها تعیین می‌کنند
  const need = {};
  const maxS = Math.min(pivotStrengthAt(candles, a), pivotStrengthAt(candles, b));
  need.pivotMax = maxS;
  need.spacingMax = Math.min(b - a, k - b);
  const bounce = (from, to) => {
    let d = -Infinity;
    for (let i = from; i <= to; i++) d = Math.max(d, candles[i].h - lineAt(line, i));
    return d / A;
  };
  need.bounceMax = Math.min(bounce(a + 1, b - 1), bounce(b + 1, k - 1));
  need.lookbackMin = n - a;
  let closeBelow = 0;
  let wickBelow = 0;
  for (let i = a + 1; i <= last; i++) {
    const y = lineAt(line, i);
    closeBelow = Math.max(closeBelow, (y - candles[i].c) / A);
    wickBelow = Math.max(wickBelow, (y - candles[i].l) / A);
  }

  const lim = (path) => paramByPath(path);
  const cur = (key) => T[key];
  const want = {
    pivotStrength: Math.min(cur('pivotStrength'), maxS),
    minSpacing: Math.min(cur('minSpacing'), need.spacingMax),
    minBounceAtr: Math.min(cur('minBounceAtr'), floorTo(need.bounceMax, `${P}minBounceAtr`)),
    lookback: Math.max(cur('lookback'), ceilTo(need.lookbackMin, `${P}lookback`)),
    breakToleranceAtr: Math.max(cur('breakToleranceAtr'), ceilTo(closeBelow, `${P}breakToleranceAtr`)),
    maxWickPierceAtr: Math.max(cur('maxWickPierceAtr'), ceilTo(wickBelow, `${P}maxWickPierceAtr`)),
  };

  // چیزهایی که هیچ تنظیمی درستشان نمی‌کند
  if (maxS < lim(`${P}pivotStrength`).min) reasons.push(`نقطه‌ی ${maxS === pivotStrengthAt(candles, a) ? 'اول' : 'دوم'} کفِ چرخشی نیست (کندلِ پایین‌ترِ کناری دارد).`);
  if (need.spacingMax < lim(`${P}minSpacing`).min) {
    reasons.push(k - b < b - a ? `کفِ دوم خیلی نزدیک به کندلِ آخر است (${k - b} کندل).` : `دو کف خیلی نزدیک‌اند (${b - a} کندل).`);
  }
  if (need.bounceMax < lim(`${P}minBounceAtr`).min) reasons.push(`بعد از یکی از کف‌ها قیمت فقط ${need.bounceMax.toFixed(2)} ATR از خط دور شده؛ برخوردِ ماژور حساب نمی‌شود.`);
  if (want.lookback > lim(`${P}lookback`).max) reasons.push(`کفِ اول خیلی قدیمی است (${need.lookbackMin} کندل پیش؛ بیشینه ${lim(`${P}lookback`).max}).`);
  if (want.breakToleranceAtr > lim(`${P}breakToleranceAtr`).max) reasons.push(`کندلی ${closeBelow.toFixed(2)} ATR زیرِ خط بسته شده؛ خط شکسته است.`);
  if (want.maxWickPierceAtr > lim(`${P}maxWickPierceAtr`).max) reasons.push(`سایه‌ای ${wickBelow.toFixed(2)} ATR از خط رد شده.`);
  if (reasons.length) return out;

  // ── ۲. اجرای واقعی؛ اگر خطِ دیگری جلو افتاد، سخت‌گیرتر
  // «همان خط» یعنی از هر دو کفِ استاد رد شود (با همان تحملِ برخوردهای اضافه)،
  // نه لزوماً با همان دو لنگر: سه کفِ هم‌خط با هر جفتی همان خط‌اند
  const same = (x) => x && Math.abs(lineAt(x, a) - candles[a].l) <= 0.3 * A && Math.abs(lineAt(x, b) - candles[b].l) <= 0.3 * A;
  const tryWith = (over) => findTrendline(candles, A, { ...T, ...over });
  const dist = (over) => Object.keys(over).reduce((t, key) => {
    const p = lim(`${P}${key}`);
    return t + Math.abs(over[key] - T[key]) / (p.max - p.min);
  }, 0);

  let best = null;
  let rival = null;
  const first = tryWith(want);
  if (same(first)) best = { over: want, line: first };
  else {
    rival = first;
    // فقط سخت‌گیرتر از want: شُل‌تر کردن خطِ رقیب را حذف نمی‌کند، فقط رقیبِ تازه می‌آورد
    const bounces = [];
    for (let v = floorTo(need.bounceMax, `${P}minBounceAtr`); v >= want.minBounceAtr - 1e-9; v -= stepOf(`${P}minBounceAtr`)) bounces.push(Number(v.toFixed(4)));
    const spacings = [...new Set([need.spacingMax, want.minSpacing])];
    for (let s = maxS; s >= want.pivotStrength; s--) {
      for (const bo of bounces) {
        for (const sp of spacings) {
          const over = { ...want, pivotStrength: s, minBounceAtr: bo, minSpacing: sp };
          const d = dist(over);
          if (best && d >= best.d) continue;
          const got = tryWith(over);
          if (same(got)) best = { over, line: got, d };
        }
      }
    }
  }

  if (!best) {
    out.rival = rival;
    reasons.push('با هر تنظیمی خطِ دیگری از این بهتر رتبه می‌گیرد (به قیمت نزدیک‌تر است یا برخوردِ بیشتری دارد).');
    return out;
  }
  out.ok = true;
  out.line = best.line;
  for (const [key, v] of Object.entries(best.over)) {
    if (v !== T[key]) out.changes.push({ path: `${P}${key}`, from: T[key], to: v });
  }
  return out;
}
