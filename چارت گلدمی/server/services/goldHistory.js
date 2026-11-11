/**
 * Goldemy — واردکردن تاریخچه‌ی طلا برای سناریوهای آموزشی
 *
 * سناریوهای «میدان تصمیم» به تاریخچه‌ی واقعی بازار نیاز دارند. بایگانی مظنه از
 * حالا شروع به انباشت کرده (CANDLE_RETENTION_DAYS در server/types.js) ولی تا
 * پر شدنش ماه‌ها طول می‌کشد. تا آن موقع از تاریخچه‌ی رایگانِ انس جهانی استفاده
 * می‌شود.
 *
 * ⚠️ این یک انتخاب آگاهانه است: محور آموزش «درک شرایط معامله» است، نه اینکه
 * نماد دقیقاً مظنه باشد. رفتار FOMO، شکست کاذب و پولبک روی هر نمودار قیمتی
 * یکسان‌اند. سناریو با منبعش برچسب می‌خورد تا هیچ‌وقت وانمود نشود مظنه است.
 *
 * 🐛 نسخه‌ی اول فقط بایننس را داشت و روی Railway کار نکرد: بایننس آی‌پی‌های
 * آمریکا را مسدود می‌کند (کد ۴۵۱) و سرور آنجاست. حالا چند منبع پشت سر هم امتحان
 * می‌شوند — همان الگویی که گزارش‌گر قیمت (src/lib/priceReporter.ts) از قبل
 * داشت، چون دقیقاً همین مشکل را داشت.
 */

/** سقف کندلِ یک سناریو. بیشتر از این نه خوانده می‌شود نه کسی تا آخرش می‌رود. */
export const MAX_DATASET_CANDLES = 5000;

/**
 * کفِ کندلِ یک سناریو.
 *
 * 🐛 این عدد قبلاً فقط داخل اعتبارسنجی سناریو بود و واردکردن از آن خبر نداشت.
 * نتیجه‌اش یک بن‌بست تمام‌عیار بود: ادمین بازه‌ای می‌گرفت که فقط ۱۸ کندل داده
 * داشت، دیتاست با موفقیت ساخته می‌شد، و بعد فرم سناریو می‌گفت «حداکثر ۱۷» و
 * همزمان «حداقل ۲۰ لازم است» — دو عددی که هیچ‌وقت با هم جمع نمی‌شدند و هیچ
 * راهی هم برای بیرون آمدن از آن صفحه وجود نداشت.
 *
 * حالا همین عدد هر دو سر ماجرا را می‌بندد: منبعی که کمتر از این بدهد اصلاً
 * قبول نمی‌شود و سراغ منبع بعدی می‌رویم.
 */
export const MIN_SCENARIO_CANDLES = 20;

/** کیفیت حداقلی دیتای تمرین؛ داده‌ی ناقص نباید با ظاهر «بازار واقعی» منتشر شود. */
export const DATASET_QUALITY_LIMITS = Object.freeze({
  minCoverage: 0.9,
  maxGapBars: 3,
  maxFlatRatio: 0.35,
  maxWicklessRatio: 0.85,
});

/** بازه‌های قابل انتخاب و طولشان بر حسب ثانیه. */
export const INTERVALS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
};

/** مهلت هر تماس. بدون این، منبعِ در دسترس‌نبودن می‌تواند درخواست را تا ابد نگه دارد. */
const REQUEST_TIMEOUT_MS = 20_000;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** یک کندل معتبر است یا نه — نگهبان مشترک همه‌ی منابع. */
function sane(candle) {
  const { time, open, high, low, close } = candle;
  if (![time, open, high, low, close].every(isFiniteNumber)) return false;
  // 🐛 شرط «مثبت بودنِ زمان» لازم است، نه فقط عددی بودنش: Number(null) برابر
  // صفر است، پس ردیفی که اصلاً زمان ندارد به‌عنوان کندلِ سال ۱۹۷۰ پذیرفته
  // می‌شد و بی‌سروصدا وارد داده‌ی سناریو می‌شد.
  if (time <= 0) return false;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return false;
  return high >= Math.max(open, close) && low <= Math.min(open, close);
}

