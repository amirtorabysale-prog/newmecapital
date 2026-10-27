/**
 * اسکنِ دستی بدونِ تلگرام — برای امتحانِ استراتژی و دیدنِ تصویرها.
 *
 *   npm run scan                 جدولِ امتیازِ همه‌ی نمادها
 *   npm run scan -- --charts     + تصویرِ هر نمادی که خطِ روند دارد در out/
 *   npm run scan -- SOL NEAR     فقط همین‌ها
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, parseSymbol } from '../src/config.js';
import { scanAll } from '../src/scanner.js';
import { renderChart } from '../src/chart/render.js';

const args = process.argv.slice(2);
const charts = args.includes('--charts');
const names = args.filter((a) => !a.startsWith('--'));

const cfg = loadConfig();
const items = names.length
  ? names.map((n) => cfg.watchlist.find((w) => w.base === parseSymbol(n).base) || parseSymbol(n))
  : cfg.watchlist;

const results = await scanAll(cfg, items);
mkdirSync('out', { recursive: true });

for (const r of results) {
  if (r.error) {
    console.log(`${r.item.id.padEnd(10)} ✗ ${r.error}`);
    continue;
  }
  const res = r.result;
  const src = `${r.data.exchange} ${r.data.pretty}`.padEnd(30);
  if (!res) {
    console.log(`${r.item.id.padEnd(10)} ${src} —  خطِ روندِ معتبری نزدیکِ قیمت نیست`);
    continue;
  }
  const c = res.components;
  const flag = (x) => (x.ok ? '✓' : x.points > 0 ? '~' : '·');
  console.log(`${r.item.id.padEnd(10)} ${src} ${String(res.score).padStart(3)}/${res.maxScore}`
    + `  ${res.direction.padEnd(5)} line:${flag(c.trendline)}(${res.line.distAtr.toFixed(2)}ATR)`
    + ` fib:${flag(c.fib)}(${res.fib.distAtr.toFixed(2)}ATR) div:${flag(c.divergence)}${res.div ? `(${res.div.type})` : ''}`
    + ` candle:${flag(c.candle)}${res.candle ? `(${res.candle.name})` : ''}`
    + `${res.score >= cfg.alertThreshold ? '   ← هشدار' : ''}`);
  if (charts) {
    const png = renderChart({
      candles: r.data.candles, result: res, minBars: cfg.chart.minBars,
      meta: { pretty: r.data.pretty, exchange: r.data.exchange, timeframe: cfg.timeframe, watermark: cfg.chart.watermark },
    });
    const p = join('out', `${r.item.id}.png`);
    writeFileSync(p, png);
    console.log(`           ↳ ${p}`);
  }
}
