/**
 * ممیزیِ استراتژیِ فعلیِ بات (src/strategy/analyze.js) روی چند سال داده‌ی
 * یک ساعته، دقیقاً با رفتارِ بات: اسکن هر ۴ ساعت، آستانه‌ی امتیاز، فقط
 * ستاپ‌های alertable با پلن، کول‌داونِ هر خط، و مدیریتِ پیامِ سیگنال (سهمِ
 * مساوی در هر تارگت، سربه‌سر بعد از تارگتِ اول، خروج بعد از maxHoldHours).
 * کارمزد و لغزش کم می‌شود؛ استاپ و تارگت در یک کندل ← استاپ.
 *
 * محدودیت: واگراییِ ۵ دقیقه در داده‌ی چندساله نیست و طبقِ طراحیِ analyze از
 * امتیاز کنار می‌رود. تأییدِ دستیِ ادمین هم شبیه‌سازی نمی‌شود.
 *
 *   node scripts/research/master-audit.js [--every 4] [--years 5] [--dirs long,short] [--universe extra]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { analyze } from '../../src/strategy/analyze.js';
import { pbStats } from '../../src/strategy/pullback.js';
import { loadUniverse, netR, portfolio, byYear, EXTRA_UNIVERSE, H1, STAT_HEAD, statRow, PF_HEAD, pfRow } from './lib.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const every = Number(opt('every', 4));
const years = Number(opt('years', 5));
const dirs = opt('dirs', 'long,short').split(',');
const universe = opt('universe', 'watchlist');
const cfg = loadConfig();
const WINDOW = cfg.candles; // همان تعدادِ کندلی که بات می‌گیرد
const maxHold = cfg.maxHoldHours;
const cost = { feePct: Number(opt('fee', 0.1)), slippagePct: Number(opt('slip', 0.05)) };

const items = universe === 'extra' ? EXTRA_UNIVERSE : cfg.watchlist;
const { data, missing } = await loadUniverse(items, { years, warmupDays: 30 });

function simulate(c, i, dir, plan) {
  const long = dir === 'long';
  const up = (k, v) => (long ? k.h >= v : k.l <= v);
  const down = (k, v) => (long ? k.l <= v : k.h >= v);
  const tps = plan.tps;
  const share = 1 / tps.length;
  let sl = plan.sl;
  let next = 0;
  const fills = [];
  let j = i + 1;
  const last = Math.min(c.length - 1, i + maxHold);
  for (; j <= last; j++) {
    const k = c[j];
    if (down(k, sl)) {
      fills.push({ px: sl, w: 1 - share * next });
      break;
    }
    while (next < tps.length && up(k, tps[next].price)) {
      fills.push({ px: tps[next].price, w: share });
      next++;
      sl = plan.entry;
    }
    if (next === tps.length) break;
  }
  const done = fills.reduce((s, f) => s + f.w, 0);
  if (done < 1 - 1e-9) {
    j = Math.min(j, last);
    fills.push({ px: c[j].c, w: 1 - done });
  }
  const { r, gross } = netR(dir, plan.entry, plan.risk, fills, cost);
  const outcome = next === tps.length ? `TP${next}` : next ? `TP${next}+` : (fills.length === 1 && fills[0].px === plan.sl ? 'SL' : 'TIME');
  return { r, gross, exitIdx: j, exitT: c[Math.min(j, c.length - 1)].t + H1, outcome };
}

const all = [];
const t0 = Date.now();
for (const d of data) {
  const c = d.candles;
  const seen = new Map();
  let n = 0;
  for (let i = WINDOW; i < c.length - 1; i++) {
    if (c[i].t < d.startT) continue;
    if (((c[i].t + H1) / H1) % every !== 0) continue; // زمانِ اسکن
    const win = c.slice(i - WINDOW + 1, i + 1);
    for (const dir of dirs) {
      const res = analyze(win, cfg, dir);
      if (!res || !res.plan || !res.alertable || res.score < cfg.alertThreshold || !res.plan.tps.length) continue;
      const key = `${dir}:${win[res.line.a].t}:${win[res.line.b].t}`;
      const prev = seen.get(key);
      if (prev !== undefined && c[i].t - prev < cfg.cooldownHours * H1) continue;
      seen.set(key, c[i].t);
      const sim = simulate(c, i, dir, res.plan);
      all.push({
        id: d.id, dir, t: c[i].t + H1, score: res.score, complete: res.complete,
        rr1: res.plan.tps[0].rr, rrWarning: res.plan.rrWarning, riskPct: res.plan.riskPct,
        comps: Object.fromEntries(Object.entries(res.components).filter(([, v]) => v.enabled).map(([k, v]) => [k, v.ok])),
        ...sim,
      });
      n++;
    }
  }
  console.log(`${d.id.padEnd(10)} ${n} سیگنال (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const md = [`# ممیزیِ استراتژیِ فعلیِ بات — ${universe === 'extra' ? 'نمادهای خارج از واچ‌لیست' : 'واچ‌لیست'}`, ''];
md.push(`- ${years} سال، اسکن هر ${every} ساعت، آستانه ${cfg.alertThreshold}، کول‌داون ${cfg.cooldownHours}س، خروجِ زمانی ${maxHold}س`);
md.push(`- کارمزد ${cost.feePct}% و لغزش ${cost.slippagePct}% هر طرف. واگراییِ ۵ دقیقه در دسترس نبود (از امتیاز کنار رفت).`);
if (missing.length) md.push(`- داده نیامد: ${missing.map((m) => m.id).join('، ')}`);
md.push('', '## خلاصه', '', STAT_HEAD);
const groups = [
  ['همه', all],
  ...dirs.map((d) => [d === 'long' ? 'خرید (تنظیمِ فعلیِ بات)' : 'فروش', all.filter((t) => t.dir === d)]),
  ['فقط ستاپِ کامل', all.filter((t) => t.complete)],
  ['بدونِ هشدارِ R:R', all.filter((t) => !t.rrWarning)],
  ['امتیاز ≥ ۸۵', all.filter((t) => t.score >= 85)],
];
for (const [l, g] of groups) md.push(statRow(l, pbStats(g)));
md.push('', '## سبد (ریسکِ ۱٪ در هر معامله)', '', PF_HEAD);
for (const [l, g] of groups.slice(0, 3)) md.push(pfRow(l, portfolio(g)));
md.push('', '## سال‌به‌سال (همه)', '', STAT_HEAD);
for (const [y, g] of byYear(all)) md.push(statRow(String(y), pbStats(g)));
md.push('', '## هر نماد', '', STAT_HEAD);
for (const d of data) md.push(statRow(d.id, pbStats(all.filter((t) => t.id === d.id))));
md.push('', '## هر شرط: وقتی برقرار بود در برابرِ وقتی نبود', '', '| شرط | با شرط: تعداد / امید R | بدونِ شرط: تعداد / امید R |', '|---|---|---|');
const keys = [...new Set(all.flatMap((t) => Object.keys(t.comps)))];
for (const k of keys) {
  const a = pbStats(all.filter((t) => t.comps[k]));
  const b = pbStats(all.filter((t) => t.comps[k] === false));
  md.push(`| ${k} | ${a.n} / ${a.avgR.toFixed(3)} | ${b.n} / ${b.avgR.toFixed(3)} |`);
}
md.push('', '## نتیجه‌ها', '', '| نتیجه | تعداد |', '|---|---|');
const oc = new Map();
for (const t of all) oc.set(t.outcome, (oc.get(t.outcome) || 0) + 1);
for (const [k, v] of [...oc].sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);

const out = join('out', 'research');
mkdirSync(out, { recursive: true });
const name = `master-audit${universe === 'extra' ? '-extra' : ''}${every !== 4 ? `-every${every}` : ''}`;
writeFileSync(join(out, `${name}.md`), md.join('\n') + '\n');
writeFileSync(join(out, `${name}.json`), JSON.stringify(all));
console.log('\n' + md.join('\n'));
