import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRecentCandles } from '../server/services/candleStore.js';

const candle = (iso, open, high = open, low = open, close = open) => ({
  time: Date.parse(iso) / 1000,
  open, high, low, close,
});

test('بارگذاری تاریخچه، کندل‌های تخت تعطیلی را حذف و حرکت واقعی را حفظ می‌کند', async () => {
  const friday = candle('2026-08-14T16:00:00Z', 100);
  const saturdayFlat = candle('2026-08-15T12:00:00Z', 101);
  const saturdayMove = candle('2026-08-15T13:00:00Z', 101, 103, 100, 102);
  let requestedTake = 0;
  const prisma = {
    marketCandle: {
      findMany: async ({ take }) => {
        requestedTake = take;
        return [saturdayMove, saturdayFlat, friday]; // شبیه orderBy desc در Prisma
      },
    },
  };

  const result = await loadRecentCandles(prisma, 5);
  assert.equal(requestedTake, 15, 'برای عبور از تعطیلی باید بیش از limit خوانده شود');
  assert.deepEqual(result, [friday, saturdayMove]);
});
