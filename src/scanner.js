/**
 * یک دورِ اسکن: برای هر نمادِ واچ‌لیست داده بگیر، در هر جهتِ فعال تحلیل کن،
 * و بهترین نتیجه را برگردان. تصمیمِ «هشدار بده یا نه» این‌جا نیست — در bot.
 */

import { fetchCandles, fetchFrom } from './exchanges/index.js';
import { analyze } from './strategy/analyze.js';

/** کندل‌های 5 دقیقه برای واگراییِ 5 دقیقه — ۳۰۰ تا یعنی ۲۵ ساعت، بیش از بازه + گرم شدنِ RSI */
export const LTF = '5m';
const LTF_CANDLES = 300;

export async function scanOne(item, cfg) {
  const data = await fetchCandles(item, cfg);
  // از همان صرافی و همان نماد: قیمتِ کفِ 5 دقیقه باید با کفِ یک‌ساعته یکی باشد
  let ltf = null;
  if (cfg.strategy.conditions.divergence5m?.enabled) {
    try {
      ltf = await fetchFrom(data.exchangeKey, data.symbol, LTF, LTF_CANDLES);
    } catch (e) {
      data.ltfError = e.message;
    }
  }
  let best = null;
  for (const dir of cfg.directions) {
    const res = analyze(data.candles, cfg, dir, ltf);
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
