import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDrawing, validateBatch, toClient, POINTS_NEEDED, MAX_PER_USER,
} from '../server/services/drawingStore.js';

/**
 * اعتبارسنجی رسم‌های چارت.
 *
 * ⚠️ همه‌ی این داده از مرورگر می‌آید و مستقیم در دیتابیس می‌نشیند، بعد به همه‌ی
 * دستگاه‌های همان کاربر برمی‌گردد. این تست‌ها دو چیز را نگه می‌دارند: داده‌ی خراب
 * وارد دیتابیس نشود، و کسی نتواند با یک درخواست حجم دلخواه بنویسد.
 */

const NOW = 1786430969; // ۲۰۲۶
const point = (t = NOW, price = 17_000_000) => ({ time: t, price });
const trend = (id = 'd1') => ({ id, kind: 'trend', points: [point(), point(NOW + 600)] });

// ══════════════════════════════════════════════
// شکل درست
// ══════════════════════════════════════════════

test('رسم درست پذیرفته می‌شود', () => {
  const r = validateDrawing(trend());
  assert.equal(r.ok, true);
  assert.equal(r.drawing.kind, 'trend');
  assert.equal(r.drawing.points.length, 2);
});

test('هر نوع رسم دقیقاً تعداد نقطه‌ی خودش را می‌خواهد', () => {
  for (const [kind, needed] of Object.entries(POINTS_NEEDED)) {
    const points = Array.from({ length: needed }, (_, i) => point(NOW + i * 60));
    assert.equal(validateDrawing({ id: 'x', kind, points }).ok, true, `${kind} با ${needed} نقطه`);

    const tooFew = points.slice(0, needed - 1);
    assert.equal(validateDrawing({ id: 'x', kind, points: tooFew }).ok, false, `${kind} با نقطه‌ی کم`);

    const tooMany = [...points, point(NOW + 999)];
    assert.equal(validateDrawing({ id: 'x', kind, points: tooMany }).ok, false, `${kind} با نقطه‌ی زیاد`);
  }
});

// ══════════════════════════════════════════════
// 🔴 داده‌ی نامعتبر رد می‌شود
// ══════════════════════════════════════════════

test('🔴 نوع ناشناخته رد می‌شود', () => {
  assert.equal(validateDrawing({ id: 'x', kind: 'rocket', points: [point()] }).ok, false);
});

test('🔴 نقطه‌ی بدون عدد رد می‌شود', () => {
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [{ time: 'الان', price: 1 }] }).ok, false);
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [{ time: NOW }] }).ok, false);
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [{ time: NaN, price: 1 }] }).ok, false);
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [{ time: Infinity, price: 1 }] }).ok, false);
});

test('🔴 نقطه‌ی نسخه‌ی قدیمی (logical به‌جای time) رد می‌شود', () => {
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [{ logical: 250, price: 1 }] }).ok, false);
});

test('🔴 زمانِ خارج از بازه‌ی منطقی رد می‌شود', () => {
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [point(0)] }).ok, false, 'سال ۱۹۷۰');
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [point(9e12)] }).ok, false, 'خیلی دور');
});

test('قیمت باید مثبت باشد', () => {
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [point(NOW, 0)] }).ok, false);
  assert.equal(validateDrawing({ id: 'x', kind: 'hline', points: [point(NOW, -5)] }).ok, false);
});

test('شناسه‌ی خالی یا بیش از حد بلند رد می‌شود', () => {
  assert.equal(validateDrawing({ ...trend(), id: '' }).ok, false);
  assert.equal(validateDrawing({ ...trend(), id: '   ' }).ok, false);
  assert.equal(validateDrawing({ ...trend(), id: 'a'.repeat(65) }).ok, false);
});

test('ورودی‌های بی‌ربط چیزی را نمی‌شکنند', () => {
  for (const bad of [null, undefined, 42, 'خط', [], true]) {
    assert.equal(validateDrawing(bad).ok, false);
  }
});

// ══════════════════════════════════════════════
// 🔴 فیلدهای ناشناخته وارد دیتابیس نمی‌شوند
// ══════════════════════════════════════════════

test('🔴 فیلدهای اضافه‌ی کلاینت دور ریخته می‌شوند', () => {
  const r = validateDrawing({
    ...trend(),
    evil: 'payload',
    points: [{ time: NOW, price: 1, extra: 'x' }, { time: NOW + 60, price: 2 }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.drawing).sort(), ['id', 'kind', 'points', 'text']);
  assert.deepEqual(Object.keys(r.drawing.points[0]).sort(), ['price', 'time']);
});

test('متن فقط روی ابزار یادداشت می‌ماند', () => {
  const withText = validateDrawing({ id: 'x', kind: 'text', points: [point()], text: 'مقاومت مهم' });
  assert.equal(withText.drawing.text, 'مقاومت مهم');

  const trendWithText = validateDrawing({ ...trend(), text: 'نباید بماند' });
  assert.equal(trendWithText.drawing.text, null);
});

test('متن بیش از حد بلند بریده می‌شود، نه اینکه رد شود', () => {
  const r = validateDrawing({ id: 'x', kind: 'text', points: [point()], text: 'ا'.repeat(500) });
  assert.equal(r.ok, true);
  assert.equal(r.drawing.text.length, 200);
});

// ══════════════════════════════════════════════
// دسته
// ══════════════════════════════════════════════

test('دسته‌ی خالی معتبر است — یعنی کاربر همه را پاک کرده', () => {
  const r = validateBatch([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.drawings, []);
});

test('🔴 یک رسمِ خراب کل دسته را رد می‌کند', () => {
  const r = validateBatch([trend('a'), { id: 'b', kind: 'trend', points: [] }, trend('c')]);
  assert.equal(r.ok, false, 'نباید بی‌صدا فقط دوتا ذخیره شود');
});

test('🔴 شناسه‌ی تکراری رد می‌شود', () => {
  assert.equal(validateBatch([trend('same'), trend('same')]).ok, false);
});

test('🔴 بیش از سقفِ هر کاربر رد می‌شود', () => {
  const many = Array.from({ length: MAX_PER_USER + 1 }, (_, i) => trend(`d${i}`));
  const r = validateBatch(many);
  assert.equal(r.ok, false);
  assert.match(r.error, /\d+/, 'پیام باید عدد سقف را بگوید');

  const atLimit = Array.from({ length: MAX_PER_USER }, (_, i) => trend(`d${i}`));
  assert.equal(validateBatch(atLimit).ok, true, 'دقیقاً روی سقف هنوز قبول است');
});

test('ورودی‌ای که آرایه نیست رد می‌شود', () => {
  for (const bad of [null, undefined, {}, 'رسم', 5]) {
    assert.equal(validateBatch(bad).ok, false);
  }
});

// ══════════════════════════════════════════════
// خروجی به کلاینت
// ══════════════════════════════════════════════

test('خروجی دقیقاً همان شکلی است که چارت انتظار دارد', () => {
  const row = {
    id: 'd1', kind: 'trend', points: [point(), point(NOW + 60)], text: null,
    userId: 'u1', createdAt: new Date(), updatedAt: new Date(),
  };
  const out = toClient(row);
  assert.deepEqual(Object.keys(out).sort(), ['id', 'kind', 'points']);
  assert.equal('userId' in out, false, 'شناسه‌ی کاربر نباید برگردد');
});

test('یادداشت متنش را همراه دارد', () => {
  const out = toClient({ id: 'n1', kind: 'text', points: [point()], text: 'سقف' });
  assert.equal(out.text, 'سقف');
});
