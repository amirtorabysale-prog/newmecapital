/**
 * Goldemy — تبدیل زمان ↔ شماره‌ی منطقیِ کندل
 *
 * چرا این ریاضیِ کوچک فایل خودش را دارد: نقاطِ رسم با **زمان** ذخیره می‌شوند ولی
 * چارت برای کشیدن به **شماره‌ی کندل** نیاز دارد. این تبدیل تنها چیزی است که
 * درستیِ کل رسم‌ها به آن وابسته است، پس باید خالص و مستقل از چارت بماند تا
 * بشود تستش کرد.
 *
 * 🐛 پیش‌تر نقاط مستقیم با شماره‌ی کندل ذخیره می‌شدند. آرایه‌ی کندل مدام عوض
 * می‌شود — کندل تازه از راست اضافه می‌شود و قدیمی از چپ هرس می‌شود — پس همان
 * شماره بعد از مدتی به کندلِ دیگری اشاره می‌کرد و تحلیل کاربر جابه‌جا می‌شد.
 * با عوض کردن تایم‌فریم هم شماره‌ها کاملاً بی‌معنا می‌شدند.
 */

/**
 * جدول زمانِ کندل‌های فعلی.
 *
 * فقط زمان‌ها نگه داشته می‌شوند (نه کل کندل) چون تنها چیزی که برای تبدیل لازم
 * است همین است، و آرایه‌ی عددیِ ساده جست‌وجوی دودویی را ارزان می‌کند.
 */
export type TimeIndex = {
  /** زمان‌ها، صعودی، بر حسب ثانیه. */
  times: number[];
  /** فاصله‌ی دو کندل متوالی بر حسب ثانیه — مبنای برون‌یابی به بیرون از بازه. */
  step: number;
};

/** برای برآورد گام، بیش از این تعداد فاصله لازم نیست. */
const STEP_SAMPLE = 40;

/**
 * گام واقعیِ کندل‌ها.
 *
 * 🐛 اول از اختلاف *دو کندل آخر* حساب می‌شد. یک شکاف در داده — ری‌استارت سرور،
 * تعطیلی بازار، هرس شدن تاریخچه — همان دو کندل را چند روز از هم دور می‌کرد و
 * گام غول‌پیکری می‌ساخت. نتیجه‌اش این بود که خطی که کاربر در فضای خالیِ سمت
 * راست می‌کشید، زمانی چند سال آینده می‌گرفت و با آمدن کندل‌های بعدی از جا در
 * می‌رفت.
 *
 * میانه به‌جای میانگین یا آخرین مقدار: چند شکاف بزرگ هم میانه را جابه‌جا
 * نمی‌کنند، ولی میانگین را بله.
 */
function medianStep(times: number[], fallback: number): number {
  if (times.length < 2) return fallback;

  const deltas: number[] = [];
  for (let i = Math.max(1, times.length - STEP_SAMPLE); i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return fallback;

  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

/**
 * گام واقعی حداکثر تا این ضریب از گامِ اعلام‌شده پذیرفته می‌شود.
 *
 * عمداً سخاوتمند است: هدف رد کردنِ داده‌ی *بی‌معنا* است، نه سخت‌گیری روی
 * اختلاف‌های طبیعی. تایم‌فریم‌های این سایت ۱ تا ۳۰ دقیقه‌اند، پس هر گامی که
 * ده‌ها برابر بزرگ‌تر باشد هنوز قابل قبول است — ولی گامی که میلیون‌ها برابر
 * بزرگ‌تر است قطعاً داده‌ی خراب است.
 *
 * ⚠️ تور ایمنی در برابر داده‌ی خراب. اگر تاریخچه فقط دو کندل داشته باشد که
 * سال‌ها از هم فاصله دارند (چیزی که در دیتابیس تست واقعاً پیش آمد)، میانه هم
 * نجاتش نمی‌دهد. در آن حالت گامِ اعلام‌شده‌ی تایم‌فریم درست‌تر از هر چیزی است که
 * از داده درمی‌آید — وگرنه خطی که کاربر به آینده می‌کشد، زمانی چند دهه بعد
 * می‌گیرد.
 */
const MAX_STEP_RATIO = 50;

export function buildTimeIndex(times: number[], fallbackStep: number): TimeIndex {
  const measured = Math.max(1, medianStep(times, fallbackStep));
  const sane = measured <= fallbackStep * MAX_STEP_RATIO ? measured : fallbackStep;
  return { times, step: sane };
}

/**
 * زمان → شماره‌ی منطقی (می‌تواند اعشاری و بیرون از بازه باشد).
 *
 * بیرون از بازه با گام ثابت برون‌یابی می‌شود تا خطی که کاربر به آینده کشیده —
 * جایی که هنوز کندلی نیامده — سرِ جایش بماند.
 */
export function timeToLogical(time: number, index: TimeIndex): number {
  const { times, step } = index;
  if (times.length === 0) return 0;

  const first = times[0];
  const last = times[times.length - 1];
  if (time <= first) return (time - first) / step;
  if (time >= last) return times.length - 1 + (time - last) / step;

  // جست‌وجوی دودویی: بزرگ‌ترین اندیسی که زمانش از time بیشتر نیست
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid; else hi = mid;
  }
  const span = times[hi] - times[lo];
  return span > 0 ? lo + (time - times[lo]) / span : lo;
}

/** شماره‌ی منطقی → زمان. وارونِ دقیقِ تابع بالا. */
export function logicalToTime(logical: number, index: TimeIndex): number {
  const { times, step } = index;
  if (times.length === 0) return 0;

  if (logical <= 0) return Math.round(times[0] + logical * step);
  const lastIdx = times.length - 1;
  if (logical >= lastIdx) return Math.round(times[lastIdx] + (logical - lastIdx) * step);

  const lo = Math.floor(logical);
  const frac = logical - lo;
  const span = times[lo + 1] - times[lo];
  return Math.round(times[lo] + frac * span);
}


/**
 * نقاط قدیمی‌تر از اولین کندل بارگذاری‌شده موقتاً نمایش داده نمی‌شوند.
 * در غیر این صورت lightweight-charts آن‌ها را روی لبهٔ چپ فشرده می‌کند و چند
 * خط مستقل شبیه یک خط عمودی خراب دیده می‌شوند. آینده عمداً مجاز است.
 */
export function isTimeInLoadedHistory(time: number, index: TimeIndex): boolean {
  return index.times.length === 0 || time >= index.times[0];
}
