/**
 * چارتِ روند‌گیریِ روزانه: کندلِ روزانه + EMA + ورود/خروج‌های گذشته‌ی همین
 * قاعده روی همین نماد + پوزیشنِ باز (ورود و حد ضررِ اضطراری).
 *
 * معامله‌های گذشته از replay ِ خودِ استراتژی می‌آیند (src/strategy/trend.js)،
 * یعنی همان چیزی که بات اجرا می‌کند — نه نقاشیِ دستی. با کارمزد و لغزش.
 *
 * متنِ روی تصویر لاتین است (همان دلیلِ render.js)؛ توضیحِ فارسی در کپشن.
 */

import { C, niceStep, text, label, axisTag, rectBetween, svgToPng } from './render.js';
import { DAY, TREND_DEFAULTS, indicators, evaluate } from '../strategy/trend.js';
import { price as fmt, utc } from '../format.js';

const W = 1280;
const H = 800;
const PAD_L = 16;
const PAD_R = 104;
const TOP = 96;
const PRICE_H = 610;
const RIGHT_BARS = 14;
const EMA_COL = '#F59E0B';

/**
 * @param {object} a
 * @param {Array}  a.bars    کندل‌های روزانه‌ی بسته
 * @param {object} a.p       پارامترهای روند
 * @param {Array}  a.trades  معامله‌های بسته‌ی replay: { entry, exit, r, exitReason, entryBarT, exitBarT }
 * @param {object|null} a.open  پوزیشنِ باز: { entry, stop, entryBarT, source }
 * @param {object} a.meta    { pretty, exchange, watermark }
 * @param {number} [a.view]  چند کندل نشان داده شود
 */
