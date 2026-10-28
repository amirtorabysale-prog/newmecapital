/**
 * داده‌ی ساختگی با یک ستاپِ خریدِ کامل:
 *
 *   ۰–۴۰   نزول ۱۲۰ ← ۱۰۰           (برخوردِ ۱: کفِ ۱۰۰ در ۴۰)
 *   ۴۰–۶۰  صعود تا ۱۱۲              (واکنشِ ماژور)
 *   ۶۰–۸۰  اصلاحِ تند تا ۱۰۴         (برخوردِ ۲: کفِ ۱۰۴ در ۸۰ — RSI خیلی پایین)
 *   ۸۰–۱۱۰ صعود تا ۱۲۰              (موجِ فیبو: ۱۰۴ ← ۱۲۰، سطحِ ۰.۶۱۸ ≈ ۱۱۰.۱)
 *   ۱۱۰–۱۴۰ اصلاحِ آرام تا خط (≈۱۱۰) و پوشای صعودی روی آن
 *
 * خط: ۱۰۰ + ۰.۱ × (i − ۴۰) ← در ۱۴۰ برابرِ ۱۱۰، هم‌جای فیبو ۰.۶۱۸.
 */

export function path(points, start = 0) {
  const out = [];
  for (let s = 0; s < points.length - 1; s++) {
    const [i0, v0] = points[s];
    const [i1, v1] = points[s + 1];
    for (let i = i0; i < i1; i++) out.push(v0 + ((v1 - v0) * (i - i0)) / (i1 - i0));
  }
  out.push(points[points.length - 1][1]);
  return out.slice(start);
}

export function candlesFrom(closes, t0 = Date.UTC(2026, 0, 1)) {
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    // نویزِ متناوب تا ATR صفر نشود و کندل‌ها شبیهِ واقعی باشند
    const w = 0.35 + (i % 3) * 0.05;
    return { t: t0 + i * 3_600_000, o, c, h: Math.max(o, c) + w, l: Math.min(o, c) - w, v: 100 };
  });
}

export function longSetup() {
  const closes = path([[0, 120], [40, 100.4], [60, 112], [80, 104.4], [110, 120], [138, 110.5], [139, 110.6]]);
  const c = candlesFrom(closes);
  const n = c.length;
  // کندلِ ماقبل‌آخر نزولی، آخر پوشای صعودی روی خط (خط در n-1 ≈ ۱۰۹.۹)
  c[n - 2] = { ...c[n - 2], o: 111.0, c: 110.3, h: 111.1, l: 110.0 };
  c[n - 1] = { ...c[n - 1], o: 110.2, c: 111.4, h: 111.5, l: 110.0 };
  return c;
}

/**
 * کندل‌های ۵ دقیقه با واگراییِ معمولیِ صعودی که کفِ دومش بعد از `touchT`
 * (شروعِ کندلِ برخورد) است:
 *
 *   ۰–۴۰   درجا، کمی نزولی
 *   ۴۰–۵۰  ریزشِ تند تا ~۱۱۰.۴         (کفِ اول — RSI خیلی پایین)
 *   ۵۰–۶۰  برگشت
 *   ۶۰–۸۵  نزولِ زیگزاگی تا کفِ پایین‌تر (RSI بالاتر)   ← از touchT به بعد
 *   ۸۵–۹۱  برگشت
 */
export function ltfDivergence(touchT) {
  const M5 = 300_000;
  const closes = [];
  let v = 113;
  for (let i = 0; i < 40; i++) closes.push((v += i % 2 ? 0.08 : -0.1));
  for (let i = 0; i < 10; i++) closes.push((v -= 0.16));
  for (let i = 0; i < 10; i++) closes.push((v += 0.13));
  for (let i = 0; i < 25; i++) closes.push((v += i % 2 ? 0.1 : -0.22));
  for (let i = 0; i < 6; i++) closes.push((v += 0.12));
  const t0 = touchT - 60 * M5;
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { t: t0 + i * M5, o, c, h: Math.max(o, c) + 0.03, l: Math.min(o, c) - 0.03, v: 1 };
  });
}
