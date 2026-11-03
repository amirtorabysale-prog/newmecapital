/**
 * ریسک و اندازه‌ی معامله برای استراتژیِ کاندید (EMA50 ِ روزانه، استاپِ فاجعه
 * ۳ATR). همه‌چیز پیش از اجرا تعیین شده؛ هیچ پارامترِ استراتژی این‌جا انتخاب
 * نمی‌شود — فقط «با این استراتژی چقدر ریسک کنم» سنجیده می‌شود.
 *
 *   1. سبدِ واقعی با مرکب‌سازی و ارزش‌گذاریِ روزانه (mark-to-market)،
 *      ریسکِ ۰.۵ / ۱ / ۲ درصد در هر معامله، و سقفِ اکسپوژرِ ۱۰۰٪ (اسپات، بی‌اهرم).
 *   2. بوت‌استرپِ بلوکیِ ماهانه روی بازده‌ی روزانه ← توزیعِ افت و بازده در ۵ سال.
 *   3. رشته‌ی ضرر: واقعی، و احتمالِ رشته‌ی بلند در ۱۰۰ معامله‌ی بعد.
 *   4. جا انداختنِ سیگنال: اگر ۲۰٪ ِ سیگنال‌ها تصادفی اجرا نشوند.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { pbStats } from '../../src/strategy/pullback.js';
import { loadUniverse, EXTRA_UNIVERSE, DAY, fmt } from './lib.js';
import { prep, FAMILIES, run, buyHold } from './engine.js';

const cfg = loadConfig();
const now = Math.floor(Date.now() / DAY) * DAY;
const W = (await loadUniverse(cfg.watchlist, { years: 5, warmupDays: 60 })).data.map(prep);
const X = (await loadUniverse(EXTRA_UNIVERSE, { years: 5, warmupDays: 60 })).data.map(prep);
const ALL = [...W, ...X];
const P = { n: 50 };
const C = FAMILIES.C;

// اعدادِ تصادفیِ تکرارپذیر (mulberry32) — نتیجه‌ی هر اجرا یکی است
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * سبد با مرکب‌سازی. ورود و خروج با کلوزِ روزانه (همان قیمت‌های موتور)،
 * سود و زیانِ بسته‌شده دقیقاً r × ریسکِ دلاری (با کارمزد و لغزش)، و
 * معامله‌های باز هر روز با کلوز ارزش‌گذاری می‌شوند.
 */
function simulate(xs, trades, { riskPct, maxExposure = 1 }) {
  const byEntry = new Map();
  const byExit = new Map();
  for (const tr of trades) {
    const k = `${tr.id}:${tr.t}`;
    (byEntry.get(tr.t) ?? byEntry.set(tr.t, []).get(tr.t)).push(tr);
    (byExit.get(tr.exitT) ?? byExit.set(tr.exitT, []).get(tr.exitT)).push(k);
  }
  const closeAt = new Map(xs.map((x) => [x.id, x.idx]));
  const t0 = Math.min(...xs.map((x) => x.startT));
  const days = [];
  for (let t = t0; t < now; t += DAY) days.push(t);
  let cash = 1; // سرمایه‌ی تحقق‌یافته
  const open = new Map(); // کلید ← { tr, units, last }
  const eq = [];
  let skipped = 0; let scaled = 0; let inMarket = 0; let expoSum = 0;
  for (const T of days) {
    const close = T + DAY; // زمانِ بسته شدنِ کندلِ روزِ T
    for (const k of byExit.get(close) || []) {
      const pos = open.get(k);
      if (!pos) continue;
      cash += pos.units * pos.tr.risk * pos.tr.r;
      open.delete(k);
    }
    let unreal = 0; let notional = 0;
    for (const pos of open.values()) {
      const x = closeAt.get(pos.tr.id);
      const i = x.get(T);
      if (i !== undefined) pos.last = xs.find((y) => y.id === pos.tr.id).c[i];
      unreal += pos.units * (pos.last - pos.tr.entry);
      notional += pos.units * pos.last;
    }
    let equity = cash + unreal;
    for (const tr of byEntry.get(close) || []) {
      let units = (riskPct / 100) * equity / tr.risk;
      const room = maxExposure * equity - notional;
      if (room <= 0) { skipped++; continue; }
      if (units * tr.entry > room) { units = room / tr.entry; scaled++; }
      open.set(`${tr.id}:${tr.t}`, { tr, units, last: tr.entry });
      notional += units * tr.entry;
    }
    if (open.size) inMarket++;
    expoSum += equity > 0 ? notional / equity : 0;
    eq.push({ t: close, v: equity });
  }
  return { eq, skipped, scaled, inMarketPct: (inMarket / days.length) * 100, avgExposurePct: (expoSum / days.length) * 100 };
}

function curveStats(eq) {
  const rets = [];
  for (let i = 1; i < eq.length; i++) rets.push(eq[i].v / eq[i - 1].v - 1);
  return { ...ddStats(eq.map((e) => e.v)), ...retStats(rets, eq.length / 365), worstMonthPct: worstMonth(eq) };
}

