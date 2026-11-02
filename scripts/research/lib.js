/**
 * ابزارِ مشترکِ پژوهش: بارگذاریِ داده‌ی یک ساعته‌ی چندساله، هزینه‌ی معامله،
 * و معیارهای سبد (بازده، شارپ، سورتینو، افتِ حداکثر) با فرضِ ریسکِ ثابت در هر
 * معامله.
 */

import { loadHistory } from '../lib/history.js';

export const H1 = 3_600_000;
export const DAY = 86_400_000;

/** نمادهای خارج از واچ‌لیست برای سنجشِ «خارج از جهان» — همه لیست‌شده در بایننس اسپات. */
export const EXTRA_UNIVERSE = [
  'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'LINK', 'DOT', 'LTC', 'BCH', 'ATOM',
  'UNI', 'FIL', 'TRX', 'ETC', 'XLM', 'INJ', 'OP', 'ARB', 'APT', 'SUI',
].map((base) => ({ id: `${base}USDT`, base }));

export async function loadUniverse(items, { years = 5, now = Math.floor(Date.now() / H1) * H1, warmupDays = 60, log = console.log } = {}) {
  const from = now - years * 365 * DAY - warmupDays * DAY;
  const out = [];
  const missing = [];
  for (const item of items) {
    const res = await loadHistory(item, '1h', from, now, { log: () => {} });
    if (res.error || res.candles.length < 24 * (warmupDays + 60)) {
      missing.push({ id: item.id, why: res.error || `فقط ${res.candles?.length || 0} کندل` });
      log(`✗ ${item.id}: ${res.error || 'تاریخچه‌ی کوتاه'}`);
      continue;
    }
    out.push({ item, id: item.id, candles: res.candles, exchange: res.exchange, startT: res.candles[0].t + warmupDays * DAY });
  }
  return { data: out, missing, now };
}

/**
 * R ِ خالص از چند خروج: fills = [{px, w}] با مجموعِ w = ۱.
 * کارمزد و لغزش (درصد، هر طرف) هم روی ورود و هم روی هر خروج.
 */
export function netR(dir, entry, risk, fills, { feePct = 0.1, slippagePct = 0.05 } = {}) {
  const s = dir === 'short' ? -1 : 1;
  const slip = slippagePct / 100;
  const fee = feePct / 100;
  const e = entry * (1 + s * slip);
  let pnl = -fee * e;
  let gross = 0;
  for (const f of fills) {
    const x = f.px * (1 - s * slip);
    pnl += f.w * (s * (x - e) - fee * x);
    gross += (f.w * s * (f.px - entry)) / risk;
  }
  return { r: pnl / risk, gross };
}

/**
 * معیارهای سبد با ریسکِ `riskPct` درصد از سرمایه‌ی اولیه در هر معامله (بدونِ
 * مرکب‌سازی، تا نتیجه به ترتیبِ معامله‌ها حساس نباشد). سود/زیان روزِ خروج ثبت
 * می‌شود.
 */
export function portfolio(trades, { riskPct = 1, from, to } = {}) {
  if (!trades.length) return null;
  const t0 = from ?? Math.min(...trades.map((t) => t.t));
  const t1 = to ?? Math.max(...trades.map((t) => t.exitT));
  const days = Math.max(1, Math.ceil((t1 - t0) / DAY));
  const daily = new Array(days + 1).fill(0);
  for (const t of trades) {
    const d = Math.min(days, Math.max(0, Math.floor((t.exitT - t0) / DAY)));
    daily[d] += t.r * riskPct;
  }
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const x of daily) {
    eq += x;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((a, b) => a + (b - mean) ** 2, 0) / daily.length);
  const down = Math.sqrt(daily.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / daily.length);
  // بیشترین تعدادِ معامله‌ی هم‌زمان
  const ev = trades.flatMap((t) => [[t.t, 1], [t.exitT, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let maxOpen = 0;
  for (const [, d] of ev) { open += d; maxOpen = Math.max(maxOpen, open); }
  const years = days / 365;
  return {
    totalPct: eq,
    annualPct: eq / years,
    maxDDPct: dd,
    sharpe: sd ? (mean / sd) * Math.sqrt(365) : 0,
    sortino: down ? (mean / down) * Math.sqrt(365) : 0,
    calmar: dd ? eq / years / dd : Infinity,
    maxOpen,
    tradesPerMonth: trades.length / (days / 30.4),
  };
}

export function byYear(trades) {
  const m = new Map();
  for (const t of trades) {
    const y = new Date(t.t).getUTCFullYear();
    if (!m.has(y)) m.set(y, []);
    m.get(y).push(t);
  }
  return [...m].sort((a, b) => a[0] - b[0]);
}

export const fmt = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '∞');
export const pct = (x) => `${(x * 100).toFixed(1)}%`;

export const STAT_HEAD = '| | معامله | وین‌ریت | برد R | باخت R | PF | امید R | مجموع R | افت R |\n|---|---|---|---|---|---|---|---|---|';
export const statRow = (label, s) => `| ${label} | ${s.n} | ${s.n ? pct(s.winRate) : '—'} | ${s.avgWin.toFixed(2)} | ${s.avgLoss.toFixed(2)} | ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞'} | ${fmt(s.avgR, 3)} | ${fmt(s.totalR, 1)} | ${s.maxDD.toFixed(1)} |`;
export const PF_HEAD = '| | سالانه٪ | افتِ حداکثر٪ | شارپ | سورتینو | کالمار | هم‌زمانِ حداکثر | معامله/ماه |\n|---|---|---|---|---|---|---|---|';
export const pfRow = (label, p) => (p
  ? `| ${label} | ${fmt(p.annualPct, 1)} | ${p.maxDDPct.toFixed(1)} | ${p.sharpe.toFixed(2)} | ${p.sortino.toFixed(2)} | ${Number.isFinite(p.calmar) ? p.calmar.toFixed(2) : '∞'} | ${p.maxOpen} | ${p.tradesPerMonth.toFixed(1)} |`
  : `| ${label} | — | — | — | — | — | — | — |`);
