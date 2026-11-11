/**
 * Goldemy — ناحیه‌ی ریسک/ریوارد روی چارت (مثل ابزار Long/Short تریدینگ‌ویو)
 *
 * createPriceLine کتابخانه فقط یک خط افقی نازک می‌کشد؛ برای اینکه فاصله‌ی ورود
 * تا حد ضرر (قرمز) و ورود تا حد سود (سبز) در نگاه اول حس شود — نه با خواندن دو
 * عدد — این کامپوننت یک لایه‌ی رنگیِ نیمه‌شفاف روی همان چارت می‌کشد.
 *
 * ⚠️ چون قیمت‌های ورود/حد ضرر/حد سود ثابت‌اند، مختصات پیکسلی‌شان فقط با زوم،
 * اسکرول یا تغییر اندازه‌ی چارت عوض می‌شود — نه هر فریم. کتابخانه رویدادی برای
 * «هر تغییر مقیاس قیمت» نمی‌دهد (autoscale با هر کندل تازه هم ممکن است تغییر
 * کند)، پس مختصات با requestAnimationFrame خوانده می‌شود ولی state فقط وقتی
 * واقعاً تغییر کرده به‌روزرسانی می‌گردد — وگرنه هر فریم یک رندر بی‌مورد بود.
 */
import { formatPrice, num } from '../lib/format';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export type PositionZoneMark = {
  id: string;
  entry: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** فقط برای نمایش مبلغ پول به‌جای فقط درصد — اختیاری. */
  riskAmount?: number | null;
  rewardAmount?: number | null;
  /** true یعنی هنوز ثبت نشده، فقط پیش‌نمایشِ فرم سفارش است. */
  preview?: boolean;
};

type Geo = { entryY: number; slY: number | null; tpY: number | null };

const fmtMoney = formatPrice;
const fmtPercent = (n: number) => num(n, 2);

function sameGeo(a: Geo, b: Geo): boolean {
  if (Math.abs(a.entryY - b.entryY) > 0.5) return false;
  if ((a.slY == null) !== (b.slY == null)) return false;
  if (a.slY != null && b.slY != null && Math.abs(a.slY - b.slY) > 0.5) return false;
  if ((a.tpY == null) !== (b.tpY == null)) return false;
  if (a.tpY != null && b.tpY != null && Math.abs(a.tpY - b.tpY) > 0.5) return false;
  return true;
}

