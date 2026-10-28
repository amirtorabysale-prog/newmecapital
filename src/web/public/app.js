/**
 * چارتِ زنده: کندل‌ها از سرور، تحلیل همین‌جا با همان کدِ اسکن (src/strategy).
 * هر تغییرِ اسلایدر ← analyze ِ دوباره ← رسمِ دوباره. «ذخیره» تغییرها را به
 * بات می‌فرستد و از اسکنِ بعدی اعمال می‌شوند.
 */

import { analyze, mirrorCandles } from './strategy/analyze.js';
import { lineAt } from './strategy/trendline.js';
import { rsi } from './strategy/indicators.js';
import { PARAMS, CONDITIONS, getPath, setPath, coerce, formatValue } from './strategy/params.js';
import { fitLine, snapLow } from './strategy/fit.js';

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

const C = { line: '#38bdf8', teacher: '#f59e0b', fib: '#f59e0b', fibDim: '#94a3b8', div: '#a78bfa', entry: '#60a5fa', sl: '#ef4444', tp: '#22c55e', up: '#26a69a', down: '#ef5350' };

const S = {
  init: null,
  saved: {},
  draft: {},
  data: null,
  dir: 'long',
  res: null,
  draw: false,
  pts: [],
  fit: null,
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

function draftCfg() {
  const cfg = { strategy: structuredClone(S.init.strategy) };
  for (const [path, v] of Object.entries(S.draft)) setPath(cfg, path, structuredClone(v));
  return cfg;
}

const changedPaths = () => Object.keys(S.draft).filter((p) => JSON.stringify(S.draft[p]) !== JSON.stringify(S.saved[p]));

// ───────────────────────────── چارت

const LW = window.LightweightCharts;
const css = getComputedStyle(document.documentElement);
const theme = {
  layout: { background: { type: 'solid', color: css.getPropertyValue('--bg').trim() || '#131722' }, textColor: '#9aa3b5', fontSize: 11 },
  grid: { vertLines: { color: '#ffffff0a' }, horzLines: { color: '#ffffff0a' } },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#ffffff1a', rightOffset: 6 },
  rightPriceScale: { borderColor: '#ffffff1a' },
  crosshair: { mode: 0 },
  autoSize: true,
};
const chart = LW.createChart($('price'), theme);
// RSI فقط دنباله‌روی چارتِ قیمت است — خودش اسکرول/زوم نمی‌شود تا دو چارت هم را بی‌پایان جابه‌جا نکنند
const rsiChart = LW.createChart($('rsi'), { ...theme, timeScale: { ...theme.timeScale, visible: false }, handleScroll: false, handleScale: false });

const candleS = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, wickUpColor: C.up, wickDownColor: C.down, borderVisible: false });
const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
const botLineS = chart.addLineSeries({ color: C.line, lineWidth: 2, ...quiet });
const teacherS = chart.addLineSeries({ color: C.teacher, lineWidth: 2, lineStyle: 2, ...quiet });
const divS = chart.addLineSeries({ color: C.div, lineWidth: 2, lineStyle: 2, ...quiet });
const rsiS = rsiChart.addLineSeries({ color: '#e2e8f0', lineWidth: 1, ...quiet, lastValueVisible: true });
const rsiDivS = rsiChart.addLineSeries({ color: C.div, lineWidth: 2, lineStyle: 2, ...quiet });
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
  chart.timeScale().setVisibleLogicalRange({ from: cs.length - 150, to: cs.length + 6 });
}

function seg(series, pts) {
  series.setData(pts && pts[0].time < pts[1].time ? pts : []);
}

