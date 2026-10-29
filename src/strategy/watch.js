/**
 * «رسمِ آزادِ استاد»: استاد هر خطی بخواهد روی هر ارزی می‌کشد (خطِ روند، خطِ
 * افقی، فیبوناچی) و بات همان را تماشا می‌کند. هیچ رسمی رد نمی‌شود؛ وقتی قیمت به
 * آن رسید، بات خودش RSI، واگرایی و کندلِ برگشتی را می‌سنجد و به ادمین‌ها خبر
 * می‌دهد.
 *
 * نقطه‌ها با «زمان» ذخیره می‌شوند نه شماره‌ی کندل (آرایه‌ی کندل مدام جلو
 * می‌رود)، و می‌توانند در آینده باشند — خطی که استاد جلوتر از آخرین کندل کشیده.
 *
 * کنارش از هر رسم چند مشخصه‌ی «نسبی» ثبت می‌شود (فاصله‌ی دو نقطه به کندل،
 * فیبو از کجای خط شروع شده، RSI در نقطه‌ها …) تا وقتی رسم‌ها جمع شدند معلوم
 * شود استاد معمولاً چه می‌کند و اسکنِ خودکار از روی آن تنظیم شود.
 *
 * هم در مرورگر اجرا می‌شود هم در Node؛ هیچ import ِ Node ای ندارد.
 */

import { rsi, atr } from './indicators.js';
import { findDivergence } from './divergence.js';
import { PATTERNS } from './patterns.js';
import { mirrorCandles } from './analyze.js';

export const KINDS = {
  trend: { fa: 'خطِ روند', pts: 2 },
  hline: { fa: 'خطِ افقی', pts: 1 },
  fib: { fa: 'فیبوناچی', pts: 2 },
};
export const WATCH_FIB = [0.236, 0.382, 0.5, 0.618, 0.705, 0.786];
export const DEFAULT_FIB_WATCH = [0.5, 0.618, 0.786];
export const MAX_DRAWINGS = 40;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** ورودیِ بیرونی ← رسمِ تمیز، یا خطا. سرور همین را صدا می‌زند. */
export function cleanDrawing(d) {
  const K = KINDS[d?.kind];
  if (!K) throw new Error('نوعِ رسم نامعتبر');
  if (!Array.isArray(d.points) || d.points.length !== K.pts) throw new Error('تعدادِ نقطه‌ها نامعتبر');
  const points = d.points.map((p) => {
    if (!finite(p?.t) || !finite(p?.p) || p.p <= 0) throw new Error('نقطه‌ی نامعتبر');
    return { t: Math.round(p.t), p: p.p };
  });
  const out = {
    id: String(d.id || '').replace(/[^\w-]/g, '').slice(0, 24) || Math.random().toString(36).slice(2, 10),
    kind: d.kind,
    points,
    watch: d.watch !== false,
    createdAt: finite(d.createdAt) ? d.createdAt : Date.now(),
  };
  if (d.kind === 'trend' && points[0].t === points[1].t) throw new Error('دو نقطه‌ی خط هم‌زمان‌اند');
  if (d.kind === 'fib') out.levels = (Array.isArray(d.levels) ? d.levels : DEFAULT_FIB_WATCH).filter((l) => WATCH_FIB.includes(l));
  if (d.features && typeof d.features === 'object') {
    const f = JSON.stringify(d.features);
    if (f.length <= 2000) out.features = JSON.parse(f);
  }
  return out;
}

/** قیمتِ خطِ روند در زمانِ t (پرتو، با همان شیبِ زمانی) */
export function trendAt(d, t) {
  const [a, b] = d.points;
  return a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t);
}

/** قیمتِ سطحِ L ِ فیبو: نقطه‌ی اول سطحِ 1 و نقطه‌ی دوم سطحِ 0 (مثلِ تریدینگ‌ویو) */
export const fibAt = (d, L) => d.points[1].p - L * (d.points[1].p - d.points[0].p);

/** سطح‌هایی از رسم که در زمانِ t تماشا می‌شوند: [{ key, label, price }] */
export function levelsAt(d, t) {
  if (d.kind === 'hline') return [{ key: 'h', label: 'سطح', price: d.points[0].p }];
  if (d.kind === 'trend') {
    // خط فقط از نقطه‌ی اولش به بعد معنا دارد
    if (t < Math.min(d.points[0].t, d.points[1].t)) return [];
    return [{ key: 't', label: 'خط', price: trendAt(d, t) }];
  }
  if (t < d.points[1].t) return [];
  return (d.levels || DEFAULT_FIB_WATCH).map((L) => ({ key: `f${L}`, label: `فیبو ${L}`, price: fibAt(d, L) }));
}

