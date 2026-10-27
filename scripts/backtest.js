/**
 * بک‌تست: استراتژی را روی گذشته کندل‌به‌کندل اجرا می‌کند — در هر لحظه فقط
 * داده‌ای را می‌بیند که آن لحظه وجود داشته — و برای هر سیگنال نگاه می‌کند
 * قیمت بعدش اول به کجا رسیده.
 *
 *   npm run backtest                    همه‌ی واچ‌لیست، آستانه‌ی فعلی
 *   npm run backtest -- SOL BTC         فقط همین‌ها
 *   npm run backtest -- --threshold 60  آستانه‌ی دیگر
 *   npm run backtest -- --charts        تصویرِ لحظه‌ی هر سیگنال در out/backtest
 *
 * مدیریتِ معامله همان است که پیامِ سیگنال می‌گوید: یک‌سوم در هر تارگت، و
 * بعد از تارگتِ اول حد ضرر به نقطه‌ی ورود. اگر در یک کندل هم حد ضرر و هم
 * تارگت لمس شوند، بدبینانه فرض می‌شود حد ضرر اول خورده.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, parseSymbol } from '../src/config.js';
import { fetchCandles } from '../src/exchanges/index.js';
import { analyze } from '../src/strategy/analyze.js';
import { renderChart } from '../src/chart/render.js';
import { utc } from '../src/format.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const cfg = loadConfig();
// --set strategy.plan.slBufferAtr=1  — یک پارامتر را فقط برای همین اجرا عوض کن
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [path, raw] = args[i + 1].split('=');
  const keys = path.split('.');
  let o = cfg;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = JSON.parse(raw);
}
const threshold = Number(opt('threshold', cfg.alertThreshold));
const charts = args.includes('--charts');
const maxBars = Number(opt('hold', 120)); // حداکثر ۵ روز در معامله
const WINDOW = 400;
const WARMUP = 300;
const names = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const items = names.length
  ? names.map((n) => cfg.watchlist.find((w) => w.base === parseSymbol(n).base) || parseSymbol(n))
  : cfg.watchlist;

function simulate(candles, i, res) {
  const p = res.plan;
  const long = res.direction !== 'short';
  const hitUp = (k, v) => (long ? k.h >= v : k.l <= v);
  const hitDown = (k, v) => (long ? k.l <= v : k.h >= v);
  const share = 1 / p.tps.length;
  let sl = p.sl;
  let r = 0;
  let next = 0;
  for (let j = i + 1; j < Math.min(candles.length, i + 1 + maxBars); j++) {
    const k = candles[j];
    if (hitDown(k, sl)) {
      r += (1 - share * next) * (next ? 0 : -1);
      return { outcome: next ? `TP${next}` : 'SL', r, bars: j - i };
    }
    while (next < p.tps.length && hitUp(k, p.tps[next].price)) {
      r += share * p.tps[next].rr;
      next++;
      sl = p.entry;
    }
    if (next === p.tps.length) return { outcome: `TP${next}`, r, bars: j - i };
  }
  // پایانِ زمان: باقی‌مانده با قیمتِ بسته‌شدنِ آخر
  const lastC = candles[Math.min(candles.length - 1, i + maxBars)].c;
  const openR = ((long ? 1 : -1) * (lastC - p.entry)) / p.risk;
  r += (1 - share * next) * openR;
  return { outcome: next ? `TP${next}` : 'OPEN', r, bars: maxBars, timedOut: true };
}

const all = [];
for (const item of items) {
  let data;
  try {
    data = await fetchCandles(item, { ...cfg, candles: 2000, minCandles: WARMUP + 50 });
  } catch (e) {
    console.log(`${item.id.padEnd(10)} ✗ ${e.message}`);
    continue;
  }
  const c = data.candles;
  const seen = new Map();
  const sigs = [];
  for (let i = WARMUP; i < c.length - 1; i++) {
    const win = c.slice(Math.max(0, i - WINDOW + 1), i + 1);
    const off = i - win.length + 1;
    for (const dir of cfg.directions) {
      const res = analyze(win, cfg, dir);
      if (!res || !res.plan || !res.alertable || res.score < threshold) continue;
      const key = `${dir}:${win[res.line.a].t}:${win[res.line.b].t}`;
      const prev = seen.get(key);
      if (prev !== undefined && c[i].t - prev < cfg.cooldownHours * 3_600_000) continue;
      seen.set(key, c[i].t);
      const sim = simulate(c, i, res);
      const sig = { id: item.id, t: c[i].t, dir, score: res.score, complete: res.complete, rr1: res.plan.tps[0]?.rr, ...sim };
      sigs.push(sig);
      if (charts) {
        mkdirSync(join('out', 'backtest'), { recursive: true });
        const f = join('out', 'backtest', `${item.id}_${utc(c[i].t).replace(/[: ]/g, '-')}_${sim.outcome}.png`);
        writeFileSync(f, renderChart({
          candles: win, result: res, minBars: cfg.chart.minBars,
          meta: { pretty: data.pretty, exchange: data.exchange, timeframe: cfg.timeframe, watermark: '' },
        }));
      }
      // روی همین کندل یک سیگنال کافی است
      break;
    }
  }
  const days = ((c.at(-1).t - c[WARMUP].t) / 86_400_000).toFixed(0);
  console.log(`\n${item.id} — ${data.exchange} — ${days} روز — ${sigs.length} سیگنال`);
  for (const s of sigs) {
    console.log(`  ${utc(s.t)}  ${s.dir.padEnd(5)} ${String(s.score).padStart(3)}${s.complete ? '★' : ' '}`
      + `  ${s.outcome.padEnd(4)} ${(s.r >= 0 ? '+' : '') + s.r.toFixed(2)}R  ${s.bars}h${s.timedOut ? ' (تمامِ وقت)' : ''}`);
  }
  all.push(...sigs);
}

function summary(label, list) {
  if (!list.length) return console.log(`${label}: سیگنالی نبود`);
  const wins = list.filter((s) => s.outcome.startsWith('TP')).length;
  const losses = list.filter((s) => s.outcome === 'SL').length;
  const totalR = list.reduce((t, s) => t + s.r, 0);
  console.log(`${label}: ${list.length} سیگنال · تارگتِ اول پیش از حد ضرر ${wins} (${((wins / list.length) * 100).toFixed(0)}%)`
    + ` · حد ضرر ${losses} · مجموع ${totalR.toFixed(2)}R · میانگین ${(totalR / list.length).toFixed(2)}R`);
}

console.log('\n──────── خلاصه');
summary(`همه (آستانه ${threshold})`, all);
summary('فقط ستاپِ کامل ★', all.filter((s) => s.complete));
summary('نزدیک به ستاپ', all.filter((s) => !s.complete));
for (const b of [[90, 101], [80, 90], [70, 80], [0, 70]]) {
  const l = all.filter((s) => s.score >= b[0] && s.score < b[1]);
  if (l.length) summary(`  امتیاز ${b[0]}–${b[1] - 1}`, l);
}
