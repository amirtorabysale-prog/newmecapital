/**
 * Goldemy — شکل‌ها و هندسه‌ی رسم روی چارت
 *
 * تعریف انواع رسم و ریاضیِ «کاربر روی کدام رسم کلیک کرد».
 *
 * عمداً از لایه‌ی رسم جداست و هیچ وابستگی‌ای ندارد. اشتباه این توابع به‌صورت
 * «نمی‌توانم خطی را که کشیده‌ام بگیرم» به کاربر می‌رسد، پس باید بشود تستش کرد.
 */

/** یک نقطه روی چارت: جای افقی به‌صورت زمان (ثانیه)، جای عمودی به‌صورت قیمت. */
export interface ChartPoint {
  time: number;
  price: number;
}

export type DrawingKind =
  | 'trend'    // خط روند — دو نقطه
  | 'hline'    // خط افقی (حمایت/مقاومت) — یک نقطه
  | 'vline'    // خط عمودی (نشانه‌گذاری زمان) — یک نقطه
  | 'rect'     // ناحیه‌ی عرضه/تقاضا — دو نقطه
  | 'fib'      // اصلاح فیبوناچی — دو نقطه
  | 'channel'  // کانال موازی — سه نقطه
  | 'measure'  // خط‌کش: چقدر حرکت، چند درصد، چند کندل — دو نقطه
  | 'text';    // یادداشت روی چارت — یک نقطه

export interface Drawing {
  id: string;
  kind: DrawingKind;
  points: ChartPoint[];
  /** فقط برای ابزار متن. */
  text?: string;
  /**
   * نشانگر سناریو در لحظه‌ای که این رسم *ساخته* شد — نه لحظه‌ی جابه‌جایی‌اش.
   * میدان تصمیم از این برای سنجش «پیش از ورود تحلیل کردی یا بعدش» استفاده
   * می‌کند (server/services/analysisScore.js). جای دیگری معنا ندارد.
   */
  atCursor?: number;
}

/** چند کلیک لازم است تا هر ابزار کامل شود. */
export const POINTS_NEEDED: Record<DrawingKind, number> = {
  hline: 1, vline: 1, text: 1,
  trend: 2, rect: 2, fib: 2, measure: 2,
  channel: 3,
};

/** سطوح اصلاح فیبوناچی — همان‌هایی که در تحلیل تکنیکال مرسوم‌اند. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** تا این فاصله (پیکسل) از یک رسم، کلیک روی آن حساب می‌شود. */
export const HIT_TOLERANCE = 7;

/** تا این فاصله از یک دستگیره، گرفتنِ همان نقطه حساب می‌شود (نه کل شکل). */
export const HANDLE_TOLERANCE = 9;

export type Point = { x: number; y: number };

// ══════════════════════════════════════════════
// هندسه
// ══════════════════════════════════════════════

/** فاصله‌ی یک نقطه تا پاره‌خط — پایه‌ی تشخیص «روی کدام رسم کلیک شد». */
export function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** نزدیک‌ترین فاصله تا مرزهای یک مستطیل (نه داخلش). */
function distanceToRectEdges(px: number, py: number, a: Point, b: Point): number {
  const c1 = { x: a.x, y: a.y }, c2 = { x: b.x, y: a.y };
  const c3 = { x: b.x, y: b.y }, c4 = { x: a.x, y: b.y };
  return Math.min(
    distanceToSegment(px, py, c1, c2),
    distanceToSegment(px, py, c2, c3),
    distanceToSegment(px, py, c3, c4),
    distanceToSegment(px, py, c4, c1),
  );
}

/**
 * فاصله تا یک رسم، بر حسب نوعش.
 *
 * روی مختصات پیکسلیِ همین لحظه کار می‌کند نه مختصات منطقی، چون آنچه کاربر
 * می‌بیند و رویش کلیک می‌کند همین است — با هر زوم فاصله‌ی منطقی عوض می‌شود
 * ولی «هفت پیکسل از خط» همیشه همان حسِ دقتِ انگشت و موس را می‌دهد.
 */
export function distanceToShape(px: number, py: number, kind: DrawingKind, pts: Point[]): number {
  if (pts.length === 0) return Infinity;

  switch (kind) {
    case 'hline':
      return Math.abs(py - pts[0].y);
    case 'vline':
      return Math.abs(px - pts[0].x);
    case 'text':
      // کادر تقریبیِ متن؛ دقت پیکسلی لازم نیست، فقط باید قابل گرفتن باشد
      return px >= pts[0].x - 6 && px <= pts[0].x + 90 && Math.abs(py - pts[0].y) <= 10
        ? 0 : Math.hypot(px - pts[0].x, py - pts[0].y);
    case 'trend':
      return pts.length < 2 ? Infinity : distanceToSegment(px, py, pts[0], pts[1]);
    case 'rect':
    case 'measure':
      return pts.length < 2 ? Infinity : distanceToRectEdges(px, py, pts[0], pts[1]);
    case 'fib': {
      if (pts.length < 2) return Infinity;
      // نزدیک‌ترین سطح فیبوناچی
      let best = Infinity;
      for (const level of FIB_LEVELS) {
        const y = pts[0].y + (pts[1].y - pts[0].y) * level;
        best = Math.min(best, Math.abs(py - y));
      }
      return best;
    }
    case 'channel': {
      if (pts.length < 3) return Infinity;
      const offset = channelOffset(pts);
      const base = distanceToSegment(px, py, pts[0], pts[1]);
      const parallel = distanceToSegment(
        px, py,
        { x: pts[0].x, y: pts[0].y + offset },
        { x: pts[1].x, y: pts[1].y + offset },
      );
      return Math.min(base, parallel);
    }
    default:
      return Infinity;
  }
}

/** جابه‌جایی عمودیِ خط دومِ کانال، از روی نقطه‌ی سوم. */
export function channelOffset(pts: Point[]): number {
  const [a, b, c] = pts;
  if (Math.abs(b.x - a.x) < 0.001) return c.y - a.y;
  const slope = (b.y - a.y) / (b.x - a.x);
  const yOnBase = a.y + slope * (c.x - a.x);
  return c.y - yOnBase;
}
