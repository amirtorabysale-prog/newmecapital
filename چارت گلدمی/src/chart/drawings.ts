/**
 * Goldemy — ابزار رسم روی چارت
 *
 * lightweight-charts فقط خط افقی ساده دارد. بقیه‌ی ابزارها — خط روند، کانال،
 * فیبوناچی، ناحیه، خط‌کش — اینجا با «Series Primitive» ساخته شده‌اند: کتابخانه
 * اجازه می‌دهد یک شیء با متد draw به سری وصل شود و روی همان بوم چارت بکشد، پس
 * رسم‌ها دقیقاً با زوم و اسکرول چارت حرکت می‌کنند — برخلاف کشیدن روی یک لایه‌ی
 * جدا که موقع جابه‌جایی از داده عقب می‌ماند.
 *
 * ⚠️ نقاط با **زمان** ذخیره می‌شوند، نه با شماره‌ی کندل.
 *
 * 🐛 پیش‌تر شماره‌ی منطقیِ کندل (logical) ذخیره می‌شد. دو مشکل داشت که هر دو را
 * کاربر می‌دید:
 *
 *   ۱. با رفرش صفحه، آرایه‌ی کندل عوض می‌شود (کندل تازه آمده، قدیمی هرس شده).
 *      شماره‌ی ۲۵۰ بعد از رفرش به کندلِ دیگری اشاره می‌کرد، پس تحلیل جابه‌جا
 *      می‌شد — و چون اصلاً ذخیره نمی‌شد، عملاً می‌پرید.
 *   ۲. با عوض کردن تایم‌فریم، شماره‌ها کاملاً بی‌معنا می‌شدند: کندل شماره‌ی ۲۵۰
 *      در یک‌دقیقه‌ای و در پانزده‌دقیقه‌ای دو زمان کاملاً متفاوت‌اند.
 *
 * زمان لنگرِ درستی است چون به داده‌ی جلوی چشم وابسته نیست. تنها چیزی که برای
 * تبدیلِ زمان به مختصات لازم است، همان آرایه‌ی کندلِ فعلی است — و برای زمان‌هایی
 * که هنوز کندل ندارند (فضای خالی سمت راست، جایی که تحلیل به آینده امتداد داده
 * می‌شود) با فاصله‌ی ثابتِ تایم‌فریم برون‌یابی می‌شود.
 */

import type {
  ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer,
  SeriesAttachedParameter, Time, ISeriesApi, SeriesType, IChartApi, Logical,
} from 'lightweight-charts';

// ریاضیِ تبدیل در فایل خودش است تا خالص و تست‌پذیر بماند. اینجا دوباره صادر
// می‌شود چون مصرف‌کننده‌ها همه‌ی چیزهای مربوط به رسم را از همین ماژول می‌خواهند.
import { timeToLogical, isTimeInLoadedHistory, type TimeIndex } from './timeIndex';
import {
  distanceToShape, channelOffset, FIB_LEVELS, HIT_TOLERANCE, HANDLE_TOLERANCE,
  type ChartPoint, type Drawing, type DrawingKind, type Point,
} from './geometry';
import { formatPercent, formatPrice } from '../lib/format';
import { CHART_LABEL, CHART_MARKET, CHART_SURFACE, DRAWING_COLORS } from '../lib/theme';

// ریاضیِ خالص در دو ماژول جدا زندگی می‌کند تا تست‌پذیر بماند. اینجا دوباره
// صادر می‌شود چون مصرف‌کننده‌ها همه‌ی چیزهای مربوط به رسم را از همین یک ماژول
// می‌خواهند و نباید مجبور شوند بدانند کدام تکه کجاست.
export {
  buildTimeIndex, timeToLogical, logicalToTime, isTimeInLoadedHistory, type TimeIndex,
} from './timeIndex';
export {
  POINTS_NEEDED, FIB_LEVELS, HIT_TOLERANCE, HANDLE_TOLERANCE,
  distanceToSegment, distanceToShape,
  type ChartPoint, type Drawing, type DrawingKind, type Point,
} from './geometry';

