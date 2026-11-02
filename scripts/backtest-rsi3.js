/**
 * بک‌تستِ استراتژیِ «اشباعِ سه‌تایم‌فریمی» (src/strategy/rsi3.js).
 *
 *   npm run backtest:rsi3                       ۱۸۰ روزِ اخیر، همه‌ی واچ‌لیست
 *   npm run backtest:rsi3 -- --days 365         یک سال
 *   npm run backtest:rsi3 -- SOL BTC            فقط همین‌ها
 *   npm run backtest:rsi3 -- --set minTouches=3 --set oversold=20
 *   npm run backtest:rsi3 -- --out out/rsi3-os20   پوشه‌ی خروجیِ دیگر
 *
 * داده: کندلِ ۵ دقیقه از بایننس (data-api.binance.vision) و اگر نماد نبود از
 * MEXC. یک و چهار ساعته از همان ۵ دقیقه ساخته می‌شوند. داده در
 * out/rsi3/cache نگه داشته می‌شود تا اجرای دوم سریع باشد.
 *
 * خروجی: report.md، trades.csv و report.html در پوشه‌ی خروجی.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, parseSymbol } from '../src/config.js';
import { backtestRsi3, stats, RSI3_DEFAULTS, M5, H1 } from '../src/strategy/rsi3.js';
import { buildHtml } from './rsi3-report.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const params = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [key, raw] = args[i + 1].split('=');
  if (!(key in RSI3_DEFAULTS)) throw new Error(`پارامترِ ناشناخته: ${key} — مجاز: ${Object.keys(RSI3_DEFAULTS).join(', ')}`);
  params[key] = JSON.parse(raw);
}
const days = Number(opt('days', 180));
const outDir = opt('out', join('out', 'rsi3'));
const cacheDir = join('out', 'rsi3', 'cache');
const WARMUP_DAYS = 45; // ۳۰ روز برای ناحیه‌ها + گرم شدنِ RSI ِ ۴ ساعته
const cfg = loadConfig();
const names = args.filter((a, i) => !a.startsWith('--') && !['--days', '--set', '--out'].includes(args[i - 1]));
const items = names.length
  ? names.map((n) => cfg.watchlist.find((w) => w.base === parseSymbol(n).base) || parseSymbol(n))
  : cfg.watchlist;

const SOURCES = [
  {
    key: 'binance', label: 'Binance',
    symbol: (it) => it.binance || `${it.base}USDT`,
    url: (s, start) => `https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=5m&startTime=${start}&limit=1000`,
  },
  {
    key: 'mexc', label: 'MEXC',
    symbol: (it) => it.mexc || `${it.base}USDT`,
    url: (s, start) => `https://api.mexc.com/api/v3/klines?symbol=${s}&interval=5m&startTime=${start}&endTime=${start + 1000 * M5}&limit=1000`,
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

async function fetch5m(src, symbol, from, to) {
  const file = join(cacheDir, `${src.key}_${symbol}_5m.json`);
  let rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  if (rows.length && rows[0].t > from + H1) rows = []; // کش کوتاه‌تر از بازه است
  let start = rows.length ? rows.at(-1).t + M5 : from;
  let emptyStreak = 0;
  while (start < to - M5) {
    const body = await getJson(src.url(symbol, start));
    if (!Array.isArray(body)) throw new Error(body?.msg || 'پاسخِ نامعتبر');
    const batch = body.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
      .filter((k) => k.t >= start && k.t + M5 <= to && Number.isFinite(k.c));
    if (!batch.length) {
      // نماد هنوز لیست نشده بود: جلوتر برو
      if (++emptyStreak > 400) break;
      start += 1000 * M5;
      continue;
    }
    emptyStreak = 0;
    rows.push(...batch);
    start = batch.at(-1).t + M5;
    if (body.length < 2) break;
  }
  const seen = new Set();
  rows = rows.filter((k) => !seen.has(k.t) && seen.add(k.t)).sort((a, b) => a.t - b.t);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify(rows));
  return rows.filter((k) => k.t >= from);
}

const now = Math.floor(Date.now() / M5) * M5;
const fromT = now - days * 86_400_000;
const loadFrom = fromT - WARMUP_DAYS * 86_400_000;

const results = [];
const missing = [];
for (const item of items) {
  let data = null;
  const tried = [];
  for (const src of SOURCES) {
    const symbol = src.symbol(item);
    try {
      process.stdout.write(`${item.id.padEnd(10)} ${src.label} ${symbol} … `);
      const c5 = await fetch5m(src, symbol, loadFrom, now);
      if (c5.length < 30 * 288) {
        console.log(`فقط ${c5.length} کندل`);
        tried.push(`${src.label}: فقط ${c5.length} کندل`);
        continue;
      }
      console.log(`${c5.length} کندل از ${new Date(c5[0].t).toISOString().slice(0, 10)}`);
      // اگر این منبع تاریخچه‌ی کوتاه‌تری دارد (نمادِ تازه‌لیست‌شده)، منبعِ بعدی را هم ببین
      if (!data || c5[0].t < data.c5[0].t) data = { c5, exchange: src.label, symbol };
      if (c5[0].t <= loadFrom + 86_400_000) break;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      tried.push(`${src.label}: ${e.message}`);
    }
  }
  if (!data) {
    missing.push({ id: item.id, why: tried.join(' · ') });
    continue;
  }
  // دست‌کم ۳۰ روز برای ناحیه‌ها و گرم شدنِ RSI ِ ۴ ساعته
  const effFrom = Math.max(fromT, data.c5[0].t + 31 * 86_400_000);
  const bt = backtestRsi3(data.c5, effFrom, params);
  const covered = (now - effFrom) / 86_400_000;
  results.push({ item, ...data, ...bt, from: effFrom, coveredDays: covered });
}

// ── گزارشِ متنی
const p = { ...RSI3_DEFAULTS, ...params };
const all = results.flatMap((r) => r.trades.map((t) => ({ ...t, id: r.item.id })));
const fmt = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const row = (label, s) => `| ${label} | ${s.n} | ${s.n ? (s.winRate * 100).toFixed(0) + '%' : '—'} | ${fmt(s.totalR)} | ${s.n ? fmt(s.avgR) : '—'} | ${s.maxDD.toFixed(2)} |`;
const changed = Object.keys(params).length ? Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ') : 'پیش‌فرض';

const md = [];
md.push(`# بک‌تستِ اشباعِ سه‌تایم‌فریمی`, '');
md.push(`- بازه: ${days} روزِ اخیر تا ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
md.push(`- پارامترها: ${changed} (اشباعِ خرید ≤ ${p.oversold}، فروش ≥ ${p.overbought}، حداقلِ برخورد ${p.minTouches})`);
md.push(`- کارمزد ${p.feePct}% هر طرف از R کم شده. افتِ حداکثر بر حسبِ R است.`, '');
md.push('| نماد | معامله | برد | مجموع R | میانگین R | افتِ حداکثر R |', '|---|---|---|---|---|---|');
md.push(row('**همه**', stats(all)));
for (const r of results) md.push(row(`${r.item.id} (${r.exchange}${r.coveredDays < days - 1 ? `، ${r.coveredDays.toFixed(0)} روز` : ''})`, stats(r.trades)));
for (const m of missing) md.push(`| ${m.id} | داده نیامد | | | | |`);
md.push('', '## کدام شرط ستاپ‌ها را رد کرد', '');
md.push('ساعت‌ها: تعدادِ ساعت‌هایی که شرط دست‌کم در یک کندلِ ۵ دقیقه برقرار بود (خرید و فروش با هم).', '');
md.push('| نماد | RSI ۵د | +۱س | +۴س (هر سه) | از آن خرید | از آن فروش | +روی ناحیه | مسلح | لغوِ ۱۲س | باطل (رد از استاپ) | استاپ > ۲ATR | R:R < ۲ | بی‌تارگت | معامله |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const f = r.funnel;
  md.push(`| ${r.item.id} | ${f.hours5m} | ${f.hours5m1h} | ${f.hoursTriple} | ${f.tripleLong} | ${f.tripleShort} | ${f.hoursOnZone} | ${f.armed} | ${f.cancelTimeout} | ${f.cancelInvalid} | ${f.rejectStop} | ${f.rejectRR} | ${f.rejectNoTarget} | ${f.trades} |`);
}
if (missing.length) {
  md.push('', '## داده نیامد', '');
  for (const m of missing) md.push(`- ${m.id}: ${m.why}`);
}
if (all.length) {
  md.push('', '## معامله‌ها', '', '| نماد | جهت | ورود (UTC) | ورود | استاپ | TP1 | TP2 | R:R1 | نتیجه | R |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const t of [...all].sort((a, b) => a.t - b.t)) {
    md.push(`| ${t.id} | ${t.dir} | ${new Date(t.t).toISOString().slice(0, 16).replace('T', ' ')} | ${+t.entry.toPrecision(6)} | ${+t.sl.toPrecision(6)} | ${+t.tp1.toPrecision(6)} | ${+t.tp2.toPrecision(6)} | ${t.rr1.toFixed(2)} | ${t.outcome} | ${fmt(t.r)} |`);
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.md'), md.join('\n') + '\n');
const csvHead = 'symbol,dir,armed_utc,entry_utc,exit_utc,entry,sl,tp1,tp2,rr1,zone_lo,zone_hi,zone_touches,rsi5_arm,rsi1h_arm,rsi4h_arm,outcome,gross_r,fee_r,r';
const iso = (t) => new Date(t).toISOString();
writeFileSync(join(outDir, 'trades.csv'), [csvHead, ...all.sort((a, b) => a.t - b.t).map((t) => [
  t.id, t.dir, iso(t.armedT), iso(t.t), iso(t.exitT), t.entry, t.sl, t.tp1, t.tp2, t.rr1.toFixed(3),
  t.zone.lo, t.zone.hi, t.zone.touches, t.rsiAtArm.r5.toFixed(1), t.rsiAtArm.r1.toFixed(1), t.rsiAtArm.r4.toFixed(1),
  t.outcome, t.gross.toFixed(3), t.fee.toFixed(3), t.r.toFixed(3),
].join(','))].join('\n') + '\n');
writeFileSync(join(outDir, 'report.html'), buildHtml({ results, missing, params: p, changed, days, now, stats, all }));

console.log('\n' + md.slice(0, md.indexOf('## معامله‌ها') > 0 ? md.indexOf('## معامله‌ها') : md.length).join('\n'));
console.log(`\nخروجی: ${join(outDir, 'report.html')} · report.md · trades.csv`);
