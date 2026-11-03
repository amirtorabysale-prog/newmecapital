/**
 * استراتژیِ «اشباعِ سه‌تایم‌فریمی» (استاد مهدی) — فعلاً فقط برای بک‌تست.
 *
 * خرید: RSI ِ ۵ دقیقه، ۱ ساعته و ۴ ساعته هم‌زمان ≤ oversold و قیمت روی یک
 * ناحیه‌ی حمایتِ استاتیکِ معتبرِ یک ساعته. فروش برعکس (≥ overbought، مقاومت).
 * RSI ِ ۱ و ۴ ساعته «زنده» است: کندلِ در حالِ شکل‌گیری با قیمتِ همان لحظه.
 *
 * ورود: بسته‌شدنِ اولین کندلِ یک ساعته‌ای که RSI ِ (بسته‌ی) یک ساعته‌اش از
 * باند بیرون آمد؛ اگر تا cancelHours نیامد ستاپ لغو می‌شود. اگر پیش از ورود
 * قیمت از جای حدضرر رد شد، ستاپ باطل است (فرضِ ما؛ در دستورِ کار نیامده).
 *
 * ورودی فقط کندلِ ۵ دقیقه است؛ ۱ و ۴ ساعته از همان ساخته می‌شوند تا هر سه
 * تایم‌فریم دقیقاً از یک منبع باشند. ۴ ساعته روی ۰۰:۰۰ UTC هم‌تراز است، مثلِ
 * تریدینگ‌ویو روی بایننس.
 */

import { atr, rsi } from './indicators.js';

export const RSI3_DEFAULTS = {
  rsiPeriod: 14,
  atrPeriod: 14,
  oversold: 15,
  overbought: 80,
  pivotStrength: 5,     // کف/سقفِ چرخشیِ یک ساعته: ۵ کندل هر طرف
  zoneLookbackDays: 30,
  clusterAtr: 0.3,      // نقطه‌های نزدیک‌تر از این یک ناحیه‌اند
  minTouches: 2,
  zoneTolAtr: 0.3,      // «روی ناحیه» = سایه تا این فاصله از لبه‌ی ناحیه رسیده
  cancelHours: 12,
  slBufferAtr: 0.5,
  maxStopAtr: 2,
  minRR: 2,
  tp2FallbackR: 3,
  tp1Share: 0.5,
  maxHoldHours: 24,
  feePct: 0.1,          // درصد، برای هر طرف
  directions: ['long', 'short'],
};

export const M5 = 300_000;
export const H1 = 3_600_000;
export const H4 = 14_400_000;

/** کندل‌های کوچک را به تایم‌فریمِ بزرگ‌تر جمع می‌کند (هم‌تراز با زمانِ یونیکس). */
export function aggregate(candles, ms) {
  const out = [];
  for (const k of candles) {
    const t = Math.floor(k.t / ms) * ms;
    const last = out.at(-1);
    if (last && last.t === t) {
      if (k.h > last.h) last.h = k.h;
      if (k.l < last.l) last.l = k.l;
      last.c = k.c;
      last.v += k.v;
    } else {
      out.push({ t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v });
    }
  }
  return out;
}

/** میانگینِ سود و زیانِ وایلدر بعد از هر کندل — برای محاسبه‌ی RSI ِ زنده. */
export function wilderState(closes, period = 14) {
  const ag = new Array(closes.length).fill(NaN);
  const al = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return { ag, al };
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= period;
  l /= period;
  ag[period] = g;
  al[period] = l;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    ag[i] = g;
    al[i] = l;
  }
  return { ag, al };
}

/**
 * RSI ِ کندلِ در حالِ شکل‌گیری: آخرین کندلِ بسته `k` است و قیمتِ فعلی `price`.
 * دقیقاً همان عددی است که اگر کندلِ جاری با این قیمت بسته شود دیده می‌شود.
 */