/**
 * هر ابزار رنگ خودش را دارد — قبلاً همه (خط روند، سطح، ناحیه، فیبوناچی، کانال)
 * دقیقاً یک رنگِ طلایی بودند و روی چارتِ شلوغ از هم قابل تشخیص نبودند. خط‌کش
 * قاعده‌ی خودش را دارد (سبز/قرمز بر اساسِ جهتِ حرکت) و اینجا دخالتی نمی‌کند.
 */
// رنگ‌ها همه از src/lib/theme.ts می‌آیند — یک منبع، تا نسخه‌ی دوم از سبزِ
// بازار دوباره اینجا متولد نشود (یک‌بار شد).
const KIND_COLOR: Record<DrawingKind, string> = DRAWING_COLORS;
const COLOR_SELECTED = CHART_LABEL.selected;
const COLOR_UP = CHART_MARKET.up;
const COLOR_DOWN = CHART_MARKET.down;
const LABEL_BG = CHART_LABEL.background;
const WIDTH = 1.6;
const WIDTH_SELECTED = 2.6;
const HANDLE_RADIUS = 4;
const HANDLE_RADIUS_SELECTED = 5.5;

/** نسخه‌ی نیمه‌شفافِ رنگ یک ابزار — برای پیش‌نمایشِ در حالِ کشیدن و بدنه‌ی ناحیه/کانال. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const fmtPrice = (n: number) => formatPrice(n);

type Shape = {
  id: string | null;
  kind: DrawingKind;
  pts: Point[];
  /** نقاط اصلیِ چارتی — برای برچسب‌هایی که به قیمت و زمان نیاز دارند. */
  raw: ChartPoint[];
  /** فاصله بر حسب تعداد کندل — خط‌کش لازمش دارد. */
  bars: number;
  selected: boolean;
  preview: boolean;
  text?: string;
};

// ══════════════════════════════════════════════
// رسم
// ══════════════════════════════════════════════

class DrawingsRenderer implements IPrimitivePaneRenderer {
  private readonly shapes: Shape[];

