/**
 * دفترِ سایه: هر چیزی که بات پیشنهاد می‌دهد، بی‌تأییدِ ادمین ثبت و نتیجه‌اش
 * پیگیری می‌شود. هیچ پیامی به کانال یا ادمین نمی‌رود — فقط صفحه‌ی «🗂 دفترِ
 * سایه» در پنل. هدف: کارنامه‌ی بی‌طرفِ خودِ استراتژی‌ها، مستقل از این‌که ادمین
 * چه چیزی را منتشر کرد.
 *
 * سه نوع رکورد:
 *   setup  ستاپِ کاملِ استراتژیِ خطِ روند (پلنِ ورود/حد ضرر/تارگت دارد).
 *          همه‌ی ستاپ‌های قابلِ هشدار ثبت می‌شوند، حتی زیرِ آستانه‌ی امتیاز؛
 *          `alerted` می‌گوید هشدارش برای ادمین رفت یا نه. پیگیری دقیقاً مثلِ
 *          سیگنالِ منتشرشده (tracker.step): کندلِ ۵ دقیقه، سهمِ مساوی در هر
 *          تارگت، بعد از تارگتِ ۱ حد ضرر روی ورود. ورود = کلوزِ کندلِ اسکن.
 *   near   پیش‌هشدارِ «قیمت به خطِ روند نزدیک می‌شود».
 *   watch  رسیدنِ قیمت به رسمِ آزادِ استاد (خط، خطِ افقی، فیبو).
 *
 * near و watch پلن ندارند؛ نتیجه‌شان «واکنش به سطح» است، روی کندلِ یک‌ساعته
 * (قانون‌ها از پیش ثابت — LEVEL_RULES):
 *   - near: اگر تا touchBars کندل به خط نرسید ← noTouch.
 *   - بعد از رسیدن، در reactBars کندل: سقف/کف تا bounceAtr آن طرفِ سطح ←
 *     bounce؛ کلوز تا breakAtr این طرفِ سطح ← break؛ هر دو در یک کندل ←
 *     break (بدبینانه)؛ هیچ‌کدام ← none.
 *   سطحِ خطِ روند با زمان حرکت می‌کند (lvl.perMs).
 *
 * روند‌گیریِ روزانه دفترِ کاغذیِ خودش را دارد (store.trend) که همین کار را
 * می‌کند؛ این‌جا تکرار نمی‌شود، فقط در صفحه‌ی دفترِ سایه کنارِ بقیه نشان داده می‌شود.
 */

import { newSignal, summarize } from './tracker.js';

export const LEVEL_RULES = { touchBars: 24, touchAtr: 0.25, reactBars: 24, bounceAtr: 1.5, breakAtr: 1.0 };
/** همان هزینه‌ی همه‌ی بک‌تست‌ها، هر طرف (docs/STRATEGIES.md) */
export const JOURNAL_COSTS = { feePct: 0.1, slippagePct: 0.05 };
const KEEP_CLOSED = 2000;
const H1 = 3_600_000;

export function emptyJournal() {
  return { setups: {}, levels: {} };
}

/** رکوردِ ستاپ از ردیفِ اسکن (پلن دارد). @param closeT زمانِ بسته شدنِ کندلِ اسکن */
export function setupRecord({ key, row, closeT, alerted, maxHoldHours }) {
  const r = row.result;
  const sig = newSignal({
    id: key, item: row.item, data: row.data, direction: r.direction, plan: r.plan,
    publishedAt: closeT, channelMsgId: null, maxHoldHours,
  });
  delete sig.channelMsgId;
  return { ...sig, kind: 'setup', base: row.item.base, score: r.score, alerted, createdAt: closeT };
}

/**
 * رکوردِ سطح. @param lvl { t0, p0, perMs } — قیمتِ سطح در t: p0 + perMs × (t − t0)
 * @param touchedT زمانِ کندلِ برخورد (watch)، یا null (near: هنوز نرسیده)
 */
export function levelRecord({ id, kind, base, symbol, pretty, exchangeKey, exSymbol, side, lvl, atr, startT, touchedT = null, meta = {} }) {
  return {
    id, kind, base, symbol, pretty, exchangeKey, exSymbol, side, lvl, atr, meta,
    createdAt: startT, touchedT, lastT: touchedT != null ? touchedT + H1 : startT,
    status: 'open', outcome: null, mfeAtr: 0, maeAtr: 0, closedAt: null,
  };
}

export const levelAt = (lvl, t) => lvl.p0 + lvl.perMs * (t - lvl.t0);

