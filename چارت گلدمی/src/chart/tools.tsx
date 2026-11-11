/**
 * Goldemy — ابزارهای رسم روی چارت
 *
 * فهرست ابزارها و نوار کناری‌شان. عمداً از خودِ چارت جداست: چارت فقط می‌داند
 * «الان کدام ابزار فعال است»، و این فایل می‌داند «چه ابزارهایی وجود دارند و
 * هرکدام چه کار می‌کنند».
 */

import {
  MousePointer2,
  TrendingUp,
  Minus,
  GitCommitVertical,
  Spline,
  Square,
  AlignJustify,
  Ruler,
  Type,
  Magnet,
  Trash2,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';

import type { DrawingKind } from './drawings';

/**
 * ابزارهای رسم روی چارت.
 * 'none' حالت عادی است: جابه‌جایی، زوم، و انتخابِ رسم‌های موجود.
 */
export type ChartTool = 'none' | DrawingKind;

/** فهرست ابزارها برای نوار کناری — ترتیبش ترتیبِ کاربردشان در تحلیل است. */
export const CHART_TOOLS: { id: ChartTool; label: string; hint: string; Icon: LucideIcon }[] = [
  { id: 'none', label: 'انتخاب', hint: 'جابه‌جایی و زوم چارت — و انتخاب رسم‌ها برای حذف', Icon: MousePointer2 },
  { id: 'trend', label: 'خط روند', hint: 'دو نقطه بزن — حتی جلوتر از آخرین کندل', Icon: TrendingUp },
  { id: 'hline', label: 'خط افقی', hint: 'سطح حمایت یا مقاومت — یک بار بزن', Icon: Minus },
  { id: 'vline', label: 'خط عمودی', hint: 'نشانه‌گذاری یک زمان مشخص', Icon: GitCommitVertical },
  { id: 'channel', label: 'کانال', hint: 'سه نقطه: دو نقطه‌ی خط پایه، بعد پهنای کانال', Icon: Spline },
  { id: 'rect', label: 'ناحیه', hint: 'ناحیه‌ی عرضه یا تقاضا — دو گوشه را بزن', Icon: Square },
  { id: 'fib', label: 'فیبوناچی', hint: 'از کف تا سقف موج را بزن', Icon: AlignJustify },
  { id: 'measure', label: 'خط‌کش', hint: 'چقدر حرکت، چند درصد، چند کندل', Icon: Ruler },
  { id: 'text', label: 'یادداشت', hint: 'یادداشت روی چارت', Icon: Type },
];

export const TOOL_LABEL: Record<ChartTool, string> = CHART_TOOLS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.label }),
  {} as Record<ChartTool, string>
);

/**
 * نوار ابزار عمودی، کنار چارت — همان جایی که ابزارهای حرفه‌ای می‌گذارندش.
 * روی موبایل به یک نوار افقیِ قابل اسکرول تبدیل می‌شود تا جای چارت را نخورد.
 */
export function ChartToolRail({ tool, onPick, magnet, onToggleMagnet, hasDrawings, onClearAll, onReset }: {
  tool: ChartTool;
  onPick: (tool: ChartTool) => void;
  magnet: boolean;
  onToggleMagnet: () => void;
  hasDrawings: boolean;
  onClearAll: () => void;
  onReset: () => void;
}) {
  const btn = (active: boolean) =>
    `shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
      active ? 'bg-brand text-surface' : 'text-muted hover:text-ink hover:bg-white/5'
    }`;

  return (
    <div className="flex lg:flex-col gap-1 bg-surface-raised border border-line rounded-xl p-1 min-w-0 overflow-x-auto lg:overflow-visible">
      {CHART_TOOLS.map(({ id, label, hint, Icon }) => (
        <button key={id} data-tour={`chart-tool-${id}`} onClick={() => onPick(id)} title={`${label} — ${hint}`} aria-label={label} className={btn(tool === id)}>
          <Icon className="h-4 w-4" />
        </button>
      ))}

      <div className="shrink-0 lg:w-full lg:h-px w-px h-9 bg-line lg:my-1 mx-1 lg:mx-0" />

      <button
        data-tour="chart-tool-magnet"
        onClick={onToggleMagnet}
        title={magnet ? 'آهنربا روشن است: نقطه‌ها روی قیمت کندل می‌چسبند' : 'آهنربا خاموش است: نقطه‌ها دقیقاً همان‌جا که زدی می‌نشینند'}
        aria-label="آهنربا"
        className={btn(magnet)}
      >
        <Magnet className="h-4 w-4" />
      </button>

      <button data-tour="chart-tool-reset" onClick={onReset} title="بازگشت به نمای پیش‌فرض (زوم و جابه‌جایی)" aria-label="نمای اولیه" className={btn(false)}>
        <RefreshCw className="h-4 w-4" />
      </button>

      {hasDrawings && (
        <button
          onClick={onClearAll}
          title="پاک کردن همه‌ی رسم‌ها"
          aria-label="پاک کردن"
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-alert hover:bg-alert/10 transition-colors cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

