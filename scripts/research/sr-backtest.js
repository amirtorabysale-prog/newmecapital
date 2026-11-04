/**
 * بک‌تستِ S7 (شکستِ برخوردِ سوم با حجم) — ۵ سال، 1h و 4h، داده‌ی بایننس (کش).
 * node scripts/research/sr-backtest.js
 * خروجی: docs/research/06-sr-break.md
 *
 * هیچ پارامتری بهینه نشده؛ همه‌ی نسخه‌ها از پیش اعلام شده‌اند (docs/STRATEGIES.md).
 * هر نماد/تایم‌فریم در هر لحظه حداکثر یک پوزیشن (سیگنالِ وسطِ پوزیشنِ باز نادیده).
 */
import { writeFileSync } from 'node:fs';
import { detect, netR, SR_DEFAULTS } from '../../src/strategy/srBreak.js';
import { loadUniverse, portfolio, byYear, DAY, H1, fmt, pct } from './lib.js';

const BASES = ['BTC', 'SOL', 'AVAX', 'AAVE', 'HYPE', 'NEAR', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'LINK', 'DOT', 'LTC', 'BCH', 'ATOM',
  'UNI', 'FIL', 'TRX', 'ETC', 'XLM', 'INJ', 'OP', 'ARB', 'APT', 'SUI', 'TON', 'HBAR'];
const ITEMS = [...BASES.map((b) => ({ id: `${b}USDT`, base: b })), { id: 'XAUUSD', base: 'XAU', binance: 'PAXGUSDT' }];

const { data, missing } = await loadUniverse(ITEMS, { years: 5, warmupDays: 60 });
console.log(`loaded ${data.length} · missing ${missing.map((m) => m.id).join(', ') || '—'}`);

function aggregate(c1h, ms) {
  const out = [];
  let cur = null;
  for (const k of c1h) {
    const t = Math.floor(k.t / ms) * ms;
    if (!cur || cur.t !== t) {
      if (cur && cur.n === ms / H1) out.push(cur);
      cur = { t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, n: 1 };
    } else {
      cur.h = Math.max(cur.h, k.h); cur.l = Math.min(cur.l, k.l); cur.c = k.c; cur.v += k.v; cur.n++;
    }
  }
  if (cur && cur.n === ms / H1) out.push(cur);
  return out;
}

const DET = {
  main: {},
  any: { priorTouches: 1, touchMode: 'min' },
  t3: { priorTouches: 3 },
  t4: { priorTouches: 4 },
  minStop: { minStopAtr: 1 },
};
const VARIANTS = [
  ['MAIN: 3rd-touch + vol≥2x + daily trend', 'main', (s) => s.volOk && s.trendOk],
  ['A: without volume filter', 'main', (s) => s.trendOk],
  ['B: any swing-level break (no touch count)', 'any', (s) => s.volOk && s.trendOk],
  ['C: 4th-touch break (3 prior)', 't3', (s) => s.volOk && s.trendOk],
  ['D: 5th-touch break (4 prior)', 't4', (s) => s.volOk && s.trendOk],
  ['E: without trend filter', 'main', (s) => s.volOk],
  ['F: volume ≥3x', 'main', (s) => s.volX >= 3 && s.trendOk],
  ['G: MAIN + skip if close >1.5 ATR past level', 'main', (s) => s.volOk && s.trendOk && s.breakDistAtr <= 1.5],
  ['H: MAIN + min stop 1 ATR', 'minStop', (s) => s.volOk && s.trendOk],
  ['I: MAIN + G + H', 'minStop', (s) => s.volOk && s.trendOk && s.breakDistAtr <= 1.5],
  ['RAW: 3rd-touch, no volume, no trend', 'main', () => true],
  ['RAW-any: any swing-level break, no filters', 'any', () => true],
];

