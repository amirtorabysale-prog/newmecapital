/**
 * بک‌تستِ «پولبکِ اشباع در جهتِ روند» (src/strategy/pullback.js) با روشِ
 * داخلِ نمونه / خارجِ نمونه:
 *
 *   ۱. داده: کندلِ یک ساعته‌ی `--years` سالِ اخیر (پیش‌فرض ۵).
 *   ۲. داخلِ نمونه = همه به‌جز `--oos-days` روزِ آخر (پیش‌فرض ۳۶۵).
 *      یک شبکه‌ی کوچک و از پیش اعلام‌شده از پارامترها روی همین بخش اجرا می‌شود.
 *   ۳. قاعده‌ی انتخاب (پیش از دیدنِ نتیجه): بینِ ترکیب‌هایی با دست‌کم ۱۰۰
 *      معامله و وین‌ریت ≥ ۸۰٪، بیشترین میانگینِ R. اگر هیچ‌کدام به ۸۰٪ نرسید،
 *      بیشترین میانگینِ R بینِ همه — و گزارش می‌گوید که ۸۰٪ به دست نیامد.
 *   ۴. ترکیبِ انتخاب‌شده فقط یک بار روی خارجِ نمونه سنجیده می‌شود.
 *   ۵. آزمونِ فشار روی کلِ دوره: لغزش و کارمزدِ بیشتر، استاپ و تارگتِ ۵۰ تا
 *      ۱۵۰٪، و سال‌به‌سال.
 *
 *   npm run backtest:pullback
 *   npm run backtest:pullback -- --years 3 --set directions='["long"]'
 *   npm run backtest:pullback -- --tf 4h     ماشه‌ی ۴ ساعته، روندِ روزانه (همه‌چیز ×۴)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, parseSymbol } from '../src/config.js';
import { backtestPullback, pbStats, PULLBACK_DEFAULTS } from '../src/strategy/pullback.js';
import { aggregate, H4 } from '../src/strategy/rsi3.js';
import { loadHistory } from './lib/history.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const DAY = 86_400_000;
const tf = args.includes('--tf') ? args[args.indexOf('--tf') + 1] : '1h';
if (!['1h', '4h'].includes(tf)) throw new Error('--tf فقط 1h یا 4h');
// نسخه‌ی ۴ ساعته: همه‌ی زمان‌ها ×۴، روند با EMA50 ِ روزانه. پیش از اجرا اعلام شده.
const base = tf === '4h' ? { baseMs: H4, trendMs: DAY, trendEma: 50, armHours: 48, maxHoldHours: 192 } : {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [key, ...rest] = args[i + 1].split('=');
  if (!(key in PULLBACK_DEFAULTS)) throw new Error(`پارامترِ ناشناخته: ${key}`);
  base[key] = JSON.parse(rest.join('='));
}
const years = Number(opt('years', 5));
const oosDays = Number(opt('oos-days', 365));
const outDir = opt('out', join('out', tf === '4h' ? 'pullback-4h' : 'pullback'));
const VALUE_FLAGS = ['--years', '--oos-days', '--set', '--out', '--tf'];
const names = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
const cfg = loadConfig();
const items = names.length
  ? names.map((n) => cfg.watchlist.find((w) => w.base === parseSymbol(n).base) || parseSymbol(n))
  : cfg.watchlist;

// ۱h: EMA200 ِ ۴ ساعته ≈ ۳۴ روز + ۳۰ روز ناحیه · ۴h: EMA50 ِ روزانه + ۳۰ روز ناحیه
const WARMUP_DAYS = tf === '4h' ? 90 : 60;
const now = Math.floor(Date.now() / 3_600_000) * 3_600_000;
const splitT = now - oosDays * DAY;
const loadFrom = now - years * 365 * DAY - WARMUP_DAYS * DAY;

// ── داده
const data = [];
const missing = [];
for (const item of items) {
  const res = await loadHistory(item, '1h', loadFrom, now, { log: (m) => console.log(m) });
  if (res.error) { missing.push({ id: item.id, why: res.error }); continue; }
  const startT = res.candles[0].t + WARMUP_DAYS * DAY;
  if (startT >= now - 30 * DAY) { missing.push({ id: item.id, why: 'تاریخچه کوتاه‌تر از گرم‌کردن' }); continue; }
  data.push({ item, ...res, candles: tf === '4h' ? aggregate(res.candles, H4) : res.candles, startT });
}

function run(params, from, to) {
  const all = [];
  const per = [];
  for (const d of data) {
    const bt = backtestPullback(d.candles, Math.max(from, d.startT), to, { ...base, ...params });
    const tr = bt.trades.map((t) => ({ ...t, id: d.item.id }));
    per.push({ id: d.item.id, trades: tr, funnel: bt.funnel });
    all.push(...tr);
  }
  return { all, per, stats: pbStats(all) };
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '∞');
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const statRow = (label, s) => `| ${label} | ${s.n} | ${s.n ? pct(s.winRate) : '—'} | ${s.avgWin.toFixed(2)} | ${s.avgLoss.toFixed(2)} | ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞'} | ${fmt(s.avgR, 3)} | ${fmt(s.totalR, 1)} | ${s.maxDD.toFixed(1)} |`;
const HEAD = '| | معامله | وین‌ریت | میانگینِ برد R | میانگینِ باخت R | PF | امید (R/معامله) | مجموع R | افتِ حداکثر R |\n|---|---|---|---|---|---|---|---|---|';
const md = [];
const say = (...l) => { md.push(...l); };

const firstT = Math.min(...data.map((d) => d.startT));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
say(`# بک‌تستِ پولبکِ اشباع در جهتِ روند — ماشه‌ی ${tf}`, '');
say(`- داخلِ نمونه: ${iso(firstT)} تا ${iso(splitT)} · خارجِ نمونه: ${iso(splitT)} تا ${iso(now)}`);
say(`- نمادها: ${data.map((d) => `${d.item.id} (${d.exchange}، از ${iso(d.startT)})`).join('، ')}`);
if (missing.length) say(`- داده نیامد: ${missing.map((m) => `${m.id} — ${m.why}`).join('؛ ')}`);
say(`- کارمزد ${PULLBACK_DEFAULTS.feePct}% و لغزش ${PULLBACK_DEFAULTS.slippagePct}% هر طرف کم شده. برد = R ِ خالص > ۰. اگر استاپ و تارگت در یک کندل لمس شوند، استاپ حساب می‌شود.`);
if (Object.keys(base).length) say(`- تغییرِ ثابت: ${JSON.stringify(base)}`);
say('');

// ── ۱. شبکه روی داخلِ نمونه
const grid = [];
for (const rsiLevel of [25, 30]) for (const tpAtr of [0.75, 1, 1.5]) for (const zoneFilter of [false, true]) grid.push({ rsiLevel, tpAtr, zoneFilter });
const label = (g) => `RSI≤${g.rsiLevel} · TP ${g.tpAtr}ATR · ناحیه ${g.zoneFilter ? 'بله' : 'خیر'}`;
const isRuns = grid.map((g) => ({ g, ...run(g, 0, splitT) }));
say('## ۱. شبکه‌ی پارامتر — فقط داخلِ نمونه', '', HEAD.replace('| |', '| ترکیب |'));
for (const x of isRuns) say(statRow(label(x.g), x.stats));
const eligible = isRuns.filter((x) => x.stats.n >= 100 && x.stats.winRate >= 0.8);
const pool = eligible.length ? eligible : isRuns.filter((x) => x.stats.n >= 100);
const chosen = (pool.length ? pool : isRuns).reduce((b, x) => (x.stats.avgR > b.stats.avgR ? x : b));
say('', eligible.length
  ? `**انتخاب (قاعده‌ی از پیش اعلام‌شده):** ${label(chosen.g)} — بیشترین امید بینِ ${eligible.length} ترکیبِ با وین‌ریتِ ≥ ۸۰٪.`
  : `**هیچ ترکیبی در داخلِ نمونه به وین‌ریتِ ۸۰٪ با دست‌کم ۱۰۰ معامله نرسید.** بهترین امید: ${label(chosen.g)}.`, '');

// ── ۲. خارجِ نمونه
const oos = run(chosen.g, splitT, now);
say('## ۲. ترکیبِ انتخاب‌شده: داخل و خارجِ نمونه', '', HEAD);
say(statRow('داخلِ نمونه', chosen.stats), statRow('**خارجِ نمونه**', oos.stats));
for (const dir of ['long', 'short']) {
  say(statRow(`  داخل — ${dir === 'long' ? 'خرید' : 'فروش'}`, pbStats(chosen.all.filter((t) => t.dir === dir))));
  say(statRow(`  خارج — ${dir === 'long' ? 'خرید' : 'فروش'}`, pbStats(oos.all.filter((t) => t.dir === dir))));
}
say('');
say('### هر نماد — خارجِ نمونه', '', HEAD.replace('| |', '| نماد |'));
for (const p of oos.per) say(statRow(p.id, pbStats(p.trades)));
say('');

// ── ۳. سال‌به‌سال (کلِ دوره، ترکیبِ انتخاب‌شده)
const full = run(chosen.g, 0, now);
say('## ۳. سال‌به‌سال (کلِ دوره)', '', HEAD.replace('| |', '| سال |'));
const byYear = new Map();
for (const t of full.all) {
  const y = new Date(t.t).getUTCFullYear();
  if (!byYear.has(y)) byYear.set(y, []);
  byYear.get(y).push(t);
}
for (const [y, list] of [...byYear].sort((a, b) => a[0] - b[0])) say(statRow(String(y), pbStats(list)));
say('');

// ── ۴. آزمونِ فشار (کلِ دوره)
say('## ۴. آزمونِ فشار (کلِ دوره، ترکیبِ انتخاب‌شده)', '', HEAD.replace('| |', '| حالت |'));
say(statRow('پایه', full.stats));
const stress = [
  ['لغزش ×۲ (۰.۱٪)', { slippagePct: 0.1 }],
  ['لغزش ×۲ و کارمزد ×۱.۵', { slippagePct: 0.1, feePct: 0.15 }],
  ['بدونِ هزینه (فقط برای مقایسه)', { slippagePct: 0, feePct: 0 }],
];
for (const m of [0.5, 0.75, 1.25, 1.5]) stress.push([`تارگت ×${m}`, { tpAtr: chosen.g.tpAtr * m }]);
for (const m of [0.5, 0.75, 1.25, 1.5]) stress.push([`استاپ ×${m}`, { slBufferAtr: PULLBACK_DEFAULTS.slBufferAtr * m, minStopAtr: PULLBACK_DEFAULTS.minStopAtr * m, maxStopAtr: PULLBACK_DEFAULTS.maxStopAtr * m }]);
stress.push(['ورود با RSI ± ۵: سطحِ ' + (chosen.g.rsiLevel - 5), { rsiLevel: chosen.g.rsiLevel - 5 }]);
stress.push(['ورود با RSI ± ۵: سطحِ ' + (chosen.g.rsiLevel + 5), { rsiLevel: chosen.g.rsiLevel + 5 }]);
stress.push([`روند با EMA${(base.trendEma || PULLBACK_DEFAULTS.trendEma) / 2}`, { trendEma: (base.trendEma || PULLBACK_DEFAULTS.trendEma) / 2 }]);
const stressOut = [];
for (const [name, extra] of stress) {
  const s = run({ ...chosen.g, ...extra }, 0, now).stats;
  stressOut.push({ name, s });
  say(statRow(name, s));
}
say('', `معامله‌هایی که استاپ و تارگت در یک کندل لمس شد و استاپ حساب شد: ${full.stats.ambiguous} از ${full.stats.n}.`, '');

// ── قیف
say('## ۵. قیفِ ستاپ‌ها (کلِ دوره)', '', '| نماد | مسلح | لغو (پایانِ مهلت) | روند برگشت | استاپ > ۳ATR | بدونِ ناحیه | معامله |', '|---|---|---|---|---|---|---|');
for (const p of full.per) {
  const f = p.funnel;
  say(`| ${p.id} | ${f.armed} | ${f.timeout} | ${f.trendFlip} | ${f.rejectStop} | ${f.rejectZone} | ${f.trades} |`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.md'), md.join('\n') + '\n');
const csv = ['symbol,dir,sample,armed_utc,entry_utc,exit_utc,entry,sl,tp,risk_atr,rsi_at_arm,exit,why,ambiguous,gross_r,r'];
for (const t of [...full.all].sort((a, b) => a.t - b.t)) {
  csv.push([t.id, t.dir, t.t < splitT ? 'IS' : 'OOS', new Date(t.armedT).toISOString(), new Date(t.t).toISOString(),
    new Date(t.exitT).toISOString(), t.entry, t.sl, t.tp, t.riskAtr.toFixed(2), t.rsiAtArm.toFixed(1), t.exitPx, t.why,
    t.ambiguous ? 1 : 0, t.gross.toFixed(3), t.r.toFixed(3)].join(','));
}
writeFileSync(join(outDir, 'trades.csv'), csv.join('\n') + '\n');
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({
  chosen: chosen.g, inSample: chosen.stats, outOfSample: oos.stats, full: full.stats,
  stress: stressOut, years: [...byYear.keys()].length, firstT, splitT, now,
  // میانگینِ برد و باخت بر حسبِ درصدِ قیمت — برای اسکریپتِ ارزیابیِ backtest-expert
  pctStats: (() => {
    const w = full.all.filter((t) => t.r > 0);
    const l = full.all.filter((t) => t.r <= 0);
    const m = (arr) => (arr.length ? arr.reduce((s, t) => s + Math.abs(t.r * t.risk / t.entry), 0) / arr.length * 100 : 0);
    return { avgWinPct: m(w), avgLossPct: m(l) };
  })(),
}, null, 2));
console.log('\n' + md.join('\n'));
console.log(`\nخروجی: ${join(outDir, 'report.md')} · trades.csv · summary.json`);
