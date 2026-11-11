/**
 * Goldemy — توکن‌های چارت
 *
 * ⚠️ چرا این فایل جدا از src/index.css است:
 * lightweight-charts رنگ را به‌صورت مقدار جاوااسکریپت در آبجکت کانفیگ
 * می‌گیرد و هیچ‌وقت کلاس CSS یا متغیر @theme را نمی‌بیند. پس رنگ چارت
 * ناگزیر باید در TypeScript زندگی کند. این دوگانگی عمدی است — تلاش برای
 * «توکن کردنِ» رنگ چارت با کلاس تیلویند، بی‌نتیجه است.
 *
 * مقادیر اینجا باید با src/index.css هم‌خوان بمانند. هر جا اختلافی هست،
 * با کامنت علامت خورده.
 *
 * پیش از این، هر دو چارت (MazneChart و ArenaChart) این مقادیر را عیناً
 * تکرار می‌کردند؛ عوض کردن یکی و جا ماندن دیگری فقط وقت می‌خواست.
 */

/*
 * ⚠️ **فقط `import type`.** این فایل را `PnlChart` می‌خواند و `PnlChart` را
 * داشبورد — یعنی باندلِ اولیه. `lightweight-charts` در package.json اش
 * `"sideEffects": false` ندارد، پس یک import ِ *مقداری* (حتی فقط برای
 * `ColorType.Solid` که خودش رشته‌ی `'solid'` است) کلِ کتابخانه را به باندلِ
 * اولیه می‌کشید: از ۱۷۳ به ۲۳۳ kB gzip، در کامیتِ a2f3a70، و سه هفته دیده نشد.
 * `tests/initialBundle.test.js` نگهبانِ همین است.
 */
import type { ColorType } from 'lightweight-charts';

/** سطوح — همان مقادیر --color-* در index.css. */
export const CHART_SURFACE = {
  /** زمینه‌ی خودِ بوم — همان --color-surface-chart در index.css. */
  background: '#171d2b',
  /** خطوط شبکه — روی --color-surface-raised نشسته‌اند. */
  grid: '#1e222d',
  /** مرز محورها — برابر --color-line. */
  border: '#2a2e39',
  /** خط نشانگر (crosshair) — برابر --color-line-loud با یک پله تیرگی بیشتر. */
  crosshair: '#3a3f4d',
  /** متن محورها — برابر --color-muted. */
  text: '#8e929e',
} as const;

/**
 * جهت بازار.
 *
 * ⚠️ این مقادیر باید *دقیقاً* با --color-up و --color-down در
 * src/index.css یکی بمانند. پیش‌تر نبودند: توکن #22c55e بود ولی کندل‌ها
 * #10b981 — یعنی محصول دو سبز داشت و کاربر در یک صفحه هر دو را می‌دید.
 *
 * چون lightweight-charts رنگ را به‌صورت مقدار جاوااسکریپت می‌گیرد، نمی‌شود
 * همان متغیر CSS را مستقیم داد. به‌جایش tests/chartTokens.test.js هر دو
 * فایل را می‌خواند و اگر از هم جدا بیفتند، تست می‌شکند.
 */
export const CHART_MARKET = {
  up: '#22c55e',
  down: '#ef4444',
} as const;

/** نشانگرها و خطوط راهنما روی چارت. */
export const CHART_MARKER = {
  /** خط قیمت ورود و نشانه‌های برند — برابر --color-brand در index.css. */
  brand: '#d4a62a',
  /** پیش‌نمایشِ سفارشی که هنوز ثبت نشده — برابر --color-info. */
  preview: '#38bdf8',
  /** شبحِ معامله‌ی قبلی — یک لایه‌ی یادداشت است، نه داده‌ی بازار. */
  ghost: '#a78bfa',
} as const;

/** زمینه و متنِ برچسب‌هایی که روی بوم کشیده می‌شوند. */
export const CHART_LABEL = {
  background: '#0d0f14',   // برابر --color-surface-sunken
  /** رنگِ «انتخاب‌شده» — عمداً سفیدِ خنثی تا با هیچ‌کدام از رنگ‌های ابزار قاطی نشود. */
  selected: '#f8fafc',
} as const;

