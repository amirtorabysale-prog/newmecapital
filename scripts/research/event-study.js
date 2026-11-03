/**
 * مطالعه‌ی رویداد: آیا یک سیگنال درباره‌ی بازده‌ی بعدی اطلاعات دارد؟
 *
 * برای هر سیگنال و هر افق: بازده‌ی لگاریتمیِ از کلوزِ کندلِ سیگنال تا h کندل
 * بعد، منهای میانگینِ بی‌قیدِ همان نماد در همان دوره («مازاد» — اثرِ روندِ
 * کلیِ بازار را حذف می‌کند). رویدادها با فاصله‌ی h از هم برداشته می‌شوند. آماره‌ی t
 * با خطای معیارِ خوشه‌ای بر حسبِ ماه است (همبستگیِ هم‌زمانِ نمادها آن را باد نکند).
 *
 * سه نمونه: داخل (واچ‌لیست، تا ۳۶۵ روز پیش)، خارج (واچ‌لیست، سالِ آخر)،
 * جهان (۲۰ نمادِ دیگر، کلِ دوره).
 *
 * معیارِ قبولی، پیش از اجرا اعلام‌شده: t ِ داخل ≥ ۳، هم‌علامت در خارج، و
 * t ِ جهان ≥ ۲ با همان علامت. حدودِ ۱۵۰ آزمون انجام می‌شود؛ با t ≥ ۳ انتظارِ
 * قبولیِ شانسی کمتر از یکی است.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { aggregate } from '../../src/strategy/rsi3.js';
import { atr, ema, rsi } from '../../src/strategy/indicators.js';
import { loadUniverse, EXTRA_UNIVERSE, H1, DAY } from './lib.js';
import { loadFunding } from './funding.js';

const cfg = loadConfig();
const now = Math.floor(Date.now() / DAY) * DAY;
const splitT = now - 365 * DAY;
const TFMS = { '1h': H1, '4h': 4 * H1, '1d': DAY };
const HORIZONS = { '1h': [4, 24, 72], '4h': [6, 18, 42], '1d': [1, 3, 7, 14, 30] };

const hiPrev = (b, i, n) => { let m = -Infinity; for (let j = i - n; j < i; j++) m = Math.max(m, b[j].h); return m; };
const loPrev = (b, i, n) => { let m = Infinity; for (let j = i - n; j < i; j++) m = Math.min(m, b[j].l); return m; };

function context(b, funding) {
  const c = b.map((k) => k.c);
  const ctx = { b, c, rsi: rsi(c, 14), atr: atr(b, 14), e50: ema(c, 50), e200: ema(c, 200) };
  ctx.atrPct = ctx.atr.map((a, i) => a / c[i]);
  if (funding) {
    const byDay = new Map();
    for (const f of funding) {
      const d = Math.floor(f.t / DAY) * DAY;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(f.rate);
    }
    ctx.fund = b.map((k) => {
      const v = byDay.get(k.t);
      return v ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
    });
  }
  return ctx;
}

function pctRank(arr, i, n) {
  const v = arr[i];
  if (!Number.isFinite(v)) return NaN;
  let below = 0;
  let cnt = 0;
  for (let j = Math.max(0, i - n); j < i; j++) if (Number.isFinite(arr[j])) { cnt++; if (arr[j] < v) below++; }
  return cnt >= n / 2 ? below / cnt : NaN;
}

// ── سیگنال‌ها: ‎+1 خرید، ‎−1 فروش، 0 هیچ. state = وضعیت، نه رویداد.
const SIGNALS = [
  { name: 'شکستِ سقف/کفِ ۲۰ روزه', tf: '1d', fn: (x, i) => (i < 21 ? 0 : x.c[i] > hiPrev(x.b, i, 20) ? 1 : x.c[i] < loPrev(x.b, i, 20) ? -1 : 0) },
  { name: 'شکستِ سقف/کفِ ۵۵ روزه', tf: '1d', fn: (x, i) => (i < 56 ? 0 : x.c[i] > hiPrev(x.b, i, 55) ? 1 : x.c[i] < loPrev(x.b, i, 55) ? -1 : 0) },
  { name: 'مومنتومِ ۳۰ روزه (وضعیت)', tf: '1d', state: true, fn: (x, i) => (i < 30 ? 0 : x.c[i] > x.c[i - 30] ? 1 : -1) },
  { name: 'EMA50 بالای EMA200 (وضعیت)', tf: '1d', state: true, fn: (x, i) => (!Number.isFinite(x.e200[i]) ? 0 : x.e50[i] > x.e200[i] ? 1 : -1) },
  { name: 'قیمت بالای EMA200 (وضعیت)', tf: '1d', state: true, fn: (x, i) => (!Number.isFinite(x.e200[i]) ? 0 : x.c[i] > x.e200[i] ? 1 : -1) },
  { name: 'فشردگیِ نوسان + شکستِ ۲۰ روزه', tf: '1d', fn: (x, i) => {
    if (i < 121) return 0;
    const pr = pctRank(x.atrPct, i - 1, 120);
    if (!(pr <= 0.2)) return 0;
    return x.c[i] > hiPrev(x.b, i, 20) ? 1 : x.c[i] < loPrev(x.b, i, 20) ? -1 : 0;
  } },
  { name: 'RSI روزانه ≤۳۰ / ≥۷۰ (برگشت)', tf: '1d', fn: (x, i) => (x.rsi[i] <= 30 ? 1 : x.rsi[i] >= 70 ? -1 : 0) },
  { name: 'کندلِ روزانه‌ی ۲ATR (برگشت)', tf: '1d', fn: (x, i) => {
    if (i < 15) return 0;
    const d = x.c[i] - x.c[i - 1];
    return d <= -2 * x.atr[i - 1] ? 1 : d >= 2 * x.atr[i - 1] ? -1 : 0;
  } },
  { name: '۳ روزِ پیاپی نزولی/صعودی (برگشت)', tf: '1d', fn: (x, i) => {
    if (i < 3) return 0;
    const dn = x.c[i] < x.c[i - 1] && x.c[i - 1] < x.c[i - 2] && x.c[i - 2] < x.c[i - 3];
    const up = x.c[i] > x.c[i - 1] && x.c[i - 1] > x.c[i - 2] && x.c[i - 2] > x.c[i - 3];
    return dn ? 1 : up ? -1 : 0;
  } },
  { name: 'فاندینگِ افراطی (خلاف)', tf: '1d', needFunding: true, fn: (x, i) => {
    if (!x.fund) return 0;
    const pr = pctRank(x.fund, i, 180);
    return pr >= 0.9 ? -1 : pr <= 0.1 ? 1 : 0;
  } },
  { name: 'فاندینگِ منفی (خرید)', tf: '1d', needFunding: true, fn: (x, i) => (x.fund && x.fund[i] < 0 ? 1 : 0) },
  { name: 'شکستِ سقف/کفِ ۲۰ کندلِ ۴س', tf: '4h', fn: (x, i) => (i < 21 ? 0 : x.c[i] > hiPrev(x.b, i, 20) ? 1 : x.c[i] < loPrev(x.b, i, 20) ? -1 : 0) },
  { name: 'RSI ۴س ≤۲۵ / ≥۷۵ (برگشت)', tf: '4h', fn: (x, i) => (x.rsi[i] <= 25 ? 1 : x.rsi[i] >= 75 ? -1 : 0) },
  { name: 'قیمت بالای EMA200 ِ ۴س (وضعیت)', tf: '4h', state: true, fn: (x, i) => (!Number.isFinite(x.e200[i]) ? 0 : x.c[i] > x.e200[i] ? 1 : -1) },
  { name: 'RSI ۱س ≤۲۰ / ≥۸۰ (برگشت)', tf: '1h', fn: (x, i) => (x.rsi[i] <= 20 ? 1 : x.rsi[i] >= 80 ? -1 : 0) },
  { name: 'شکستِ سقف/کفِ ۴۸ کندلِ ۱س', tf: '1h', fn: (x, i) => (i < 49 ? 0 : x.c[i] > hiPrev(x.b, i, 48) ? 1 : x.c[i] < loPrev(x.b, i, 48) ? -1 : 0) },
];

async function prepare(data) {
  const out = [];
  for (const d of data) {
    const series = { '1h': d.candles, '4h': aggregate(d.candles, 4 * H1), '1d': aggregate(d.candles, DAY) };
    // کندلِ ناقصِ اول/آخر را بینداز
    for (const tf of ['4h', '1d']) {
      const s = series[tf];
      if (s.length && s[0].t < d.candles[0].t) s.shift();
      if (s.length && s.at(-1).t + TFMS[tf] > d.candles.at(-1).t + H1) s.pop();
    }
    let funding = null;
    try {
      const sym = d.item.binanceFutures && d.item.base === 'XAU' ? 'PAXGUSDT' : `${d.item.base}USDT`;
      funding = await loadFunding(sym, d.candles[0].t, now);
      if (funding.length < 300) funding = null;
    } catch { funding = null; }
    out.push({ id: d.id, startT: d.startT, hasFunding: !!funding, ctx: Object.fromEntries(['1h', '4h', '1d'].map((tf) => [tf, context(series[tf], tf === '1d' ? funding : null)])) });
  }
  return out;
}

/** رویدادها و بازده‌ی مازاد برای یک سیگنال روی یک گروه از نمادها و یک بازه‌ی زمانی. */
function evaluate(sig, syms, from, to, dir) {
  const res = {};
  for (const h of HORIZONS[sig.tf]) {
    const months = new Map();
    let n = 0;
    let sumEx = 0;
    let sumRaw = 0;
    let hits = 0;
    for (const s of syms) {
      const x = s.ctx[sig.tf];
      const { b, c } = x;
      // میانگینِ بی‌قید در همین بازه
      let base = 0;
      let bn = 0;
      for (let i = 0; i + h < b.length; i++) if (b[i].t >= Math.max(from, s.startT) && b[i].t < to) { base += Math.log(c[i + h] / c[i]); bn++; }
      if (!bn) continue;
      base /= bn;
      let lastI = -Infinity;
      for (let i = 1; i + h < b.length; i++) {
        if (b[i].t < Math.max(from, s.startT) || b[i].t >= to) continue;
        if (i - lastI < h) continue;
        if (sig.fn(x, i) !== dir) continue;
        lastI = i;
        const f = Math.log(c[i + h] / c[i]);
        const ex = dir * (f - base);
        n++;
        sumEx += ex;
        sumRaw += dir * f;
        if (dir * f > 0) hits++;
        const m = Math.floor(b[i].t / (30.44 * DAY));
        if (!months.has(m)) months.set(m, []);
        months.get(m).push(ex);
      }
    }
    // میانگینِ تجمیعی (همان امیدِ هر معامله) با خطای معیارِ خوشه‌ای بر حسبِ ماه:
    // رویدادهای یک ماه با هم همبسته‌اند (بازار با هم بالا و پایین می‌رود)
    const mean = n ? sumEx / n : 0;
    let v = 0;
    for (const arr of months.values()) v += arr.reduce((a, x) => a + (x - mean), 0) ** 2;
    const G = months.size;
    const se = G > 2 ? Math.sqrt((v * G) / (G - 1)) / n : 0;
    res[h] = {
      n, ex: mean * 100, raw: n ? (sumRaw / n) * 100 : 0, hit: n ? hits / n : 0,
      t: se ? mean / se : 0, months: G,
    };
  }
  return res;
}