export function buildTrendSvg({ bars, p = TREND_DEFAULTS, trades = [], open = null, meta, view = 240 }) {
  const ind = indicators(bars, p);
  const last = bars.length - 1;
  const ev = evaluate(bars, p, ind);
  const firstEma = ind.ema.findIndex(Number.isFinite);
  const from = Math.max(0, firstEma, last - view + 1);
  const idx = new Map(bars.map((k, i) => [k.t, i]));
  const close = bars[last].c;

  const count = last - from + 1 + RIGHT_BARS;
  const plotW = W - PAD_L - PAD_R;
  const step = plotW / count;
  const x = (i) => PAD_L + (i - from + 0.5) * step;
  const right = W - PAD_R;

  const shown = trades.filter((t) => idx.has(t.exitBarT) && idx.get(t.exitBarT) >= from);

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i <= last; i++) {
    lo = Math.min(lo, bars[i].l, ind.ema[i]);
    hi = Math.max(hi, bars[i].h, ind.ema[i]);
  }
  if (open) { lo = Math.min(lo, open.stop); hi = Math.max(hi, open.entry); }
  const padP = (hi - lo) * 0.06;
  lo -= padP;
  hi += padP;
  const y = (v) => TOP + (1 - (v - lo) / (hi - lo)) * PRICE_H;
  const out = [];

  out.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  out.push(`<rect x="${PAD_L}" y="${TOP}" width="${plotW}" height="${PRICE_H}" fill="${C.panel}"/>`);

  // ── شبکه
  const tagYs = (open ? [open.entry, open.stop, close] : [close, ev.ok ? ev.ema : close]).map(y);
  const st = niceStep(hi - lo, 8);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
    const yy = y(v);
    out.push(`<line x1="${PAD_L}" x2="${right}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`);
    if (!tagYs.some((t) => Math.abs(t - yy) < 16)) out.push(text(right + 8, yy + 4, fmt(v, close), { size: 12, fill: C.axis }));
  }
  const every = Math.max(1, Math.round((last - from + 1) / 7));
  for (let i = last; i >= from; i -= every) {
    const xx = x(i);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${TOP}" y2="${TOP + PRICE_H}" stroke="${C.grid}" stroke-width="1" opacity="0.6"/>`);
    out.push(text(xx, TOP + PRICE_H + 20, utc(bars[i].t).slice(0, 10), { size: 12, fill: C.axis, anchor: 'middle' }));
  }

  // ── بازه‌ی هر معامله‌ی گذشته (زیرِ کندل‌ها)
  for (const t of shown) {
    const i1 = Math.max(from, idx.get(t.entryBarT) ?? from);
    const i2 = idx.get(t.exitBarT);
    out.push(rectBetween(x(i1), x(i2), y(t.entry), y(t.exit), t.r > 0 ? C.up : C.down, 0.14));
  }
  if (open) {
    const i1 = Math.max(from, idx.get(open.entryBarT) ?? last);
    out.push(rectBetween(x(i1), right, y(open.entry), y(open.stop), C.down, 0.10));
    if (close > open.entry) out.push(rectBetween(x(i1), right, y(open.entry), y(close), C.up, 0.10));
  }

  // ── کندل‌ها
  const bw = Math.max(1.5, step * 0.62);
  for (let i = from; i <= last; i++) {
    const k = bars[i];
    const col = k.c >= k.o ? C.up : C.down;
    const xx = x(i);
    const top = y(Math.max(k.o, k.c));
    const h = Math.max(1, y(Math.min(k.o, k.c)) - top);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${y(k.h)}" y2="${y(k.l)}" stroke="${col}" stroke-width="1"/>`);
    out.push(`<rect x="${xx - bw / 2}" y="${top}" width="${bw}" height="${h}" fill="${col}"/>`);
  }

  // ── EMA
  const ep = [];
  for (let i = from; i <= last; i++) ep.push(`${x(i).toFixed(1)},${y(ind.ema[i]).toFixed(1)}`);
  out.push(`<polyline points="${ep.join(' ')}" fill="none" stroke="${EMA_COL}" stroke-width="2.2" opacity="0.95"/>`);

  // ── نشانِ ورود (زیرِ کندل) و خروج (بالای کندل)؛ برچسب‌ها روی هم نیفتند
  const boxes = [];
  const place = (cx, cy, w, dir) => {
    for (let n = 0; n < 3; n++) {
      const yy = cy + dir * n * 22;
      if (yy < TOP + 12 || yy > TOP + PRICE_H - 4) break;
      if (!boxes.some((b) => Math.abs(b.x - cx) < (b.w + w) / 2 + 4 && Math.abs(b.y - yy) < 21)) {
        boxes.push({ x: cx, y: yy, w });
        return yy;
      }
    }
    return null;
  };
  const tri = (cx, tipY, up, col) => `<path d="M${cx} ${tipY} l-6 ${up ? 11 : -11} h12 z" fill="${col}"/>`;
  const entries = [...shown, ...(open && idx.has(open.entryBarT) ? [{ entryBarT: open.entryBarT }] : [])];
  for (const t of entries) {
    const i = idx.get(t.entryBarT);
    if (i == null || i < from) continue;
    out.push(tri(x(i), y(bars[i].l) + 6, true, C.up));
  }
  for (const t of shown) {
    const i = idx.get(t.exitBarT);
    const col = t.r > 0 ? C.up : C.down;
    out.push(tri(x(i), y(bars[i].h) - 6, false, col));
    const s = `${t.r >= 0 ? '+' : ''}${t.r.toFixed(1)}R${t.exitReason === 'stop' ? ' SL' : ''}`;
    const w = s.length * 11 * 0.57 + 14;
    const base = y(bars[i].h) - 30;
    // جا نبود ← زیرِ کندل؛ آن هم نبود ← بی‌برچسب (عدد در پانویس جمع شده)
    const ly = place(x(i), Math.max(TOP + 16, base), w, -1) ?? place(x(i), Math.min(TOP + PRICE_H - 8, y(bars[i].l) + 40), w, 1);
    if (ly == null) continue;
    if (Math.abs(ly - base) > 4) {
      out.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${ly + (ly < base ? 6 : -14)}" y2="${ly < base ? y(bars[i].h) - 17 : y(bars[i].l) + 4}" stroke="${col}" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>`);
    }
    out.push(label(x(i), ly, s, col, 'middle', 11));
  }

  // ── سطوح سمتِ راست
  if (open) {
    const i1 = Math.max(from, idx.get(open.entryBarT) ?? last);
    for (const l of [
      { v: open.entry, name: 'ENTRY', col: C.entry, dash: '6 4' },
      { v: open.stop, name: `STOP ${p.stopAtr} ATR`, col: C.down, dash: '' },
    ]) {
      const yy = y(l.v);
      out.push(`<line x1="${x(i1)}" x2="${right}" y1="${yy}" y2="${yy}" stroke="${l.col}" stroke-width="1.4" stroke-dasharray="${l.dash}"/>`);
      out.push(axisTag(right, yy, fmt(l.v, close), l.col));
      out.push(text(right - 6, yy - 5, l.name, { size: 11, fill: l.col, weight: 700, anchor: 'end' }));
    }
    if (Math.abs(y(close) - y(open.entry)) > 18 && Math.abs(y(close) - y(open.stop)) > 18) out.push(axisTag(right, y(close), fmt(close, close), C.text));
  } else {
    out.push(axisTag(right, y(close), fmt(close, close), C.text));
    if (ev.ok && Math.abs(y(ev.ema) - y(close)) > 18) out.push(axisTag(right, y(ev.ema), fmt(ev.ema, close), EMA_COL));
  }
  if (ev.ok) {
    out.push(text(x(last) - 6, y(ev.ema) + (close >= ev.ema ? 18 : -10), `EMA ${p.emaPeriod}`, { size: 12, fill: EMA_COL, weight: 700, anchor: 'end' }));
  }

  // ── سربرگ
  out.push(text(PAD_L, 40, meta.pretty, { size: 26, fill: C.ink, weight: 700 }));
  out.push(text(PAD_L, 68, `1D · ${meta.exchange} · close ${utc(bars[last].t + DAY).slice(0, 10)} 00:00 UTC · EMA ${p.emaPeriod} trend · stop ${p.stopAtr} ATR`,
    { size: 14, fill: C.axis }));
  const badge = state({ open, ev, last: bars[last], p });
  out.push(`<rect x="${W - PAD_R - 230}" y="16" width="230" height="34" rx="6" fill="${badge.col}" opacity="0.16"/>`);
  out.push(text(W - PAD_R - 115, 39, badge.title, { size: 17, fill: badge.col, weight: 700, anchor: 'middle' }));
  if (ev.ok) {
    out.push(text(W - PAD_R - 115, 70, `${ev.distPct >= 0 ? '+' : ''}${ev.distPct.toFixed(1)}% vs EMA ${p.emaPeriod}`, { size: 13, fill: C.axis, anchor: 'middle' }));
  }

  // ── پانویس: کارنامه‌ی همین قاعده در همین بازه
  const wins = shown.filter((t) => t.r > 0).length;
  const sum = shown.reduce((s, t) => s + t.r, 0);
  const fy = TOP + PRICE_H + 50;
  out.push(text(PAD_L, fy, shown.length
    ? `Rule trades on chart: ${shown.length} · wins ${wins} · net ${sum >= 0 ? '+' : ''}${sum.toFixed(1)}R (fees + slippage incl.)`
    : 'No closed rule trades in this window', { size: 13, fill: C.text, weight: 700 }));
  out.push(text(PAD_L, fy + 22, `Enter: ${p.confirmBars ? `2nd daily close above EMA ${p.emaPeriod} after a cross` : `daily close crosses above EMA ${p.emaPeriod}`} · Exit: first daily close below it · Emergency stop: entry − ${p.stopAtr} ATR(${p.atrPeriod})`,
    { size: 12, fill: C.axis }));
  out.push(tri(right - 250, fy - 12, true, C.up), text(right - 238, fy - 3, 'entry', { size: 12, fill: C.axis }));
  out.push(tri(right - 180, fy - 3, false, C.axis), text(right - 168, fy - 3, 'exit (R)', { size: 12, fill: C.axis }));
  out.push(`<line x1="${right - 95}" x2="${right - 70}" y1="${fy - 7}" y2="${fy - 7}" stroke="${EMA_COL}" stroke-width="2.2"/>`, text(right - 64, fy - 3, `EMA ${p.emaPeriod}`, { size: 12, fill: C.axis }));

  if (meta.watermark) {
    out.push(text(PAD_L + plotW / 2, TOP + PRICE_H / 2, meta.watermark, { size: 48, fill: C.ink, weight: 700, anchor: 'middle', opacity: 0.05 }));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}

/** برچسبِ وضعیتِ امروز */
export function state({ open, ev, last, p = TREND_DEFAULTS }) {
  if (open) {
    if (open.entryBarT === last.t) return { key: 'entry', title: 'NEW ENTRY', col: C.up };
    const d = Math.max(1, Math.round((last.t - open.entryBarT) / DAY));
    return { key: 'in', title: `IN TREND · day ${d}`, col: C.up };
  }
  if (ev.ok && ev.crossDown) return { key: 'exit', title: `EXIT · below EMA ${p.emaPeriod}`, col: C.down };
  return { key: 'wait', title: ev.ok && ev.above ? 'ABOVE EMA · no fresh cross' : 'WAITING · below EMA', col: C.axis };
}

/** @returns {Buffer} PNG */
export function renderTrendChart(args) {
  return svgToPng(buildTrendSvg(args));
}
