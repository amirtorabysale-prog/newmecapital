/**
 * چارتِ زنده: کندل‌ها از سرور، تحلیل همین‌جا با همان کدِ اسکن (src/strategy).
 * دو صفحه برای هر ارز:
 *   🤖 تحلیلِ بات  — تحلیلِ بات روی چارت؛ هر اسلایدر ← analyze ِ دوباره ← رسمِ
 *                    دوباره. «ذخیره» از اسکنِ بعدی اعمال می‌شود.
 *   ✍️ تحلیلِ استاد — چارتِ خالی و ابزارِ رسمِ خط، فیبو، واگرایی و کندل. fitAll
 *                    تنظیمی را پیدا می‌کند که بات همان را ببیند؛ «تأیید» ذخیره‌اش می‌کند.
 */

import { analyze } from './strategy/analyze.js';
import { lineAt } from './strategy/trendline.js';
import { rsi } from './strategy/indicators.js';
import { PARAMS, CONDITIONS, getPath, setPath, coerce, formatValue } from './strategy/params.js';
import { fitAll } from './strategy/fit.js';

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
};

// پالتِ چارتِ گلدمی (src/lib/theme.ts ِ آن پروژه): کندل و حالت فقط سبز/قرمز/خاکستری،
// رسم‌ها رنگِ خودشان را دارند و به سبز و قرمزِ کندل نزدیک نیستند
const C = { line: '#38bdf8', teacher: '#f59e0b', fib: '#2dd4bf', fibDim: '#8e929e', div: '#a78bfa', candle: '#e879f9', entry: '#d4a62a', sl: '#ef4444', tp: '#22c55e', up: '#22c55e', down: '#ef4444' };
const SURFACE = { background: '#171d2b', grid: '#1e222d', border: '#2a2e39', crosshair: '#3a3f4d', text: '#8e929e' };

const S = {
  init: null,
  saved: {},
  draft: {},
  data: null,
  dir: 'long',
  res: null,
  // 'bot' یا 'teacher'
  mode: 'bot',
  // ── تحلیلِ استاد
  // رسم‌ها: { line: [a,b], fib: [lo,hi], div: [p,q], candle: i }
  t: {},
  fibLevel: null,
  // ابزارِ فعال و نقطه‌هایی که تا حالا زده شده
  tool: null,
  pend: [],
  // آخرین ابزار، برای دکمه‌های جابه‌جایی
  last: null,
  // کندلی که اگر الان بزنی انتخاب می‌شود (پیش‌نمایش)
  hover: null,
  all: null,
};

// ───────────────────────────── API

async function api(path, body) {
  const r = await fetch(`./api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `tma ${tg?.initData || ''}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// ───────────────────────────── پیکربندیِ پیش‌نویس

function cfgFrom(values) {
  const cfg = { strategy: structuredClone(S.init.strategy) };
  for (const [path, v] of Object.entries(values)) setPath(cfg, path, structuredClone(v));
  return cfg;
}
const draftCfg = () => cfgFrom(S.draft);
// تحلیلِ استاد روی استراتژیِ ذخیره‌شده سنجیده می‌شود، نه پیش‌نویسِ اسلایدرها
const savedCfg = () => cfgFrom(S.saved);

const changedPaths = () => Object.keys(S.draft).filter((p) => JSON.stringify(S.draft[p]) !== JSON.stringify(S.saved[p]));

// ───────────────────────────── چارت

const LW = window.LightweightCharts;
// ⚠️ متنِ فارسی روی بومِ چارت ممنوع: کتابخانه بی‌دوجهته می‌کشد و «روی خط» برعکس
// خوانده می‌شود. برچسب‌های روی چارت لاتین‌اند (ENTRY / SL / TP / TOUCH).
const crossLine = { color: SURFACE.crosshair, labelBackgroundColor: SURFACE.border };
const theme = {
  localization: { locale: 'en-GB' },
  layout: { background: { type: 'solid', color: SURFACE.background }, textColor: SURFACE.text, fontSize: 11, fontFamily: 'inherit' },
  grid: { vertLines: { color: SURFACE.grid }, horzLines: { color: SURFACE.grid } },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: SURFACE.border, rightOffset: 6, minBarSpacing: 2 },
  rightPriceScale: { borderColor: SURFACE.border, scaleMargins: { top: 0.12, bottom: 0.12 } },
  crosshair: { mode: 0, vertLine: crossLine, horzLine: crossLine },
  autoSize: true,
};
const chart = LW.createChart($('price'), theme);
// RSI فقط دنباله‌روی چارتِ قیمت است — خودش اسکرول/زوم نمی‌شود تا دو چارت هم را بی‌پایان جابه‌جا نکنند
const rsiChart = LW.createChart($('rsi'), { ...theme, timeScale: { ...theme.timeScale, visible: false }, handleScroll: false, handleScale: false });

// بدنه، مرز و سایه یک رنگ: مرزِ متفاوت کندل‌های باریک را لکه می‌کند
const candleS = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down });
const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
const botLineS = chart.addLineSeries({ color: C.line, lineWidth: 2, ...quiet });
const teacherS = chart.addLineSeries({ color: C.teacher, lineWidth: 2, lineStyle: 2, ...quiet });
const divS = chart.addLineSeries({ color: C.div, lineWidth: 2, lineStyle: 2, ...quiet });
const rsiS = rsiChart.addLineSeries({ color: '#cbd5e1', lineWidth: 1, ...quiet, lastValueVisible: true });
const rsiDivS = rsiChart.addLineSeries({ color: C.div, lineWidth: 2, lineStyle: 2, ...quiet });
const teacherRsiS = rsiChart.addLineSeries({ color: C.div, lineWidth: 2, lineStyle: 2, ...quiet });
const tDivS = chart.addLineSeries({ color: C.div, lineWidth: 2, ...quiet });
const previewS = chart.addLineSeries({ color: '#f8fafc', lineWidth: 1, lineStyle: 2, ...quiet });
let priceLines = [];
let rsiLines = [];

chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) rsiChart.timeScale().setVisibleLogicalRange(r); });

const T = (i) => Math.floor(S.data.candles[i].t / 1000);

function precisionFor(price) {
  const p = price >= 1000 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 5 : 8;
  return { type: 'price', precision: p, minMove: 1 / 10 ** p };
}

function setData() {
  const cs = S.data.candles;
  candleS.applyOptions({ priceFormat: precisionFor(cs.at(-1).c) });
  candleS.setData(cs.map((k, i) => ({ time: T(i), open: k.o, high: k.h, low: k.l, close: k.c })));
  // گوشی: ۱۵۰ کندل یعنی هر کندل ۲ پیکسل؛ کمتر نشان بده، با دو انگشت عقب برو
  const bars = Math.max(60, Math.min(150, Math.round($('price').clientWidth / 6)));
  chart.timeScale().setVisibleLogicalRange({ from: cs.length - bars, to: cs.length + 6 });
}

function seg(series, pts) {
  series.setData(pts && pts[0].time < pts[1].time ? pts : []);
}

function draw() {
  if (!S.data) return;
  const cs = S.data.candles;
  const last = cs.length - 1;
  const res = S.mode === 'bot' ? S.res : null;
  const cfg = S.mode === 'bot' ? draftCfg() : savedCfg();
  const long = S.dir === 'long';

  for (const pl of priceLines) candleS.removePriceLine(pl);
  for (const pl of rsiLines) rsiS.removePriceLine(pl);
  priceLines = [];
  rsiLines = [];
  const pl = (price, color, title, style = 0, width = 1) => priceLines.push(candleS.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: true }));

  // RSI
  const r = rsi(cs.map((k) => k.c), cfg.strategy.rsiPeriod);
  rsiS.setData(r.map((v, i) => (Number.isFinite(v) ? { time: T(i), value: v } : { time: T(i) })));
  const Z = cfg.strategy.rsiZone;
  for (const [v, c] of [[Z?.enabled ? Z.low : 30, '#ef444480'], [Z?.enabled ? Z.high : 70, '#22c55e80'], [50, '#ffffff22']]) {
    rsiLines.push(rsiS.createPriceLine({ price: v, color: c, lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
  }

  const markers = [];
  const mk = (i, text, color, shape = long ? 'arrowUp' : 'arrowDown') => markers.push({
    time: T(i), position: long ? 'belowBar' : 'aboveBar', color, shape, text,
  });

  if (res) {
    const L = res.line;
    seg(botLineS, [{ time: T(L.a), value: L.p0 }, { time: T(last), value: lineAt(L, last) }]);
    L.touches.forEach((t, n) => mk(t, String(n + 1), C.line));
    if (L.state !== 'far') mk(L.touchIdx, L.state === 'touch' ? 'TOUCH' : 'NEAR', L.state === 'touch' ? C.tp : C.fib, 'circle');

    // فیبو
    const F = res.fib;
    pl(F.end, C.fibDim, '0', 2);
    pl(F.start, C.fibDim, '1', 2);
    pl(F.price, C.fib, String(F.level), 0, 2);

    // واگرایی
    if (res.div) {
      seg(divS, [{ time: T(res.div.p), value: res.div.priceP }, { time: T(res.div.k), value: res.div.priceK }]);
      seg(rsiDivS, [{ time: T(res.div.p), value: res.div.rsiP }, { time: T(res.div.k), value: res.div.rsiK }]);
    } else {
      divS.setData([]);
      rsiDivS.setData([]);
    }
    if (res.candle) mk(res.candle.idx, res.candle.name, '#e879f9', 'square');

    // پلن
    if (res.plan) {
      pl(res.plan.entry, C.entry, 'ENTRY');
      pl(res.plan.sl, C.sl, 'SL');
      for (const t of res.plan.tps) pl(t.price, C.tp, t.label, 2);
    }
  } else {
    botLineS.setData([]);
    divS.setData([]);
    rsiDivS.setData([]);
  }

  if (S.mode === 'teacher') drawTeacher(markers, pl, r);
  else for (const x of [teacherS, tDivS, teacherRsiS, previewS]) x.setData([]);

  markers.sort((x, y) => x.time - y.time);
  candleS.setMarkers(markers);
}

// ───────────────────────────── تحلیل و خلاصه

let pending = 0;
function recompute() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    if (!S.data) return;
    S.res = analyze(S.data.candles, draftCfg(), S.dir, S.data.ltf);
    draw();
    summary();
  });
}

