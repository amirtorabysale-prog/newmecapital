/**
 * S7 — شکستِ سطحِ استاتیک در برخوردِ سوم با حجمِ بالا (جدا از روند‌گیری).
 *
 * تعریف‌ها (همه روی کندلِ بسته، بدونِ نگاه به آینده):
 * - «برخورد» = سقفِ چرخشی (pivot high با `pivot` کندل در هر طرف) در فاصله‌ی
 *   ±tolAtr×ATR از سطح. برای حمایت قرینه (کفِ چرخشی).
 * - برخوردهای قبلی از آخرین برخورد (b) رو به عقب شمرده می‌شوند تا جایی که قیمت
 *   بالای ناحیه رفته باشد. بینِ هر دو برخوردِ پشتِ سرِ هم: حداقل minSpacing کندل
 *   و پولبکِ حداقل bounceAtr×ATR. سطح = میانگینِ سقفِ برخوردها.
 * - بعد از b: پولبکِ حداقل bounceAtr×ATR بدونِ رد شدن از ناحیه؛ «برخوردِ بعدی»
 *   = اولین برگشت به ناحیه. شکست باید حداکثر approachBars کندل بعد از رسیدن به
 *   ناحیه رخ دهد و حداقل minSpacing کندل بعد از b باشد. اگر نشکست، این b تمام
 *   است و برخوردِ ناموفق خودش b ِ بعدی (با یک برخوردِ بیشتر) می‌شود.
 * - شکست = کلوز ≥ سطح + breakAtr×ATR (سایه حساب نیست).
 * - حجمِ کندلِ شکست ≥ volMult × میانگینِ حجمِ volPeriod کندلِ قبل.
 * - فیلترِ روند: آخرین کلوزِ روزانه‌ی بسته بالای EMA50 ِ روزانه (فروش: زیر).
 * - ورود: کلوزِ کندلِ شکست. استاپ: سطح − stopAtr×ATR. تارگت: targetR × ریسک.
 *
 * priorTouches: تعدادِ برخوردهای قبل از کندلِ شکست (۲ = «شکست در برخوردِ سوم»).
 * touchMode: 'exact' (دقیقاً priorTouches) یا 'min' (حداقل priorTouches).
 */

import { atr, ema } from './indicators.js';

export const SR_DEFAULTS = {
  atrPeriod: 14,
  pivot: 5,
  lookback: 200,
  minSpacing: 10,
  tolAtr: 0.5,
  bounceAtr: 1.5,
  priorTouches: 2,
  touchMode: 'exact',
  approachBars: 3,
  breakAtr: 0.25,
  volMult: 2,
  volPeriod: 20,
  emaPeriod: 50,
  stopAtr: 0.75,
  targetR: 2,
  maxHoldBars: 120,
  // اختیاری — پیش‌فرض خاموش
  maxBreakAtr: Infinity, // کلوز بیش از این فاصله از سطح ← ورود نکن
  minStopAtr: 0, // فاصله‌ی ورود تا استاپ حداقل این × ATR
  // S7r — ورود روی برگشت به سطحِ شکسته‌شده (به‌جای کلوزِ کندلِ شکست)
  entryMode: 'break', // 'break' | 'retest' | 'follow'
  retestAwayAtr: 1, // قبل از برگشت، قیمت باید حداقل این × ATR از سطح دور شده باشد (تا «برگشت» همان کندلِ بعدِ شکست نباشد)
  retestBars: 20, // حداکثر کندل بعد از شکست برای رسیدن به ناحیه
  retestConfirmBars: 3, // بعد از رسیدن به ناحیه، حداکثر این تعداد کندل برای کلوزِ برگشتی بالای سطح
  // S7r+ — کیفیتِ کندل‌ها و حجمِ برگشت (پیش‌فرض خاموش)
  touchHold: false, // کندلِ برخورد به سطح باید بالای سطح بسته شود (سطح نگه داشته شد)
  bounceStrong: false, // کندلِ تأییدِ برگشت: کندلی جدا بعد از کندلِ برخورد، صعودی، بدنه ≥ strongBody ِ طول، کلوز در یک‌سومِ بالا
  bounceVolMult: 0, // حجمِ کندلِ تأییدِ برگشت ≥ این × میانگینِ volPeriod کندلِ قبل از شکست
  strongBody: 0.5,
  // S7f — entryMode 'follow': ورود بعد از followBars کندلِ بعد از شکست، روی کلوزِ آخری
  followBars: 2,
  followDir: false, // هر کندلِ بعدی در جهتِ معامله بسته شود (خرید: کلوز > اوپن)
  followVolMult: 0, // حجمِ هر کندلِ بعدی ≥ این × میانگینِ volPeriod کندلِ قبل از شکست
};

