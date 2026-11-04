/**
 * نمونه‌ی بصریِ «شکستِ برخوردِ سوم با حجم» روی داده‌ی زنده‌ی LBank.
 * node scripts/research/sr-visuals.js [تعداد=5] [--retest]
 * خروجی: out/sr-break/ (یا out/sr-retest/ با --retest) ‏*.png + signals.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchFrom, TF_MS } from '../../src/exchanges/index.js';
import { detect, netR, SR_DEFAULTS } from '../../src/strategy/srBreak.js';
import { C, niceStep, text, label, axisTag, rectBetween, svgToPng } from '../../src/chart/render.js';
import { price as fmt, utc } from '../../src/format.js';

const BASES = ['BTC', 'SOL', 'AVAX', 'AAVE', 'HYPE', 'NEAR', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'LINK', 'DOT', 'LTC', 'BCH', 'ATOM',
  'UNI', 'FIL', 'TRX', 'ETC', 'XLM', 'INJ', 'OP', 'ARB', 'APT', 'SUI', 'TON', 'HBAR'];
const SYMS = [...BASES.map((b) => ({ base: b, sym: `${b.toLowerCase()}_usdt` })), { base: 'XAU', sym: 'xaut_usdt' }];
const RETEST = process.argv.includes('--retest');
const P = { ...SR_DEFAULTS, entryMode: RETEST ? 'retest' : 'break' };
const OUT = RETEST ? 'out/sr-retest' : 'out/sr-break';
const N = +(process.argv.slice(2).find((a) => /^d+$/.test(a)) || 5);
const rtStat = {};

const all = [];
const rejected = { vol: 0, trend: 0, both: 0 };
for (const { base, sym } of SYMS) {
  let daily;
  try { daily = await fetchFrom('lbank', sym, '1d', 300); } catch (e) { console.log(`✗ ${base} 1d: ${e.message}`); continue; }
  for (const tf of ['1h', '4h']) {
    let bars;
    try { bars = await fetchFrom('lbank', sym, tf, 1000); } catch (e) { console.log(`✗ ${base} ${tf}: ${e.message}`); continue; }
    const sigs = detect(bars, daily, TF_MS[tf], P);
    for (const s of sigs) {
      if (!s.pass) {
        if (!s.volOk && !s.trendOk) rejected.both++; else if (!s.volOk) rejected.vol++; else rejected.trend++;
        continue;
      }
      if (RETEST) { rtStat[s.retest.why] = (rtStat[s.retest.why] || 0) + 1; if (!s.entered) continue; }
      all.push({ base, sym, tf, bars, s, r: netR(s) });
    }
    console.log(`${base} ${tf}: ${bars.length} bars ${utc(bars[0].t)} → ${utc(bars.at(-1).t)} · candidates ${sigs.length} · pass ${sigs.filter((x) => x.pass).length}`);
  }
}
console.log(`\npass ${all.length} · rejected: vol ${rejected.vol}, trend ${rejected.trend}, both ${rejected.both}`);

if (RETEST) console.log('retest outcomes of passing breaks:', rtStat);
// انتخاب: تازه‌ترین‌ها، با حداقل یک فروش و هر دو تایم‌فریم اگر وجود داشت؛ هیچ گزینشی بر اساسِ نتیجه نیست
all.sort((x, y) => (y.bars[y.s.ei].t - x.bars[x.s.ei].t));
const pick = [];
const take = (f, dup = false) => { const c = all.find((x) => !pick.includes(x) && (dup || !pick.some((q) => q.base === x.base)) && f(x)); if (c) pick.push(c); };
take((x) => x.s.dir === 'short');
take((x) => x.s.dir === 'long');
take((x) => x.tf === '4h');
take((x) => x.tf === '1h');
for (let n = pick.length; n < N; n++) take(() => true);
for (let n = pick.length; n < N; n++) take(() => true, true); // ارزِ تکراری فقط اگر ارزِ تازه نماند
pick.sort((x, y) => (y.bars[y.s.ei].t - x.bars[x.s.ei].t));

// مقایسه: حجمِ همان کندل در بایننس (حجمِ LBank روی بعضی نمادها ناپایدار است)
for (const x of pick) {
  try {
    const bb = await fetchFrom('binance', x.base === 'XAU' ? 'PAXGUSDT' : `${x.base}USDT`, x.tf, 1000);
    const k = bb.findIndex((q) => q.t === x.bars[x.s.i].t);
    if (k >= P.volPeriod) {
      let a = 0;
      for (let j = k - P.volPeriod; j < k; j++) a += bb[j].v;
      x.binVolX = bb[k].v / (a / P.volPeriod);
    }
  } catch { /* بایننس نماد را ندارد */ }
}

