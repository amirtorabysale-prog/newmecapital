/**
 * Goldemy — نمودار سود و زیان تجمعی
 *
 * جانشین MiniPnlChart. آن نسخه عمداً بدون محور و بدون عدد بود تا «در یک نگاه
 * رو به بالا یا رو به پایین» را برساند — ولی مقیاسش از کمینه تا بیشینه‌ی
 * خودِ داده بود و خطِ صفر را نمی‌کشید. نتیجه این بود که منحنیِ کاملاً در
 * ضرر، دقیقاً شکلِ منحنیِ کاملاً در سود را داشت. تنها تفاوتشان رنگِ خط بود،
 * آن هم بر اساس *آخرین* نقطه. یعنی نموداری که کل حرفش سود و زیان است،
 * سود را از زیان تشخیص نمی‌داد.
 *
 * ⚠️ هیچ متنی روی بوم کشیده نمی‌شود. برچسب‌ها و تولتیپ همه HTML اند. دو
 * دلیل: خروجی num() روی عدد منفی یک LRM نامرئی دارد که canvas آن را مربع
 * خالی می‌کشد (رجوع به src/lib/format.ts)، و متنِ HTML خودش راست‌به‌چپ و
 * tabular-nums می‌گیرد.
 *
 * ⚠️ در ناحیه‌ی چارت فقط سبز، قرمز و خاکستری. طلایی — حتی برای انتخابگر
 * بازه — با رنگ داده اشتباه گرفته می‌شود.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { CHART_MARKET, CHART_SURFACE } from '../lib/theme';
import { formatChange, dateTime } from '../lib/format';
import type { CompletedTrade } from '../types';

type RangeId = 'week' | 'month' | 'all';

const RANGES: { id: RangeId; label: string; days: number | null }[] = [
  { id: 'week', label: '7 روز', days: 7 },
  { id: 'month', label: '30 روز', days: 30 },
  { id: 'all', label: 'همه', days: null },
];

/** فاصله‌ی بوم تا لبه‌ها — جا برای برچسبِ کمینه و بیشینه در سمت راست. */
const PAD = { top: 12, bottom: 22, right: 8, left: 8 };

type Point = { t: number; pnl: number };

