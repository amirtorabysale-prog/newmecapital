/**
 * Goldemy — تجمیع کندل بر اساس تایم‌فریم
 *
 * سرور کندلِ پایه‌ی یک‌دقیقه‌ای می‌فرستد. تایم‌فریم‌های بلندتر از روی همین‌ها ساخته
 * می‌شوند، نه از یک درخواست جدا — هم سرور ساده می‌ماند و هم تعویض تایم‌فریم آنی است.
 *
 * قاعده‌ی تجمیع همان قاعده‌ی استاندارد بازار است:
 *   open  = open اولین کندل بازه
 *   close = close آخرین کندل بازه
 *   high  = بیشترین high
 *   low   = کمترین low
 *
 * مرزهای بازه روی زمان مطلق تراز می‌شوند (نه از اولین کندلِ موجود)، تا کندل
 * ساعت ۱۰:۳۰ همیشه از ۱۰:۳۰ شروع شود — وگرنه با هر بار رفرش، مرزها جابه‌جا
 * می‌شدند و همان داده شکل متفاوتی می‌گرفت.
 */

import type { Candle } from '../types';

export type Timeframe = 1 | 15 | 30 | 60 | 240;

export const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 1, label: '1 دقیقه' },
  { value: 15, label: '15 دقیقه' },
  { value: 30, label: '30 دقیقه' },
  { value: 60, label: '1 ساعت' },
  { value: 240, label: '4 ساعت' },
];

/**
 * کندل‌های پایه را در سطل‌های تایم‌فریم داده‌شده تجمیع می‌کند.
 * ورودی باید بر حسب زمان صعودی باشد (همان چیزی که سرور می‌فرستد).
 */
export function aggregateCandles(base: Candle[], minutes: Timeframe): Candle[] {
  if (minutes <= 1) return base;
  if (base.length === 0) return [];

  const bucketSeconds = minutes * 60;
  const out: Candle[] = [];
  let current: Candle | null = null;
  let currentBucket = -1;

  for (const c of base) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds;

    if (bucket !== currentBucket) {
      if (current) out.push(current);
      currentBucket = bucket;
      current = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
      continue;
    }

    // همان سطل: بازه را گسترش بده و close را جلو ببر
    current!.high = Math.max(current!.high, c.high);
    current!.low = Math.min(current!.low, c.low);
    current!.close = c.close;
  }

  if (current) out.push(current);
  return out;
}

/** چند دقیقه داده لازم است تا این تایم‌فریم معنا پیدا کند. */
export function minimumMinutesFor(minutes: Timeframe): number {
  return minutes * 3;
}


/**
 * ادغام تاریخچهٔ API با کندل‌های زنده. سری دوم روی زمان هم‌پوشان برنده است تا
 * آخرین قیمت و OHLC همیشه از موتور زندهٔ Goldemy بیاید.
 */
export function mergeCandles(older: Candle[], newer: Candle[]): Candle[] {
  const merged = new Map<number, Candle>();
  for (const candle of older) merged.set(candle.time, candle);
  for (const candle of newer) merged.set(candle.time, candle);
  return [...merged.values()].sort((a, b) => a.time - b.time);
}
