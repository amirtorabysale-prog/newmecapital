/**
 * استراتژیِ «پولبکِ اشباع در جهتِ روند» — فعلاً فقط بک‌تست.
 *
 * فرضیه: در روندِ ۴ ساعته، افتِ اشباعیِ RSI ِ یک ساعته که دوباره از باند
 * بیرون می‌آید به جهتِ روند برمی‌گردد؛ پس تارگتِ نزدیک بیشترِ وقت‌ها پیش از
 * استاپِ ساختاری لمس می‌شود.
 *
 * خرید (فروش قرینه است):
 *  ۱. روند: کلوزِ آخرین کندلِ ۴ ساعته‌ی بسته بالای EMA ِ ۴ ساعته (trendEma).
 *  ۲. اشباع: RSI ِ کندلِ یک ساعته‌ی بسته ≤ rsiLevel ← ستاپ مسلح می‌شود.
 *  ۳. ورود (قاعده‌ی استاد): بسته‌شدنِ اولین کندلِ یک ساعته‌ای که RSI اش دوباره
 *     بالای rsiLevel بسته شد، به شرطِ اینکه روند هنوز صعودی باشد. اگر تا
 *     armHours نشد، لغو.
 *  ۴. (اختیاری) کفِ افت باید روی یک ناحیه‌ی حمایتِ استاتیکِ از پیش موجود باشد.
 *  ۵. استاپ: پایینِ کفِ افت منهای slBufferAtr، دست‌کم minStopAtr و حداکثر
 *     maxStopAtr (دورتر = رد). تارگت: tpAtr × ATR. خروجِ زمانی: maxHoldHours.
 *  ۶. کارمزد و لغزش هر طرف از نتیجه کم می‌شود. اگر استاپ و تارگت در یک کندل
 *     لمس شوند، استاپ اول حساب می‌شود.
 */

import { atr, ema, rsi } from './indicators.js';
import { aggregate, buildZones, H1, H4 } from './rsi3.js';

export const PULLBACK_DEFAULTS = {
  rsiPeriod: 14,
  atrPeriod: 14,
  rsiLevel: 30,          // خرید ≤ این؛ فروش ≥ 100 − این
  trendEma: 200,         // EMA ِ ۴ ساعته
  armHours: 12,
  slBufferAtr: 0.5,
  minStopAtr: 1,
  maxStopAtr: 3,
  tpAtr: 1,
  maxHoldHours: 48,
  zoneFilter: false,
  zoneTolAtr: 0.5,
  pivotStrength: 5,
  zoneLookbackDays: 30,
  clusterAtr: 0.3,
  minTouches: 2,
  feePct: 0.1,           // درصد، هر طرف
  slippagePct: 0.05,     // درصد، هر طرف (ورود و خروج هر دو بدتر پر می‌شوند)
  directions: ['long', 'short'],
  baseMs: H1,            // تایم‌فریمِ ماشه (کندل‌های ورودی باید همین باشند)
  trendMs: H4,           // تایم‌فریمِ روند (از کندل‌های ورودی ساخته می‌شود)
};

/** نتیجه‌ی یک معامله روی کندل‌های یک ساعته‌ی بعد از `i`. */
export function simulatePullback(h1, i, plan, p) {
  const long = plan.dir === 'long';
  const s = long ? 1 : -1;
  let j = i + 1;
  let exitPx = null;
  let why = 'TIME';
  let ambiguous = false;
  const last = Math.min(h1.length - 1, i + Math.round((p.maxHoldHours * H1) / p.baseMs));
  for (; j <= last; j++) {
    const k = h1[j];
    const hitSl = long ? k.l <= plan.sl : k.h >= plan.sl;
    const hitTp = long ? k.h >= plan.tp : k.l <= plan.tp;
    if (hitSl) {
      ambiguous = hitTp;
      exitPx = plan.sl;
      why = 'SL';
      break;
    }
    if (hitTp) {
      exitPx = plan.tp;
      why = 'TP';
      break;
    }
  }
  if (exitPx === null) {
    j = last;
    exitPx = h1[j].c;
  }
  // لغزش: ورود و خروج هر دو به ضررِ ما
  const slip = p.slippagePct / 100;
  const entryFill = plan.entry * (1 + s * slip);
  const exitFill = exitPx * (1 - s * slip);
  const gross = (s * (exitPx - plan.entry)) / plan.risk;
  const net = (s * (exitFill - entryFill) - (p.feePct / 100) * (entryFill + exitFill)) / plan.risk;
  return { exitIdx: j, exitT: h1[j].t + p.baseMs, exitPx, why, gross, r: net, ambiguous, bars: j - i };
}

/**
 * @param h1 کندل‌های یک ساعته‌ی بسته
 * @param fromT,toT فقط ورودهایی که در این بازه‌اند (قبلش گرم‌کردنِ اندیکاتورها)
 */
