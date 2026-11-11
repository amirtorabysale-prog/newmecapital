import test from 'node:test';
import assert from 'node:assert/strict';

import {
  goldMarketStatusAt,
  compactClosedMarketCandles,
} from '../server/services/marketSchedule.js';

test('شنبه بازار جهانی بسته است', () => {
  assert.deepEqual(goldMarketStatusAt(new Date('2026-08-15T12:00:00Z')), { isOpen: false, code: 'WEEKEND' });
});

test('یکشنبه قبل از ۱۸ نیویورک بسته و بعد از آن باز است', () => {
  assert.equal(goldMarketStatusAt(new Date('2026-08-16T21:59:00Z')).isOpen, false);
  assert.deepEqual(goldMarketStatusAt(new Date('2026-08-16T22:01:00Z')), { isOpen: true, code: 'OPEN' });
});

test('وقفه روزانه ۱۷ تا ۱۸ نیویورک تشخیص داده می‌شود', () => {
  assert.deepEqual(goldMarketStatusAt(new Date('2026-08-17T21:30:00Z')), { isOpen: false, code: 'DAILY_BREAK' });
  assert.equal(goldMarketStatusAt(new Date('2026-08-17T22:01:00Z')).isOpen, true);
});

test('جمعه بعد از ۱۷ نیویورک بازار آخر هفته بسته است', () => {
  assert.equal(goldMarketStatusAt(new Date('2026-08-21T20:59:00Z')).isOpen, true);
  assert.deepEqual(goldMarketStatusAt(new Date('2026-08-21T21:01:00Z')), { isOpen: false, code: 'WEEKEND' });
});

test('کندل تخت تعطیلی حذف ولی حرکت واقعی و کندل جلسه باز حفظ می‌شود', () => {
  const flatWeekend = { time: Date.parse('2026-08-15T12:00:00Z') / 1000, open: 10, high: 10, low: 10, close: 10 };
  const movedWeekend = { ...flatWeekend, high: 12, close: 11 };
  const flatOpen = { time: Date.parse('2026-08-17T14:00:00Z') / 1000, open: 11, high: 11, low: 11, close: 11 };
  assert.deepEqual(compactClosedMarketCandles([flatWeekend, movedWeekend, flatOpen]), [movedWeekend, flatOpen]);
});
