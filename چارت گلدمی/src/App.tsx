/**
 * Goldemy — پوسته‌ی برنامه
 *
 * این فایل دو کار می‌کند و بس: نگه‌داشتن وضعیت مشترک (اتصال WebSocket، وضعیت
 * کاربر، مسیر جاری) و چیدن صفحه‌ها کنار هم. هر تکه‌ی رابط کاربری که منطق خودش
 * را دارد در ماژول خودش زندگی می‌کند:
 *
 *   chart/     — چارت شمعی، ابزار رسم، ویجت تریدینگ‌ویو، نمودار کوچک
 *   trading/   — دفتر سفارش و فرم ثبت سفارش
 *   coach/     — امتیاز دقت، گزارش هفتگی، پیمان روزانه، الگوها، تعهد، پیام مربی
 *   dna/       — پروفایل پویا و نمودار رادار
 *   shell/     — نوار اعلان و تور ایمنی خطا
 *   lib/       — قالب‌بندی عدد و تاریخ، صداها، ثابت‌ها
 *
 * ⚠️ قاعده‌ای که این تفکیک را نگه می‌دارد: ماژول‌ها هیچ‌وقت به App.tsx وابسته
 * نمی‌شوند. جریان وابستگی همیشه یک‌طرفه است — پوسته از ماژول‌ها استفاده می‌کند،
 * نه برعکس. اگر روزی یک ماژول به چیزی از پوسته نیاز داشت، آن چیز باید به
 * صورت prop به آن داده شود یا به lib/ منتقل شود.
 */

import React, { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import {
} from 'lucide-react';

// ══════════════════════════════════════════════
// Types — تعریف‌ها در src/types.ts نگهداری می‌شوند تا با قرارداد سرور یکی بمانند
// ══════════════════════════════════════════════
import type {
  MarketTick,
  OrderBook,
  Candle,
  UserState,
  ServerMessage,
  OrderType,
  Toast,
  CompletedTrade,
  DnaInsights,
  WeeklyReport,
  DayBias,
  UserProfile,
  Mission,
  ProfileQuestion,
  ProfileQuizState,
  JourneyState,
  NextAction,
  AnalysisState,
} from './types';
import { useRoute, navigateTo, type RouteId } from './router';
import { aggregateCandles, mergeCandles, type Timeframe } from './chart/candles';
import { PageFade } from './ui/LogoTransition';
/**
 * بخش‌های ثانویه با تأخیر بارگذاری می‌شوند.
 *
 * پیش‌تر همه‌چیز — از جمله پنل مدیریت که کاربر عادی هرگز نمی‌بیندش — در یک
 * تکه‌ی ۱.۱۵ مگابایتی در اولین بازدید دانلود می‌شد. برای محصولی که مخاطبش
 * موبایل ایرانی است، این یک مسئله‌ی تجربه‌ی کاربری است نه فقط مهندسی.
 *
 * ترمینال هم با تأخیر می‌آید، ولی نه به‌خاطر خودش: کتابخانه‌ی چارت
 * (lightweight-charts) را با خود می‌آورد و آن، بزرگ‌ترین وابستگی محصول است.
 * داشبورد صفحه‌ی فرود است و نباید هزینه‌ی چارتی را بدهد که هنوز ندیده.
 */
const Terminal = lazy(() => import('./pages/Terminal').then(m => ({ default: m.Terminal })));
const AdminPanel = lazy(() => import('./pages/AdminPanel').then(m => ({ default: m.AdminPanel })));
const AccountPage = lazy(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })));
const SkillPath = lazy(() => import('./pages/SkillPath').then(m => ({ default: m.SkillPath })));
const Arena = lazy(() => import('./pages/Arena').then(m => ({ default: m.Arena })));
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })));
const DecisionArenaLanding = lazy(() => import('./pages/DecisionArenaLanding').then(m => ({ default: m.DecisionArenaLanding })));
const TradeDnaLanding = lazy(() => import('./pages/TradeDnaLanding').then(m => ({ default: m.TradeDnaLanding })));
import { Dna } from './pages/Dna';
import { Mentor } from './pages/Mentor';
import { Dashboard } from './pages/Dashboard';
import { LandingPage } from './pages/LandingPage';

// ── هوگو: مربی سایت ──
// در همه‌ی بخش‌ها حاضر است و به رفتار کاربر واکنش نشان می‌دهد. جدولِ واکنش‌ها
// در src/hugo/reactions.ts است؛ این‌جا فقط رویدادهای واقعی به آن وصل می‌شوند.
import { HugoProvider, useHugo } from './hugo/HugoProvider';
import { reactionForClosedTrade } from './hugo/reactions';
import { HugoTourProvider, type HugoTourApi } from './hugo/tour/HugoTourProvider';
import { CHART_TOOL_HINTS } from './hugo/tour/steps';

// ── ماژول‌های موضوعی ──
import { BACKEND_URL, REPORT_INTERVAL_MS } from './lib/constants';
import { num, gatewayErrorMessage } from './lib/format';
import { playSyntheticSound } from './lib/sound';
import { collectPrices, type LivePrices } from './lib/priceReporter';

import type { ChartPreview, GhostTrade } from './chart/MazneChart';
import type { ChartTool } from './chart/tools';

import { OrderEntry } from './trading/OrderEntry';



import { AnnouncementBanner, type Announcement } from './shell/AnnouncementBanner';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { AppShell } from './shell/AppShell';
import { useAiChat } from './coach/useAiChat';
import { useDrawings } from './chart/useDrawings';
import { useCoachData } from './coach/useCoachData';
import { useAdminAccess } from './shell/useAdminAccess';
import { GlobalOverlays } from './shell/GlobalOverlays';

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// 📈 چارت شمعیِ قیمت گرم — روی همان قیمتی که کاربر واقعاً معامله می‌کند رسم می‌شود
// ══════════════════════════════════════════════
// MAIN APP COMPONENT
// ══════════════════════════════════════════════
/**
 * چیدمانِ دسکتاپ فعال است؟ — همان نقطه‌ی شکستِ `md` در تیلویند.
 *
 * تور برای آماده‌کردنِ رابط پیش از هر قدم لازمش دارد: زیر این عرض، ناوبری در
 * کشوی بازشونده است نه سایدبارِ ثابت، پس هدف‌های `nav-*` تا کشو باز نشود
 * اصلاً روی صفحه نیستند.
 */
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

function PublicPageFallback() {
  return (
    <div className="min-h-screen bg-[#090c12] flex items-center justify-center" dir="rtl">
      <p className="text-xs text-gray-400">در حال آماده‌کردن تجربه…</p>
    </div>
  );
}

/**
 * جای خالیِ بخشی که هنوز تکه‌ی جاوااسکریپتش نرسیده.
 *
 * عمداً یک اسپینر تمام‌صفحه نیست: بخش‌های با تأخیر معمولاً در چند صد
 * میلی‌ثانیه می‌آیند و یک اسپینرِ چشمک‌زن، بیشتر از خودِ انتظار حس کندی
 * می‌دهد. یک خط ساده، هم‌زبان با بقیه‌ی حالت‌های انتظار محصول.
 */
function RouteLoading() {
  return (
    <div className="flex items-center justify-center py-24" dir="rtl">
      <p className="text-[12px] text-muted">در حال باز کردن…</p>
    </div>
  );
}

