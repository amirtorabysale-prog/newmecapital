/**
 * یک دورِ اسکن: برای هر نمادِ واچ‌لیست داده بگیر، در هر جهتِ فعال تحلیل کن،
 * و بهترین نتیجه را برگردان. تصمیمِ «هشدار بده یا نه» این‌جا نیست — در bot.
 */

import { fetchCandles } from './exchanges/index.js';
import { analyze } from './strategy/analyze.js';

export async function scanOne(item, cfg) {
  const data = await fetchCandles(item, cfg);
  let best = null;
  for (const dir of cfg.directions) {
    const res = analyze(data.candles, cfg, dir);
    if (res && (!best || res.score > best.score)) best = res;
  }
  return { item, data, result: best };
}

export async function scanAll(cfg, items = cfg.watchlist) {
  const out = [];
  // پشت‌سرِ هم، نه موازی: هشت درخواست هم‌زمان به یک صرافی برای یک بات
  // ساعتی هیچ سودی ندارد و فقط ریسکِ rate-limit می‌آورد.
  for (const item of items) {
    try {
      out.push(await scanOne(item, cfg));
    } catch (err) {
      out.push({ item, error: err.message });
    }
  }
  return out;
}

/** کلیدِ یکتای یک ستاپ: همان نماد، همان جهت، همان خطِ روند. */
export function setupKey({ item, data, result }) {
  const c = data.candles;
  return `${item.id}:${result.direction}:${c[result.line.a].t}:${c[result.line.b].t}`;
}
