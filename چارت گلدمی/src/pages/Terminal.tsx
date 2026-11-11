/**
 * Goldemy — ترمینال معاملاتی
 *
 * پیش‌تر JSX درون‌خطی داخل MainApp بود. جدا شدنش رفتاری را عوض نکرد.
 *
 * ⚠️ این صفحه هیچ state ی از خودش ندارد — حتی رسم‌های چارت. دلیلش یک اشکال
 * واقعی است که قبلاً پیش آمده: رسم‌ها با یک ref به نام drawingsLoaded از سرور
 * بارگذاری و ذخیره می‌شوند، و آن ref باید بالاتر از جایی زندگی کند که با
 * جابه‌جایی بین بخش‌ها unmount می‌شود. اگر رسم‌ها را به این فایل بیاوری، با
 * هر بار خروج و برگشت به ترمینال پاک می‌شوند.
 *
 * ⚠️ روی موبایل چارت و پنل سفارش دو تب‌اند (mobileTerminalTab)، ولی روی
 * دسکتاپ کنار هم. یعنی هر دو همیشه در DOM هستند و شرط نمایش با کلاس است نه
 * با رندر شرطی — وگرنه چارت با هر تعویض تب از نو ساخته می‌شود.
 */

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Activity, Clock, Globe2, RefreshCw, Sparkles, Telescope } from 'lucide-react';

import { MazneChart, type ChartPreview, type GhostTrade } from '../chart/MazneChart';
import { TradingViewPanel } from '../chart/TradingViewPanel';
import { TIMEFRAMES, type Timeframe } from '../chart/candles';
import type { Drawing } from '../chart/drawings';
import { ChartToolRail, type ChartTool } from '../chart/tools';
import { AccuracyBadge } from '../coach/Accuracy';
import { PlanStrip } from '../coach/DailyPlan';
import { OrderBookPanel } from '../trading/OrderBook';
import { OrderEntry } from '../trading/OrderEntry';
import { OrderBookSkeleton, OrderEntrySkeleton, ChartSkeleton } from '../ui/Loading';
import { dateTime, num } from '../lib/format';
import { signTone } from '../lib/tone';
import { FlashNumber } from '../ui/FlashNumber';
import type {
  Candle,
  CompletedTrade,
  DailyPlanState,
  MarketTick,
  OrderBook,
  OrderType,
  UserState,
} from '../types';