/** مرتب‌سازی صعودی و حذف هم‌زمان‌ها — چارت و تبدیل زمان‌به‌اندیس هر دو لازمش دارند. */
export function cleanCandles(list) {
  const valid = list.filter(sane).sort((a, b) => a.time - b.time);
  const out = [];
  for (const c of valid) {
    if (out.length > 0 && out[out.length - 1].time === c.time) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

/**
 * کیفیت دیتاست را بدون ساختن کندل مصنوعی می‌سنجد.
 *
 * پر کردن فاصله‌ها با close قبلی ظاهراً گپ را حذف می‌کند، اما کندل جعلی می‌سازد
 * و نتیجه‌ی آموزشی/امتیازدهی را آلوده می‌کند. راه درست، رد کردن منبع کم‌کیفیت و
 * رفتن سراغ منبع بعدی است.
 */
export function assessCandleQuality(list, stepSeconds) {
  const candles = cleanCandles(Array.isArray(list) ? list : []);
  const step = Number(stepSeconds);
  if (!(step > 0) || candles.length < 2) {
    return {
      acceptable: false, candleCount: candles.length, expectedSlots: candles.length,
      coverageRatio: candles.length > 0 ? 1 : 0, missingBars: 0, longestGapBars: 0,
      flatRatio: candles.length ? Number(candles[0].high === candles[0].low) : 0,
      wicklessRatio: candles.length ? 1 : 0,
      reasons: ['داده برای سنجش پیوستگی کافی نیست'],
    };
  }

  let missingBars = 0;
  let longestGapBars = 0;
  for (let i = 1; i < candles.length; i++) {
    const slots = Math.max(1, Math.round((candles[i].time - candles[i - 1].time) / step));
    const gap = Math.max(0, slots - 1);
    missingBars += gap;
    longestGapBars = Math.max(longestGapBars, gap);
  }

  let flat = 0;
  let wickless = 0;
  for (const candle of candles) {
    const tolerance = Math.max(candle.high, 1) * 1e-10;
    const bodyHigh = Math.max(candle.open, candle.close);
    const bodyLow = Math.min(candle.open, candle.close);
    if (candle.high - candle.low <= tolerance) flat++;
    if (candle.high - bodyHigh <= tolerance && bodyLow - candle.low <= tolerance) wickless++;
  }

  const expectedSlots = candles.length + missingBars;
  const coverageRatio = candles.length / Math.max(1, expectedSlots);
  const flatRatio = flat / candles.length;
  const wicklessRatio = wickless / candles.length;
  const reasons = [];
  if (coverageRatio < DATASET_QUALITY_LIMITS.minCoverage) reasons.push(`پیوستگی فقط ${Math.round(coverageRatio * 100)}٪ است`);
  if (longestGapBars > DATASET_QUALITY_LIMITS.maxGapBars) reasons.push(`یک فاصله‌ی ${longestGapBars} کندلی دارد`);
  if (flatRatio > DATASET_QUALITY_LIMITS.maxFlatRatio) reasons.push(`${Math.round(flatRatio * 100)}٪ کندل‌ها کاملاً تخت‌اند`);
  if (wicklessRatio > DATASET_QUALITY_LIMITS.maxWicklessRatio) reasons.push(`${Math.round(wicklessRatio * 100)}٪ کندل‌ها بدون سایه‌اند`);

  return {
    acceptable: reasons.length === 0,
    candleCount: candles.length,
    expectedSlots,
    coverageRatio,
    missingBars,
    longestGapBars,
    flatRatio,
    wicklessRatio,
    reasons,
  };
}

/** fetch با مهلت — منبعِ کند نباید کل درخواست ادمین را قفل کند. */
async function getJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`کد ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ══════════════════════════════════════════════
// منابع
// ══════════════════════════════════════════════
//
// هر منبع می‌گوید چه بازه‌هایی را پشتیبانی می‌کند و چطور یک بازه را می‌گیرد.
// همه به یک شکل خروجی می‌دهند تا بقیه‌ی کد نداند داده از کجا آمده.

/**
 * Yahoo Finance — قرارداد آتی طلا.
 *
 * اول امتحان می‌شود چون هیچ محدودیت جغرافیایی ندارد و کل بازه را در یک تماس
 * می‌دهد. محدودیتش: کندل یک‌دقیقه‌ای فقط برای هفت روز اخیر در دسترس است.
 */
const yahoo = {
  id: 'yahoo',
  label: 'Yahoo Finance (GC=F)',
  symbol: 'GC=F',
  intervals: { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '60m' },

  async fetchRange({ interval, from, to, fetchImpl }) {
    const iv = this.intervals[interval];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(this.symbol)}`
      + `?interval=${iv}&period1=${from}&period2=${to}`;

    const data = await getJson(url, fetchImpl);
    const result = data?.chart?.result?.[0];
    const times = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!Array.isArray(times) || !q) return [];

    return times.map((t, i) => ({
      time: Math.floor(Number(t)),
      open: Number(q.open?.[i]),
      high: Number(q.high?.[i]),
      low: Number(q.low?.[i]),
      close: Number(q.close?.[i]),
    }));
  },
};

