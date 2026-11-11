/**
 * Goldemy — اعتبارسنجی رسم‌های چارت
 *
 * ⚠️ هر چیزی که از مرورگر می‌آید غیرقابل‌اعتماد است. این رسم‌ها مستقیم در دیتابیس
 * می‌نشینند و بعداً به همه‌ی دستگاه‌های همان کاربر برمی‌گردند، پس باید پیش از
 * ذخیره کاملاً بررسی شوند — هم برای اینکه داده‌ی خراب چارت را نشکند، و هم برای
 * اینکه کسی نتواند با یک درخواست، حجم دلخواه در دیتابیس بنویسد.
 *
 * منطق اینجا خالص است و دیتابیس نمی‌شناسد تا بشود تستش کرد.
 */

/** انواع رسم و تعداد نقطه‌ی لازم هر کدام — باید با src/chart/geometry.ts یکی بماند. */
export const POINTS_NEEDED = {
  hline: 1, vline: 1, text: 1,
  trend: 2, rect: 2, fib: 2, measure: 2,
  channel: 3,
};

/**
 * سقف تعداد رسم برای هر کاربر.
 *
 * چارتی با صدها رسم نه خوانده می‌شود نه کسی واقعاً می‌سازدش؛ این عدد فقط جلوی
 * پر کردن عمدیِ دیتابیس را می‌گیرد.
 */
export const MAX_PER_USER = 300;

/** بلندترین یادداشتی که روی چارت معنا دارد. */
const MAX_TEXT = 200;

/**
 * بازه‌ی زمانیِ قابل قبول برای یک نقطه.
 *
 * رسم می‌تواند به آینده امتداد داشته باشد، پس محدود کردنش به «حالا» غلط است.
 * ولی زمانی خارج از این بازه یعنی داده‌ی خراب، نه تحلیل.
 */
const MIN_TIME = 946_684_800;        // ۲۰۰۰-۰۱-۰۱
const MAX_TIME = 4_102_444_800;      // ۲۱۰۰-۰۱-۰۱

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * یک رسم را بررسی و تمیز می‌کند.
 *
 * @returns {{ ok: true, drawing: object } | { ok: false, error: string }}
 */
export function validateDrawing(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'رسم نامعتبر است.' };

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || id.length > 64) return { ok: false, error: 'شناسه‌ی رسم نامعتبر است.' };

  const kind = raw.kind;
  const needed = POINTS_NEEDED[kind];
  if (!needed) return { ok: false, error: 'نوع رسم نامعتبر است.' };

  if (!Array.isArray(raw.points) || raw.points.length !== needed) {
    return { ok: false, error: `رسم ${kind} باید دقیقاً ${needed} نقطه داشته باشد.` };
  }

  const points = [];
  for (const p of raw.points) {
    if (!p || typeof p !== 'object') return { ok: false, error: 'نقطه‌ی نامعتبر.' };
    if (!isFiniteNumber(p.time) || !isFiniteNumber(p.price)) {
      return { ok: false, error: 'نقطه باید زمان و قیمت عددی داشته باشد.' };
    }
    if (p.time < MIN_TIME || p.time > MAX_TIME) {
      return { ok: false, error: 'زمانِ نقطه خارج از بازه‌ی منطقی است.' };
    }
    if (p.price <= 0) return { ok: false, error: 'قیمتِ نقطه باید مثبت باشد.' };
    // فقط همین دو فیلد نگه داشته می‌شوند؛ هر چیز دیگری که کلاینت فرستاده باشد
    // دور ریخته می‌شود تا داده‌ی ناشناخته وارد دیتابیس نشود.
    points.push({ time: Math.round(p.time), price: p.price });
  }

  // متن فقط برای ابزار یادداشت معنا دارد.
  const text = kind === 'text' && typeof raw.text === 'string'
    ? raw.text.slice(0, MAX_TEXT)
    : null;

  return { ok: true, drawing: { id, kind, points, text } };
}

/**
 * یک دسته رسم را بررسی می‌کند.
 *
 * رسمِ خراب باعث رد شدن کل دسته می‌شود، نه اینکه بی‌صدا کنار گذاشته شود: اگر
 * کلاینت داده‌ی نامعتبر می‌فرستد، بهتر است خطا ببیند تا اینکه بعداً بفهمد بخشی
 * از تحلیلش ذخیره نشده.
 */
export function validateBatch(list) {
  if (!Array.isArray(list)) return { ok: false, error: 'فهرست رسم‌ها نامعتبر است.' };
  if (list.length > MAX_PER_USER) {
    return { ok: false, error: `حداکثر ${MAX_PER_USER} رسم قابل ذخیره است.` };
  }

  const drawings = [];
  const seen = new Set();
  for (const raw of list) {
    const result = validateDrawing(raw);
    if (!result.ok) return result;
    if (seen.has(result.drawing.id)) return { ok: false, error: 'شناسه‌ی تکراری در فهرست.' };
    seen.add(result.drawing.id);
    drawings.push(result.drawing);
  }
  return { ok: true, drawings };
}

/** شکل خروجی برای کلاینت — دقیقاً همان چیزی که چارت انتظار دارد. */
export function toClient(row) {
  return {
    id: row.id,
    kind: row.kind,
    points: row.points,
    ...(row.text ? { text: row.text } : {}),
  };
}
