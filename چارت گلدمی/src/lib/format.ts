/**
 * Goldemy — قالب‌بندی مشترک
 *
 * ⚠️ همه‌جای سایت عدد لاتین است، نه فارسی. زبانِ رابط فارسی است ولی ارقام لاتین‌اند
 * چون قیمت و حجم مدام کنار نماد و واحد لاتین می‌نشینند و قاطی شدنِ دو دستگاه رقم،
 * خواندن عدد را کند می‌کند. کلید این کار `-u-nu-latn` روی همان لوکیل فارسی است.
 *
 * ⚠️ این تنها راه فرمت کردن عدد در محصول است. اگر جایی toLocaleString یا toFixed
 * دیدی، یا باید به یکی از این توابع تبدیل شود یا دلیلش همان‌جا نوشته شود.
 */

const FA_LATIN = 'fa-IR-u-nu-latn';

/**
 * عدد با جداکننده‌ی هزارگان و ارقام لاتین. پایه‌ی بقیه‌ی توابع این فایل.
 *
 * ⚠️ روی عدد **منفی** خروجی با U+2212 (علامت منهای واقعی) و یک LRM نامرئی
 * شروع می‌شود. در HTMLِ راست‌به‌چپ همین درست است و علامت را سر جایش نگه
 * می‌دارد — ولی بوم canvas دوجهته‌سازی ندارد و آن LRM را یک مربع خالی
 * می‌کشد. کدِ چارت به همین دلیل همیشه قدرمطلق می‌فرستد و علامت را خودش
 * جلوی عدد می‌گذارد. اگر جای تازه‌ای روی canvas عدد کشیدی، همین کار را بکن.
 */
export const num = (n: number | null | undefined, d = 0) =>
  new Intl.NumberFormat(FA_LATIN, { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0);

/**
 * قیمت بازار و مبلغ تومانی — همیشه گرد، بدون اعشار.
 *
 * ریال اعشار ندارد و نمایشش فقط عرض عدد را زیاد می‌کند؛ در ستونی که هر ثانیه
 * عوض می‌شود، همان چند پیکسل باعث پرش چیدمان است.
 */
export const formatPrice = (n: number | null | undefined) => num(Math.round(Number(n) || 0));

/** مبلغ تومانی. واحد جدا نوشته می‌شود — با <Numeric unit="تومان"> یا دستی. */
export const formatToman = formatPrice;

/** وزن طلا — دو رقم اعشار، چون واحد معامله گرم است و زیر گرم هم معنا دارد. */
export const formatGram = (n: number | null | undefined) => num(n, 2);

/** درصد، با علامت ٪ چسبیده. */
export const formatPercent = (n: number | null | undefined, d = 1) => `${num(n, d)}٪`;

/**
 * تغییر قیمت یا سود و زیان — علامت همیشه دیده می‌شود، حتی وقتی مثبت است.
 *
 * بدون علامتِ مثبت، کاربر باید رنگ را بخواند تا جهت را بفهمد؛ و رنگ برای کسی
 * که نابیناى رنگ است یا در نور آفتاب نگاه می‌کند، تنها سرنخ خوبی نیست.
 */
export const formatChange = (n: number | null | undefined, d = 0) => {
  const v = Number(n) || 0;
  return `${v > 0 ? '+' : ''}${num(v, d)}`;
};

/**
 * تاریخ گزارش.
 *
 * 🐛 پیش‌تر رشته‌ی خام `YYYY-MM-DD` مستقیم چاپ می‌شد و در متنِ RTL وارونه دیده
 * می‌شد. این تابع همان تاریخ را به قالب فارسیِ خوانا (با ارقام لاتین) می‌برد.
 */
export const REPORT_DATE = (iso: string) =>
  new Date(iso).toLocaleDateString(FA_LATIN, { month: 'long', day: 'numeric' });

/** تاریخ و ساعت — قالب مشترک جدول‌های پنل مدیریت. */
export const dateTime = (iso: string | number | Date) =>
  new Date(iso).toLocaleString(FA_LATIN, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** همان، ولی با سال — برای جایی که داده‌ی چند ساله کنار هم می‌نشیند. */
export const dateTimeFull = (iso: string | number | Date) =>
  new Date(iso).toLocaleString(FA_LATIN, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * پیام خطا وقتی پاسخ، بدنه‌ی قابل‌فهمی ندارد.
 *
 * همه‌ی مسیرهای خودِ سرور با فیلد error جواب می‌دهند؛ پس رسیدن به اینجا یعنی
 * پاسخ از خودِ برنامه نیامده. کد وضعیت تنها سرنخِ باقی‌مانده است و پنهان کردنش
 * پشت یک «خطایی رخ داد»، عیب‌یابی را غیرممکن می‌کند.
 */
export function gatewayErrorMessage(status: number): string {
  if (status === 502 || status === 504) {
    return `سرور به‌موقع جواب نداد (کد ${status}). معمولاً یعنی تحلیل بیش از حد طول کشیده یا سرویس تازه ری‌استارت شده — چند لحظه صبر کن و دوباره بزن.`;
  }
  if (status === 503) return 'سرویس موقتاً در دسترس نیست (کد 503). چند لحظه بعد دوباره بزن.';
  if (status === 0) return 'پاسخی از سرور نرسید. اتصال اینترنت را بررسی کن.';
  return `پاسخ نامنتظره از سرور (کد ${status}). اگر تکرار شد، همین کد را به پشتیبانی بگو.`;
}
