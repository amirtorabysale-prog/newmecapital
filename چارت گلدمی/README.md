# چارت گلدمی — کپیِ مستقل

کپیِ همه‌ی کدهای مربوط به چارتِ گلدمی، با همان ساختارِ پوشه‌ی پروژه‌ی اصلی
(`src/…`، `server/…`، `prisma/…`، `tests/…`) تا مسیرهای `import` دست‌نخورده
کار کنند. تاریخ کپی: ۲۹ اکتبر ۲۰۲۶، شاخه‌ی `polish/live-site`.

> این پوشه یک برش است، نه یک پروژه‌ی قابل اجرا. چند فایلِ بزرگ (`App.tsx`،
> `Terminal.tsx`، `server/index.js`، `routes/user.js`) فقط برای **نشان دادنِ
> نحوه‌ی اتصال** آمده‌اند و به بخش‌های دیگرِ گلدمی وابسته‌اند.

---

## مسیرِ یک کندل، از قیمت تا صفحه

```
upstreamPrices.js ── قیمت انس جهانی (هر ۵ ثانیه) و دلار
        │
priceService.js ──── اوراکل: فیلتر کران، گام مجاز، اجماع میانه
        │
server/index.js ──── هر ۱ ثانیه: قیمت → marketEngine.tick()
        │                       (gramPriceFromMazne در portfolio.js)
marketEngine.js ──── ساخت کندل ۱ دقیقه‌ای (CANDLE_INTERVAL_MS در types.js)
        │                 ├─ کندل بسته‌شده → candleStore.saveCandle → جدول MarketCandle
        │                 └─ کندل در حال شکل‌گیری → WebSocket: CANDLE_UPDATE
        │
   WebSocket ──────── اتصال تازه: INIT با آخرین کندل‌های بسته‌شده
        │
src/App.tsx ──────── candles[] + activeCandle (ref + state)
        │              اگر time کندلِ ورودی عوض شد → قبلی به candles اضافه می‌شود
        │
        ├─ GET /api/market/candles?timeframe=… → historyState (تاریخچه‌ی بلند)
        │
candles.ts ───────── aggregateCandles (۱ → ۱۵/۳۰/۶۰/۲۴۰ دقیقه)
        │              mergeCandles(تاریخچه، زنده) — زنده روی زمان مشترک برنده است
        │
pages/Terminal.tsx ─ انتخاب تایم‌فریم، حالت‌های خالی/خطا/بارگذاری
        │
chart/MazneChart.tsx  lightweight-charts — کاملاً «کنترل‌شده»، فقط prop می‌گیرد
```

### سرور

| فایل | کار |
|---|---|
| `server/services/upstreamPrices.js` | واکشیِ قیمت انس و دلار از منابع بیرونی |
| `server/services/priceService.js` | اوراکلِ مقاوم: کران، گام، لنگر، میانه‌ی گزارش‌ها |
| `server/services/portfolio.js` | فقط برای `gramPriceFromMazne` (مظنه ÷ 4.6083 = قیمت هر گرم) |
| `server/services/marketEngine.js` | **قلب کندل‌سازی.** کندل فقط بعد از رسیدنِ قیمت واقعی (`activate`)؛ رفتارِ بسته‌شدن بازار؛ دفتر سفارش |
| `server/services/marketSchedule.js` | ساعت باز/بسته بودنِ بازار طلای جهانی (نیویورک) و فشرده‌سازیِ کندل‌های تعطیلی |
| `server/services/candleStore.js` | ذخیره/بارگذاری کندل‌های زنده در `MarketCandle`، هرس ۳۶۵ روزه |
| `server/services/marketHistory.js` | تاریخچه‌ی بلند برای `/api/market/candles`: ادغامِ پروکسیِ انس جهانی (`MarketHistoryCandle`) با داده‌ی زنده، و backfill |
| `server/services/goldHistory.js` | واکشیِ تاریخچه از Yahoo/Coinbase/OKX/… و پاک‌سازی و سنجش کیفیت |
| `server/services/drawingStore.js` | اعتبارسنجی و ذخیره‌ی رسم‌های کاربر |
| `server/routes/market.js` | `GET /api/market-data` و `GET /api/market/candles` |
| `server/routes/user.js` | (فقط بخش `GET/PUT /drawings` مربوط است، حدود خط ۱۸۹) |
| `server/types.js` | ثابت‌ها: `CANDLE_INTERVAL_MS`، `MAX_CANDLES`، `CANDLE_RETENTION_DAYS` |
| `server/index.js` | سیم‌کشی: بارگذاری تاریخچه هنگام بالا آمدن (خط ~۱۸۷–۲۱۰)، حلقه‌ی تیک (~۶۶۴)، ارسال `CANDLE_UPDATE` (~۶۹۵)، `INIT` روی اتصال (~۸۱۰) |
| `prisma/schema.prisma` | مدل‌های `MarketCandle`، `MarketHistoryCandle`، `ChartDrawing` |

