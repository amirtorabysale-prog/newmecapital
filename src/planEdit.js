/**
 * ویرایشِ پلنِ معامله پیش از انتشار. پلنِ اصلیِ بات دست نمی‌خورد؛ ویرایش‌ها
 * جدا نگه داشته و هر بار روی آن اعمال می‌شوند، تا «برگرداندن» همیشه ممکن باشد.
 */

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

export function hasEdits(edits) {
  return !!edits && (edits.entry != null || edits.sl != null || (edits.tps && Object.keys(edits.tps).length > 0) || !!edits.note);
}
