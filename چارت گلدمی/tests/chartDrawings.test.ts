import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeIndex, timeToLogical, logicalToTime } from '../src/chart/timeIndex.ts';
import { distanceToSegment, distanceToShape } from '../src/chart/geometry.ts';

/**
 * لنگر زمانیِ رسم‌های چارت.
 *
 * چیزی که این تست‌ها نگه می‌دارند: رسم کاربر باید بعد از رفرش صفحه، بعد از آمدن
 * کندل تازه، و بعد از عوض شدن تایم‌فریم دقیقاً سرِ جای خودش بماند.
 *
 * 🐛 پیش‌تر نقاط با شماره‌ی کندل ذخیره می‌شدند. چون آرایه‌ی کندل مدام عوض می‌شود
 * (کندل تازه از راست اضافه می‌شود، قدیمی از چپ هرس می‌شود)، همان شماره بعد از
 * مدتی به کندل دیگری اشاره می‌کرد و تحلیل کاربر جابه‌جا می‌شد.
 */

const MINUTE = 60;

/** n کندلِ یک‌دقیقه‌ای از زمان start. */
const series = (start: number, n: number, step = MINUTE) =>
  Array.from({ length: n }, (_, i) => start + i * step);

// ══════════════════════════════════════════════
// تبدیل پایه
// ══════════════════════════════════════════════

test('زمانِ دقیقِ یک کندل، شماره‌ی همان کندل را می‌دهد', () => {
  const idx = buildTimeIndex(series(1000, 5), MINUTE);
  assert.equal(timeToLogical(1000, idx), 0);
  assert.equal(timeToLogical(1000 + 3 * MINUTE, idx), 3);
});

test('زمانِ وسطِ دو کندل، شماره‌ی اعشاری می‌دهد', () => {
  const idx = buildTimeIndex(series(1000, 5), MINUTE);
  assert.equal(timeToLogical(1000 + MINUTE / 2, idx), 0.5);
});

test('تبدیل رفت و برگشت، همان زمان را برمی‌گرداند', () => {
  const idx = buildTimeIndex(series(1000, 50), MINUTE);
  for (const t of [1000, 1000 + 7 * MINUTE, 1000 + 49 * MINUTE]) {
    assert.equal(logicalToTime(timeToLogical(t, idx), idx), t);
  }
});

// ══════════════════════════════════════════════
// 🔴 بیرون از بازه — جایی که تحلیل به آینده امتداد دارد
// ══════════════════════════════════════════════

test('🔴 زمانِ جلوتر از آخرین کندل، برون‌یابی می‌شود نه اینکه به لبه بچسبد', () => {
  const idx = buildTimeIndex(series(1000, 10), MINUTE);
  const last = 1000 + 9 * MINUTE;
  // پنج کندل جلوتر از آخرین کندل — فضای خالیِ سمت راست چارت
  assert.equal(timeToLogical(last + 5 * MINUTE, idx), 14);
  assert.equal(logicalToTime(14, idx), last + 5 * MINUTE);
});

test('زمانِ عقب‌تر از اولین کندل، شماره‌ی منفی می‌دهد', () => {
  const idx = buildTimeIndex(series(1000, 10), MINUTE);
  assert.equal(timeToLogical(1000 - 2 * MINUTE, idx), -2);
});

// ══════════════════════════════════════════════
// 🔴 همان چیزی که کاربر گزارش کرد
// ══════════════════════════════════════════════

test('🔴 با آمدن کندل تازه، رسم سرِ جای خودش می‌ماند', () => {
  const before = buildTimeIndex(series(1000, 100), MINUTE);
  // کاربر روی کندل شماره‌ی ۸۰ خط کشیده
  const drawnAt = logicalToTime(80, before);

  // سه کندل تازه آمده و سه کندل قدیمی هرس شده — آرایه جابه‌جا شده
  const after = buildTimeIndex(series(1000 + 3 * MINUTE, 100), MINUTE);

  // شماره عوض می‌شود (۸۰ → ۷۷) ولی زمان همان است، پس خط جابه‌جا نمی‌شود
  assert.equal(timeToLogical(drawnAt, after), 77);
  assert.equal(logicalToTime(77, after), drawnAt, 'زمانِ نقطه نباید تغییر کند');
});

test('🔴 با عوض شدن تایم‌فریم، رسم روی همان لحظه‌ی بازار می‌ماند', () => {
  const oneMin = buildTimeIndex(series(0, 60), MINUTE);
  // کاربر روی دقیقه‌ی ۴۵ خط کشیده
  const drawnAt = logicalToTime(45, oneMin);
  assert.equal(drawnAt, 45 * MINUTE);

  // همان بازه در تایم‌فریم پانزده‌دقیقه‌ای
  const fifteen = buildTimeIndex(series(0, 4, 15 * MINUTE), 15 * MINUTE);
  // دقیقه‌ی ۴۵ = ابتدای کندل چهارم پانزده‌دقیقه‌ای (اندیس ۳)
  assert.equal(timeToLogical(drawnAt, fifteen), 3);
});

// ══════════════════════════════════════════════
// حالت‌های مرزی
// ══════════════════════════════════════════════

test('چارت خالی چیزی را نمی‌شکند', () => {
  const idx = buildTimeIndex([], MINUTE);
  assert.equal(timeToLogical(12345, idx), 0);
  assert.equal(logicalToTime(7, idx), 0);
});

