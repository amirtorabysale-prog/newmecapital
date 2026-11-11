import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * منطق تجمیع کندل — بازسازی‌شده از src/candles.ts.
 * (فایل منبع TypeScript است و اجراکننده‌ی تست نود آن را مستقیم نمی‌خواند.)
 */
function aggregateCandles(base, minutes) {
  if (minutes <= 1) return base;
  if (base.length === 0) return [];
  const bucketSeconds = minutes * 60;
  const out = [];
  let current = null;
  let currentBucket = -1;
  for (const c of base) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    if (bucket !== currentBucket) {
      if (current) out.push(current);
      currentBucket = bucket;
      current = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
      continue;
    }
    current.high = Math.max(current.high, c.high);
    current.low = Math.min(current.low, c.low);
    current.close = c.close;
  }
  if (current) out.push(current);
  return out;
}

const MIN = 60;
/** کندل یک‌دقیقه‌ای در دقیقه‌ی n ام از مبدأ. */
const c = (n, o, h, l, cl) => ({ time: n * MIN, open: o, high: h, low: l, close: cl });

test('تایم‌فریم یک دقیقه همان ورودی را دست‌نخورده برمی‌گرداند', () => {
  const base = [c(0, 1, 2, 0, 1), c(1, 1, 3, 1, 2)];
  assert.equal(aggregateCandles(base, 1), base);
});

test('ورودی خالی خروجی خالی می‌دهد', () => {
  assert.deepEqual(aggregateCandles([], 15), []);
});

test('open از اولین و close از آخرین کندلِ بازه می‌آید', () => {
  const base = [
    c(0, 100, 110, 95, 105),
    c(1, 105, 120, 104, 118),
    c(2, 118, 119, 90, 92),
  ];
  const [agg] = aggregateCandles(base, 15);
  assert.equal(agg.open, 100, 'open باید از اولین کندل باشد');
  assert.equal(agg.close, 92, 'close باید از آخرین کندل باشد');
});

test('high بیشترین و low کمترین کل بازه است', () => {
  const base = [
    c(0, 100, 110, 95, 105),
    c(1, 105, 130, 104, 118),
    c(2, 118, 119, 80, 92),
  ];
  const [agg] = aggregateCandles(base, 15);
  assert.equal(agg.high, 130);
  assert.equal(agg.low, 80);
});

test('مرزها روی زمان مطلق تراز می‌شوند، نه از اولین کندل موجود', () => {
  // شروع از دقیقه‌ی ۷ — سطل ۱۵ دقیقه‌ای باید همچنان از دقیقه‌ی ۰ باشد
  const base = [c(7, 1, 1, 1, 1), c(8, 2, 2, 2, 2), c(14, 3, 3, 3, 3), c(15, 4, 4, 4, 4)];
  const agg = aggregateCandles(base, 15);
  assert.equal(agg.length, 2, 'دقیقه‌های ۷ تا ۱۴ یک سطل، دقیقه‌ی ۱۵ سطل بعدی');
  assert.equal(agg[0].time, 0, 'سطل اول باید از زمان ۰ شروع شود، نه از ۷');
  assert.equal(agg[1].time, 15 * MIN);
});

test('همان داده همیشه همان شکل را می‌دهد (پایدار در برابر رفرش)', () => {
  const base = Array.from({ length: 40 }, (_, i) => c(i, i, i + 2, i - 1, i + 1));
  const a = aggregateCandles(base, 15);
  const b = aggregateCandles(base.slice(), 15);
  assert.deepEqual(a, b);
});

test('چهل کندل یک‌دقیقه‌ای به سه کندل ۱۵ دقیقه‌ای تبدیل می‌شود', () => {
  const base = Array.from({ length: 40 }, (_, i) => c(i, 10, 12, 8, 11));
  assert.equal(aggregateCandles(base, 15).length, 3); // 0-14, 15-29, 30-39
});

test('کندل نیم‌ساعته دو برابر کندل ۱۵ دقیقه‌ای را در خود جای می‌دهد', () => {
  const base = Array.from({ length: 60 }, (_, i) => c(i, 10, 12, 8, 11));
  assert.equal(aggregateCandles(base, 15).length, 4);
  assert.equal(aggregateCandles(base, 30).length, 2);
});

test('تایم‌فریم یک‌ساعته از ۱۲۰ دقیقه دو کندل می‌سازد', () => {
  const base = Array.from({ length: 120 }, (_, i) => c(i, 10, 12, 8, 11));
  assert.equal(aggregateCandles(base, 60).length, 2);
});

test('تایم‌فریم چهارساعته OHLC کل ۲۴۰ دقیقه را درست نگه می‌دارد', () => {
  const base = Array.from({ length: 240 }, (_, i) => c(i, 100 + i, 110 + i, 90 - i, 105 + i));
  const [bar] = aggregateCandles(base, 240);
  assert.equal(bar.open, 100);
  assert.equal(bar.close, 344);
  assert.equal(bar.high, 349);
  assert.equal(bar.low, -149);
});

test('شکاف در داده (خاموشی سرور) سطل خالی نمی‌سازد', () => {
  // بین دقیقه‌ی ۲ و دقیقه‌ی ۱۰۰ هیچ داده‌ای نیست
  const base = [c(0, 1, 1, 1, 1), c(2, 2, 2, 2, 2), c(100, 3, 3, 3, 3)];
  const agg = aggregateCandles(base, 15);
  assert.equal(agg.length, 2, 'فقط سطل‌هایی که واقعاً داده دارند ساخته می‌شوند');
});
