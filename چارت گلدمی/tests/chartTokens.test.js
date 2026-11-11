/**
 * رنگ چارت و رنگ سیستم طراحی نباید از هم جدا بیفتند.
 *
 * lightweight-charts رنگ را به‌صورت مقدار جاوااسکریپت می‌گیرد و هیچ‌وقت
 * متغیر CSS نمی‌بیند، پس ناچار در دو جا نوشته می‌شود: توکن‌ها در
 * src/index.css و مقادیر چارت در src/lib/theme.ts.
 *
 * 🐛 یک‌بار واقعاً از هم جدا افتادند: --color-up برابر #22c55e بود ولی
 * کندل‌ها با #10b981 کشیده می‌شدند. کاربر در یک صفحه دو سبز می‌دید بدون
 * اینکه بداند چرا. این تست همان را می‌گیرد.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const ts = readFileSync(new URL('../src/lib/theme.ts', import.meta.url), 'utf8');

/** مقدار یک توکن رنگ را از بلوک ‎@theme‎ می‌خواند. */
function token(name) {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(m, `توکن --color-${name} در src/index.css پیدا نشد`);
  return m[1].toLowerCase();
}

/** مقدار یک کلید را از آبجکت‌های theme.ts می‌خواند. */
function chartValue(key) {
  const m = ts.match(new RegExp(`${key}:\\s*'(#[0-9a-fA-F]{3,8})'`));
  assert.ok(m, `کلید ${key} در src/lib/theme.ts پیدا نشد`);
  return m[1].toLowerCase();
}

test('رنگ کندل صعودی با --color-up یکی است', () => {
  assert.equal(chartValue('up'), token('up'));
});

test('رنگ کندل نزولی با --color-down یکی است', () => {
  assert.equal(chartValue('down'), token('down'));
});

test('رنگ نشانه‌های چارت با --color-brand یکی است', () => {
  assert.equal(chartValue('brand'), token('brand'));
});

test('سطوح چارت با توکن‌های سطح یکی‌اند', () => {
  assert.equal(chartValue('background'), token('surface-chart'));
  assert.equal(chartValue('border'), token('line'));
  assert.equal(chartValue('text'), token('muted'));
});
