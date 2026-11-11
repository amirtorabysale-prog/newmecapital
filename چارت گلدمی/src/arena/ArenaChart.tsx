/**
 * Goldemy — چارت میدان تصمیم
 *
 * Only the candles released by the server are rendered. Analysis drawings are
 * local to the attempt and are anchored by time, so replay updates never reveal
 * future candles and the user's work stays aligned while the chart advances.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChart, createSeriesMarkers, CandlestickSeries,
  type IChartApi, type ISeriesApi, type IPriceLine,
} from 'lightweight-charts';
import { X } from 'lucide-react';

import {
  DrawingsPrimitive, POINTS_NEEDED, buildTimeIndex, logicalToTime,
  type Drawing, type ChartPoint,
} from '../chart/drawings';
import { ChartToolRail, TOOL_LABEL, type ChartTool } from '../chart/tools';
import { PositionZoneOverlay, type PositionZoneMark } from '../chart/positionZone';
import { CHART_MARKER, CHART_MARKET, CHART_SURFACE, candleColors, chartLayout } from '../lib/theme';
import { num } from '../lib/format';

export type ArenaCandle = { time: number; open: number; high: number; low: number; close: number };

export type PriceMarks = {
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  side?: 'buy' | 'sell' | null;
};

type TradeMark = { type: 'buy' | 'sell'; openCursor: number; closeCursor?: number | null; status: string; exitPrice?: number | null };
type EventMark = { kind: string; atCursor: number; payload?: { reason?: string } };

type Props = {
  candles: ArenaCandle[];
  marks: PriceMarks;
  contextCount?: number;
  planning?: boolean;
  trades?: TradeMark[];
  events?: EventMark[];
  timeframe?: number;
  analysisKey?: string;
  /** نشانگر فعلی سناریو (attempt.cursor) — مبنای مهرِ atCursor روی رسم‌های تازه. */
  cursor?: number;
  onLevelsChange?: (levels: { stopLoss?: number; takeProfit?: number }) => void;
  onDrawingsChange?: (drawings: Drawing[]) => void;
};

const storageKey = (attemptId?: string) => attemptId ? `goldemy:arena:drawings:${attemptId}` : null;

function restoreDrawings(attemptId?: string): Drawing[] {
  const key = storageKey(attemptId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((drawing) =>
      drawing && typeof drawing.id === 'string' && typeof drawing.kind === 'string' &&
      Array.isArray(drawing.points) && drawing.points.every((p: any) =>
        Number.isFinite(p?.time) && Number.isFinite(p?.price)
      )
    );
  } catch {
    return [];
  }
}