/**
 * کندل‌های یک‌ساعته‌ی بسته‌شده را روی رکوردِ سطح اعمال می‌کند (فقط کندل‌های
 * از lastT به بعد). @returns true اگر رکورد همین الان بسته شد
 */
export function stepLevel(rec, candles, R = LEVEL_RULES) {
  if (rec.status !== 'open') return false;
  const s = rec.side === 'short' ? -1 : 1;
  const A = rec.atr;
  for (const k of candles) {
    if (k.t < rec.lastT) continue;
    rec.lastT = k.t + H1;
    const L = levelAt(rec.lvl, k.t);
    const hi = s > 0 ? k.h : -k.l; // بیشترین حرکت در جهتِ برگشت
    const lo = s > 0 ? k.l : -k.h; // بیشترین حرکت در جهتِ شکست
    const cl = s * k.c;
    const Ls = s * L;
    if (rec.touchedT == null) {
      if (lo <= Ls + R.touchAtr * A) {
        rec.touchedT = k.t;
      } else if ((k.t - rec.createdAt) / H1 >= R.touchBars) {
        return finish(rec, 'noTouch', k.t);
      }
      continue; // واکنش از کندلِ بعد از برخورد سنجیده می‌شود
    }
    rec.mfeAtr = Math.max(rec.mfeAtr, (hi - Ls) / A);
    rec.maeAtr = Math.max(rec.maeAtr, (Ls - lo) / A);
    const brk = cl <= Ls - R.breakAtr * A;
    const bnc = hi >= Ls + R.bounceAtr * A;
    if (brk) return finish(rec, 'break', k.t);
    if (bnc) return finish(rec, 'bounce', k.t);
    if ((k.t - rec.touchedT) / H1 >= R.reactBars) return finish(rec, 'none', k.t);
  }
  return false;
}

function finish(rec, outcome, t) {
  rec.status = 'closed';
  rec.outcome = outcome;
  rec.closedAt = t;
  return true;
}

/** پاک کردنِ قدیمی‌ترین بسته‌شده‌ها وقتی از سقف گذشت */
export function prune(map) {
  const closed = Object.values(map).filter((x) => x.status === 'closed').sort((a, b) => a.closedAt - b.closedAt);
  for (const x of closed.slice(0, Math.max(0, closed.length - KEEP_CLOSED))) delete map[x.id];
}

/**
 * R ِ خالصِ یک ستاپِ بسته با کارمزد و لغزش. هر بخشِ پوزیشن (تارگت‌ها و باقی‌مانده)
 * جدا با قیمتِ خروجِ خودش از rec.events حساب می‌شود؛ پس روی رکوردهای قدیمی هم
 * کار می‌کند و realized (بی‌کارمزد) دست نمی‌خورد.
 */
export function netRealized(rec, { feePct, slippagePct } = JOURNAL_COSTS) {
  if (rec.status !== 'closed') return null;
  const s = rec.direction === 'short' ? -1 : 1;
  const fee = feePct / 100;
  const slip = slippagePct / 100;
  const share = 1 / rec.tps.length;
  const tranche = (price) => {
    const e = rec.entry * (1 + s * slip);
    const x = price * (1 - s * slip);
    return (s * (x - e) - fee * (e + x)) / rec.risk;
  };
  return rec.events.reduce((sum, ev) => sum + (ev.type === 'tp' ? share : 1 - share * rec.hits) * tranche(ev.price), 0);
}

/** آمارِ ستاپ‌ها؛ net* با کارمزد، بقیه مثلِ کارنامه بی‌کارمزد */
export function setupStats(list, costs = JOURNAL_COSTS) {
  const st = summarize(list);
  const closed = list.filter((x) => x.status === 'closed');
  const net = (x) => netRealized(x, costs);
  const winners = closed.filter((x) => x.hits > 0);
  const netTotalR = closed.reduce((t, x) => t + net(x), 0);
  return {
    ...st,
    netTotalR,
    netAvgR: closed.length ? netTotalR / closed.length : null,
    netAvgWinR: winners.length ? winners.reduce((t, x) => t + net(x), 0) / winners.length : null,
  };
}

/** آمارِ واکنش به سطح */
export function levelStats(list) {
  const closed = list.filter((x) => x.status === 'closed');
  const c = (o) => closed.filter((x) => x.outcome === o).length;
  const touched = closed.filter((x) => x.outcome !== 'noTouch');
  return {
    total: list.length,
    open: list.length - closed.length,
    closed: closed.length,
    noTouch: c('noTouch'),
    touched: touched.length,
    bounce: c('bounce'),
    break: c('break'),
    none: c('none'),
    bounceRate: touched.length ? c('bounce') / touched.length : null,
  };
}