/** کندلِ قوی در جهتِ خرید: صعودی، بدنه ≥ body×طول، کلوز در یک‌سومِ بالای کندل */
const strong = (k, body) => { const rg = k.h - k.l; return rg > 0 && k.c > k.o && (k.c - k.o) >= body * rg && (k.c - k.l) >= (2 / 3) * rg; };

const DAY_MS = 86_400_000;
const mirror = (bars) => bars.map((k) => ({ ...k, o: -k.o, h: -k.l, l: -k.h, c: -k.c }));

function pivotHighs(bars, k) {
  const out = [];
  for (let i = k; i < bars.length - k; i++) {
    let ok = true;
    for (let j = i - k; j <= i + k && ok; j++) {
      if (j !== i && (bars[j].h > bars[i].h || (j < i && bars[j].h === bars[i].h))) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

/** همه‌ی شکست‌های کاندید (بدونِ اعمالِ فیلترِ حجم و روند) برای خرید روی `bars` */
function candidatesLong(bars, a14, p) {
  const piv = pivotHighs(bars, p.pivot);
  const isPiv = new Uint8Array(bars.length);
  for (const q of piv) isPiv[q] = 1;
  const out = [];
  for (const b of piv) {
    const A = a14[b];
    if (!Number.isFinite(A)) continue;
    const tol = p.tolAtr * A;
    const deep = p.bounceAtr * A;
    const ref = bars[b].h;
    // ── برخوردهای قبلی، رو به عقب
    const touches = [b];
    let minSince = Infinity; // کمترین low از آخرین برخوردِ پذیرفته به عقب
    for (let j = b - 1; j >= Math.max(0, b - p.lookback); j--) {
      if (bars[j].h > ref + tol) break; // سطح قبلاً بالاتر بوده ← شمارش تمام
      minSince = Math.min(minSince, bars[j].l);
      if (isPiv[j] && bars[j].h >= ref - tol) {
        const last = touches.at(-1);
        if (last - j >= p.minSpacing && minSince <= ref - deep) {
          touches.push(j);
          minSince = Infinity;
        }
      }
    }
    const n = touches.length;
    if (p.touchMode === 'exact' ? n !== p.priorTouches : n < p.priorTouches) continue;
    touches.reverse();
    const level = touches.reduce((s, q) => s + bars[q].h, 0) / n;
    // ── بعد از b
    let minL = Infinity; let minLi = -1; let pulled = false; let firstIn = -1; let brk = -1;
    for (let j = b + 1; j < bars.length && j <= b + p.lookback; j++) {
      const Aj = a14[j];
      if (firstIn >= 0) {
        if (j - firstIn >= p.approachBars) break;
        if (bars[j].c >= level + p.breakAtr * Aj) { brk = j; break; }
        continue;
      }
      if (!pulled) {
        if (bars[j].h > level + tol || bars[j].c > level + p.breakAtr * Aj) break; // بی‌پولبک رد شد
        if (bars[j].l < minL) { minL = bars[j].l; minLi = j; }
        if (minL <= level - deep) pulled = true;
        continue;
      }
      if (bars[j].h >= level - tol) {
        firstIn = j;
        if (bars[j].c >= level + p.breakAtr * Aj) { brk = j; break; }
      } else if (bars[j].l < minL) { minL = bars[j].l; minLi = j; }
    }
    if (brk < 0 || brk - b < p.minSpacing) continue;
    // پولبکِ بینِ دو برخوردِ آخر (برای نمایش)
    let pull1 = NaN;
    if (n >= 2) {
      let m = Infinity;
      for (let j = touches[n - 2] + 1; j < b; j++) m = Math.min(m, bars[j].l);
      pull1 = (level - m) / A;
    }
    out.push({ i: brk, b, a: touches[0], touches, level, tol, pull1, pull2: (level - minL) / A, pull2i: minLi, firstIn });
  }
  return out;
}

/**
 * سیگنال‌ها با همه‌ی جزئیات و خروج. `daily` کندلِ روزانه برای فیلترِ روند
 * (زمانِ باز شدن t، بسته شدن t + DAY).
 * خروجی: [{ dir, i, level, ..., volX, trendOk, pass, entry, stop, target, exit }]
 */
export function detect(bars, daily, tfMs, p = SR_DEFAULTS) {
  p = { ...SR_DEFAULTS, ...p };
  const a14 = atr(bars, p.atrPeriod);
  const sigs = [];
  for (const [sign, B, D] of [[1, bars, daily], [-1, mirror(bars), mirror(daily)]]) {
    const dEma = ema(D.map((k) => k.c), p.emaPeriod); // روی سریِ قرینه، تا «بالای EMA» برای فروش یعنی «زیرِ EMA»
    const cands = candidatesLong(B, a14, p);
    const seen = new Set();
    cands.sort((x, y) => x.i - y.i || y.b - x.b);
    let dj = -1;
    for (const c of cands) {
      if (seen.has(c.i) || c.i < p.volPeriod) continue;
      seen.add(c.i);
      const i = c.i;
      const A = a14[i];
      let vs = 0;
      for (let j = i - p.volPeriod; j < i; j++) vs += B[j].v;
      const volAvg = vs / p.volPeriod;
      const volX = volAvg > 0 ? B[i].v / volAvg : 0;
      const tClose = B[i].t + tfMs;
      while (dj + 1 < D.length && D[dj + 1].t + DAY_MS <= tClose) dj++;
      if (dj >= 0 && D[dj].t + DAY_MS > tClose) dj = -1;
      const tr = dj >= 0 && Number.isFinite(dEma[dj]) ? { close: D[dj].c, ema: dEma[dj], t: D[dj].t } : null;
      const trendOk = tr ? tr.close > tr.ema : false;
      const breakDistAtr = (B[i].c - c.level) / A;
      // ── ورود: کلوزِ شکست، یا برگشت به سطح
      let ei = i; let rt = null;
      if (p.entryMode === 'retest') {
        ei = -1; rt = { why: 'noRetest' };
        let touchI = -1; let maxH = -Infinity; // دور شدن فقط با کندل‌های بعد از کندلِ شکست
        for (let j = i + 1; j < B.length && j <= i + p.retestBars + p.retestConfirmBars; j++) {
          if (B[j].c < c.level - c.tol) { rt = { why: 'failed', j }; break; } // کلوز زیرِ ناحیه ← شکست شکست خورد
          if (touchI < 0) {
            if (j > i + p.retestBars) break;
            const away = maxH >= c.level + p.retestAwayAtr * A; // فقط کندل‌های قبل از j
            maxH = Math.max(maxH, B[j].h);
            if (away && B[j].l <= c.level + c.tol) touchI = j; else continue;
          }
          if (B[j].l <= c.level - p.stopAtr * A) { rt = { why: 'stopBeforeEntry', j }; break; } // استاپ قبل از ورود خورده
          if (j === touchI && p.touchHold && B[j].c < c.level) { rt = { why: 'touchNoHold', touchI }; break; }
          if (j - touchI >= p.retestConfirmBars) { rt = { why: 'noConfirm', touchI }; break; }
          const okStrong = !p.bounceStrong || (j > touchI && strong(B[j], p.strongBody));
          const okVol = !p.bounceVolMult || B[j].v >= p.bounceVolMult * volAvg;
          if (B[j].c >= c.level && okStrong && okVol) { ei = j; let m = Infinity; for (let q = touchI; q <= j; q++) m = Math.min(m, B[q].l); rt = { why: 'ok', touchI, minL: m }; break; }
        }
        if (ei < 0 && rt.why === 'noRetest' && i + p.retestBars + p.retestConfirmBars >= B.length) rt.why = 'pending';
      }
      if (p.entryMode === 'follow') {
        ei = -1; rt = { why: 'pending' };
        for (let j = i + 1; j <= i + p.followBars; j++) {
          if (j >= B.length) break;
          if (B[j].c < c.level) { rt = { why: 'backInside', j }; break; } // کلوز برگشت زیرِ سطح
          if (p.followDir && !(B[j].c > B[j].o)) { rt = { why: 'wrongDir', j }; break; }
          if (p.followVolMult && B[j].v < p.followVolMult * volAvg) { rt = { why: 'lowVol', j }; break; }
          if (j === i + p.followBars) { ei = j; rt = { why: 'ok' }; }
        }
      }
      const entry = ei >= 0 ? B[ei].c : NaN;
      let stop = c.level - p.stopAtr * A;
      if (entry - stop < p.minStopAtr * A) stop = entry - p.minStopAtr * A;
      const risk = entry - stop;
      const target = entry + p.targetR * risk;
      let exit = null;
      for (let j = ei + 1; ei >= 0 && j < B.length && j <= ei + p.maxHoldBars; j++) {
        if (B[j].l <= stop) { exit = { j, px: stop, why: 'stop' }; break; } // هر دو در یک کندل ← استاپ (محافظه‌کارانه)
        if (B[j].h >= target) { exit = { j, px: target, why: 'target' }; break; }
      }
      if (ei >= 0 && !exit && ei + p.maxHoldBars < B.length) exit = { j: ei + p.maxHoldBars, px: B[ei + p.maxHoldBars].c, why: 'time' };
      const volOk = volX >= p.volMult;
      const breakStrong = strong(B[i], p.strongBody);
      const distOk = breakDistAtr <= p.maxBreakAtr;
      const s = { dir: sign > 0 ? 'long' : 'short', ...c, atr: A, breakDistAtr, volX, volAvg, volOk, trend: tr, trendOk, distOk,
        ei, retest: rt, breakStrong, bounceVolX: ei > i ? B[ei].v / volAvg : null, entry, stop, target, risk, exit, entered: ei >= 0, pass: volOk && trendOk && distOk };
      if (sign < 0) {
        if (s.retest?.minL != null) s.retest = { ...s.retest, minL: -s.retest.minL };
        s.level = -s.level; s.entry = -s.entry; s.stop = -s.stop; s.target = -s.target;
        if (s.exit) s.exit = { ...s.exit, px: -s.exit.px };
        if (s.trend) s.trend = { ...s.trend, close: -s.trend.close, ema: -s.trend.ema };
      }
      sigs.push(s);
    }
  }
  return sigs.sort((x, y) => x.i - y.i);
}

/** R ِ خالص با کارمزد و لغزش هر طرف */
export function netR(sig, { feePct = 0.1, slippagePct = 0.05 } = {}) {
  if (!sig.exit) return null;
  const s = sig.dir === 'short' ? -1 : 1;
  const e = sig.entry * (1 + s * slippagePct / 100);
  const x = sig.exit.px * (1 - s * slippagePct / 100);
  const pnl = s * (x - e) - (feePct / 100) * (e + x);
  return pnl / Math.abs(sig.entry - sig.stop);
}
