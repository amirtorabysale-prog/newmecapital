/**
 * الگوی حجمِ معامله‌های S7 (شکستِ برخوردِ سوم): برنده‌ها با بازنده‌ها چه فرقی داشتند؟
 * node scripts/research/sr-volume-patterns.js
 * خروجی: docs/research/09-sr-volume-patterns.md
 *
 * فقط نگاه به برنده‌ها سوگیریِ بازماندگی است، پس هر ویژگی روی برنده و بازنده با هم
 * سنجیده می‌شود. مرزِ پنج‌کها فقط از نیمه‌ی اولِ زمانی ساخته و روی نیمه‌ی دوم آزموده می‌شود.
 * ویژگی‌های «after_» بعد از ورود معلوم می‌شوند و فقط توصیفی‌اند، نه قابلِ معامله.
 */
import { writeFileSync } from 'node:fs';
import { detect, netR, SR_DEFAULTS } from '../../src/strategy/srBreak.js';
import { loadUniverse, DAY, H1, fmt, pct } from './lib.js';

const BASES = ['BTC', 'SOL', 'AVAX', 'AAVE', 'HYPE', 'NEAR', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'LINK', 'DOT', 'LTC', 'BCH', 'ATOM',
  'UNI', 'FIL', 'TRX', 'ETC', 'XLM', 'INJ', 'OP', 'ARB', 'APT', 'SUI', 'TON', 'HBAR'];
const ITEMS = [...BASES.map((b) => ({ id: `${b}USDT`, base: b })), { id: 'XAUUSD', base: 'XAU', binance: 'PAXGUSDT' }];
const { data, missing } = await loadUniverse(ITEMS, { years: 5, warmupDays: 60, log: () => {} });

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

const mean = (B, a, b) => { let s = 0; let n = 0; for (let j = Math.max(0, a); j <= b && j < B.length; j++) { s += B[j].v; n++; } return n ? s / n : NaN; };
const ratio = (x, y) => (y > 0 && Number.isFinite(x) ? x / y : NaN);

/** همه با داده‌ی تا کلوزِ کندلِ شکست، به‌جز after_* */
function features(B, s, ms) {
  const i = s.i;
  const dir = s.dir === 'short' ? -1 : 1;
  const base = mean(B, i - 20, i - 1);
  const k = B[i];
  const range = k.h - k.l;
  const perDay = Math.round(DAY / ms);
  let same = 0; let sameN = 0;
  for (let d = 1; d <= 20; d++) { const j = i - d * perDay; if (j >= 0 && B[j].t % DAY === k.t % DAY) { same += B[j].v; sameN++; } }
  let upV = 0; let allV = 0;
  for (let j = i - 20; j < i; j++) { if (j < 0) continue; allV += B[j].v; if (dir * (B[j].c - B[j].o) > 0) upV += B[j].v; }
  let rank = 0; let rankN = 0; let max50 = 0;
  for (let j = i - 50; j < i; j++) { if (j < 0) continue; rankN++; if (B[j].v < k.v) rank++; max50 = Math.max(max50, B[j].v); }
  const around = (q) => mean(B, q - 1, q + 1);
  const baseAtB = mean(B, s.b - 20, s.b - 1);
  const pullEnd = s.firstIn >= 0 ? s.firstIn - 1 : i - 1;
  return {
    breakVolX: s.volX,
    breakVsSameHour: sameN >= 10 ? ratio(k.v, same / sameN) : NaN,
    breakRank50: rankN ? rank / rankN : NaN,
    breakVsMax50: ratio(k.v, max50),
    preDry5: ratio(mean(B, i - 5, i - 1), mean(B, i - 25, i - 6)),
    pre3vsBase: ratio(mean(B, i - 3, i - 1), base),
    rising3: B[i - 2]?.v < B[i - 1]?.v && B[i - 1]?.v < k.v ? 1 : 0,
    touchLastVsFirst: ratio(around(s.b), around(s.a)),
    touchLastX: ratio(around(s.b), baseAtB),
    pullbackVol: ratio(mean(B, s.b + 2, pullEnd), baseAtB),
    dirVolShare20: allV ? upV / allV : NaN,
    volPerRange: range > 0 ? s.volX / (range / s.atr) : NaN,
    closeLoc: range > 0 ? (dir > 0 ? k.c - k.l : k.h - k.c) / range : NaN,
    after_vol1: ratio(B[i + 1]?.v, base),
    after_vol3: i + 3 < B.length ? ratio(mean(B, i + 1, i + 3), base) : NaN,
  };
}