test('با یک کندل، گام از مقدار پشتیبان خوانده می‌شود', () => {
  const idx = buildTimeIndex([1000], 30);
  assert.equal(idx.step, 30);
  assert.equal(timeToLogical(1030, idx), 1);
});

test('گام از داده خوانده می‌شود نه از تایم‌فریمِ اعلام‌شده', () => {
  // ادعا یک دقیقه است ولی داده پنج‌دقیقه‌ای است
  const idx = buildTimeIndex(series(0, 5, 5 * MINUTE), MINUTE);
  assert.equal(idx.step, 5 * MINUTE, 'میانه‌ی فاصله‌ها مبناست');
});

test('🔴 یک شکاف بزرگ در داده، گام را خراب نمی‌کند', () => {
  // نوزده کندل یک‌دقیقه‌ای، بعد یک شکاف سه‌روزه (ری‌استارت سرور یا تعطیلی بازار)
  const times = series(0, 20);
  times.push(times[times.length - 1] + 3 * 24 * 3600);
  const idx = buildTimeIndex(times, MINUTE);

  assert.equal(idx.step, MINUTE, 'میانه باید یک دقیقه بماند، نه سه روز');

  // و در نتیجه، خطی که به آینده امتداد دارد زمان معقولی می‌گیرد
  const last = times[times.length - 1];
  const tenAhead = logicalToTime(times.length - 1 + 10, idx);
  assert.equal(tenAhead - last, 10 * MINUTE, 'ده کندل جلوتر = ده دقیقه جلوتر');
});

test('چند شکاف هم میانه را جابه‌جا نمی‌کنند', () => {
  const times = [0];
  for (let i = 1; i <= 30; i++) {
    // هر ده کندل یک شکاف بزرگ
    times.push(times[times.length - 1] + (i % 10 === 0 ? 5000 : MINUTE));
  }
  assert.equal(buildTimeIndex(times, MINUTE).step, MINUTE);
});

test('کندل‌های جاافتاده، ترتیب را به‌هم نمی‌ریزند', () => {
  // بین ۲ و ۳ یک شکاف ده‌دقیقه‌ای هست
  const idx = buildTimeIndex([0, 60, 120, 720, 780], MINUTE);
  assert.equal(timeToLogical(0, idx), 0);
  assert.equal(timeToLogical(120, idx), 2);
  assert.equal(timeToLogical(720, idx), 3);
  // وسطِ شکاف، بین اندیس ۲ و ۳ می‌افتد
  const mid = timeToLogical(420, idx);
  assert.ok(mid > 2 && mid < 3, `انتظار بین ۲ و ۳، دریافت ${mid}`);
});

// ══════════════════════════════════════════════
// هندسه‌ی گرفتنِ رسم
// ══════════════════════════════════════════════

test('فاصله تا پاره‌خط، نه تا امتدادش', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(distanceToSegment(5, 3, a, b), 3, 'عمود بر وسط خط');
  assert.equal(distanceToSegment(20, 0, a, b), 10, 'بیرون از پاره‌خط، تا سرِ نزدیک‌تر');
});

test('🔴 خط روند از هر جای طولش قابل گرفتن است', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  // روی خط، در سه جای مختلف
  for (const [x, y] of [[10, 10], [50, 50], [90, 90]]) {
    assert.ok(distanceToShape(x, y, 'trend', pts) < 1, `نقطه (${x},${y}) باید روی خط باشد`);
  }
  // دور از خط
  assert.ok(distanceToShape(50, 90, 'trend', pts) > 20);
});

test('خط افقی از هر نقطه‌ای در عرض صفحه قابل گرفتن است', () => {
  const pts = [{ x: 40, y: 200 }];
  assert.equal(distanceToShape(5, 200, 'hline', pts), 0, 'سمت چپِ نقطه‌ی اصلی');
  assert.equal(distanceToShape(900, 203, 'hline', pts), 3, 'خیلی دورتر، فقط اختلاف عمودی مهم است');
});

test('ناحیه از مرزش گرفته می‌شود نه از وسطش', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  assert.equal(distanceToShape(50, 0, 'rect', pts), 0, 'روی لبه‌ی بالا');
  assert.ok(distanceToShape(50, 50, 'rect', pts) > 20, 'وسطِ ناحیه نباید بگیرد');
});

test('🔴 داده‌ی خراب، گام را به عددی نجومی نمی‌برد', () => {
  // دقیقاً وضعیتی که در دیتابیس تست پیش آمد: دو کندل با چند سال فاصله
  const idx = buildTimeIndex([1786430969, 1900000000], MINUTE);
  assert.equal(idx.step, MINUTE, 'به گامِ اعلام‌شده‌ی تایم‌فریم برمی‌گردد');

  // و در نتیجه خطی که به آینده کشیده شود، زمان معقولی می‌گیرد
  const t = logicalToTime(1 + 20, idx);
  assert.ok(t - 1900000000 === 20 * MINUTE, 'بیست کندل جلوتر = بیست دقیقه');
});

test('گامِ بزرگ‌ترِ ولی معقول پذیرفته می‌شود', () => {
  // تایم‌فریم پانزده‌دقیقه‌ای که یک‌دقیقه‌ای اعلام شده — هنوز در محدوده‌ی منطقی است
  const idx = buildTimeIndex(series(0, 10, 15 * MINUTE), MINUTE);
  assert.equal(idx.step, 15 * MINUTE);
});
