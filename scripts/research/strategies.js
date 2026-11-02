/**
 * آزمونِ سطحِ استراتژی روی کندلِ روزانه، با خروج‌های واقعی (استاپِ اولیه،
 * استاپِ متحرک، خروجِ قاعده‌ای و زمانی)، کارمزد و لغزش.
 *
 * چهار خانواده، هر کدام با شبکه‌ی کوچکِ از پیش اعلام‌شده:
 *   A. دنبال کردنِ روند با شکستِ دانچیان و استاپِ متحرکِ ATR
 *   B. برگشت به میانگینِ روزانه (RSI ِ خیلی پایین)
 *   C. رژیم: تا وقتی قیمت بالای EMA است در بازار بمان
 *   D. مومنتومِ مقطعی: هر هفته قوی‌ترین نمادهای جهان را بخر
 *
 * انتخاب فقط روی «داخل» (واچ‌لیست تا ۳۶۵ روز پیش): بیشترین شارپِ سبد با
 * دست‌کم ۵۰ معامله. سپس یک بار روی «خارج» (سالِ آخر) و «جهان» (۲۰ نمادِ
 * دیگر، کلِ دوره، که در انتخاب هیچ نقشی نداشتند).
 *
 * ورود: کلوزِ روزانه (۰۰:۰۰ UTC). استاپ روی high/low ِ روزهای بعد سنجیده
 * می‌شود؛ استاپِ متحرک با کلوزِ هر روز به‌روز و از روزِ بعد اعمال می‌شود.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { pbStats } from '../../src/strategy/pullback.js';
import { loadUniverse, EXTRA_UNIVERSE, portfolio, byYear, DAY, STAT_HEAD, statRow, PF_HEAD, pfRow, fmt } from './lib.js';
import { prep, FAMILIES, crossRank, run, buyHold } from './engine.js';

const cfg = loadConfig();
const now = Math.floor(Date.now() / DAY) * DAY;
const splitT = now - 365 * DAY;

// همان پنجره‌ی کش‌شده (۵ سال + ۶۰ روز)؛ گرم‌شدنِ EMA200 ِ روزانه در prep جدا اعمال می‌شود
const wl = await loadUniverse(cfg.watchlist, { years: 5, warmupDays: 60 });
const ex = await loadUniverse(EXTRA_UNIVERSE, { years: 5, warmupDays: 60 });
const W = wl.data.map(prep);
const X = ex.data.map(prep);
const ctxW = crossRank(W);
const ctxX = crossRank(X);
const ctxAll = crossRank([...W, ...X]);

const md = ['# آزمونِ سطحِ استراتژی (روزانه)', ''];
md.push(`- داخل: واچ‌لیست تا ${new Date(splitT).toISOString().slice(0, 10)} · خارج: واچ‌لیست، سالِ آخر · جهان: ${X.length} نمادِ دیگر، کلِ دوره`);
md.push('- کارمزد ۰.۱٪ و لغزش ۰.۰۵٪ هر طرف. سبد با ریسکِ ۱٪ سرمایه در هر معامله، بدونِ مرکب‌سازی.');
md.push('- انتخاب (از پیش اعلام‌شده): بیشترین شارپِ سبد در «داخل» با دست‌کم ۵۰ معامله.', '');
const bhIS = buyHold(W, 0, splitT); const bhOOS = buyHold(W, splitT, now + DAY); const bhX = buyHold(X, 0, now + DAY);
md.push('## معیار: خرید و نگهداریِ وزنِ برابر', '', '| | سالانه٪ | افتِ حداکثر٪ | شارپ |', '|---|---|---|---|');
for (const [l, b] of [['داخل', bhIS], ['خارج', bhOOS], ['جهان', bhX]]) md.push(`| ${l} | ${fmt(b.annualPct, 1)} | ${b.maxDDPct.toFixed(1)} | ${b.sharpe.toFixed(2)} |`);
md.push('');

const summary = [];
for (const [key, fam] of Object.entries(FAMILIES)) {
  md.push(`## ${fam.title}`, '', '### شبکه — داخل', '');
  md.push('| پارامتر | معامله | وین‌ریت | امید R | PF | سالانه٪ | افت٪ | شارپ |', '|---|---|---|---|---|---|---|---|');
  const isRuns = fam.grid.map((p) => {
    const tr = run(fam, p, W, key === 'D' ? ctxW : null, 0, splitT);
    return { p, tr, s: pbStats(tr), pf: portfolio(tr, { from: Math.min(...W.map((x) => x.startT)), to: splitT }) };
  });
  for (const r of isRuns) md.push(`| ${fam.label(r.p)} | ${r.s.n} | ${(r.s.winRate * 100).toFixed(0)}% | ${fmt(r.s.avgR, 3)} | ${Number.isFinite(r.s.pf) ? r.s.pf.toFixed(2) : '∞'} | ${r.pf ? fmt(r.pf.annualPct, 1) : '—'} | ${r.pf ? r.pf.maxDDPct.toFixed(1) : '—'} | ${r.pf ? r.pf.sharpe.toFixed(2) : '—'} |`);
  const pool = isRuns.filter((r) => r.s.n >= 50 && r.pf);
  const best = (pool.length ? pool : isRuns.filter((r) => r.pf)).reduce((a, b) => (b.pf.sharpe > a.pf.sharpe ? b : a));
  const oos = run(fam, best.p, W, key === 'D' ? ctxW : null, splitT, now + DAY);
  const ext = run(fam, best.p, X, key === 'D' ? ctxX : null, 0, now + DAY);
  const extOOS = ext.filter((t) => t.t >= splitT);
  md.push('', `**انتخاب:** ${fam.label(best.p)}`, '', STAT_HEAD);
  md.push(statRow('داخل', best.s), statRow('**خارج**', pbStats(oos)), statRow('**جهان (کل)**', pbStats(ext)), statRow('جهان (سالِ آخر)', pbStats(extOOS)));
  md.push('', PF_HEAD);
  md.push(pfRow('داخل', best.pf), pfRow('**خارج**', portfolio(oos, { from: splitT, to: now })), pfRow('**جهان (کل)**', portfolio(ext)));
  md.push('', '| سال (جهان) | معامله | امید R | مجموع R |', '|---|---|---|---|');
  for (const [y, g] of byYear(ext)) { const s = pbStats(g); md.push(`| ${y} | ${s.n} | ${fmt(s.avgR, 3)} | ${fmt(s.totalR, 1)} |`); }
  md.push('');
  summary.push({ key, title: fam.title, chosen: fam.label(best.p), params: best.p, IS: best.s, OOS: pbStats(oos), EXT: pbStats(ext), pfIS: best.pf, pfOOS: portfolio(oos, { from: splitT, to: now }), pfEXT: portfolio(ext) });
}

md.push('## جمع‌بندی', '', '| خانواده | انتخاب | امید R داخل | امید R خارج | امید R جهان | شارپ داخل | شارپ خارج | شارپ جهان |', '|---|---|---|---|---|---|---|---|');
for (const s of summary) md.push(`| ${s.key} | ${s.chosen} | ${fmt(s.IS.avgR, 3)} | ${fmt(s.OOS.avgR, 3)} | ${fmt(s.EXT.avgR, 3)} | ${s.pfIS?.sharpe.toFixed(2)} | ${s.pfOOS?.sharpe.toFixed(2) ?? '—'} | ${s.pfEXT?.sharpe.toFixed(2)} |`);

mkdirSync(join('out', 'research'), { recursive: true });
writeFileSync(join('out', 'research', 'strategies.md'), md.join('\n') + '\n');
writeFileSync(join('out', 'research', 'strategies.json'), JSON.stringify(summary, null, 2));
console.log(md.join('\n'));
