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

import { atr, rsi, pivotLows } from './indicators.js';
import { findDivergence, rsiNear } from './divergence.js';
import { findTrendline, lineAt } from './trendline.js';
import { paramByPath, getPath, setPath } from './params.js';
import { PATTERNS } from './patterns.js';
import { analyze, mirrorCandles } from './analyze.js';

const P = 'strategy.trendline.';

/** زمانِ کندل برای پیام‌ها — شماره‌ی کندل برای استاد معنایی ندارد */
export const when = (candles, i) => (candles[i] ? `${new Date(candles[i].t).toISOString().slice(5, 16).replace('T', ' ')} UTC` : '?');

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
  if (reasons.length) {
    // نقطه روی کفِ واقعی نیست: کفِ چرخشیِ همان نزدیکی را پیشنهاد بده
    if (maxS < lim(`${P}pivotStrength`).min) {
      const [sa, sb] = [snapLow(candles, a), snapLow(candles, b)];
      if ((sa !== a || sb !== b) && sa !== sb) out.fix = { to: [sa, sb], why: `کفِ واقعیِ آن نزدیکی: ${when(candles, sa)} و ${when(candles, sb)}` };
    }
    return out;
  }

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
    if (rival) out.fix = { to: [rival.a, rival.b], why: `بات این خط را می‌بیند: ${when(candles, rival.a)} تا ${when(candles, rival.b)} (خط‌چینِ خاکستری)` };
    return out;
  }
  out.ok = true;
  out.line = best.line;
  for (const [key, v] of Object.entries(best.over)) {
    if (v !== T[key]) out.changes.push({ path: `${P}${key}`, from: T[key], to: v });
  }
  return out;
}

/**
 * «واگراییِ استاد ← تنظیماتِ بات»: استاد دو کف را می‌زند؛ بات واگرایی را فقط
 * روی کندلِ برخورد به خط (k) می‌سنجد، پس کفِ دوم باید همان‌جا باشد.
 * مثلِ fitLine: اول حدودِ لازم از خودِ داده، بعد اجرای واقعی و اگر کفِ قبلیِ
 * دیگری (نزدیک‌تر به k) جلو افتاد، سخت‌گیرتر.
 *
 * کندل‌ها مثلِ fitLine برای فروش قرینه‌اند؛ `short` فقط برای این است که
 * ناحیه‌ی اشباع از rsiZone.high خوانده/نوشته شود.
 *
 * @returns {{ ok: boolean, p: number, k: number|null, type: string|null, reasons: string[],
 *            changes: {path: string, from: any, to: any}[], rsiP: number, rsiK: number }}
 */
