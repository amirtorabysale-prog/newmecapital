/**
 * Goldemy — ماندگاری رسم‌های چارت
 *
 * تحلیلی که کاربر روی چارت می‌کشد باید بماند — با رفرش، با خروج و ورود دوباره،
 * و روی هر دستگاهی که با همان حساب وارد می‌شود.
 *
 * دو لایه دارد و هر کدام کار خودش را می‌کند:
 *
 *   • **سرور** منبع حقیقت است. رسم‌ها به حساب کاربر بسته‌اند، پس با خروج از بین
 *     نمی‌روند و بین دستگاه‌ها همگام‌اند.
 *   • **localStorage** فقط یک کشِ محلی است تا چارت بلافاصله پس از باز شدن صفحه
 *     رسم‌ها را نشان بدهد و منتظر شبکه نماند.
 *
 * 🐛 اول فقط localStorage بود. کاربر گزارش داد با خروج و ورود دوباره همه‌چیز
 * می‌پرد — چون خروج کل localStorage را پاک می‌کند. صرفاً پاک نکردنش هم غلط بود:
 * اگر کس دیگری روی همان مرورگر وارد می‌شد، تحلیلِ نفر قبلی را می‌دید.
 *
 * ⚠️ نقاط با زمان ذخیره می‌شوند نه شماره‌ی کندل (src/chart/timeIndex.ts). این
 * تنها دلیلی است که بازخوانی در نشستِ دیگر اصلاً معنا پیدا می‌کند.
 */

import type { Drawing, DrawingKind } from './geometry';
import { POINTS_NEEDED } from './geometry';

const KEY = 'goldemy_chart_drawings';

/**
 * سقف تعداد رسم — باید با MAX_PER_USER در سرور یکی بماند
 * (server/services/drawingStore.js).
 */
const MAX_STORED = 300;

const KINDS: DrawingKind[] = ['trend', 'hline', 'vline', 'rect', 'fib', 'channel', 'measure', 'text'];

/**
 * اعتبارسنجی یک رسمِ خوانده‌شده.
 *
 * کشِ محلی غیرقابل‌اعتماد است: هم می‌تواند از نسخه‌ی قدیمی‌تر برنامه مانده باشد،
 * هم دستکاری شده باشد. یک رکورد خراب نباید کل چارت را بشکند، پس هرچه از این
 * فیلتر رد نشود بی‌صدا کنار گذاشته می‌شود.
 */
function isValid(value: unknown): value is Drawing {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  if (typeof d.id !== 'string' || !KINDS.includes(d.kind as DrawingKind)) return false;
  if (!Array.isArray(d.points) || d.points.length !== POINTS_NEEDED[d.kind as DrawingKind]) return false;

  return d.points.every((p: unknown) => {
    if (!p || typeof p !== 'object') return false;
    const point = p as Record<string, unknown>;
    // 🐛 نسخه‌ی خیلی قدیمی به‌جای time فیلد logical داشت. آن رکوردها اینجا رد
    // می‌شوند — بازگرداندنشان ممکن نیست چون شماره‌ی کندل بدون آرایه‌ی همان لحظه
    // معنا ندارد.
    return Number.isFinite(point.time) && Number.isFinite(point.price);
  });
}

// ══════════════════════════════════════════════
// کشِ محلی
// ══════════════════════════════════════════════

export function loadCachedDrawings(): Drawing[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid).slice(-MAX_STORED) : [];
  } catch {
    return [];
  }
}

export function cacheDrawings(drawings: Drawing[]): void {
  try {
    if (drawings.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(drawings.slice(-MAX_STORED)));
  } catch {
    // سهمیه‌ی پر یا حالت ناشناس مرورگر — نبودِ کش نباید رسم کردن را بشکند
  }
}

/**
 * پاک کردن کشِ محلی هنگام خروج.
 *
 * 🛡️ این یک تصمیم امنیتی است، نه تمیزکاری: بدون آن، نفر بعدی که روی همین
 * مرورگر وارد شود تحلیل کاربر قبلی را می‌بیند. نسخه‌ی سرور دست‌نخورده می‌ماند و
 * با ورود دوباره برمی‌گردد.
 */
export function clearCachedDrawings(): void {
  try { localStorage.removeItem(KEY); } catch { /* بی‌اهمیت */ }
}

// ══════════════════════════════════════════════
// همگام‌سازی با سرور
// ══════════════════════════════════════════════

/**
 * رسم‌های ذخیره‌شده‌ی کاربر را از سرور می‌گیرد.
 *
 * @returns فهرست رسم‌ها، یا null اگر سرور در دسترس نبود — که با «کاربر رسمی
 *   ندارد» یکی نیست. در حالت null باید کشِ محلی نگه داشته شود، وگرنه یک قطعیِ
 *   لحظه‌ای اینترنت، تحلیل کاربر را از جلوی چشمش پاک می‌کند.
 */
export async function fetchDrawings(token: string): Promise<Drawing[] | null> {
  try {
    const res = await fetch('/api/user/drawings', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.drawings) ? data.drawings.filter(isValid) : [];
  } catch {
    return null;
  }
}

/** وضعیت فعلی را روی سرور می‌نویسد. خطا بی‌صداست: کش محلی هنوز سرِ جایش است. */
export async function pushDrawings(token: string, drawings: Drawing[]): Promise<boolean> {
  try {
    const res = await fetch('/api/user/drawings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ drawings: drawings.slice(-MAX_STORED) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