function summary() {
  if (S.mode !== 'bot') return;
  const res = S.res;
  const thr = S.draft.alertThreshold;
  const sc = $('score');
  const chips = $('chips');
  const info = $('info');
  chips.replaceChildren();
  if (!res) {
    sc.textContent = 'بدون خط';
    sc.className = 'score';
    info.textContent = 'با این تنظیمات خطِ روندِ معتبری پیدا نشد. «قدرتِ کف» یا «حداقلِ واکنش» را کم کن، یا در «✍️ تحلیلِ استاد» خودت رسم کن.';
    return;
  }
  sc.textContent = `${res.score}/100`;
  sc.className = `score${res.alertable && res.score >= thr ? ' alert' : ''}`;
  for (const [key, c] of Object.entries(res.components)) {
    if (!c.enabled) continue;
    const cls = c.ok ? 'ok' : c.partial ? 'half' : res.blocked.includes(key) ? 'block' : 'no';
    const icon = c.ok ? '✓' : c.partial ? '½' : '·';
    chips.append(el('span', { class: `chip ${cls}` }, `${icon} ${CONDITIONS[key].fa} ${Math.round(c.points)}/${c.max}`));
  }
  const L = res.line;
  const state = { touch: 'قیمت روی خط است', approach: 'قیمت به خط نزدیک می‌شود', far: 'قیمت از خط دور است' }[L.state];
  const parts = [
    `${state} (${L.distAtr.toFixed(2)} ATR) · ${L.touches.length} برخورد`,
    `فیبو ${res.fib.level}: ${res.fib.distAtr.toFixed(2)} ATR تا خط`,
    res.div ? `واگرایی ${res.div.type}` : 'بدونِ واگرایی',
  ];
  if (res.blocked.length) parts.push(`بسته به‌خاطرِ شرطِ الزامی: ${res.blocked.map((k) => CONDITIONS[k].fa).join('، ')}`);
  parts.push(res.alertable && res.score >= thr ? '🔔 این ستاپ هشدار می‌دهد' : `آستانه‌ی هشدار ${thr}`);
  info.textContent = parts.join(' · ');
}

// ───────────────────────────── کنترل‌ها

const GROUPS = [
  ...Object.keys(CONDITIONS).map((key) => ({ key, title: CONDITIONS[key].fa, cond: key })),
  { key: 'plan', title: 'پلنِ معامله' },
  { key: 'general', title: 'آستانه‌ی هشدار' },
];

