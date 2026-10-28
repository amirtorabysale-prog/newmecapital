import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, mirrorCandles } from '../src/strategy/analyze.js';
import { rsi, pivotLows } from '../src/strategy/indicators.js';
import { findReversal } from '../src/strategy/patterns.js';
import { closedOnly } from '../src/exchanges/index.js';
import { parseSymbol } from '../src/config.js';
import { buildChartSvg } from '../src/chart/render.js';
import { adminAlert, channelAnalysis, channelSignal } from '../src/messages.js';
import { longSetup, candlesFrom, path, ltfDivergence } from './fixtures.js';
import cfgJson from '../config/default.json' with { type: 'json' };

const cfg = structuredClone(cfgJson);

test('ستاپِ کامل: هر چهار شرط و امتیازِ ۱۰۰', () => {
  const r = analyze(longSetup(), cfg, 'long');
  assert.ok(r, 'خط روند پیدا نشد');
  assert.equal(r.score, 100);
  assert.equal(r.complete, true);
  assert.equal(r.line.state, 'touch');
  assert.equal(r.line.touches.length, 2);
  assert.equal(r.div.type, 'hidden');
  assert.equal(r.candle.key, 'engulfing');
});

test('واگراییِ 5 دقیقه: کفِ پایین‌تر با RSI بالاتر بعد از شروعِ کندلِ برخورد', () => {
  const c = longSetup();
  const touchT = c[analyze(c, cfg, 'long').line.touchIdx].t;
  const r = analyze(c, cfg, 'long', ltfDivergence(touchT));
  assert.equal(r.div5m?.type, 'regular');
  assert.ok(r.div5m.tK >= touchT && r.div5m.tP < touchT, 'کفِ دوم باید روی برخورد باشد، کفِ اول پیش از آن');
  assert.equal(r.components.divergence5m.ok, true);
  assert.equal(r.score, 100);
  assert.match(adminAlert({ item: { id: 'TESTUSDT' }, data: { candles: c, pretty: 'TEST/USDT', exchange: 'LBank' }, result: r }, cfg), /RSI 5 دقیقه/);

  // همان کندل‌ها ولی همه پیش از برخورد ← واگرایی روی برخورد نیست
  const early = ltfDivergence(touchT).map((k) => ({ ...k, t: k.t - 6 * 3_600_000 }));
  const r2 = analyze(c, cfg, 'long', early);
  assert.equal(r2.div5m, null);
  assert.equal(r2.components.divergence5m.points, 0);
  assert.ok(r2.score < 100);
});

test('واگراییِ 5 دقیقه بی‌داده: اختیاری ← از امتیاز بیرون، الزامی ← ستاپ بسته', () => {
  const r = analyze(longSetup(), cfg, 'long', null);
  assert.equal(r.components.divergence5m.unavailable, true);
  assert.equal(r.score, 100, 'نبودِ داده نباید امتیاز را کم کند');
  assert.deepEqual(r.blocked, []);

  const strict = structuredClone(cfg);
  strict.strategy.conditions.divergence5m.required = true;
  const s = analyze(longSetup(), strict, 'long', null);
  assert.deepEqual(s.blocked, ['divergence5m']);
  assert.equal(s.alertable, false);
});

test('واگراییِ 5 دقیقه در فروش قرینه‌ی خرید است', () => {
  const c = longSetup();
  const ltf = ltfDivergence(c[analyze(c, cfg, 'long').line.touchIdx].t);
  const L = analyze(c, cfg, 'long', ltf);
  const S = analyze(mirrorCandles(c), cfg, 'short', mirrorCandles(ltf));
  assert.equal(S.div5m.type, L.div5m.type);
  assert.ok(Math.abs(S.div5m.rsiK - (100 - L.div5m.rsiK)) < 1e-9);
  assert.ok(Math.abs(S.div5m.priceK + L.div5m.priceK) < 1e-9);
});

test('ناحیه‌ی اشباعِ RSI: کف باید زیرِ low و سقف بالای high رفته باشد', () => {
  const c = longSetup();
  const ltf = ltfDivergence(c[analyze(c, cfg, 'long').line.touchIdx].t);
  const withZone = (low, high, enabled = true) => {
    const x = structuredClone(cfg);
    x.strategy.rsiZone = { enabled, low, high };
    return x;
  };
  // کفِ اولِ داده‌ی ۵ دقیقه RSI ِ حدودِ 15.7 دارد
  assert.ok(analyze(c, withZone(30, 80), 'long', ltf).div5m, 'زیرِ 30 است و باید قبول شود');
  assert.equal(analyze(c, withZone(10, 80), 'long', ltf).div5m, null, 'به 10 نرسیده و باید رد شود');
  assert.ok(analyze(c, withZone(10, 80, false), 'long', ltf).div5m, 'شرطِ خاموش نباید رد کند');

  // فروش: RSI ِ سقف 100 − 15.7 = 84.3 ← بالای 80 قبول، بالای 85 نه
  const mc = mirrorCandles(c);
  const ml = mirrorCandles(ltf);
  assert.ok(analyze(mc, withZone(30, 80), 'short', ml).div5m, 'سقفِ 84 از 80 گذشته');
  assert.equal(analyze(mc, withZone(30, 85), 'short', ml).div5m, null, 'سقفِ 84 به 85 نرسیده');
});

