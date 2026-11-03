/**
 * تاریخچه‌ی فاندینگ‌ریتِ فیوچرزِ بایننس از بایگانیِ عمومیِ data.binance.vision
 * (فایل‌های zip ِ ماهانه؛ API ِ فیوچرز از این‌جا 451 می‌دهد). با کش.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/** خواننده‌ی حداقلیِ zip با یک فایل — بدونِ وابستگی. */
export function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip نامعتبر');
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const raw = buf.subarray(start, start + size);
  return (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
}

export async function loadFunding(symbol, fromT, toT, { cacheDir = join('out', 'cache') } = {}) {
  const file = join(cacheDir, `funding_${symbol}.json`);
  const cache = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { months: {}, missing: [] };
  const d = new Date(fromT);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  const end = new Date(toT);
  const lastFull = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)); // ماهِ جاری هنوز فایل ندارد
  while (Date.UTC(y, m - 1, 1) < lastFull.getTime()) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (!cache.months[key] && !cache.missing.includes(key)) {
      const url = `https://data.binance.vision/data/futures/um/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${key}.zip`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) cache.missing.push(key);
      else if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      else {
        const csv = unzipFirst(Buffer.from(await res.arrayBuffer()));
        cache.months[key] = csv.trim().split('\n').slice(1).map((l) => {
          const [t, , r] = l.split(',');
          return [Number(t), Number(r)];
        });
      }
    }
    if (++m > 12) { m = 1; y++; }
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify(cache));
  return Object.values(cache.months).flat().filter(([t]) => t >= fromT && t <= toT)
    .sort((a, b) => a[0] - b[0]).map(([t, rate]) => ({ t, rate }));
}
