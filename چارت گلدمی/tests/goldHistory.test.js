import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanCandles, assessCandleQuality, validateImportRequest, importHistory, probeSources,
  INTERVALS, MAX_DATASET_CANDLES, MIN_SCENARIO_CANDLES, SOURCES,
} from '../server/services/goldHistory.js';

/**
 * واردکردن تاریخچه‌ی طلا برای سناریوهای آموزشی.
 *
 * ⚠️ هیچ تماس شبکه‌ای واقعی در این تست‌ها نیست — همه با fetch جعلی. وگرنه تست به
 * در دسترس بودن منابع بیرونی و به قیمت لحظه‌ای طلا گره می‌خورد و هر دو بی‌ربط‌اند.
 *
 * 🐛 نسخه‌ی اول فقط بایننس را داشت و روی سرور واقعی کار نکرد (کد ۴۵۱ — بایننس
 * آی‌پی آمریکا را مسدود می‌کند). این تست‌ها هم زنجیره‌ی جایگزین را نگه می‌دارند و
 * هم این را که وقتی همه شکست می‌خورند، *دلیلِ هر کدام* به ادمین برسد.
 */

const NOW = 1_786_000_000;

// ══════════════════════════════════════════════
// پاسخ‌های ساختگیِ هر منبع
// ══════════════════════════════════════════════

const yahooBody = (base, n, step = 300) => ({
  chart: {
    result: [{
      timestamp: Array.from({ length: n }, (_, i) => base + i * step),
      indicators: {
        quote: [{
          open: Array.from({ length: n }, (_, i) => 4100 + i),
          high: Array.from({ length: n }, (_, i) => 4105 + i),
          low: Array.from({ length: n }, (_, i) => 4095 + i),
          close: Array.from({ length: n }, (_, i) => 4102 + i),
        }],
      },
    }],
  },
});

/** کوین‌بیس ترتیب غیرمعمول دارد: [time, low, high, open, close, volume] */
const coinbaseBody = (base, n, step = 300) =>
  Array.from({ length: n }, (_, i) => [base + i * step, 4095 + i, 4105 + i, 4100 + i, 4102 + i, 1]);

const binanceBody = (base, n, step = 300) =>
  Array.from({ length: n }, (_, i) => [(base + i * step) * 1000, '4100', '4105', '4095', '4102', '1']);

/** fetch جعلی که بر اساس دامنه تصمیم می‌گیرد. */
function fakeNet(handlers) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const [needle, handler] of Object.entries(handlers)) {
      if (url.includes(needle)) return handler(url);
    }
    throw new Error(`میزبان ناشناخته: ${url}`);
  };
  return { fetchImpl, calls };
}

const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const failStatus = (status) => async () => ({ ok: false, status, json: async () => ({}) });
const throwNetwork = (msg) => async () => { throw new Error(msg); };

// ══════════════════════════════════════════════
// پاک‌سازی کندل
// ══════════════════════════════════════════════

test('کندل خراب کنار گذاشته می‌شود ولی بقیه می‌مانند', () => {
  const out = cleanCandles([
    { time: 100, open: 10, high: 12, low: 9, close: 11 },
    { time: 200, open: 10, high: 5, low: 9, close: 11 },     // high < low
    { time: 300, open: 0, high: 12, low: 9, close: 11 },      // قیمت صفر
    { time: NaN, open: 10, high: 12, low: 9, close: 11 },     // زمان نامعتبر
    { time: 400, open: 10, high: 12, low: 9, close: 11 },
  ]);
  assert.deepEqual(out.map((c) => c.time), [100, 400]);
});

test('🔴 کندل بدون زمان (که به صفر تبدیل می‌شود) رد می‌شود', () => {
  // Number(null) برابر صفر است — ردیفِ بی‌زمان نباید کندلِ سال ۱۹۷۰ بشود
  assert.equal(cleanCandles([{ time: 0, open: 1, high: 2, low: 1, close: 1 }]).length, 0);
});

test('خروجی صعودی و بدون تکرار است', () => {
  const c = (t, close) => ({ time: t, open: 1, high: Math.max(2, close), low: 1, close });
  const out = cleanCandles([c(300, 3), c(100, 1), c(100, 9), c(200, 2)]);
  assert.deepEqual(out.map((x) => x.time), [100, 200, 300]);
  assert.equal(out[0].close, 9, 'آخرینِ هر زمان می‌ماند');
});

test('OHLC ناممکن که بدنه بیرون high/low است رد می‌شود', () => {
  assert.equal(cleanCandles([{ time: 100, open: 12, high: 11, low: 9, close: 10 }]).length, 0);
  assert.equal(cleanCandles([{ time: 100, open: 10, high: 12, low: 11, close: 12 }]).length, 0);
});