/**
 * آخرین کندلِ بسته‌شده به رسم رسید؟
 * «رسید» = سایه‌ی کندل از سطح رد شده یا تا tolAtr ِ ATR به آن نزدیک شده.
 * جهت از کندلِ قبلی: از بالا آمده ← حمایت (خرید)، از پایین ← مقاومت (فروش).
 *
 * @returns [{ key, label, price, side: 'long'|'short' }]
 */
export function touches(d, candles, A, tolAtr = 0.25) {
  const k = candles.at(-1);
  const prev = candles.at(-2);
  if (!k || !prev || !(A > 0)) return [];
  const tol = tolAtr * A;
  const out = [];
  for (const L of levelsAt(d, k.t)) {
    if (k.l - tol > L.price || k.h + tol < L.price) continue;
    const before = d.kind === 'trend' ? trendAt(d, prev.t) : L.price;
    out.push({ ...L, side: prev.c >= before ? 'long' : 'short' });
  }
  return out;
}

/**
 * فقط «رسیدنِ تازه»: سطحی که در `quiet` کندلِ قبل هم لمس شده حساب نیست. وقتی
 * قیمت دورِ یک سطح نوسان می‌کند، بی این، هر ساعت یک هشدار می‌رفت.
 */
export function freshTouches(d, candles, A, quiet = 3, tolAtr = 0.25) {
  const recent = new Set();
  for (let n = 1; n <= quiet && candles.length - n >= 2; n++) {
    for (const h of touches(d, candles.slice(0, candles.length - n), A, tolAtr)) recent.add(h.key);
  }
  return touches(d, candles, A, tolAtr).filter((h) => !recent.has(h.key));
}

/**
 * سنجشِ بات روی کندلِ برخورد: RSI، اشباع، واگرایی و کندلِ برگشتی. برای فروش
 * روی کندل‌های قرینه، مثلِ analyze.
 */
export function confirmAt(candles, strategy, side) {
  const short = side === 'short';
  const src = short ? mirrorCandles(candles) : candles;
  const last = src.length - 1;
  const r = rsi(src.map((x) => x.c), strategy.rsiPeriod);
  const A = atr(src, strategy.atrPeriod)[last];
  const Z = strategy.rsiZone;
  const zone = Z?.enabled ? (short ? 100 - Z.high : Z.low) : null;
  const div = findDivergence(src, r, last, { ...strategy.divergence, zone });
  let pattern = null;
  for (let i = last; i >= Math.max(0, last - (strategy.candles?.window ?? 2) + 1) && !pattern; i--) {
    const p = PATTERNS.filter((x) => x.test(src, i, A)).sort((a, b) => b.strength - a.strength)[0];
    if (p) pattern = { fa: short ? p.faBear : p.fa, name: short ? p.bearName : p.name };
  }
  const rsiNow = short ? 100 - r[last] : r[last];
  const extreme = Math.min(...r.slice(Math.max(0, last - 2)).filter(Number.isFinite));
  return {
    rsi: rsiNow,
    oversold: zone != null && extreme <= zone,
    zoneLabel: Z?.enabled ? (short ? Z.high : Z.low) : null,
    div: div && { type: div.type },
    pattern,
  };
}

/** زمان ← شماره‌ی منطقیِ کندل (کسری، و بعد از آخرین کندل هم) */
export function timeToLogical(candles, t, tf) {
  const n = candles.length;
  if (t >= candles[n - 1].t) return n - 1 + (t - candles[n - 1].t) / tf;
  if (t <= candles[0].t) return (t - candles[0].t) / tf;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (candles[m].t <= t) lo = m;
    else hi = m;
  }
  return lo + (t - candles[lo].t) / (candles[hi].t - candles[lo].t);
}

export function logicalToTime(candles, x, tf) {
  const n = candles.length;
  if (x >= n - 1) return candles[n - 1].t + (x - (n - 1)) * tf;
  if (x <= 0) return candles[0].t + x * tf;
  const i = Math.floor(x);
  return candles[i].t + (x - i) * (candles[i + 1].t - candles[i].t);
}

