import test from 'node:test';
import assert from 'node:assert/strict';

import { MarketEngine } from '../server/services/marketEngine.js';

const GRAM_SCALE_PRICE = 4_250_000;   // INITIAL_GRAM_PRICE — مقیاس قدیمی
const MAZNE_SCALE_PRICE = 79_600_000; // مقیاس واقعی فعلی، تقریباً ۱۹ برابر بزرگ‌تر

/** موتوری که قیمت واقعی گرفته و آماده‌ی ساخت کندل است. */
function activeEngine(price = MAZNE_SCALE_PRICE) {
  const engine = new MarketEngine(price);
  engine.activate(price);
  return engine;
}

/** یک کندل را مجبور به بسته‌شدن می‌کند، بدون نیاز به صبر واقعی برای CANDLE_INTERVAL_MS. */
function forceCandleClose(engine) {
  engine.activeCandleStartTime = 0;
  return engine.tick();
}

// ══════════════════════════════════════════════
// رگرسیون: دیگر هیچ تاریخچه‌ی ساختگی وجود ندارد
// ══════════════════════════════════════════════

test('در لحظه‌ی ساخت، candles خالی است — دیگر ۱۰۰ کندل جعلی ساخته نمی‌شود', () => {
  const engine = new MarketEngine(MAZNE_SCALE_PRICE);
  assert.deepEqual(engine.candles, []);
});

// ══════════════════════════════════════════════
// رگرسیون: شمعِ غول‌پیکرِ ساختگی در لحظه‌ی بالا آمدن سرور
//
// موتور با قیمت seed ساخته می‌شود (مقدار موقتِ نوشته‌شده در priceService) و چند
// ثانیه بعد قیمت واقعی می‌رسد. پیش‌تر بلافاصله یک کندل روی قیمت seed باز می‌شد و
// تا قیمت واقعی کشیده می‌شد — یک حرکت ۵ تا ۶ درصدی که هرگز در بازار رخ نداده بود.
// ══════════════════════════════════════════════

const SEED_PRICE = 79_629_107;  // مقدار موقت: 4121 × 185000 ÷ 9.5742
const REAL_PRICE = 84_235_904;  // قیمت واقعی همان روز

test('پیش از رسیدن قیمت واقعی، هیچ کندلی باز نمی‌شود', () => {
  const engine = new MarketEngine(SEED_PRICE);
  assert.equal(engine.activeCandle, null, 'کندل نباید روی قیمت seed باز شود');
  assert.equal(engine.isActive, false);
});

test('تیک زدن روی قیمت seed هیچ کندلی نمی‌سازد', () => {
  const engine = new MarketEngine(SEED_PRICE);
  for (let i = 0; i < 20; i++) forceCandleClose(engine);
  assert.deepEqual(engine.candles, [], 'قیمت seed هرگز نباید وارد تاریخچه شود');
  assert.equal(engine.activeCandle, null);
});

test('اولین کندل از قیمت *واقعی* باز می‌شود، نه از فاصله‌ی seed تا واقعی', () => {
  const engine = new MarketEngine(SEED_PRICE);
  engine.activate(REAL_PRICE);
  forceCandleClose(engine);

  const first = engine.candles[0];
  assert.equal(first.open, REAL_PRICE);
  assert.equal(first.low, REAL_PRICE, 'کف کندل نباید تا قیمت seed پایین برود');
  const span = (first.high - first.low) / first.low;
  assert.ok(span < 0.001, `اولین کندل باید تقریباً بدون دامنه باشد، نه یک شمع ${(span * 100).toFixed(1)} درصدی`);
});

test('activate مرجع درصد تغییر را روی قیمت واقعی می‌گذارد، نه seed', () => {
  const engine = new MarketEngine(SEED_PRICE);
  engine.activate(REAL_PRICE);
  const { tick } = engine.tick();
  assert.equal(tick.change24h, 0, 'درصد تغییر نباید جهش seed→واقعی را نشان دهد');
  assert.equal(tick.high24h, REAL_PRICE);
  assert.equal(tick.low24h, REAL_PRICE);
});

test('activate دوباره بی‌اثر است (قیمت شروع جابه‌جا نمی‌شود)', () => {
  const engine = new MarketEngine(SEED_PRICE);
  engine.activate(REAL_PRICE);
  engine.activate(REAL_PRICE * 2);
  assert.equal(engine.sessionOpenPrice, REAL_PRICE);
});

test('فعال‌سازی در زمان تعطیلی بازار کندل تخت نمی‌سازد', () => {
  const engine = new MarketEngine(SEED_PRICE);
  engine.activate(REAL_PRICE, false);
  for (let i = 0; i < 5; i++) engine.tick({ marketOpen: false, marketStatus: 'WEEKEND' });
  assert.equal(engine.activeCandle, null);
  assert.deepEqual(engine.candles, []);
  assert.equal(engine.currentTick.marketOpen, false);
});

