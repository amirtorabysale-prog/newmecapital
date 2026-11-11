import { useCallback, useRef } from 'react';
import { ArenaChart, type ArenaCandle } from './ArenaChart';

type Props = {
  candles: ArenaCandle[];
  startIndex: number;
  endIndex: number;
  contextBars: number;
  onChange: (start: number, end: number) => void;
  criticalPoints?: Array<{ ruleId: string; candleRange: { start: number; end: number }; title: string }>;
  selectedRuleId?: string;
  onChartClick?: (index: number) => void;
  placementMode?: boolean;
};

/** Visual range editor layered on the same chart used by the decision arena. */
export function ScenarioRangeChart({ candles, startIndex, endIndex, contextBars, onChange, criticalPoints = [], selectedRuleId, onChartClick, placementMode = false }: Props) {
  const overlay = useRef<HTMLDivElement>(null);
  const last = Math.max(1, candles.length - 1);
  const pct = (index: number) => `${Math.max(0, Math.min(100, index / last * 100))}%`;
  const indexAt = useCallback((clientX: number) => {
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(last, Math.round((clientX - rect.left) / rect.width * last)));
  }, [last]);
  const drag = (which: 'start' | 'end') => (event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: React.PointerEvent) => {
      const next = indexAt(e.clientX);
      onChange(which === 'start' ? Math.min(next, endIndex - 1) : startIndex,
        which === 'end' ? Math.max(next, startIndex + 1) : endIndex);
    };
    const node = event.currentTarget as HTMLButtonElement;
    node.onpointermove = move as any;
    node.onpointerup = () => { node.onpointermove = null; node.onpointerup = null; };
  };

  return <div className="relative" data-testid="scenario-range-chart">
    <ArenaChart candles={candles} marks={{}} />
    <div
      ref={overlay}
      onClick={(event) => {
        if (!placementMode) return;
        event.preventDefault();
        onChartClick?.(indexAt(event.clientX));
      }}
      className={`absolute z-20 inset-y-0 left-0 right-[56px] overflow-hidden ${placementMode ? 'cursor-crosshair ring-2 ring-inset ring-info/70' : ''}`}
      dir="ltr"
      aria-label={placementMode ? 'یک کندل را برای نقطه حساس انتخاب کن' : undefined}
    >
      <div className="absolute inset-y-0 bg-brand/10 border-x border-brand/40 pointer-events-none"
        style={{ left: pct(startIndex), width: `${Math.max(0, (endIndex - startIndex) / last * 100)}%` }} />
      <div className="absolute inset-y-0 bg-info/10 pointer-events-none"
        style={{ left: pct(Math.max(0, startIndex - contextBars)), width: `${contextBars / last * 100}%` }} />
      <div className="absolute inset-y-0 border-l-2 border-dashed border-info pointer-events-none" style={{ left: pct(startIndex) }}>
        <span className="absolute top-2 left-1 text-[10px] bg-info text-ink rounded px-1 whitespace-nowrap">مرز تصمیم</span>
      </div>
      {criticalPoints.map((point) => <div key={point.ruleId} title={point.title} className={`absolute inset-y-6 pointer-events-none border ${point.ruleId === selectedRuleId ? 'border-info bg-info/25' : 'border-brand/70 bg-brand/15'}`} style={{ left: pct(point.candleRange.start), width: `${Math.max(1, (point.candleRange.end - point.candleRange.start) / last * 100)}%` }} />)}
      {(['start', 'end'] as const).map((which) => <button key={which} type="button" aria-label={which === 'start' ? 'جابجایی شروع' : 'جابجایی پایان'}
        onPointerDown={drag(which)} style={{ left: pct(which === 'start' ? startIndex : endIndex) }}
        className="absolute inset-y-0 -translate-x-1/2 w-8 cursor-ew-resize touch-none group">
        <span className={`block mx-auto h-full border-l-2 ${which === 'start' ? 'border-series-2' : 'border-series-1'}`} />
        <span className={`absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full w-5 h-5 border-4 border-surface-raised ${which === 'start' ? 'bg-series-2' : 'bg-series-1'}`} />
      </button>)}
    </div>
  </div>;
}