export function PositionZoneOverlay({
  chartRef, seriesRef, marks,
}: {
  chartRef: React.RefObject<IChartApi | null>;
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>;
  marks: PositionZoneMark[];
}) {
  const [geoById, setGeoById] = useState<Record<string, Geo>>({});
  const [scaleWidth, setScaleWidth] = useState(56);
  const [paneHeight, setPaneHeight] = useState(400);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const geoCacheRef = useRef<Record<string, Geo>>({});
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const step = () => {
      if (!alive) return;
      const chart = chartRef.current;
      const series = seriesRef.current;
      const current = marksRef.current;

      if (chart && series && current.length > 0) {
        const next: Record<string, Geo> = {};
        for (const mark of current) {
          const entryY = series.priceToCoordinate(mark.entry);
          if (entryY == null) continue;
          const slY = mark.stopLoss != null ? series.priceToCoordinate(mark.stopLoss) : null;
          const tpY = mark.takeProfit != null ? series.priceToCoordinate(mark.takeProfit) : null;
          next[mark.id] = { entryY, slY: slY ?? null, tpY: tpY ?? null };
        }
        const prev = geoCacheRef.current;
        const changed = Object.keys(next).length !== Object.keys(prev).length
          || Object.entries(next).some(([id, geo]) => !prev[id] || !sameGeo(prev[id], geo));
        if (changed) { geoCacheRef.current = next; setGeoById(next); }

        let width = scaleWidth;
        try { width = chart.priceScale('right').width() || scaleWidth; } catch { /* نسخه‌ی بدون این متد */ }
        if (Math.abs(width - scaleWidth) > 0.5) setScaleWidth(width);

        let height = paneHeight;
        try { height = chart.paneSize().height || paneHeight; } catch { /* نسخه‌ی بدون این متد */ }
        if (Math.abs(height - paneHeight) > 0.5) setPaneHeight(height);
      } else if (Object.keys(geoCacheRef.current).length > 0) {
        geoCacheRef.current = {};
        setGeoById({});
      }

      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => { alive = false; if (frameRef.current != null) cancelAnimationFrame(frameRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRef, seriesRef]);

  if (marks.length === 0) return null;

  return (
    // overflow-hidden: قیمت‌های حد سود/ضرر می‌توانند بیرون از بازه‌ی خودکارِ محور
    // قیمت بیفتند (مخصوصاً در تمرین آزاد که کاربر خودش درصد را انتخاب می‌کند)،
    // آن‌وقت priceToCoordinate مختصاتی بیرون از پنل برمی‌گرداند. بدون این کلیپ،
    // ناحیه‌ی رنگی و برچسبش از چارت بیرون می‌زدند؛ حالا حداکثر به لبه می‌چسبند.
    <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden" style={{ right: scaleWidth }}>
      {marks.map((mark) => {
        const geo = geoById[mark.id];
        if (!geo) return null;
        const riskPercent = mark.stopLoss != null ? Math.abs(mark.stopLoss - mark.entry) / mark.entry * 100 : null;
        const rewardPercent = mark.takeProfit != null ? Math.abs(mark.takeProfit - mark.entry) / mark.entry * 100 : null;
        const rr = mark.riskAmount && mark.rewardAmount
          ? mark.rewardAmount / mark.riskAmount
          : riskPercent && rewardPercent ? rewardPercent / riskPercent : null;
        const dashed = mark.preview;

        // اگر ورود/حد ضرر/حد سود بیرون از بازه‌ی دیدِ محور قیمت بیفتند (مخصوصاً
        // در تمرین آزاد که کاربر خودش درصد را انتخاب می‌کند)، مختصات پیکسلی هم
        // بیرون از پنل می‌شوند. با گیر انداختنِ لبه‌های جعبه داخل ۰..paneHeight
        // نه فقط رنگ بلکه برچسبش هم — که نسبت به همان لبه جا می‌گیرد — همیشه
        // چسبیده به داخل چارت می‌ماند، نه شناور بیرونش.
        const clampY = (y: number) => Math.max(0, Math.min(paneHeight, y));

        return (
          <Fragment key={mark.id}>
            {geo.slY != null && (() => {
              const top = clampY(Math.min(geo.entryY, geo.slY));
              const bottom = clampY(Math.max(geo.entryY, geo.slY));
              return (
                <div
                  className={`absolute left-0 right-0 bg-down/[0.14] border-down/50 ${dashed ? 'border-y border-dashed' : 'border-y'}`}
                  style={{ top, height: Math.max(1, bottom - top) }}
                >
                  <span className="absolute left-1.5 top-1 whitespace-nowrap rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-bold text-down-text">
                    ریسک{riskPercent != null ? ` ${fmtPercent(riskPercent)}٪` : ''}{mark.riskAmount ? ` · ${fmtMoney(mark.riskAmount)}` : ''}
                  </span>
                </div>
              );
            })()}
            {geo.tpY != null && (() => {
              const top = clampY(Math.min(geo.entryY, geo.tpY));
              const bottom = clampY(Math.max(geo.entryY, geo.tpY));
              return (
                <div
                  className={`absolute left-0 right-0 bg-up/[0.14] border-up/50 ${dashed ? 'border-y border-dashed' : 'border-y'}`}
                  style={{ top, height: Math.max(1, bottom - top) }}
                >
                  <span className="absolute left-1.5 bottom-1 whitespace-nowrap rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-bold text-up">
                    سود{rewardPercent != null ? ` ${fmtPercent(rewardPercent)}٪` : ''}{mark.rewardAmount ? ` · ${fmtMoney(mark.rewardAmount)}` : ''}
                  </span>
                </div>
              );
            })()}
            {rr != null && (
              <div
                className="absolute whitespace-nowrap rounded-md border border-brand/40 bg-surface/95 px-2 py-1 text-[11px] font-bold text-brand"
                style={{ top: Math.max(2, Math.min(paneHeight - 28, clampY(geo.entryY) - 24)), left: 6 }}
              >
                R:R 1 به {fmtPercent(rr)}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