test('بسته‌شدن بازار کندل نیمه‌تمام را یک‌بار نهایی می‌کند و بعد کندل تازه نمی‌سازد', () => {
  const engine = activeEngine();
  const first = engine.tick({ marketOpen: false, marketStatus: 'WEEKEND' });
  assert.equal(first.newCandle, true);
  assert.equal(engine.candles.length, 1);
  const second = engine.tick({ marketOpen: false, marketStatus: 'WEEKEND' });
  assert.equal(second.newCandle, false);
  assert.equal(second.candleUpdate, null);
  assert.equal(engine.candles.length, 1);
});

test('بازشدن دوباره بازار یک کندل تازه از قیمت جاری می‌سازد', () => {
  const engine = new MarketEngine(SEED_PRICE);
  engine.activate(REAL_PRICE, false);
  const result = engine.tick({ marketOpen: true, marketStatus: 'OPEN' });
  assert.ok(engine.activeCandle);
  assert.equal(engine.activeCandle.open, REAL_PRICE);
  assert.equal(result.candleUpdate.open, REAL_PRICE);
  assert.equal(result.tick.marketOpen, true);
});

test('تغییر واقعی قیمت در تعطیلی ثبت می‌شود ولی قیمت ثابت کندل تکراری نمی‌سازد', () => {
  const engine = activeEngine();
  engine.tick({ marketOpen: false, marketStatus: 'WEEKEND' });
  const closedCount = engine.candles.length;

  engine.currentTick.price += 10_000;
  const moved = engine.tick({ marketOpen: false, marketStatus: 'WEEKEND' });
  assert.ok(moved.candleUpdate, 'تغییر واقعی نرخ باید روی چارت دیده شود');
  assert.equal(moved.candleUpdate.close, MAZNE_SCALE_PRICE + 10_000);

  const unchanged = engine.tick({ marketOpen: false, marketStatus: 'WEEKEND' });
  assert.equal(unchanged.candleUpdate, null, 'قیمت ثابت نباید پیام یا کندل تکراری بسازد');
  assert.equal(engine.candles.length, closedCount, 'کندل تعطیلی تا بازشدن بازار یک‌جا تجمیع می‌شود');

  const reopened = engine.tick({ marketOpen: true, marketStatus: 'OPEN' });
  assert.equal(reopened.newCandle, true, 'کندل تجمیعی تعطیلی هنگام بازشدن نهایی می‌شود');
  assert.equal(engine.candles.at(-1).close, MAZNE_SCALE_PRICE + 10_000);
});

// ══════════════════════════════════════════════
// بارگذاری تاریخچه از دیتابیس
// ══════════════════════════════════════════════

test('loadHistory تاریخچه‌ی ذخیره‌شده را برمی‌گرداند', () => {
  const engine = new MarketEngine(MAZNE_SCALE_PRICE);
  const saved = [
    { time: 100, open: 1, high: 2, low: 1, close: 2 },
    { time: 110, open: 2, high: 3, low: 2, close: 3 },
  ];
  engine.loadHistory(saved);
  assert.equal(engine.candles.length, 2);
  assert.equal(engine.getSnapshot().candles[1].close, 3);
});

test('loadHistory با ورودی خالی یا نامعتبر چیزی را خراب نمی‌کند', () => {
  const engine = new MarketEngine(MAZNE_SCALE_PRICE);
  engine.loadHistory([]);
  engine.loadHistory(null);
  engine.loadHistory(undefined);
  assert.deepEqual(engine.candles, []);
});

test('کندل‌های بعدی روی تاریخچه‌ی بارگذاری‌شده اضافه می‌شوند، جایگزینش نمی‌شوند', () => {
  const engine = new MarketEngine(MAZNE_SCALE_PRICE);
  engine.loadHistory([{ time: 100, open: 1, high: 2, low: 1, close: 2 }]);
  engine.activate(MAZNE_SCALE_PRICE);
  forceCandleClose(engine);
  assert.equal(engine.candles.length, 2, 'تاریخچه‌ی قبلی باید حفظ شود');
  assert.equal(engine.candles[0].time, 100);
});

test('کندلی که واقعاً بسته می‌شود، در همان مرتبه‌ی بزرگیِ initialPrice است', () => {
  const engine = activeEngine();
  forceCandleClose(engine);

  assert.equal(engine.candles.length, 1, 'یک کندل باید بسته و به تاریخچه اضافه شده باشد');
  const ratio = engine.candles[0].close / MAZNE_SCALE_PRICE;
  assert.ok(
    ratio > 0.9 && ratio < 1.1,
    `کندل با قیمت ${engine.candles[0].close} خیلی از initialPrice=${MAZNE_SCALE_PRICE} دور است (نسبت ${ratio.toFixed(3)})`
  );
});

test('بدون تغییر قیمت اوراکل، کندلِ بسته‌شده دقیقاً برابر initialPrice است (دیگر نویز تصادفی اضافه نمی‌شود)', () => {
  const engine = activeEngine();
  forceCandleClose(engine);
  assert.equal(engine.candles[0].close, MAZNE_SCALE_PRICE);
  assert.equal(engine.candles[0].open, MAZNE_SCALE_PRICE);
  assert.equal(engine.candles[0].high, MAZNE_SCALE_PRICE);
  assert.equal(engine.candles[0].low, MAZNE_SCALE_PRICE);
});