const FA = {
  breakVolX: 'حجمِ کندلِ شکست ÷ میانگینِ ۲۰ کندلِ قبل',
  breakVsSameHour: 'حجمِ شکست ÷ میانگینِ همان ساعت در ۲۰ روزِ قبل',
  breakRank50: 'رتبه‌ی حجمِ شکست در ۵۰ کندلِ قبل (۰ تا ۱)',
  breakVsMax50: 'حجمِ شکست ÷ بیشترین حجمِ ۵۰ کندلِ قبل',
  preDry5: 'خشک شدنِ حجم: ۵ کندلِ پیش از شکست ÷ ۲۰ کندلِ قبلش',
  pre3vsBase: '۳ کندلِ پیش از شکست ÷ میانگینِ ۲۰ کندل',
  rising3: 'سه کندلِ پیاپیِ حجمِ صعودی تا شکست (۰/۱)',
  touchLastVsFirst: 'حجمِ برخوردِ آخر ÷ برخوردِ اول',
  touchLastX: 'حجمِ برخوردِ آخر ÷ میانگینِ ۲۰ کندلِ قبلش',
  pullbackVol: 'حجمِ پولبکِ آخر ÷ میانگینِ پیش از برخوردِ آخر',
  dirVolShare20: 'سهمِ حجمِ کندل‌های هم‌جهت در ۲۰ کندلِ قبل',
  volPerRange: 'حجم به ازای طولِ کندلِ شکست (تلاش/نتیجه)',
  closeLoc: 'جای کلوز در کندلِ شکست (۱ = انتهای هم‌جهت)',
  after_vol1: 'بعد از ورود: حجمِ کندلِ بعد',
  after_vol3: 'بعد از ورود: میانگینِ حجمِ ۳ کندلِ بعد',
};
const KEYS = Object.keys(FA);
const TRADABLE = KEYS.filter((k) => !k.startsWith('after_'));

// ── ساختِ معامله‌ها با همان قانونِ sr-backtest (یک پوزیشن در هر نماد/تایم‌فریم)
const TFS = [['1h', H1], ['4h', 4 * H1]];
const POP = { MAIN: (s) => s.volOk && s.trendOk, 'A (بی‌فیلترِ حجم)': (s) => s.trendOk };
const res = {};
for (const d of data) {
  const daily = aggregate(d.candles, DAY);
  for (const [tf, ms] of TFS) {
    const bars = tf === '1h' ? d.candles : aggregate(d.candles, ms);
    const det = detect(bars, daily, ms, SR_DEFAULTS);
    for (const [name, f] of Object.entries(POP)) {
      let busy = -1;
      const list = ((res[tf] ??= {})[name] ??= []);
      for (const s of det) {
        if (bars[s.i].t < d.startT || !s.exit || !f(s) || s.i <= busy) continue;
        busy = s.exit.j;
        list.push({ id: d.id, dir: s.dir, t: bars[s.i].t + ms, r: netR(s), why: s.exit.why, f: features(bars, s, ms) });
      }
    }
  }
}

const med = (a) => { const x = a.filter(Number.isFinite).sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : NaN; };
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/** AUC: احتمالِ این‌که یک برنده مقدارِ بیشتری از یک بازنده داشته باشد؛ ۰.۵ = بی‌اثر */
function auc(tr, k) {
  const x = tr.filter((t) => Number.isFinite(t.f[k])).map((t) => ({ v: t.f[k], w: t.r > 0 })).sort((a, b) => a.v - b.v);
  let i = 0; let ranks = 0; let n1 = 0;
  while (i < x.length) {
    let j = i;
    while (j + 1 < x.length && x[j + 1].v === x[i].v) j++;
    const rk = (i + j) / 2 + 1;
    for (let q = i; q <= j; q++) if (x[q].w) { ranks += rk; n1++; }
    i = j + 1;
  }
  const n0 = x.length - n1;
  if (!n1 || !n0) return { auc: NaN, z: NaN };
  const u = ranks - (n1 * (n1 + 1)) / 2;
  const a = u / (n1 * n0);
  return { auc: a, z: (a - 0.5) / Math.sqrt((n1 + n0 + 1) / (12 * n1 * n0)) };
}

/** چارکِ بالا/پایین با مرزِ نیمه‌ی اول */
function buckets(tr, k, q = 5) {
  const sorted = [...tr].sort((a, b) => a.t - b.t);
  const mid = Math.floor(sorted.length / 2);
  const inS = sorted.slice(0, mid); const out = sorted.slice(mid);
  const vals = inS.map((t) => t.f[k]).filter(Number.isFinite).sort((a, b) => a - b);
  if (vals.length < q * 10 || new Set(vals).size < q) return null;
  const cuts = Array.from({ length: q - 1 }, (_, i) => vals[Math.floor(((i + 1) * vals.length) / q)]);
  const idx = (v) => { let b = 0; while (b < cuts.length && v >= cuts[b]) b++; return b; };
  const collect = (arr) => {
    const g = Array.from({ length: q }, () => []);
    for (const t of arr) if (Number.isFinite(t.f[k])) g[idx(t.f[k])].push(t);
    return g;
  };
  return { cuts, inS: collect(inS), out: collect(out) };
}

