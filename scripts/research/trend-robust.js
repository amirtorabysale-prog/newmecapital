/**
 * تلاش برای شکستنِ خانواده‌ی C («بالای EMA بمان»): همه‌ی گونه‌ها پیش از اجرا
 * فهرست شده‌اند. هر گونه روی داخل، خارج، جهان (۲۰ نمادِ دیگر) و همه‌ی ۲۸ نماد.
 * به‌علاوه‌ی walk-forward، اکسپوژرِ سرمایه، و جدولِ هر نماد.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { pbStats } from '../../src/strategy/pullback.js';
import { loadUniverse, EXTRA_UNIVERSE, portfolio, byYear, DAY, fmt } from './lib.js';
import { prep, FAMILIES, run, COST } from './engine.js';

const cfg = loadConfig();
const now = Math.floor(Date.now() / DAY) * DAY;
const splitT = now - 365 * DAY;
const W = (await loadUniverse(cfg.watchlist, { years: 5, warmupDays: 60 })).data.map(prep);
const X = (await loadUniverse(EXTRA_UNIVERSE, { years: 5, warmupDays: 60 })).data.map(prep);
const ALL = [...W, ...X];

// رژیمِ بیت‌کوین برای فیلترِ «فقط وقتی BTC صعودی است»
const btc = W.find((x) => x.id === 'BTCUSD');
const btcUp = new Map(btc.b.map((k, i) => [k.t, btc.c[i] > btc.ema[50][i]]));

const C = FAMILIES.C;
const crossUp = (x, i, n) => Number.isFinite(x.ema[n][i]) && x.c[i] > x.ema[n][i] && x.c[i - 1] <= x.ema[n][i - 1];
const crossDn = (x, i, n) => Number.isFinite(x.ema[n][i]) && x.c[i] < x.ema[n][i] && x.c[i - 1] >= x.ema[n][i - 1];
const V = [
  ['پایه: EMA50، استاپِ فاجعه ۳ATR', C, { n: 50 }],
  ['EMA20', C, { n: 20 }],
  ['EMA100', C, { n: 100 }],
  ['EMA200', C, { n: 200 }],
  ['هزینه ×۲ (کارمزد ۰.۱۵٪، لغزش ۰.۱٪)', C, { n: 50 }, { feePct: 0.15, slippagePct: 0.1 }],
  ['ورود یک روز دیرتر', { ...C, entry: (x, i, p) => (i > 1 && crossUp(x, i - 1, p.n) && x.c[i] > x.ema[p.n][i] ? 'long' : null) }, { n: 50 }],
  ['استاپِ فاجعه ۲ATR', { ...C, stop0: (x, i) => x.c[i] - 2 * x.atr[i] }, { n: 50 }],
  ['استاپِ فاجعه ۴ATR', { ...C, stop0: (x, i) => x.c[i] - 4 * x.atr[i] }, { n: 50 }],
  ['فیلترِ BTC بالای EMA50', { ...C, entry: (x, i, p) => (crossUp(x, i, p.n) && btcUp.get(x.b[i].t) ? 'long' : null) }, { n: 50 }],
  ['سیوِ ۵۰٪ در ۲R + سربه‌سر', { ...C, partial: () => ({ atR: 2, w: 0.5, be: true }) }, { n: 50 }],
  ['سیوِ ۳۳٪ در ۱R + سربه‌سر', { ...C, partial: () => ({ atR: 1, w: 1 / 3, be: true }) }, { n: 50 }],
  ['خروج با استاپِ متحرکِ ۳ATR به‌جای EMA', { ...C, exitNow: () => false, trail: (x, i, pos) => pos.best - 3 * x.atr[i] }, { n: 50 }],
  ['دوطرفه (فروش زیرِ EMA — فقط فیوچرز)', {
    ...C,
    entry: (x, i, p) => (crossUp(x, i, p.n) ? 'long' : crossDn(x, i, p.n) ? 'short' : null),
    stop0: (x, i, dir) => x.c[i] - (dir === 'long' ? 3 : -3) * x.atr[i],
    exitNow: (x, i, pos, p) => (pos.dir === 'long' ? x.c[i] < x.ema[p.n][i] : x.c[i] > x.ema[p.n][i]),
  }, { n: 50 }],
];

const W0 = Math.min(...W.map((x) => x.startT));
const X0 = Math.min(...X.map((x) => x.startT));
function block(fam, p, cost) {
  const is = run(fam, p, W, null, 0, splitT, cost);
  const oos = run(fam, p, W, null, splitT, now + DAY, cost);
  const ext = run(fam, p, X, null, 0, now + DAY, cost);
  return {
    is: pbStats(is), oos: pbStats(oos), ext: pbStats(ext), all: pbStats([...is, ...oos, ...ext]),
    pIS: portfolio(is, { from: W0, to: splitT }), pOOS: portfolio(oos, { from: splitT, to: now }), pEXT: portfolio(ext, { from: X0, to: now }),
    trades: { is, oos, ext },
  };
}

const md = ['# پایداریِ خانواده‌ی C — «بالای EMA بمان» (روزانه، فقط خرید)', ''];
md.push('- هر خانه: امیدِ R در هر معامله / شارپِ سبد (ریسکِ ۱٪ در هر معامله). کارمزد ۰.۱٪ و لغزش ۰.۰۵٪ هر طرف، مگر خلافش گفته شود.', '');
md.push('| گونه | داخل (واچ‌لیست) | خارج (سالِ آخر) | جهان (۲۰ نماد) | همه‌ی ۲۸: n / وین‌ریت / امید / PF |', '|---|---|---|---|---|');
const results = [];
for (const [label, fam, p, cost] of V) {
  const b = block(fam, p, cost || COST);
  results.push({ label, ...b });
  const cell = (s, pf) => `${fmt(s.avgR, 3)} / ${pf ? pf.sharpe.toFixed(2) : '—'}`;
  md.push(`| ${label} | ${cell(b.is, b.pIS)} | ${cell(b.oos, b.pOOS)} | ${cell(b.ext, b.pEXT)} | ${b.all.n} / ${(b.all.winRate * 100).toFixed(0)}% / ${fmt(b.all.avgR, 3)} / ${b.all.pf.toFixed(2)} |`);
}

// ── walk-forward: هر ۶ ماه، EMA ِ با بهترین شارپ در ۲ سالِ قبل (فقط واچ‌لیست) انتخاب و ۶ ماهِ بعد روی واچ‌لیست و جهان اجرا می‌شود
md.push('', '## walk-forward (آموزش ۲ سال روی واچ‌لیست، آزمون ۶ ماهِ بعد)', '', '| آزمون از | EMA انتخاب‌شده | واچ‌لیست: n / امید R | جهان: n / امید R |', '|---|---|---|---|');
const wfW = []; const wfX = [];
for (let t = W0 + 2 * 365 * DAY; t < now; t += 182 * DAY) {
  const cand = [20, 50, 100, 200].map((n) => {
    const tr = run(C, { n }, W, null, t - 2 * 365 * DAY, t);
    return { n, sh: portfolio(tr, { from: t - 2 * 365 * DAY, to: t })?.sharpe ?? -9 };
  });
  const best = cand.reduce((a, b) => (b.sh > a.sh ? b : a));
  const end = Math.min(now + DAY, t + 182 * DAY);
  const tw = run(C, { n: best.n }, W, null, t, end);
  const tx = run(C, { n: best.n }, X, null, t, end);
  wfW.push(...tw); wfX.push(...tx);
  const sw = pbStats(tw); const sx = pbStats(tx);
  md.push(`| ${new Date(t).toISOString().slice(0, 10)} | ${best.n} | ${sw.n} / ${fmt(sw.avgR, 3)} | ${sx.n} / ${fmt(sx.avgR, 3)} |`);
}
const sWW = pbStats(wfW); const sWX = pbStats(wfX);
md.push(`| **جمع** | | ${sWW.n} / ${fmt(sWW.avgR, 3)} (PF ${sWW.pf.toFixed(2)}) | ${sWX.n} / ${fmt(sWX.avgR, 3)} (PF ${sWX.pf.toFixed(2)}) |`);

// ── اکسپوژر: با ریسکِ ۱٪، حجمِ هر معامله = ۱٪ ÷ (ریسک ÷ قیمت)
const base = results[0];
const wTrades = [...base.trades.is, ...base.trades.oos];
const ev = wTrades.flatMap((t) => { const n = 0.01 / (t.risk / t.entry); return [[t.t, n], [t.exitT, -n]]; }).sort((a, b) => a[0] - b[0]);
let ex = 0; let maxEx = 0; let area = 0; let lastT = ev[0][0];
for (const [tt, d] of ev) { area += ex * (tt - lastT); lastT = tt; ex += d; maxEx = Math.max(maxEx, ex); }
const avgEx = area / (ev.at(-1)[0] - ev[0][0]);
const notional = wTrades.map((t) => 0.01 / (t.risk / t.entry));
md.push('', '## اکسپوژرِ سرمایه (پایه، واچ‌لیست، ریسکِ ۱٪ در هر معامله)', '');
md.push(`- حجمِ هر معامله: میانه ${(notional.sort((a, b) => a - b)[Math.floor(notional.length / 2)] * 100).toFixed(0)}٪ سرمایه · میانگینِ کلِ اکسپوژر در طولِ زمان ${(avgEx * 100).toFixed(0)}٪ · بیشترین ${(maxEx * 100).toFixed(0)}٪`);
md.push(`- بیشترین تعدادِ معامله‌ی هم‌زمان: ${base.pIS?.maxOpen} (داخل) / ${base.pOOS?.maxOpen} (خارج)`);

// ── سال‌به‌سال و هر نماد (پایه)
md.push('', '## سال‌به‌سال (پایه، همه‌ی ۲۸ نماد)', '', '| سال | n | وین‌ریت | امید R | مجموع R |', '|---|---|---|---|---|');
const allBase = [...base.trades.is, ...base.trades.oos, ...base.trades.ext];
for (const [y, g] of byYear(allBase)) { const s = pbStats(g); md.push(`| ${y} | ${s.n} | ${(s.winRate * 100).toFixed(0)}% | ${fmt(s.avgR, 3)} | ${fmt(s.totalR, 1)} |`); }
md.push('', '## هر نماد (پایه، کلِ دوره)', '', '| نماد | n | وین‌ریت | امید R | مجموع R | بزرگ‌ترین برد R |', '|---|---|---|---|---|---|');
let pos = 0;
for (const x of ALL) {
  const g = allBase.filter((t) => t.id === x.id);
  const s = pbStats(g);
  if (s.totalR > 0) pos++;
  md.push(`| ${x.id}${W.includes(x) ? ' ★' : ''} | ${s.n} | ${(s.winRate * 100).toFixed(0)}% | ${fmt(s.avgR, 3)} | ${fmt(s.totalR, 1)} | ${g.length ? Math.max(...g.map((t) => t.r)).toFixed(1) : '—'} |`);
}
md.push('', `نمادهای با مجموعِ مثبت: ${pos} از ${ALL.length} (★ = واچ‌لیست)`);
// وابستگی به چند معامله‌ی بزرگ: بدونِ ۵٪ ِ بهترین معامله‌ها
const sorted = [...allBase].sort((a, b) => b.r - a.r);
const cut = Math.ceil(sorted.length * 0.05);
const rest = pbStats(sorted.slice(cut));
md.push(`- بدونِ ${cut} معامله‌ی برتر (۵٪): امید ${fmt(rest.avgR, 3)}R، مجموع ${fmt(rest.totalR, 1)}R — این استراتژی از چند روندِ بزرگ پول می‌سازد.`);

mkdirSync(join('out', 'research'), { recursive: true });
writeFileSync(join('out', 'research', 'trend-robust.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