export function PnlChart({ trades }: { trades: CompletedTrade[] }) {
  const [range, setRange] = useState<RangeId>('all');
  const [hover, setHover] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const points = useMemo<Point[]>(() => {
    const days = RANGES.find((r) => r.id === range)?.days ?? null;
    const since = days == null ? -Infinity : Date.now() - days * 86400000;
    const inRange = [...trades]
      .filter((t) => Number.isFinite(t?.timestamp) && t.timestamp >= since)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (inRange.length === 0) return [];
    // ⚠️ تجمع از صفرِ *ابتدای بازه* شروع می‌شود، نه از ابتدای تاریخ. سؤالی
    // که «۷ روز» می‌پرسد این است که این هفته چه شد، نه اینکه سرجمعِ کل
    // حساب کجاست — آن عدد بالای همین صفحه هست.
    let sum = 0;
    const series: Point[] = [{ t: inRange[0].timestamp - 1, pnl: 0 }];
    for (const t of inRange) { sum += Number(t.pnl) || 0; series.push({ t: t.timestamp, pnl: sum }); }
    return series;
  }, [trades, range]);

  // بوم باید با تغییر اندازه‌ی کارت دوباره کشیده شود. بدون این، چیدمانِ
  // ریسپانسیو بوم را کش می‌آورد و خط پله‌پله می‌شود.
  useEffect(() => {
    const box = boxRef.current; if (!box) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const plot = useMemo(() => {
    if (points.length < 2 || size.w === 0) return null;
    const values = points.map((p) => p.pnl);
    // خطِ صفر همیشه داخل محدوده می‌ماند، وگرنه منحنیِ تماماً در سود و
    // منحنیِ تماماً در ضرر عین هم دیده می‌شوند.
    const maxV = Math.max(0, ...values);
    const minV = Math.min(0, ...values);
    const range0 = maxV - minV || 1;
    const innerW = size.w - PAD.left - PAD.right;
    const innerH = size.h - PAD.top - PAD.bottom;
    const t0 = points[0].t; const t1 = points[points.length - 1].t;
    const span = t1 - t0 || 1;
    // محورِ زمان از راست به چپ نیست: داده‌ی بازار جزیره‌ی LTR است و
    // قدیمی‌ترین نقطه سمت چپ می‌ماند، مثل خودِ چارت کندل.
    const x = (t: number) => PAD.left + ((t - t0) / span) * innerW;
    const y = (v: number) => PAD.top + (1 - (v - minV) / range0) * innerH;
    return { x, y, minV, maxV, last: values[values.length - 1] };
  }, [points, size]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr; canvas.height = size.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // ⚠️ پاک کردن پیش از هر خروجِ زودهنگام: اگر بازه‌ای انتخاب شود که
    // نقطه‌ای ندارد، منحنیِ بازه‌ی قبلی باید برود، نه اینکه بماند.
    ctx.clearRect(0, 0, size.w, size.h);
    if (!plot) return;

    const tone = plot.last >= 0 ? CHART_MARKET.up : CHART_MARKET.down;
    const zeroY = plot.y(0);

    const curve = () => {
      ctx.beginPath();
      points.forEach((p, i) => {
        const px = plot.x(p.t); const py = plot.y(p.pnl);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    };

    /**
     * ⚠️ بالای خطِ صفر سبز، پایینش قرمز — با برش، نه با یک رنگ برای کل
     * منحنی. نسخه‌ی اول کل ناحیه را با رنگِ *آخرین* نقطه پر می‌کرد: کسی که
     * الان در سود است، دوره‌ی ضررش هم سبز دیده می‌شد. سبز و قرمز در این
     * محصول مقدس‌اند و دقیقاً همین یک چیز را می‌گویند.
     */
    const band = (top: number, bottom: number, color: string, fadeDown: boolean) => {
      if (bottom - top <= 0) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, top, size.w, bottom - top); ctx.clip();

      ctx.beginPath();
      ctx.moveTo(plot.x(points[0].t), zeroY);
      for (const p of points) ctx.lineTo(plot.x(p.t), plot.y(p.pnl));
      ctx.lineTo(plot.x(points[points.length - 1].t), zeroY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, `${color}${fadeDown ? '33' : '00'}`);
      grad.addColorStop(1, `${color}${fadeDown ? '00' : '33'}`);
      ctx.fillStyle = grad; ctx.fill();

      curve();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    };
    band(0, zeroY, CHART_MARKET.up, true);
    band(zeroY, size.h, CHART_MARKET.down, false);

    // خطِ صفر — مرجعی که کل نمودار نسبت به آن خوانده می‌شود
    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.moveTo(PAD.left, zeroY); ctx.lineTo(size.w - PAD.right, zeroY);
    ctx.strokeStyle = CHART_SURFACE.border; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);

    // نقطه‌ی زیر نشانگر
    if (hover != null && points[hover]) {
      const px = plot.x(points[hover].t); const py = plot.y(points[hover].pnl);
      ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, size.h - PAD.bottom);
      ctx.strokeStyle = CHART_SURFACE.crosshair; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = tone; ctx.fill();
      ctx.strokeStyle = CHART_SURFACE.background; ctx.lineWidth = 2; ctx.stroke();
    }
  }, [points, plot, size, hover]);

  const pick = (clientX: number) => {
    const box = boxRef.current; if (!box || !plot || points.length === 0) return;
    const px = clientX - box.getBoundingClientRect().left;
    let best = 0; let bestD = Infinity;
    points.forEach((p, i) => { const d = Math.abs(plot.x(p.t) - px); if (d < bestD) { bestD = d; best = i; } });
    setHover(best);
  };

  const hovered = hover != null ? points[hover] : null;
  const empty = points.length < 2;

  return (
    <div className="flex flex-col h-full gap-2">
      {/* روی موبایل به دو خط می‌شکند: دکمه‌های بازه هدف لمسیِ ۴۴ پیکسلی
          دارند و کنارِ عددِ آخر، پهنای کارت کم می‌آید. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {/* آخرین مقدارِ همین بازه — بدون آن، انتخابگرِ بازه فقط شکل را عوض
            می‌کند و عددی برای بردن با خود نمی‌ماند. */}
        <span className="text-caption text-muted">
          {empty ? '' : (
            <span className={`font-mono font-bold text-sm tnum ${plot && plot.last > 0 ? 'text-up' : plot && plot.last < 0 ? 'text-down-text' : 'text-ink'}`}>
              {formatChange(Math.round(plot?.last ?? 0))} <span className="text-caption font-normal text-muted">تومان</span>
            </span>
          )}
        </span>
        <div role="group" aria-label="بازه‌ی نمودار" className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id} type="button" onClick={() => { setRange(r.id); setHover(null); }}
              aria-pressed={range === r.id}
              className={`rounded-lg px-3 min-h-[44px] flex items-center text-caption transition-colors cursor-pointer ${
                range === r.id ? 'bg-line-loud text-ink' : 'text-muted hover:text-ink-2'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={boxRef}
        className="relative flex-1 min-h-0"
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => pick(e.touches[0].clientX)}
        onTouchMove={(e) => pick(e.touches[0].clientX)}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} aria-hidden="true" />

        {empty ? (
          <p className="absolute inset-0 flex items-center justify-center text-center text-caption text-muted px-4">
            در این بازه معامله‌ای نبستی — بازه‌ی بلندتر را ببین.
          </p>
        ) : (
          <>
            {/* برچسبِ سقف و کفِ محور — روی بوم نوشته نمی‌شوند (LRM). */}
            <span className="absolute right-2 top-0 text-caption text-muted tnum pointer-events-none">{formatChange(Math.round(plot?.maxV ?? 0))}</span>
            <span className="absolute right-2 bottom-6 text-caption text-muted tnum pointer-events-none">{formatChange(Math.round(plot?.minV ?? 0))}</span>
            {/* ⚠️ محورِ زمان LTR است (x از t0 در PAD.left شروع می‌شود)، پس
                قدیمی‌ترین نقطه سمت *چپ* است — برخلاف جهتِ متنِ صفحه. */}
            <span className="absolute left-2 bottom-0 text-caption text-muted tnum pointer-events-none">{dateTime(points[0].t)}</span>
            <span className="absolute right-2 bottom-0 text-caption text-muted tnum pointer-events-none">{dateTime(points[points.length - 1].t)}</span>
          </>
        )}

        {hovered && plot && (
          <div
            role="status"
            className="absolute top-0 z-10 pointer-events-none rounded-lg border border-line bg-surface-sunken px-2 py-1 text-caption whitespace-nowrap -translate-x-1/2"
            /* left فیزیکی است و با RTL هم درست می‌ماند؛ کلمپ می‌شود تا از
               دو لبه بیرون نزند. */
            style={{ left: `${Math.min(Math.max(plot.x(hovered.t), 70), Math.max(70, size.w - 70))}px` }}
          >
            <span className={`font-mono font-bold tnum ${hovered.pnl > 0 ? 'text-up' : hovered.pnl < 0 ? 'text-down-text' : 'text-ink-2'}`}>
              {formatChange(Math.round(hovered.pnl))}
            </span>
            <span className="text-muted"> · {dateTime(hovered.t)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
