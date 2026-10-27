/** قالب‌بندیِ قیمت: تعدادِ اعشار از بزرگیِ عدد می‌آید (۸۰٬۰۰۰ دو رقم، ۰.۳۳ پنج رقم). */
export function decimalsFor(price) {
  const p = Math.abs(price);
  if (!(p > 0)) return 2;
  return Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(p))));
}

export function price(v, ref = v) {
  return Number(v).toLocaleString('en-US', {
    minimumFractionDigits: decimalsFor(ref),
    maximumFractionDigits: decimalsFor(ref),
  });
}

export function pct(v, digits = 2) {
  return `${Number(v).toFixed(digits)}%`;
}

export function utc(t) {
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}