/**
 * Coinbase — PAX Gold به دلار.
 *
 * PAXG یک توکن پشتوانه‌دار است که هر واحدش یک اونس تروآی طلاست، پس قیمتش عملاً
 * انس جهانی است. کوین‌بیس از آمریکا در دسترس است ولی هر تماس حداکثر سیصد کندل
 * می‌دهد، پس بازه‌های بلند چند تماس لازم دارند.
 */
const coinbase = {
  id: 'coinbase',
  label: 'Coinbase (PAXG-USD)',
  intervals: { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 },
  pageSize: 300,

  async fetchRange({ interval, from, to, fetchImpl }) {
    const granularity = this.intervals[interval];
    const span = granularity * this.pageSize;
    const out = [];

    for (let start = from; start < to; start += span) {
      const end = Math.min(to, start + span);
      const url = 'https://api.exchange.coinbase.com/products/PAXG-USD/candles'
        + `?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}`
        + `&end=${new Date(end * 1000).toISOString()}`;

      const rows = await getJson(url, fetchImpl);
      if (!Array.isArray(rows)) break;
      // ⚠️ ترتیب ستون‌های کوین‌بیس غیرمعمول است: [time, low, high, open, close, volume]
      for (const r of rows) {
        if (!Array.isArray(r) || r.length < 5) continue;
        out.push({ time: Number(r[0]), low: Number(r[1]), high: Number(r[2]), open: Number(r[3]), close: Number(r[4]) });
      }
      if (out.length > MAX_DATASET_CANDLES) break;
    }
    return out;
  },
};

/**
 * Binance — PAXG/USDT.
 *
 * ⚠️ از آی‌پی آمریکا کد ۴۵۱ می‌دهد، پس روی Railway معمولاً کار نمی‌کند و آخر
 * صف است. برای استقرارهای خارج از آمریکا بهترین منبع است: تنها منبعی که چهار
 * ساعته دارد و تاریخچه‌اش از همه عمیق‌تر است.
 */
const binance = {
  id: 'binance',
  label: 'Binance (PAXGUSDT)',
  intervals: { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' },
  pageSize: 1000,

  async fetchRange({ interval, from, to, step, fetchImpl }) {
    const out = [];
    let cursor = from;
    const maxPages = Math.ceil(MAX_DATASET_CANDLES / this.pageSize) + 2;

    for (let page = 0; page < maxPages && cursor < to; page++) {
      const url = 'https://api.binance.com/api/v3/klines'
        + `?symbol=PAXGUSDT&interval=${this.intervals[interval]}`
        + `&startTime=${cursor * 1000}&endTime=${to * 1000}&limit=${this.pageSize}`;

      const rows = await getJson(url, fetchImpl);
      if (!Array.isArray(rows) || rows.length === 0) break;

      const batch = rows
        .filter((r) => Array.isArray(r) && r.length >= 5)
        .map((r) => ({
          time: Math.floor(Number(r[0]) / 1000),
          open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]),
        }));
      if (batch.length === 0) break;

      out.push(...batch);
      const last = batch[batch.length - 1].time;
      // هیچ پیشرفتی نشد — منبع همان صفحه را برمی‌گرداند
      if (last <= cursor) break;
      cursor = last + step;
    }
    return out;
  },
};