/** فاصله‌ی اطمینانِ ۹۰٪ با بوتستراپِ ماه (معامله‌های هم‌زمان مستقل نیستند) */
function monthCI(tr, n = 2000) {
  const by = new Map();
  for (const t of tr) { const m = new Date(t.t).toISOString().slice(0, 7); (by.get(m) ?? by.set(m, []).get(m)).push(t.r); }
  const groups = [...by.values()];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const sims = [];
  for (let s = 0; s < n; s++) {
    let sum = 0; let c = 0;
    for (let i = 0; i < groups.length; i++) { const g = groups[Math.floor(rnd() * groups.length)]; for (const x of g) { sum += x; c++; } }
    sims.push(sum / c);
  }
  sims.sort((a, b) => a - b);
  return [sims[Math.floor(n * 0.05)], sims[Math.floor(n * 0.95)]];
}

const st = (g) => (g.length ? `${g.length} / ${pct(g.filter((t) => t.r > 0).length / g.length)} / ${fmt(avg(g.map((t) => t.r)), 3)}` : '—');
const nFeat = TRADABLE.length * TFS.length * Object.keys(POP).length;
const zBonf = 3.48; // |z| لازم برای p≈0.05 با تصحیحِ ~۵۲ آزمون
const md = ['# S7 — الگوی حجمِ برنده‌ها در برابرِ بازنده‌ها', ''];
md.push(`- تاریخ: ${new Date().toISOString().slice(0, 10)} · داده: همان کشِ بایننس · ${data.length} نماد${missing.length ? ` · بدونِ داده: ${missing.map((m) => m.id).join(', ')}` : ''}`);
md.push(`- ${nFeat} آزمونِ قابلِ معامله ⇒ معیارِ معناداری با تصحیحِ آزمونِ چندگانه |z| ≥ ${zBonf}. برنده = R ِ خالص > 0 (کارمزد ۰.۱٪ + لغزش ۰.۰۵٪).`);
md.push('- پنج‌کها: مرزها از نیمه‌ی اولِ زمانی؛ ستون‌ها: تعداد / وین‌ریت / میانگین R.', '');

const candidates = [];
for (const [tf] of TFS) {
  for (const [name, tr] of Object.entries(res[tf])) {
    const win = tr.filter((t) => t.r > 0); const los = tr.filter((t) => t.r <= 0);
    md.push(`## ${tf} · ${name} — ${tr.length} معامله، وین‌ریت ${pct(win.length / tr.length)}، میانگین ${fmt(avg(tr.map((t) => t.r)), 3)}R`, '');
    md.push('| ویژگی | میانه‌ی برنده | میانه‌ی بازنده | AUC | z | AUC نیمه‌ی اول | AUC نیمه‌ی دوم |', '|---|---|---|---|---|---|---|');
    const sorted = [...tr].sort((a, b) => a.t - b.t);
    const h1 = sorted.slice(0, sorted.length >> 1); const h2 = sorted.slice(sorted.length >> 1);
    for (const k of KEYS) {
      const a = auc(tr, k); const a1 = auc(h1, k); const a2 = auc(h2, k);
      md.push(`| ${FA[k]} | ${med(win.map((t) => t.f[k])).toFixed(2)} | ${med(los.map((t) => t.f[k])).toFixed(2)} | ${a.auc.toFixed(3)} | ${fmt(a.z, 1)} | ${a1.auc.toFixed(3)} | ${a2.auc.toFixed(3)} |`);
      if (TRADABLE.includes(k)) candidates.push({ tf, name, k, ...a, a1: a1.auc, a2: a2.auc, tr });
    }
    md.push('', '**پنج‌کها (نیمه‌ی دوم = خارج از نمونه):**', '', '| ویژگی | مرزها | پنجکِ پایین: داخل | خارج | پنجکِ بالا: داخل | خارج |', '|---|---|---|---|---|---|');
    for (const k of TRADABLE) {
      const b = buckets(tr, k);
      if (b) md.push(`| ${FA[k]} | ${b.cuts.map((c) => c.toFixed(2)).join(' · ')} | ${st(b.inS[0])} | ${st(b.out[0])} | ${st(b.inS.at(-1))} | ${st(b.out.at(-1))} |`);
    }
    md.push('');
  }
}