export function fitDivergence(candles, strategy, a, b, k, short = false) {
  if (a > b) [a, b] = [b, a];
  const D = strategy.divergence;
  const Z = strategy.rsiZone;
  const last = candles.length - 1;
  const reasons = [];
  const out = { ok: false, p: a, k, type: null, reasons, changes: [], rsiP: null, rsiK: null };
  if (k == null) {
    reasons.push('با تنظیماتِ فعلی خطِ روندی پیدا نشده؛ بات واگرایی را فقط روی برخورد به خط می‌سنجد.');
    return out;
  }
  if (Math.abs(b - k) > 2) {
    reasons.push(`بات واگرایی را روی کندلِ برخورد به خط می‌سنجد (${when(candles, k)}، K روی چارت)؛ کفِ دومِ تو ${Math.abs(b - k)} کندل با آن فاصله دارد.`);
    if (a < k) out.fix = { to: [a, k], why: `کفِ دوم روی کندلِ برخورد (${when(candles, k)})` };
    return out;
  }
  const p = a;
  if (p >= k) {
    reasons.push('کفِ اول باید قبل از کندلِ برخورد باشد.');
    return out;
  }

  const r = rsi(candles.map((x) => x.c), strategy.rsiPeriod);
  const rp = rsiNear(r, p, last);
  const rk = rsiNear(r, k, last);
  const lp = candles[p].l;
  const lk = candles[k].l;
  Object.assign(out, { rsiP: rp, rsiK: rk });
  const gap = k - p;

  const type = lk < lp && rk > rp ? 'regular' : lk > lp && rk < rp ? 'hidden' : null;
  out.type = type;
  if (!type) {
    reasons.push(lk === lp
      ? 'دو کف هم‌قیمت‌اند؛ واگرایی تعریف نمی‌شود.'
      : `قیمت و RSI هم‌جهت‌اند (قیمت ${lk < lp ? 'پایین‌تر' : 'بالاتر'}، RSI هم ${rk < rp ? 'پایین‌تر' : 'بالاتر'})؛ واگرایی نیست.`);
    return out;
  }

  const maxS = pivotStrengthAt(candles, p);
  const deltaPath = 'strategy.divergence.minRsiDelta';
  const delta = Math.abs(rk - rp);
  // شرطِ بات اکید است (rk > rp + minRsiDelta)، پس بزرگ‌ترین گامی که کمتر از اختلاف است
  const maxDelta = Number((Math.ceil(delta / stepOf(deltaPath) - 1e-9) * stepOf(deltaPath) - stepOf(deltaPath)).toFixed(4));
  const lim = (path) => paramByPath(path);
  const want = {
    pivotStrength: Math.min(D.pivotStrength, maxS),
    minGap: Math.min(D.minGap, gap),
    lookback: Math.max(D.lookback, ceilTo(gap, 'strategy.divergence.lookback')),
    minRsiDelta: Math.min(D.minRsiDelta, maxDelta),
    allowHidden: D.allowHidden || type === 'hidden',
  };

  if (maxS < lim('strategy.divergence.pivotStrength').min) reasons.push('کفِ اول کفِ چرخشی نیست (کندلِ پایین‌ترِ کناری دارد).');
  if (gap < lim('strategy.divergence.minGap').min) reasons.push(`دو کف خیلی نزدیک‌اند (${gap} کندل).`);
  if (want.lookback > lim('strategy.divergence.lookback').max) reasons.push(`کفِ اول خیلی قدیمی است (${gap} کندل قبل؛ بیشینه ${lim('strategy.divergence.lookback').max}).`);
  if (maxDelta < lim(deltaPath).min) reasons.push(`اختلافِ RSI ِ دو کف فقط ${delta.toFixed(1)} است؛ واگراییِ معناداری نیست.`);

  // ناحیه‌ی اشباع: شدیدترین RSI (روی قیمتِ قرینه برای فروش) باید زیرِ zone باشد
  const zoneChange = {};
  const extreme = Math.min(rp, rk);
  if (Z?.enabled) {
    const zone = short ? 100 - Z.high : Z.low;
    if (extreme > zone) {
      if (short) {
        const to = floorTo(100 - extreme, 'strategy.rsiZone.high');
        if (to < lim('strategy.rsiZone.high').min) reasons.push(`RSI به ناحیه‌ی اشباعِ خرید نرسیده (بیشینه ${(100 - extreme).toFixed(1)}).`);
        else zoneChange['strategy.rsiZone.high'] = to;
      } else {
        const to = ceilTo(extreme, 'strategy.rsiZone.low');
        if (to > lim('strategy.rsiZone.low').max) reasons.push(`RSI به ناحیه‌ی اشباعِ فروش نرسیده (کمینه ${extreme.toFixed(1)}).`);
        else zoneChange['strategy.rsiZone.low'] = to;
      }
    }
  }

  // همان شرطِ «دو کفِ متوالی» ِ findDivergence — تنظیمی درستش نمی‌کند
  const floorL = Math.min(lp, lk);
  const floorR = extreme - 1;
  for (let i = p + 1; i < k; i++) {
    if (candles[i].l < floorL) { reasons.push('بینِ دو کف قیمت پایین‌تر از هر دو رفته؛ این دو، کف‌های متوالی نیستند.'); break; }
    if (r[i] < floorR) { reasons.push('بینِ دو کف RSI پایین‌تر از هر دو رفته؛ این دو، کف‌های متوالی نیستند.'); break; }
  }
  if (reasons.length) return out;

  const zoneFor = () => {
    if (!Z?.enabled) return null;
    const high = zoneChange['strategy.rsiZone.high'] ?? Z.high;
    const low = zoneChange['strategy.rsiZone.low'] ?? Z.low;
    return short ? 100 - high : low;
  };
  const tryWith = (over) => findDivergence(candles, r, k, { ...D, ...over, zone: zoneFor() });
  const dist = (over) => Object.keys(over).reduce((t, key) => {
    const q = lim(`strategy.divergence.${key}`);
    if (q.type === 'bool') return t + (over[key] !== D[key] ? 1 : 0);
    return t + Math.abs(over[key] - D[key]) / (q.max - q.min);
  }, 0);

  let best = null;
  if (tryWith(want)?.p === p) best = { over: want };
  else {
    // کفِ قبلیِ نزدیک‌تری برنده شده: فاصله‌ی حداقل را از آن رد کن، یا اختلاف/قدرت را بالا ببر
    // فاصله‌هایی که دقیقاً از یک کفِ رقیب رد می‌شوند
    const gaps = [...new Set([want.minGap, ...pivotLows(candles, lim('strategy.divergence.pivotStrength').min)
      .filter((x) => x > p && x < k).map((x) => k - x + 1)])].filter((g) => g >= want.minGap && g <= gap);
    const deltas = [];
    for (let v = want.minRsiDelta; v <= maxDelta + 1e-9; v += stepOf(deltaPath)) deltas.push(Number(v.toFixed(4)));
    for (let s = want.pivotStrength; s <= Math.min(maxS, lim('strategy.divergence.pivotStrength').max); s++) {
      for (const de of deltas) {
        for (const g of gaps) {
          const over = { ...want, pivotStrength: s, minRsiDelta: de, minGap: g };
          const d = dist(over);
          if (best && d >= best.d) continue;
          if (tryWith(over)?.p === p) best = { over, d };
        }
      }
    }
  }
  if (!best) {
    reasons.push('با هر تنظیمی کفِ قبلیِ دیگری زودتر انتخاب می‌شود.');
    return out;
  }
  out.ok = true;
  for (const [key, v] of Object.entries(best.over)) {
    if (v !== D[key]) out.changes.push({ path: `strategy.divergence.${key}`, from: D[key], to: v });
  }
  for (const [path, v] of Object.entries(zoneChange)) {
    out.changes.push({ path, from: Z[path.split('.').at(-1)], to: v });
  }
  return out;
}