function ddStats(v) {
  let peak = v[0]; let dd = 0; let start = 0; let longest = 0; let peakI = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] >= peak) { peak = v[i]; longest = Math.max(longest, i - peakI); peakI = i; }
    dd = Math.max(dd, 1 - v[i] / peak);
  }
  longest = Math.max(longest, v.length - 1 - peakI);
  void start;
  return { maxDDPct: dd * 100, longestDDDays: longest, finalMult: v.at(-1) / v[0] };
}

function retStats(rets, years) {
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
  const total = rets.reduce((a, r) => a * (1 + r), 1);
  return { cagrPct: (total ** (1 / years) - 1) * 100, sharpe: sd ? (m / sd) * Math.sqrt(365) : 0 };
}

function worstMonth(eq) {
  let worst = 0;
  for (let i = 30; i < eq.length; i += 1) worst = Math.min(worst, eq[i].v / eq[i - 30].v - 1);
  return worst * 100;
}

/** بوت‌استرپِ بلوکی: بلوک‌های ۳۰ روزه از بازده‌ی روزانه، با طولِ برابر با تاریخچه */
function bootstrap(eq, n = 2000, seed = 7) {
  const r = rng(seed);
  const rets = [];
  for (let i = 1; i < eq.length; i++) rets.push(eq[i].v / eq[i - 1].v - 1);
  const B = 30;
  const out = [];
  for (let s = 0; s < n; s++) {
    const v = [1];
    while (v.length <= rets.length) {
      const st = Math.floor(r() * (rets.length - B));
      for (let j = 0; j < B && v.length <= rets.length; j++) v.push(v.at(-1) * (1 + rets[st + j]));
    }
    const d = ddStats(v);
    out.push({ dd: d.maxDDPct, mult: d.finalMult });
  }
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const dds = out.map((o) => o.dd); const ms = out.map((o) => o.mult);
  return {
    ddMedian: q(dds, 0.5), dd95: q(dds, 0.95), dd99: q(dds, 0.99),
    multMedian: q(ms, 0.5), mult5: q(ms, 0.05), pLoss: ms.filter((m) => m < 1).length / ms.length,
  };
}