candidates.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
md.push('## قوی‌ترین رابطه‌ها', '', '| تایم | جامعه | ویژگی | AUC | z | نیمه‌ی ۱ | نیمه‌ی ۲ | از |z| معیار گذشت؟ | هم‌جهت در دو نیمه؟ |', '|---|---|---|---|---|---|---|---|---|');
for (const c of candidates.slice(0, 10)) {
  const same = Math.sign(c.a1 - 0.5) === Math.sign(c.a2 - 0.5);
  md.push(`| ${c.tf} | ${c.name} | ${FA[c.k]} | ${c.auc.toFixed(3)} | ${fmt(c.z, 1)} | ${c.a1.toFixed(3)} | ${c.a2.toFixed(3)} | ${Math.abs(c.z) >= zBonf ? 'بله' : 'نه'} | ${same ? 'بله' : 'نه'} |`);
}
md.push('');

// بهترین کاندیدها: پنجکِ مطلوب، خارج از نمونه، با بوتستراپِ ماهانه و سال‌به‌سال
md.push('## پنجکِ مطلوبِ سه رابطه‌ی اول، خارج از نمونه', '');
for (const c of candidates.slice(0, 3)) {
  const b = buckets(c.tr, c.k);
  if (!b) continue;
  const g = c.auc > 0.5 ? b.out.at(-1) : b.out[0];
  const ci = monthCI(g);
  const years = {};
  for (const t of g) (years[new Date(t.t).getUTCFullYear()] ??= []).push(t.r);
  md.push(`- **${c.tf} · ${c.name} · ${FA[c.k]}** (${c.auc > 0.5 ? 'پنجکِ بالا' : 'پنجکِ پایین'}): ${st(g)} · بازه‌ی ۹۰٪ میانگین R با بوتستراپِ ماهانه: ${fmt(ci[0], 3)} تا ${fmt(ci[1], 3)} · سال‌ها: ${Object.entries(years).map(([y, r]) => `${y}: ${r.length}/${fmt(avg(r), 2)}`).join('، ')}`);
}
// ── آزمونِ تکرارِ تنها رابطه‌ی جالب؛ فرضیه بعد از دیدنِ داده انتخاب شده، پس سخت‌گیرانه‌تر
md.push('', '## آزمونِ تکرار: «حجم به ازای طولِ کندلِ شکست» پایین (بی‌فیلترِ حجم)', '');
md.push('این فرضیه بعد از دیدنِ نتیجه انتخاب شده. 2h، 6h، 8h و 12h در انتخابش نقشی نداشتند، ولی همان کندل‌ها را می‌بینند. ستون‌های پنج‌ک خارج از نمونه‌اند: تعداد / وین‌ریت / میانگین R.', '');
md.push('| تایم | معامله | پنجکِ ۱ (کمترین) | ۲ | ۳ | ۴ | ۵ | پنجکِ ۱ داخلِ نمونه | پنجکِ ۱ خارج با هزینه‌ی ۲ برابر | بازه‌ی ۹۰٪ پنجکِ ۱ خارج |', '|---|---|---|---|---|---|---|---|---|---|');
for (const [tf, ms] of [['1h', H1], ['2h', 2 * H1], ['4h', 4 * H1], ['6h', 6 * H1], ['8h', 8 * H1], ['12h', 12 * H1]]) {
  const tr = [];
  for (const d of data) {
    const daily = aggregate(d.candles, DAY);
    const bars = tf === '1h' ? d.candles : aggregate(d.candles, ms);
    let busy = -1;
    for (const s of detect(bars, daily, ms, SR_DEFAULTS)) {
      if (bars[s.i].t < d.startT || !s.exit || !s.trendOk || s.i <= busy) continue;
      busy = s.exit.j;
      tr.push({ t: bars[s.i].t + ms, r: netR(s), r2: netR(s, { feePct: 0.2, slippagePct: 0.1 }), f: features(bars, s, ms) });
    }
  }
  const b = buckets(tr, 'volPerRange');
  if (!b) { md.push(`| ${tf} | ${tr.length} | نمونه کم | | | | | | | |`); continue; }
  const low = b.out[0];
  const ci = low.length >= 15 ? monthCI(low) : [NaN, NaN];
  md.push(`| ${tf} | ${tr.length} | ${b.out.map(st).join(' | ')} | ${st(b.inS[0])} | ${fmt(avg(low.map((t) => t.r2)), 3)} | ${fmt(ci[0], 3)} تا ${fmt(ci[1], 3)} |`);
}
writeFileSync('docs/research/09-sr-volume-patterns.md', md.join('\n'));
console.log(JSON.stringify(Object.fromEntries(TFS.map(([tf]) => [tf, Object.fromEntries(Object.entries(res[tf]).map(([n, t]) => [n, t.length]))]))));
console.log(md.slice(md.indexOf('## قوی‌ترین رابطه‌ها')).join('\n'));
