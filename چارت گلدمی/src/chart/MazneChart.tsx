/**
 * Goldemy — چارت شمعیِ قیمت گرم
 *
 * روی همان قیمتی رسم می‌شود که کاربر واقعاً معامله می‌کند (برخلاف ویجت
 * تریدینگ‌ویو که اونس جهانی به دلار را نشان می‌دهد). کندل‌ها را خودِ سرور
 * می‌سازد (server/services/marketEngine.js) و با پیام‌های INIT و CANDLE_UPDATE
 * می‌فرستد.
 *
 * ⚠️ این کامپوننت عمداً «کنترل‌شده» است: کندل‌ها را فقط به‌عنوان prop می‌گیرد و
 * هیچ اطلاعی از WebSocket، موتور بازار یا وضعیت کاربر ندارد. هر آرایه‌ی کندلی
 * که به آن بدهی رسم می‌شود و چیزی جز آن نمی‌شناسد.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from 'lightweight-charts';

import { X } from 'lucide-react';

import type { Candle, OrderType } from '../types';
import type { Timeframe } from './candles';
import {
  DrawingsPrimitive, POINTS_NEEDED, buildTimeIndex, logicalToTime,
  type Drawing, type ChartPoint,
} from './drawings';
import type { ChartTool } from './tools';
import { CHART_MARKER, CHART_MARKET, CHART_SURFACE, candleColors, chartLayout } from '../lib/theme';
import { formatPrice } from '../lib/format';
import { TOOL_LABEL } from './tools';
import { PositionZoneOverlay, type PositionZoneMark } from './positionZone';

/** یک پوزیشن باز — همان چیزی که روی چارت با خط ورود/حد ضرر/حد سود مشخص می‌شود. */
export type ChartPosition = {
  id: string;
  type: OrderType;
  entryPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

/** پیش‌نمایشِ فرم سفارش — پیش از ثبت، همان‌طور که کاربر درصد را عوض می‌کند. */
export type ChartPreview = {
  side: OrderType;
  entry: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskAmount?: number | null;
  rewardAmount?: number | null;
};

/**
 * شبحِ آخرین معامله‌ی ضررده — وقتی کاربر تازه ضرر کرده و ممکن است چند دقیقه‌ی
 * بعد یک معامله‌ی انتقامی بزند، همین معامله‌ی قبلی روی چارت می‌ماند تا خودِ
 * تصویر یادآوری کند، نه فقط یک جمله. App.tsx تصمیم می‌گیرد کِی نشانش بدهد
 * (کمتر از پنجره‌ی همان تعریفِ انتقامیِ سرور — server/services/dnaEngine.js).
 */
export type GhostTrade = {
  side: OrderType;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
};

/**
 * نمای پیش‌فرض چارت: چند کندل آخر، نه همه‌ی تاریخچه.
 *
 * سرور تا MAX_CANDLES (سه هزار) کندل نگه می‌دارد. اگر همه‌ی آن‌ها را در عرض
 * صفحه جا بدهیم، هر کندل کسری از یک پیکسل می‌شود و چارت به یک خط ممتد تبدیل
 * می‌شود. این عدد طوری انتخاب شده که هم بدنه و سایه‌ی هر کندل جدا دیده شود، هم
 * روند چند ساعت گذشته در یک نگاه بیاید.
 */
const DEFAULT_VISIBLE_BARS = 90;

/** فضای خالی سمت راست، بر حسب تعداد کندل. */
const RIGHT_OFFSET_BARS = 12;

/** آخرین کندل‌ها را در کادر می‌گذارد، با فضای خالی سمت راست. */
function frameRecent(chart: IChartApi | null, total: number) {
  if (!chart || total === 0) return;
  chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, total - DEFAULT_VISIBLE_BARS),
    to: total - 1 + RIGHT_OFFSET_BARS,
  });
}