const TFS = [['1h', H1], ['4h', 4 * H1]];
const results = {}; // tf → variant → trades
const t0 = Date.now();
for (const d of data) {
  const daily = aggregate(d.candles, DAY);
  for (const [tf, ms] of TFS) {
    const bars = tf === '1h' ? d.candles : aggregate(d.candles, ms);
    const det = {};
    for (const [k, over] of Object.entries(DET)) det[k] = detect(bars, daily, ms, { ...SR_DEFAULTS, ...over });
    for (const [name, dk, f] of VARIANTS) {
      let busyUntil = -1;
      const list = ((results[tf] ??= {})[name] ??= []);
      for (const s of det[dk]) {
        if (bars[s.i].t < d.startT || !s.exit || !f(s)) continue;
        if (s.i <= busyUntil) continue;
        busyUntil = s.exit.j;
        list.push({ id: d.id, dir: s.dir, t: bars[s.i].t + ms, exitT: bars[s.exit.j].t + ms, r: netR(s), why: s.exit.why,
          dist: s.breakDistAtr, riskPct: Math.abs(s.entry - s.stop) / s.entry * 100 });
      }
    }
  }
  console.log(`${d.id} done (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

function stats(tr) {
  const n = tr.length;
  if (!n) return { n: 0 };
  const wins = tr.filter((t) => t.r > 0);
  const gw = wins.reduce((s, t) => s + t.r, 0);
  const gl = -tr.filter((t) => t.r <= 0).reduce((s, t) => s + t.r, 0);
  const sorted = [...tr].sort((a, b) => a.exitT - b.exitT);
  let eq = 0; let pk = 0; let dd = 0;
  for (const t of sorted) { eq += t.r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return { n, win: wins.length / n, avgR: eq / n, pf: gl ? gw / gl : Infinity, totalR: eq, ddR: dd,
    tgt: tr.filter((t) => t.why === 'target').length / n, medRisk: [...tr].map((t) => t.riskPct).sort((a, b) => a - b)[Math.floor(n / 2)] };
}
const row = (label, s) => (s.n
  ? `| ${label} | ${s.n} | ${pct(s.win)} | ${pct(s.tgt)} | ${fmt(s.avgR, 3)} | ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞'} | ${fmt(s.totalR, 1)} | ${s.ddR.toFixed(1)} | ${s.medRisk.toFixed(2)}% |`
  : `| ${label} | 0 | — | — | — | — | — | — | — |`);
const HEAD = '| نسخه | معامله | وین‌ریت | تارگتِ 2R | امید R | PF | مجموع R | افتِ حداکثر R | میانه‌ی ریسک٪ |\n|---|---|---|---|---|---|---|---|---|';

const md = ['# S7 — شکستِ برخوردِ سوم با حجم: بک‌تستِ ۵ ساله', ''];
md.push(`- تاریخ: ${new Date().toISOString().slice(0, 10)} · داده: بایننس اسپات 1h (کش)، 4h و روزانه از تجمیعِ همان (روزِ UTC) · ${data.length} نماد${missing.length ? ` · بدونِ داده: ${missing.map((m) => m.id).join(', ')}` : ''}`);
md.push('- هزینه: کارمزد ۰.۱٪ + لغزش ۰.۰۵٪ هر طرف. ورود روی کلوزِ کندلِ شکست. استاپ و تارگت در یک کندل ← استاپ.');
md.push(`- پارامترها: ${JSON.stringify(SR_DEFAULTS)}`);
md.push('- هیچ پارامتری بهینه نشده؛ نسخه‌ها از پیش اعلام شده‌اند. یک پوزیشن در هر نماد/تایم‌فریم.', '');
for (const [tf] of TFS) {
  md.push(`## ${tf}`, '', HEAD);
  for (const [name] of VARIANTS) md.push(row(name, stats(results[tf][name])));
  const main = results[tf][VARIANTS[0][0]];
  md.push('', `**MAIN جدا:**`, '', HEAD,
    row('خرید', stats(main.filter((t) => t.dir === 'long'))),
    row('فروش', stats(main.filter((t) => t.dir === 'short'))));
  md.push('', '**MAIN سال‌به‌سال:**', '', HEAD);
  for (const [y, tr] of byYear(main)) md.push(row(String(y), stats(tr)));
  const pf = portfolio(main, { riskPct: 1 });
  if (pf) md.push('', `سبد با ریسکِ ۱٪: سالانه ${fmt(pf.annualPct, 1)}٪ · افتِ حداکثر ${pf.maxDDPct.toFixed(1)}٪ · شارپ ${pf.sharpe.toFixed(2)} · معامله در ماه ${pf.tradesPerMonth.toFixed(1)} · هم‌زمانِ حداکثر ${pf.maxOpen}`);
  const perSym = new Map();
  for (const t of main) perSym.set(t.id, (perSym.get(t.id) || 0) + t.r);
  const pos = [...perSym.values()].filter((v) => v > 0).length;
  md.push(`نمادهای مثبت در MAIN: ${pos} از ${perSym.size}`, '');
}
writeFileSync('docs/research/06-sr-break.md', md.join('\n'));
console.log(md.join('\n'));