mkdirSync(OUT, { recursive: true });
const summary = [];
pick.forEach((x, n) => {
  const file = `${OUT}/${String(n + 1).padStart(2, '0')}-${x.base}-${x.tf}-${x.s.dir}.png`;
  writeFileSync(file, svgToPng(buildSvg(x)));
  const s = x.s; const b = x.bars;
  summary.push({
    file, coin: x.base, binanceVolX: x.binVolX ? +x.binVolX.toFixed(2) : null, tf: x.tf, dir: s.dir,
    touch1: utc(b[s.a].t), touch2: utc(b[s.b].t), touch3break: utc(b[s.i].t),
    ...(RETEST ? { retestTouch: utc(b[s.retest.touchI].t), entryCandle: utc(b[s.ei].t), barsBreakToEntry: s.ei - s.i } : {}),
    level: s.level, tol: s.tol, pull1Atr: +s.pull1.toFixed(2), pull2Atr: +s.pull2.toFixed(2),
    breakDistAtr: +s.breakDistAtr.toFixed(2), volX: +s.volX.toFixed(2),
    dailyClose: s.trend.close, dailyEma50: s.trend.ema,
    entry: s.entry, stop: s.stop, target: s.target,
    exit: s.exit ? { t: utc(b[s.exit.j].t), why: s.exit.why, px: s.exit.px } : 'open', netR: x.r == null ? null : +x.r.toFixed(2),
  });
  console.log(file);
});
writeFileSync(`${OUT}/signals.json`, JSON.stringify({ params: P, totalPass: all.length, rejected, retestOutcomes: RETEST ? rtStat : undefined, picks: summary }, null, 2));

