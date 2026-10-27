/**
 * دادهِ کندل با اولویتِ صرافی: اول LBank، اگر نماد را نداشت یا داده‌ی کافی
 * نداد بایننس اسپات، بعد MEXC، Gate، Bitget و در آخر بایننس فیوچرز. ترتیب از
 * `config.exchanges` می‌آید.
 *
 * خروجیِ هر کندل: { t (میلی‌ثانیه‌ی باز شدن), o, h, l, c, v } به ترتیبِ زمان.
 *
 * ⚠️ کندلِ در حالِ شکل‌گیری همیشه حذف می‌شود. استراتژی روی «کندلِ بسته»
 * تصمیم می‌گیرد؛ الگوی کندلیِ نیمه‌کاره ده دقیقه بعد ممکن است کاملاً برعکس شود.
 */

export const TF_MS = { '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };

const TF_LBANK = { '1h': 'hour1', '4h': 'hour4', '1d': 'day1' };
const TF_MEXC = { '1h': '60m', '4h': '4h', '1d': '1d' };
const TF_BITGET = { '1h': '1h', '4h': '4h', '1d': '1day' };

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: پاسخِ غیر JSON`);
  }
  // 451/403 از بایننس یعنی «سرورت در منطقه‌ی ممنوع است»، نه «نماد نیست»
  if (res.status === 451 || res.status === 403) throw new Error(`HTTP ${res.status}: محدودیتِ منطقه‌ایِ سرور`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body?.msg || text.slice(0, 120)}`);
  return body;
}

const ADAPTERS = {
  lbank: {
    label: 'LBank',
    symbol: (item) => item.lbank || `${item.base.toLowerCase()}_usdt`,
    pretty: (s) => s.toUpperCase().replace('_', '/'),
    async fetch(symbol, tf, limit) {
      const start = Math.floor((Date.now() - (limit + 2) * TF_MS[tf]) / 1000);
      const url = `https://api.lbkex.com/v2/kline.do?symbol=${symbol}&size=${Math.min(limit + 2, 2000)}`
        + `&type=${TF_LBANK[tf]}&time=${start}`;
      const body = await getJson(url);
      if (body.result === 'false' || body.result === false) throw new Error(body.msg || 'نماد پشتیبانی نمی‌شود');
      return (body.data || []).map((k) => ({
        t: k[0] * 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
      }));
    },
  },

  // ⚠️ api.binance.com از سرورِ آمریکا (منطقه‌ی پیش‌فرضِ Railway) 451 می‌دهد.
  // data-api.binance.vision آینه‌ی عمومیِ داده‌ی بازار است و محدودیتِ منطقه ندارد.
  binance: {
    label: 'Binance',
    symbol: (item) => item.binance || `${item.base}USDT`,
    pretty: (s) => s.replace(/USDT$/, '/USDT'),
    async fetch(symbol, tf, limit) {
      const body = await getJson(
        `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${Math.min(limit + 1, 1000)}`,
      );
      return body.map(binanceRow);
    },
  },

  // MEXC، Gate و Bitget محدودیتِ منطقه‌ای ندارند و نمادهای تازه را زودتر
  // لیست می‌کنند — MAGMA نه در LBank است نه در بایننس اسپات.
  mexc: {
    label: 'MEXC',
    symbol: (item) => item.mexc || `${item.base}USDT`,
    pretty: (s) => s.replace(/USDT$/, '/USDT'),
    async fetch(symbol, tf, limit) {
      const body = await getJson(
        `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${TF_MEXC[tf]}&limit=${Math.min(limit + 1, 1000)}`,
      );
      if (!Array.isArray(body)) throw new Error(body?.msg || 'نماد پشتیبانی نمی‌شود');
      return body.map(binanceRow);
    },
  },

  gate: {
    label: 'Gate',
    symbol: (item) => item.gate || `${item.base}_USDT`,
    pretty: (s) => s.replace('_', '/'),
    async fetch(symbol, tf, limit) {
      const body = await getJson(
        `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${symbol}&interval=${tf}&limit=${Math.min(limit + 1, 1000)}`,
      );
      if (!Array.isArray(body)) throw new Error(body?.message || 'نماد پشتیبانی نمی‌شود');
      // ترتیبِ Gate فرق دارد: [زمان, حجمِ دلاری, close, high, low, open, حجم]
      return body.map((k) => ({ t: k[0] * 1000, o: +k[5], h: +k[3], l: +k[4], c: +k[2], v: +k[6] }));
    },
  },

  bitget: {
    label: 'Bitget',
    symbol: (item) => item.bitget || `${item.base}USDT`,
    pretty: (s) => s.replace(/USDT$/, '/USDT'),
    async fetch(symbol, tf, limit) {
      const body = await getJson(
        `https://api.bitget.com/api/v2/spot/market/candles?symbol=${symbol}&granularity=${TF_BITGET[tf]}&limit=${Math.min(limit + 1, 1000)}`,
      );
      if (body.code !== '00000') throw new Error(body.msg || 'نماد پشتیبانی نمی‌شود');
      return body.data.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    },
  },

  // ⚠️ فیوچرز آینه ندارد: روی Railway منطقه را اروپا بگذار (README).
  binanceFutures: {
    label: 'Binance Futures',
    symbol: (item) => item.binanceFutures || `${item.base}USDT`,
    pretty: (s) => s.replace(/USDT$/, '/USDT') + ' PERP',
    async fetch(symbol, tf, limit) {
      const body = await getJson(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${Math.min(limit + 1, 1500)}`,
      );
      return body.map(binanceRow);
    },
  },
};

function binanceRow(k) {
  return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] };
}

export function closedOnly(candles, tf, now = Date.now()) {
  const seen = new Set();
  return candles
    .filter((k) => k.t + TF_MS[tf] <= now && Number.isFinite(k.c) && !seen.has(k.t) && seen.add(k.t))
    .sort((a, b) => a.t - b.t);
}

/**
 * @returns {{ candles, exchange, symbol, pretty, tried: {exchange, error}[] }}
 */
export const EXCHANGE_LABELS = () => Object.fromEntries(Object.entries(ADAPTERS).map(([k, v]) => [k, v.label]));

export async function fetchCandles(item, { exchanges, timeframe, candles: limit, minCandles = 150 }) {
  const tried = [];
  for (const name of exchanges) {
    const ad = ADAPTERS[name];
    if (!ad) continue;
    const symbol = ad.symbol(item);
    try {
      const rows = closedOnly(await ad.fetch(symbol, timeframe, limit), timeframe).slice(-limit);
      if (rows.length < minCandles) {
        tried.push({ exchange: ad.label, error: `فقط ${rows.length} کندل` });
        continue;
      }
      return { candles: rows, exchange: ad.label, symbol, pretty: ad.pretty(symbol), tried };
    } catch (err) {
      tried.push({ exchange: ad.label, error: err.message });
    }
  }
  const e = new Error(`هیچ صرافی داده نداد: ${tried.map((x) => `${x.exchange} (${x.error})`).join(' · ')}`);
  e.tried = tried;
  throw e;
}