export function liveRsi(state, closes, k, price, period = 14) {
  if (k < 0 || !Number.isFinite(state.ag[k])) return NaN;
  const d = price - closes[k];
  const g = (state.ag[k] * (period - 1) + Math.max(d, 0)) / period;
  const l = (state.al[k] * (period - 1) + Math.max(-d, 0)) / period;
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

/**
 * ناحیه‌های استاتیک از کف و سقف‌های چرخشیِ تأییدشده تا کندلِ بسته‌ی `end`
 * (شامل). کف و سقف با هم خوشه می‌شوند — سقفِ شکسته حمایت می‌شود.
 * @returns {{lo, hi, touches, points: {i, p}[]}[]} مرتب از پایین به بالا
 */
export function buildZones(h1, end, atrVal, p) {
  const s = p.pivotStrength;
  const start = Math.max(s, end - p.zoneLookbackDays * 24 + 1);
  const pts = [];
  for (let i = start; i <= end - s; i++) {
    let low = true;
    let high = true;
    for (let j = i - s; j <= i + s && (low || high); j++) {
      if (j === i) continue;
      if (h1[j].l < h1[i].l || (j < i && h1[j].l === h1[i].l)) low = false;
      if (h1[j].h > h1[i].h || (j < i && h1[j].h === h1[i].h)) high = false;
    }
    if (low) pts.push({ i, p: h1[i].l });
    if (high) pts.push({ i, p: h1[i].h });
  }
  pts.sort((a, b) => a.p - b.p);
  const gap = p.clusterAtr * atrVal;
  const zones = [];
  for (const pt of pts) {
    const z = zones.at(-1);
    // پهنای کلِ ناحیه از gap بیشتر نمی‌شود — مقایسه با لبه‌ی پایین، نه نقطه‌ی قبلی،
    // وگرنه زنجیره‌ی نقطه‌های نزدیک کلِ رنج را یک «ناحیه» می‌کند
    if (z && pt.p - z.lo < gap) {
      z.hi = pt.p;
      z.points.push(pt);
    } else {
      zones.push({ lo: pt.p, hi: pt.p, points: [pt] });
    }
  }
  for (const z of zones) z.touches = z.points.length;
  return zones;
}

/** نتیجه‌ی معامله با کندل‌های ۵ دقیقه، از کندلِ بعد از `from`. */
export function simulateTrade(c5, from, plan, p) {
  const long = plan.dir === 'long';
  const up = (k, v) => (long ? k.h >= v : k.l <= v);
  const down = (k, v) => (long ? k.l <= v : k.h >= v);
  const rOf = (px) => ((long ? 1 : -1) * (px - plan.entry)) / plan.risk;
  const end = plan.t + p.maxHoldHours * H1;
  let sl = plan.sl;
  let left = 1;
  let tp1Hit = false;
  const fills = [];
  let j = from + 1;
  for (; j < c5.length && c5[j].t + M5 <= end; j++) {
    const k = c5[j];
    // استاپ و تارگت در یک کندل: بدبینانه، استاپ اول
    if (down(k, sl)) {
      fills.push({ px: sl, w: left, why: tp1Hit ? 'BE' : 'SL', t: k.t + M5 });
      left = 0;
      break;
    }
    if (!tp1Hit && up(k, plan.tp1)) {
      const w = plan.tp2 === plan.tp1 ? 1 : p.tp1Share;
      fills.push({ px: plan.tp1, w, why: 'TP1', t: k.t + M5 });
      left -= w;
      tp1Hit = true;
      sl = plan.entry;
    }
    if (tp1Hit && left > 0 && up(k, plan.tp2)) {
      fills.push({ px: plan.tp2, w: left, why: 'TP2', t: k.t + M5 });
      left = 0;
    }
    if (left <= 1e-9) break;
  }
  if (left > 1e-9) {
    const last = c5[Math.min(j, c5.length) - 1];
    fills.push({ px: last.c, w: left, why: 'TIME', t: last.t + M5 });
  }
  const gross = fills.reduce((s, f) => s + f.w * rOf(f.px), 0);
  const fee = (p.feePct / 100) * (plan.entry + fills.reduce((s, f) => s + f.w * f.px, 0)) / plan.risk;
  const last = fills.at(-1);
  const outcome = fills.some((f) => f.why === 'TP2') ? 'TP2'
    : tp1Hit ? (last.why === 'TIME' ? 'TP1+TIME' : 'TP1+BE')
      : last.why;
  return { fills, r: gross - fee, gross, fee, outcome, exitT: last.t, exitIdx: Math.min(j, c5.length - 1) };
}

function bucketsBefore(big, ms) {
  // برای هر زمان: اندیسِ آخرین کندلِ بزرگِ بسته
  const idx = new Map(big.map((k, i) => [k.t, i]));
  return (tEnd) => {
    let t = Math.floor(tEnd / ms) * ms - ms; // کندلی که تا tEnd بسته شده
    while (t >= big[0].t) {
      const i = idx.get(t);
      if (i !== undefined) return i;
      t -= ms;
    }
    return -1;
  };
}

/**
 * بک‌تستِ یک نماد.
 * @param c5 کندل‌های ۵ دقیقه‌ی بسته، به ترتیبِ زمان
 * @param fromT از این زمان به بعد ستاپ پیدا می‌شود (قبلش گرم‌کردنِ اندیکاتورها)
 */
export function backtestRsi3(c5, fromT, params = {}) {
  const p = { ...RSI3_DEFAULTS, ...params };
  const h1 = aggregate(c5, H1);
  const h4 = aggregate(c5, H4);
  const cl5 = c5.map((k) => k.c);
  const cl1 = h1.map((k) => k.c);
  const cl4 = h4.map((k) => k.c);
  const r5 = rsi(cl5, p.rsiPeriod);
  const r1 = rsi(cl1, p.rsiPeriod);
  const r4 = rsi(cl4, p.rsiPeriod);
  const s1 = wilderState(cl1, p.rsiPeriod);
  const s4 = wilderState(cl4, p.rsiPeriod);
  const a1 = atr(h1, p.atrPeriod);
  const last1 = bucketsBefore(h1, H1);
  const last4 = bucketsBefore(h4, H4);
  const zoneCache = new Map();
  const zonesAt = (h) => {
    if (!zoneCache.has(h)) zoneCache.set(h, buildZones(h1, h, a1[h], p));
    return zoneCache.get(h);
  };

  const funnel = {
    hours5m: new Set(), hours5m1h: new Set(), hoursTriple: new Set(), hoursOnZone: new Set(),
    tripleLong: new Set(), tripleShort: new Set(),
    armed: 0, cancelTimeout: 0, cancelInvalid: 0, entered: 0,
    rejectStop: 0, rejectRR: 0, rejectNoTarget: 0, trades: 0,
  };
  const trades = [];
  let setup = null;
  const startIdx = c5.findIndex((k) => k.t >= fromT);
  if (startIdx < 0) return { trades, funnel: countFunnel(funnel), h1, h4, r5, r1, r4, params: p };

  for (let i = startIdx; i < c5.length; i++) {
    const k = c5[i];
    const tEnd = k.t + M5;
    const h = last1(tEnd);
    const g = last4(tEnd);
    if (h < 0 || g < 0 || !Number.isFinite(a1[h])) continue;
    const hourKey = Math.floor(k.t / H1);

    // ── ستاپِ مسلح: منتظرِ کندلِ یک ساعته‌ای که RSI اش از باند بیرون بیاید
    if (setup) {
      const long = setup.dir === 'long';
      const invalid = long ? k.l <= setup.invalidPx : k.h >= setup.invalidPx;
      if (invalid) {
        funnel.cancelInvalid++;
        setup = null;
      } else if (tEnd % H1 === 0 && h1[h].t >= setup.hourT) {
        const out = long ? r1[h] > p.oversold : r1[h] < p.overbought;
        if (out) {
          funnel.entered++;
          const res = makePlan(setup, h, tEnd);
          setup = null;
          if (res.reject) {
            funnel[res.reject]++;
          } else {
            const sim = simulateTrade(c5, i, res.plan, p);
            funnel.trades++;
            trades.push({ ...res.plan, ...sim });
            i = sim.exitIdx; // یک معامله‌ی باز در هر نماد
            continue;
          }
        } else if (tEnd - setup.armedT >= p.cancelHours * H1) {
          funnel.cancelTimeout++;
          setup = null;
        }
      }
      if (setup) continue;
    }

    // ── جست‌وجوی اشباعِ سه‌تایم‌فریمی
    for (const dir of p.directions) {
      const long = dir === 'long';
      const inBand = (v) => (long ? v <= p.oversold : v >= p.overbought);
      if (!inBand(r5[i])) continue;
      funnel.hours5m.add(`${dir}:${hourKey}`);
      const live1 = liveRsi(s1, cl1, h, k.c, p.rsiPeriod);
      if (!inBand(live1)) continue;
      funnel.hours5m1h.add(`${dir}:${hourKey}`);
      const live4 = liveRsi(s4, cl4, g, k.c, p.rsiPeriod);
      if (!inBand(live4)) continue;
      funnel.hoursTriple.add(`${dir}:${hourKey}`);
      funnel[long ? 'tripleLong' : 'tripleShort'].add(hourKey);
      const tol = p.zoneTolAtr * a1[h];
      const zone = zonesAt(h)
        .filter((z) => z.touches >= p.minTouches)
        .filter((z) => (long
          ? k.l <= z.hi + tol && k.c >= z.lo - tol
          : k.h >= z.lo - tol && k.c <= z.hi + tol))
        .sort((a, b) => Math.abs((a.lo + a.hi) / 2 - k.c) - Math.abs((b.lo + b.hi) / 2 - k.c))[0];
      if (!zone) continue;
      funnel.hoursOnZone.add(`${dir}:${hourKey}`);
      funnel.armed++;
      const buf = p.slBufferAtr * a1[h];
      setup = {
        dir, zone, armedT: tEnd, armedIdx: i, hourT: Math.floor(k.t / H1) * H1,
        invalidPx: long ? zone.lo - buf : zone.hi + buf,
        rsiAtArm: { r5: r5[i], r1: live1, r4: live4 },
      };
      break;
    }
  }

  function makePlan(st, h, tEnd) {
    const long = st.dir === 'long';
    const sgn = long ? 1 : -1;
    const entry = h1[h].c;
    const A = a1[h];
    const sl = long ? st.zone.lo - p.slBufferAtr * A : st.zone.hi + p.slBufferAtr * A;
    const risk = sgn * (entry - sl);
    if (!(risk > 0) || risk > p.maxStopAtr * A) return { reject: 'rejectStop' };
    // تارگت: لبه‌ی نزدیکِ ناحیه‌های معتبرِ بعدی در مسیر
    const levels = zonesAt(h)
      .filter((z) => z.touches >= p.minTouches && z !== st.zone)
      .map((z) => (long ? z.lo : z.hi))
      .filter((v) => sgn * (v - entry) > 0)
      .sort((a, b) => sgn * (a - b));
    if (!levels.length) return { reject: 'rejectNoTarget' };
    const tp1 = levels[0];
    const rr1 = (sgn * (tp1 - entry)) / risk;
    if (rr1 < p.minRR) return { reject: 'rejectRR' };
    let tp2 = levels[1];
    if (tp2 === undefined) {
      const fb = entry + sgn * p.tp2FallbackR * risk;
      tp2 = sgn * (fb - tp1) > 0 ? fb : tp1;
    }
    return {
      plan: {
        dir: st.dir, t: tEnd, armedT: st.armedT, entry, sl, risk, tp1, tp2, rr1,
        rr2: (sgn * (tp2 - entry)) / risk, atr: A,
        zone: { lo: st.zone.lo, hi: st.zone.hi, touches: st.zone.touches, points: st.zone.points.map((q) => h1[q.i].t) },
        rsiAtArm: st.rsiAtArm, rsiAtEntry: r1[h], h1Idx: h,
      },
    };
  }

  return { trades, funnel: countFunnel(funnel), h1, h4, r5, r1, r4, params: p };
}

function countFunnel(f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) out[k] = v instanceof Set ? v.size : v;
  return out;
}

/** آمارِ یک فهرستِ معامله: تعداد، درصدِ برد، مجموع و میانگینِ R، افتِ حداکثر (بر حسبِ R). */
export function stats(trades) {
  const n = trades.length;
  const sorted = [...trades].sort((a, b) => a.exitT - b.exitT);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of sorted) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const wins = trades.filter((t) => t.r > 0).length;
  const total = trades.reduce((s, t) => s + t.r, 0);
  return { n, wins, winRate: n ? wins / n : 0, totalR: total, avgR: n ? total / n : 0, maxDD: dd };
}