/**
 * OKX — PAXG/USDT.
 *
 * برخلاف بایننس، از آی‌پی آمریکا مسدود نیست. تاریخچه‌ی عمیق‌ترش از طریق
 * history-candles می‌آید (نه market/candles که فقط چند صد کندلِ اخیر را می‌دهد)
 * — با after صفحه‌بندی می‌شود: هر صفحه، کندل‌های قدیمی‌تر از قدیمی‌ترین کندلِ
 * صفحه‌ی قبل را می‌دهد.
 *
 * ⚠️ کد HTTP همیشه ۲۰۰ است، حتی برای خطا — باید فیلد code خودِ پاسخ را چک کرد.
 */
const okx = {
  id: 'okx',
  label: 'OKX (PAXG-USDT)',
  intervals: { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H' },
  pageSize: 300,

  async fetchRange({ interval, from, to, fetchImpl }) {
    const bar = this.intervals[interval];
    const out = [];
    let after = (to + 1) * 1000;
    const minTime = from * 1000;
    const maxPages = Math.ceil(MAX_DATASET_CANDLES / this.pageSize) + 2;

    for (let page = 0; page < maxPages && after > minTime; page++) {
      const url = `https://www.okx.com/api/v5/market/history-candles?instId=PAXG-USDT&bar=${bar}&after=${after}&limit=${this.pageSize}`;
      const data = await getJson(url, fetchImpl);
      if (data?.code !== '0') throw new Error(data?.msg || `کد ${data?.code}`);
      const rows = data.data;
      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const r of rows) {
        if (!Array.isArray(r) || r.length < 5) continue;
        const time = Math.floor(Number(r[0]) / 1000);
        if (time < from) continue;
        out.push({ time, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) });
      }

      const oldest = Number(rows[rows.length - 1][0]);
      if (!(oldest < after)) break; // پیشرفتی نشد
      after = oldest;
    }
    return out;
  },
};

/**
 * KuCoin — PAXG/USDT.
 *
 * تا هزار و پانصد کندل در یک تماس می‌دهد، پس بازه‌های معمولیِ تمرین آزاد اغلب
 * یک تماس بیشتر لازم ندارند.
 *
 * ⚠️ ترتیب ستون‌های کندل غیرمعمول است: [زمان، باز، بسته، سقف، کف، حجم، گردش]
 * — باز و بسته قبل از سقف و کف می‌آیند، برخلاف بقیه‌ی منابع.
 */