/**
 * «فیبوی استاد»: استاد از کفِ موج تا سقفِ موج فیبو می‌کشد. بات خودش فیبو را از
 * پایین‌ترین کفِ بعد از برخوردِ دوم تا سقفِ واکنش (highIdx ِ خط) می‌کشد و این
 * با تنظیم عوض نمی‌شود؛ پس اول لنگرها مقایسه می‌شوند، بعد سطحی که خط در کندلِ
 * برخورد رویش نشسته و تحملِ لازم.
 *
 * @param bot { line, lowIdx, highIdx, k } از تحلیلِ بات (فضای قرینه برای فروش)
 * @param level سطحی که استاد انتخاب کرده؛ خالی ← نزدیک‌ترین گزینه‌ی پنل
 */
export function fitFib(candles, strategy, bot, lo, hi, level = null) {
  const F = strategy.fib;
  const A = atr(candles, strategy.atrPeriod).at(-1);
  const reasons = [];
  const out = { ok: false, reasons, changes: [], level: null, retrace: null, distAtr: null, lowIdx: bot.lowIdx, highIdx: bot.highIdx };
  if (candles[hi].h <= candles[lo].l || hi <= lo) {
    reasons.push('سقفِ موج باید بعد از کفِ موج و بالاتر از آن باشد.');
    return out;
  }
  if (Math.abs(lo - bot.lowIdx) > 2 || Math.abs(hi - bot.highIdx) > 2) {
    reasons.push(`بات فیبو را فقط از پایین‌ترین کفِ بعد از برخوردِ دوم تا سقفِ واکنش می‌کشد: ${when(candles, bot.lowIdx)} تا ${when(candles, bot.highIdx)}. فیبوی تو از ${when(candles, lo)} تا ${when(candles, hi)} است و این با هیچ تنظیمی عوض نمی‌شود.`);
    out.fix = { to: [bot.lowIdx, bot.highIdx], why: `فیبوی بات: ${when(candles, bot.lowIdx)} تا ${when(candles, bot.highIdx)} (خط‌چینِ خاکستری)` };
    out.freeHint = true;
  }
  const start = candles[bot.lowIdx].l;
  const end = candles[bot.highIdx].h;
  const y = lineAt(bot.line, bot.k);
  const retrace = (end - y) / (end - start);
  const choices = paramByPath('strategy.fib.level').choices;
  const distTo = (lv) => Math.abs(end - lv * (end - start) - y) / A;
  // سطحِ فعلی اگر همین حالا امتیازِ کامل می‌گیرد دست نمی‌خورد؛ وگرنه نزدیک‌ترین گزینه
  const L = level ?? (distTo(F.level) <= F.toleranceAtr ? F.level
    : choices.reduce((best, c) => (Math.abs(c - retrace) < Math.abs(best - retrace) ? c : best), choices[0]));
  const dist = distTo(L);
  Object.assign(out, { level: L, retrace, distAtr: dist });
  if (reasons.length) return out;

  const tolPath = 'strategy.fib.toleranceAtr';
  const nearPath = 'strategy.fib.nearToleranceAtr';
  const tol = Math.max(F.toleranceAtr, ceilTo(dist, tolPath));
  if (tol > paramByPath(tolPath).max) {
    reasons.push(`خط در کندلِ برخورد روی سطحِ ${retrace.toFixed(3)} است؛ تا سطحِ ${L} ${dist.toFixed(2)} ATR فاصله دارد.`);
    return out;
  }
  if (L !== F.level) out.changes.push({ path: 'strategy.fib.level', from: F.level, to: L });
  if (tol !== F.toleranceAtr) out.changes.push({ path: tolPath, from: F.toleranceAtr, to: tol });
  if (F.nearToleranceAtr < tol) out.changes.push({ path: nearPath, from: F.nearToleranceAtr, to: tol });
  out.ok = true;
  return out;
}