test('سنجش کیفیت، دیتای پیوسته و دارای سایه را می‌پذیرد', () => {
  const candles = Array.from({ length: 30 }, (_, i) => ({
    time: NOW + i * 60, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i,
  }));
  const quality = assessCandleQuality(candles, 60);
  assert.equal(quality.acceptable, true);
  assert.equal(quality.coverageRatio, 1);
  assert.equal(quality.missingBars, 0);
});

test('سنجش کیفیت، گپ‌های بزرگ و کندل‌های تخت را گزارش می‌کند', () => {
  const candles = Array.from({ length: 24 }, (_, i) => ({
    time: NOW + i * 5 * 60, open: 100, high: 100, low: 100, close: 100,
  }));
  const quality = assessCandleQuality(candles, 60);
  assert.equal(quality.acceptable, false);
  assert.ok(quality.missingBars > 0);
  assert.ok(quality.flatRatio > 0.9);
  assert.ok(quality.reasons.some((reason) => /پیوستگی|فاصله/.test(reason)));
});

// ══════════════════════════════════════════════
// اعتبارسنجی
// ══════════════════════════════════════════════

test('درخواست درست پذیرفته می‌شود', () => {
  const r = validateImportRequest({ interval: '5m', startTime: NOW, endTime: NOW + 30 * 300 });
  assert.equal(r.ok, true);
  assert.equal(r.request.step, 300);
});

test('بازه‌ی ناشناخته رد می‌شود و گزینه‌ها را می‌گوید', () => {
  const r = validateImportRequest({ interval: '3s', startTime: 0, endTime: 100 });
  assert.equal(r.ok, false);
  for (const key of Object.keys(INTERVALS)) assert.ok(r.error.includes(key));
});

test('پایانِ قبل از شروع رد می‌شود', () => {
  assert.equal(validateImportRequest({ interval: '1m', startTime: 500, endTime: 100 }).ok, false);
  assert.equal(validateImportRequest({ interval: '1m', startTime: 100, endTime: 100 }).ok, false);
});

test('🔴 بازه‌ی بیش از حد بزرگ رد می‌شود — با راهنمای عملی', () => {
  const r = validateImportRequest({ interval: '1m', startTime: 0, endTime: 365 * 24 * 3600 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes(String(MAX_DATASET_CANDLES)));
  assert.ok(/تایم‌فریم/.test(r.error), 'باید بگوید چه کار کند، نه فقط اینکه نمی‌شود');
});

// ══════════════════════════════════════════════
// 🔴 کفِ داده — بن‌بستی که روی سرور واقعی پیش آمد
// ══════════════════════════════════════════════

test('🔴 بازه‌ی خیلی کوتاه رد می‌شود، پیش از هر تماس شبکه‌ای', async () => {
  const { fetchImpl, calls } = fakeNet({ 'yahoo': okJson(yahooBody(NOW, 5)) });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 5 * 300, fetchImpl });

  assert.equal(r.ok, false);
  assert.equal(calls.length, 0, 'وقتی بازه ذاتاً کوچک است، شبکه بی‌خود درگیر نمی‌شود');
  assert.ok(r.error.includes(String(MIN_SCENARIO_CANDLES)));
  assert.ok(/بلندتر|کوچک‌تر/.test(r.error), 'باید بگوید چه کار کند');
});

test('🔴 منبعی که داده‌ی کمی بدهد شکست‌خورده است و بعدی امتحان می‌شود', async () => {
  // دقیقاً سناریوی واقعی: کوین‌بیس روی جفت کم‌معامله از سی دقیقه فقط هجده
  // کندل داشت. قبلاً همان هجده‌تا ذخیره می‌شد و بعد هیچ سناریویی از آن ساخته
  // نمی‌شد — نه از فرم می‌شد بیرون آمد، نه معلوم بود چرا.
  const { fetchImpl } = fakeNet({
    'yahoo': okJson({ chart: { result: [] } }),
    'coinbase': okJson(coinbaseBody(NOW, 18, 60)),
    'binance': okJson(binanceBody(NOW, 30, 60)),
  });
  const r = await importHistory({ interval: '1m', startTime: NOW, endTime: NOW + 30 * 60, fetchImpl });

  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /Binance/, 'به منبعی رسید که داده‌ی کافی داشت');
  const thin = r.attempts.find((a) => /Coinbase/.test(a.source));
  assert.match(thin.error, /18/, 'باید بگوید چند کندل داشت');
  assert.ok(thin.error.includes(String(MIN_SCENARIO_CANDLES)), 'و اینکه چند تا لازم بود');
});

