/**
 * تاریخچهٔ بلندمدت چارت ترمینال.
 *
 * کندل‌های زندهٔ Goldemy در MarketCandle می‌مانند. تاریخچهٔ بیرونی در جدول
 * جدا ذخیره می‌شود تا هیچ‌وقت دادهٔ واقعی سایت با پروکسی انس جهانی اشتباه
 * گرفته نشود. هنگام خواندن، دادهٔ زنده روی بازهٔ هم‌پوشان اولویت دارد.
 */

import { importHistory } from './goldHistory.js';
import { compactClosedMarketCandles } from './marketSchedule.js';

export const MARKET_TIMEFRAMES = [1, 15, 30, 60, 240];
export const MAX_HISTORY_BARS = 10_000;

const DEFAULT_LIMIT = {
  1: 3000,
  15: 7000,
  30: 4000,
  60: 8000,
  240: 3000,
};

const DAY = 86_400;

export function normalizeMarketHistoryQuery(query = {}) {
  const timeframe = Number(query.timeframe);
  if (!MARKET_TIMEFRAMES.includes(timeframe)) {
    return { ok: false, error: 'تایم‌فریم نامعتبر است.' };
  }

  const wanted = Number(query.limit);
  const limit = Math.min(
    MAX_HISTORY_BARS,
    Math.max(50, Number.isFinite(wanted) ? Math.floor(wanted) : DEFAULT_LIMIT[timeframe]),
  );
  const rawBefore = Number(query.before);
  const before = Number.isFinite(rawBefore) && rawBefore > 0
    ? Math.floor(rawBefore)
    : Math.floor(Date.now() / 1000) + DAY;

  return { ok: true, timeframe, limit, before };
}

export function aggregateMarketCandles(candles, timeframe) {
  if (timeframe <= 1) return [...candles].sort((a, b) => a.time - b.time);
  const seconds = timeframe * 60;
  const buckets = new Map();

  for (const candle of [...candles].sort((a, b) => a.time - b.time)) {
    const time = Math.floor(candle.time / seconds) * seconds;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, {
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
  }

  return [...buckets.values()];
}

/** سری دوم روی زمان‌های هم‌پوشان برنده است؛ برای proxy سپس live استفاده می‌شود. */
export function mergeMarketCandles(older, newer) {
  const merged = new Map();
  for (const candle of older) merged.set(candle.time, candle);
  for (const candle of newer) merged.set(candle.time, candle);
  return [...merged.values()].sort((a, b) => a.time - b.time);
}

export function scaleProxyCandles(candles, currentPrice) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const anchor = Number(sorted[sorted.length - 1].close);
  const target = Number(currentPrice);
  if (!Number.isFinite(anchor) || anchor <= 0 || !Number.isFinite(target) || target <= 0) return [];

  const ratio = target / anchor;
  return sorted.map((candle) => ({
    ...candle,
    open: Math.round(candle.open * ratio),
    high: Math.round(candle.high * ratio),
    low: Math.round(candle.low * ratio),
    close: Math.round(candle.close * ratio),
  }));
}

function plain(row) {
  return { time: row.time, open: row.open, high: row.high, low: row.low, close: row.close };
}

async function coverageFor(model, where = {}) {
  const [count, first, last] = await Promise.all([
    model.count({ where }),
    model.findFirst({ where, orderBy: { time: 'asc' }, select: { time: true } }),
    model.findFirst({ where, orderBy: { time: 'desc' }, select: { time: true } }),
  ]);
  return { count, firstTime: first?.time ?? null, lastTime: last?.time ?? null };
}

export async function marketHistoryCoverage(prisma) {
  const [live, fifteen, hourly] = await Promise.all([
    coverageFor(prisma.marketCandle),
    coverageFor(prisma.marketHistoryCandle, { timeframe: 15 }),
    coverageFor(prisma.marketHistoryCandle, { timeframe: 60 }),
  ]);
  return { live, archive: { 15: fifteen, 60: hourly } };
}

