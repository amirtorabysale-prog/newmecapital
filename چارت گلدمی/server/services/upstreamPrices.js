/**
 * Goldemy — Upstream Price Fetchers
 *
 * منبع مورد اعتماد قیمت. این ماژول از خودِ سرور به APIهای عمومی وصل می‌شود تا
 * تعیین قیمت به گزارش کلاینت‌ها (که قابل جعل است) وابسته نباشد.
 * هر تابع در صورت شکست null برمی‌گرداند و هرگز throw نمی‌کند.
 */

const FETCH_TIMEOUT_MS = 6000;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** اونس جهانی طلا (دلار) از اسکنر تریدینگ‌ویو */
export async function fetchGoldSpot() {
  try {
    const data = await fetchJson('https://scanner.tradingview.com/cfd/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: { tickers: ['OANDA:XAUUSD'] }, columns: ['close'] }),
    });
    const value = Number(data?.data?.[0]?.d?.[0]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * نرخ تتر به تومان — نوبیتکس و تبدیل، صرافی‌های ایرانی که معمولاً فقط از IP
 * داخل ایران در دسترس‌اند. سروری که خارج از ایران میزبانی شده معمولاً به این‌ها
 * نمی‌رسد؛ این تلاش‌ها رایگان و بی‌ضررند، پس همچنان اول امتحان می‌شوند — اگر
 * روزی زیرساخت شبکه عوض شد (مثلاً یک VPS داخل ایران به‌عنوان پراکسی)، بدون
 * تغییر کد به‌طور خودکار استفاده می‌شوند.
 */
async function fetchUsdFromNobitex() {
  const data = await fetchJson('https://api.nobitex.ir/v2/orderbook/USDTIRT');
  if (data?.status !== 'ok' || !Array.isArray(data.asks) || data.asks.length === 0) return null;
  const rial = Number(data.asks[0][0]);
  return Number.isFinite(rial) && rial > 0 ? Math.floor(rial / 10) : null; // ریال → تومان
}

/**
 * والکس — صرافیِ ایرانی که برخلاف نوبیتکس از خارج ایران هم پاسخ می‌دهد و
 * جفت‌ارزِ USDTTMN را مستقیم به تومان می‌دهد. سهمیه و کلید ندارد.
 */
async function fetchUsdFromWallex() {
  const data = await fetchJson('https://api.wallex.ir/v1/markets');
  const raw = data?.result?.symbols?.USDTTMN?.stats?.lastPrice ?? data?.result?.symbols?.USDTTMN;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/**
 * TGJU — بازار آزاد، از خارج ایران هم در دسترس. `crypto-tether-irr` همان تترِ
 * بازار است (به ریال) و با معنیِ فیلدِ usd در PriceService یکی است؛ اگر نبود،
 * `price_dollar_rl` (دلار آزاد، به ریال) جایگزینش می‌شود.
 *
 * ⚠️ بعضی کلیدهای این پاسخ سال‌هاست به‌روز نشده‌اند (مثلاً `usdt-irr` روی داده‌ی
 * ۲۰۲۰ ایستاده). پس تازگیِ رکورد بررسی می‌شود، نه فقط وجودش.
 */
async function fetchUsdFromTgju() {
  const data = await fetchJson('https://call1.tgju.org/ajax.json');
  const table = data?.current ?? data;
  for (const key of ['crypto-tether-irr', 'price_dollar_rl']) {
    const row = table?.[key];
    if (!row) continue;
    const freshEnough = row.ts && Date.now() - new Date(row.ts).getTime() < 48 * 60 * 60 * 1000;
    if (!freshEnough) continue;
    const rial = Number(String(row.p).replace(/,/g, ''));
    if (Number.isFinite(rial) && rial > 0) return Math.floor(rial / 10); // ریال → تومان
  }
  return null;
}

/**
 * نرخ آزاد تتر/تومان از وب‌سرویس نواسان (api.navasan.tech) — یک API رسمی و
 * مستندسازی‌شده، برخلاف بونبست که برای جلوگیری از همین کار (اسکرپ خودکار) یک
 * توکن ضدربات دارد. سهمیه‌ی رایگانش ۱۲۰ درخواست در ماه است، پس این تابع باید
 * با فاصله‌ی زیاد صدا زده شود (رجوع کنید به NAVASAN_REFRESH_MS در index.js) —
 * نه با همان فرکانس تیک بازار.
 */
export async function fetchUsdFromNavasan(apiKey) {
  if (!apiKey) return null;
  try {
    const data = await fetchJson(`https://api.navasan.tech/latest/?api_key=${encodeURIComponent(apiKey)}`);
    const raw = data?.usd_sell?.value ?? data?.usd_buy?.value;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  } catch {
    return null;
  }
}

/**
 * گزارشِ آخرین تلاش برای هر منبع — چه گرفت، چه نگرفت و چرا.
 *
 * 🐛 چرا لازم شد: قیمت دلار روزها روی مقدار موقتِ کد (۱۸۵٬۰۰۰) ماند و از بیرون
 * هیچ راهی نبود بفهمیم کدام منبع و چرا شکست خورده — همه‌ی خطاها بی‌صدا به null
 * تبدیل می‌شدند. حالا `/api/health` همین را نشان می‌دهد.
 */
let usdSourceReport = [];
export const getUsdSourceReport = () => usdSourceReport;

/**
 * نرخ تتر/تومان. ترتیب عمدی است:
 *   ۱. نوبیتکس — دقیق‌ترین، ولی معمولاً فقط از داخل ایران جواب می‌دهد.
 *   ۲. والکس و ۳. TGJU — رایگان، بی‌سهمیه، و از خارج ایران هم در دسترس.
 *   ۴. نواسان — آخر، چون سهمیه‌ی رایگانش ماهی ۱۲۰ درخواست است.
 *
 * ⚠️ تبدیل (api1.tabdeal.org) حذف شد: آن آدرس الان ۴۰۴ برمی‌گرداند، یعنی سال‌ها
 * بود بی‌صدا شکست می‌خورد و فقط وقتِ هر واکشی را تلف می‌کرد.
 */
export async function fetchUsdIrt(navasanApiKey) {
  const sources = [
    ['nobitex', fetchUsdFromNobitex],
    ['wallex', fetchUsdFromWallex],
    ['tgju', fetchUsdFromTgju],
    ['navasan', () => fetchUsdFromNavasan(navasanApiKey)],
  ];

  const report = [];
  let winner = null;

  for (const [name, fetcher] of sources) {
    if (winner !== null) break;
    const at = new Date().toISOString();
    try {
      const value = await fetcher();
      if (value !== null) {
        report.push({ source: name, ok: true, value, at });
        winner = value;
      } else {
        report.push({ source: name, ok: false, reason: 'پاسخ داد ولی عددِ معتبری نداشت', at });
      }
    } catch (err) {
      report.push({ source: name, ok: false, reason: String(err?.message || err).slice(0, 120), at });
    }
  }

  usdSourceReport = report;
  return winner;
}
