import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMarketHistoryQuery,
  aggregateMarketCandles,
  mergeMarketCandles,
  scaleProxyCandles,
} from '../server/services/marketHistory.js';

const candle = (time, open, high = open, low = open, close = open) => ({
  time, open, high, low, close,
});

test('درخواست تاریخچه فقط تایم‌فریم‌های ترمینال را می‌پذیرد', () => {
  assert.equal(normalizeMarketHistoryQuery({ timeframe: 60 }).ok, true);
  assert.equal(normalizeMarketHistoryQuery({ timeframe: 5 }).ok, false);
});

test('تجمیع سرور OHLC تایم‌فریم چهارساعته را درست می‌سازد', () => {
  const base = [
    candle(0, 100, 110, 90, 105),
    candle(3600, 105, 120, 95, 115),
    candle(7200, 115, 118, 80, 90),
    candle(10800, 90, 130, 85, 125),
  ];
  assert.deepEqual(aggregateMarketCandles(base, 240), [
    candle(0, 100, 130, 80, 125),
  ]);
});

test('در بازه هم‌پوشان، کندل زنده روی پروکسی تاریخی اولویت دارد', () => {
  const proxy = [candle(0, 10), candle(60, 11)];
  const live = [candle(60, 99), candle(120, 100)];
  assert.deepEqual(mergeMarketCandles(proxy, live), [
    candle(0, 10), candle(60, 99), candle(120, 100),
  ]);
});

test('پروکسی انس به قیمت فعلی گرم متصل می‌شود و شکل OHLC را حفظ می‌کند', () => {
  const scaled = scaleProxyCandles([
    candle(0, 90, 110, 80, 100),
    candle(60, 100, 120, 95, 110),
  ], 11_000_000);
  assert.equal(scaled.at(-1).close, 11_000_000);
  assert.equal(scaled[0].open, 9_000_000);
  assert.equal(scaled[0].high, 11_000_000);
});