function MainApp() {
  const [tick, setTick] = useState<MarketTick | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [historyState, setHistoryState] = useState<{ timeframe: Timeframe; candles: Candle[]; proxy: boolean; source?: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [activeCandle, setActiveCandle] = useState<Candle | null>(null);
  const activeCandleRef = useRef<Candle | null>(null); // مقایسه‌ی سریع و همگام با آخرین کندلِ در حال شکل‌گیری
  // برای تایم‌فریم ۴ساعته باید تاریخچه‌ی کافی حفظ شود: ۳۰۰۰ دقیقه حدود ۱۲ کندل ۴ساعته است.
  const MAX_CANDLES_IN_MEMORY = 3000; // با MAX_CANDLES سرور (server/types.js) هم‌راستا
  const [userState, setUserState] = useState<UserState | null>(null);
  const [connection, setConnection] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>('CONNECTING');
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // مسیر از آدرس مرورگر می‌آید، نه از state داخلی — تا لینک هر بخش قابل اشتراک باشد
  // و دکمه‌ی بازگشت مرورگر همان کاری را بکند که کاربر انتظار دارد.
  const [route, navigate] = useRoute();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  /**
   * فقط برای نمایش گزینه‌ی پنل مدیریت؛ مجوز واقعی سمت سرور بررسی می‌شود.
   * null یعنی «هنوز نپرسیده‌ایم» — با false یکی نیست: اگر ادمینی مستقیم /admin را
   * رفرش کند، تا رسیدن پاسخ نباید از صفحه بیرون انداخته شود.
   */
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('goldemy_is_logged_in') === 'true');
  const [userPhone, setUserPhone] = useState(() => localStorage.getItem('goldemy_user_phone') || '');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('goldemy_auth_token') || '');
  const [bottomTab, setBottomTab] = useState<'positions' | 'history'>('positions');
  // ⚠️ Context نمی‌تواند این‌جا مصرف شود: HugoTourProvider خودش داخل همین
  // JSX نصب می‌شود، پس MainApp والدِ آن است، نه فرزندش. کنترلِ replay از
  // طریق onReady به این ref می‌رسد — نگاه کنید به پایینِ فایل.
  const hugoTourApiRef = useRef<HugoTourApi | null>(null);
  // ⚠️ ref برای صدا زدنِ replay کافی است ولی برای *تصمیم‌گیریِ رندر* نه — تغییرِ
  // ref رندر نمی‌سازد. مودال‌های دیگر باید بدانند تور روی صفحه است یا نه، پس
  // وضعیتش جدا در state هم نگه داشته می‌شود.
  const [tourStatus, setTourStatus] = useState<HugoTourApi['status']>('not_started');
  const [mobileTerminalTab, setMobileTerminalTab] = useState<'chart' | 'order'>('chart');
  const [showMobileBook, setShowMobileBook] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>(1);
  const [chartTool, setChartTool] = useState<ChartTool>('none');
  /** با هر افزایش، OrderEntry بخشِ حد سود/ضرر را باز می‌کند — برای قدمِ «حد ضرر»ِ تور. */
  const [openTpSlSignal, setOpenTpSlSignal] = useState(0);
  /**
   * برای شروطِ تورِ پیشرفته: «اولین درسِ کامل‌شده». SkillPath خودش را اینجا
   * گزارش نمی‌دهد (پیشرفتِ آموزش سمتِ همان کامپوننت می‌ماند) — به‌جایش با
   * قبولی در اولین آزمون یک رویدادِ سراسری می‌فرستد و این پرچم را ست می‌کند.
   */
  const [firstLessonDone, setFirstLessonDone] = useState(() => localStorage.getItem('goldemy_first_lesson_done') === '1');
  useEffect(() => {
    const onLessonPassed = () => { localStorage.setItem('goldemy_first_lesson_done', '1'); setFirstLessonDone(true); };
    window.addEventListener('goldemy-lesson-passed', onLessonPassed);
    return () => window.removeEventListener('goldemy-lesson-passed', onLessonPassed);
  }, []);
  /**
   * رسم‌های کاربر روی چارت.
   *
   * 🐛 پیش‌تر فقط در حافظه‌ی صفحه بودند و با هر رفرش کل تحلیل از بین می‌رفت.
   * حالا در localStorage می‌مانند (src/chart/persistence.ts) و چون نقاطشان به
   * زمان لنگر دارند نه شماره‌ی کندل، بعد از بازگشت دقیقاً سرِ جای خودشان‌اند.
   */
  /** آهنربا پیش‌فرض روشن است: تازه‌کار با آن سطح را دقیق روی کندل می‌گذارد. */
  const [magnet, setMagnet] = useState(true);
  /** با هر افزایش، چارت به نمای پیش‌فرض برمی‌گردد. */
  const [chartReset, setChartReset] = useState(0);
  /** تعداد کندلِ جلوی چشم کاربر — بخشی از بافتاری که به مربی داده می‌شود. */
  const [visibleCandles, setVisibleCandles] = useState(0);
  /** پیش‌نمایشِ حد سود/ضررِ فرم سفارش، پیش از ثبت — روی چارت به‌صورت ناحیه‌ی نقطه‌چین دیده می‌شود. */
  const [orderPreview, setOrderPreview] = useState<ChartPreview | null>(null);
  /** پنجره‌ی تحلیل معامله توسط مربی. */
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [analysisQuestion, setAnalysisQuestion] = useState('');
  const [chartView, setChartView] = useState<'mazne' | 'global'>('mazne');
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('goldemy_muted') === 'true');
  const wsRef = useRef<WebSocket | null>(null);
  const appReconnectAttempts = useRef(0);

  // AI State
  const [dnaInsights, setDnaInsights] = useState<DnaInsights | null>(null);

  // ── حساب کاربری ──
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileEmailDraft, setProfileEmailDraft] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // ── مسیر شناخت کاربر ──
  const [quiz, setQuiz] = useState<ProfileQuizState | null>(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSaving, setQuizSaving] = useState(false);
  /** کاربر می‌تواند سؤال‌های روزانه را فعلاً کنار بگذارد — اجبار، آزاردهنده است. */
  const [quizDismissed, setQuizDismissed] = useState(false);
  const positionsSectionRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // ── مسیر شروع + هوگو ──
  // مسیر، وضعیتش را از سرور می‌گیرد (هیچ قدمی سمت کلاینت «تمام‌شده» نمی‌شود) و
  // هوگو همان API واکنش‌هاست که Provider در پایین همین فایل فراهم می‌کند.
  const hugo = useHugo();
  // هندلر WebSocket یک‌بار ساخته می‌شود و برای همیشه همان می‌ماند؛ اگر مستقیم به
  // hugo بچسبد، بعد از اولین رندر به نسخه‌ی کهنه‌اش گیر می‌کند (مثلاً کاربر
  // هوگو را ساکت کرده ولی هندلر هنوز نسخه‌ی قبل از ساکت شدن را دارد).
  const hugoRef = useRef(hugo);
  hugoRef.current = hugo;
  /**
   * راهنمای لحظه‌ایِ ابزارهای چارت — به‌جای معرفیِ نُه ابزار پشت‌سرِ هم در تور،
   * اولین باری که کاربر خودِ ابزار را انتخاب می‌کند، هوگو همان یک جمله را
   * می‌گوید. seenChartToolsRef با localStorage همگام است تا با رفرشِ صفحه هم
   * دوباره تکرار نشود.
   */
  const seenChartToolsRef = useRef<Set<string> | null>(null);
  const hintChartToolOnce = useCallback((id: string) => {
    if (!seenChartToolsRef.current) {
      let stored: string[] = [];
      try { stored = JSON.parse(localStorage.getItem('goldemy_hugo_seen_chart_tools') || '[]'); } catch { /* نادیده */ }
      seenChartToolsRef.current = new Set(stored);
    }
    const seen = seenChartToolsRef.current;
    if (seen.has(id)) return;
    seen.add(id);
    try { localStorage.setItem('goldemy_hugo_seen_chart_tools', JSON.stringify(Array.from(seen))); } catch { /* نادیده */ }
    const hint = CHART_TOOL_HINTS[id];
    if (hint) hugoRef.current.say({ mood: hint.mood, line: hint.message, ttl: 9000, priority: 4 });
  }, []);
  const [journey, setJourney] = useState<JourneyState | null>(null);
  /** مودال خوش‌آمد فقط یک‌بار روی هر مرورگر باز می‌شود؛ رفرش صفحه دوباره بازش نکند. */
  const [welcomeSeen, setWelcomeSeen] = useState(() => localStorage.getItem('goldemy_hugo_welcomed') === 'true');
  const [showFinale, setShowFinale] = useState(false);

  // 🚀 گاوصندوق قیمت‌های لایو فرانت‌اند (برای بلاک کردن دیتای اشتباه سرور)
  const livePricesRef = useRef<LivePrices>({ usd: null, gold: null });

  // ── Price Flashing Animation ──
  const prevPriceRef = useRef<number | null>(null);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (!tick?.price) return;
    // ⚠️ باگ قبلی: مرجع فقط وقتی قیمت تغییر نکرده بود به‌روز می‌شد، پس جهت فلش
    // برای همیشه نسبت به اولین قیمت سنجیده می‌شد. حالا همیشه به‌روز می‌شود.
    const previous = prevPriceRef.current;
    prevPriceRef.current = tick.price;
    if (previous === null || previous === tick.price) return;

    setPriceFlash(tick.price > previous ? 'up' : 'down');
    const timer = setTimeout(() => setPriceFlash(null), 600);
    return () => clearTimeout(timer);
  }, [tick?.price]);

  const toggleMute = () => {
    const nextState = !isMuted;
    setIsMuted(nextState);
    localStorage.setItem('goldemy_muted', String(nextState));
  };

  // ── Auth & WS ──
  const handleLoginSuccess = (phone: string, token: string) => {
    localStorage.setItem('goldemy_is_logged_in', 'true');
    localStorage.setItem('goldemy_user_phone', phone);
    localStorage.setItem('goldemy_auth_token', token);
    setIsLoggedIn(true); setUserPhone(phone); setAuthToken(token);
    addToast('ورود با موفقیت انجام شد.', 'success');
    playSyntheticSound('profit', isMuted);
    setTimeout(() => connectWebSocket(token), 300);
  };

  const connectWebSocket = (overrideToken?: string) => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    
    setConnection('CONNECTING');
    
    let token = overrideToken || authToken || localStorage.getItem('goldemy_auth_token') || '';
    if (token === 'undefined' || token === 'null') token = '';

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnection('CONNECTED');
      appReconnectAttempts.current = 0;
      // 🛡️ توکن دیگر در Query String آدرس نمی‌رود (نشت در لاگ سرور و پراکسی).
      // بلافاصله پس از برقراری اتصال، در بدنه‌ی پیام AUTH ارسال می‌شود.
      ws.send(JSON.stringify({ type: 'AUTH', data: { token } }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        
        // ✅ قیمت سرور تنها منبع حقیقت است.
        // پیش‌تر فرانت‌اند قیمت را محلی بازنویسی می‌کرد؛ نتیجه این بود که کاربر یک قیمت
        // می‌دید ولی معامله‌اش روی قیمت دیگری (قیمت سرور) اجرا می‌شد.
        if (msg.type === 'INIT' || msg.type === 'TICK') {
          const st = msg.data.tick;
          if (st) {
            setTick(prev => ({
              ...st,
              change: prev && prev.price > 0 ? st.price - prev.price : 0,
            }));
          }

          if (msg.data.orderBook) setOrderBook(msg.data.orderBook);
          if (msg.type === 'INIT') {
            if (msg.data.candles) setCandles(msg.data.candles);
            // کندلِ در حال شکل‌گیری در INIT نیست (فقط کندل‌های تمام‌شده) —
            // با اتصال جدید ریست می‌شود تا با کندلِ اتصال قبلی قاطی نشود.
            activeCandleRef.current = null;
            setActiveCandle(null);
            if (msg.data.user) setUserState(msg.data.user);
          }
        }

        // ✅ پیش‌تر این پیام اصلاً پردازش نمی‌شد — چارت هیچ‌وقت زنده آپدیت نمی‌شد.
        if (msg.type === 'CANDLE_UPDATE') {
          const incoming: Candle = msg.data;
          const previous = activeCandleRef.current;
          // اگر زمانِ کندلِ در حال شکل‌گیریِ قبلی با این یکی فرق دارد، یعنی آن
          // کندل تمام شده و باید به تاریخچه اضافه شود.
          if (previous && previous.time !== incoming.time) {
            setCandles((prev) => {
              const next = [...prev, previous];
              return next.length > MAX_CANDLES_IN_MEMORY ? next.slice(next.length - MAX_CANDLES_IN_MEMORY) : next;
            });
          }
          activeCandleRef.current = incoming;
          setActiveCandle(incoming);
        }

        if (msg.type === 'USER_UPDATE') setUserState(msg.data);
        // به‌روزرسانیِ سبکِ هر-ثانیه: فقط سود/زیانِ لحظه‌ایِ پوزیشن‌های باز.
        // ⚠️ سرور دیگر کلِ وضعیت کاربر را در هر تیک نمی‌فرستد؛ بقیه‌ی فیلدها
        // فقط با USER_UPDATE (بعد از یک اقدام واقعی) عوض می‌شوند.
        if (msg.type === 'POSITIONS_PNL') {
          const moved: Record<string, number> = {};
          for (const p of msg.data.positions) moved[p.id] = p.pnl;
          setUserState(prev => {
            if (!prev?.positions?.length) return prev;
            return {
              ...prev,
              positions: prev.positions.map(p => (p.id in moved ? { ...p, pnl: moved[p.id] } : p)),
            };
          });
        }
        if (msg.type === 'NOTIFICATION') {
          addToast(msg.data.message, msg.data.type);
          if (msg.data.message.includes('تسویه شد')) {
            // 🐛 پیش‌تر صدا از روی *نوعِ* پیام انتخاب می‌شد و تسویه‌ی زیان‌ده با
            // نوع error می‌آمد — یعنی «ضرر کردی» و «سیستم خراب شد» یک قاب و یک
            // صدا می‌گرفتند. حالا سرور خودِ عدد را می‌فرستد.
            playSyntheticSound((msg.data.pnl ?? 0) >= 0 ? 'profit' : 'loss', isMuted);
          }
          // کال مارجین از هر ضرر دیگری جدا است: تحلیل اشتباه نبوده، اندازه‌ی
          // ریسک اشتباه بوده — و هوگو باید همین را بگوید، نه یک دلداریِ کلی.
          if (msg.data.message.includes('کال مارجین')) hugoRef.current.react('liquidation');
        }
      } catch (e) {}
    };
    
    ws.onclose = (event) => {
      setConnection('DISCONNECTED');

      // کد ۴۰۰۱ یعنی سرور توکن را رد کرده. تلاش دوباره بی‌فایده است و فقط
      // باعث حلقه‌ی بی‌پایان اتصال مجدد و فشار روی سرور می‌شود.
      if (event.code === 4001) {
        localStorage.removeItem('goldemy_auth_token');
        localStorage.removeItem('goldemy_is_logged_in');
        setAuthToken('');
        setIsLoggedIn(false);
        return;
      }

      // ⚠️ عددِ تصادفی (jitter) عمدی است. وقتی سرور شلوغ می‌شود، اتصال‌ها
      // دسته‌جمعی می‌افتند؛ بدون این، همه دقیقاً هم‌زمان برمی‌گردند و همان
      // لحظه‌ای که سرور در بدترین حالش است یک موج ورودِ هم‌زمان می‌سازند —
      // یعنی خودِ بازیابی، خرابی را تشدید می‌کند.
      const base = Math.min(4000 * Math.pow(2, appReconnectAttempts.current), 60000);
      const backoffTime = base * (0.5 + Math.random() * 0.5);
      appReconnectAttempts.current += 1;
      setTimeout(() => connectWebSocket(), backoffTime);
    };

    ws.onerror = () => setConnection('DISCONNECTED');
  };

  useEffect(() => { 
    if (isLoggedIn) connectWebSocket(); 
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    }; 
  }, [isLoggedIn]);

  /**
   * گزارش‌گر قیمت — منطق واکشی در src/lib/priceReporter.ts است.
   *
   * اینجا فقط زمان‌بندی و ارسال انجام می‌شود: هر چند ثانیه یک بار قیمت‌ها جمع
   * می‌شوند و اگر اتصال باز بود به سرور گزارش می‌شوند.
   */
  useEffect(() => {
    if (connection !== 'CONNECTED' || !wsRef.current) return;

    let stopped = false;
    const reportOnce = async () => {
      const prices = await collectPrices(livePricesRef.current);
      if (stopped) return;
      livePricesRef.current = prices;
      if (wsRef.current?.readyState === WebSocket.OPEN && (prices.usd || prices.gold)) {
        wsRef.current.send(JSON.stringify({
          type: 'REPORT_PRICES',
          data: { usdIrtPrice: prices.usd, globalGoldSpot: prices.gold },
        }));
      }
    };

    reportOnce();
    const interval = setInterval(reportOnce, REPORT_INTERVAL_MS);
    return () => { stopped = true; clearInterval(interval); };
  }, [connection]);
  // ── Actions ──
  const sendAction = (a: Record<string, unknown>) => { 
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(a)); 
    } else {
      addToast('اتصال با سرور قطع است.', 'error');
      playSyntheticSound('error', isMuted);
    }
  };

  const handlePlaceOrder = (type: OrderType, amount: number, limitPrice?: number, takeProfit?: number, stopLoss?: number, leverage?: number, emotion?: number) => {
    // قیمت اجرا را سرور از اوراکل تعیین می‌کند؛ limitPrice فقط سقف/کف قابل قبول است.
    // اهرم هم مثل قیمت، سمت سرور دوباره اعتبارسنجی می‌شود.
    sendAction({ type: 'PLACE_ORDER', data: { type, amount, limitPrice, takeProfit, stopLoss, leverage, emotion } });
    playSyntheticSound('order', isMuted);

    // ⚠️ هوگو این‌جا حرف می‌زند نه بعد از بسته شدن معامله: نبودِ حد ضرر را باید
    // *الان* گفت که هنوز قابل جبران است. بعد از ضرر، همین جمله فقط سرزنش است.
    if (leverage && leverage >= 10) hugoRef.current.react('high_leverage');
    else if (!stopLoss) hugoRef.current.react('trade_no_stop');
    else hugoRef.current.react('trade_opened');
  };

  const handleClosePosition = (id: string) => {
    sendAction({ type: 'CLOSE_POSITION', data: { id } });
  };

  /**
   * ⚠️ useCallback عمدی است. این تابع حالا به هوک‌ها پاس داده می‌شود و در
   * آرایه‌ی وابستگی‌شان می‌نشیند؛ اگر با هر رندر از نو ساخته شود، هر چیزی که
   * به آن وابسته است هم بی‌دلیل از نو ساخته می‌شود.
   */
  const addToast = useCallback((message: string, type: 'success' | 'info' | 'error') => {
    const id = Math.random().toString(36).slice(2, 11);
    // ⚠️ خطا بیشتر می‌ماند. پیامِ خطا معمولاً «حالا چه کنم» را هم می‌گوید و
    // خواندنش از «سفارش ثبت شد» طول می‌کشد؛ چهار ثانیه یعنی نیمه‌خوانده بسته شدن.
    const duration = type === 'error' ? 8000 : 4000;
    // سقفِ سه پیامِ هم‌زمان: رگباری از خطا (مثلاً قطعِ اتصال) نباید نیمه‌ی صفحه را بپوشاند.
    setToasts(p => [...p.slice(-2), { id, message, type, duration }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration);
  }, []);
  
  const removeToast = (id: string) => {
    setToasts(p => p.filter(t => t.id !== id));
  };
  
  // امتیاز دقت روی خودِ معامله می‌آید، پس نیازی به واکشی جدا نیست — فقط انتخاب.
  const [accuracyTrade, setAccuracyTrade] = useState<CompletedTrade | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showDayReview, setShowDayReview] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [reportIsNew, setReportIsNew] = useState(false);
  const [showReport, setShowReport] = useState(false);

  /** معامله‌هایی که امتیاز دقتشان زیر «خوب» است — همان‌هایی که جا برای یادگیری دارند. */
  const lowAccuracyTrades = useMemo(
    () => (userState?.completedTrades || []).filter((t) => (t.accuracy?.score ?? 100) < 70),
    [userState]
  );
  const accurateCount = useMemo(
    () => (userState?.completedTrades || []).filter((t) => (t.accuracy?.score ?? 0) >= 85).length,
    [userState]
  );


  // کندل‌های تاریخچه + کندلِ در حال شکل‌گیری، برای رسم در چارت قیمت گرم
  const mazneCandles = useMemo(
    () => (activeCandle ? [...candles, activeCandle] : candles),
    [candles, activeCandle]
  );

  // وب‌سوکت فقط پنجرهٔ زنده را می‌دهد؛ تاریخچهٔ بلند با تغییر تایم‌فریم از API
  // خوانده می‌شود. اگر API موقتاً شکست بخورد، چارت زنده همچنان کار می‌کند.
  useEffect(() => {
    if (!isLoggedIn || route !== 'terminal' || chartView !== 'mazne') return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError('');

    fetch(`/api/market/candles?timeframe=${timeframe}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'تاریخچه دریافت نشد.');
        if (!Array.isArray(data.candles)) throw new Error('پاسخ تاریخچه نامعتبر است.');
        setHistoryState({
          timeframe,
          candles: data.candles,
          proxy: Boolean(data.proxy),
          source: data.source,
        });
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setHistoryError(err?.message || 'تاریخچه دریافت نشد.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });

    return () => controller.abort();
  }, [isLoggedIn, route, chartView, timeframe]);

  const liveTfCandles = useMemo(
    () => aggregateCandles(mazneCandles, timeframe),
    [mazneCandles, timeframe]
  );
  const tfCandles = useMemo(() => {
    const history = historyState?.timeframe === timeframe ? historyState.candles : [];
    return mergeCandles(history, liveTfCandles);
  }, [historyState, liveTfCandles, timeframe]);

  /**
   * رسم‌های چارت — همه‌چیزش در src/chart/useDrawings.ts است، با توضیح سه
   * قاعده‌ای که نگهشان می‌دارد.
   *
   * ⚠️ جای این فراخوانی مهم است. افکت‌های داخلش باید بعد از افکتِ گرفتن
   * تاریخچه‌ی کندل و پیش از افکت شبحِ معامله اجرا شوند — همان ترتیبی که پیش
   * از استخراج بود. و باید اینجا بماند، نه داخل صفحه‌ی ترمینال: چیزی که با
   * جابه‌جایی بین بخش‌ها unmount شود، رسم‌ها را با خودش می‌برد.
   */
  const chartDrawings = useDrawings({ isLoggedIn, authToken });
  const { drawings, setDrawings } = chartDrawings;

  // بعد از کامل شدن یک رسم، ابزار به حالت انتخاب برمی‌گردد — وگرنه کلیک بعدیِ
  // کاربر که معمولاً برای جابه‌جایی چارت است، ناخواسته یک رسم دیگر می‌سازد.
  const handleToolDone = useCallback(() => setChartTool('none'), []);

  /**
   * تحلیل یک معامله‌ی بسته‌شده توسط مربی.
   *
   * بافتار چارت — تایم‌فریم، تعداد کندلی که جلوی چشم کاربر بوده، و سطوح و خط‌های
   * روندی که خودش کشیده — همراه درخواست می‌رود. همین چیزی است که تفاوت «نصیحت
   * کلی» با «تحلیل همین معامله» را می‌سازد: مربی می‌بیند کاربر به چه نگاه می‌کرده.
   */
  const requestAnalysis = async (trade: CompletedTrade, question: string | null) => {
    setAnalysis((a) => (a ? { ...a, loading: true, error: '' } : a));
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai-mentor/analyze-trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          tradeId: trade.id,
          question,
          chartContext: {
            timeframe,
            visibleCandles,
            hlines: drawings.filter((d) => d.kind === 'hline').map((d) => d.points[0].price),
            trendCount: drawings.filter((d) => d.kind === 'trend' || d.kind === 'channel').length,
            tools: drawings.map((d) => d.kind),
            notes: drawings.filter((d) => d.kind === 'text').map((d) => d.text || ''),
          },
        }),
      });
      // 🐛 پیش‌تر اینجا فقط res.json() صدا زده می‌شد و هر پاسخِ غیرJSON به یک پیام
      // مبهم تبدیل می‌شد. هر مسیرِ خودِ سرور با فیلد error جواب می‌دهد، پس نبودنِ
      // آن یعنی خطا اصلاً به اپ نرسیده و از لایه‌ی جلوترِ آن (پراکسی) آمده —
      // دقیقاً همان چیزی که بدون دیدن کد وضعیت قابل تشخیص نیست.
      const raw = await res.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* پاسخ JSON نبود */ }

      if (!res.ok || typeof data.content !== 'string') {
        setAnalysis((a) => (a ? {
          ...a, loading: false,
          error: data.error || gatewayErrorMessage(res.status),
          quota: data.quota ?? a.quota,
        } : a));
        return;
      }

      setAnalysisQuestion('');
      setAnalysis((a) => (a ? {
        ...a, loading: false, error: '',
        quota: data.quota ?? a.quota,
        turns: [...a.turns, { question, content: data.content }],
      } : a));
    } catch {
      setAnalysis((a) => (a ? { ...a, loading: false, error: 'ارتباط با سرور برقرار نشد.' } : a));
    }
  };

  const openAnalysis = (trade: CompletedTrade) => {
    setAnalysisQuestion('');
    setAnalysis({ trade, turns: [], loading: true, error: '', quota: null });
    requestAnalysis(trade, null);
  };

  /**
   * تحلیل عمیق — هنوز به API دقیق (نقطه‌ی ورود ایده‌آل، نقاط پیشنهادی) وصل
   * نیست؛ فعلاً فقط با صدای هوگو به کاربر می‌گوید در راه است، به‌جای اینکه
   * دکمه بی‌جواب بماند یا قفل نشان بدهد.
   */
  const openDeepAnalysis = (_trade: CompletedTrade) => {
    hugo.say({
      mood: 'thinking',
      line: 'تحلیل عمیق داره آماده می‌شه — با نقطه‌ی ورود دقیق‌تر و نقاط پیشنهادی. فعلاً از «تحلیل ساده» استفاده کن.',
      ttl: 9000,
      priority: 5,
    });
  };

  const totalPnl = useMemo(() => userState?.pnl || 0, [userState]);
  const winRate = useMemo(() => { if (!userState || userState.completedTrades.length === 0) return 0; const wins = userState.completedTrades.filter(t => (t.pnl || 0) > 0).length; return Math.round((wins / userState.completedTrades.length) * 100); }, [userState]);
  const totalTrades = userState?.completedTrades.length || 0;
  const tDna = userState?.tradingDNA;

  /**
   * شبحِ آخرین معامله‌ی ضررده روی چارت — همان پنجره‌ی ۵ دقیقه‌ای که سرور برای
   * «معامله‌ی انتقامی» تعریف کرده (server/services/dnaEngine.js:
   * REVENGE_WINDOW_MS)، فقط این‌جا *پیش* از معامله‌ی بعدی نشانش می‌دهد، نه
   * postmortemِ بعدش. کاربر می‌بیند دفعه‌ی قبل دقیقاً همین‌جا چه اتفاقی افتاد.
   */
  const REVENGE_GHOST_WINDOW_MS = 5 * 60 * 1000;
  const lastClosedTrade = userState?.completedTrades?.[0] ?? null;
  const revengeGhost: GhostTrade | null = (
    lastClosedTrade && lastClosedTrade.pnl < 0 && lastClosedTrade.exitPrice != null
    && (Date.now() - lastClosedTrade.timestamp) < REVENGE_GHOST_WINDOW_MS
  ) ? { side: lastClosedTrade.type, entryPrice: lastClosedTrade.entryPrice, exitPrice: lastClosedTrade.exitPrice, pnl: lastClosedTrade.pnl } : null;

  /** یک‌بار برای هر معامله هوگو تذکر می‌دهد — نه هر رندر (این مقدار هر تیکِ قیمت دوباره حساب می‌شود). */
  const revengeGhostWarnedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!revengeGhost || !lastClosedTrade) return;
    if (revengeGhostWarnedRef.current === lastClosedTrade.id) return;
    revengeGhostWarnedRef.current = lastClosedTrade.id;
    hugo.say({
      mood: 'worried',
      line: 'معامله‌ی قبلی‌ات ضررده بود و هنوز چند دقیقه نگذشته. شبحش رو روی چارت گذاشتم — قبل از معامله‌ی بعدی، یه نگاه بهش بنداز.',
      ttl: 11000,
      priority: 7,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revengeGhost?.pnl, lastClosedTrade?.id]);

  // تفسیر متریک‌ها سمت سرور ساخته می‌شود (server/services/dnaInsights.js) تا آستانه‌ها
  // در دو جا تعریف نشوند. هر بار که DNA عوض شد (یعنی معامله‌ای تسویه شد) دوباره خوانده می‌شود.
  const dnaSignature = tDna ? `${tDna.totalTrades}:${tDna.greedLevel}:${tDna.fearLevel}:${tDna.disciplineScore}:${tDna.avgRiskReward}` : '';
  useEffect(() => {
    if (!isLoggedIn || !dnaSignature) return;
    let cancelled = false;
    (async () => {
      try {
        const token = authToken || localStorage.getItem('goldemy_auth_token');
        const res = await fetch(`${BACKEND_URL}/api/user/dna`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.insights) setDnaInsights(data.insights);
      } catch { /* تفسیر اختیاری است — نبودش نباید صفحه را بشکند */ }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, dnaSignature, authToken]);

  // ══════════════════════════════════════════════
  // 🎯 داشبورد: «الان چه کار کنم؟»
  //
  // فلسفه‌ی این بخش از پلتفرم‌های آموزشی خوب گرفته شده: صفحه‌ی خانه نباید فقط
  // آمار نشان دهد، باید در هر لحظه یک کار مشخص جلوی کاربر بگذارد. همه‌ی این
  // محاسبات از داده‌ی واقعی می‌آیند — هیچ شمارنده‌ی ساختگی‌ای در کار نیست.
  // ══════════════════════════════════════════════
  const openPositions = userState?.positions?.length || 0;

  /**
   * مسیر پیشرفت و سطح — از سرور می‌آید، نه از شمارش سمت کلاینت.
   *
   * دلیلش این نیست که کلاینت نمی‌تواند بشمارد؛ این است که سطح، سهمیه‌ی تحلیل و
   * آواتارهای باز‌شده را تعیین می‌کند. هر عددی که پاداش می‌دهد باید سمت سرور
   * محاسبه شود، وگرنه پاداش بی‌معنا می‌شود.
   */
  const progress = profile?.progress ?? null;
  const missions: Mission[] = progress?.missions ?? [];

  /**
   * یک کار مشخص برای همین حالا. ترتیب اهمیت دارد: چیزی که باز و ناتمام است،
   * بر چیزی که فقط «خوب است انجام شود» اولویت دارد.
   */
  const nextAction = useMemo<NextAction | null>(() => {
    if (!userState) return null;

    if (totalTrades === 0 && openPositions === 0) {
      return {
        tone: 'start' as const,
        title: 'اولین معامله‌ات را انجام بده',
        body: `${num(userState.rialBalance)} تومان سرمایه‌ی تمرینی داری. بدون ریسک واقعی، همان بازار واقعی طلای آبشده.`,
        cta: 'رفتن به ترمینال', go: 'terminal' as const,
      };
    }
    if (openPositions > 0) {
      const pnl = userState.positions.reduce((s, p) => s + (p.pnl || 0), 0);
      const noProtection = userState.positions.filter((p) => !p.stopLoss).length;
      return {
        tone: 'live' as const,
        title: `${num(openPositions)} پوزیشن باز داری`,
        body: noProtection > 0
          ? `${num(noProtection)} پوزیشن بدون حد ضرر است. اگر بازار برخلافت حرکت کند، چیزی جلویش را نمی‌گیرد.`
          : `سود/زیان لحظه‌ای: ${num(Math.round(pnl))} تومان. همه‌ی پوزیشن‌هایت حد ضرر دارند.`,
        cta: 'مدیریت پوزیشن‌ها', go: 'terminal' as const, focus: 'positions' as const,
      };
    }
    if (lowAccuracyTrades.length > 0) {
      const worst = lowAccuracyTrades[0];
      return {
        tone: 'learn' as const,
        title: `${num(lowAccuracyTrades.length)} معامله با دقت پایین`,
        body: worst.accuracy?.biggestMistake
          ? `بیشترین امتیازی که از دست دادی: ${worst.accuracy.biggestMistake.label} — ${worst.accuracy.biggestMistake.verdict}.`
          : 'امتیاز دقت می‌گوید چقدر درست معامله کردی، نه چقدر سود کردی.',
        cta: 'دیدن جزئیات', act: () => setAccuracyTrade(worst),
      };
    }
    if (dnaInsights && !dnaInsights.ready) {
      return {
        tone: 'start' as const,
        title: `${num(dnaInsights.tradesNeeded)} معامله تا تحلیل رفتاری`,
        body: 'با چند معامله‌ی دیگر، الگوی طمع و ترس و انضباطت از روی رفتار واقعی‌ات محاسبه می‌شود.',
        cta: 'ادامه بده', go: 'terminal' as const,
      };
    }
    return {
      tone: 'insight' as const,
      title: 'تحلیل رفتاری‌ات آماده است',
      body: dnaInsights?.headline || 'الگوی معاملاتی‌ات را در صفحه‌ی ترید دی‌ان‌ای ببین.',
      cta: 'دیدن تحلیل', go: 'profile' as const,
    };
  }, [userState, totalTrades, openPositions, lowAccuracyTrades, dnaInsights]);

  /** فرم‌های نام و ایمیل فقط بار اول از سرور پر می‌شوند. */
  const draftsInitialized = useRef(false);

  const loadProfile = useCallback(async () => {
    try {
      const token = authToken || localStorage.getItem('goldemy_auth_token');
      const res = await fetch(`${BACKEND_URL}/api/user/profile`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setProfile(data);

      // ⚠️ نوشته‌ی نیمه‌کاره‌ی کاربر بازنویسی نمی‌شود: این تابع حالا با هر معامله
      // دوباره صدا زده می‌شود، و اگر درست وسط تایپ کردنِ نام اجرا شود، حرف‌هایش
      // را پاک می‌کند.
      if (!draftsInitialized.current) {
        draftsInitialized.current = true;
        setProfileNameDraft(data.displayName || '');
        setProfileEmailDraft(data.email || '');
      }
    } catch { /* پروفایل اختیاری است — نبودش نباید صفحه را بشکند */ }
  }, [authToken]);

  // پروفایل حالا سطح و مأموریت‌ها را هم می‌آورد، و آن‌ها با هر معامله عوض
  // می‌شوند — پس دیگر «یک‌بار پس از ورود» کافی نیست.
  useEffect(() => {
    if (!isLoggedIn) return;
    loadProfile();
  }, [isLoggedIn, loadProfile, totalTrades, accurateCount]);

  /**
   * گزارش هفتگی خودش می‌آید.
   *
   * یک‌بار پس از ورود واکشی می‌شود و اگر هفته‌ی تازه‌ای باشد که کاربر ندیده،
   * خودش باز می‌شود. این تفاوت اصلی با یک صفحه‌ی گزارش است: کاربر لازم نیست
   * بداند چنین چیزی وجود دارد تا ببیندش.
   */
  /**
   * دسترسی ادمین — در src/shell/useAdminAccess.ts.
   * ⚠️ جای فراخوانی مهم است: دو افکتش باید بین افکتِ پروفایل و افکتِ اعلان
   * اجرا شوند، همان ترتیب قبلی.
   */
  const isAdmin = useAdminAccess({ isLoggedIn, authToken, route, navigate });

  /**
   * اعلان سراسری.
   *
   * بستنِ اعلان با شناسه‌اش ذخیره می‌شود، نه با یک پرچم ساده: اعلان بعدی باید
   * دوباره دیده شود، وگرنه اولین «باشه» کاربر همه‌ی خبرهای آینده را هم می‌بندد.
   */
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/announcement`);
        if (!res.ok) return;
        const { announcement: a } = await res.json();
        if (cancelled || !a) return;
        if (localStorage.getItem('goldemy_announcement_seen') === a.id) return;
        setAnnouncement(a);
      } catch { /* اعلان جانبی است */ }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const dismissAnnouncement = useCallback(() => {
    setAnnouncement((a) => {
      if (a) localStorage.setItem('goldemy_announcement_seen', a.id);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/user/weekly-report`, { headers: { Authorization: `Bearer ${authToken}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setWeeklyReport(data.report);
        setReportIsNew(!!data.isNew);
        // گزارشِ هفته‌ی خالی خودش باز نمی‌شود؛ مزاحمتِ بی‌فایده است.
        if (data.isNew && !data.report?.isEmpty) setShowReport(true);
      } catch { /* گزارش اختیاری است — نبودش نباید صفحه را بشکند */ }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, authToken]);

  /**
   * پیمان روزانه با هر تغییر در معاملات دوباره خوانده می‌شود، چون سنجه‌های
   * زنده‌اش (ورودِ مصرف‌شده، بودجه‌ی زیان) باید حین معامله به‌روز بمانند.
   */
  /**
   * داده‌های مربی — برنامه‌ی روز، پروفایل DNA، تعهد، الگوها.
   * منطقشان در src/coach/useCoachData.ts است.
   *
   * ⚠️ جای این فراخوانی مهم است: چهار افکتش باید بین افکتِ اعلان و افکتِ
   * چک‌این صبح اجرا شوند — همان ترتیبی که پیش از استخراج بود.
   */
  const coach = useCoachData({ isLoggedIn, authToken, totalTrades, openPositions, addToast });
  const { dailyPlan, dnaProfile, commitment, patterns, acceptingRule, acceptRule, loadDailyPlan } = coach;

  /**
   * مودال خوش‌آمد.
   *
   * فقط برای کسی که واقعاً تازه است: هنوز هیچ قدمی نرفته، مسیر را کنار نگذاشته،
   * و روی این مرورگر یک‌بار هم آن را ندیده. کاربری که از قبل کار کرده، به‌جای
   * مودال، همان کارت مسیر را در داشبورد می‌بیند.
   */
  const showWelcome = !!journey && !welcomeSeen && !journey.skipped && !journey.completed && journey.doneCount === 0;

  const onboardingOpen = quiz?.stage === 'onboarding' && !!quiz.questions[quizIndex];

  /**
   * شرطِ شروعِ خودکارِ تورِ هوگو.
   *
   * ⚠️ «تازه‌وارد» با قدم‌های *واقعیِ* محصول سنجیده می‌شود (میدان تصمیم،
   * ترمینال، آموزش) نه با doneCount.
   *
   * 🐛 پیش‌تر شرط `doneCount === 0` بود و تور هیچ‌وقت اجرا نمی‌شد: جواب دادن
   * به سه سؤالِ آشنایی خودش قدم اولِ مسیر را می‌بندد و doneCount را ۱ می‌کند،
   * پس تنها پنجره‌ای که تور مجاز بود، همان لحظه‌ای بود که مودالِ خوش‌آمد و
   * سؤال‌ها جلویش را گرفته بودند — و تا آن‌ها بسته می‌شدند، شرط برای همیشه از
   * بین رفته بود.
   *
   * ⚠️ این‌جا فقط مودالِ خوش‌آمد مسدودکننده است، نه سؤال‌ها و نه چک‌این: در
   * ترتیبِ تازه آن دو *پشتِ* تور می‌ایستند (tourHoldsScreen پایین‌تر). اگر
   * این‌جا هم به آن‌ها نگاه می‌شد، دو طرف منتظر هم می‌ماندند و هیچ‌کدام باز
   * نمی‌شد.
   */
  const hugoTourEligible = !!journey && !journey.completed && !journey.skipped && !showWelcome
    && journey.steps.every((s) => s.id === 'profile' || s.status !== 'done');

  /** تورِ پیشرفته فقط بعد از اولین معامله یا اولین درسِ کامل‌شده معنا دارد — نه زودتر. */
  const advancedTourTrigger = totalTrades > 0 || firstLessonDone;

  /**
   * تور روی صفحه است یا همین حالا می‌خواهد بیاید؟
   *
   * ترتیبِ اولین ورود: خوش‌آمد ← تور ← سؤال‌های آشنایی ← چک‌این. سؤال‌ها و
   * چک‌این با همین پرچم صبر می‌کنند تا تور تمام (یا رد) شود؛ وگرنه روی
   * اسپاتلایتِ تور می‌نشینند و کاربر دو چیز هم‌زمان جلوی رویش دارد.
   */
  const tourHoldsScreen = tourStatus === 'in_progress' || (tourStatus === 'not_started' && hugoTourEligible);

  /**
   * چک‌این صبح یک‌بار در روز خودش باز می‌شود.
   *
   * «بعداً» فقط تا پایان همان روز اثر دارد — با کلید روزِ تهران ذخیره می‌شود،
   * نه یک پرچم دائمی. وگرنه کاربری که یک‌بار رد کرده، دیگر هیچ‌وقت پیمان
   * نمی‌بندد و کل حلقه برایش خاموش می‌ماند.
   */
  useEffect(() => {
    if (!dailyPlan || dailyPlan.plan) return;
    if (localStorage.getItem('goldemy_checkin_skipped') === dailyPlan.today) return;
    // ⚠️ کاربر تازه، سؤال‌های آشنایی اولیه را هم دارد. اگر هر دو با هم باز
    // شوند، دو مودال روی هم می‌نشینند و اولین برخورد کاربر با سایت یک دیوار
    // پرسش می‌شود. چک‌این صبر می‌کند تا آشنایی اولیه تمام شود.
    if (onboardingOpen || showWelcome || tourHoldsScreen) return;
    setShowCheckIn(true);
  }, [dailyPlan, onboardingOpen, showWelcome, tourHoldsScreen]);

  const submitPlan = useCallback(async (input: { bias: DayBias; maxLoss: number; maxTrades: number; note: string }) => {
    if (!authToken) return;
    setPlanSaving(true);
    setPlanError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/user/daily-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ثبت پیمان ناموفق بود.');
      await loadDailyPlan();
      setShowCheckIn(false);
      addToast('پیمان امروزت ثبت شد.', 'success');
    } catch (e: any) {
      setPlanError(e.message || 'ثبت پیمان ناموفق بود.');
    } finally {
      setPlanSaving(false);
    }
  }, [authToken, loadDailyPlan]);

  const skipCheckIn = useCallback(() => {
    if (dailyPlan?.today) localStorage.setItem('goldemy_checkin_skipped', dailyPlan.today);
    setShowCheckIn(false);
  }, [dailyPlan]);

  const dismissReport = useCallback(async () => {
    setShowReport(false);
    if (!reportIsNew || !authToken) return;
    setReportIsNew(false);
    try {
      await fetch(`${BACKEND_URL}/api/user/weekly-report/seen`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch { /* اگر ثبت نشود، هفته‌ی بعد دوباره نشان داده می‌شود — بی‌ضرر */ }
  }, [reportIsNew, authToken]);

  // سؤال‌های شناخت کاربر. یک‌بار بعد از ورود خوانده می‌شود؛ سرور تصمیم می‌گیرد
  // امروز چه چیزی (و چند تا) پرسیده شود.
  const loadQuiz = useCallback(async () => {
    try {
      const token = authToken || localStorage.getItem('goldemy_auth_token');
      const res = await fetch(`${BACKEND_URL}/api/profile-quiz/next`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data: ProfileQuizState = await res.json();
      setQuiz(data);
      setQuizIndex(0);
    } catch { /* اختیاری است — نبودش نباید صفحه را بشکند */ }
  }, [authToken]);

  useEffect(() => { if (isLoggedIn) loadQuiz(); }, [isLoggedIn, loadQuiz]);

  const answerQuiz = async (question: ProfileQuestion, value: string) => {
    setQuizSaving(true);
    try {
      const token = authToken || localStorage.getItem('goldemy_auth_token');
      const res = await fetch(`${BACKEND_URL}/api/profile-quiz/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ questionId: question.id, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ثبت پاسخ ناموفق بود.');

      setQuiz((q) => (q ? { ...q, progress: data.progress } : q));
      // هر پاسخ امتیاز دارد، پس سطح ممکن است همین‌جا عوض شده باشد
      loadProfile();

      const isLast = !quiz || quizIndex >= quiz.questions.length - 1;
      if (isLast) {
        // آخرین سؤالِ این دسته — دوباره از سرور بپرس چه چیزی مانده
        await loadQuiz();
        if (quiz?.stage === 'onboarding') addToast('ممنون! حالا مربی بهتر می‌شناسدت.', 'success');
      } else {
        setQuizIndex((i) => i + 1);
      }
    } catch (e: any) {
      addToast(e.message || 'ثبت پاسخ ناموفق بود.', 'error');
    } finally {
      setQuizSaving(false);
    }
  };

  // ══════════════════════════════════════════════
  // مسیر شروع
  //
  // کاربر تازه با هفت بخشِ آماده روبه‌رو است و هیچ‌کدام نمی‌گویند «از کجا شروع
  // کن». مسیر شروع همان چیزی است که دولینگو دارد: چهار قدم مرتب که هرکدام با
  // *انجام دادن* باز می‌شوند. وضعیتش کاملاً سمت سرور محاسبه می‌شود
  // (server/services/onboardingJourney.js) — این‌جا فقط نمایش و واکشی است.
  // ══════════════════════════════════════════════

  const loadJourney = useCallback(async () => {
    try {
      const token = authToken || localStorage.getItem('goldemy_auth_token');
      if (!token) return;
      const res = await fetch(`${BACKEND_URL}/api/onboarding/journey`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data: JourneyState = await res.json();
      setJourney(data);
      if (data.justCompleted) setShowFinale(true);
    } catch { /* مسیر شروع اختیاری است — نبودنش نباید داشبورد را بشکند */ }
  }, [authToken]);

  const onDashboard = route === 'dashboard';

  // هر قدم با کارِ واقعی بسته می‌شود، پس مسیر بعد از همان کارها دوباره خوانده
  // می‌شود: معامله‌ی تازه، پاسخ به سؤال آشنایی، و برگشتن به داشبورد (که بعد از
  // میدان تصمیم یا یک درس اتفاق می‌افتد).
  useEffect(() => {
    if (!isLoggedIn) return;
    loadJourney();
  }, [isLoggedIn, loadJourney, totalTrades, quiz?.stage, onDashboard]);

  // هوگو در صفحه‌ی ورود و پنل مدیریت حضور ندارد: آن‌جا حرفی برای گفتن ندارد و
  // فقط جلوی دکمه‌ها را می‌گیرد.
  useEffect(() => {
    hugo.setActive(isLoggedIn && route !== 'admin');
  }, [hugo, isLoggedIn, route]);

  /**
   * تبریکِ بسته شدن یک قدم.
   *
   * ⚠️ عدد قبلی در ref نگه داشته می‌شود نه state: با state، هر تبریک خودش یک
   * رندر می‌سازد و رندر دوباره افکت را می‌دواند — نتیجه‌اش تبریکِ تکراری بود.
   */
  const journeyDoneRef = useRef<number | null>(null);
  useEffect(() => {
    if (!journey) return;
    const previous = journeyDoneRef.current;
    journeyDoneRef.current = journey.doneCount;
    // اولین بار فقط عدد را ثبت کن؛ کارهایی که *قبلاً* انجام شده‌اند تبریک ندارند.
    if (previous === null || journey.doneCount <= previous) return;
    hugo.react(journey.completed ? 'journey_complete' : 'journey_step_done');
  }, [journey, hugo]);

  /**
   * سکوتِ طولانی چه معنایی دارد — به «کجای کار است» بستگی دارد.
   *
   * ⚠️ تا وقتی مسیرِ شروع تمام نشده، کاربری که دست نگه داشته احتمالاً *گیر
   * کرده*، نه اینکه حوصله‌اش سر رفته باشد. جمله باید درباره‌ی همان قدمِ بعدی
   * باشد، نه یک «هنوز این‌جایی؟» عمومی.
   */
  useEffect(() => {
    hugo.setIdleEvent(journey && !journey.completed ? 'journey_idle' : 'idle_nudge');
  }, [journey, hugo]);

  /**
   * تبریکِ ارتقای سطح — همان الگوی journeyDoneRef: اولین بار فقط عدد را
   * ثبت کن، تبریک فقط برای *افزایش* بعدش.
   */
  const levelRef = useRef<number | null>(null);
  useEffect(() => {
    const level = progress?.level;
    if (level == null) return;
    const previous = levelRef.current;
    levelRef.current = level;
    if (previous === null || level <= previous) return;
    hugo.react('level_up');
  }, [progress?.level, hugo]);

  /**
   * تبریکِ تداومِ روزانه — یک‌بار در روز، فقط وقتی زنجیره‌ی پایبندی به قدری
   * رسیده که «چند روز پشت سر هم» را واقعاً معنا کند. کلید دیدن‌شده روی
   * تاریخِ سرور است نه یک پرچمِ دائمی، وگرنه فردا که زنجیره یک روز دیگر بلند
   * شود، دیگر هیچ‌وقت تبریک نمی‌گیرد.
   */
  const prevStreakRef = useRef<number | null>(null);
  useEffect(() => {
    if (!dailyPlan) return;
    const streak = dailyPlan.streak;
    const previous = prevStreakRef.current;
    prevStreakRef.current = streak;
    // اولین بار فقط پایه را ثبت کن: کاربری که از قبل زنجیره‌ی پنج‌روزه دارد،
    // با هر رفرشِ صفحه دوباره تبریک نمی‌گیرد — فقط با *افزایشِ واقعیِ* زنجیره.
    if (previous === null || streak <= previous) return;
    if (streak >= 3) hugo.react('streak');
  }, [dailyPlan, hugo]);

  const startJourney = useCallback(() => {
    localStorage.setItem('goldemy_hugo_welcomed', 'true');
    setWelcomeSeen(true);
    const step = journey?.steps.find((s) => s.status === 'current');
    // قدم اول روی خودِ داشبورد انجام می‌شود (سؤال‌های آشنایی)، پس جابه‌جایی لازم نیست.
    if (step && step.route !== 'dashboard') navigate(step.route);
  }, [journey, navigate]);

  /** «فعلاً نه» — مسیر پنهان می‌شود، پاک نمی‌شود. از حساب کاربری برمی‌گردد. */
  const skipJourney = useCallback(async () => {
    localStorage.setItem('goldemy_hugo_welcomed', 'true');
    setWelcomeSeen(true);
    setJourney((j) => (j ? { ...j, skipped: true, active: false } : j));
    try {
      const token = authToken || localStorage.getItem('goldemy_auth_token');
      await fetch(`${BACKEND_URL}/api/onboarding/journey/skip`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* اگر ثبت نشد، دفعه‌ی بعد دوباره پیشنهاد می‌شود — بی‌ضرر */ }
  }, [authToken]);

  const resumeJourney = useCallback(async () => {
    try {
      const token = authToken || localStorage.getItem('goldemy_auth_token');
      const res = await fetch(`${BACKEND_URL}/api/onboarding/journey/resume`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setJourney(await res.json());
    } catch { addToast('برگرداندن مسیر ناموفق بود.', 'error'); }
  }, [authToken]);

  /**
   * واکنش هوگو به بسته شدن هر معامله.
   *
   * ⚠️ «ضرر بزرگ» نسبت به دارایی سنجیده می‌شود نه عدد مطلق — منطقش در
   * src/hugo/reactions.ts است تا قابل تست بماند.
   *
   * ⚠️ اولین وضعیتی که از سرور می‌آید، تاریخچه است نه رویداد. اگر برایش واکنش
   * نشان می‌داد، هر بار که کاربر وارد سایت می‌شد، هوگو برای معامله‌ی هفته‌ی
   * پیش ناراحت می‌شد.
   */
  const lastClosedTradeRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = userState?.completedTrades?.[0];
    if (!latest) return;
    if (lastClosedTradeRef.current === null) { lastClosedTradeRef.current = latest.id; return; }
    if (lastClosedTradeRef.current === latest.id) return;
    lastClosedTradeRef.current = latest.id;

    const equity = (userState?.rialBalance ?? 0) + (userState?.blockedMargin ?? 0);
    // ⚠️ `isRevenge` از خودِ سرور می‌آید و اولویتش بالاتر از سود و ضرر است:
    // معامله‌ای که برای پس گرفتنِ ضررِ قبلی باز شده، حتی وقتی سود می‌دهد هم
    // خبرِ خوبی نیست — و همان لحظه‌ی سودآور بهترین وقت برای گفتنش است.
    hugo.react(reactionForClosedTrade({ pnl: latest.pnl, equity, isRevenge: latest.isRevenge }));
  }, [userState, hugo]);

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      const token = authToken || localStorage.getItem('goldemy_auth_token');
      const body: Record<string, string> = { displayName: profileNameDraft.trim() };
      // ایمیل اختیاری است؛ فقط وقتی فرستاده می‌شود که کاربر چیزی نوشته باشد،
      // چون سرور رشته‌ی خالی را ایمیل نامعتبر می‌شمارد.
      if (profileEmailDraft.trim()) body.email = profileEmailDraft.trim();

      const res = await fetch(`${BACKEND_URL}/api/user/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ذخیره‌ی پروفایل ناموفق بود.');

      setProfile((p) => (p ? { ...p, displayName: data.user.displayName, email: data.user.email } : p));
      addToast('پروفایل ذخیره شد.', 'success');
    } catch (e: any) {
      addToast(e.message || 'ذخیره‌ی پروفایل ناموفق بود.', 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  /**
   * انتخاب آواتار جدا از دکمه‌ی «ذخیره‌ی تغییرات» ذخیره می‌شود.
   * انتخاب آواتار یک تصمیم لحظه‌ای و بازگشت‌پذیر است؛ اگر کاربر مجبور باشد بعدش
   * دکمه‌ی ذخیره را هم پیدا کند، نیمی از مردم انتخابشان را از دست می‌دهند.
   */
  const saveAvatar = async (avatarId: string) => {
    if (avatarSaving || profile?.avatarId === avatarId) return;
    setAvatarSaving(true);
    // خوش‌بینانه عوض می‌شود تا انتخاب آنی حس شود؛ با خطا برمی‌گردد.
    const previous = profile?.avatarId ?? null;
    setProfile((p) => (p ? { ...p, avatarId } : p));
    try {
      const res = await fetch(`${BACKEND_URL}/api/user/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ avatarId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تغییر آواتار انجام نشد.');
    } catch (e: any) {
      setProfile((p) => (p ? { ...p, avatarId: previous } : p));
      addToast(e.message || 'تغییر آواتار انجام نشد.', 'error');
    } finally {
      setAvatarSaving(false);
    }
  };

  /**
   * خروج از حساب.
   *
   * 🛡️ localStorage.clear() عمدی است و می‌ماند: نفر بعدی که روی همین مرورگر
   * وارد می‌شود نباید هیچ ردی از کاربر قبلی ببیند — نه توکن، نه تحلیل روی چارت.
   *
   * 🐛 پیش‌تر همین پاک‌سازی رسم‌های چارت را هم می‌برد و کاربر بعد از ورود دوباره
   * می‌دید همه‌چیز پریده. حالا رسم‌ها روی سرور و بسته به حساب کاربرند
   * (src/chart/persistence.ts)، پس اینجا فقط کشِ محلی پاک می‌شود و نسخه‌ی اصلی
   * با ورود دوباره برمی‌گردد.
   */
  const doLogout = () => {
    // ترتیب مهم است: اول state خالی می‌شود تا هیچ افکتی نتواند دوباره چیزی را
    // در حافظه بنویسد، بعد حافظه پاک می‌شود.
    chartDrawings.reset();
    localStorage.clear();

    setIsLoggedIn(false);
    setAuthToken('');
    setUserPhone('');

    window.location.reload();
  };

  /**
   * گفتگو با مربی — state و منطقش در src/coach/useAiChat.ts است.
   *
   * ⚠️ جای این فراخوانی مهم است: افکت‌های داخلش باید *بعد* از افکت واکنش‌های
   * هوگو اجرا شوند، همان ترتیبی که پیش از استخراج بود.
   */
  const aiChat = useAiChat({ route, authToken, userState });

  /**
   * ⚠️ «مربی هوشمند» عمداً این‌جا نیست: به‌جای ردیفِ سایدبار، حالا با کلیک
   * روی خودِ هوگو (گوشه‌ی پایین-چپ، همیشه روی صفحه) باز می‌شود — یک راهِ
   * ورود، نه دو تا برای یک چیز.
   */
  // نام کوتاه و حرف اول، برای آواتار هدر
  const displayName = profile?.displayName?.trim() || '';

  // دو تجربه‌ی عمومی عمداً پیش از دیوار ورود رندر می‌شوند: بازدیدکننده باید
  // بتواند از نتیجه‌ی جست‌وجو، بدون حساب کاربری، نمونه‌ی محصول را لمس کند.
  if (route === 'public-arena') {
    return <Suspense fallback={<PublicPageFallback />}><DecisionArenaLanding /></Suspense>;
  }
  if (route === 'public-dna') {
    return <Suspense fallback={<PublicPageFallback />}><TradeDnaLanding /></Suspense>;
  }

  if (!isLoggedIn) return <LandingPage onLoginSuccess={handleLoginSuccess} backendUrl={BACKEND_URL} />;

  // پنل مدیریت تمام‌صفحه است: هدر، سایدبار و نوار قیمتِ سایت اینجا فقط شلوغی‌اند.
  if (route === 'admin' && isAdmin !== false) {
    if (isAdmin === null) {
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center" dir="rtl">
          <p className="text-[12px] text-muted">در حال بررسی دسترسی…</p>
        </div>
      );
    }
    return (
      <Suspense fallback={<div className="min-h-screen bg-surface flex items-center justify-center" dir="rtl"><p className="text-[12px] text-muted">در حال باز کردن…</p></div>}>
        <AdminPanel token={authToken} onExit={() => navigate('dashboard')} />
      </Suspense>
    );
  }

  return (
    <HugoTourProvider
      route={route}
      navigate={navigate}
      eligible={hugoTourEligible}
      advancedTrigger={advancedTourTrigger}
      authToken={authToken}
      context={{ totalTrades }}
      /* ⚠️ چیدمانِ موبایل با دسکتاپ یکی نیست و بیشترِ هدف‌های تور روی موبایل
         *وجود ندارند* مگر اینکه اول رابط آماده شود: ناوبری در کشوست نه سایدبار،
         و ترمینال دو تب دارد. این‌ها همان آماده‌سازی‌اند. روی دسکتاپ بیشترشان
         بی‌اثرند چون همه‌چیز از قبل روی صفحه است. */
      sideEffects={{
        'reveal-nav': () => { if (!isDesktop()) setIsDrawerOpen(true); },
        'hide-nav': () => setIsDrawerOpen(false),
        'show-chart-tab': () => { setIsDrawerOpen(false); setMobileTerminalTab('chart'); },
        'show-order-tab': () => { setIsDrawerOpen(false); setMobileTerminalTab('order'); },
        'show-orderbook': () => { setMobileTerminalTab('order'); setShowMobileBook(true); },
        'show-positions-tab': () => setBottomTab('positions'),
        'show-history-tab': () => setBottomTab('history'),
        'show-stop-loss': () => { setIsDrawerOpen(false); setMobileTerminalTab('order'); setOpenTpSlSignal((n) => n + 1); },
      }}
      onReady={(api) => { hugoTourApiRef.current = api; setTourStatus(api.status); }}
    >
    <AppShell
      route={route}
      navigate={navigate}
      isDrawerOpen={isDrawerOpen}
      setIsDrawerOpen={setIsDrawerOpen}
      accountMenuOpen={accountMenuOpen}
      setAccountMenuOpen={setAccountMenuOpen}
      connection={connection}
      tick={tick}
      priceFlash={priceFlash}
      userState={userState}
      profile={profile}
      progress={progress}
      displayName={displayName}
      userPhone={userPhone}
      totalTrades={totalTrades}
      winRate={winRate}
      isAdmin={isAdmin}
      isMuted={isMuted}
      toggleMute={toggleMute}
      doLogout={doLogout}
      weeklyReport={weeklyReport}
      reportIsNew={reportIsNew}
      setShowReport={setShowReport}
      hugoTourApiRef={hugoTourApiRef}
      overlays={<GlobalOverlays
        authToken={authToken} route={route}
        toasts={toasts} removeToast={removeToast}
        quiz={quiz} quizIndex={quizIndex} quizSaving={quizSaving} answerQuiz={answerQuiz} onboardingOpen={onboardingOpen}
        analysis={analysis} setAnalysis={setAnalysis}
        analysisQuestion={analysisQuestion} setAnalysisQuestion={setAnalysisQuestion}
        requestAnalysis={requestAnalysis} openAnalysis={openAnalysis}
        accuracyTrade={accuracyTrade} setAccuracyTrade={setAccuracyTrade}
        weeklyReport={weeklyReport} showReport={showReport} dismissReport={dismissReport}
        dailyPlan={dailyPlan} showCheckIn={showCheckIn} skipCheckIn={skipCheckIn}
        submitPlan={submitPlan} planSaving={planSaving} planError={planError}
        showDayReview={showDayReview} setShowDayReview={setShowDayReview}
        journey={journey} showWelcome={showWelcome} startJourney={startJourney}
        skipJourney={skipJourney} displayName={displayName}
        showFinale={showFinale} setShowFinale={setShowFinale}
        tourHoldsScreen={tourHoldsScreen}
      />}
    >
      <AnnouncementBanner announcement={announcement} onDismiss={dismissAnnouncement} />
      <PageFade routeKey={route}>
      <Suspense fallback={<RouteLoading />}>

      {/* ════ TERMINAL PAGE ════ */}
      {route === 'terminal' && (
        <Terminal
          tick={tick} orderBook={orderBook} userState={userState} dailyPlan={dailyPlan}
          timeframe={timeframe} setTimeframe={setTimeframe} tfCandles={tfCandles} candles={candles}
          historyState={historyState} historyLoading={historyLoading} historyError={historyError}
          chartView={chartView} setChartView={setChartView} chartReset={chartReset} setChartReset={setChartReset}
          chartTool={chartTool} setChartTool={setChartTool} handleToolDone={handleToolDone} hintChartToolOnce={hintChartToolOnce}
          drawings={drawings} setDrawings={setDrawings}
          handleAddDrawing={chartDrawings.add} handleRemoveDrawing={chartDrawings.remove} handleUpdateDrawing={chartDrawings.update}
          magnet={magnet} setMagnet={setMagnet} setVisibleCandles={setVisibleCandles}
          selectedPrice={selectedPrice} setSelectedPrice={setSelectedPrice}
          orderPreview={orderPreview} setOrderPreview={setOrderPreview}
          openTpSlSignal={openTpSlSignal} revengeGhost={revengeGhost}
          handlePlaceOrder={handlePlaceOrder} handleClosePosition={handleClosePosition}
          openAnalysis={openAnalysis} openDeepAnalysis={openDeepAnalysis} setAccuracyTrade={setAccuracyTrade}
          bottomTab={bottomTab} setBottomTab={setBottomTab} positionsSectionRef={positionsSectionRef}
          mobileTerminalTab={mobileTerminalTab} setMobileTerminalTab={setMobileTerminalTab}
          showMobileBook={showMobileBook} setShowMobileBook={setShowMobileBook}
          setShowCheckIn={setShowCheckIn} setShowDayReview={setShowDayReview}
        />
      )}

      {/* ════ DASHBOARD PAGE ════ */}
      {route === 'dashboard' && (
        <Dashboard
          journey={journey}
          skipJourney={skipJourney}
          resumeJourney={resumeJourney}
          nextAction={nextAction}
          navigate={navigate}
          setBottomTab={setBottomTab}
          positionsSectionRef={positionsSectionRef}
          quiz={quiz}
          quizIndex={quizIndex}
          quizSaving={quizSaving}
          quizDismissed={quizDismissed}
          setQuizDismissed={setQuizDismissed}
          answerQuiz={answerQuiz}
          progress={progress}
          missions={missions}
          profile={profile}
          userState={userState}
          totalTrades={totalTrades}
          winRate={winRate}
          dnaInsights={dnaInsights}
        />
      )}

      {/* ════ ARENA (DECISION FIELD) PAGE ════ */}
      {route === 'arena' && <Arena token={authToken} />}

      {/* ════ ACADEMY (SKILL PATH) PAGE ════ */}
      {route === 'academy' && <SkillPath token={authToken} />}

      {/* ════ PROFILE (DNA) PAGE ════ */}
      {route === 'profile' && (
        <Dna
          tDna={tDna}
          dnaInsights={dnaInsights}
          dnaProfile={dnaProfile}
          onNavigate={navigate}
        />
      )}

      {/* ════ AI MENTOR PAGE ════ */}
      {route === 'ai-mentor' && (
        <Mentor
          patterns={patterns}
          commitment={commitment}
          acceptRule={acceptRule}
          acceptingRule={acceptingRule}
          scrollRef={aiChat.scrollRef}
          messages={aiChat.messages}
          input={aiChat.input}
          onInputChange={aiChat.setInput}
          loading={aiChat.loading}
          onSend={aiChat.send}
        />
      )}

      {/* ════ ACCOUNT PAGE ════ */}
      {route === 'account' && (
        <AccountPage
          profile={profile}
          progress={progress}
          userPhone={userPhone}
          totalTrades={totalTrades}
          winRate={winRate}
          totalPnl={userState?.pnl || 0}
          accurateCount={accurateCount}
          nameDraft={profileNameDraft}
          emailDraft={profileEmailDraft}
          onNameChange={setProfileNameDraft}
          onEmailChange={setProfileEmailDraft}
          onSave={saveProfile}
          saving={profileSaving}
          avatarSaving={avatarSaving}
          onChooseAvatar={saveAvatar}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          confirmReset={confirmReset}
          onConfirmReset={() => setConfirmReset(true)}
          onCancelReset={() => setConfirmReset(false)}
          onReset={() => { sendAction({ type: 'RESET_ACCOUNT' }); setConfirmReset(false); }}
          onLogout={doLogout}
        />
      )}

      {/* ════ PRICING PAGE ════ */}
      {route === 'pricing' && (
        <Pricing token={authToken} plan={profile?.plan} planExpiresAt={profile?.planExpiresAt} />
      )}
      </Suspense>
      </PageFade>
    </AppShell>
    </HugoTourProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* هوگو باید *بالای* پوسته باشد تا هم پوسته و هم صفحه‌های داخلی بتوانند
          واکنش بفرستند. جابه‌جایی‌اش از navigateTo استفاده می‌کند، چون ویجت
          شناور بیرون از دسترسِ navigateِ پوسته است (src/router.ts). */}
      <HugoProvider onNavigate={(route) => navigateTo(route as RouteId)}>
        <MainApp />
      </HugoProvider>
    </ErrorBoundary>
  );
}