/**
 * رنگِ ابزارهای رسمِ کاربر.
 *
 * ⚠️ این‌ها *یادداشت‌های خودِ کاربر* هستند، نه داده‌ی بازار — و عمداً از
 * پالت معنایی محصول بیرون‌اند. دلیلش یک تجربه‌ی واقعی است: قبلاً همه یک
 * طلاییِ واحد بودند و روی چارتِ شلوغ از هم تشخیص داده نمی‌شدند.
 *
 * ⚠️ قاعده‌ی «در ناحیه‌ی چارت فقط سبز، قرمز و خاکستری» ناظر به *داده‌ی
 * بازار* است، نه این لایه. هیچ‌کدام از این رنگ‌ها به سبز و قرمزِ کندل نزدیک
 * نیستند، پس با جهت بازار اشتباه نمی‌شوند.
 *
 * خط‌کش (measure) رنگش را از جهتِ حرکت می‌گیرد، نه از اینجا.
 */
export const DRAWING_COLORS = {
  trend: '#f59e0b',
  hline: '#38bdf8',
  vline: '#94a3b8',
  rect: '#a78bfa',
  fib: '#2dd4bf',
  channel: '#f472b6',
  measure: '#f59e0b',
  text: '#facc15',
} as const;

/**
 * کانفیگ آماده‌ی چارت — همان چیزی که هر دو چارت به createChart می‌دهند.
 *
 * ⚠️ فقط لایه‌ی ظاهری. رفتار (اسکرول، مقیاس، تعامل) در خودِ کامپوننت
 * می‌ماند، چون بین دو چارت فرق دارد: چارت میدان تصمیم نباید بگذارد کاربر
 * آینده را ببیند.
 */
/**
 * ⚠️ زبانِ چارت ثابت است، نه زبانِ مرورگر. lightweight-charts برچسبِ ساعت و
 * تاریخِ محور را با `navigator.language` می‌سازد؛ روی کرومِ فارسی یعنی
 * «۱۹:۴۵» — رقمِ فارسی، برخلافِ قاعده‌ی «همه‌ی ارقام لاتین». محور و داده‌ی
 * بازار جزیره‌ی LTR اند (CLAUDE.md، راست‌به‌چپ).
 */
export const CHART_LOCALIZATION = { locale: 'en-GB' } as const;

export const chartLayout = () => ({
  localization: CHART_LOCALIZATION,
  layout: {
    background: { type: 'solid' as ColorType.Solid, color: CHART_SURFACE.background },
    textColor: CHART_SURFACE.text,
    // قلم چارت از بدنه‌ی سایت ارث می‌برد تا عددهای محور با عددهای بقیه‌ی
    // صفحه یک‌شکل باشند.
    fontFamily: 'inherit',
  },
  grid: {
    vertLines: { color: CHART_SURFACE.grid },
    horzLines: { color: CHART_SURFACE.grid },
  },
  crosshair: {
    mode: 1 as const,
    vertLine: { color: CHART_SURFACE.crosshair, labelBackgroundColor: CHART_SURFACE.border },
    horzLine: { color: CHART_SURFACE.crosshair, labelBackgroundColor: CHART_SURFACE.border },
  },
});

/**
 * رنگ‌بندی سری کندل — هر شش خاصیت، یکسان در هر دو چارت.
 * بدنه و مرز و سایه عمداً یک رنگ‌اند: مرزِ متفاوت، کندل‌های باریک را
 * در زوم کم به یک لکه‌ی مبهم تبدیل می‌کند.
 */
export const candleColors = () => ({
  upColor: CHART_MARKET.up,
  downColor: CHART_MARKET.down,
  borderUpColor: CHART_MARKET.up,
  borderDownColor: CHART_MARKET.down,
  wickUpColor: CHART_MARKET.up,
  wickDownColor: CHART_MARKET.down,
});