export function ArenaChart({
  candles, marks, contextCount = 0, planning = false, trades = [], events = [],
  timeframe = 1, analysisKey, cursor, onLevelsChange, onDrawingsChange,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const primitiveRef = useRef<DrawingsPrimitive | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const fittedRef = useRef(false);
  const pendingRef = useRef<ChartPoint[]>([]);
  const levelDragRef = useRef<'stop' | 'target' | null>(null);
  const ignoreClickRef = useRef(false);

  const [tool, setTool] = useState<ChartTool>('none');
  const toolRef = useRef<ChartTool>('none');
  const [magnet, setMagnet] = useState(true);
  const [drawings, setDrawings] = useState<Drawing[]>(() => restoreDrawings(analysisKey));
  const drawingsRef = useRef<Drawing[]>(drawings);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [hover, setHover] = useState<ArenaCandle | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [textDraft, setTextDraft] = useState<{ point: ChartPoint; value: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveringDrawing, setHoveringDrawing] = useState(false);

  const marksRef = useRef(marks);
  const levelsCbRef = useRef(onLevelsChange);
  const cursorRef = useRef(cursor);
  const drawingsCbRef = useRef(onDrawingsChange);
  useEffect(() => { marksRef.current = marks; }, [marks]);
  useEffect(() => { levelsCbRef.current = onLevelsChange; }, [onLevelsChange]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { drawingsCbRef.current = onDrawingsChange; }, [onDrawingsChange]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { selectedIdRef.current = selectedId; primitiveRef.current?.setSelected(selectedId); }, [selectedId]);

  useEffect(() => {
    const key = storageKey(analysisKey);
    if (key) { try { sessionStorage.setItem(key, JSON.stringify(drawings)); } catch { /* private mode/quota */ } }
    drawingsCbRef.current?.(drawings);
  }, [analysisKey, drawings]);

  const cancelDrawing = useCallback(() => {
    pendingRef.current = [];
    primitiveRef.current?.setPreview(null);
    setPendingCount(0);
    setTextDraft(null);
  }, []);

  const pickTool = (next: ChartTool) => {
    cancelDrawing();
    setSelectedId(null);
    setTool(next);
  };

  const removeSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    setDrawings((current) => current.filter((drawing) => drawing.id !== id));
    setSelectedId(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'Escape') { cancelDrawing(); setSelectedId(null); setTool('none'); }
      if (event.key === 'Delete' || event.key === 'Backspace') removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelDrawing, removeSelected]);

  useEffect(() => {
    chartRef.current?.applyOptions({ crosshair: { mode: magnet ? 1 : 0 } });
  }, [magnet]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const chart = createChart(box, {
      ...chartLayout(),
      rightPriceScale: { borderColor: CHART_SURFACE.border, scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { borderColor: CHART_SURFACE.border, timeVisible: true, secondsVisible: false, barSpacing: 8, minBarSpacing: 2, rightOffset: 8 },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      ...candleColors(),
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    const primitive = new DrawingsPrimitive();
    series.attachPrimitive(primitive);

    const pointFrom = (point: { x: number; y: number }): ChartPoint | null => {
      const logical = chart.timeScale().coordinateToLogical(point.x);
      const price = series.coordinateToPrice(point.y);
      if (logical === null || price === null) return null;
      return { time: logicalToTime(Number(logical), primitive.timeIndex), price: Number(price) };
    };

    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(series) as any;
      if (!bar || bar.open === undefined) setHover(null);
      else setHover({ time: Number(param.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close });

      const activeTool = toolRef.current;
      if (activeTool === 'none') {
        setHoveringDrawing(param.point ? primitive.drawingAt(param.point.x, param.point.y) !== null : false);
        return;
      }
      if (pendingRef.current.length === 0 || !param.point) return;
      const cursor = pointFrom(param.point);
      if (cursor) primitive.setPreview({ id: 'preview', kind: activeTool, points: [...pendingRef.current, cursor] });
    });

    chart.subscribeClick((param) => {
      if (ignoreClickRef.current) { ignoreClickRef.current = false; return; }
      if (!param.point) return;
      const activeTool = toolRef.current;

      if (activeTool === 'none') {
        setSelectedId(primitive.drawingAt(param.point.x, param.point.y));
        return;
      }

      const point = pointFrom(param.point);
      if (!point) return;
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

      setDrawings((current) => [...current, {
        id: `arena_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        kind: activeTool,
        points,
        atCursor: cursorRef.current ?? 0,
      }]);
      pendingRef.current = [];
      primitive.setPreview(null);
      setPendingCount(0);
      setTool('none');
    });

    const localPoint = (event: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const setInteraction = (enabled: boolean) => chart.applyOptions({ handleScroll: enabled, handleScale: enabled });

    const drawingDragRef: { current: null | {
      id: string; pointIndex: number | null; origin: ChartPoint;
      startPoints: ChartPoint[]; points?: ChartPoint[]; moved: boolean;
    } } = { current: null };

    const pointerDown = (event: PointerEvent) => {
      if (toolRef.current !== 'none' || event.button !== 0) return;
      const px = localPoint(event);

      if (levelsCbRef.current) {
        const candidates = [
          { key: 'stop' as const, price: marksRef.current.stopLoss },
          { key: 'target' as const, price: marksRef.current.takeProfit },
        ].filter((item) => item.price != null)
          .map((item) => ({ ...item, distance: Math.abs(Number(series.priceToCoordinate(Number(item.price))) - px.y) }))
          .sort((a, b) => a.distance - b.distance);
        if (candidates[0] && candidates[0].distance <= 12) {
          levelDragRef.current = candidates[0].key;
          ignoreClickRef.current = true;
          setInteraction(false);
          box.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }
      }

      const grab = primitive.grabAt(px.x, px.y);
      if (!grab) return;
      const origin = pointFrom(px);
      const target = drawingsRef.current.find((drawing) => drawing.id === grab.id);
      if (!origin || !target) return;

      drawingDragRef.current = {
        id: grab.id,
        pointIndex: grab.pointIndex,
        origin,
        startPoints: target.points.map((point) => ({ ...point })),
        moved: false,
      };
      setSelectedId(grab.id);
      setDragging(true);
      setInteraction(false);
      box.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const pointerMove = (event: PointerEvent) => {
      const drag = drawingDragRef.current;
      if (!drag) return;
      const cursor = pointFrom(localPoint(event));
      if (!cursor) return;

      const points = drag.pointIndex === null
        ? drag.startPoints.map((point) => ({
            time: point.time + cursor.time - drag.origin.time,
            price: point.price + cursor.price - drag.origin.price,
          }))
        : drag.startPoints.map((point, index) => index === drag.pointIndex ? cursor : point);

      drag.moved = true;
      drag.points = points;
      const original = drawingsRef.current.find((drawing) => drawing.id === drag.id);
      if (!original) return;
      primitive.setPreview({ id: 'drag', kind: original.kind, points, text: original.text });
      primitive.setHidden(drag.id);
    };

    const pointerEnd = (event: PointerEvent) => {
      if (levelDragRef.current) {
        const level = levelDragRef.current;
        levelDragRef.current = null;
        const price = series.coordinateToPrice(localPoint(event).y);
        setInteraction(true);
        if (box.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId);
        if (price != null) levelsCbRef.current?.(level === 'stop' ? { stopLoss: Number(price) } : { takeProfit: Number(price) });
        return;
      }

      const drag = drawingDragRef.current;
      drawingDragRef.current = null;
      setDragging(false);
      setInteraction(true);
      primitive.setPreview(null);
      primitive.setHidden(null);
      if (box.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId);
      if (!drag?.moved || !drag.points) return;
      ignoreClickRef.current = true;
      setDrawings((current) => current.map((drawing) =>
        drawing.id === drag.id ? { ...drawing, points: drag.points! } : drawing
      ));
    };

    box.addEventListener('pointerdown', pointerDown);
    box.addEventListener('pointermove', pointerMove);
    box.addEventListener('pointerup', pointerEnd);
    box.addEventListener('pointercancel', pointerEnd);

    chartRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;
    primitive.setDrawings(drawingsRef.current);

    return () => {
      box.removeEventListener('pointerdown', pointerDown);
      box.removeEventListener('pointermove', pointerMove);
      box.removeEventListener('pointerup', pointerEnd);
      box.removeEventListener('pointercancel', pointerEnd);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const clean = [...candles]
      .filter((c) => Number.isFinite(c.time) && c.time > 0)
      .sort((a, b) => a.time - b.time)
      .filter((c, index, all) => index === 0 || c.time > all[index - 1].time);
    primitiveRef.current?.setTimeIndex(buildTimeIndex(clean.map((c) => c.time), Math.max(1, timeframe) * 60));
    series.setData(clean.map((c) => ({
      time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    const decision = !planning && contextCount < clean.length ? clean[contextCount] : null;
    const markers: any[] = decision ? [{
      time: decision.time as never, position: 'aboveBar', color: CHART_MARKER.brand,
      shape: 'arrowDown', text: 'START',
    }] : [];
    for (const trade of trades) {
      const opened = clean[contextCount + trade.openCursor];
      if (opened) markers.push({
        time: opened.time as never,
        position: trade.type === 'buy' ? 'belowBar' : 'aboveBar',
        color: trade.type === 'buy' ? CHART_MARKET.up : CHART_MARKET.down,
        shape: trade.type === 'buy' ? 'arrowUp' : 'arrowDown',
        text: trade.type === 'buy' ? 'BUY' : 'SELL',
      });
      const closed = trade.closeCursor != null ? clean[contextCount + trade.closeCursor] : null;
      if (closed) {
        const reason = events.find((event) => event.kind === 'close' && event.atCursor === trade.closeCursor)?.payload?.reason;
        markers.push({
          time: closed.time as never, position: 'aboveBar',
          color: reason === 'stop' ? CHART_MARKET.down : CHART_MARKER.brand, shape: 'circle',
          text: reason === 'stop' ? 'SL' : reason === 'target' ? 'TP' : 'EXIT',
        });
      }
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    if (!markersRef.current) markersRef.current = createSeriesMarkers(series, markers);
    else markersRef.current.setMarkers(markers);

    if (!fittedRef.current && clean.length > 0) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    } else if ((chartRef.current?.timeScale().scrollPosition() ?? 0) < 2) {
      chartRef.current?.timeScale().scrollToRealTime();
    }
  }, [candles, contextCount, events, planning, timeframe, trades]);

  useEffect(() => { primitiveRef.current?.setDrawings(drawings); }, [drawings]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of linesRef.current) series.removePriceLine(line);
    linesRef.current = [];

    const add = (price: number, color: string, title: string) =>
      linesRef.current.push(series.createPriceLine({
        price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title,
      }));

    // ⚠️ برچسبِ روی بوم لاتین است — lightweight-charts متنِ فارسی را بی‌دوجهته
    // (به ترتیبِ منطقی، چپ به راست) می‌کشد. شرحِ کامل در MazneChart.tsx.
    if (marks.entry != null) add(marks.entry, marks.side === 'sell' ? CHART_MARKER.brand : CHART_MARKER.preview, 'ENTRY');
    if (marks.stopLoss != null) add(marks.stopLoss, CHART_MARKET.down, 'SL');
    if (marks.takeProfit != null) add(marks.takeProfit, CHART_MARKET.up, 'TP');

    // ⚠️ همان مشکلِ MazneChart: محدوده‌ی خودکارِ محور قیمت فقط از روی کندل‌ها
    // حساب می‌شود و از وجود حد ضرر/حد سود بی‌خبر است. بدون این، ناحیه‌ی رنگیِ
    // PositionZoneOverlay می‌تواند از پنل چارت بیرون بزند.
    const zoneValues: number[] = [];
    if (marks.entry != null && (marks.stopLoss != null || marks.takeProfit != null)) {
      zoneValues.push(marks.entry);
      if (marks.stopLoss != null) zoneValues.push(marks.stopLoss);
      if (marks.takeProfit != null) zoneValues.push(marks.takeProfit);
    }
    const zoneRange = zoneValues.length > 0 ? { min: Math.min(...zoneValues), max: Math.max(...zoneValues) } : null;

    series.applyOptions({
      autoscaleInfoProvider: (baseImplementation) => {
        const base = baseImplementation();
        if (!zoneRange) return base;
        const minValue = Math.min(zoneRange.min, base?.priceRange?.minValue ?? zoneRange.min);
        const maxValue = Math.max(zoneRange.max, base?.priceRange?.maxValue ?? zoneRange.max);
        return { priceRange: { minValue, maxValue }, margins: base?.margins };
      },
    });
  }, [marks.entry, marks.side, marks.stopLoss, marks.takeProfit]);

  const commitText = () => {
    if (!textDraft) return;
    const value = textDraft.value.trim();
    if (value) setDrawings((current) => [...current, {
      id: `arena_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      kind: 'text',
      points: [textDraft.point],
      text: value.slice(0, 60),
      atCursor: cursorRef.current ?? 0,
    }]);
    setTextDraft(null);
    setTool('none');
  };

  const selected = drawings.find((drawing) => drawing.id === selectedId) ?? null;
  const needed = tool === 'none' ? 0 : POINTS_NEEDED[tool];
  const hoverUp = hover ? hover.close >= hover.open : true;

  const zoneMarks: PositionZoneMark[] = marks.entry != null && (marks.stopLoss != null || marks.takeProfit != null)
    ? [{ id: 'open-trade', entry: marks.entry, stopLoss: marks.stopLoss, takeProfit: marks.takeProfit }]
    : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-col lg:flex-row gap-2 min-w-0">
        <ChartToolRail
          tool={tool}
          onPick={pickTool}
          magnet={magnet}
          onToggleMagnet={() => setMagnet((value) => !value)}
          hasDrawings={drawings.length > 0}
          onClearAll={() => {
            if (!drawings.length || window.confirm('همه تحلیل‌های این سناریو پاک شوند؟')) {
              setDrawings([]);
              setSelectedId(null);
              cancelDrawing();
            }
          }}
          onReset={() => {
            chartRef.current?.timeScale().fitContent();
            chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
          }}
        />

        <div className={`relative flex-1 min-w-0 ${dragging ? '[&_canvas]:cursor-grabbing' : tool === 'none' && hoveringDrawing ? '[&_canvas]:cursor-grab' : ''}`}>
          {/* ⚠️ ارتفاعِ موبایل عمداً بلندتر از دسکتاپ‌نسبت است. روی صفحه‌ی
              باریک، عرض را ویوپورت تعیین می‌کند و کاری‌اش نمی‌شود کرد؛ تنها
              اهرمِ باقی‌مانده برای اینکه چارت کوچک حس نشود، ارتفاع است.
              دسکتاپ (sm به بالا) دست‌نخورده مانده. */}
          <div ref={boxRef} dir="ltr" className="select-none w-full h-[420px] sm:h-[440px] rounded-xl overflow-hidden border border-line" />

          <PositionZoneOverlay chartRef={chartRef} seriesRef={seriesRef} marks={zoneMarks} />

          {hover && (
            <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap gap-x-3 rounded-lg border border-line bg-surface/90 px-2.5 py-1.5 text-[11px] font-mono" dir="ltr">
              {([['O', hover.open], ['H', hover.high], ['L', hover.low], ['C', hover.close]] as const).map(([label, value]) => (
                <span key={label} className="text-muted">{label} <span className={hoverUp ? 'text-up' : 'text-down-text'}>{num(Number(value), 2)}</span></span>
              ))}
            </div>
          )}

          {planning && candles.length > 0 && (
            <div className="pointer-events-none absolute inset-y-0 right-0 border-r-2 border-dashed border-brand">
              <span className="absolute right-2 top-12 whitespace-nowrap rounded bg-brand px-2 py-1 text-[10px] font-bold text-surface">شروع میدان تصمیم</span>
            </div>
          )}

          {planning && candles.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center" role="status">
              <div className="max-w-md rounded-xl border border-brand/30 bg-surface/95 px-4 py-3 shadow-xl">
                <p className="text-xs font-bold text-brand">برای این سناریو کندل زمینه تعریف نشده است</p>
                <p className="mt-1.5 text-[11px] leading-5 text-ink-2">بازه سناریو از ابتدای دیتاست شروع شده؛ در پنل ادمین، شروع سناریو را بعد از چند کندل قرار بده تا گذشته بازار اینجا دیده شود.</p>
              </div>
            </div>
          )}

          {tool !== 'none' && !textDraft && (
            <div className="pointer-events-none absolute bottom-8 left-12 z-10 rounded-lg border border-brand/40 bg-brand/15 px-2.5 py-1 text-[11px] font-bold text-brand">
              {needed === 1
                ? `${TOOL_LABEL[tool]}: روی چارت بزن`
                : `${TOOL_LABEL[tool]}: نقطه ${pendingCount + 1} از ${needed}`}
            </div>
          )}

          {textDraft && (
            <div className="absolute bottom-8 left-12 z-20 flex items-center gap-1.5 rounded-lg border border-brand/50 bg-surface p-1.5">
              <input
                autoFocus value={textDraft.value} maxLength={60}
                onChange={(event) => setTextDraft({ ...textDraft, value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitText();
                  if (event.key === 'Escape') { setTextDraft(null); setTool('none'); }
                }}
                placeholder="یادداشتت را بنویس..."
                className="w-40 bg-transparent text-[11px] text-ink outline-none placeholder:text-muted"
              />
              <button onClick={commitText} className="px-1.5 text-[11px] font-bold text-brand">ثبت</button>
            </div>
          )}

          {tool === 'none' && selected && (
            <div className="absolute bottom-8 left-12 z-10 flex items-center gap-2 rounded-lg border border-brand/40 bg-surface/95 px-2 py-1.5">
              <span className="text-[11px] font-bold text-brand">{TOOL_LABEL[selected.kind]} انتخاب شد</span>
              <button onClick={removeSelected} className="flex items-center gap-1 rounded border border-down/30 px-1.5 py-0.5 text-[11px] font-bold text-down-text">
                <X className="h-3 w-3" /> حذف
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-muted">تحلیل‌ها فقط برای همین تلاش ذخیره می‌شوند و با جلو رفتن کندل‌ها جابه‌جا نمی‌شوند.</p>
    </div>
  );
}