/** ±r کندل: کف یا سقفِ چرخشی است؟ */
function swing(candles, i, r = 3) {
  if (i < 0 || i >= candles.length) return null;
  let low = true;
  let high = true;
  for (let j = Math.max(0, i - r); j <= Math.min(candles.length - 1, i + r); j++) {
    if (candles[j].l < candles[i].l) low = false;
    if (candles[j].h > candles[i].h) high = false;
  }
  return low ? 'low' : high ? 'high' : null;
}

/**
 * مشخصه‌های نسبیِ یک رسم، لحظه‌ی ذخیره — بی‌قیمتِ خام، تا بشود رسم‌های
 * ارزهای مختلف را کنارِ هم گذاشت.
 * @param others رسم‌های دیگرِ همین ارز (برای «فیبو از کجای خط»)
 */
export function features(d, candles, strategy, tf, others = []) {
  const last = candles.length - 1;
  const A = atr(candles, strategy.atrPeriod)[last];
  const r = rsi(candles.map((x) => x.c), strategy.rsiPeriod);
  const idx = d.points.map((p) => Math.round(timeToLogical(candles, p.t, tf)));
  const at = (i) => (i >= 0 && i <= last ? i : null);
  const f = { tf, n: idx.map((i) => (at(i) == null ? null : last - i)) };
  f.swing = idx.map((i) => (at(i) == null ? null : swing(candles, i)));
  f.rsi = idx.map((i) => (at(i) == null || !Number.isFinite(r[i]) ? null : Math.round(r[i])));
  if (d.points.length === 2) {
    f.gap = Math.abs(idx[1] - idx[0]);
    f.moveAtr = A ? Number((Math.abs(d.points[1].p - d.points[0].p) / A).toFixed(2)) : null;
  }
  if (d.kind === 'trend') f.dir = d.points[1].p > d.points[0].p === d.points[1].t > d.points[0].t ? 'up' : 'down';
  if (d.kind === 'fib') {
    f.dir = d.points[1].p > d.points[0].p ? 'up' : 'down';
    // شروعِ فیبو کجای خطِ روندِ همین ارز است؟
    const line = others.filter((o) => o.kind === 'trend').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (line) {
      const li = line.points.map((p) => Math.round(timeToLogical(candles, p.t, tf))).sort((a, b) => a - b);
      const s = idx[0];
      f.anchor = Math.abs(s - li[0]) <= 2 ? 'line1' : Math.abs(s - li[1]) <= 2 ? 'line2' : s > li[1] ? 'afterLine2' : 'other';
    }
  }
  return f;
}

/** خلاصه‌ی رسم‌های همه‌ی ارزها ← چند جمله که پیشنهادِ تنظیم می‌دهد */
export function summarize(all) {
  const list = Object.values(all).flat();
  const by = (k) => list.filter((d) => d.kind === k && d.features);
  const median = (a) => {
    const s = a.filter(finite).sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const coins = Object.values(all).filter((l) => l.length).length;
  const lines = by('trend');
  const fibs = by('fib');
  const out = { total: list.length, coins, notes: [] };
  if (lines.length) {
    const swings = lines.filter((d) => d.features.swing.every((s) => s)).length;
    out.notes.push(`خطِ روند: ${lines.length} بار · فاصله‌ی دو نقطه (میانه) ${median(lines.map((d) => d.features.gap))} کندل · ${swings} بار هر دو نقطه روی کف/سقفِ چرخشی`);
  }
  if (fibs.length) {
    const anc = { line1: 0, line2: 0, afterLine2: 0, other: 0 };
    for (const d of fibs) if (d.features.anchor) anc[d.features.anchor]++;
    const known = fibs.filter((d) => d.features.anchor).length;
    out.notes.push(`فیبوناچی: ${fibs.length} بار · طولِ موج (میانه) ${median(fibs.map((d) => d.features.gap))} کندل`
      + (known ? ` · شروع: از برخوردِ اولِ خط ${anc.line1}، از برخوردِ دوم ${anc.line2}، بعد از برخوردِ دوم ${anc.afterLine2}، جای دیگر ${anc.other}` : ''));
    // بات فیبو را بعد از برخوردِ دوم می‌کشد؛ اگر استاد بیشتر از جای دیگری می‌کشد، بگو
    if (known >= 3 && anc.line1 / known >= 0.6) out.suggest = 'fibFromLine1';
  }
  const rsis = list.flatMap((d) => d.features?.rsi || []).filter(finite);
  if (rsis.length) out.notes.push(`RSI در نقطه‌های رسم: کمینه ${Math.min(...rsis)} · بیشینه ${Math.max(...rsis)}`);
  return out;
}