function longestLosing(trades) {
  let cur = 0; let best = 0;
  for (const t of [...trades].sort((a, b) => a.exitT - b.exitT)) {
    cur = t.r <= 0 ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** احتمالِ دست‌کم یک رشته‌ی ≥ k ضرر در N معامله‌ی بعد، با وین‌ریتِ p (مستقل) */
function pStreak(p, N, k, sims = 20000, seed = 11) {
  const r = rng(seed);
  let hit = 0;
  for (let s = 0; s < sims; s++) {
    let cur = 0;
    for (let i = 0; i < N; i++) {
      cur = r() < p ? 0 : cur + 1;
      if (cur >= k) { hit++; break; }
    }
  }
  return hit / sims;
}

const md = ['# ریسک و اندازه‌ی معامله — EMA50 ِ روزانه، استاپِ فاجعه ۳ATR', ''];
md.push('- همان معامله‌های موتورِ پژوهش (کارمزد ۰.۱٪ و لغزش ۰.۰۵٪ هر طرف). این‌جا هیچ پارامترِ استراتژی انتخاب نمی‌شود.');
md.push('- سبد: سرمایه مرکب می‌شود؛ ریسکِ هر معامله درصدی از سرمایه‌ی همان روز تا استاپ؛ سقفِ اکسپوژر ۱۰۰٪ (اسپات، بی‌اهرم) — اگر جا نبود حجم کم یا معامله رد می‌شود.');
md.push('- افت با ارزش‌گذاریِ روزانه‌ی معامله‌های باز است، نه فقط معامله‌های بسته — یعنی همان چیزی که در حساب دیده می‌شود.', '');

const sets = [['واچ‌لیست (۸ نماد)', W], ['همه‌ی ۲۸ نماد', ALL]];
const sims = {};
md.push('## ۱. سبد با مرکب‌سازی', '', '| جهان | ریسکِ هر معامله | بازده‌ی سالانه | افتِ حداکثر | طولانی‌ترین افت (روز) | بدترین ۳۰ روز | شارپ | ضریبِ سرمایه | میانگینِ اکسپوژر | ردشده/کوچک‌شده |', '|---|---|---|---|---|---|---|---|---|---|');
for (const [label, xs] of sets) {
  const trades = run(C, P, xs, null, 0, now + DAY);
  for (const riskPct of [0.5, 1, 2]) {
    const sim = simulate(xs, trades, { riskPct });
    const s = curveStats(sim.eq);
    sims[`${label}:${riskPct}`] = { sim, s, trades };
    md.push(`| ${label} | ${riskPct}% | ${fmt(s.cagrPct, 1)}% | ${s.maxDDPct.toFixed(1)}% | ${s.longestDDDays} | ${s.worstMonthPct.toFixed(1)}% | ${s.sharpe.toFixed(2)} | ×${s.finalMult.toFixed(2)} | ${sim.avgExposurePct.toFixed(0)}% | ${sim.skipped}/${sim.scaled} |`);
  }
}

md.push('', '**معیار — خرید و نگهداریِ وزنِ برابر (همان دوره):**', '');
for (const [label, xs] of sets) {
  const b = buyHold(xs, Math.min(...xs.map((x) => x.startT)), now + DAY);
  md.push(`- ${label}: بازده‌ی سالانه ${fmt(b.annualPct, 1)}٪، افتِ حداکثر ${b.maxDDPct.toFixed(1)}٪، شارپ ${b.sharpe.toFixed(2)}`);
}
md.push('', '**سال‌به‌سال (ریسکِ ۱٪):**', '', '| سال | واچ‌لیست: بازده / افت | ۲۸ نماد: بازده / افت |', '|---|---|---|');
{
  const yr = (eq) => { const m = new Map(); for (const e of eq) { const y = new Date(e.t - 1).getUTCFullYear(); if (!m.has(y)) m.set(y, []); m.get(y).push(e.v); } return m; };
  const a = yr(sims['واچ‌لیست (۸ نماد):1'].sim.eq); const b = yr(sims['همه‌ی ۲۸ نماد:1'].sim.eq);
  const cell = (v) => { if (!v) return '—'; const d = ddStats(v); return `${fmt((v.at(-1) / v[0] - 1) * 100, 1)}٪ / ${d.maxDDPct.toFixed(1)}٪`; };
  for (const y of [...new Set([...a.keys(), ...b.keys()])].sort()) md.push(`| ${y} | ${cell(a.get(y))} | ${cell(b.get(y))} |`);
}

md.push('', '## ۲. بوت‌استرپ (۲۰۰۰ مسیرِ ۵ ساله از بلوک‌های ۳۰ روزه)', '');
md.push('مسیرهای ممکنِ دیگر با همان رفتارِ ماهانه — گذشته فقط یکی از آن‌هاست.', '');
md.push('| جهان | ریسک | افتِ میانه | افتِ ۹۵٪ | افتِ ۹۹٪ | ضریبِ میانه | ضریبِ ۵٪ ِ بد | احتمالِ ضرر در ۵ سال |', '|---|---|---|---|---|---|---|---|');
for (const [label] of sets) {
  for (const riskPct of [0.5, 1, 2]) {
    const b = bootstrap(sims[`${label}:${riskPct}`].sim.eq);
    md.push(`| ${label} | ${riskPct}% | ${b.ddMedian.toFixed(1)}% | ${b.dd95.toFixed(1)}% | ${b.dd99.toFixed(1)}% | ×${b.multMedian.toFixed(2)} | ×${b.mult5.toFixed(2)} | ${(b.pLoss * 100).toFixed(1)}% |`);
  }
}

md.push('', '## ۳. رشته‌ی ضرر', '');
for (const [label] of sets) {
  const tr = sims[`${label}:1`].trades;
  const s = pbStats(tr);
  md.push(`- ${label}: ${s.n} معامله، وین‌ریت ${(s.winRate * 100).toFixed(1)}٪، طولانی‌ترین رشته‌ی ضررِ واقعی **${longestLosing(tr)}** معامله.`);
}
const p = pbStats(sims['همه‌ی ۲۸ نماد:1'].trades).winRate;
md.push('', `با وین‌ریتِ ${(p * 100).toFixed(0)}٪، در ۱۰۰ معامله‌ی بعد احتمالِ دست‌کم یک رشته‌ی:`);
for (const k of [8, 10, 15, 20]) md.push(`- ${k} ضررِ پشتِ سرِ هم: ${(pStreak(p, 100, k) * 100).toFixed(0)}٪`);

md.push('', '## ۴. جا انداختنِ سیگنال (واچ‌لیست، ریسکِ ۱٪)', '');
{
  const tr = sims['واچ‌لیست (۸ نماد):1'].trades;
  const full = curveStats(simulate(W, tr, { riskPct: 1 }).eq);
  const r = rng(5);
  const res = [];
  for (let s = 0; s < 300; s++) {
    const kept = tr.filter(() => r() >= 0.2);
    res.push(curveStats(simulate(W, kept, { riskPct: 1 }).eq).cagrPct);
  }
  res.sort((a, b) => a - b);
  md.push(`- همه‌ی سیگنال‌ها: بازده‌ی سالانه ${fmt(full.cagrPct, 1)}٪`);
  md.push(`- ۲۰٪ تصادفی جا افتاده (۳۰۰ بار): میانه ${fmt(res[150], 1)}٪، ۱۰٪ ِ بد ${fmt(res[30], 1)}٪، بدترین ${fmt(res[0], 1)}٪`);
}

mkdirSync(join('out', 'research'), { recursive: true });
writeFileSync(join('out', 'research', 'trend-risk.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