/**
 * «کندلِ برگشتیِ استاد»: استاد کندلِ آخرِ الگو را می‌زند. بات الگو را فقط وقتی
 * قیمت روی خط است و روی `candles.window` کندلِ آخر می‌سنجد.
 */
export function fitCandle(candles, strategy, i, state, short = false) {
  const reasons = [];
  const out = { ok: false, reasons, changes: [], pattern: null };
  const A = atr(candles, strategy.atrPeriod).at(-1);
  const found = PATTERNS.filter((p) => p.test(candles, i, A)).sort((x, y) => y.strength - x.strength)[0];
  const faName = (p) => (short ? p.faBear : p.fa);
  if (!found) {
    reasons.push(`این کندل با هیچ‌کدام از الگوهای بات جور نیست (${PATTERNS.map(faName).join('، ')}).`);
    // نزدیک‌ترین کندلی (±۳) که یکی از الگوها را دارد
    for (const d of [1, -1, 2, -2, 3, -3]) {
      const j = i + d;
      const p = j >= 0 && j < candles.length && PATTERNS.find((q) => q.test(candles, j, A));
      if (p) { out.fix = { to: j, why: `${faName(p)} در ${when(candles, j)}` }; break; }
    }
    return out;
  }
  out.pattern = { key: found.key, fa: faName(found), name: short ? found.bearName : found.name, strength: found.strength };
  if (state !== 'touch') reasons.push('قیمت الان روی خط نیست؛ بات الگوی کندلی را فقط وقتی قیمت روی خط است می‌سنجد.');
  const path = 'strategy.candles.window';
  const need = candles.length - i;
  if (need > paramByPath(path).max) reasons.push(`این کندل ${need} کندل قبل است؛ بات حداکثر ${paramByPath(path).max} کندلِ آخر را می‌بیند.`);
  if (reasons.length) return out;
  if (need > strategy.candles.window) out.changes.push({ path, from: strategy.candles.window, to: need });
  out.ok = true;
  return out;
}