function control(p) {
  const wrap = el('div', { class: 'ctl' });
  const render = () => {
    const v = S.draft[p.path];
    const changed = JSON.stringify(v) !== JSON.stringify(S.saved[p.path]);
    const isDefault = JSON.stringify(v) === JSON.stringify(S.init.defaults[p.path]);
    const head = el('label', {}, el('span', {}, p.fa), el('span', { class: `val${changed ? ' changed' : ''}` }, formatValue(p, v)));
    const kids = [head];
    if (p.type === 'bool') {
      kids.push(el('div', { class: 'switch' }, el('input', { type: 'checkbox', checked: !!v, onchange: (e) => set(p, e.target.checked) }), el('span', {}, v ? 'روشن' : 'خاموش')));
    } else if (p.type === 'choice') {
      kids.push(el('div', { class: 'choices' }, p.choices.map((c) => el('button', { class: c === v ? 'on' : '', onclick: () => set(p, c) }, String(c)))));
    } else if (p.type === 'list') {
      kids.push(el('input', { type: 'text', value: v.join(', '), onchange: (e) => { try { set(p, coerce(p, e.target.value)); } catch (err) { toast(err.message); } } }));
    } else {
      kids.push(el('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: v, oninput: (e) => set(p, Number(e.target.value), false) }));
    }
    if (p.about) kids.push(el('div', { class: 'about' }, p.about));
    if (!isDefault) kids.push(el('button', { class: 'reset', onclick: () => set(p, structuredClone(S.init.defaults[p.path])) }, `پیش‌فرض: ${formatValue(p, S.init.defaults[p.path])}`));
    wrap.replaceChildren(...kids);
  };
  wrap.render = render;
  render();
  return wrap;
}

const ctls = new Map();
function set(p, v, rerender = true) {
  S.draft[p.path] = v;
  const c = ctls.get(p.path);
  if (rerender) c?.render();
  else {
    // حینِ کشیدنِ اسلایدر کل را نساز (اسلایدر از دست می‌رود)؛ فقط عدد
    const val = c?.querySelector('.val');
    if (val) {
      val.textContent = formatValue(p, v);
      val.classList.toggle('changed', JSON.stringify(v) !== JSON.stringify(S.saved[p.path]));
    }
  }
  if (p.path.includes('.conditions.')) renderSummaries();
  dirty();
  recompute();
}

function renderSummaries() {
  for (const d of document.querySelectorAll('details[data-cond]')) {
    const key = d.dataset.cond;
    const base = `strategy.conditions.${key}`;
    const on = S.draft[`${base}.enabled`];
    d.querySelector('.st').textContent = !on ? 'خاموش' : `${S.draft[`${base}.required`] ? 'الزامی · ' : ''}وزن ${S.draft[`${base}.weight`]}`;
  }
}

function buildControls() {
  const box = $('controls');
  box.replaceChildren();
  ctls.clear();
  const paths = new Set(S.init.paths);
  for (const g of GROUPS) {
    const ps = PARAMS.filter((p) => paths.has(p.path) && (p.group === g.key) && (g.key !== 'general' || p.path === 'alertThreshold'));
    // شرط‌ها: روشن/الزامی/وزن اول، بعد بقیه
    ps.sort((x, y) => Number(!x.hidden) - Number(!y.hidden));
    if (!ps.length) continue;
    const det = el('details', g.cond ? { 'data-cond': g.cond } : {}, el('summary', {}, el('span', {}, g.title), el('span', { class: 'st' })));
    for (const p of ps) {
      // شرطِ پایه (خط روند) نه خاموش می‌شود نه اختیاری — مثلِ پنلِ تلگرام
      if (g.cond && CONDITIONS[g.cond].locked && /\.(enabled|required)$/.test(p.path)) continue;
      const c = control(p);
      ctls.set(p.path, c);
      det.append(c);
    }
    box.append(det);
  }
  renderSummaries();
}

function dirty() {
  // صفحه‌ی استاد ذخیره‌ی خودش را دارد («تأیید»)
  const n = S.mode === 'bot' ? changedPaths().length : 0;
  $('savebar').hidden = !n;
  $('dirty').textContent = `${n} تغییرِ ذخیره‌نشده`;
  if (tg?.MainButton) {
    if (n) tg.MainButton.setText(`ذخیره در بات (${n})`).show();
    else tg.MainButton.hide();
  }
}

async function save() {
  const changed = changedPaths();
  if (!changed.length) return;
  const values = Object.fromEntries(changed.map((p) => [p, S.draft[p]]));
  try {
    tg?.MainButton?.showProgress();
    const r = await api('save', { values });
    S.saved = { ...r.values };
    S.draft = structuredClone(r.values);
    for (const c of ctls.values()) c.render();
    renderSummaries();
    dirty();
    recompute();
    teacherRun();
    tg?.HapticFeedback?.notificationOccurred('success');
    toast(r.errors.length ? `ذخیره شد، با خطا: ${r.errors.join(' · ')}` : `✅ ${r.saved} تغییر ذخیره شد؛ از اسکنِ بعدی اعمال می‌شود.`, 4000);
  } catch (e) {
    toast(`❌ ${e.message}`, 4000);
  } finally {
    tg?.MainButton?.hideProgress();
  }
}

function revert() {
  S.draft = structuredClone(S.saved);
  for (const c of ctls.values()) c.render();
  renderSummaries();
  dirty();
  recompute();
}

// ───────────────────────────── دو صفحه

function setMode(mode) {
  S.mode = mode;
  for (const b of $('mode').children) b.classList.toggle('on', b.dataset.mode === mode);
  const bot = mode === 'bot';
  for (const id of ['chips', 'info', 'controls']) $(id).hidden = !bot;
  for (const id of ['ttools', 'thint']) $(id).hidden = bot;
  S.tool = null;
  S.pend = [];
  S.hover = null;
  try {
    const u = new URL(location.href);
    u.searchParams.set('mode', mode);
    history.replaceState(null, '', u);
  } catch { /* اختیاری */ }
  renderTools();
  renderReview();
  dirty();
  draw();
  if (bot) summary();
  else teacherScore();
}

// ───────────────────────────── تحلیلِ استاد

/**
 * هر ابزار چند نقطه دارد و هر نقطه از چه نوعی است:
 *   low  — کف (برای فروش سقف): همان چیزی که خط و واگرایی رویش بنا می‌شوند
 *   high — سقفِ موج (برای فروش کف): سرِ دومِ فیبو
 *   x    — خودِ کندل، بی‌توجه به قیمت: کندلِ برگشتی
 */
const TOOLS = {
  line: { fa: 'خط روند', icon: '📏', pts: ['low', 'low'], tag: 'L', color: C.teacher },
  fib: { fa: 'فیبوناچی', icon: '🌀', pts: ['low', 'high'], tag: 'F', color: C.fib },
  div: { fa: 'واگرایی RSI', icon: '〰️', pts: ['low', 'low'], tag: 'D', color: C.div },
  candle: { fa: 'کندل برگشتی', icon: '🕯', pts: ['x'], tag: 'C', color: C.candle },
};

function toolHint(key, n) {
  const [lo, hi] = S.dir === 'long' ? ['کفِ', 'سقفِ'] : ['سقفِ', 'کفِ'];
  return {
    line: [`روی ${lo} اول بزن.`, `حالا ${lo} دوم.`],
    fib: [`روی ${lo} موج بزن (شروعِ فیبو).`, `حالا ${hi} موج.`],
    div: [`روی ${lo} قبلی بزن.`, `حالا ${lo} برخورد به خط (K روی چارت).`],
    candle: ['روی کندلِ آخرِ الگو بزن.'],
  }[key][n];
}

// «کفِ» یک نقطه روی چارتِ واقعی: خرید low، فروش high (و برعکس برای سقفِ موج)
const usesLow = (kind) => (S.dir === 'long') === (kind !== 'high');
const priceOf = (i, kind) => (usesLow(kind) ? S.data.candles[i].l : S.data.candles[i].h);
const posOf = (kind) => (usesLow(kind) ? 'belowBar' : 'aboveBar');

/**
 * نقطه‌ی زیرِ انگشت → کندل: نزدیک‌ترین کف/سقف به خودِ نقطه، به پیکسل، در
 * شعاعِ HIT_PX — نه پایین‌ترین کفِ اطراف. قبلاً پایین‌ترین low ِ ±۳ کندل
 * برداشته می‌شد و روی گوشی (هر کندل ~۲ پیکسل) نقطه جای دیگری می‌پرید.
 */
const HIT_PX = 22;
function pickAt(point, kind) {
  if (!point || !S.data) return null;
  const cs = S.data.candles;
  const ts = chart.timeScale();
  const logical = ts.coordinateToLogical(point.x);
  if (logical == null) return null;
  const c = Math.max(0, Math.min(cs.length - 1, Math.round(logical)));
  if (kind === 'x') return c;
  const spacing = Math.max(0.5, Math.abs((ts.logicalToCoordinate(1) ?? 0) - (ts.logicalToCoordinate(0) ?? 0)));
  const r = Math.max(1, Math.ceil(HIT_PX / spacing));
  let best = null;
  let bestD = Infinity;
  for (let j = Math.max(0, c - r); j <= Math.min(cs.length - 1, c + r); j++) {
    const x = ts.logicalToCoordinate(j);
    const y = candleS.priceToCoordinate(priceOf(j, kind));
    if (x == null || y == null) continue;
    // افقی سنگین‌تر: انگشت معمولاً روی کندلِ درست است ولی دقیقاً روی سایه نیست
    const d = Math.hypot((x - point.x) * 1.5, y - point.y);
    if (d < bestD) { bestD = d; best = j; }
  }
  // از کندلِ زیرِ انگشت سراشیبی تا تهِ همان کف، ولی نه بیرون از شعاع: انگشت
  // معمولاً یکی‌دو کندل کنارِ کف می‌نشیند، و خط و واگرایی کفِ واقعی می‌خواهند
  const v = (j) => (usesLow(kind) ? cs[j].l : -cs[j].h);
  for (let moved = true; best != null && moved;) {
    moved = false;
    for (const j of [best - 1, best + 1]) {
      if (j >= 0 && j < cs.length && Math.abs(j - c) <= r && v(j) < v(best)) { best = j; moved = true; break; }
    }
  }
  return best;
}

chart.subscribeCrosshairMove((param) => {
  if (S.mode !== 'teacher' || !S.tool) return;
  const j = pickAt(param.point, TOOLS[S.tool].pts[S.pend.length]);
  if (j === S.hover) return;
  S.hover = j;
  draw();
});

chart.subscribeClick((param) => {
  if (S.mode !== 'teacher' || !S.tool || !S.data) return;
  const kinds = TOOLS[S.tool].pts;
  const i = pickAt(param.point, kinds[S.pend.length]);
  if (i == null || S.pend.includes(i)) return;
  S.pend.push(i);
  S.hover = null;
  tg?.HapticFeedback?.selectionChanged();
  if (S.pend.length === kinds.length) {
    S.t[S.tool] = kinds.length === 1 ? S.pend[0] : [...S.pend];
    if (S.tool === 'fib') S.fibLevel = null;
    S.last = S.tool;
    S.tool = null;
    S.pend = [];
    teacherRun();
  }
  renderTools();
  draw();
});

function pickTool(key) {
  S.tool = S.tool === key ? null : key;
  S.pend = [];
  S.hover = null;
  renderTools();
  draw();
}

function renderTools() {
  const box = $('ttools');
  const items = S.all?.items || {};
  box.replaceChildren(...Object.entries(TOOLS).map(([key, T]) => {
    const st = S.t[key] == null ? '' : items[key]?.ok ? '✅' : '❌';
    return el('button', { class: S.tool === key ? 'on' : '', onclick: () => pickTool(key) },
      `${T.icon} ${T.fa}`, st ? el('span', { class: 'st' }, st) : null);
  }));
  if (Object.keys(S.t).length) box.append(el('button', { class: 'ghost', onclick: () => clearTeacher() }, '🗑 پاک کردنِ همه'));
  $('hint').textContent = S.tool ? toolHint(S.tool, S.pend.length)
    : Object.keys(S.t).length ? '' : 'ابزار را انتخاب کن و روی چارت بزن. از خطِ روند شروع کن؛ بقیه به آن وابسته‌اند.';
  renderNudge();
}

/** جابه‌جا کردنِ نقطه‌های آخرین رسم یک کندل، برای وقتی انگشت درست ننشست */
function renderNudge() {
  const box = $('nudge');
  const key = S.last;
  const v = key && S.t[key];
  box.hidden = S.mode !== 'teacher' || v == null || S.tool != null;
  if (box.hidden) return;
  const pts = Array.isArray(v) ? v : [v];
  box.replaceChildren(el('span', { class: 'hint' }, `جابه‌جاییِ ${TOOLS[key].fa}:`), ...pts.map((_, n) => el('span', { class: 'pt' },
    `${TOOLS[key].tag}${pts.length > 1 ? n + 1 : ''} `,
    el('button', { onclick: () => nudge(key, n, -1) }, '◀'),
    el('button', { onclick: () => nudge(key, n, 1) }, '▶'))));
}

function nudge(key, n, d) {
  const last = S.data.candles.length - 1;
  const v = S.t[key];
  if (Array.isArray(v)) {
    const to = Math.max(0, Math.min(last, v[n] + d));
    if (v.includes(to)) return;
    v[n] = to;
  } else S.t[key] = Math.max(0, Math.min(last, v + d));
  tg?.HapticFeedback?.selectionChanged();
  teacherRun();
}

function removeDrawing(key) {
  delete S.t[key];
  if (S.last === key) S.last = null;
  teacherRun();
}

function teacherRun() {
  if (!S.data) return;
  S.all = Object.keys(S.t).length
    ? fitAll(S.data.candles, savedCfg(), S.dir, { ...S.t, fibLevel: S.fibLevel }, S.data.ltf)
    : null;
  // بات کفِ دومِ واگرایی را روی خودِ کندلِ برخورد می‌گیرد؛ رسم هم همان را نشان دهد
  const D = S.all?.items.div;
  if (S.t.div && D?.k != null && Math.abs(Math.max(...S.t.div) - D.k) <= 2) S.t.div = [D.p, D.k];
  renderTools();
  renderReview();
  teacherScore();
  draw();
}

function teacherScore() {
  if (S.mode !== 'teacher') return;
  const f = S.all?.final;
  $('score').textContent = f ? `${f.score}/100` : '—';
  $('score').className = `score${f && f.alertable && f.score >= S.saved.alertThreshold ? ' alert' : ''}`;
}

const label = (path) => {
  const p = PARAMS.find((q) => q.path === path);
  const group = CONDITIONS[p.group]?.fa;
  return { p, text: group && !p.fa.startsWith(group) ? `${group} · ${p.fa}` : p.fa };
};

function renderReview() {
  const box = $('review');
  const A = S.all;
  box.hidden = S.mode !== 'teacher' || !A;
  if (box.hidden) return;
  const rv = (v) => (S.dir === 'short' ? 100 - v : v).toFixed(1);
  const detail = {
    line: (f) => (f.ok ? `بات همین خط را می‌بیند${A.final ? ` · ${A.final.line.touches.length} برخورد` : ''}.` : ''),
    fib: (f) => (f.retrace != null ? `خط در کندلِ برخورد روی سطحِ ${f.retrace.toFixed(3)} فیبو است؛ تا سطحِ ${f.level}: ${f.distAtr.toFixed(2)} ATR.` : ''),
    div: (f) => (f.type ? `${f.type === 'regular' ? 'واگراییِ معمولی' : 'واگراییِ مخفی'} · RSI: ${rv(f.rsiP)} ← ${rv(f.rsiK)}` : ''),
    candle: (f) => (f.pattern ? `${f.pattern.fa} (${f.pattern.name})` : ''),
  };
  const kids = [el('h3', {}, 'بررسیِ تحلیلِ استاد')];
  for (const key of Object.keys(TOOLS)) {
    const f = A.items[key];
    if (!f) continue;
    const head = el('h4', {}, el('span', {}, `${f.ok ? '✅' : '❌'} ${TOOLS[key].icon} ${TOOLS[key].fa}`), el('span', { class: 'acts' },
      el('button', { onclick: () => pickTool(key) }, '✏️'),
      el('button', { onclick: () => removeDrawing(key) }, '✖')));
    const item = el('div', { class: 'item' }, head);
    const d = detail[key](f);
    if (d) item.append(el('p', { class: 'hint' }, d));
    if (!f.ok && f.reasons.length) item.append(el('ul', {}, f.reasons.map((r) => el('li', {}, r))));
    if (key === 'fib' && f.level != null) {
      // استاد می‌تواند بگوید منظورش کدام سطح بود
      item.append(el('div', { class: 'levels' }, PARAMS.find((q) => q.path === 'strategy.fib.level').choices.map((c) => el('button', {
        class: c === f.level ? 'on' : '',
        onclick: () => { S.fibLevel = c; teacherRun(); },
      }, String(c)))));
    }
    kids.push(item);
  }

  const total = el('div', { class: 'total' });
  if (A.changes.length) {
    total.append(el('p', {}, 'برای این‌که بات همین تحلیل را ببیند، استراتژی این‌طور عوض می‌شود:'),
      el('ul', {}, A.changes.map((c) => {
        const { p, text } = label(c.path);
        return el('li', {}, `${text}: ${formatValue(p, c.from)} ← ${formatValue(p, c.to)}`);
      })));
  } else if (Object.values(A.items).every((f) => f.ok)) {
    total.append(el('p', {}, '✅ بات با استراتژیِ فعلی همین تحلیل را می‌بیند؛ چیزی برای تغییر نیست.'));
  }
  if (A.final) {
    const on = Object.entries(A.final.components).filter(([, c]) => c.enabled)
      .map(([key, c]) => `${c.ok ? '✓' : c.partial ? '½' : '✗'} ${CONDITIONS[key].fa}`);
    total.append(el('p', { class: 'hint' }, `با این استراتژی بات این چارت را ${A.final.score}/100 می‌بیند: ${on.join('، ')}`));
    // امتیاز فقط وقتی قیمت به خط رسیده معنا دارد
    if (A.final.line.state === 'far') total.append(el('p', { class: 'hint' }, `قیمت الان ${A.final.line.distAtr.toFixed(1)} ATR از خط دور است؛ امتیاز وقتی قیمت به خط برسد حساب می‌شود.`));
  }
  if (Object.values(A.items).some((f) => !f.ok)) {
    total.append(el('p', { class: 'warn' }, A.changes.length ? 'موردهای ❌ در استراتژی نمی‌آیند؛ «تأیید» فقط موردهای ✅ را ذخیره می‌کند.' : 'موردهای ❌ را درست کن یا پاک کن.'));
  }
  if (A.changes.length) {
    total.append(el('p', { class: 'warn' }, '⚠️ استراتژی برای همه‌ی ارزهاست؛ این تغییر روی اسکنِ بقیه هم اثر دارد.'));
    const btn = el('button', { class: 'primary confirm' }, '✅ تأیید — این بشود استراتژی');
    btn.onclick = () => {
      // دو مرحله: دکمه‌ی اشتباهی نباید استراتژی را عوض کند
      if (!btn.dataset.sure) {
        btn.dataset.sure = '1';
        btn.textContent = 'مطمئنی؟ دوباره بزن تا ذخیره شود';
        setTimeout(() => { delete btn.dataset.sure; btn.textContent = '✅ تأیید — این بشود استراتژی'; }, 4000);
        return;
      }
      confirmTeacher();
    };
    total.append(btn);
  }
  kids.push(total);
  box.replaceChildren(...kids);
}

async function confirmTeacher() {
  const values = Object.fromEntries(S.all.changes.map((c) => [c.path, c.to]));
  try {
    const r = await api('save', { values });
    S.saved = { ...r.values };
    // پیش‌نویسِ اسلایدرهای صفحه‌ی بات هم از استراتژیِ تازه شروع شود
    S.draft = structuredClone(r.values);
    for (const c of ctls.values()) c.render();
    renderSummaries();
    dirty();
    recompute();
    teacherRun();
    tg?.HapticFeedback?.notificationOccurred('success');
    toast(r.errors.length ? `ذخیره شد، با خطا: ${r.errors.join(' · ')}` : `✅ استراتژی عوض شد (${r.saved} تغییر)؛ از اسکنِ بعدی اعمال می‌شود.`, 4500);
  } catch (e) {
    toast(`❌ ${e.message}`, 4000);
  }
}

function clearTeacher(run = true) {
  S.t = {};
  S.fibLevel = null;
  S.tool = null;
  S.pend = [];
  S.last = null;
  S.hover = null;
  S.all = null;
  if (run) teacherRun();
}

/** رسم‌های استاد روی چارتِ خالی (draw صدایش می‌زند) */
function drawTeacher(markers, pl, r) {
  const cs = S.data.candles;
  const last = cs.length - 1;
  const items = S.all?.items || {};
  const mark = (i, kind, tag, color, shape = 'circle') => markers.push({ time: T(i), position: posOf(kind), color, shape, text: tag });
  for (const x of [teacherS, tDivS, teacherRsiS, previewS]) x.setData([]);

  if (S.t.line) {
    const [a, b] = [...S.t.line].sort((x, y) => x - y);
    const slope = (priceOf(b, 'low') - priceOf(a, 'low')) / (b - a);
    seg(teacherS, [{ time: T(a), value: priceOf(a, 'low') }, { time: T(last), value: priceOf(a, 'low') + slope * (last - a) }]);
    S.t.line.forEach((i, n) => mark(i, 'low', `L${n + 1}`, TOOLS.line.color));
  }
  if (S.t.fib) {
    const [lo, hi] = S.t.fib;
    const start = priceOf(lo, 'low');
    const end = priceOf(hi, 'high');
    const at = (L) => end - L * (end - start);
    const chosen = items.fib?.level;
    pl(end, C.fibDim, '0', 2);
    pl(start, C.fibDim, '1', 2);
    for (const L of PARAMS.find((q) => q.path === 'strategy.fib.level').choices) {
      pl(at(L), L === chosen ? C.fib : `${C.fib}66`, String(L), L === chosen ? 0 : 2, L === chosen ? 2 : 1);
    }
    mark(lo, 'low', 'F1', C.fib);
    mark(hi, 'high', 'F2', C.fib);
  }
  if (S.t.div) {
    const [p, q] = [...S.t.div].sort((x, y) => x - y);
    seg(tDivS, [{ time: T(p), value: priceOf(p, 'low') }, { time: T(q), value: priceOf(q, 'low') }]);
    if (Number.isFinite(r[p]) && Number.isFinite(r[q])) seg(teacherRsiS, [{ time: T(p), value: r[p] }, { time: T(q), value: r[q] }]);
    mark(p, 'low', 'D1', C.div);
    mark(q, 'low', 'D2', C.div);
  }
  if (S.t.candle != null) mark(S.t.candle, 'low', items.candle?.pattern?.name || 'C', C.candle, 'square');

  // کندلِ برخوردی که بات واگرایی و الگو را رویش می‌سنجد
  const k = S.all?.final?.line.touchIdx;
  if (k != null && (S.tool === 'div' || S.tool === 'candle')) mark(k, 'low', 'K', '#f8fafc', S.dir === 'long' ? 'arrowUp' : 'arrowDown');

  // در حالِ رسم: نقطه‌های زده‌شده، پیش‌نمایشِ نقطه‌ی بعد و خطِ موقت
  if (S.tool) {
    const T0 = TOOLS[S.tool];
    S.pend.forEach((i, n) => mark(i, T0.pts[n], `${T0.tag}${n + 1}`, T0.color));
    const kind = T0.pts[S.pend.length];
    if (S.hover != null && !S.pend.includes(S.hover)) {
      mark(S.hover, kind, `${T0.tag}${T0.pts.length > 1 ? S.pend.length + 1 : ''}`, '#f8fafc');
      if (S.pend.length === 1) {
        const [a, b] = [[S.pend[0], T0.pts[0]], [S.hover, kind]].sort((x, y) => x[0] - y[0]);
        seg(previewS, [{ time: T(a[0]), value: priceOf(...a) }, { time: T(b[0]), value: priceOf(...b) }]);
      }
    }
  }
}

// ───────────────────────────── بارگذاری

async function loadCoin(base) {
  $('loading').hidden = false;
  $('loading').textContent = 'در حالِ گرفتنِ کندل‌ها…';
  clearTeacher(false);
  try {
    S.data = await api(`candles?base=${encodeURIComponent(base)}`);
    setData();
    recompute();
    teacherRun();
    $('loading').hidden = true;
    try { localStorage.setItem('coin', base); } catch { /* اختیاری */ }
  } catch (e) {
    $('loading').textContent = `❌ ${e.message}`;
  }
}

async function main() {
  if (!tg?.initData) {
    $('loading').textContent = 'این صفحه را از داخلِ بات باز کن (پنل ← استراتژی ← چارتِ زنده).';
    return;
  }
  try {
    S.init = await api('init');
  } catch (e) {
    $('loading').textContent = `❌ ${e.message}`;
    return;
  }
  S.saved = { ...S.init.values };
  S.draft = structuredClone(S.init.values);
  S.dir = S.init.directions.includes('long') ? 'long' : 'short';
  for (const b of $('dir').children) b.classList.toggle('on', b.dataset.dir === S.dir);

  const sel = $('coin');
  for (const w of S.init.watchlist) sel.append(el('option', { value: w.base }, w.id));
  const q = new URLSearchParams(location.search).get('coin') || tg.initDataUnsafe?.start_param;
  let saved = null;
  try { saved = localStorage.getItem('coin'); } catch { /* اختیاری */ }
  const pick = [q, saved].find((b) => b && S.init.watchlist.some((w) => w.base === b)) || S.init.watchlist[0]?.base;
  sel.value = pick;
  sel.onchange = () => loadCoin(sel.value);

  for (const b of $('dir').children) {
    b.onclick = () => {
      S.dir = b.dataset.dir;
      for (const x of $('dir').children) x.classList.toggle('on', x === b);
      clearTeacher();
      recompute();
    };
  }
  for (const b of $('mode').children) b.onclick = () => setMode(b.dataset.mode);
  $('save').onclick = save;
  $('revert').onclick = revert;
  tg.MainButton?.onClick(save);
  tg.enableClosingConfirmation?.();

  buildControls();
  setMode(new URLSearchParams(location.search).get('mode') === 'teacher' ? 'teacher' : 'bot');
  if (pick) await loadCoin(pick);
}

main();
