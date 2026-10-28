/**
 * ویرایشِ پلنِ معامله پیش از انتشار. پلنِ اصلیِ بات دست نمی‌خورد؛ ویرایش‌ها
 * جدا نگه داشته و هر بار روی آن اعمال می‌شوند، تا «برگرداندن» همیشه ممکن باشد.
 */

import { price } from './format.js';

/**
 * @param edits { entry?, sl?, tps?: { [index]: number | null } } — null یعنی آن تارگت حذف شده.
 * ⚠️ tps شیء است نه آرایه: آرایه‌ی سوراخ‌دار در JSON سوراخ‌هایش null می‌شود و
 * «دست‌نخورده» بعد از ذخیره به «حذف‌شده» تبدیل می‌شد.
 */
export function applyEdits(plan, direction, edits = {}) {
  const long = direction !== 'short';
  const entry = edits.entry ?? plan.entry;
  const sl = edits.sl ?? plan.sl;
  const risk = Math.abs(entry - sl);
  const prices = plan.tps.map((t, i) => (edits.tps && Object.hasOwn(edits.tps, i) ? edits.tps[i] : t.price))
    .filter((p) => p !== null && p !== undefined);
  prices.sort((a, b) => (long ? a - b : b - a));
  const tps = prices.map((price, i) => ({
    label: `TP${i + 1}`,
    price,
    rr: (long ? price - entry : entry - price) / risk,
  }));
  return {
    ...plan,
    entry,
    sl,
    risk,
    riskPct: (risk / entry) * 100,
    tps,
    rrWarning: !tps.length || tps[0].rr < 1,
  };
}

/** خطای فارسی، یا null اگر پلن منطقی است */
export function validatePlan(plan, direction) {
  const long = direction !== 'short';
  const { entry, sl, tps } = plan;
  if (!(entry > 0) || !(sl > 0)) return 'قیمت باید مثبت باشد.';
  if (long ? sl >= entry : sl <= entry) return `در ${long ? 'خرید' : 'فروش'} حد ضرر باید ${long ? 'زیرِ' : 'بالای'} ورود باشد.`;
  if (!tps.length) return 'دست‌کم یک تارگت لازم است.';
  for (const t of tps) {
    if (long ? t.price <= entry : t.price >= entry) return `هر تارگت باید ${long ? 'بالای' : 'زیرِ'} ورود باشد (${t.label}).`;
  }
  return null;
}

/**
 * پلن هنوز با قیمتِ فعلی معنا دارد؟ — لحظه‌ی انتشار، نه لحظه‌ی اسکن.
 * ورودِ پلن بسته‌شدنِ کندلِ اسکن است و ادمین ممکن است ساعت‌ها بعد «انتشار»
 * بزند؛ تا آن موقع قیمت شاید از حد ضرر یا تارگتِ اول گذشته باشد.
 * @returns خطای فارسی، یا null
 */
export function checkLivePrice(plan, direction, live, atr, maxDriftAtr) {
  const P = (v) => price(v, plan.entry);
  const long = direction !== 'short';
  const above = (a, b) => (long ? a >= b : a <= b);
  if (above(plan.sl, live)) return `قیمتِ فعلی (${P(live)}) از حد ضرر گذشته؛ این ستاپ دیگر معتبر نیست.`;
  if (plan.tps.length && above(live, plan.tps[0].price)) return `قیمتِ فعلی (${P(live)}) به تارگتِ اول رسیده؛ دیر شده.`;
  const drift = Math.abs(live - plan.entry) / atr;
  if (atr > 0 && drift > maxDriftAtr) {
    return `قیمتِ فعلی (${P(live)}) ${drift.toFixed(1)} ATR از ورودِ پلن (${P(plan.entry)}) فاصله گرفته؛ حداکثر ${maxDriftAtr} است.`
      + ' با «✏️ ویرایش» ورود را به‌روز کن، یا از پنل «تحلیلِ دوباره» بزن.';
  }
  return null;
}

export function hasEdits(edits) {
  return !!edits && (edits.entry != null || edits.sl != null || (edits.tps && Object.keys(edits.tps).length > 0) || !!edits.note);
}
