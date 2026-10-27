/**
 * تصویرِ «سند»: کندل‌ها + خطِ روند و برخوردهایش + فیبوناچی + واگرایی روی قیمت
 * و RSI + الگوی کندلی + ورود/حد ضرر/تارگت‌ها. SVG ساخته و با resvg به PNG
 * تبدیل می‌شود — بدونِ مرورگر و بدونِ canvasِ بومی.
 *
 * ⚠️ متنِ روی تصویر لاتین است. resvg فارسی را با فونتِ وزیرمتن درست شکل
 * می‌دهد، ولی برچسبِ کنارِ خطِ قیمت جایی است که عدد و متن قاطی می‌شوند و
 * دوجهته‌سازی خرابشان می‌کند. متنِ فارسی در کپشنِ تلگرام است.
 */

import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lineAt } from '../strategy/trendline.js';
import { ema, rsi } from '../strategy/indicators.js';
import { CONDITIONS } from '../strategy/params.js';
import { price as fmt, utc } from '../format.js';
import { TF_MS } from '../exchanges/index.js';

const C = {
  bg: '#131722',
  panel: '#161a25',
  grid: '#232733',
  axis: '#8e929e',
  text: '#d1d4dc',
  ink: '#ffffff',
  up: '#22C55E',
  down: '#EF4444',
  line: '#38BDF8',
  fib: '#8e929e',
  fibKey: '#F59E0B',
  div: '#C084FC',
  entry: '#ffffff',
  pattern: '#F59E0B',
  ema: '#94A3B8',
};