const kucoin = {
  id: 'kucoin',
  label: 'KuCoin (PAXG-USDT)',
  intervals: { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1hour', '4h': '4hour' },
  pageSize: 1500,

  async fetchRange({ interval, from, to, step, fetchImpl }) {
    const type = this.intervals[interval];
    const out = [];
    const span = step * this.pageSize;

    for (let start = from; start < to; start += span) {
      const end = Math.min(to, start + span);
      const url = `https://api.kucoin.com/api/v1/market/candles?type=${type}&symbol=PAXG-USDT&startAt=${start}&endAt=${end}`;
      const data = await getJson(url, fetchImpl);
      if (data?.code !== '200000') throw new Error(data?.msg || `کد ${data?.code}`);
      const rows = data.data;
      if (!Array.isArray(rows)) break;

      for (const r of rows) {
        if (!Array.isArray(r) || r.length < 5) continue;
        out.push({ time: Number(r[0]), open: Number(r[1]), close: Number(r[2]), high: Number(r[3]), low: Number(r[4]) });
      }
      if (out.length > MAX_DATASET_CANDLES) break;
    }
    return out;
  },
};

/**
 * Gate.io — PAXG/USDT.
 *
 * حداکثر هزار کندل در هر تماس (سخت‌گیرانه‌تر از حدِ page: بازه‌ی گسترده‌تر با
 * خطای صریح رد می‌شود، نه بریده)، پس هر صفحه دقیقاً به همان محدوده بریده می‌شود.
 *
 * ⚠️ ترتیب ستون‌ها: [زمان، حجمِ نقل‌شونده، بسته، سقف، کف، باز، حجمِ پایه، بسته‌شده؟]
 */
const gateio = {
  id: 'gateio',
  label: 'Gate.io (PAXG-USDT)',
  intervals: { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' },
  pageSize: 1000,

  async fetchRange({ interval, from, to, fetchImpl }) {
    const iv = this.intervals[interval];
    const out = [];
    const span = INTERVALS[interval] * this.pageSize;

    for (let start = from; start < to; start += span) {
      const end = Math.min(to, start + span);
      const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=PAXG_USDT&interval=${iv}&from=${start}&to=${end}`;
      const rows = await getJson(url, fetchImpl);
      if (!Array.isArray(rows)) break;
      for (const r of rows) {
        if (!Array.isArray(r) || r.length < 6) continue;
        out.push({ time: Number(r[0]), close: Number(r[2]), high: Number(r[3]), low: Number(r[4]), open: Number(r[5]) });
      }
      if (out.length > MAX_DATASET_CANDLES) break;
    }
    return out;
  },
};

/**
 * ترتیب امتحان: از در دسترس‌ترین به محدودترین.
 *
 * 🐛 با فقط سه منبع، وقتی یکی نرخ‌محدود می‌شد یا از IP سرور مسدود بود، کاربر
 * برای بازه‌های عادی هم گاهی خطای «هیچ منبعی جواب نداد» می‌گرفت. حالا شش منبع
 * پشت سر هم امتحان می‌شوند — هر شش هم‌زمان رد شدن عملاً بعید است.
 */
export const SOURCES = [yahoo, coinbase, okx, kucoin, gateio, binance];

// ══════════════════════════════════════════════
// اعتبارسنجی و واردکردن
// ══════════════════════════════════════════════

export function validateImportRequest({ interval, startTime, endTime }) {
  const step = INTERVALS[interval];
  if (!step) {
    return { ok: false, error: `بازه نامعتبر است. مجاز: ${Object.keys(INTERVALS).join('، ')}` };
  }

  const from = Math.floor(Number(startTime));
  const to = Math.floor(Number(endTime));
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { ok: false, error: 'بازه‌ی زمانی نامعتبر است.' };
  }
  if (to <= from) return { ok: false, error: 'زمان پایان باید بعد از شروع باشد.' };

  const expected = Math.ceil((to - from) / step);
  if (expected > MAX_DATASET_CANDLES) {
    return {
      ok: false,
      error: `این بازه حدود ${expected} کندل می‌شود؛ حداکثر ${MAX_DATASET_CANDLES} کندل قابل واردکردن است. بازه را کوتاه‌تر کن یا تایم‌فریم را بزرگ‌تر.`,
    };
  }
  // پیش از خرج کردن چند تماس شبکه: بازه‌ای که ذاتاً کوچک است هیچ‌وقت به سناریو
  // نمی‌رسد، پس همین‌جا با راهنمایی مشخص رد می‌شود.
  if (expected < MIN_SCENARIO_CANDLES) {
    return {
      ok: false,
      error: `این بازه فقط حدود ${expected} کندل می‌شود؛ یک سناریو دست‌کم ${MIN_SCENARIO_CANDLES} کندل لازم دارد. بازه را بلندتر بگیر یا تایم‌فریم را کوچک‌تر.`,
    };
  }

  return { ok: true, request: { interval, step, from, to, expected } };
}

/**
 * واردکردن یک بازه — اولین منبعی که جواب بدهد برنده است.
 *
 * ⚠️ دلیلِ شکستِ هر منبع نگه داشته می‌شود و در خطای نهایی برمی‌گردد. بدون آن،
 * ادمین فقط «خطا در ارتباط با سرور» می‌دید و هیچ راهی برای فهمیدن اینکه کدام
 * منبع و چرا شکست خورده نداشت — دقیقاً اتفاقی که در اولین استفاده افتاد.
 */
export async function importHistory(options) {
  const check = validateImportRequest(options);
  if (!check.ok) return check;

  const { interval, step, from, to } = check.request;
  const fetchImpl = options.fetchImpl || fetch;
  const attempts = [];

  for (const source of SOURCES) {
    if (!source.intervals[interval]) {
      attempts.push({ source: source.label, error: `بازه‌ی ${interval} را پشتیبانی نمی‌کند` });
      continue;
    }

    try {
      const raw = await source.fetchRange({ interval, from, to, step, fetchImpl });
      const candles = cleanCandles(raw).slice(0, MAX_DATASET_CANDLES);
      if (candles.length === 0) {
        attempts.push({ source: source.label, error: 'برای این بازه داده‌ای نداشت' });
        continue;
      }
      // ⚠️ «کم بودنِ داده» شکستِ همین منبع است، نه شکستِ کل عملیات. یک جفتِ
      // کم‌معامله در تایم‌فریم یک‌دقیقه‌ای حفره دارد و مثلاً از سی دقیقه فقط
      // هجده کندل می‌دهد، در حالی که منبع بعدی ممکن است همان بازه را کامل
      // داشته باشد. پس رد می‌شویم و بعدی را امتحان می‌کنیم.
      if (candles.length < MIN_SCENARIO_CANDLES) {
        attempts.push({
          source: source.label,
          error: `فقط ${candles.length} کندل داشت (کمتر از ${MIN_SCENARIO_CANDLES} کندلِ لازم)`,
        });
        continue;
      }

      const quality = assessCandleQuality(candles, step);
      if (!quality.acceptable) {
        attempts.push({
          source: source.label,
          error: `کیفیت برای سناریو کافی نیست: ${quality.reasons.join('؛ ')}`,
          quality,
        });
        continue;
      }

      return {
        ok: true,
        attempts,
        quality,
        dataset: {
          candles,
          timeframe: Math.round(step / 60),
          startTime: candles[0].time,
          endTime: candles[candles.length - 1].time,
          source: `${source.label} · ${interval}`,
        },
      };
    } catch (err) {
      attempts.push({ source: source.label, error: describeFailure(err) });
    }
  }

  return {
    ok: false,
    attempts,
    error: `هیچ منبعی داده‌ی قابل استفاده برای این بازه نداشت:\n${attempts.map((a) => `• ${a.source}: ${a.error}`).join('\n')}`,
  };
}

/** ترجمه‌ی خطای شبکه به چیزی که ادمین بتواند بر اساسش تصمیم بگیرد. */
function describeFailure(err) {
  if (err?.name === 'AbortError') return 'جواب نداد (مهلت تمام شد)';
  if (err?.status === 451) return 'از این سرور مسدود است (کد 451 — محدودیت جغرافیایی)';
  if (err?.status === 429) return 'محدودیت تعداد درخواست (کد 429) — کمی بعد دوباره امتحان کن';
  if (err?.status) return `کد ${err.status}`;
  return err?.message || 'خطای نامشخص شبکه';
}

/**
 * آزمایش دسترسی به منابع — بدون ساختن دیتاست.
 *
 * وجودش لازم است چون شبکه‌ی سرورِ استقرار با شبکه‌ی توسعه فرق دارد و از بیرون
 * قابل حدس زدن نیست. با این، ادمین در چند ثانیه می‌فهمد کدام منبع از سرورِ
 * خودش کار می‌کند.
 */
export async function probeSources(fetchImpl = fetch) {
  const to = Math.floor(Date.now() / 1000) - 3600;
  const from = to - 3600;

  return Promise.all(SOURCES.map(async (source) => {
    if (!source.intervals['5m']) return { id: source.id, label: source.label, ok: false, reason: 'بازه‌ی آزمایشی را ندارد' };
    try {
      const raw = await source.fetchRange({ interval: '5m', from, to, step: 300, fetchImpl });
      const candles = cleanCandles(raw);
      const quality = assessCandleQuality(candles, 300);
      return candles.length > 0
        ? { id: source.id, label: source.label, ok: quality.acceptable, sample: candles.length, quality, ...(!quality.acceptable ? { reason: quality.reasons.join('؛ ') } : {}) }
        : { id: source.id, label: source.label, ok: false, reason: 'پاسخ داد ولی داده‌ای نداشت' };
    } catch (err) {
      return { id: source.id, label: source.label, ok: false, reason: describeFailure(err) };
    }
  }));
}