const wl = await loadUniverse(cfg.watchlist, { years: 5, warmupDays: 60 });
const ex = await loadUniverse(EXTRA_UNIVERSE, { years: 5, warmupDays: 60 });
const W = await prepare(wl.data);
const X = await prepare(ex.data);
console.log(`واچ‌لیست ${W.length} نماد (فاندینگ: ${W.filter((s) => s.hasFunding).length}) · جهان ${X.length} نماد (فاندینگ: ${X.filter((s) => s.hasFunding).length})`);

const rows = [];
for (const sig of SIGNALS) {
  for (const dir of [1, -1]) {
    const IS = evaluate(sig, W, 0, splitT, dir);
    const OOS = evaluate(sig, W, splitT, now + DAY, dir);
    const EXT = evaluate(sig, X, 0, now + DAY, dir);
    for (const h of HORIZONS[sig.tf]) {
      const a = IS[h]; const o = OOS[h]; const e = EXT[h];
      if (!a.n) continue;
      const pass = a.t >= 3 && Math.sign(o.ex) === 1 && o.n > 0 && e.t >= 2;
      rows.push({ sig: sig.name, tf: sig.tf, dir: dir === 1 ? 'خرید' : 'فروش', h, IS: a, OOS: o, EXT: e, pass });
    }
  }
}