  constructor(shapes: Shape[]) { this.shapes = shapes; }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context as CanvasRenderingContext2D;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const size = scope.mediaSize as { width: number; height: number };

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const shape of this.shapes) {
        const base = KIND_COLOR[shape.kind];
        const color = shape.preview ? withAlpha(base, 0.55) : shape.selected ? COLOR_SELECTED : base;
        const lineWidth = (shape.selected ? WIDTH_SELECTED : WIDTH) * hr;

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(shape.preview ? [6 * hr, 5 * hr] : []);

        this.drawShape(ctx, shape, { hr, vr, size, color, fill: withAlpha(base, 0.09) });

        ctx.setLineDash([]);
        if (!shape.preview || shape.pts.length > 1) this.drawHandles(ctx, shape, hr, vr, color);
      }

      ctx.restore();
    });
  }

  private drawShape(
    ctx: CanvasRenderingContext2D,
    shape: Shape,
    env: { hr: number; vr: number; size: { width: number; height: number }; color: string; fill: string },
  ) {
    const { hr, vr, size, color, fill } = env;
    const { kind, pts, raw } = shape;
    const line = (a: Point, b: Point) => {
      ctx.beginPath();
      ctx.moveTo(a.x * hr, a.y * vr);
      ctx.lineTo(b.x * hr, b.y * vr);
      ctx.stroke();
    };

    switch (kind) {
      case 'hline': {
        line({ x: 0, y: pts[0].y }, { x: size.width, y: pts[0].y });
        label(ctx, fmtPrice(raw[0].price), size.width - 6, pts[0].y, hr, vr, color, 'right');
        break;
      }

      case 'vline': {
        line({ x: pts[0].x, y: 0 }, { x: pts[0].x, y: size.height });
        break;
      }

      case 'text': {
        label(ctx, shape.text || '...', pts[0].x, pts[0].y, hr, vr, color, 'left');
        break;
      }

      case 'trend': {
        if (pts.length < 2) break;
        line(pts[0], pts[1]);
        break;
      }

      case 'rect': {
        if (pts.length < 2) break;
        const x = Math.min(pts[0].x, pts[1].x);
        const y = Math.min(pts[0].y, pts[1].y);
        const w = Math.abs(pts[1].x - pts[0].x);
        const h = Math.abs(pts[1].y - pts[0].y);
        ctx.fillStyle = fill;
        ctx.fillRect(x * hr, y * vr, w * hr, h * vr);
        ctx.fillStyle = color;
        ctx.strokeRect(x * hr, y * vr, w * hr, h * vr);
        break;
      }

      case 'fib': {
        if (pts.length < 2) break;
        const [a, b] = pts;
        const x1 = Math.min(a.x, b.x);
        const x2 = Math.max(a.x, b.x);
        // امتداد تا لبه‌ی راست: سطوح فیبوناچی برای آینده کشیده می‌شوند، نه گذشته
        const right = Math.max(x2, size.width);
        for (const level of FIB_LEVELS) {
          const y = a.y + (b.y - a.y) * level;
          const price = raw[0].price + (raw[1].price - raw[0].price) * level;
          ctx.globalAlpha = level === 0 || level === 1 ? 1 : 0.7;
          line({ x: x1, y }, { x: right, y });
          ctx.globalAlpha = 1;
          label(ctx, `${formatPercent(level * 100)} · ${fmtPrice(price)}`, x1 + 6, y, hr, vr, color, 'left');
        }
        break;
      }

      case 'channel': {
        if (pts.length < 2) break;
        line(pts[0], pts[1]);
        if (pts.length < 3) break;
        const offset = channelOffset(pts);
        const p0 = { x: pts[0].x, y: pts[0].y + offset };
        const p1 = { x: pts[1].x, y: pts[1].y + offset };
        line(p0, p1);
        // بدنه‌ی کانال، تا مسیر حرکت قیمت داخلش دیده شود
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(pts[0].x * hr, pts[0].y * vr);
        ctx.lineTo(pts[1].x * hr, pts[1].y * vr);
        ctx.lineTo(p1.x * hr, p1.y * vr);
        ctx.lineTo(p0.x * hr, p0.y * vr);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = color;
        break;
      }

      case 'measure': {
        if (pts.length < 2) break;
        const [a, b] = pts;
        const rising = raw[1].price >= raw[0].price;
        const tone = rising ? COLOR_UP : COLOR_DOWN;
        ctx.strokeStyle = tone;
        // تهِ کم‌رنگِ خط‌کش — از همان توکنِ جهت بازار، تا با تغییرش جا نماند.
        ctx.fillStyle = rising ? `${CHART_MARKET.up}1a` : `${CHART_MARKET.down}1a`;

        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        ctx.fillRect(x * hr, y * vr, Math.abs(b.x - a.x) * hr, Math.abs(b.y - a.y) * vr);
        ctx.strokeRect(x * hr, y * vr, Math.abs(b.x - a.x) * hr, Math.abs(b.y - a.y) * vr);

        // پیکان جهت حرکت
        ctx.beginPath();
        ctx.moveTo(a.x * hr, a.y * vr);
        ctx.lineTo(b.x * hr, b.y * vr);
        ctx.stroke();

        const delta = raw[1].price - raw[0].price;
        const percent = raw[0].price ? (delta / raw[0].price) * 100 : 0;
        const text = `${delta >= 0 ? '+' : '−'}${fmtPrice(Math.abs(delta))} · ${percent >= 0 ? '+' : '−'}${formatPercent(Math.abs(percent), 2)} · ${shape.bars} کندل`;
        label(ctx, text, (a.x + b.x) / 2, Math.min(a.y, b.y) - 12, hr, vr, tone, 'center');
        break;
      }
    }
  }

  private drawHandles(ctx: CanvasRenderingContext2D, shape: Shape, hr: number, vr: number, color: string) {
    if (shape.kind === 'text') return;
    const radius = (shape.selected ? HANDLE_RADIUS_SELECTED : HANDLE_RADIUS) * hr;
    ctx.fillStyle = color;
    for (const p of shape.pts) {
      ctx.beginPath();
      ctx.arc(p.x * hr, p.y * vr, radius, 0, Math.PI * 2);
      ctx.fill();
      // حلقه‌ی تیره دور دستگیره تا روی کندل‌ها گم نشود
      ctx.strokeStyle = CHART_SURFACE.background;
      ctx.lineWidth = 1.5 * hr;
      ctx.stroke();
    }
    ctx.strokeStyle = color;
  }
}

