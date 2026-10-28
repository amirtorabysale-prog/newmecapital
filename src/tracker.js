/**
 * پیگیریِ سیگنالِ منتشرشده — منطقِ خالص، بدونِ شبکه.
 *
 * مدیریت دقیقاً همان است که پیامِ سیگنال می‌گوید و بک‌تست می‌سنجد: سهمِ
 * مساوی در هر تارگت، و بعد از تارگتِ اول حد ضرر به نقطه‌ی ورود می‌رود. اگر
 * در یک کندل هم حد ضرر و هم تارگت لمس شوند، بدبینانه حد ضرر اول حساب می‌شود
 * — کندلِ ۵ دقیقه‌ای این ابهام را تقریباً از بین می‌برد.
 *
 * ⚠️ کندل‌ها فقط *بسته‌شده*اند و `lastT` نگه می‌دارد تا کجا خوانده شده، تا
 * یک کندل دو بار شمرده نشود و بعد از ری‌استارت از همان‌جا ادامه دهد.
 */

export const TRACK_TF = '5m';
const M5 = 300_000;
const H1 = 3_600_000;
/** بیشترین کندلِ ۵ دقیقه که صرافی‌ها در یک درخواست می‌دهند (~۸۳ ساعت) */
export const MAX_5M = 1000;

/**
 * بعد از خاموشیِ طولانی‌تر از ۱۰۰۰ کندلِ ۵ دقیقه، اولِ فاصله از دست می‌رفت و
 * حد ضرر یا تارگتی که آن‌جا خورده بود هیچ‌وقت ثبت نمی‌شد. حالا ابتدای فاصله
 * با کندلِ یک‌ساعته پر می‌شود و از اولین ساعتِ کاملِ پوششِ ۵ دقیقه به بعد
 * همان ۵ دقیقه — بدونِ هم‌پوشانی، تا یک بازه دو بار شمرده نشود.
 *
 * کندلِ ساعتی‌ای که `lastT` وسطش است هم می‌آید (با زمانِ `lastT`، تا step
 * ردش نکند): بخشِ خوانده‌شده‌اش دوباره دیده می‌شود، که در بدترین حالت یک
 * سربه‌سرِ زودتر از واقع است — بهتر از جا انداختنِ یک حد ضرر.
 */
export function catchUp(hourly, recent, lastT) {
  const cut = recent.length ? Math.ceil(recent[0].t / H1) * H1 : Infinity;
  return [
    ...hourly.filter((k) => k.t + H1 > lastT && k.t < cut).map((k) => ({ ...k, t: Math.max(k.t, lastT) })),
    ...recent.filter((k) => k.t >= cut),
  ];
}

/** آیا فاصله از آخرین کندلِ خوانده‌شده بیش از یک درخواستِ ۵ دقیقه است؟ */
export const needsCatchUp = (sig, now) => now - sig.lastT > (MAX_5M - 10) * M5;

/** سیگنالِ تازه از پلنِ نهایی (بعد از ویرایشِ ادمین) */
export function newSignal({ id, item, data, direction, plan, publishedAt, channelMsgId, maxHoldHours }) {
  return {
    id,
    symbol: item.id,
    pretty: data.pretty,
    exchangeKey: data.exchangeKey,
    exSymbol: data.symbol,
    direction,
    entry: plan.entry,
    sl: plan.sl,
    slNow: plan.sl,
    risk: Math.abs(plan.entry - plan.sl),
    tps: plan.tps.map((t) => ({ label: t.label, price: t.price, rr: t.rr })),
    hits: 0,
    realized: 0,
    status: 'open',
    publishedAt,
    lastT: publishedAt,
    expiresAt: publishedAt + maxHoldHours * 3_600_000,
    channelMsgId,
    events: [],
  };
}

/**
 * کندل‌های تازه را روی سیگنال اعمال می‌کند.
 * @returns رویدادهای تازه: { type: 'tp' | 'sl' | 'be' | 'expired', index?, price, r, t }
 */
export function step(sig, candles, now = Date.now()) {
  if (sig.status !== 'open') return [];
  const long = sig.direction !== 'short';
  const share = 1 / sig.tps.length;
  const out = [];
  const emit = (e) => { sig.events.push(e); out.push(e); };

  for (const k of candles) {
    // کندلی که پیش از انتشار باز شده، یا قبلاً خوانده شده، حساب نیست
    if (k.t < sig.lastT) continue;
    sig.lastT = k.t + 1;
    if (k.t > sig.expiresAt) break;

    const slHit = long ? k.l <= sig.slNow : k.h >= sig.slNow;
    if (slHit) {
      const remaining = 1 - share * sig.hits;
      const r = remaining * (long ? sig.slNow - sig.entry : sig.entry - sig.slNow) / sig.risk;
      sig.realized += r;
      close(sig, sig.hits ? 'be' : 'sl', k.t);
      emit({ type: sig.hits ? 'be' : 'sl', price: sig.slNow, r: sig.realized, t: k.t });
      return out;
    }
    while (sig.hits < sig.tps.length) {
      const tp = sig.tps[sig.hits];
      if (!(long ? k.h >= tp.price : k.l <= tp.price)) break;
      sig.realized += share * tp.rr;
      sig.hits++;
      sig.slNow = sig.entry;
      emit({ type: 'tp', index: sig.hits, price: tp.price, r: sig.realized, t: k.t });
    }
    if (sig.hits === sig.tps.length) {
      close(sig, 'tp_all', k.t);
      return out;
    }
  }

  if (now > sig.expiresAt && candles.length) {
    const last = candles.at(-1).c;
    const remaining = 1 - share * sig.hits;
    sig.realized += remaining * (long ? last - sig.entry : sig.entry - last) / sig.risk;
    close(sig, 'expired', now);
    emit({ type: 'expired', price: last, r: sig.realized, t: now });
  }
  return out;
}

function close(sig, outcome, t) {
  sig.status = 'closed';
  sig.outcome = outcome;
  sig.closedAt = t;
}

/** آمارِ کارنامه */
export function summarize(signals) {
  const closed = signals.filter((s) => s.status === 'closed');
  const open = signals.filter((s) => s.status === 'open');
  // «موفق» = دست‌کم تارگتِ اول، پیش از حد ضرر
  const wins = closed.filter((s) => s.hits > 0).length;
  const losses = closed.filter((s) => s.outcome === 'sl').length;
  const totalR = closed.reduce((t, s) => t + s.realized, 0);
  return {
    total: signals.length,
    open: open.length,
    closed: closed.length,
    wins,
    losses,
    expiredFlat: closed.filter((s) => s.outcome === 'expired' && s.hits === 0).length,
    winRate: closed.length ? wins / closed.length : null,
    totalR,
    avgR: closed.length ? totalR / closed.length : null,
  };
}
