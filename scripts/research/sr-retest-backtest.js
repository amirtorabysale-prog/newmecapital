/**
 * بک‌تستِ S7r — همان راه‌اندازیِ S7، ورود روی پولبک به سطحِ شکسته‌شده، با قانون‌های
 * کیفیتِ کندل و حجمِ برگشت. ۵ سال، 1h و 4h، داده‌ی بایننس (کش).
 * node scripts/research/sr-retest-backtest.js  ←  docs/research/07-sr-retest.md
 *
 * هیچ پارامتری بهینه نشده؛ آستانه‌ها قبل از اجرا اعلام شده‌اند. هر نسخه یک قانون را
 * به R0 اضافه می‌کند تا سهمِ هر قانون جدا دیده شود. یک پوزیشن در هر نماد/تایم‌فریم.
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

const RT = { entryMode: 'retest' };
const DET = {
  brk: {},
  r0: RT,
  hold: { ...RT, touchHold: true },
  strong: { ...RT, bounceStrong: true },
  vol15: { ...RT, bounceVolMult: 1.5 },
  full: { ...RT, touchHold: true, bounceStrong: true, bounceVolMult: 1.5 },
  full10: { ...RT, touchHold: true, bounceStrong: true, bounceVolMult: 1.0 },
};
const base = (s) => s.volOk && s.trendOk;
const VARIANTS = [
  ['FULL: R0 + all four rules (bounce vol ≥1.5x)', 'full', (s) => base(s) && s.breakStrong],
  ['S7 MAIN (entry on break close) — reference', 'brk', base],
  ['R0: retest entry (approved rules)', 'r0', base],
  ['R1: R0 + strong break candle', 'r0', (s) => base(s) && s.breakStrong],
  ['R2: R0 + touch candle closes back above level', 'hold', base],
  ['R3: R0 + strong bounce candle (separate)', 'strong', base],
  ['R4: R0 + bounce volume ≥1.5x', 'vol15', base],
  ['FULL-v1: FULL with bounce vol ≥1.0x', 'full10', (s) => base(s) && s.breakStrong],
  ['FULL-noBrkVol: FULL without break vol ≥2x', 'full', (s) => s.trendOk && s.breakStrong],
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
        if (s.ei <= busyUntil) continue;
        busyUntil = s.exit.j;
        list.push({ id: d.id, dir: s.dir, t: bars[s.ei].t + ms, exitT: bars[s.exit.j].t + ms, r: netR(s), why: s.exit.why,
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

const md = ['# S7r — پولبک به سطحِ شکسته‌شده با تأییدِ کندل و حجم: بک‌تستِ ۵ ساله', ''];
md.push(`- تاریخ: ${new Date().toISOString().slice(0, 10)} · داده: بایننس اسپات 1h (کش)، 4h و روزانه از تجمیعِ همان (روزِ UTC) · ${data.length} نماد${missing.length ? ` · بدونِ داده: ${missing.map((m) => m.id).join(', ')}` : ''}`);
md.push('- هزینه: کارمزد ۰.۱٪ + لغزش ۰.۰۵٪ هر طرف. ورود روی کلوزِ کندلِ تأییدِ برگشت (S7 MAIN: کلوزِ شکست). استاپ و تارگت در یک کندل ← استاپ.');
md.push(`- پارامترها: ${JSON.stringify(SR_DEFAULTS)}`);
md.push('- هیچ پارامتری بهینه نشده؛ نسخه‌ها از پیش اعلام شده‌اند. یک پوزیشن در هر نماد/تایم‌فریم.', '');
for (const [tf] of TFS) {
  md.push(`## ${tf}`, '', HEAD);
  for (const [name] of VARIANTS) md.push(row(name, stats(results[tf][name])));
  const main = results[tf][VARIANTS[0][0]];
  md.push('', `**FULL جدا:**`, '', HEAD,
    row('خرید', stats(main.filter((t) => t.dir === 'long'))),
    row('فروش', stats(main.filter((t) => t.dir === 'short'))));
  md.push('', '**FULL سال‌به‌سال:**', '', HEAD);
  for (const [y, tr] of byYear(main)) md.push(row(String(y), stats(tr)));
  const pf = portfolio(main, { riskPct: 1 });
  if (pf) md.push('', `سبد با ریسکِ ۱٪: سالانه ${fmt(pf.annualPct, 1)}٪ · افتِ حداکثر ${pf.maxDDPct.toFixed(1)}٪ · شارپ ${pf.sharpe.toFixed(2)} · معامله در ماه ${pf.tradesPerMonth.toFixed(1)} · هم‌زمانِ حداکثر ${pf.maxOpen}`);
  const perSym = new Map();
  for (const t of main) perSym.set(t.id, (perSym.get(t.id) || 0) + t.r);
  const pos = [...perSym.values()].filter((v) => v > 0).length;
  md.push(`نمادهای مثبت در FULL: ${pos} از ${perSym.size}`, '');
}
writeFileSync('docs/research/07-sr-retest.md', md.join('\n'));
console.log(md.join('\n'));