export function Terminal({
  tick, orderBook, userState, dailyPlan,
  timeframe, setTimeframe, tfCandles, candles,
  historyState, historyLoading, historyError,
  chartView, setChartView, chartReset, setChartReset,
  chartTool, setChartTool, handleToolDone, hintChartToolOnce,
  drawings, setDrawings, handleAddDrawing, handleRemoveDrawing, handleUpdateDrawing,
  magnet, setMagnet, setVisibleCandles,
  selectedPrice, setSelectedPrice, orderPreview, setOrderPreview,
  openTpSlSignal, revengeGhost,
  handlePlaceOrder, handleClosePosition,
  openAnalysis, openDeepAnalysis, setAccuracyTrade,
  bottomTab, setBottomTab, positionsSectionRef,
  mobileTerminalTab, setMobileTerminalTab, showMobileBook, setShowMobileBook,
  setShowCheckIn, setShowDayReview,
}: {
  tick: MarketTick | null;
  orderBook: OrderBook | null;
  userState: UserState | null;
  dailyPlan: DailyPlanState | null;

  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  /** تاریخچه‌ی سرور + کندل‌های زنده، ادغام‌شده. */
  tfCandles: Candle[];
  candles: Candle[];
  historyState: { timeframe: Timeframe; candles: Candle[]; proxy: boolean; source?: string } | null;
  historyLoading: boolean;
  historyError: string;

  chartView: 'mazne' | 'global';
  setChartView: (view: 'mazne' | 'global') => void;
  chartReset: number;
  setChartReset: Dispatch<SetStateAction<number>>;

  chartTool: ChartTool;
  setChartTool: (tool: ChartTool) => void;
  handleToolDone: () => void;
  hintChartToolOnce: (id: string) => void;

  drawings: Drawing[];
  setDrawings: (drawings: Drawing[]) => void;
  handleAddDrawing: (drawing: Drawing) => void;
  handleRemoveDrawing: (id: string) => void;
  handleUpdateDrawing: (next: Drawing) => void;

  magnet: boolean;
  setMagnet: Dispatch<SetStateAction<boolean>>;
  setVisibleCandles: (n: number) => void;

  selectedPrice: number | null;
  setSelectedPrice: (price: number | null) => void;
  orderPreview: ChartPreview | null;
  setOrderPreview: (preview: ChartPreview | null) => void;
  /** با هر افزایش، پنل سفارش بخش حد سود/ضرر را باز می‌کند. */
  openTpSlSignal: number;
  /** شبح معامله‌ی ضررده‌ی قبلی، وقتی هنوز چند دقیقه نگذشته. */
  revengeGhost: GhostTrade | null;

  handlePlaceOrder: (type: OrderType, amount: number, limitPrice?: number, takeProfit?: number, stopLoss?: number, leverage?: number, emotion?: number) => void;
  handleClosePosition: (id: string) => void;

  openAnalysis: (trade: CompletedTrade) => void;
  openDeepAnalysis: (trade: CompletedTrade) => void;
  setAccuracyTrade: (trade: CompletedTrade | null) => void;

  bottomTab: 'positions' | 'history';
  setBottomTab: (tab: 'positions' | 'history') => void;
  positionsSectionRef: RefObject<HTMLDivElement | null>;

  mobileTerminalTab: 'chart' | 'order';
  setMobileTerminalTab: (tab: 'chart' | 'order') => void;
  showMobileBook: boolean;
  setShowMobileBook: Dispatch<SetStateAction<boolean>>;

  setShowCheckIn: (show: boolean) => void;
  setShowDayReview: (show: boolean) => void;
}) {
  return (
    <div className="terminal-workspace space-y-4 flex flex-col max-w-[1600px] mx-auto pb-10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink flex items-center gap-2"><Activity className="h-4 w-4 text-brand" /> ترمینال معاملاتی</h2>
      </div>

      {/* سوئیچر تب در موبایل
          ⚠️ پیش‌تر سه تب بود و «دفتر سفارشات» یک‌سوم کل ناوبری اصلیِ ترمینال را
          می‌گرفت — در حالی که ارقامش با Math.random ساخته می‌شوند و عمق واقعی
          بازار نیستند. حالا دو تب مانده (آنچه واقعاً کار می‌کنی) و دفتر سفارشات
          به‌صورت یک بخش جمع‌شونده زیر فرم سفارش رفته است. */}
      <div className="flex xl:hidden bg-surface-raised border border-line rounded-xl p-1 gap-1">
        {([['chart', 'نمودار'], ['order', 'معامله']] as const).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={mobileTerminalTab === id}
            onClick={() => setMobileTerminalTab(id)}
            className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${mobileTerminalTab === id ? 'bg-brand text-surface shadow-md' : 'text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* چیدمان تطبیق‌پذیر */}
      <div className="terminal-layout flex flex-col xl:flex-row gap-4 items-stretch w-full">
        {/* ۱. چارت */}
        <div className={`terminal-chart-column w-full xl:w-[65%] flex flex-col gap-2 ${mobileTerminalTab === 'chart' ? 'block' : 'hidden xl:flex'}`}>
          {/* نوار بالا: تایم‌فریم و سوئیچ نما. ابزارهای رسم عمداً اینجا
              نیستند — جایشان نوار عمودیِ کنار چارت است، مثل ابزارهای حرفه‌ای. */}
          <div className="flex flex-wrap items-center gap-2 bg-surface-raised border border-line rounded-xl p-1.5">
            {chartView === 'mazne' && (
              <div data-tour="terminal-timeframe" className="flex bg-surface border border-line rounded-lg p-0.5 gap-0.5">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => setTimeframe(tf.value)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all cursor-pointer ${timeframe === tf.value ? 'bg-brand text-surface' : 'text-muted hover:text-ink'}`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            )}

            {chartView === 'mazne' && historyLoading && (
              <span className="flex items-center gap-1 text-[10px] text-info">
                <RefreshCw className="h-3 w-3 animate-spin" /> دریافت تاریخچه…
              </span>
            )}
            {chartView === 'mazne' && !historyLoading && timeframe > 1 && historyState?.timeframe === timeframe && historyState.proxy && (
              <span className="flex items-center gap-1 text-[10px] text-muted" title={historyState.source}>
                <Globe2 className="h-3 w-3" /> تاریخچهٔ بلندمدت از انس جهانی
              </span>
            )}
            {/* ⚠️ نارنجیِ هشدار، نه قرمز. قرمز یعنی «ضرر کردی»؛ این یعنی «سرور
                تاریخچه را نداد» و نباید با جهت بازار قاطی شود. */}
            {chartView === 'mazne' && historyError && (
              <span className="text-[10px] text-alert" title={historyError}>تاریخچه در دسترس نیست</span>
            )}

            {chartView === 'mazne' && tick?.marketOpen === false && (
              <div className="flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-bold text-brand">
                <Clock className="h-3.5 w-3.5" />
                {tick.marketStatus === 'DAILY_BREAK' ? 'وقفه روزانه بازار جهانی' : 'بازار جهانی بسته است'}
                {candles.length > 0 && (
                  <span className="font-normal text-muted">
                    — آخرین کندل واقعی {dateTime(new Date(candles[candles.length - 1].time * 1000).toISOString())}
                  </span>
                )}
              </div>
            )}

            <div className="flex bg-surface border border-line rounded-lg p-0.5 gap-0.5 mr-auto">
              <button
                onClick={() => setChartView('mazne')}
                className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all cursor-pointer ${chartView === 'mazne' ? 'bg-brand text-surface' : 'text-muted hover:text-ink'}`}
                title="قیمت هر گرم — همان قیمتی که با آن معامله می‌کنی"
              >
                هر گرم
              </button>
              <button
                onClick={() => setChartView('global')}
                className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all cursor-pointer flex items-center gap-1 ${chartView === 'global' ? 'bg-brand text-surface' : 'text-muted hover:text-ink'}`}
                title="اونس جهانی طلا (XAUUSD)"
              >
                <Globe2 className="h-3 w-3" /> جهانی
              </button>
            </div>
          </div>

          {/* نوار ابزار عمودی کنار چارت. در RTL فرزند اول سمت راست می‌نشیند،
              یعنی همان‌جایی که کاربر در تریدینگ‌ویو انتظارش را دارد. */}
          <div className="flex flex-col lg:flex-row gap-2">
            {chartView === 'mazne' && (
              <ChartToolRail
                tool={chartTool}
                onPick={(t) => { setChartTool(t); hintChartToolOnce(t); }}
                magnet={magnet}
                onToggleMagnet={() => { setMagnet((m) => !m); hintChartToolOnce('magnet'); }}
                hasDrawings={drawings.length > 0}
                onClearAll={() => setDrawings([])}
                onReset={() => { setChartReset((n) => n + 1); hintChartToolOnce('reset'); }}
              />
            )}

            {/* ⚠️ عمداً flex-1 بدون قید نیست: در چیدمان ستونیِ موبایل،
                flex-1 یعنی flex-basis صفر روی محور عمودی و ارتفاع ثابت را
                بی‌اثر می‌کند — چارت تا ضخامت یک خط جمع می‌شود. */}
            <div data-tour="terminal-chart" className="select-none w-full lg:flex-1 min-w-0 h-[380px] sm:h-[500px] bg-surface-chart border border-line rounded-xl overflow-hidden relative">
              {chartView === 'mazne' ? (
                tfCandles.length > 0
                  ? <MazneChart
                      candles={tfCandles}
                      timeframe={timeframe}
                      tool={chartTool}
                      drawings={drawings}
                      magnet={magnet}
                      onAddDrawing={handleAddDrawing}
                      onUpdate={handleUpdateDrawing}
                      onRemove={handleRemoveDrawing}
                      onToolDone={handleToolDone}
                      resetSignal={chartReset}
                      onVisibleCountChange={setVisibleCandles}
                      positions={userState?.positions}
                      preview={orderPreview}
                      ghostTrade={revengeGhost}
                    />
                  // ⚠️ پیام از *وضعیت* می‌آید، نه فقط از تعدادِ کندل. نسخه‌ی قبل
                  // هر وقت کندلی نبود می‌گفت «در حال گرفتن…» — حتی وقتی پاسخ
                  // آمده بود و خالی بود (دیتابیسِ تازه، بازارِ بسته). نتیجه یک
                  // بارگذاریِ ابدی بود که هیچ‌وقت تمام نمی‌شد.
                  : <ChartSkeleton
                      animated={historyLoading}
                      message={historyLoading
                        ? 'در حال گرفتن کندل‌های بازار...'
                        : historyError && candles.length === 0
                          ? 'تاریخچه‌ی قیمت از سرور نرسید. اتصالت را چک کن؛ کندل‌های زنده به‌محضِ رسیدن همین‌جا رسم می‌شوند.'
                          : candles.length === 0
                            ? tick?.marketOpen === false
                              ? 'بازار جهانی الان بسته است و هنوز کندلی ثبت نشده. با باز شدنِ بازار، نمودار همین‌جا رسم می‌شود.'
                              : 'هنوز کندلی از بازار نرسیده. اتصال برقرار است — اولین کندل تا یک دقیقه‌ی دیگر رسم می‌شود.'
                            : `برای تایم‌فریم ${TIMEFRAMES.find((t) => t.value === timeframe)?.label} هنوز داده‌ی کافی جمع نشده. تایم‌فریم کوتاه‌تر را امتحان کن.`}
                    />
              ) : (
                <TradingViewPanel />
              )}
            </div>
          </div>
        </div>

        {/* ۲. دفتر سفارشات — فقط دسکتاپ (نسخه‌ی موبایل زیر فرم سفارش است) */}
        <div data-tour="terminal-orderbook" className="terminal-book-column hidden xl:block xl:w-[15%] h-[550px]">
          {orderBook && tick ? <OrderBookPanel orderBook={orderBook} tick={tick} onPriceSelect={(p) => setSelectedPrice(p)} /> : <OrderBookSkeleton />}
        </div>

        {/* ۳. فرم ثبت سفارش
            ⚠️ اینجا xl:h-[550px] نیست و نباید برگردد. با ارتفاع ثابت، فرم
            مجبور می‌شد اسکرول داخلی بگیرد؛ اندازه‌گیری شد که با حد سود/ضررِ
            باز محتوا ۷۳۲ پیکسل می‌خواهد و فقط ۲۶۴ پیکسل جا بود. هم‌ترازیِ
            ستون‌ها به قیمتِ اسکرول در یک فرم سفارش نمی‌ارزد. */}
        <div className={`terminal-order-column w-full xl:w-[20%] ${mobileTerminalTab === 'order' ? 'block' : 'hidden xl:block'}`}>
          {userState && tick ? (
            <OrderEntry
              currentPrice={tick.price} rialBalance={userState.rialBalance} goldBalance={userState.goldBalance}
              onPlaceOrder={handlePlaceOrder} selectedPrice={selectedPrice}
              breaches={dailyPlan?.breaches ?? null}
              onPreviewChange={setOrderPreview}
              openTpSlSignal={openTpSlSignal}
              /* نوار پیمان *داخل* کارت می‌رود، نه بالای آن: بخشی از تصمیمِ
                 سفارش است، نه یک اعلان جدا بالای فرم. */
              planHeader={
                dailyPlan?.plan && dailyPlan.status ? (
                  <PlanStrip
                    plan={dailyPlan.plan} status={dailyPlan.status} streak={dailyPlan.streak}
                    onOpenReview={() => setShowDayReview(true)} onEdit={() => setShowCheckIn(true)}
                  />
                ) : dailyPlan ? (
                  <button
                    onClick={() => setShowCheckIn(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-brand/30 bg-brand/5 text-brand hover:bg-brand/10 hover:border-brand/60 transition-colors cursor-pointer text-[11px] font-bold"
                  >
                    <Clock className="h-3.5 w-3.5" /> پیمان امروزت را ببند
                  </button>
                ) : null
              }
            />
          ) : <OrderEntrySkeleton />}

          {/* دفتر سفارشات فشرده — فقط موبایل، جمع‌شونده و پیش‌فرض بسته.
              ⚠️ همان data-tour ستونِ دسکتاپ را دارد: تور هدفش را با
              «اولین نمونه‌ی دیده‌شونده» پیدا می‌کند، پس روی هر اندازه‌ی
              صفحه خودش نسخه‌ی درست را برمی‌دارد. */}
          <div data-tour="terminal-orderbook" className="xl:hidden mt-3">
            <button
              onClick={() => setShowMobileBook((v) => !v)}
              aria-expanded={showMobileBook}
              className="w-full flex items-center justify-between bg-surface-raised border border-line rounded-xl px-4 py-3 text-xs text-muted hover:text-ink transition-colors cursor-pointer"
            >
              <span className="font-bold">دفتر سفارشات</span>
              <span className="text-[11px] text-muted">{showMobileBook ? 'بستن −' : 'نمایش +'}</span>
            </button>
            {showMobileBook && orderBook && tick && (
              <div className="mt-2">
                <OrderBookPanel orderBook={orderBook} tick={tick} onPriceSelect={(p) => setSelectedPrice(p)} compact />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* موقعیت‌های باز و تاریخچه */}
      <div ref={positionsSectionRef} data-tour="terminal-positions" className="terminal-ledger overflow-hidden mt-4 scroll-mt-20">
        <div className="border-b border-line bg-surface/50 px-4 flex gap-4">
           <button onClick={() => setBottomTab('positions')} className={`py-3 text-[11px] font-bold border-b-2 cursor-pointer transition-colors ${bottomTab === 'positions' ? 'text-brand border-brand' : 'text-muted border-transparent hover:text-ink-2'}`}>موقعیت‌های باز</button>
           <button onClick={() => setBottomTab('history')} className={`py-3 text-[11px] font-bold border-b-2 cursor-pointer transition-colors ${bottomTab === 'history' ? 'text-brand border-brand' : 'text-muted border-transparent hover:text-ink-2'}`}>تاریخچه معاملات</button>
        </div>
        <div className="p-4 bg-surface/20 max-h-[300px] overflow-y-auto">
           {bottomTab === 'positions' && (
             userState?.positions.length ? (
               <div className="overflow-x-auto">
                 <table className="w-full text-right text-xs text-ink-2 min-w-[500px]">
                   <thead className="text-muted"><tr className="border-b border-line"><th className="pb-3 font-medium">نوع</th><th className="pb-3 font-medium">حجم (گرم)</th><th className="pb-3 font-medium">قیمت ورود</th><th className="pb-3 font-medium">حد سود/ضرر</th><th className="pb-3 font-medium">انحلال</th><th className="pb-3 font-medium">سود/زیان</th><th className="pb-3 font-medium">عملیات</th></tr></thead>
                   <tbody>
                     {userState.positions.map(p => (
                       <tr key={p.id} className="border-b border-line/30 hover:bg-white/5 transition-colors">
                         <td className="py-3">
                           <div className="flex items-center gap-1.5">
                             <span className={`px-2 py-1 rounded text-[11px] font-bold ${p.type==='BUY'?'bg-up/10 text-up':'bg-down/10 text-down-text'}`}>{p.type==='BUY'?'خرید':'فروش'}</span>
                             {/* پوزیشن تعهدی باید در یک نگاه از نقدی جدا باشد — ریسکشان یکی نیست */}
                             {(p.leverage||1) > 1 && <span className="px-1.5 py-0.5 rounded text-[11px] font-black bg-alert/15 text-alert border border-alert/30">×{p.leverage}</span>}
                           </div>
                         </td>
                         <td className="py-3 font-mono text-ink">{p.amount}</td>
                         <td className="py-3 font-mono">{num(p.entryPrice)}</td>
                         <td className="py-3 font-mono text-[11px]">
                           {p.takeProfit ? <span className="text-up">{num(p.takeProfit)}</span> : <span className="text-muted">−</span>}
                           {' / '}
                           {p.stopLoss ? <span className="text-down-text">{num(p.stopLoss)}</span> : <span className="text-muted">−</span>}
                         </td>
                         <td className="py-3 font-mono text-[11px]">
                           {p.liquidationPrice ? <span className="text-down-text/80">{num(p.liquidationPrice)}</span> : <span className="text-muted">−</span>}
                         </td>
                         <td className={`py-3 font-mono font-bold ${signTone(p.pnl)}`}>
                           <FlashNumber value={p.pnl} />
                           {/* برای پوزیشن اهرمی، عدد خام گمراه‌کننده است: مهم این است که
                               چند درصدِ وجه تضمین است، چون همان است که می‌سوزد یا چند برابر می‌شود. */}
                           {(p.margin||0) > 0 && (
                             <span className="block text-[11px] font-normal opacity-70">
                               {Math.round(((p.pnl||0) / (p.margin||1)) * 100)}% وجه تضمین
                             </span>
                           )}
                         </td>
                         <td><button onClick={()=>handleClosePosition(p.id)} className="bg-down/10 hover:bg-down hover:text-ink transition-colors text-down-text px-3 py-1.5 rounded font-bold cursor-pointer text-[11px]">تسویه</button></td>
                       </tr>
                     ))}
                   </tbody>
                 </table> 
               </div>
             ) : <div className="text-center text-muted text-xs py-10">موقعیت بازی وجود ندارد</div>
           )}
           {bottomTab === 'history' && (
             userState?.completedTrades.length ? (
               <>
               {/* ⚠️ موبایل کارت می‌گیرد، نه جدول.
                   جدول min-w-[560px] دارد و داخل overflow-x-auto است، یعنی روی
                   موبایل ستون آخر — دکمه‌های «ساده/عمیق» — بیرون از کادر می‌افتد و
                   کاربر باید افقی اسکرول کند تا پیدایش کند. مهم‌ترین دکمه‌ی این
                   بخش نباید پشت یک اسکرول پنهان باشد. */}
               <div className="sm:hidden space-y-2.5">
                 {userState.completedTrades.map(t => (
                   <div key={t.id} className="bg-surface border border-line rounded-xl p-3 space-y-3">
                     <div className="flex items-center justify-between gap-2">
                       <div className="flex items-center gap-2 min-w-0">
                         <span className={`px-2 py-1 rounded text-[11px] font-bold shrink-0 ${t.type==='BUY'?'bg-up/10 text-up':'bg-down/10 text-down-text'}`}>{t.type==='BUY'?'خرید':'فروش'}</span>
                         <span className="text-[11px] text-ink-2 font-mono truncate">{t.amount} گرم</span>
                       </div>
                       <span className={`font-mono font-bold text-sm shrink-0 ${signTone(t.pnl)}`}>{num(t.pnl)}</span>
                     </div>

                     <div className="flex items-center justify-between gap-2 text-[11px]">
                       <span className="text-muted">ورود ← خروج</span>
                       <span className="font-mono text-ink-2 truncate">{num(t.entryPrice)} ← {num(t.exitPrice)}</span>
                     </div>

                     <div className="flex items-center justify-between gap-2 pt-1 border-t border-line/60">
                       {t.accuracy
                         ? <AccuracyBadge accuracy={t.accuracy} onClick={() => setAccuracyTrade(t)} />
                         : <span className="text-[11px] text-muted">بدون امتیاز</span>}
                       <div className="flex items-center gap-1.5 shrink-0">
                         <button
                           onClick={() => openAnalysis(t)}
                           className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-ai/40 bg-ai/15 text-ai-text active:bg-ai/30 transition-colors cursor-pointer text-[11px] font-bold"
                         >
                           <Sparkles className="h-3.5 w-3.5" /> ساده
                         </button>
                         <button
                           onClick={() => openDeepAnalysis(t)}
                           title="تحلیل عمیق — به‌زودی"
                           className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-brand/40 bg-brand/10 text-brand active:bg-brand/25 transition-colors cursor-pointer text-[11px] font-bold"
                         >
                           <Telescope className="h-3.5 w-3.5" /> عمیق
                         </button>
                       </div>
                     </div>
                   </div>
                 ))}
               </div>

               <div className="hidden sm:block overflow-x-auto">
                 <table className="w-full text-right text-xs text-ink-2 min-w-[560px]">
                   <thead className="text-muted"><tr className="border-b border-line"><th className="pb-3 font-medium">نوع</th><th className="pb-3 font-medium">حجم</th><th className="pb-3 font-medium">ورود</th><th className="pb-3 font-medium">خروج</th><th className="pb-3 font-medium">سود/زیان</th><th className="pb-3 font-medium">دقت</th><th className="pb-3 font-medium">تحلیل مربی</th></tr></thead>
                   <tbody>
                     {userState.completedTrades.map(t => {
                       return (
                       <tr key={t.id} className="border-b border-line/30 hover:bg-white/5 transition-colors">
                         <td className="py-2.5"><span className={`px-2 py-1 rounded text-[11px] font-bold ${t.type==='BUY'?'bg-up/10 text-up':'bg-down/10 text-down-text'}`}>{t.type==='BUY'?'خرید':'فروش'}</span></td>
                         <td className="py-2.5 font-mono">{t.amount}</td>
                         <td className="py-2.5 font-mono">{num(t.entryPrice)}</td>
                         <td className="py-2.5 font-mono">{num(t.exitPrice)}</td>
                         <td className={`py-2.5 font-mono font-bold ${signTone(t.pnl)}`}>{num(t.pnl)}</td>
                         <td className="py-2.5">
                           {t.accuracy
                             ? <AccuracyBadge accuracy={t.accuracy} onClick={() => setAccuracyTrade(t)} />
                             : <span className="text-[11px] text-muted">—</span>}
                         </td>
                         <td className="py-2.5">
                           <div className="flex items-center gap-1.5">
                             <button
                               onClick={() => openAnalysis(t)}
                               className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-ai/30 bg-ai/10 text-ai-text hover:bg-ai/20 hover:border-ai/60 transition-colors cursor-pointer text-[11px] font-bold"
                               title="مربی همین معامله را جزئی تحلیل می‌کند"
                             >
                               <Sparkles className="h-3 w-3" /> ساده
                             </button>
                             <button
                               onClick={() => openDeepAnalysis(t)}
                               className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-brand/30 bg-brand/10 text-brand hover:bg-brand/20 hover:border-brand/60 transition-colors cursor-pointer text-[11px] font-bold"
                               title="تحلیل عمیق — با نقطه‌ی ورود دقیق و نقاط پیشنهادی (به‌زودی)"
                             >
                               <Telescope className="h-3 w-3" /> عمیق
                             </button>
                           </div>
                         </td>
                       </tr>
                       );
                     })}
                   </tbody>
                 </table>
               </div>
               </>
             ) : <div className="text-center text-muted text-xs py-10">تاریخچه‌ای وجود ندارد</div>
           )}
        </div>
      </div>
    </div>
  );
}