test('با initialPrice پیش‌فرض (مقیاس گرم)، مقیاس همان مقیاس قدیمی می‌ماند', () => {
  const engine = new MarketEngine();
  engine.activate(GRAM_SCALE_PRICE);
  assert.equal(engine.scale, 1);
  assert.equal(engine.activeCandle.open, GRAM_SCALE_PRICE);
});

test('ضریب scale متناسب با initialPrice محاسبه می‌شود', () => {
  const engine = new MarketEngine(MAZNE_SCALE_PRICE);
  assert.ok(Math.abs(engine.scale - MAZNE_SCALE_PRICE / GRAM_SCALE_PRICE) < 1e-9);
});

// ══════════════════════════════════════════════
// دفتر سفارشات: فاصله‌ی خرید/فروش باید با مقیاس قیمت متناسب باشد
// ══════════════════════════════════════════════

test('اسپرد دفتر سفارشات با مقیاس قیمت بزرگ می‌شود، نه ثابت می‌ماند', () => {
  const smallScale = new MarketEngine(GRAM_SCALE_PRICE);
  const largeScale = new MarketEngine(MAZNE_SCALE_PRICE);

  const spreadOf = (engine) => engine.orderBook.asks[0].price - engine.orderBook.bids[0].price;

  const smallSpread = spreadOf(smallScale);
  const largeSpread = spreadOf(largeScale);

  // نسبت اسپرد به قیمت باید تقریباً یکسان بماند (نه اینکه اسپرد مطلق ثابت بماند)
  const smallRatio = smallSpread / GRAM_SCALE_PRICE;
  const largeRatio = largeSpread / MAZNE_SCALE_PRICE;
  assert.ok(Math.abs(smallRatio - largeRatio) / smallRatio < 0.5, `نسبت اسپرد باید تقریباً هم‌مقیاس بماند: ${smallRatio} در برابر ${largeRatio}`);
});

test('همه‌ی سفارش‌های خرید ارزان‌تر و همه‌ی سفارش‌های فروش گران‌تر از قیمت جاری‌اند', () => {
  const engine = new MarketEngine(MAZNE_SCALE_PRICE);
  for (const bid of engine.orderBook.bids) assert.ok(bid.price < engine.currentTick.price);
  for (const ask of engine.orderBook.asks) assert.ok(ask.price > engine.currentTick.price);
});

// ══════════════════════════════════════════════
// رگرسیون: tick() دیگر نویز تصادفی روی قیمت واقعی اضافه نمی‌کند
// ══════════════════════════════════════════════

test('بدون تغییر قیمت اوراکل، تیک قیمت را دقیقاً دست‌نخورده نگه می‌دارد', () => {
  const engine = activeEngine();
  const before = engine.currentTick.price;
  const { tick } = engine.tick();
  assert.equal(tick.price, before, 'قبلاً اینجا یک نویز تصادفی اضافه می‌شد که کندل‌ها را بدون حرکت واقعی قیمت جابه‌جا می‌کرد');
});

test('چند تیک پشت‌سرهم بدون تغییر اوراکل، قیمت را عوض نمی‌کند', () => {
  const engine = activeEngine();
  for (let i = 0; i < 10; i++) engine.tick();
  assert.equal(engine.currentTick.price, MAZNE_SCALE_PRICE);
});

test('موتور بازار فیلدهای اوراکل را بازنویسی نمی‌کند', () => {
  // 🐛 پیش‌تر maznePrice با price پر می‌شد. از وقتی واحد معامله «گرم» شد،
  // price قیمتِ گرم است و مظنه حدود پنج برابر آن — پس این بازنویسی باعث می‌شد
  // هدر برای «مظنه» و «هر گرم» عددِ یکسانی نشان بدهد.
  const engine = activeEngine();
  engine.currentTick.maznePrice = 84_702_000;
  engine.currentTick.globalGoldSpot = 4_378.81;
  engine.currentTick.usdIrtPrice = 185_200;

  const { tick } = engine.tick();
  assert.equal(tick.maznePrice, 84_702_000, 'مظنه باید دست‌نخورده بماند');
  assert.equal(tick.globalGoldSpot, 4_378.81);
  assert.equal(tick.usdIrtPrice, 185_200);
  assert.notEqual(tick.maznePrice, tick.price, 'مظنه و قیمت گرم دو عدد متفاوت‌اند');
});

test('بعد از چند تیک بدون بسته‌شدن کندل، candles هنوز خالی است ولی activeCandle آپدیت شده', () => {
  const engine = activeEngine();
  engine.tick();
  engine.tick();
  engine.tick();
  assert.deepEqual(engine.candles, [], 'کندل هنوز نباید بسته شده باشد (به CANDLE_INTERVAL_MS نرسیده)');
  assert.ok(engine.activeCandle);
});

test('getSnapshot ساختار کامل را برمی‌گرداند', () => {
  const engine = new MarketEngine(MAZNE_SCALE_PRICE);
  const snapshot = engine.getSnapshot();
  assert.ok(snapshot.tick);
  assert.ok(snapshot.orderBook.bids.length > 0);
  assert.deepEqual(snapshot.candles, []);
});