test('پلن: حد ضرر زیرِ خط، تارگت‌ها بالای ورود و به ترتیب', () => {
  const r = analyze(longSetup(), cfg, 'long');
  const p = r.plan;
  assert.ok(p.sl < p.invalidation && p.sl < p.entry);
  assert.ok(p.tps.length === 3);
  for (let i = 0; i < p.tps.length; i++) {
    assert.ok(p.tps[i].price > p.entry);
    if (i) assert.ok(p.tps[i].price > p.tps[i - 1].price);
  }
  // تارگتِ اول = سقفِ موج
  assert.equal(p.tps[0].price, r.fib.end);
});

test('فروش همان منطقِ خرید روی قیمتِ قرینه است', () => {
  const longC = longSetup();
  const L = analyze(longC, cfg, 'long');
  const S = analyze(mirrorCandles(longC), cfg, 'short');
  assert.equal(S.score, L.score);
  assert.equal(S.direction, 'short');
  assert.ok(Math.abs(S.plan.entry + L.plan.entry) < 1e-9, 'ورودِ فروش باید قرینه‌ی ورودِ خرید باشد');
  assert.ok(Math.abs(S.plan.sl + L.plan.sl) < 1e-9);
  assert.equal(S.candle.name, 'Bearish Engulfing');
  assert.ok(Math.abs(S.div.rsiK - (100 - L.div.rsiK)) < 1e-9);
  assert.ok(S.plan.sl > S.plan.entry, 'حد ضررِ فروش بالای ورود');
});

test('خطِ شکسته‌شده ستاپ نیست', () => {
  const c = longSetup();
  // یک کندل وسطِ راه زیرِ خط بسته شود
  c[100] = { ...c[100], o: 112, c: 100, l: 99.5, h: 112.2 };
  const r = analyze(c, cfg, 'long');
  assert.ok(!r || r.line.a > 100, 'خطی که از ۴۰ شروع شده باید با شکست رد شود');
});

test('قیمتِ دور از خط: بدونِ الگوی کندلی و بدونِ پلن', () => {
  const c = longSetup().slice(0, 132); // هنوز به خط نرسیده
  const r = analyze(c, cfg, 'long');
  if (r) {
    assert.notEqual(r.line.state, 'touch');
    assert.equal(r.plan, null);
    assert.equal(r.components.candle.points, 0);
    assert.ok(r.score < cfg.alertThreshold);
  }
});

test('RSI: صعودِ خالص ۱۰۰، نزولِ خالص ۰', () => {
  const up = rsi(path([[0, 1], [40, 41]]), 14);
  const down = rsi(path([[0, 41], [40, 1]]), 14);
  assert.equal(up.at(-1), 100);
  assert.equal(down.at(-1), 0);
});

test('کفِ چرخشی: کفِ دوقلو یک بار شمرده می‌شود', () => {
  const c = candlesFrom(path([[0, 10], [10, 5], [20, 10]]));
  c[11] = { ...c[11], l: c[10].l };
  assert.deepEqual(pivotLows(c, 3), [10]);
});

test('الگوها: چکش و پوشا', () => {
  const A = 1;
  const hammer = [{ o: 10, h: 10.25, l: 8.5, c: 10.2 }];
  assert.equal(findReversal(hammer, A, 1).key, 'hammer');
  const engulf = [{ o: 10, h: 10.1, l: 9.4, c: 9.5 }, { o: 9.45, h: 10.3, l: 9.4, c: 10.2 }];
  assert.equal(findReversal(engulf, A, 1).key, 'engulfing');
  const none = [{ o: 10, h: 10.6, l: 9.9, c: 10.5 }];
  assert.equal(findReversal(none, A, 1), null);
});

test('کندلِ نیمه‌کاره حذف می‌شود', () => {
  const now = Date.UTC(2026, 0, 1, 5, 30);
  const rows = [0, 1, 2, 3, 4, 5].map((h) => ({ t: Date.UTC(2026, 0, 1, h), c: 1 }));
  assert.equal(closedOnly(rows, '1h', now).length, 5);
});

test('نماد: همه‌ی شکل‌ها به یک base می‌رسند', () => {
  for (const s of ['sol', 'SOLUSDT', 'SOL/USDT', 'sol_usdt']) assert.equal(parseSymbol(s).base, 'SOL');
  assert.equal(parseSymbol('BTCUSD').base, 'BTC');
});

test('تصویر: SVG ساخته می‌شود و همه‌ی لایه‌ها را دارد', () => {
  const c = longSetup();
  const r = analyze(c, cfg, 'long');
  const svg = buildChartSvg({ candles: c, result: r, meta: { pretty: 'TEST/USDT', exchange: 'LBank', timeframe: '1h' } });
  for (const s of ['Bullish Engulfing', 'Hidden Bullish Divergence', 'ENTRY', 'SL', 'TP1', '0.618']) {
    assert.ok(svg.includes(s), `در تصویر نیست: ${s}`);
  }
  assert.ok(!svg.includes('NaN'), 'مختصاتِ NaN در SVG');
});

test('پیام‌ها: کپشنِ هشدار زیرِ ۱۰۲۴ و ارقام لاتین', () => {
  const c = longSetup();
  const r = { item: { id: 'TESTUSDT' }, data: { candles: c, pretty: 'TEST/USDT', exchange: 'LBank' }, result: analyze(c, cfg, 'long') };
  const caption = adminAlert(r, cfg).replace(/<[^>]+>/g, '');
  assert.ok(caption.length <= 1024, `کپشن ${caption.length} کاراکتر`);
  for (const t of [adminAlert(r, cfg), channelAnalysis(r, cfg), channelSignal(r)]) {
    assert.ok(!/[۰-۹]/.test(t.replace(/۱ تا ۲ درصدِ/, '')), 'رقمِ فارسی در عدد');
  }
});
