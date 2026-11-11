/**
 * Goldemy — Candle Store
 *
 * کندل‌ها را پایدار می‌کند تا با ری‌استارت سرور از بین نروند.
 *
 * چرا لازم است: تا پیش از این، تاریخچه‌ی چارت فقط در حافظه‌ی پروسه بود. Railway با
 * هر استقرار جدید پروسه را از نو بالا می‌آورد، پس هر بار که تغییری منتشر می‌شد،
 * چارت همه‌ی کاربران به یک صفحه‌ی خالی برمی‌گشت.
 *
 * نوشتن‌ها عمداً «شلیک کن و فراموش کن» هستند: اگر دیتابیس لحظه‌ای در دسترس نباشد،
 * چارت زنده نباید متوقف شود — بدترین حالت این است که یک کندل ذخیره نشود.
 */

import { MAX_CANDLES, CANDLE_RETENTION_DAYS } from '../types.js';
import { compactClosedMarketCandles } from './marketSchedule.js';

/** هر چند کندل یک‌بار، ردیف‌های قدیمی هرس می‌شوند (نه در هر نوشتن). */
const PRUNE_EVERY = 50;

let writesSincePrune = 0;

/**
 * بیشترین نسبتی که یک کندلِ سالم می‌تواند با قیمت زنده فاصله داشته باشد.
 *
 * MAX_CANDLES کندلِ یک‌دقیقه‌ای یعنی حدود دو روز تاریخچه؛ طلا در دو روز سه‌برابر
 * نمی‌شود. پس هر چیزی بیرون از این بازه قیمت نیست، بلکه بازمانده‌ی یک واحدِ
 * دیگر است — مثل کندل‌های مثقالی که کنار قیمتِ گرمی مانده باشند.
 */
const SANE_SCALE_RATIO = 3;

/**
 * کندل‌هایی که مقیاسشان با قیمت زنده نمی‌خواند را حذف می‌کند.
 *
 * این تورِ ایمنیِ تغییر واحد است. اگر مهاجرت به هر دلیلی کامل اجرا نشود، بدون
 * این تابع سرور تاریخچه‌ی مقیاسِ قدیم را کنار قیمت زنده‌ی جدید می‌گذارد و محور
 * قیمت چنان کش می‌آید که کندل‌های واقعی به یک خط باریک تبدیل می‌شوند — دقیقاً
 * همان چیزی که یک‌بار در محیط واقعی دیده شد.
 *
 * @returns تعداد ردیف‌های حذف‌شده
 */
export async function dropOutOfScaleCandles(prisma, referencePrice) {
  const price = Number(referencePrice);
  if (!Number.isFinite(price) || price <= 0) return 0;

  const { count } = await prisma.marketCandle.deleteMany({
    where: {
      OR: [
        { close: { gt: Math.round(price * SANE_SCALE_RATIO) } },
        { close: { lt: Math.round(price / SANE_SCALE_RATIO) } },
      ],
    },
  });
  return count;
}

/** آخرین کندل‌های ذخیره‌شده، به ترتیب زمانی صعودی. */
export async function loadRecentCandles(prisma, limit = MAX_CANDLES) {
  const rows = await prisma.marketCandle.findMany({
    orderBy: { time: 'desc' },
    // چند برابر می‌خوانیم تا تعطیلی چندروزه، کندل‌های واقعی قبل از تعطیلی را
    // از پنجره‌ی تاریخچه بیرون نراند. پس از فشرده‌سازی فقط limit ردیف برمی‌گردد.
    take: limit * 3,
  });
  const candles = rows
    .reverse()
    .map((r) => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close }));
  return compactClosedMarketCandles(candles).slice(-limit);
}

/**
 * یک کندلِ بسته‌شده را ذخیره می‌کند.
 * upsert است چون در شرایط نادر (ری‌استارت درست در مرز یک کندل) ممکن است
 * همان ثانیه دوباره نوشته شود.
 */
export async function saveCandle(prisma, candle) {
  const data = {
    open: Math.round(candle.open), high: Math.round(candle.high),
    low: Math.round(candle.low), close: Math.round(candle.close),
  };
  await prisma.marketCandle.upsert({
    where: { time: candle.time },
    create: { time: candle.time, ...data },
    update: data,
  });

  if (++writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    await pruneCandles(prisma);
  }
}

/**
 * هرس بایگانی — بر مبنای *سن*، نه تعداد ردیف.
 *
 * 🐛 پیش‌تر فقط MAX_CANDLES (سه هزار) ردیف نگه داشته می‌شد، یعنی حدود دو روز.
 * برای چارت کافی بود ولی معنایش این بود که هیچ تاریخچه‌ای انباشته نمی‌شود — و
 * سناریوهای آموزشی دقیقاً به همان تاریخچه‌ی واقعی مظنه نیاز دارند.
 *
 * حالا چارت و بایگانی از هم جدا شده‌اند: موتور بازار همان MAX_CANDLES آخر را در
 * حافظه دارد، ولی دیتابیس یک سال نگه می‌دارد.
 */
export async function pruneCandles(prisma, retentionDays = CANDLE_RETENTION_DAYS) {
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 24 * 60 * 60;
  const { count } = await prisma.marketCandle.deleteMany({ where: { time: { lt: cutoff } } });
  return count;
}