/**
 * تحلیلِ کاملِ استاد ← یک استراتژی. خط اول (بقیه به خط و کندلِ برخوردش
 * وابسته‌اند)، بعد فیبو، واگرایی و کندل، هر کدام روی تنظیمِ مرحله‌ی قبل. هر
 * شرطی که استاد کشیده و خاموش است روشن می‌شود. آخر سر تحلیلِ بات با تنظیمِ
 * نهایی اجرا می‌شود تا معلوم شود واقعاً همان را می‌بیند.
 *
 * @param drawings { line?: [a,b], fib?: [lo,hi], div?: [p,q], candle?: i, fibLevel?: number }
 * @returns {{ items: object, changes: {path,from,to}[], final: object|null, cfg: object }}
 */
export function fitAll(candles, cfg, direction, drawings, ltf = null) {
  const short = direction === 'short';
  const src = short ? mirrorCandles(candles) : candles;
  const next = structuredClone(cfg);
  const changes = new Map();
  const apply = (list) => {
    for (const c of list) {
      setPath(next, c.path, c.to);
      changes.set(c.path, { path: c.path, from: getPath(cfg, c.path), to: c.to });
    }
  };
  const enable = (key) => {
    const path = `strategy.conditions.${key}.enabled`;
    return getPath(next, path) ? [] : [{ path, from: false, to: true }];
  };
  const items = {};
  const needLine = { ok: false, reasons: ['اول خطِ روند را بکش و درست کن؛ این یکی به خط وابسته است.'], changes: [] };

  let res = null;
  if (drawings.line) {
    items.line = fitLine(src, next.strategy, ...drawings.line);
    if (items.line.ok) {
      apply(items.line.changes);
      res = analyze(candles, next, direction, ltf);
    }
  }
  // تحلیلِ بات در فضای قرینه برای فروش، تا اندیس و قیمت‌ها با src بخوانند
  const bot = res && analyze(src, next, 'long', ltf && (short ? mirrorCandles(ltf) : ltf));

  if (drawings.fib) {
    items.fib = bot ? fitFib(src, next.strategy, { line: bot.line, lowIdx: bot.fib.lowIdx, highIdx: bot.fib.highIdx, k: bot.line.touchIdx }, ...drawings.fib, drawings.fibLevel ?? null) : needLine;
    if (items.fib.ok) apply([...items.fib.changes, ...enable('fib')]);
  }
  if (drawings.div) {
    items.div = bot ? fitDivergence(src, next.strategy, ...drawings.div, bot.line.touchIdx, short) : needLine;
    if (items.div.ok) apply([...items.div.changes, ...enable('divergence')]);
  }
  if (drawings.candle != null) {
    items.candle = bot ? fitCandle(src, next.strategy, drawings.candle, bot.line.state, short) : needLine;
    if (items.candle.ok) apply([...items.candle.changes, ...enable('candle')]);
  }

  const final = items.line?.ok ? analyze(candles, next, direction, ltf) : null;
  // بات با تنظیمِ نهایی دقیقاً همان را می‌بیند؟
  if (final) {
    if (items.div?.ok && final.div?.p !== items.div.p) Object.assign(items.div, { ok: false, reasons: ['با تنظیمِ نهایی بات کفِ قبلیِ دیگری برای واگرایی برمی‌دارد.'] });
    if (items.fib?.ok && !final.components.fib?.ok) Object.assign(items.fib, { ok: false, reasons: ['با تنظیمِ نهایی فیبو امتیازِ کامل نمی‌گیرد.'] });
    if (items.candle?.ok && !final.candle) Object.assign(items.candle, { ok: false, reasons: ['با تنظیمِ نهایی بات الگوی کندلی نمی‌بیند.'] });
  }
  return { items, changes: [...changes.values()].filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to)), final, cfg: next };
}