// ── فصلی بودن: روزِ هفته و ساعتِ روز (بازده‌ی مازادِ یک کندل)
function seasonal(syms, tf, keyFn, from, to) {
  const g = new Map();
  for (const s of syms) {
    const { b, c } = s.ctx[tf];
    let base = 0; let bn = 0;
    for (let i = 1; i < b.length; i++) if (b[i].t >= Math.max(from, s.startT) && b[i].t < to) { base += Math.log(c[i] / c[i - 1]); bn++; }
    base /= bn || 1;
    for (let i = 1; i < b.length; i++) {
      if (b[i].t < Math.max(from, s.startT) || b[i].t >= to) continue;
      const k = keyFn(b[i].t);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(Math.log(c[i] / c[i - 1]) - base);
    }
  }
  return [...g].sort((a, b) => a[0] - b[0]).map(([k, v]) => {
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    return { k, n: v.length, mean: m * 100, t: (m / sd) * Math.sqrt(v.length / syms.length) }; // تقسیم بر تعدادِ نماد: همبستگیِ هم‌زمان
  });
}

const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const md = ['# مطالعه‌ی رویداد — کدام سیگنال اطلاعات دارد؟', ''];
md.push(`- داخل: واچ‌لیست تا ${new Date(splitT).toISOString().slice(0, 10)} · خارج: واچ‌لیست، سالِ آخر · جهان: ${X.length} نمادِ دیگر، ۵ سال`);
md.push('- «مازاد» = بازده‌ی لگاریتمی (٪) منهای میانگینِ بی‌قیدِ همان نماد و دوره، در جهتِ سیگنال. «خام» = بدونِ کم کردنِ میانگین. t با خطای معیارِ خوشه‌ای بر حسبِ ماه.');
md.push('- قبولی (از پیش اعلام‌شده): t ِ داخل ≥ ۳، مازادِ خارج > ۰، t ِ جهان ≥ ۲. هزینه‌ی رفت‌وبرگشت ≈ ۰.۳٪.', '');
md.push('## قبول‌شده‌ها', '');
const head = '| سیگنال | تف | جهت | افق | داخل: n / مازاد٪ / t / برد | خارج: n / مازاد٪ / t | جهان: n / مازاد٪ / t | خامِ داخل٪ |\n|---|---|---|---|---|---|---|---|';
const line = (r) => `| ${r.sig} | ${r.tf} | ${r.dir} | ${r.h} | ${r.IS.n} / ${f2(r.IS.ex)} / ${r.IS.t.toFixed(1)} / ${(r.IS.hit * 100).toFixed(0)}% | ${r.OOS.n} / ${f2(r.OOS.ex)} / ${r.OOS.t.toFixed(1)} | ${r.EXT.n} / ${f2(r.EXT.ex)} / ${r.EXT.t.toFixed(1)} | ${f2(r.IS.raw)} |`;
const passed = rows.filter((r) => r.pass);
md.push(passed.length ? head : 'هیچ سیگنالی قبول نشد.');
for (const r of passed) md.push(line(r));
md.push('', '## همه‌ی آزمون‌ها', '', head);
for (const r of rows) md.push(line(r));
md.push('', `تعدادِ آزمون: ${rows.length} · قبول: ${passed.length}`, '');
md.push('## روزِ هفته (روزانه، مازاد٪، واچ‌لیست)', '', '| روز | داخل: میانگین / t | خارج: میانگین / t | جهان: میانگین / t |', '|---|---|---|---|');
const DOW = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const dIS = seasonal(W, '1d', (t) => new Date(t).getUTCDay(), 0, splitT);
const dOOS = seasonal(W, '1d', (t) => new Date(t).getUTCDay(), splitT, now + DAY);
const dEX = seasonal(X, '1d', (t) => new Date(t).getUTCDay(), 0, now + DAY);
for (let i = 0; i < dIS.length; i++) md.push(`| ${DOW[dIS[i].k]} | ${f2(dIS[i].mean)} / ${dIS[i].t.toFixed(1)} | ${f2(dOOS[i].mean)} / ${dOOS[i].t.toFixed(1)} | ${f2(dEX[i].mean)} / ${dEX[i].t.toFixed(1)} |`);
md.push('', '## ساعتِ روز (UTC، کندلِ ۱س، مازاد٪)', '', '| ساعت | داخل | t | خارج | t | جهان | t |', '|---|---|---|---|---|---|---|');
const hIS = seasonal(W, '1h', (t) => new Date(t).getUTCHours(), 0, splitT);
const hOOS = seasonal(W, '1h', (t) => new Date(t).getUTCHours(), splitT, now + DAY);
const hEX = seasonal(X, '1h', (t) => new Date(t).getUTCHours(), 0, now + DAY);
for (let i = 0; i < hIS.length; i++) md.push(`| ${hIS[i].k} | ${hIS[i].mean.toFixed(3)} | ${hIS[i].t.toFixed(1)} | ${hOOS[i].mean.toFixed(3)} | ${hOOS[i].t.toFixed(1)} | ${hEX[i].mean.toFixed(3)} | ${hEX[i].t.toFixed(1)} |`);

mkdirSync(join('out', 'research'), { recursive: true });
writeFileSync(join('out', 'research', 'event-study.md'), md.join('\n') + '\n');
writeFileSync(join('out', 'research', 'event-study.json'), JSON.stringify(rows));
console.log(md.slice(0, md.indexOf('## همه‌ی آزمون‌ها')).join('\n'));
console.log(`تعدادِ آزمون: ${rows.length} · قبول: ${passed.length}`);