function draw() {
  if (!S.data) return;
  const cs = S.data.candles;
  const last = cs.length - 1;
  const res = S.res;
  const cfg = draftCfg();
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
    if (L.state !== 'far') mk(L.touchIdx, L.state === 'touch' ? 'روی خط' : 'نزدیک', L.state === 'touch' ? C.tp : C.fib, 'circle');

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
    if (res.candle) mk(res.candle.idx, res.candle.fa || res.candle.name, '#e879f9', 'square');

    // پلن
    if (res.plan) {
      pl(res.plan.entry, C.entry, 'ورود');
      pl(res.plan.sl, C.sl, 'SL');
      for (const t of res.plan.tps) pl(t.price, C.tp, t.label, 2);
    }
  } else {
    botLineS.setData([]);
    divS.setData([]);
    rsiDivS.setData([]);
  }

  // خطِ استاد
  if (S.pts.length === 2) {
    const [a, b] = [...S.pts].sort((x, y) => x - y);
    const y = (i) => (long ? cs[i].l : cs[i].h);
    const slope = (y(b) - y(a)) / (b - a);
    seg(teacherS, [{ time: T(a), value: y(a) }, { time: T(last), value: y(a) + slope * (last - a) }]);
  } else teacherS.setData([]);
  S.pts.forEach((i, n) => markers.push({ time: T(i), position: long ? 'belowBar' : 'aboveBar', color: C.teacher, shape: 'circle', text: n ? 'B' : 'A' }));

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
  const res = S.res;
  const thr = S.draft.alertThreshold;
  const sc = $('score');
  const chips = $('chips');
  const info = $('info');
  chips.replaceChildren();
  if (!res) {
    sc.textContent = 'بدون خط';
    sc.className = 'score';
    info.textContent = 'با این تنظیمات خطِ روندِ معتبری پیدا نشد. «قدرتِ کف» یا «حداقلِ واکنش» را کم کن، یا خطِ استاد را رسم کن.';
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
  const n = changedPaths().length;
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

// ───────────────────────────── خطِ استاد

function setDraw(on) {
  S.draw = on;
  $('draw').classList.toggle('on', on);
  $('hint').textContent = on ? `روی ${S.dir === 'long' ? 'کفِ' : 'سقفِ'} اول بزن، بعد روی دومی.` : '';
}

chart.subscribeClick((param) => {
  if (!S.draw || !S.data || param.logical == null) return;
  const cs = S.data.candles;
  const raw = Math.max(0, Math.min(cs.length - 1, Math.round(param.logical)));
  const src = S.dir === 'long' ? cs : mirrorCandles(cs);
  const i = snapLow(src, raw);
  if (S.pts.length >= 2) S.pts = [];
  if (S.pts.includes(i)) return;
  S.pts.push(i);
  tg?.HapticFeedback?.selectionChanged();
  $('clear').hidden = false;
  if (S.pts.length === 2) {
    setDraw(false);
    runFit();
  } else $('hint').textContent = `حالا ${S.dir === 'long' ? 'کفِ' : 'سقفِ'} دوم.`;
  draw();
});

function runFit() {
  const cs = S.data.candles;
  const src = S.dir === 'long' ? cs : mirrorCandles(cs);
  const [a, b] = [...S.pts].sort((x, y) => x - y);
  const cfg = draftCfg();
  S.fit = fitLine(src, cfg.strategy, a, b);
  renderFit();
}

function renderFit() {
  const box = $('fit');
  const f = S.fit;
  if (!f) { box.hidden = true; return; }
  box.hidden = false;
  const name = (path) => PARAMS.find((p) => p.path === path);
  if (!f.ok) {
    box.replaceChildren(
      el('h3', {}, 'بات این خط را نمی‌تواند پیدا کند'),
      el('ul', {}, f.reasons.map((r) => el('li', {}, r))),
      el('div', { class: 'row' }, el('button', { onclick: clearTeacher }, 'پاک کردن')),
    );
    return;
  }
  if (!f.changes.length) {
    box.replaceChildren(el('h3', {}, '✅ بات با تنظیماتِ فعلی همین خط را پیدا می‌کند'),
      el('div', { class: 'row' }, el('button', { onclick: clearTeacher }, 'پاک کردن')));
    return;
  }
  box.replaceChildren(
    el('h3', {}, 'برای این‌که بات همین خط را پیدا کند:'),
    el('ul', {}, f.changes.map((c) => {
      const p = name(c.path);
      return el('li', {}, `${p.fa}: ${formatValue(p, c.from)} ← ${formatValue(p, c.to)}`);
    })),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: applyFit }, 'اعمال روی چارت'),
      el('button', { onclick: clearTeacher }, 'پاک کردن')),
  );
}

function applyFit() {
  for (const c of S.fit.changes) {
    S.draft[c.path] = c.to;
    ctls.get(c.path)?.render();
  }
  S.fit = { ...S.fit, changes: [] };
  renderFit();
  dirty();
  recompute();
  toast('اعمال شد. اگر روی ارزهای دیگر هم درست بود، «ذخیره» را بزن.', 3500);
}

function clearTeacher() {
  S.pts = [];
  S.fit = null;
  $('clear').hidden = true;
  setDraw(false);
  renderFit();
  draw();
}

// ───────────────────────────── بارگذاری

async function loadCoin(base) {
  $('loading').hidden = false;
  $('loading').textContent = 'در حالِ گرفتنِ کندل‌ها…';
  clearTeacher();
  try {
    S.data = await api(`candles?base=${encodeURIComponent(base)}`);
    setData();
    recompute();
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
  $('draw').onclick = () => { if (S.pts.length === 2) clearTeacher(); setDraw(!S.draw); };
  $('clear').onclick = clearTeacher;
  $('save').onclick = save;
  $('revert').onclick = revert;
  tg.MainButton?.onClick(save);
  tg.enableClosingConfirmation?.();

  buildControls();
  dirty();
  if (pick) await loadCoin(pick);
}

main();