test('🔴 منبعی با تعداد کافی اما فاصله‌های خالی رد می‌شود و بعدی امتحان می‌شود', async () => {
  const sparseCoinbase = Array.from({ length: 24 }, (_, i) => [
    NOW + i * 5 * 60, 4095 + i, 4105 + i, 4100 + i, 4102 + i, 1,
  ]);
  const { fetchImpl } = fakeNet({
    'yahoo': okJson({ chart: { result: [] } }),
    'coinbase': okJson(sparseCoinbase),
    'binance': okJson(binanceBody(NOW, 120, 60)),
  });
  const r = await importHistory({ interval: '1m', startTime: NOW, endTime: NOW + 120 * 60, fetchImpl });

  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /Binance/);
  const sparse = r.attempts.find((attempt) => /Coinbase/.test(attempt.source));
  assert.match(sparse.error, /کیفیت/);
  assert.ok(sparse.quality.coverageRatio < 0.5);
});

test('🔴 منبعی که تقریباً همه‌ی کندل‌هایش بدون سایه است برای تمرین پذیرفته نمی‌شود', async () => {
  const bodyOnly = Array.from({ length: 30 }, (_, i) => ({
    time: NOW + i * 60, open: 100 + i, high: 101 + i, low: 100 + i, close: 101 + i,
  }));
  const quality = assessCandleQuality(bodyOnly, 60);
  assert.equal(quality.acceptable, false);
  assert.equal(quality.wicklessRatio, 1);
  assert.ok(quality.reasons.some((reason) => /بدون سایه/.test(reason)));
});

test('🔴 وقتی همه‌ی منابع کم‌داده‌اند، دیتاستِ بی‌مصرف ساخته نمی‌شود', async () => {
  const { fetchImpl } = fakeNet({
    'yahoo': okJson(yahooBody(NOW, 9, 60)),
    'coinbase': okJson(coinbaseBody(NOW, 18, 60)),
    'okx': okJson({ code: '0', data: [] }),
    'kucoin': okJson({ code: '200000', data: [] }),
    'gateio': okJson([]),
    'binance': okJson(binanceBody(NOW, 4, 60)),
  });
  const r = await importHistory({ interval: '1m', startTime: NOW, endTime: NOW + 30 * 60, fetchImpl });

  assert.equal(r.ok, false, 'ذخیره‌ی یک دیتاستِ کوتاه فقط بن‌بست را عقب می‌اندازد');
  assert.equal(r.attempts.length, SOURCES.length);
});

test('دقیقاً به اندازه‌ی کف، قابل قبول است', async () => {
  const { fetchImpl } = fakeNet({ 'yahoo': okJson(yahooBody(NOW, MIN_SCENARIO_CANDLES)) });
  const r = await importHistory({
    interval: '5m', startTime: NOW, endTime: NOW + MIN_SCENARIO_CANDLES * 300, fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(r.dataset.candles.length, MIN_SCENARIO_CANDLES);
});

// ══════════════════════════════════════════════
// 🔴 زنجیره‌ی منابع
// ══════════════════════════════════════════════

test('منبع اول که جواب بدهد، برنده است', async () => {
  const { fetchImpl, calls } = fakeNet({ 'yahoo': okJson(yahooBody(NOW, 24)) });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 24 * 300, fetchImpl });

  assert.equal(r.ok, true);
  assert.equal(r.dataset.candles.length, 24);
  assert.match(r.dataset.source, /Yahoo/);
  assert.equal(calls.length, 1, 'وقتی اولی جواب داد، بقیه امتحان نمی‌شوند');
});

test('🔴 با شکست منبع اول، دومی امتحان می‌شود', async () => {
  const { fetchImpl } = fakeNet({
    'yahoo': failStatus(500),
    'coinbase': okJson(coinbaseBody(NOW, 20)),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 6000, fetchImpl });

  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /Coinbase/);
  assert.equal(r.attempts.length, 1, 'شکست اولی ثبت شده');
  assert.match(r.attempts[0].error, /500/);
});

test('🔴 بایننسِ مسدود (۴۵۱) به منبع بعدی می‌رسد — همان چیزی که روی سرور واقعی افتاد', async () => {
  const { fetchImpl } = fakeNet({
    'yahoo': throwNetwork('getaddrinfo ENOTFOUND'),
    'coinbase': failStatus(451),
    'okx': failStatus(451),
    'kucoin': failStatus(451),
    'gateio': failStatus(451),
    'binance': failStatus(451),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 30 * 300, fetchImpl });

  assert.equal(r.ok, false);
  assert.equal(r.attempts.length, SOURCES.length, 'همه‌ی منابع امتحان شدند');
  assert.ok(/محدودیت جغرافیایی/.test(r.error), 'باید بگوید چرا مسدود است، نه فقط «خطا»');
});