function buildSvg({ base, tf, bars, s, r, binVolX }) {
  const W = 1280; const H = 900; const PL = 16; const PR = 110; const TOP = 100; const PH = 520; const VT = TOP + PH + 30; const VH = 120;
  const long = s.dir === 'long';
  const endI = s.exit ? Math.min(bars.length - 1, s.exit.j + 8) : bars.length - 1;
  const from = Math.max(0, s.a - 15);
  const to = endI;
  const count = to - from + 1 + 6;
  const plotW = W - PL - PR;
  const step = plotW / count;
  const x = (i) => PL + (i - from + 0.5) * step;
  const right = W - PR;
  let lo = Infinity; let hi = -Infinity;
  for (let i = from; i <= to; i++) { lo = Math.min(lo, bars[i].l); hi = Math.max(hi, bars[i].h); }
  lo = Math.min(lo, s.stop, s.target); hi = Math.max(hi, s.stop, s.target);
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const y = (v) => TOP + (1 - (v - lo) / (hi - lo)) * PH;
  const ref = s.entry;
  const o = [];
  o.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  o.push(`<rect x="${PL}" y="${TOP}" width="${plotW}" height="${PH}" fill="${C.panel}"/>`);
  o.push(`<rect x="${PL}" y="${VT}" width="${plotW}" height="${VH}" fill="${C.panel}"/>`);
  const st = niceStep(hi - lo, 8);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
    o.push(`<line x1="${PL}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>`);
    o.push(text(right + 8, y(v) + 4, fmt(v, ref), { size: 11, fill: C.axis }));
  }
  const every = Math.max(1, Math.round((to - from) / 7));
  for (let i = from; i <= to; i += every) o.push(text(x(i), VT + VH + 18, utc(bars[i].t).slice(5, 16), { size: 11, fill: C.axis, anchor: 'middle' }));

  // ناحیه‌ی سطح (±tol) و خطِ سطح از برخوردِ اول تا شکست
  o.push(rectBetween(x(s.a) - step / 2, x(s.i) + step / 2, y(s.level + s.tol), y(s.level - s.tol), C.line, 0.10));
  o.push(`<line x1="${x(s.a)}" x2="${x(s.i)}" y1="${y(s.level)}" y2="${y(s.level)}" stroke="${C.line}" stroke-width="2"/>`);
  o.push(`<line x1="${x(s.i)}" x2="${right}" y1="${y(s.level)}" y2="${y(s.level)}" stroke="${C.line}" stroke-width="1" stroke-dasharray="4 4" opacity="0.6"/>`);

  // معامله
  const xe = s.exit ? x(s.exit.j) : right;
  const E = s.ei;
  o.push(rectBetween(x(E), xe, y(s.entry), y(s.target), C.up, 0.12));
  o.push(rectBetween(x(E), xe, y(s.entry), y(s.stop), C.down, 0.12));
  for (const [v, col, name] of [[s.entry, C.entry, 'ENTRY'], [s.stop, C.down, `STOP level ${long ? '-' : '+'}${P.stopAtr} ATR`], [s.target, C.up, `TARGET ${P.targetR}R`]]) {
    o.push(`<line x1="${x(E)}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1.2" stroke-dasharray="6 4"/>`);
    o.push(axisTag(right, y(v), fmt(v, ref), col, PR));
    o.push(text(right - 6, y(v) - 5, name, { size: 11, fill: col, weight: 700, anchor: 'end' }));
  }

  // کندل‌ها و حجم
  let vmax = 0;
  for (let i = from; i <= to; i++) vmax = Math.max(vmax, bars[i].v);
  const bw = Math.max(1.5, step * 0.62);
  const vy = (v) => VT + VH - (v / vmax) * (VH - 6);
  const sma = [];
  for (let i = from; i <= to; i++) {
    const k = bars[i]; const col = k.c >= k.o ? C.up : C.down; const xx = x(i);
    const top = y(Math.max(k.o, k.c)); const h = Math.max(1, y(Math.min(k.o, k.c)) - top);
    const hl = i === s.i || i === E;
    o.push(`<line x1="${xx}" x2="${xx}" y1="${y(k.h)}" y2="${y(k.l)}" stroke="${col}"/>`);
    o.push(`<rect x="${xx - bw / 2}" y="${top}" width="${bw}" height="${h}" fill="${col}"${hl ? ` stroke="${C.ink}" stroke-width="1.5"` : ''}/>`);
    o.push(`<rect x="${xx - bw / 2}" y="${vy(k.v)}" width="${bw}" height="${VT + VH - vy(k.v)}" fill="${hl ? C.fibKey : col}" opacity="${hl ? 1 : 0.45}"/>`);
    if (i >= P.volPeriod) {
      let a = 0; for (let j = i - P.volPeriod; j < i; j++) a += bars[j].v;
      sma.push(`${xx.toFixed(1)},${vy(a / P.volPeriod).toFixed(1)}`);
    }
  }
  o.push(`<polyline points="${sma.join(' ')}" fill="none" stroke="${C.text}" stroke-width="1.2" opacity="0.8"/>`);
  o.push(`<line x1="${x(s.i) - 40}" x2="${x(s.i) + 40}" y1="${vy(s.volAvg * P.volMult)}" y2="${vy(s.volAvg * P.volMult)}" stroke="${C.fibKey}" stroke-dasharray="3 3"/>`);
  o.push(label(x(s.i), Math.max(VT + 16, vy(bars[s.i].v) - 6), `VOL x${s.volX.toFixed(1)}`, C.fibKey, 'middle', 11));
  o.push(text(right - 6, VT + 14, `same candle on Binance: vol x${binVolX ? binVolX.toFixed(1) : 'n/a'}`, { size: 12, fill: binVolX >= P.volMult ? C.up : C.down, anchor: 'end', weight: 700 }));
  o.push(text(PL + 6, VT + 14, `LBank volume · line = SMA${P.volPeriod} · dashed = ${P.volMult}x threshold`, { size: 11, fill: C.axis }));

  // برچسبِ برخوردها
  const tag = (i, s1, col) => {
    const yy = long ? y(bars[i].h) - 16 : y(bars[i].l) + 26;
    o.push(label(x(i), yy, s1, col, 'middle', 12));
  };
  tag(s.a, 'T1', C.line);
  tag(s.b, 'T2', C.line);
  tag(s.i, 'T3 BREAK', C.fibKey);
  if (E !== s.i) {
    o.push(rectBetween(x(s.i) + step / 2, x(E) + step / 2, y(s.level + s.tol), y(s.level - s.tol), C.entry, 0.16));
    const yy = long ? y(bars[E].l) + 30 : y(bars[E].h) - 20;
    o.push(label(x(E), yy, `RETEST ENTRY (+${E - s.i} bars)`, C.entry, 'middle', 12));
  }
  // عمقِ پولبک‌ها
  const pullI1 = (() => { let m = s.a + 1; for (let j = s.a + 1; j < s.b; j++) if ((long ? bars[j].l < bars[m].l : bars[j].h > bars[m].h)) m = j; return m; })();
  for (const [pi, d] of [[pullI1, s.pull1], [s.pull2i, s.pull2]]) {
    const v = long ? bars[pi].l : bars[pi].h;
    o.push(`<line x1="${x(pi)}" x2="${x(pi)}" y1="${y(s.level)}" y2="${y(v)}" stroke="${C.axis}" stroke-dasharray="2 3"/>`);
    o.push(text(x(pi) + 4, (y(s.level) + y(v)) / 2, `pullback ${d.toFixed(1)} ATR`, { size: 11, fill: C.axis }));
  }
  if (s.exit) {
    const col = r > 0 ? C.up : C.down;
    o.push(label(Math.max(x(s.exit.j), x(s.i) + 90), long ? y(bars[s.exit.j].h) - 40 : y(bars[s.exit.j].l) + 50, `${s.exit.why.toUpperCase()} ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`, col, 'middle', 12));
  }

  // سربرگ
  o.push(text(PL, 36, `${base}/USDT · ${tf} · LBank · ${long ? 'LONG (resistance break)' : 'SHORT (support break)'}${E !== s.i ? ' · entry on RETEST' : ''}`, { size: 24, fill: C.ink, weight: 700 }));
  const tr = s.trend;
  o.push(text(PL, 62, `T1 ${utc(bars[s.a].t)} · T2 ${utc(bars[s.b].t)} · T3/break ${utc(bars[s.i].t)}${E !== s.i ? ` · retest touch ${utc(bars[s.retest.touchI].t)} · entry ${utc(bars[E].t)}` : ''} UTC (candle open)`, { size: 13, fill: C.axis }));
  o.push(text(PL, 84, `Level ${fmt(s.level, ref)} ±${fmt(s.tol, ref)} (${P.tolAtr} ATR) · close ${long ? 'above' : 'below'} by ${s.breakDistAtr.toFixed(2)} ATR (min ${P.breakAtr}) · vol ${s.volX.toFixed(1)}x (min ${P.volMult}x) · daily close ${fmt(tr.close, ref)} ${long ? '>' : '<'} EMA50 ${fmt(tr.ema, ref)}`,
    { size: 12, fill: C.text }));
  const res = s.exit ? `${s.exit.why} ${utc(bars[s.exit.j].t)} · net ${r >= 0 ? '+' : ''}${r.toFixed(2)}R (fees 0.1% + slip 0.05%/side)` : 'still OPEN';
  o.push(text(PL, H - 14, `Entry ${fmt(s.entry, ref)} · Stop ${fmt(s.stop, ref)} · Target ${fmt(s.target, ref)} · risk ${(Math.abs(s.entry - s.stop) / s.entry * 100).toFixed(2)}% · ${res}`, { size: 13, fill: C.ink, weight: 700 }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o.join('')}</svg>`;
}