### کلاینت

| فایل | کار |
|---|---|
| `src/chart/MazneChart.tsx` | چارت اصلی روی `lightweight-charts` v5 — کندل، خط پوزیشن، پیش‌نمایش سفارش، رسم‌ها |
| `src/chart/candles.ts` | تجمیع تایم‌فریم و ادغام تاریخچه با زنده |
| `src/chart/timeIndex.ts` | تبدیل زمان ↔ شماره‌ی منطقیِ کندل (رسم‌ها با **زمان** ذخیره می‌شوند) |
| `src/chart/geometry.ts` | هندسه‌ی ابزارهای رسم |
| `src/chart/drawings.ts` | `DrawingsPrimitive` — رندر رسم‌ها روی بوم چارت |
| `src/chart/tools.tsx` | نوار ابزار رسم |
| `src/chart/useDrawings.ts` | state رسم‌ها — قفلِ `loaded`؛ باید بالاتر از صفحه زندگی کند |
| `src/chart/persistence.ts` | کش محلی + همگام‌سازی با سرور |
| `src/chart/positionZone.tsx` | ناحیه‌ی حد سود/ضرر پوزیشن به‌صورت HTML روی چارت |
| `src/chart/PnlChart.tsx` | نمودار سود و زیان داشبورد |
| `src/chart/TradingViewPanel.tsx` | ویجتِ تریدینگ‌ویو (نمای جایگزین) |
| `src/lib/theme.ts` | رنگ‌های چارت به‌صورت مقدار JS (`candleColors`، `chartLayout`، `DRAWING_COLORS`) |
| `src/lib/format.ts` | `formatPrice` و بقیه‌ی قالب‌بندی اعداد |
| `src/index.css` | توکن‌های رنگ (`@theme`) — `theme.ts` باید با آن بخواند |
| `src/types.ts` | تایپ `Candle` و `OrderType` |
| `src/App.tsx` | WebSocket (خط ~۳۱۱–۴۳۰)، واکشی تاریخچه (~۵۴۴)، تجمیع و ادغام (~۵۷۲)، `useDrawings` (~۵۹۰) |
| `src/pages/Terminal.tsx` | جایی که `MazneChart` رندر می‌شود |
| `src/arena/ArenaChart.tsx`، `ScenarioRangeChart.tsx` | چارت‌های میدان تصمیم، روی همان ابزارها |

### تست‌ها

`tests/` — کندل، تجمیع، موتور بازار، تاریخچه، زمان‌بندی بازار، رسم‌ها، و
`chartTokens.test.js` که یکی بودنِ رنگ `theme.ts` و `index.css` را چک می‌کند.

---

## وابستگی‌ها

کلاینت: `react@19`، `lightweight-charts@^5.2.0`، `lucide-react`
سرور: `express`، `ws`، `@prisma/client` (PostgreSQL)

## دام‌هایی که در گلدمی یک‌بار گرفتار شدیم

- **متن فارسی روی بوم lightweight-charts نکش.** دوجهته‌سازی ندارد («ورود خرید» → «خرید ورود»). برچسب‌های روی چارت لاتین‌اند (BUY/SELL/TP/SL)؛ هر متن فارسی HTML باشد.
- **خروجی `num()` برای عدد منفی را روی canvas نبر.** یک LRM نامرئی دارد که مربع خالی کشیده می‌شود.
- **`lightweight-charts` را در `theme.ts` فقط `import type` کن.** import مقداری کل کتابخانه (۵۸ kB) را به باندل اولیه می‌کشید.
- **`useDrawings` را داخل صفحه‌ای که unmount می‌شود نبر.** با هر خروج/برگشت رسم‌ها می‌پرند.
- **تا نسخه‌ی سرورِ رسم‌ها نیامده، چیزی به سرور ننویس** — وگرنه وضعیت خالیِ اولیه روی تحلیل کاربر می‌نشیند.
- **نقاط رسم را با زمان ذخیره کن نه شماره‌ی کندل** — آرایه‌ی کندل مدام هرس و اضافه می‌شود.
- **INIT کندل در حال شکل‌گیری را ندارد** — با هر اتصال تازه `activeCandle` ریست می‌شود.
- **پاسخ تاریخچه را نرمال کن:** `Array.isArray(data.candles)` پیش از استفاده.
