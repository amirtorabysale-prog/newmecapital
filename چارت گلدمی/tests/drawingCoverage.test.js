import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeIndex, isTimeInLoadedHistory } from '../src/chart/timeIndex.ts';

test('رسم قدیمی‌تر از اولین کندل بارگذاری‌شده نباید روی لبه چارت فشرده شود', () => {
  const index = buildTimeIndex([1000, 4600, 8200], 3600);
  assert.equal(isTimeInLoadedHistory(999, index), false);
  assert.equal(isTimeInLoadedHistory(1000, index), true);
  assert.equal(isTimeInLoadedHistory(7000, index), true);
});

test('رسم رو به آینده همچنان قابل نمایش است', () => {
  const index = buildTimeIndex([1000, 4600], 3600);
  assert.equal(isTimeInLoadedHistory(50_000, index), true);
});
