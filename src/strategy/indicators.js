/** RSI و ATR با هموارسازیِ وایلدر — همان چیزی که TradingView نشان می‌دهد. */

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  const tr = candles.map((k, i) => (i === 0
    ? k.h - k.l
    : Math.max(k.h - k.l, Math.abs(k.h - candles[i - 1].c), Math.abs(k.l - candles[i - 1].c))));
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

/**
 * کفِ چرخشی: کندلِ i کف است اگر low آن کمترینِ `left` کندلِ قبل و `right`
 * کندلِ بعد باشد. کفِ `right` کندلِ آخر هنوز «تأییدنشده» است و برنمی‌گردد.
 */
export function pivotLows(candles, left, right = left) {
  const out = [];
  for (let i = left; i < candles.length - right; i++) {
    const v = candles[i].l;
    let ok = true;
    for (let j = i - left; j <= i + right && ok; j++) {
      if (j === i) continue;
      // تساوی با کندلِ قبلی کف را رد می‌کند تا یک کفِ دوقلو دو بار شمرده نشود
      if (candles[j].l < v || (j < i && candles[j].l === v)) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}