test('🔴 وقتی همه شکست می‌خورند، دلیلِ هر کدام در پیام می‌آید', async () => {
  const { fetchImpl } = fakeNet({
    'yahoo': failStatus(500),
    'coinbase': throwNetwork('connect ETIMEDOUT'),
    'okx': failStatus(503),
    'kucoin': failStatus(503),
    'gateio': failStatus(503),
    'binance': failStatus(451),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 30 * 300, fetchImpl });

  assert.equal(r.ok, false);
  for (const source of SOURCES) {
    assert.ok(r.error.includes(source.label), `${source.label} باید در پیام باشد`);
  }
  assert.equal(r.attempts.length, SOURCES.length);
});

test('🔴 منابعی که این تایم‌فریم را ندارند، رد می‌شوند نه اینکه داده‌ی غلط بدهند', async () => {
  // یاهو و کوین‌بیس چهارساعته ندارند؛ اوکی‌اکس، کوکوین، گیت و بایننس دارند.
  const { fetchImpl, calls } = fakeNet({
    'okx': failStatus(500),
    'kucoin': failStatus(500),
    'gateio': failStatus(500),
    'binance': okJson(binanceBody(NOW, 30, 14400)),
  });
  const r = await importHistory({ interval: '4h', startTime: NOW, endTime: NOW + 30 * 14400, fetchImpl });

  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /Binance/);
  assert.ok(!calls.some((u) => u.includes('yahoo') || u.includes('coinbase')), 'به منابع بدون پشتیبانیِ ۴ساعته اصلاً زنگ نمی‌زند');
  assert.ok(r.attempts.some((a) => /پشتیبانی نمی‌کند/.test(a.error)));
});

test('پاسخِ خالی، منبع بعدی را امتحان می‌کند', async () => {
  const { fetchImpl } = fakeNet({
    'yahoo': okJson({ chart: { result: [] } }),
    'coinbase': okJson(coinbaseBody(NOW, 22)),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 22 * 300, fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /Coinbase/);
});

// ══════════════════════════════════════════════
// شکل هر منبع
// ══════════════════════════════════════════════

test('🔴 ترتیب غیرمعمول ستون‌های کوین‌بیس درست خوانده می‌شود', async () => {
  // [time, low, high, open, close] — نه ترتیب معمول OHLC
  const { fetchImpl } = fakeNet({
    'yahoo': failStatus(500),
    'coinbase': okJson([
      [NOW, 4000, 4200, 4050, 4150, 1],
      ...coinbaseBody(NOW + 300, 24).slice(1),
    ]),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 25 * 300, fetchImpl });
  assert.deepEqual(r.dataset.candles[0], { time: NOW, low: 4000, high: 4200, open: 4050, close: 4150 });
});

test('🔴 ترتیب ستون‌های اوکی‌اکس درست خوانده می‌شود', async () => {
  // OKX نزولی (جدید به قدیم) می‌دهد و ترتیب استانداردِ [ts, o, h, l, c] دارد
  const rows = Array.from({ length: 25 }, (_, i) => [
    String((NOW + (24 - i) * 300) * 1000), '4100', '4110', '4090', '4105', '1', '1', '1', '1',
  ]);
  const { fetchImpl } = fakeNet({
    'yahoo': failStatus(500), 'coinbase': failStatus(500),
    'okx': okJson({ code: '0', data: rows }),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 25 * 300, fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /OKX/);
  assert.deepEqual(r.dataset.candles[0], { time: NOW, open: 4100, high: 4110, low: 4090, close: 4105 });
});

test('🔴 کدِ خطای اوکی‌اکس (با HTTP ۲۰۰) شکستِ همان منبع حساب می‌شود', async () => {
  const { fetchImpl } = fakeNet({
    'yahoo': failStatus(500), 'coinbase': failStatus(500),
    'okx': okJson({ code: '51001', msg: 'Instrument ID does not exist.', data: [] }),
    'kucoin': failStatus(500),
    'gateio': okJson(Array.from({ length: 25 }, (_, i) => [
      String(NOW + i * 300), '1', '4105', '4110', '4090', '4100', '1', 'true',
    ])),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 25 * 300, fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /Gate/);
  const okxAttempt = r.attempts.find((a) => /OKX/.test(a.source));
  assert.match(okxAttempt.error, /Instrument ID/);
});

test('🔴 ترتیبِ ستون‌های کوکوین (باز، بسته، سقف، کف) درست خوانده می‌شود', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => [
    String(NOW + (24 - i) * 300), '4100', '4105', '4110', '4090', '1', '1',
  ]);
  const { fetchImpl } = fakeNet({
    'yahoo': failStatus(500), 'coinbase': failStatus(500), 'okx': failStatus(500),
    'kucoin': okJson({ code: '200000', data: rows }),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 25 * 300, fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /KuCoin/);
  assert.deepEqual(r.dataset.candles[0], { time: NOW, open: 4100, close: 4105, high: 4110, low: 4090 });
});

test('🔴 ترتیبِ ستون‌های گیت‌آی‌او (حجم، بسته، سقف، کف، باز) درست خوانده می‌شود', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => [
    String(NOW + i * 300), '10', '4105', '4110', '4090', '4100', '1', 'true',
  ]);
  const { fetchImpl } = fakeNet({
    'yahoo': failStatus(500), 'coinbase': failStatus(500), 'okx': failStatus(500), 'kucoin': failStatus(500),
    'gateio': okJson(rows),
  });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 25 * 300, fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.dataset.source, /Gate/);
  assert.deepEqual(r.dataset.candles[0], { time: NOW, close: 4105, high: 4110, low: 4090, open: 4100 });
});

