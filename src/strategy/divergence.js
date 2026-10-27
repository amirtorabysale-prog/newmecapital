/**
 * واگراییِ صعودیِ RSI بینِ کفِ فعلی (k) و یک کفِ قبلی (p):
 *
 *   regular : قیمت کفِ پایین‌تر، RSI کفِ بالاتر  ← ضعفِ فروشنده، برگشت
 *   hidden  : قیمت کفِ بالاتر، RSI کفِ پایین‌تر  ← ادامه‌ی روندِ صعودی
 *
 * واگراییِ مخفی دقیقاً همان چیزی است که روی برخوردِ سوم به خطِ روندِ صعودی
 * انتظارش را داریم (قیمت کفِ بالاتر روی خط، RSI ریست شده)، برای همین هر دو
 * پذیرفته می‌شوند و نوعشان در پیام گفته می‌شود.
 *
 * ⚠️ RSI در هر کف کمترین مقدار در ±۱ کندل است، نه دقیقاً همان کندل:
 * پایین‌ترین RSI گاهی یک کندل زودتر یا دیرتر از پایین‌ترین قیمت می‌نشیند.
 */

import { pivotLows } from './indicators.js';

function rsiNear(r, i, last) {
  let m = Infinity;
  for (let j = Math.max(0, i - 1); j <= Math.min(last, i + 1); j++) if (Number.isFinite(r[j])) m = Math.min(m, r[j]);
  return m;
}

export function findDivergence(candles, r, k, cfg) {
  const last = candles.length - 1;
  const pivots = pivotLows(candles, cfg.pivotStrength)
    .filter((p) => p >= k - cfg.lookback && p <= k - cfg.minGap)
    .reverse();

  const rk = rsiNear(r, k, last);
  const lk = candles[k].l;
  for (const p of pivots) {
    const rp = rsiNear(r, p, last);
    const lp = candles[p].l;
    let type = null;
    if (lk < lp && rk > rp + cfg.minRsiDelta) type = 'regular';
    else if (cfg.allowHidden && lk > lp && rk < rp - cfg.minRsiDelta) type = 'hidden';
    if (!type) continue;

    // بینِ دو کف، نه قیمت و نه RSI نباید پایین‌تر از هر دو رفته باشد — وگرنه
    // این دو نقطه دو کفِ متوالی نیستند و خطِ واگرایی از وسطِ داده رد می‌شود.
    const floorL = Math.min(lp, lk);
    const floorR = Math.min(rp, rk) - 1;
    let clean = true;
    for (let i = p + 1; i < k && clean; i++) {
      if (candles[i].l < floorL || r[i] < floorR) clean = false;
    }
    if (!clean) continue;

    return { type, p, k, priceP: lp, priceK: lk, rsiP: rp, rsiK: rk };
  }
  return null;
}