export function MazneChart({
  candles, timeframe, tool, drawings, magnet, onAddDrawing, onUpdate, onRemove, onToolDone, resetSignal, onVisibleCountChange,
  positions, preview, ghostTrade,
}: {
  candles: Candle[];
  timeframe: Timeframe;
  tool: ChartTool;
  drawings: Drawing[];
  /** آهنربا: نشانگر روی قیمت کندل می‌چسبد. */
  magnet: boolean;
  onAddDrawing: (drawing: Drawing) => void;
  /** جابه‌جایی یا ویرایش یک رسمِ موجود — فقط وقتی کشیدن واقعاً انجام شده صدا زده می‌شود. */
  onUpdate: (drawing: Drawing) => void;
  onRemove: (id: string) => void;
  /** بعد از کامل شدن یک رسم، ابزار به حالت انتخاب برمی‌گردد. */
  onToolDone: () => void;
  /** با هر بار افزایش، نمای چارت به حالت پیش‌فرض برمی‌گردد. */
  resetSignal: number;
  /** تعداد کندلی که همین حالا جلوی چشم کاربر است — مربی برای تحلیل لازمش دارد. */
  onVisibleCountChange?: (count: number) => void;
  /** پوزیشن‌های باز — خط ورود/حد ضرر/حد سود هرکدام روی چارت کشیده می‌شود. */
  positions?: ChartPosition[];
  /** پیش‌نمایشِ فرم سفارش، پیش از ثبت — با نقطه‌چین از پوزیشن باز جدا می‌شود. */
  preview?: ChartPreview | null;
  /** شبحِ آخرین معامله‌ی ضررده — فقط چند دقیقه‌ی بعد از یک ضرر نشان داده می‌شود. */
  ghostTrade?: GhostTrade | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const primitiveRef = useRef<DrawingsPrimitive | null>(null);
  /** خط‌های ورود/حد ضرر/حد سودِ پوزیشن‌های باز و پیش‌نمایش — هر بار از نو ساخته می‌شوند. */
  const positionLinesRef = useRef<IPriceLine[]>([]);
  /** نقاطی که تا حالا برای رسمِ در جریان زده شده‌اند. */
  const pendingRef = useRef<ChartPoint[]>([]);

  /**
   * وضعیت کشیدنِ در جریان.
   *
   * pointIndex برابر null یعنی کل شکل گرفته شده، نه یک دستگیره.
   * تا وقتی moved نشده، رها کردن فقط یک کلیکِ انتخاب حساب می‌شود و هیچ تغییری
   * ثبت نمی‌شود — وگرنه هر بار انتخاب کردنِ یک خط، یک ذخیره‌ی بی‌مورد می‌ساخت.
   */
  const dragRef = useRef<{
    id: string;
    pointIndex: number | null;
    origin: ChartPoint;
    startPoints: ChartPoint[];
    points?: ChartPoint[];
    moved: boolean;
  } | null>(null);

  // رسم‌ها و تابع به‌روزرسانی در ref هم نگه داشته می‌شوند: هندلرهای موس فقط
  // یک‌بار ثبت می‌شوند و نباید به مقدارِ لحظه‌ی ثبت گیر کنند.
  const drawingsRef = useRef<Drawing[]>(drawings);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  const updateRef = useRef(onUpdate);
  useEffect(() => { updateRef.current = onUpdate; }, [onUpdate]);
  /** تعداد کندل‌های بارگذاری‌شده — هم برای تشخیص «کندل تازه» از «آپدیت همان کندل»، هم برای بریدن محدوده‌ی دید. */
  const loadedCountRef = useRef(0);

  // ابزار در ref هم نگه داشته می‌شود چون هندلر کلیک فقط یک‌بار ثبت می‌شود
  const toolRef = useRef<ChartTool>(tool);
  // همین‌طور گزارشِ محدوده‌ی دید — تا تغییرش چارت را از نو نسازد
  const visibleCbRef = useRef(onVisibleCountChange);
  useEffect(() => { visibleCbRef.current = onVisibleCountChange; }, [onVisibleCountChange]);

  /** رسمی که کاربر انتخاب کرده تا حذفش کند. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  /** آیا نشانگر روی یک رسم است؟ فقط برای عوض کردن شکل نشانگر. */
  const [hoveringDrawing, setHoveringDrawing] = useState(false);
  /** فقط برای شکل نشانگر — منطق کشیدن در dragRef است. */
  const [dragging, setDragging] = useState(false);
  /** چند نقطه از رسمِ در جریان زده شده — برای راهنمای پایین چارت. */
  const [pendingCount, setPendingCount] = useState(0);
  /** ابزار متن بعد از کلیک منتظر نوشتنِ کاربر می‌ماند. */
  const [textDraft, setTextDraft] = useState<{ point: ChartPoint; value: string } | null>(null);

  const cancelDrawing = useCallback(() => {
    pendingRef.current = [];
    primitiveRef.current?.setPreview(null);
    setPendingCount(0);
    setTextDraft(null);
  }, []);

  useEffect(() => { toolRef.current = tool; cancelDrawing(); setSelectedId(null); }, [tool, cancelDrawing]);

  // آهنربا بدون بازسازی چارت روشن و خاموش می‌شود
  useEffect(() => {
    chartRef.current?.applyOptions({ crosshair: { mode: magnet ? 1 : 0 } });
  }, [magnet]);

  // انتخاب به primitive هم گفته می‌شود تا رسمِ انتخاب‌شده پررنگ‌تر کشیده شود
  useEffect(() => { primitiveRef.current?.setSelected(selectedId); }, [selectedId]);

  const removeSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    onRemove(id);
    setSelectedId(null);
  }, [onRemove]);

  // Escape رسمِ نیمه‌تمام را لغو می‌کند و Delete رسمِ انتخاب‌شده را پاک —
  // میان‌برهای استانداردی که کاربرِ آمده از تریدینگ‌ویو ناخودآگاه امتحان می‌کند.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') { cancelDrawing(); setSelectedId(null); }
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelDrawing, removeSelected]);

  const [hover, setHover] = useState<Candle | null>(null);

  /** آیا نمای پیش‌فرض یک‌بار تنظیم شده؟ بعد از آن، زوم کاربر محترم است. */
  const hasFramedRef = useRef(false);

  // ساخت چارت فقط یک‌بار — با تغییر داده دوباره ساخته نمی‌شود، فقط آپدیت می‌شود
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      ...chartLayout(),
      rightPriceScale: { borderColor: CHART_SURFACE.border, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: {
        borderColor: CHART_SURFACE.border, timeVisible: true, secondsVisible: false,
        // فضای خالی سمت راست: هم چند کندل آخر به لبه نمی‌چسبند، هم جا برای
        // امتداد دادن تحلیل به آینده باز می‌شود.
        rightOffset: RIGHT_OFFSET_BARS,
        // پهنای پیش‌فرض هر کندل. بدون این، مقدار پیش‌فرض کتابخانه (۶ پیکسل)
        // کندل‌ها را باریک‌تر از چیزی می‌کند که بشود بدنه و سایه را از هم تشخیص داد.
        barSpacing: 9,
        // کف زوم: کاربر می‌تواند عقب برود، ولی نه تا جایی که کندل‌ها دوباره
        // به یک خط ممتد تبدیل شوند.
        minBarSpacing: 2,
      },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      ...candleColors(),
      // جداکننده‌ی هزارگان روی محور: «22909000» روی چارتی که کاربر برای خواندنِ
      // قیمت نگاهش می‌کند، هشت رقمِ پشت‌سرهم است. ⚠️ `formatPrice` این‌جا امن
      // است چون قیمت هیچ‌وقت منفی نیست — خروجیِ منفیِ `num()` یک LRM ِ نامرئی
      // دارد که بوم مربعِ خالی می‌کشدش (CLAUDE.md، فاز ۲).
      priceFormat: { type: 'custom', minMove: 1000, formatter: (price: number) => formatPrice(price) },
    });

    const primitive = new DrawingsPrimitive();
    series.attachPrimitive(primitive);

    /**
     * مختصات نشانگر → نقطه‌ی چارت.
     * ⚠️ عمداً از param.time استفاده نمی‌شود: آن فقط روی کندل‌های موجود مقدار دارد،
     * پس با آن نمی‌شد در فضای خالیِ سمت راست چیزی کشید. coordinateToLogical از
     * آخرین کندل هم جلوتر می‌رود.
     */
    const pointFrom = (px: { x: number; y: number }): ChartPoint | null => {
      const logical = chart.timeScale().coordinateToLogical(px.x);
      const price = series.coordinateToPrice(px.y);
      if (logical === null || price === null) return null;
      // شماره‌ی منطقی فوراً به زمان تبدیل می‌شود: از این نقطه به بعد هیچ‌جای
      // برنامه شماره‌ی کندل را نگه نمی‌دارد، چون با رفرش و تعویض تایم‌فریم
      // بی‌معنا می‌شود.
      return { time: logicalToTime(logical as number, primitive.timeIndex), price: price as number };
    };

    chart.subscribeCrosshairMove((param) => {
      // خواندن OHLC زیر نشانگر — بدون این، کاربر عددِ دقیق کندل را نمی‌بیند
      const bar = param.seriesData.get(series) as any;
      if (!bar || bar.open === undefined) setHover(null);
      else setHover({ time: Number(param.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close });

      const activeTool = toolRef.current;

      // در حالت انتخاب، نشانگر روی رسم‌ها عوض می‌شود تا معلوم شود قابل گرفتن‌اند
      if (activeTool === 'none') {
        setHoveringDrawing(param.point ? primitive.drawingAt(param.point.x, param.point.y) !== null : false);
        return;
      }

      // پیش‌نمایش زنده: بعد از نقطه‌ی اول، شکل با موس حرکت می‌کند
      const pending = pendingRef.current;
      if (pending.length === 0 || !param.point) return;
      const cursor = pointFrom(param.point);
      if (cursor) {
        primitive.setPreview({ id: 'preview', kind: activeTool, points: [...pending, cursor] });
      }
    });

    // چند کندل واقعاً جلوی چشم کاربر است؟ محدوده‌ی منطقی می‌تواند از دو طرف بیرون
    // بزند (فضای خالی سمت راست)، پس به بازه‌ی داده‌ی موجود بریده می‌شود.
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || !visibleCbRef.current) return;
      const from = Math.max(0, Math.ceil(range.from));
      const to = Math.min(loadedCountRef.current - 1, Math.floor(range.to));
      visibleCbRef.current(Math.max(0, to - from + 1));
    });

    chart.subscribeClick((param) => {
      const activeTool = toolRef.current;
      if (!param.point) return;

      // حالت انتخاب: کلیک روی یک رسم انتخابش می‌کند و کلیک در جای خالی انتخاب را
      // برمی‌دارد — همان رفتاری که در ابزارهای حرفه‌ای عادت شده است.
      if (activeTool === 'none') {
        setSelectedId(primitive.drawingAt(param.point.x, param.point.y));
        return;
      }

      const point = pointFrom(param.point);
      if (!point) return;

      // متن قبل از ثبت به نوشته‌ی کاربر نیاز دارد، پس مسیرش جداست
      if (activeTool === 'text') {
        setTextDraft({ point, value: '' });
        return;
      }

      const points = [...pendingRef.current, point];
      if (points.length < POINTS_NEEDED[activeTool]) {
        pendingRef.current = points;
        setPendingCount(points.length);
        return;
      }

      onAddDrawing({ id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, kind: activeTool, points });
      pendingRef.current = [];
      primitive.setPreview(null);
      setPendingCount(0);
      onToolDone();
    });

    // ══════════════════════════════════════════════
    // گرفتن و جابه‌جا کردن رسم‌ها
    // ══════════════════════════════════════════════
    //
    // چرا با رویداد خامِ موس و نه subscribeClick: کتابخانه فقط «کلیک» می‌دهد،
    // یعنی فشردن و رها کردن با هم. برای کشیدن به سه رویداد جدا نیاز است.
    //
    // ⚠️ تا وقتی انگشت یا موس پایین است، اسکرول و زوم چارت خاموش می‌شود. بدون
    // آن، کشیدنِ خط هم‌زمان کل چارت را هم جابه‌جا می‌کند و هیچ‌کدام درست
    // درنمی‌آید.

    const localPoint = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const setChartInteraction = (enabled: boolean) => {
      chart.applyOptions({
        handleScroll: enabled,
        handleScale: enabled,
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (toolRef.current !== 'none' || e.button !== 0) return;
      const px = localPoint(e);
      const grab = primitive.grabAt(px.x, px.y);
      if (!grab) return;

      const origin = pointFrom(px);
      const target = drawingsRef.current.find((d) => d.id === grab.id);
      if (!origin || !target) return;

      dragRef.current = {
        id: grab.id,
        pointIndex: grab.pointIndex,
        origin,
        startPoints: target.points.map((p) => ({ ...p })),
        moved: false,
      };
      setSelectedId(grab.id);
      setDragging(true);
      setChartInteraction(false);
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const cursor = pointFrom(localPoint(e));
      if (!cursor) return;

      let points: ChartPoint[];
      if (drag.pointIndex === null) {
        // بدنه گرفته شده: همه‌ی نقاط با همان اختلاف جابه‌جا می‌شوند تا شکل حفظ شود
        const dt = cursor.time - drag.origin.time;
        const dp = cursor.price - drag.origin.price;
        points = drag.startPoints.map((p) => ({ time: p.time + dt, price: p.price + dp }));
      } else {
        points = drag.startPoints.map((p, i) => (i === drag.pointIndex ? cursor : p));
      }

      drag.moved = true;
      drag.points = points;
      // پیش‌نمایش زنده: تا وقتی رها نشده، وضعیت واقعی دست نمی‌خورد
      primitive.setPreview({ id: 'drag', kind: drawingsRef.current.find((d) => d.id === drag.id)!.kind, points, text: drawingsRef.current.find((d) => d.id === drag.id)?.text });
      primitive.setHidden(drag.id);
    };

    const endDrag = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      setChartInteraction(true);
      primitive.setPreview(null);
      primitive.setHidden(null);
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      if (!drag || !drag.moved || !drag.points) return;

      const original = drawingsRef.current.find((d) => d.id === drag.id);
      if (original) updateRef.current({ ...original, points: drag.points });
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);

    chartRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', endDrag);
      container.removeEventListener('pointercancel', endDrag);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
      // 🐛 چارتِ تازه سریِ خالی دارد، پس «چند کندل بارگذاری شده» هم باید صفر شود.
      // بدونِ این، افکتِ داده خیال می‌کرد همه‌چیز از قبل نشسته و فقط آخرین کندل
      // را `update` می‌کرد — چارتِ ساخته‌شده‌ی دوباره با *یک* کندل می‌ماند. در
      // StrictMode ِ توسعه هر بار دیده می‌شد؛ در تولید هر بازسازی‌ای همین را
      // می‌کرد.
      loadedCountRef.current = 0;
      hasFramedRef.current = false;
    };
  }, [onAddDrawing, onToolDone]);

  // بازگشت به نمای پیش‌فرض بعد از زوم و جابه‌جایی
  useEffect(() => {
    if (!resetSignal) return;
    frameRecent(chartRef.current, loadedCountRef.current);
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
  }, [resetSignal]);

  // با عوض شدن تایم‌فریم، شکل کل داده عوض می‌شود و باید کامل جایگزین شود
  const lastTimeframeRef = useRef<Timeframe>(timeframe);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;

    // جدول زمان قبل از هر چیز به‌روز می‌شود: رسم‌ها بر مبنای زمان لنگر دارند و
    // تا این جدول تازه نشود، جای درستشان محاسبه نمی‌شود.
    primitiveRef.current?.setTimeIndex(
      buildTimeIndex(candles.map((c) => c.time).sort((a, b) => a - b), timeframe * 60)
    );

    // lightweight-charts نیاز دارد داده به‌ترتیب زمان و بدون تکرار باشد
    const sorted = [...candles]
      .sort((a, b) => a.time - b.time)
      .map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));

    const timeframeChanged = lastTimeframeRef.current !== timeframe;
    if (timeframeChanged || sorted.length !== loadedCountRef.current) {
      // تعداد عوض شده (بارگذاری اولیه یا کندل تازه) یا تایم‌فریم عوض شده → جایگزینی کامل
      const timeScale = chartRef.current?.timeScale();
      const prevRange = timeScale?.getVisibleLogicalRange() ?? null;
      const prevCount = loadedCountRef.current;

      series.setData(sorted);
      loadedCountRef.current = sorted.length;
      lastTimeframeRef.current = timeframe;
      // ⚠️ پیش‌تر اینجا fitContent() بود. با MAX_CANDLES = ۳۰۰۰، آن یعنی جا دادن
      // سه هزار کندل در عرض صفحه — هر کندل کسری از یک پیکسل، یعنی همان «خط ریزی»
      // که فقط با زوم زیاد کندل‌های واقعی از دلش درمی‌آمد.
      if (timeframeChanged || !hasFramedRef.current) {
        hasFramedRef.current = true;
        frameRecent(chartRef.current, sorted.length);
      } else if (timeScale && prevRange && prevCount > 0 && prevRange.to >= prevCount - 1) {
        // 🐛 کاربر روی آخرین کندل بود → بعد از دادهٔ تازه هم روی آخرین کندل بماند.
        //
        // پیش‌تر کادر فقط یک بار، روی *اولین* داده، تنظیم می‌شد. اگر اولین داده
        // کوچک بود (یک کندلِ زنده که پیش از تاریخچه رسید)، چارت روی همان یک کندل
        // زوم می‌ماند و سه هزار کندلِ تاریخچه هیچ‌وقت دیده نمی‌شدند. و وقتی
        // تاریخچه *جلوی* داده اضافه می‌شد، اندیس‌ها جابه‌جا می‌شدند و دیدِ کاربر
        // بی‌صدا به عقب در زمان می‌پرید.
        //
        // اگر کاربر خودش به عقب اسکرول کرده باشد (`to` پیش از آخرین کندل)، دست
        // نمی‌خورد — این همان رفتاری است که از هر پلتفرمِ معاملاتی انتظار داری.
        if (prevCount < DEFAULT_VISIBLE_BARS) {
          frameRecent(chartRef.current, sorted.length);
        } else {
          const width = prevRange.to - prevRange.from;
          const offset = prevRange.to - (prevCount - 1);
          const to = sorted.length - 1 + offset;
          timeScale.setVisibleLogicalRange({ from: Math.max(0, to - width), to });
        }
      }
    } else {
      // فقط کندل در حال شکل‌گیری تغییر کرده → آپدیت سبک، نه بازسازی کامل چارت
      series.update(sorted[sorted.length - 1]);
    }
  }, [candles, timeframe]);

  useEffect(() => { primitiveRef.current?.setDrawings(drawings); }, [drawings]);

  // اگر رسمِ انتخاب‌شده دیگر وجود ندارد (حذف شد یا همه پاک شدند)، انتخاب هم برود
  useEffect(() => {
    setSelectedId((id) => (id && drawings.some((d) => d.id === id) ? id : null));
  }, [drawings]);

  // خط‌های افقیِ ورود/حد ضرر/حد سود — هم برای پوزیشن‌های واقعاً باز، هم پیش‌نمایشِ فرم سفارش.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of positionLinesRef.current) series.removePriceLine(line);
    positionLinesRef.current = [];

    /**
     * ⚠️ **عنوانِ خط روی بوم لاتین است، عمداً.** lightweight-charts متن را روی
     * canvas بدونِ الگوریتمِ دوجهته می‌کشد: رشته به ترتیبِ منطقی از چپ به راست
     * چیده می‌شود. «ورود خرید» روی محور می‌شد «خرید ورود»، و با نیم‌فاصله حروفِ
     * دو کلمه به هم می‌چسبیدند. dir="ltr" روی ظرف و RLE/PDF دورِ رشته هم امتحان
     * شدند و هیچ‌کدام اثر نداشتند.
     *
     * BUY / SELL / TP / SL همان برچسب‌هایی است که بایننس و تریدینگ‌ویو روی خطِ
     * قیمت می‌گذارند و معامله‌گرِ ایرانی هر روز می‌بیند؛ معنای کامل را رنگ و
     * خط‌چینِ پیش‌نمایش می‌رسانند. هر متنِ فارسی باید HTML باشد، نه بوم
     * (همان‌طور که PnlChart و PositionZoneOverlay هستند).
     */
    const add = (price: number, color: string, title: string, dashed: boolean) =>
      positionLinesRef.current.push(series.createPriceLine({
        price, color, lineWidth: dashed ? 1 : 2, lineStyle: dashed ? 3 : 2, axisLabelVisible: true, title,
      }));

    // 🐛 چند پوزیشن با یک قیمتِ ورود (مثلاً پنج خریدِ پشتِ‌سرِهم در بازارِ بسته)
    // هرکدام یک برچسب روی محور می‌کشیدند و شش «BUY» روی هم ستون می‌شدند، جوری که
    // محورِ قیمت زیرشان دیده نمی‌شد. خط‌های هم‌قیمت و هم‌نوع یکی می‌شوند: «BUY ×6».
    const grouped = new Map<string, { price: number; color: string; title: string; count: number }>();
    const collect = (price: number, color: string, title: string) => {
      const key = `${title}|${price}`;
      const hit = grouped.get(key);
      if (hit) hit.count++;
      else grouped.set(key, { price, color, title, count: 1 });
    };
    for (const position of positions ?? []) {
      collect(position.entryPrice, position.type === 'BUY' ? CHART_MARKET.up : CHART_MARKET.down, position.type === 'BUY' ? 'BUY' : 'SELL');
      if (position.stopLoss != null) collect(position.stopLoss, CHART_MARKET.down, 'SL');
      if (position.takeProfit != null) collect(position.takeProfit, CHART_MARKET.up, 'TP');
    }
    for (const g of grouped.values()) add(g.price, g.color, g.count > 1 ? `${g.title} ×${g.count}` : g.title, false);

    if (preview) {
      if (preview.stopLoss != null) add(preview.stopLoss, CHART_MARKET.down, 'SL', true);
      if (preview.takeProfit != null) add(preview.takeProfit, CHART_MARKET.up, 'TP', true);
      if (preview.stopLoss != null || preview.takeProfit != null) add(preview.entry, CHART_MARKER.preview, 'ENTRY', true);
    }

    if (ghostTrade) {
      // علامت را خودمان می‌گذاریم: خروجیِ منفیِ num() یک LRM دارد که بوم مربع می‌کشد.
      const pnlLabel = `${ghostTrade.pnl >= 0 ? '+' : '-'}${formatPrice(Math.abs(ghostTrade.pnl))}`;
      add(ghostTrade.entryPrice, CHART_MARKER.ghost, 'LAST IN', true);
      add(ghostTrade.exitPrice, CHART_MARKER.ghost, `LAST OUT ${pnlLabel}`, true);
    }

    // ⚠️ محدوده‌ی دیدِ محور قیمت فقط از روی کندل‌های پیدا حساب می‌شود — از
    // وجود این خط‌ها بی‌خبر است. اگر حد سود/ضرر (که بر مبنای درصدِ قیمت است، نه
    // پیکسل) از بازه‌ی دیدِ فعلی جلوتر بزند، priceToCoordinate در
    // PositionZoneOverlay مختصاتی بیرون از پنل برمی‌گرداند و ناحیه‌ی رنگی از
    // ترمینال بیرون می‌زند. راه‌حل درست — همان‌طور که ابزار Long/Short خودِ
    // تریدینگ‌ویو رفتار می‌کند — این است که محدوده‌ی خودکارِ محور قیمت را طوری
    // بازنویسی کنیم که همیشه ورود/حد ضرر/حد سود را هم در بر بگیرد؛ کندل‌ها خودشان
    // کوچک می‌شوند تا جا باز شود، بدون این‌که کاربر مجبور باشد دستی زوم را کم کند.
    const zoneValues: number[] = [];
    for (const position of positions ?? []) {
      zoneValues.push(position.entryPrice);
      if (position.stopLoss != null) zoneValues.push(position.stopLoss);
      if (position.takeProfit != null) zoneValues.push(position.takeProfit);
    }
    if (preview && (preview.stopLoss != null || preview.takeProfit != null)) {
      zoneValues.push(preview.entry);
      if (preview.stopLoss != null) zoneValues.push(preview.stopLoss);
      if (preview.takeProfit != null) zoneValues.push(preview.takeProfit);
    }
    if (ghostTrade) { zoneValues.push(ghostTrade.entryPrice, ghostTrade.exitPrice); }
    const zoneRange = zoneValues.length > 0
      ? { min: Math.min(...zoneValues), max: Math.max(...zoneValues) }
      : null;

    series.applyOptions({
      autoscaleInfoProvider: (baseImplementation) => {
        const base = baseImplementation();
        if (!zoneRange) return base;
        const minValue = Math.min(zoneRange.min, base?.priceRange?.minValue ?? zoneRange.min);
        const maxValue = Math.max(zoneRange.max, base?.priceRange?.maxValue ?? zoneRange.max);
        return { priceRange: { minValue, maxValue }, margins: base?.margins };
      },
    });
  }, [positions, preview, ghostTrade]);

  const commitText = () => {
    if (!textDraft) return;
    const value = textDraft.value.trim();
    if (value) {
      onAddDrawing({
        id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        kind: 'text', points: [textDraft.point], text: value.slice(0, 60),
      });
    }
    setTextDraft(null);
    onToolDone();
  };

  const fmtPrice = (n: number) => formatPrice(n);
  const hoverUp = hover ? hover.close >= hover.open : true;
  const selected = drawings.find((d) => d.id === selectedId) || null;
  const needed = tool !== 'none' ? POINTS_NEEDED[tool] : 0;

  const zoneMarks: PositionZoneMark[] = [
    ...(positions ?? []).filter((p) => p.stopLoss != null || p.takeProfit != null).map((p) => ({
      id: `pos-${p.id}`, entry: p.entryPrice, stopLoss: p.stopLoss, takeProfit: p.takeProfit,
    })),
    ...(preview && (preview.stopLoss != null || preview.takeProfit != null) ? [{
      id: 'preview', entry: preview.entry, stopLoss: preview.stopLoss, takeProfit: preview.takeProfit,
      riskAmount: preview.riskAmount, rewardAmount: preview.rewardAmount, preview: true,
    }] : []),
  ];

  // نشانگر باید بگوید چه کاری ممکن است: روی یک رسم «قابل گرفتن»، و حین کشیدن
  // «در حال گرفتن». بدون این، کاربر نمی‌فهمد که خط اصلاً جابه‌جا می‌شود.
  return (
    <div className={`relative w-full h-full ${
      dragging ? '[&_canvas]:cursor-grabbing'
        : tool === 'none' && hoveringDrawing ? '[&_canvas]:cursor-grab' : ''
    }`}>
      <div ref={containerRef} dir="ltr" className="select-none" style={{ width: '100%', height: '100%' }} />

      <PositionZoneOverlay chartRef={chartRef} seriesRef={seriesRef} marks={zoneMarks} />

      {/* خواندن OHLC — گوشه‌ی بالا-چپ تا با نوار ابزار تداخل نکند */}
      {hover && (
        <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-x-3 gap-y-0.5 bg-surface/90 backdrop-blur border border-line rounded-lg px-2.5 py-1.5 text-[11px] font-mono pointer-events-none" dir="ltr">
          {([['O', hover.open], ['H', hover.high], ['L', hover.low], ['C', hover.close]] as const).map(([k, v]) => (
            <span key={k} className="text-muted">
              {k} <span className={hoverUp ? 'text-up' : 'text-down-text'}>{fmtPrice(v)}</span>
            </span>
          ))}
        </div>
      )}

      {/* راهنمای گام‌به‌گامِ ابزار فعال. هر دو فاصله عمدی‌اند: از چپ به‌خاطر نشانِ
          کتابخانه‌ی چارت، و از پایین به‌خاطر محور زمان که زیرش می‌ماند. */}
      {tool !== 'none' && !textDraft && (
        <div className="absolute bottom-8 left-12 z-10 bg-brand/15 border border-brand/40 text-brand rounded-lg px-2.5 py-1 text-[11px] font-bold pointer-events-none">
          {needed === 1
            ? `${TOOL_LABEL[tool]}: روی چارت بزن`
            : `${TOOL_LABEL[tool]}: نقطه‌ی ${pendingCount + 1} از ${needed}${pendingCount > 0 ? ' — Esc برای لغو' : ''}`}
        </div>
      )}

      {/* نوشتنِ یادداشت، همان‌جا که کلیک شد */}
      {textDraft && (
        <div className="absolute bottom-8 left-12 z-20 flex items-center gap-1.5 bg-surface border border-brand/50 rounded-lg p-1.5">
          <input
            autoFocus
            value={textDraft.value}
            onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitText();
              if (e.key === 'Escape') { setTextDraft(null); onToolDone(); }
            }}
            maxLength={60}
            placeholder="یادداشتت را بنویس..."
            className="bg-transparent text-[11px] text-ink outline-none w-40 placeholder:text-muted"
          />
          <button onClick={commitText} className="text-[11px] font-bold text-brand hover:text-brand px-1.5 cursor-pointer">ثبت</button>
        </div>
      )}

      {/* رسمِ انتخاب‌شده: دکمه‌ی حذف کنارِ میان‌بر صفحه‌کلید می‌آید، چون روی موبایل
          کلید Delete وجود ندارد و بدون آن، رسم‌های موبایل غیرقابل حذف می‌شدند. */}
      {tool === 'none' && selected && (
        <div className="absolute bottom-8 left-12 z-10 flex items-center gap-2 bg-surface/95 backdrop-blur border border-brand/40 rounded-lg px-2 py-1.5">
          <span className="text-[11px] text-brand font-bold">
            {selected.kind === 'hline'
              ? `سطح ${fmtPrice(selected.points[0].price)}`
              : `${TOOL_LABEL[selected.kind]} انتخاب شد`}
          </span>
          <button
            onClick={removeSelected}
            className="flex items-center gap-1 text-[11px] font-bold text-down-text hover:text-down-text border border-down/30 hover:border-down/60 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
          >
            <X className="h-3 w-3" /> حذف
          </button>
          <span className="text-[11px] text-muted hidden sm:inline">یا کلید Delete</span>
        </div>
      )}
    </div>
  );
}