test('زمانِ میلی‌ثانیه‌ای بایننس به ثانیه تبدیل می‌شود', async () => {
  const { fetchImpl } = fakeNet({ 'binance': okJson(binanceBody(NOW, 25, 14400)) });
  const r = await importHistory({ interval: '4h', startTime: NOW, endTime: NOW + 25 * 14400, fetchImpl });
  assert.equal(r.dataset.candles[0].time, NOW, 'نه NOW × ۱۰۰۰');
});

test('کوین‌بیس بازه‌ی بلند را چند تکه می‌گیرد', async () => {
  let page = 0;
  const { fetchImpl, calls } = fakeNet({
    'yahoo': failStatus(500),
    'coinbase': async () => ({ ok: true, status: 200, json: async () => coinbaseBody(NOW + (page++) * 300 * 300, 300) }),
  });
  await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 900 * 300, fetchImpl });
  assert.ok(calls.filter((u) => u.includes('coinbase')).length >= 3, 'باید چند تکه بگیرد');
});

test('خروجی، فراداده‌ی درست دارد', async () => {
  const { fetchImpl } = fakeNet({ 'yahoo': okJson(yahooBody(NOW, 40)) });
  const r = await importHistory({ interval: '5m', startTime: NOW, endTime: NOW + 12000, fetchImpl });
  assert.equal(r.dataset.timeframe, 5);
  assert.equal(r.dataset.startTime, NOW);
  assert.equal(r.dataset.endTime, NOW + 39 * 300);
  assert.match(r.dataset.source, /5m/, 'منبع و بازه باید در داده بماند تا هیچ‌وقت وانمود نشود مظنه است');
});

test('درخواست نامعتبر اصلاً به شبکه نمی‌رود', async () => {
  const { fetchImpl, calls } = fakeNet({});
  const r = await importHistory({ interval: 'نامعتبر', startTime: 0, endTime: 60, fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

// ══════════════════════════════════════════════
// 🔴 ابزار تشخیص
// ══════════════════════════════════════════════

test('🔴 آزمایش منابع می‌گوید کدام کار می‌کند و کدام نه', async () => {
  const { fetchImpl } = fakeNet({
    'yahoo': okJson(yahooBody(NOW, 12)),
    'coinbase': failStatus(451),
    'binance': throwNetwork('ENOTFOUND'),
  });
  const results = await probeSources(fetchImpl);

  assert.equal(results.length, SOURCES.length);
  const yahoo = results.find((r) => r.id === 'yahoo');
  assert.equal(yahoo.ok, true);
  assert.ok(yahoo.sample > 0);

  const cb = results.find((r) => r.id === 'coinbase');
  assert.equal(cb.ok, false);
  assert.match(cb.reason, /جغرافیایی/, 'باید علت را بگوید، نه فقط اینکه شکست خورد');

  assert.equal(results.find((r) => r.id === 'binance').ok, false);
});

test('آزمایش، شکست یک منبع را به بقیه سرایت نمی‌دهد', async () => {
  const { fetchImpl } = fakeNet({ 'coinbase': okJson(coinbaseBody(NOW, 12)) });
  const results = await probeSources(fetchImpl);
  assert.equal(results.find((r) => r.id === 'coinbase').ok, true);
  assert.equal(results.filter((r) => !r.ok).length, SOURCES.length - 1);
});
