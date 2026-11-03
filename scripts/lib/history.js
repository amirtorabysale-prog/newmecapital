/**
 * تاریخچه‌ی بلندِ کندل برای بک‌تست: صفحه‌به‌صفحه از بایننس (آینه‌ی
 * data-api.binance.vision) و MEXC، با کش در out/cache. منبعی انتخاب می‌شود که
 * تاریخچه‌ی بلندتری دارد (نمادِ تازه‌لیست‌شده در بایننس کوتاه است).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TF_MS = { '5m': 300_000, '1h': 3_600_000 };

const SOURCES = [
  {
    key: 'binance', label: 'Binance',
    symbol: (it) => it.binance || `${it.base}USDT`,
    url: (s, tf, start) => `https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&startTime=${start}&limit=1000`,
  },
  {
    key: 'mexc', label: 'MEXC',
    symbol: (it) => it.mexc || `${it.base}USDT`,
    url: (s, tf, start) => `https://api.mexc.com/api/v3/klines?symbol=${s}&interval=${tf === '1h' ? '60m' : tf}`
      + `&startTime=${start}&endTime=${start + 1000 * TF_MS[tf]}&limit=1000`,
  },
];

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${body?.msg || ''}`), { fatal: res.status === 400 });
      return body;
    } catch (e) {
      if (e.fatal || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function fetchRange(src, symbol, tf, from, to, cacheDir) {
  const ms = TF_MS[tf];
  const file = join(cacheDir, `${src.key}_${symbol}_${tf}.json`);
  let cache = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (!cache || cache.from > from) cache = { from, rows: [] };
  const rows = cache.rows;
  let start = rows.length ? rows.at(-1).t + ms : from;
  while (start < to - ms) {
    const body = await getJson(src.url(symbol, tf, start));
    if (!Array.isArray(body)) throw new Error(body?.msg || 'پاسخِ نامعتبر');
    const batch = body.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
      .filter((k) => k.t >= start && k.t + ms <= to && Number.isFinite(k.c));
    if (!batch.length) {
      start += 1000 * ms; // هنوز لیست نشده بود
      continue;
    }
    rows.push(...batch);
    start = batch.at(-1).t + ms;
  }
  const seen = new Set();
  cache.rows = rows.filter((k) => !seen.has(k.t) && seen.add(k.t)).sort((a, b) => a.t - b.t);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify(cache));
  return cache.rows.filter((k) => k.t >= from && k.t + ms <= to);
}

/** @returns {{ candles, exchange, symbol } | { error }} */
export async function loadHistory(item, tf, from, to, { cacheDir = join('out', 'cache'), log = () => {} } = {}) {
  let best = null;
  const tried = [];
  for (const src of SOURCES) {
    const symbol = src.symbol(item);
    try {
      const rows = await fetchRange(src, symbol, tf, from, to, cacheDir);
      log(`${item.id} ${src.label} ${symbol}: ${rows.length} کندل${rows.length ? ` از ${new Date(rows[0].t).toISOString().slice(0, 10)}` : ''}`);
      if (!rows.length) { tried.push(`${src.label}: داده‌ای نیامد`); continue; }
      if (!best || rows[0].t < best.candles[0].t) best = { candles: rows, exchange: src.label, symbol };
      if (rows[0].t <= from + 86_400_000) break;
    } catch (e) {
      log(`${item.id} ${src.label} ${symbol}: ✗ ${e.message}`);
      tried.push(`${src.label}: ${e.message}`);
    }
  }
  return best || { error: tried.join(' · ') };
}