export async function loadMarketHistory(prisma, query = {}) {
  const check = normalizeMarketHistoryQuery(query);
  if (!check.ok) return check;
  const { timeframe, limit, before } = check;

  if (timeframe === 1) {
    const rows = await prisma.marketCandle.findMany({
      where: { time: { lt: before } },
      orderBy: { time: 'desc' },
      take: Math.min(MAX_HISTORY_BARS * 3, limit * 3),
    });
    const candles = compactClosedMarketCandles(rows.reverse().map(plain)).slice(-limit);
    return {
      ok: true,
      timeframe,
      candles,
      hasMore: rows.length >= limit,
      nextBefore: candles[0]?.time ?? null,
      proxy: false,
    };
  }

  const baseTimeframe = timeframe >= 60 ? 60 : 15;
  const multiplier = Math.max(1, Math.ceil(timeframe / baseTimeframe));
  const historyTake = Math.min(12_000, Math.max(2500, limit * multiplier + 500));
  const liveTake = Math.min(20_000, Math.max(4000, timeframe * Math.min(limit, 500)));

  const [historyRows, liveRows] = await Promise.all([
    prisma.marketHistoryCandle.findMany({
      where: { timeframe: baseTimeframe, time: { lt: before } },
      orderBy: { time: 'desc' },
      take: historyTake,
    }),
    prisma.marketCandle.findMany({
      where: { time: { lt: before } },
      orderBy: { time: 'desc' },
      take: liveTake,
    }),
  ]);

  const proxy = aggregateMarketCandles(historyRows.reverse().map(plain), timeframe);
  const live = aggregateMarketCandles(
    compactClosedMarketCandles(liveRows.reverse().map(plain)),
    timeframe,
  );
  const candles = mergeMarketCandles(proxy, live).slice(-limit);

  return {
    ok: true,
    timeframe,
    candles,
    hasMore: historyRows.length >= historyTake,
    nextBefore: candles[0]?.time ?? null,
    proxy: proxy.length > 0,
    source: proxy.length > 0 ? 'انس جهانی (پروکسی) + داده زنده Goldemy' : 'داده زنده Goldemy',
  };
}

const BACKFILL_PLANS = [
  { timeframe: 15, interval: '15m', maxDays: 60, chunkDays: 30 },
  { timeframe: 60, interval: '1h', maxDays: 365, chunkDays: 120 },
];

async function saveArchive(prisma, timeframe, rows) {
  if (rows.length === 0) return 0;
  const from = rows[0].time;
  const to = rows[rows.length - 1].time;

  return prisma.$transaction(async (tx) => {
    await tx.marketHistoryCandle.deleteMany({
      where: { timeframe, time: { gte: from, lte: to } },
    });
    for (let i = 0; i < rows.length; i += 750) {
      await tx.marketHistoryCandle.createMany({
        data: rows.slice(i, i + 750),
        skipDuplicates: true,
      });
    }
    return rows.length;
  }, { timeout: 60_000 });
}

export async function backfillMarketHistory(prisma, {
  days = 365,
  currentPrice,
  now = Math.floor(Date.now() / 1000),
  importFn = importHistory,
} = {}) {
  const requestedDays = Math.min(365, Math.max(7, Math.floor(Number(days) || 365)));
  const results = [];

  for (const plan of BACKFILL_PLANS) {
    const planDays = Math.min(requestedDays, plan.maxDays);
    const start = now - planDays * DAY;
    const collected = [];
    const failures = [];

    for (let cursor = start; cursor < now; cursor += plan.chunkDays * DAY) {
      const end = Math.min(now, cursor + plan.chunkDays * DAY);
      const result = await importFn({
        interval: plan.interval,
        startTime: cursor,
        endTime: end,
      });
      if (!result.ok) {
        failures.push(result.error || 'منبع تاریخچه پاسخ نداد.');
        continue;
      }
      for (const candle of result.dataset.candles) {
        collected.push({ ...candle, source: result.dataset.source });
      }
    }

    const unique = new Map();
    for (const candle of collected) unique.set(candle.time, candle);
    const ordered = [...unique.values()].sort((a, b) => a.time - b.time);
    const scaled = scaleProxyCandles(ordered, currentPrice).map((candle) => ({
      time: candle.time,
      timeframe: plan.timeframe,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      source: candle.source || 'Global gold proxy',
    }));

    const saved = await saveArchive(prisma, plan.timeframe, scaled);
    results.push({
      timeframe: plan.timeframe,
      requestedDays: planDays,
      fetched: ordered.length,
      saved,
      failures,
    });
  }

  return {
    ok: results.some((item) => item.saved > 0),
    results,
    coverage: await marketHistoryCoverage(prisma),
  };
}

let ensurePromise = null;

export async function ensureMarketHistory(prisma, options = {}) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const coverage = await marketHistoryCoverage(prisma);
    if (coverage.archive[15].count >= 100 && coverage.archive[60].count >= 100) {
      return { ok: true, skipped: true, coverage };
    }
    return backfillMarketHistory(prisma, options);
  })();

  try {
    return await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}