export function backtestPullback(h1, fromT, toT, params = {}) {
  const p = { ...PULLBACK_DEFAULTS, ...params };
  const h4 = aggregate(h1, p.trendMs);
  const r = rsi(h1.map((k) => k.c), p.rsiPeriod);
  const a = atr(h1, p.atrPeriod);
  const e4 = ema(h4.map((k) => k.c), p.trendEma);
  // آخرین کندلِ ۴ ساعته‌ای که تا پایانِ هر کندلِ یک ساعته بسته شده
  const g4 = new Array(h1.length);
  for (let i = 0, g = -1; i < h1.length; i++) {
    const tEnd = h1[i].t + p.baseMs;
    while (g + 1 < h4.length && h4[g + 1].t + p.trendMs <= tEnd) g++;
    g4[i] = g;
  }
  const trend = (i) => {
    const g = g4[i];
    if (g < 0 || !Number.isFinite(e4[g])) return 0;
    return h4[g].c > e4[g] ? 1 : h4[g].c < e4[g] ? -1 : 0;
  };

  const funnel = { armed: 0, timeout: 0, trendFlip: 0, rejectStop: 0, rejectZone: 0, trades: 0 };
  const trades = [];
  let setup = null;
  let blocked = null;
  let i = h1.findIndex((k) => k.t >= fromT);
  if (i < 0) return { trades, funnel, params: p };

  for (; i < h1.length && h1[i].t < toT; i++) {
    const k = h1[i];
    if (!Number.isFinite(r[i]) || !Number.isFinite(a[i])) continue;

    if (setup) {
      const long = setup.dir === 'long';
      setup.ext = long ? Math.min(setup.ext, k.l) : Math.max(setup.ext, k.h);
      const out = long ? r[i] > p.rsiLevel : r[i] < 100 - p.rsiLevel;
      if (out) {
        const st = setup;
        setup = null;
        if (trend(i) !== (long ? 1 : -1)) {
          funnel.trendFlip++;
        } else {
          const res = plan(st, i);
          if (res.reject) {
            funnel[res.reject]++;
          } else {
            const sim = simulatePullback(h1, i, res.plan, p);
            funnel.trades++;
            trades.push({ ...res.plan, ...sim });
            i = sim.exitIdx; // یک معامله‌ی باز در هر نماد
          }
        }
        continue;
      }
      if (i - setup.idx >= (p.armHours * H1) / p.baseMs) {
        funnel.timeout++;
        blocked = setup.dir; // لغوشده: تا RSI از باند بیرون نیامده دوباره مسلح نشو
        setup = null;
      }
      continue;
    }

    if (blocked && (blocked === 'long' ? r[i] > p.rsiLevel : r[i] < 100 - p.rsiLevel)) blocked = null;
    for (const dir of p.directions) {
      const long = dir === 'long';
      if (blocked === dir) continue;
      if (trend(i) !== (long ? 1 : -1)) continue;
      if (long ? r[i] > p.rsiLevel : r[i] < 100 - p.rsiLevel) continue;
      funnel.armed++;
      setup = { dir, idx: i, armedT: k.t + p.baseMs, ext: long ? k.l : k.h, rsiMin: r[i] };
      break;
    }
  }

  function plan(st, i) {
    const long = st.dir === 'long';
    const s = long ? 1 : -1;
    const A = a[i];
    const entry = h1[i].c;
    let sl = st.ext - s * p.slBufferAtr * A;
    let risk = s * (entry - sl);
    if (risk > p.maxStopAtr * A) return { reject: 'rejectStop' };
    if (risk < p.minStopAtr * A) {
      risk = p.minStopAtr * A;
      sl = entry - s * risk;
    }
    if (p.zoneFilter) {
      // ناحیه باید پیش از شروعِ افت وجود داشته باشد، نه اینکه کفِ همین افت بسازدش
      // buildZones روزها را ۲۴ کندل حساب می‌کند؛ برای تایم‌فریمِ بزرگ‌تر مقیاس شود
      const zp = { ...p, zoneLookbackDays: (p.zoneLookbackDays * H1) / p.baseMs };
      const zones = buildZones(h1, st.idx - 1, a[st.idx - 1], zp).filter((z) => z.touches >= p.minTouches);
      const tol = p.zoneTolAtr * A;
      if (!zones.some((z) => st.ext >= z.lo - tol && st.ext <= z.hi + tol)) return { reject: 'rejectZone' };
    }
    return {
      plan: {
        dir: st.dir, t: h1[i].t + p.baseMs, armedT: st.armedT, entry, sl, risk,
        tp: entry + s * p.tpAtr * A, atr: A, riskAtr: risk / A, rsiAtArm: st.rsiMin,
      },
    };
  }

  return { trades, funnel, params: p };
}

/** آمار: تعداد، برد، میانگینِ برد/باخت، PF، امیدِ ریاضی و افتِ حداکثر (R). */
export function pbStats(trades) {
  const n = trades.length;
  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r <= 0);
  const sumW = wins.reduce((s, t) => s + t.r, 0);
  const sumL = -losses.reduce((s, t) => s + t.r, 0);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of [...trades].sort((x, y) => x.exitT - y.exitT)) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return {
    n,
    winRate: n ? wins.length / n : 0,
    avgWin: wins.length ? sumW / wins.length : 0,
    avgLoss: losses.length ? sumL / losses.length : 0,
    pf: sumL > 0 ? sumW / sumL : (sumW > 0 ? Infinity : 0),
    totalR: sumW - sumL,
    avgR: n ? (sumW - sumL) / n : 0,
    maxDD: dd,
    ambiguous: trades.filter((t) => t.ambiguous).length,
  };
}