/** برچسب کوچک با پس‌زمینه — بدون آن، عدد روی کندل‌ها خوانده نمی‌شود. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  hr: number, vr: number,
  color: string,
  align: 'left' | 'right' | 'center',
) {
  const fontSize = 10;
  ctx.font = `${fontSize * hr}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width;
  const padX = 4 * hr;
  const padY = 3 * vr;

  let left = x * hr;
  if (align === 'right') left = x * hr - width - padX * 2;
  else if (align === 'center') left = x * hr - width / 2 - padX;

  ctx.fillStyle = LABEL_BG;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(left, y * vr - fontSize * vr / 2 - padY, width + padX * 2, fontSize * vr + padY * 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(text, left + padX, y * vr);
}

// ══════════════════════════════════════════════
// اتصال به چارت
// ══════════════════════════════════════════════

class DrawingsPaneView implements IPrimitivePaneView {
  private shapes: Shape[] = [];

  private readonly source: DrawingsPrimitive;

  constructor(source: DrawingsPrimitive) { this.source = source; }

  /** شکل‌های پیکسلیِ همین لحظه — تشخیصِ کلیک از روی همین‌ها انجام می‌شود. */
  get current(): Shape[] { return this.shapes; }

  update() {
    const series = this.source.series;
    const chart = this.source.chart;
    if (!series || !chart) { this.shapes = []; return; }

    const ts = chart.timeScale();
    const index = this.source.timeIndex;

    const toPixel = (p: ChartPoint): Point | null => {
      // اگر تاریخچه هنوز تا زمان این تحلیل عقب نرفته، شکل را موقتاً پنهان کن.
      // نمایش آن با برون‌یابی منفی، همهٔ نقاط را روی لبهٔ چپ فشرده می‌کند.
      if (!isTimeInLoadedHistory(p.time, index)) return null;
      // زمان → شماره‌ی منطقی → پیکسل. مرحله‌ی وسط لازم است چون
      // timeToCoordinate فقط برای زمان‌هایی جواب می‌دهد که کندل دارند، و رسم
      // می‌تواند به فضای خالیِ آینده امتداد داشته باشد.
      const x = ts.logicalToCoordinate(timeToLogical(p.time, index) as Logical);
      const y = series.priceToCoordinate(p.price);
      return x === null || y === null ? null : { x, y };
    };

    const build = (d: Drawing, preview: boolean): Shape | null => {
      const pts: Point[] = [];
      for (const p of d.points) {
        const px = toPixel(p);
        if (!px) return null;
        pts.push(px);
      }
      if (pts.length === 0) return null;
      const bars = d.points.length >= 2
        ? Math.abs(Math.round(timeToLogical(d.points[1].time, index) - timeToLogical(d.points[0].time, index)))
        : 0;
      return {
        id: preview ? null : d.id,
        kind: d.kind,
        pts,
        raw: d.points,
        bars,
        selected: !preview && d.id === this.source.selectedId,
        preview,
        text: d.text,
      };
    };

    const out: Shape[] = [];
    for (const d of this.source.drawings) {
      if (d.id === this.source.hiddenId) continue;
      const shape = build(d, false);
      if (shape) out.push(shape);
    }
    if (this.source.preview) {
      const shape = build(this.source.preview, true);
      if (shape) out.push(shape);
    }
    this.shapes = out;
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.shapes.length === 0 ? null : new DrawingsRenderer(this.shapes);
  }
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  drawings: Drawing[] = [];
  /** رسمی که هنوز کامل نشده — با حرکت موس به‌روز می‌شود. */
  preview: Drawing | null = null;
  /** رسم انتخاب‌شده — پررنگ‌تر کشیده می‌شود و با Delete پاک می‌شود. */
  selectedId: string | null = null;
  /** رسمی که همین حالا در حال کشیده شدن است و نسخه‌ی پیش‌نمایش جایش را گرفته. */
  hiddenId: string | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  chart: IChartApi | null = null;
  /** جدول زمانِ کندل‌های فعلی — مبنای تبدیل زمانِ ذخیره‌شده به مختصات صفحه. */
  timeIndex: TimeIndex = { times: [], step: 60 };
  private readonly view = new DrawingsPaneView(this);
  /**
   * کتابخانه فقط وقتی داده یا نمای چارت عوض شود دوباره رسم می‌کند. تغییر رسم‌های
   * این primitive هیچ‌کدام از آن دو نیست، پس بدون صدا زدن این، رسمِ تازه کشیده‌شده
   * تا اولین زوم یا تیک بعدی نامرئی می‌ماند.
   */
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this.series = param.series;
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  updateAllViews() { this.view.update(); }
  paneViews() { return [this.view]; }

  private refresh() {
    this.view.update();
    this.requestUpdate?.();
  }

  setDrawings(drawings: Drawing[]) {
    this.drawings = drawings;
    this.refresh();
  }

  setPreview(preview: Drawing | null) {
    this.preview = preview;
    this.refresh();
  }

  /**
   * هنگام کشیدن، نسخه‌ی اصلی پنهان می‌شود و پیش‌نمایش جایش را می‌گیرد.
   * بدون این، شکل قدیمی و شکل در حال حرکت هم‌زمان دیده می‌شوند.
   */
  setHidden(id: string | null) {
    if (this.hiddenId === id) return;
    this.hiddenId = id;
    this.refresh();
  }

  setSelected(id: string | null) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.refresh();
  }

  /**
   * جدول زمان با هر تغییر داده یا تایم‌فریم به‌روز می‌شود.
   *
   * بدون این، رسم‌ها بعد از هر کندل تازه یک کندل جابه‌جا دیده می‌شدند.
   */
  setTimeIndex(index: TimeIndex) {
    this.timeIndex = index;
    this.refresh();
  }

  /** کدام رسم زیر این نقطه‌ی صفحه است؟ نزدیک‌ترین برنده است. */
  drawingAt(x: number, y: number): string | null {
    let best: { id: string; d: number } | null = null;
    for (const s of this.view.current) {
      if (s.preview || !s.id) continue;
      const d = distanceToShape(x, y, s.kind, s.pts);
      if (d <= HIT_TOLERANCE && (!best || d < best.d)) best = { id: s.id, d };
    }
    return best?.id ?? null;
  }

  /**
   * چه چیزی زیر این نقطه است — یک دستگیره، یا بدنه‌ی یک رسم؟
   *
   * ترتیب اهمیت دارد: دستگیره‌ها اول بررسی می‌شوند. روی خط روند، دستگیره
   * *روی* خط است، پس اگر اول بدنه چک شود کاربر هیچ‌وقت نمی‌تواند تک‌نقطه را
   * بگیرد و همیشه کل شکل جابه‌جا می‌شود.
   *
   * رسمِ انتخاب‌شده اولویت دارد: وقتی چند رسم روی هم افتاده‌اند، کاربر انتظار
   * دارد همانی را بگیرد که همین حالا انتخاب کرده.
   */
  grabAt(x: number, y: number): { id: string; pointIndex: number | null } | null {
    const shapes = this.view.current.filter((s) => !s.preview && s.id);
    const ordered = [
      ...shapes.filter((s) => s.id === this.selectedId),
      ...shapes.filter((s) => s.id !== this.selectedId),
    ];

    for (const s of ordered) {
      for (let i = 0; i < s.pts.length; i++) {
        if (Math.hypot(x - s.pts[i].x, y - s.pts[i].y) <= HANDLE_TOLERANCE) {
          return { id: s.id!, pointIndex: i };
        }
      }
    }

    let best: { id: string; d: number } | null = null;
    for (const s of ordered) {
      const d = distanceToShape(x, y, s.kind, s.pts);
      if (d <= HIT_TOLERANCE && (!best || d < best.d)) best = { id: s.id!, d };
    }
    return best ? { id: best.id, pointIndex: null } : null;
  }
}