const W = 1280;
const H = 860;
const PAD_L = 16;
const PAD_R = 104;
const TOP = 92;
const PRICE_H = 520;
const GAP = 34;
const RSI_H = 140;
const RIGHT_BARS = 16;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function niceStep(span, count) {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/**
 * @param {object} p
 * @param {Array} p.candles
 * @param {object|null} p.result   خروجیِ analyze — null یعنی خطِ روندی نیست؛
 *                                  باز هم چارت و RSI کشیده می‌شوند
 * @param {object} p.meta     { pretty, exchange, timeframe, watermark }
 */
export function buildChartSvg({ candles, result, meta, minBars = 70 }) {
  const last = candles.length - 1;
  const { line, div, candle } = result || {};
  // خطِ دور: فیبو و پلن معنایی ندارند — فقط خط و فاصله‌ی قیمت تا آن
  const far = line?.state === 'far';
  const fib = far ? null : result?.fib;
  const plan = result?.plan;
  const close = candles[last].c;
  const long = result?.direction !== 'short';

  // پنجره از خودِ ستاپ می‌آید، نه یک عددِ ثابت: با ۱۴۰ کندلِ ثابت، روندِ
  // قدیمی نصفِ تصویر را می‌گرفت و ستاپ در گوشه فشرده می‌شد.
  const anchor = line ? Math.min(line.a, fib ? fib.lowIdx : Infinity, div ? div.p : Infinity) : last - 120;
  let from = Math.min(last - minBars + 1, anchor - Math.max(12, Math.round((last - anchor) * 0.25)));
  from = Math.max(0, Math.max(from, last - 259));
  const view = candles.slice(from);
  const count = view.length + RIGHT_BARS;
  const plotW = W - PAD_L - PAD_R;
  const step = plotW / count;
  const x = (i) => PAD_L + (i - from + 0.5) * step;

  // محدوده‌ی قیمت: کندل‌ها + سطوحِ معامله + دو سرِ فیبو
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of view) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); }
  const extras = fib ? [fib.start, fib.end] : [];
  if (far) extras.push(lineAt(line, last));
  if (plan) extras.push(plan.sl, ...plan.tps.map((t) => t.price));
  for (const v of extras) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const padP = (hi - lo) * 0.05;
  lo -= padP;
  hi += padP;
  const y = (v) => TOP + (1 - (v - lo) / (hi - lo)) * PRICE_H;

  const RSI_TOP = TOP + PRICE_H + GAP;
  const ry = (v) => RSI_TOP + (1 - v / 100) * RSI_H;
  const right = W - PAD_R;
  const out = [];

  out.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  out.push(`<rect x="${PAD_L}" y="${TOP}" width="${plotW}" height="${PRICE_H}" fill="${C.panel}"/>`);
  out.push(`<rect x="${PAD_L}" y="${RSI_TOP}" width="${plotW}" height="${RSI_H}" fill="${C.panel}"/>`);

  // ── شبکه و محورِ قیمت
  // برچسبِ شبکه زیرِ برچسبِ سطوحِ معامله نرود
  const tagYs = plan ? [plan.entry, plan.sl, ...plan.tps.map((t) => t.price)].map(y) : [y(close)];
  const st = niceStep(hi - lo, 7);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
    const yy = y(v);
    if (tagYs.some((t) => Math.abs(t - yy) < 16)) continue;
    out.push(`<line x1="${PAD_L}" x2="${right}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`);
    out.push(text(right + 8, yy + 4, fmt(v, close), { size: 12, fill: C.axis }));
  }

  // ── محورِ زمان
  const every = Math.max(1, Math.round(view.length / 7));
  for (let i = from; i <= last; i += every) {
    const xx = x(i);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${TOP}" y2="${RSI_TOP + RSI_H}" stroke="${C.grid}" stroke-width="1" opacity="0.6"/>`);
    out.push(text(xx, RSI_TOP + RSI_H + 20, utc(candles[i].t).slice(5), { size: 12, fill: C.axis, anchor: 'middle' }));
  }

  // ── فیبوناچی (زیرِ کندل‌ها)
  const fibLabels = [];
  if (fib) {
  const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  if (!fibLevels.includes(fib.level)) fibLevels.push(fib.level);
  const fx1 = x(fib.lowIdx);
  const priceOf = (lvl) => fib.end - lvl * (fib.end - fib.start);
  const zoneTop = y(priceOf(0.5));
  const zoneBot = y(priceOf(0.786));
  out.push(`<rect x="${fx1}" y="${Math.min(zoneTop, zoneBot)}" width="${right - fx1}" height="${Math.abs(zoneBot - zoneTop)}" fill="${C.fibKey}" opacity="0.07"/>`);
  // سطحِ کلیدی همیشه برچسب دارد؛ بقیه فقط اگر به برچسبِ دیگری نچسبند
  const keyY = y(priceOf(fib.level));
  const taken = [keyY];
  for (const lvl of fibLevels) {
    const key = Math.abs(lvl - fib.level) < 1e-9;
    const yy = y(priceOf(lvl));
    out.push(`<line x1="${fx1}" x2="${right}" y1="${yy}" y2="${yy}" stroke="${key ? C.fibKey : C.fib}"`
      + ` stroke-width="${key ? 1.6 : 0.8}" stroke-dasharray="${key ? '' : '4 4'}" opacity="${key ? 0.95 : 0.55}"/>`);
    if (!key && taken.some((t) => Math.abs(t - yy) < 15)) continue;
    if (!key) taken.push(yy);
    fibLabels.push(label(PAD_L + 6, yy + 4, `${lvl}  ${fmt(priceOf(lvl), close)}`, key ? C.fibKey : C.fib, 'start', 11));
  }
  // موجِ فیبو
  out.push(`<line x1="${x(fib.lowIdx)}" y1="${y(fib.start)}" x2="${x(fib.highIdx)}" y2="${y(fib.end)}" stroke="${C.fib}" stroke-width="1" stroke-dasharray="2 4" opacity="0.7"/>`);
  }

  // ── EMA ِ فیلترِ روند، فقط وقتی آن شرط روشن است
  if (result?.components?.trendFilter?.enabled) {
    const e = ema(candles.map((k) => k.c), result.trend.period);
    const ep = [];
    for (let i = from; i <= last; i++) if (Number.isFinite(e[i])) ep.push(`${x(i).toFixed(1)},${y(e[i]).toFixed(1)}`);
    if (ep.length) {
      out.push(`<polyline points="${ep.join(' ')}" fill="none" stroke="${C.ema}" stroke-width="1.6" opacity="0.9"/>`);
      out.push(text(x(last) - 4, y(e[last]) - 8, `EMA ${result.trend.period}`, { size: 11, fill: C.ema, weight: 700, anchor: 'end' }));
    }
  }

  // ── ناحیه‌ی معامله (سمتِ راست)
  if (plan) {
    const px1 = x(last) + step;
    const tpTop = plan.tps.length ? plan.tps[plan.tps.length - 1].price : plan.entry;
    out.push(rectBetween(px1, right, y(plan.entry), y(plan.sl), C.down, 0.14));
    out.push(rectBetween(px1, right, y(plan.entry), y(tpTop), C.up, 0.10));
  }

  // ── کندل‌ها
  const bw = Math.max(1.5, step * 0.62);
  for (let i = from; i <= last; i++) {
    const k = candles[i];
    const col = k.c >= k.o ? C.up : C.down;
    const xx = x(i);
    const top = y(Math.max(k.o, k.c));
    const h = Math.max(1, y(Math.min(k.o, k.c)) - top);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${y(k.h)}" y2="${y(k.l)}" stroke="${col}" stroke-width="1"/>`);
    out.push(`<rect x="${xx - bw / 2}" y="${top}" width="${bw}" height="${h}" fill="${col}"/>`);
  }

  out.push(...fibLabels);

  // ── خطِ روند و برخوردها
  if (line) {
  const lx1 = x(line.a);
  const lx2 = right;
  const iEnd = from + (lx2 - PAD_L) / step - 0.5;
  out.push(`<line x1="${lx1}" y1="${y(line.p0)}" x2="${lx2}" y2="${y(lineAt(line, iEnd))}" stroke="${C.line}" stroke-width="2.4"/>`);
  const touches = [...line.touches.filter((t) => t >= from), ...(far ? [] : [line.touchIdx])];
  touches.forEach((t, n) => {
    const third = n === touches.length - 1;
    const cy = long ? y(candles[t].l) + 14 : y(candles[t].h) - 14;
    out.push(`<circle cx="${x(t)}" cy="${long ? y(candles[t].l) : y(candles[t].h)}" r="6" fill="none" stroke="${C.line}" stroke-width="2"/>`);
    out.push(`<circle cx="${x(t)}" cy="${cy + (long ? 8 : -8)}" r="10" fill="${third ? C.line : C.bg}" stroke="${C.line}" stroke-width="1.5"/>`);
    out.push(text(x(t), cy + (long ? 12 : -4), String(n + 1), { size: 12, fill: third ? C.bg : C.line, weight: 700, anchor: 'middle' }));
  });
  if (far) {
    // فاصله‌ی قیمت تا خط — چرا الان ستاپ نیست
    const xx = x(last) + step * 3;
    const y1 = y(close);
    const y2 = y(lineAt(line, last));
    out.push(`<line x1="${xx}" x2="${xx}" y1="${y1}" y2="${y2}" stroke="${C.fibKey}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    out.push(`<path d="M${xx} ${y2} l-5 ${y2 > y1 ? -9 : 9} h10 z" fill="${C.fibKey}"/>`);
    out.push(label(xx + 8, (y1 + y2) / 2 + 4, `${line.distAtr.toFixed(1)} ATR to trendline`, C.fibKey, 'start', 12));
  }
  }

  // ── واگرایی روی قیمت
  if (div && div.p >= from) {
    out.push(`<line x1="${x(div.p)}" y1="${y(div.priceP)}" x2="${x(div.k)}" y2="${y(div.priceK)}" stroke="${C.div}" stroke-width="2" stroke-dasharray="6 4"/>`);
  }

  // ── الگوی کندلی
  if (candle) {
    const k = candles[candle.idx];
    const ax = x(candle.idx);
    // زیرِ پایین‌ترین کندلِ اطراف، نه فقط خودِ الگو — وگرنه روی نشانِ برخوردِ کناری می‌افتد
    let ext = long ? k.l : k.h;
    for (let i = Math.max(from, candle.idx - 1); i <= Math.min(last, candle.idx + 1); i++) {
      ext = long ? Math.min(ext, candles[i].l) : Math.max(ext, candles[i].h);
    }
    const ay = long ? y(ext) + 62 : y(ext) - 62;
    const tip = long ? ay - 12 : ay + 12;
    out.push(`<path d="M${ax} ${tip} l-7 ${long ? 12 : -12} h14 z" fill="${C.pattern}"/>`);
    out.push(label(ax, long ? ay + 18 : ay - 10, candle.name, C.pattern, 'middle'));
  }

  // ── سطوحِ معامله
  if (plan) {
    const px1 = x(line.touchIdx);
    const lv = [
      { v: plan.entry, name: 'ENTRY', col: C.entry, dash: '6 4' },
      { v: plan.sl, name: 'SL', col: C.down, dash: '' },
      ...plan.tps.map((t) => ({ v: t.price, name: `${t.label} ${t.rr.toFixed(1)}R`, col: C.up, dash: '' })),
    ];
    for (const l of lv) {
      const yy = y(l.v);
      out.push(`<line x1="${px1}" x2="${right}" y1="${yy}" y2="${yy}" stroke="${l.col}" stroke-width="1.4" stroke-dasharray="${l.dash}"/>`);
      out.push(axisTag(right, yy, fmt(l.v, close), l.col));
      out.push(text(right - 6, yy - 5, l.name, { size: 11, fill: l.col, weight: 700, anchor: 'end' }));
    }
  } else {
    out.push(axisTag(right, y(close), fmt(close, close), C.text));
  }

  // ── RSI
  const r = rsi(candles.map((k) => k.c), 14);
  for (const lvl of [30, 50, 70]) {
    out.push(`<line x1="${PAD_L}" x2="${right}" y1="${ry(lvl)}" y2="${ry(lvl)}" stroke="${C.grid}" stroke-dasharray="${lvl === 50 ? '2 4' : ''}"/>`);
    out.push(text(right + 8, ry(lvl) + 4, String(lvl), { size: 11, fill: C.axis }));
  }
  const pts = [];
  for (let i = from; i <= last; i++) if (Number.isFinite(r[i])) pts.push(`${x(i).toFixed(1)},${ry(r[i]).toFixed(1)}`);
  out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${C.text}" stroke-width="1.4"/>`);
  out.push(text(PAD_L + 8, RSI_TOP + 16, 'RSI 14', { size: 12, fill: C.axis }));
  if (div && div.p >= from) {
    out.push(`<line x1="${x(div.p)}" y1="${ry(div.rsiP)}" x2="${x(div.k)}" y2="${ry(div.rsiK)}" stroke="${C.div}" stroke-width="2.2"/>`);
    for (const [i, v] of [[div.p, div.rsiP], [div.k, div.rsiK]]) {
      out.push(`<circle cx="${x(i)}" cy="${ry(v)}" r="4" fill="${C.div}"/>`);
    }
    const name = `${div.type === 'hidden' ? 'Hidden' : 'Regular'} ${long ? 'Bullish' : 'Bearish'} Divergence`;
    out.push(label(x(div.k), ry(div.rsiK) + (long ? 22 : -14), name, C.div, 'end'));
  }

  // ── سربرگ
  const dir = long ? 'LONG' : 'SHORT';
  out.push(text(PAD_L, 38, `${meta.pretty}`, { size: 26, fill: C.ink, weight: 700 }));
  out.push(text(PAD_L, 66, `${meta.timeframe.toUpperCase()} · ${meta.exchange} · ${utc(candles[last].t + TF_MS[meta.timeframe])} UTC`,
    { size: 14, fill: C.axis }));
  const setup = result && result.alertable !== false && !far;
  const badgeCol = !setup ? C.axis : long ? C.up : C.down;
  const scoreText = !result ? 'NO TRENDLINE' : far ? 'NO SETUP' : `${dir}  ${result.score}/${result.maxScore}`;
  out.push(`<rect x="${W - PAD_R - 190}" y="16" width="190" height="34" rx="6" fill="${badgeCol}" opacity="0.16"/>`);
  out.push(text(W - PAD_R - 95, 39, scoreText, { size: 17, fill: badgeCol, weight: 700, anchor: 'middle' }));

  const checks = result
    ? Object.entries(result.components).filter(([, c]) => c.enabled)
      .map(([key, c]) => [key === 'fib' ? `Fib ${result.fib.level}` : CONDITIONS[key].en, c])
    : [];
  let cx = W - PAD_R - 190 - 24;
  for (const [name, c] of [...checks].reverse()) {
    const col = c.ok ? C.up : c.points > 0 ? C.fibKey : C.axis;
    const w = name.length * 7.4 + 26;
    cx -= w;
    out.push(`<circle cx="${cx + 8}" cy="33" r="5" fill="${c.points > 0 ? col : 'none'}" stroke="${col}" stroke-width="1.5"/>`);
    out.push(text(cx + 18, 38, name, { size: 13, fill: col }));
  }

  if (meta.watermark) {
    out.push(text(PAD_L + plotW / 2, TOP + PRICE_H / 2, meta.watermark,
      { size: 48, fill: C.ink, weight: 700, anchor: 'middle', opacity: 0.05 }));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}

function text(x, y, s, { size = 12, fill = C.text, weight = 400, anchor = 'start', opacity = 1 } = {}) {
  return `<text x="${x}" y="${y}" font-family="Vazirmatn" font-size="${size}" font-weight="${weight}"`
    + ` fill="${fill}" text-anchor="${anchor}" opacity="${opacity}">${esc(s)}</text>`;
}

function label(x, y, s, col, anchor, size = 12) {
  const w = s.length * size * 0.57 + 14;
  const bx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return `<rect x="${bx}" y="${y - 14}" width="${w}" height="20" rx="4" fill="${C.bg}" opacity="0.85" stroke="${col}" stroke-width="1"/>`
    + text(bx + w / 2, y + 1, s, { size, fill: col, weight: 700, anchor: 'middle' });
}

function axisTag(x, y, s, col) {
  return `<rect x="${x + 2}" y="${y - 10}" width="${PAD_R - 6}" height="20" rx="3" fill="${col}"/>`
    + text(x + 8, y + 4, s, { size: 12, fill: '#0d0f14', weight: 700 });
}

function rectBetween(x1, x2, ya, yb, fill, opacity) {
  return `<rect x="${x1}" y="${Math.min(ya, yb)}" width="${Math.max(0, x2 - x1)}" height="${Math.abs(yb - ya)}" fill="${fill}" opacity="${opacity}"/>`;
}

const FONT_DIR = join(process.cwd(), 'assets', 'fonts');
const FONT_FILES = ['Vazirmatn-Regular.ttf', 'Vazirmatn-Bold.ttf'].map((f) => join(FONT_DIR, f));

// ⚠️ بدونِ فایلِ فونت resvg خطا نمی‌دهد، تصویرِ بی‌متن می‌سازد. سکوت بدتر از خطاست.
export function checkFonts() {
  if (!FONT_FILES.every(existsSync)) throw new Error(`فونت پیدا نشد: ${FONT_DIR}`);
}

/** @returns {Buffer} PNG */
export function renderChart(args) {
  checkFonts();
  const svg = buildChartSvg(args);
  return new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Vazirmatn' },
    fitTo: { mode: 'width', value: 1280 },
  }).render().asPng();
}
