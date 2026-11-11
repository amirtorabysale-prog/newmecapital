// ══════════════════════════════════════════════
// Goldemy — Frontend Type Definitions
//
// این فایل تنها منبع تعریف تایپ‌هاست و باید دقیقاً با چیزی که سرور
// (server/index.js و server/services/marketEngine.js) می‌فرستد یکی باشد.
// ══════════════════════════════════════════════

import type { RouteId } from './router';

export type OrderType = 'BUY' | 'SELL';

/** سرور در پیام‌های INIT و TICK می‌فرستد. */
export interface MarketTick {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  lastTickTime: number;
  maznePrice: number;
  globalGoldSpot: number;
  usdIrtPrice: number;
  /** وضعیت جلسه‌ی XAUUSD؛ هنگام تعطیلی، آخرین کندل واقعی ثابت می‌ماند. */
  marketOpen?: boolean;
  marketStatus?: 'OPEN' | 'WEEKEND' | 'DAILY_BREAK' | 'WAITING';
  /** سرور این را نمی‌فرستد — کلاینت آن را از اختلاف با تیک قبلی حساب می‌کند. */
  change?: number;
}

export interface OrderBookEntry {
  price: number;
  volume: number;
  percent: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Position {
  id: string;
  type: OrderType;
  amount: number;
  entryPrice: number;
  pnl?: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  /** ۱ یعنی نقدی. بزرگ‌تر از ۱ یعنی تعهدی — طلا تحویل نشده، فقط وجه تضمین قفل است. */
  leverage?: number;
  margin?: number;
  /** فقط برای پوزیشن تعهدی؛ برای نقدی null است چون انحلالی در کار نیست. */
  liquidationPrice?: number | null;
}

/** یک عاملِ امتیاز دقت، همان‌طور که سرور حساب کرده. */
export interface AccuracyFactor {
  key: string;
  label: string;
  earned: number;
  max: number;
  verdict: string;
  hint: string | null;
}

/**
 * امتیاز دقت یک معامله — چقدر *درست* معامله شده، نه چقدر سود داده.
 * سرور همراه خودِ معامله می‌فرستد؛ محاسبه‌اش قطعی است و هزینه‌ای ندارد.
 */
export interface TradeAccuracy {
  score: number;
  grade: string;
  tone: 'great' | 'good' | 'ok' | 'poor';
  factors: AccuracyFactor[];
  biggestMistake: { key: string; label: string; verdict: string; hint: string | null } | null;
}

export interface WeeklyReport {
  weekKey: string;
  start: string;
  end: string;
  isEmpty: boolean;
  trades: number;
  accuracy: number | null;
  accuracyDelta: number | null;
  previousAccuracy: number | null;
  netPnl: number;
  winRate: number;
  stopLossRate: number;
  biggestMistake: { label: string; misses: number; total: number; hint: string | null } | null;
  bestTrade: WeeklyReportTrade | null;
  worstTrade: WeeklyReportTrade | null;
  trend: { at: string; score: number }[];
  headline: string;
}

export interface WeeklyReportTrade {
  id: string;
  type: OrderType;
  amount: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  score: number;
  grade: string;
  tone: 'great' | 'good' | 'ok' | 'poor';
}

export type DayBias = 'up' | 'down' | 'neutral' | 'stay-out';

/** پیمانی که کاربر صبح می‌بندد. */
export interface DailyPlan {
  id: string;
  date: string;
  bias: DayBias;
  maxLoss: number;
  maxTrades: number;
  note: string | null;
}

/** وضعیت زنده‌ی امروز نسبت به پیمان — حین معامله نشان داده می‌شود. */
export interface PlanStatus {
  tradesUsed: number;
  tradesLeft: number;
  tradesBreached: boolean;
  lossUsed: number;
  lossLeft: number;
  lossBreached: boolean;
  offBias: number;
  realized: number;
}

export interface PlanCheck {
  key: string;
  label: string;
  state: 'pass' | 'fail';
  detail: string;
}

/** گزارش پایان روز: پیمان صبح در برابر آنچه رخ داد. */
export interface DayReview {
  date: string;
  bias: DayBias;
  biasLabel: string;
  note: string | null;
  checks: PlanCheck[];
  verdict: 'kept' | 'slipped' | 'broken';
  kept: boolean;
  trades: number;
  closed: number;
  realized: number;
  accuracy: number | null;
  biggestMistake: { label: string; misses: number; hint: string | null } | null;
  headline: string;
}

export interface DailyPlanState {
  plan: DailyPlan | null;
  status: PlanStatus | null;
  /** دلایل نقض پیمان برای هر جهت — سرور از قبل حساب می‌کند. */
  breaches: { BUY: string[]; SELL: string[] } | null;
  review: DayReview | null;
  streak: number;
  today: string;
}

/** یک الگوی تکرارشونده که از تاریخچه‌ی واقعی کاربر بیرون کشیده شده. */
export interface TradePattern {
  id: string;
  title: string;
  detail: string;
  rule: string;
  severity: number;
  positive?: boolean;
}

export interface PatternsState {
  ready: boolean;
  needed: number;
  patterns: TradePattern[];
  weeklyRule: { from: string; title: string; rule: string } | null;
}

export interface DnaScores { execution: number | null; discipline: number; risk: number | null }

export interface DnaStyleVector {
  scalp: number; intraday: number; swing: number;
  dominant: 'scalp' | 'intraday' | 'swing' | null;
  label: string | null;
}

/** پروفایل پویای معامله‌گر — هر ماه از رفتار واقعی دوباره حساب می‌شود. */
export interface DnaProfile {
  ready: boolean;
  needed: number;
  period: string | null;
  trades: number;
  scores?: DnaScores;
  delta?: { execution: number | null; discipline: number | null; risk: number | null } | null;
  style?: DnaStyleVector;
  styleTitle?: string | null;
  /** میزان پوشش داده‌ی تحلیل؛ احتمال آماری یا تضمین صحت نیست. */
  confidence?: number;
  strengths?: { id: string; text: string }[];
  leaks?: { id: string; text: string }[];
  rules?: string[];
  challenge?: string | null;
  narrative?: string;
}

export interface DnaProfileState {
  profile: DnaProfile;
  history: { period: string; ready: boolean; scores: DnaScores | null; trades: number }[];
}

/** تعهدی که کاربر پذیرفته و رفتارش از آن لحظه به بعد نسبت به آن سنجیده می‌شود. */
export interface Commitment {
  id: string;
  patternId: string;
  rule: string;
  createdAt: string;
}

export interface CommitmentEvaluation {
  patternId: string;
  label: string;
  rule: string;
  days: number;
  tradesSince: number;
  rate?: number;
  status: 'pending' | 'kept' | 'broken';
  detail: string;
}

export interface CommitmentState {
  commitment: Commitment | null;
  evaluation: CommitmentEvaluation | null;
}

export interface CompletedTrade {
  id: string;
  type: OrderType;
  amount: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  timestamp: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  leverage?: number;
  /** سرور موقعِ تسویه تشخیصش می‌دهد — پایه‌ی واکنشِ «معامله‌ی انتقامی» هوگو. */
  isRevenge?: boolean;
  /** سرور همیشه می‌فرستد؛ اختیاری است فقط برای سازگاری با پاسخ‌های قدیمی. */
  accuracy?: TradeAccuracy;
}

/** پروفایل رفتاری کاربر — از جدول UserTradingDNA می‌آید. */
export interface TradingDNA {
  level: string;
  daysActive: number;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  greedLevel: number;
  fearLevel: number;
  disciplineScore: number;
  /** نسبت میانگین ارزش هر معامله به سرمایه‌ی در دسترس در لحظه‌ی باز شدنش. */
  avgRiskReward: number;
  dominantTrait: string;
  aiAnalysis: string;
  fomoTrades: number;
  revengeTrades: number;
}

/** سرور در پیام USER_UPDATE می‌فرستد. */
export interface UserState {
  rialBalance: number;
  goldBalance: number;
  /** وجه تضمینِ قفل‌شده‌ی پوزیشن‌های تعهدی — خرج نشده، با بستن پوزیشن برمی‌گردد. */
  blockedMargin?: number;
  positions: Position[];
  pnl: number;
  completedTrades: CompletedTrade[];
  /**
   * ⚠️ کلاینت دیگر از این استفاده نمی‌کند. `time` فقط ساعت و دقیقه است
   * (server/index.js) و با آن نه می‌شود بازه‌ی روزانه ساخت نه تاریخ نشان
   * داد؛ نمودار داشبورد سری را از روی `completedTrades` می‌سازد که
   * timestamp کامل دارد. اینجا مانده چون سرور هنوز می‌فرستدش.
   */
  pnlHistory: { time: string; pnl: number }[];
  tradingDNA?: TradingDNA;
}

// POSITIONS_PNL: به‌روزرسانیِ سبکِ هر-ثانیه — فقط سود/زیانِ پوزیشن‌های باز.
// USER_UPDATE فقط بعد از یک اقدامِ واقعی (سفارش، تسویه، ریست) می‌آید.
export type ServerMessageType = 'INIT' | 'TICK' | 'CANDLE_UPDATE' | 'USER_UPDATE' | 'POSITIONS_PNL' | 'NOTIFICATION';

export interface ServerMessage {
  type: ServerMessageType;
  data: any;
}

// ── تایپ‌های مخصوص رابط کاربری ──

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
  /** چند میلی‌ثانیه می‌ماند — نوارِ شمارشِ معکوس از همین عدد می‌خواند. */
  duration: number;
}

export interface AiVisualBlock {
  icon: string;
  title: string;
  content: string;
}

export interface AiPsychMetrics {
  emotion: string;
  score: number;
  advice: string;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'mentor';
  content: string;
  visualBlocks?: AiVisualBlock[];
  psychMetrics?: AiPsychMetrics | null;
  followUpQuestion?: string | null;
  timestamp: number;
}

/** تفسیر یک متریک رفتاری — از server/services/dnaInsights.js می‌آید. */
export interface DnaMetricInsight {
  key: 'greed' | 'fear' | 'discipline' | 'risk';
  title: string;
  /** عنوان کوتاه برای برچسب نمودار رادار. */
  short?: string;
  value: number;
  display: string;
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  advice: string | null;
  /** آیا این متریک به حد نصاب داده رسیده؟ اگر نه، عددش مقدار جانشین است نه اندازه‌گیری. */
  ready: boolean;
}

export interface DnaInsights {
  ready: boolean;
  tradesNeeded: number;
  confidence: number | null;
  metrics: DnaMetricInsight[];
  headline: string;
}

/** یک سؤال از مسیر شناخت کاربر — از server/services/profileQuestions.js می‌آید. */
export interface ProfileQuestion {
  id: string;
  stage: 'onboarding' | 'daily';
  question: string;
  hint?: string;
  trait: string;
  options: { value: string; label: string }[];
}

export interface ProfileQuizState {
  stage: 'onboarding' | 'daily' | 'done';
  questions: ProfileQuestion[];
  progress: { done: number; total: number; percent: number };
  askedToday?: number;
  dailyLimit?: number;
}

/** حساب کاربری — از GET /api/user/profile می‌آید. */
export interface UserProfile {
  id: string;
  phone: string;
  email: string | null;
  displayName: string | null;
  avatarId?: string | null;
  createdAt: string;
  progress?: LevelProgress;
  avatars?: AvatarOption[];
  plan?: string;
  planExpiresAt?: string | null;
}

export interface AvatarOption {
  id: string;
  label: string;
  minLevel: number;
  unlocked: boolean;
}

/**
 * یک مأموریت از مسیر پیشرفت.
 *
 * پلکانی است نه یک‌بارمصرف: با رد شدن از هر پله، هدف بعدی خودش باز می‌شود.
 * پیش‌تر چهار قدم ثابت بود و کاربر بعد از تمام کردنشان به بن‌بست می‌خورد.
 */
export interface Mission {
  id: string;
  title: string;
  hint: string;
  current: number;
  /** null یعنی همه‌ی پله‌ها رد شده. */
  target: number | null;
  done: boolean;
  tier: number;
  totalTiers: number;
}

/** سطح کاربر و آنچه با آن باز می‌شود. سمت سرور محاسبه می‌شود. */
export interface LevelProgress {
  xp: number;
  level: number;
  title: string;
  analysesPerDay: number;
  nextLevel: { level: number; title: string; minXp: number; analyses: number } | null;
  xpIntoLevel: number;
  xpForNextLevel: number;
  percent: number;
  missions: Mission[];
}

// ══════════════════════════════════════════════
// مسیر شروع — از GET /api/onboarding/journey می‌آید.
// قدم‌ها در server/services/onboardingJourney.js تعریف شده‌اند و وضعیتشان از
// روی کارهای واقعیِ کاربر خوانده می‌شود، نه از یک پرچمِ ذخیره‌شده.
// ══════════════════════════════════════════════

export type JourneyStepId = 'profile' | 'arena' | 'terminal' | 'academy';

export interface JourneyStep {
  id: JourneyStepId;
  order: number;
  title: string;
  kicker: string;
  description: string;
  cta: string;
  reward: string;
  route: RouteId;
  status: 'done' | 'current' | 'locked';
  goal: { current: number; target: number };
  hugo: { mood: string; line: string };
}

export interface JourneyState {
  steps: JourneyStep[];
  total: number;
  doneCount: number;
  percent: number;
  currentStepId: JourneyStepId | null;
  completed: boolean;
  /** فقط یک‌بار true است — سرور بلافاصله لحظه‌ی پایان را مهر می‌زند. */
  justCompleted: boolean;
  completedAt: string | null;
  skipped: boolean;
  active: boolean;
  headline: { mood: string; line: string };
}

/**
 * کارت «قدم بعدی تو» روی داشبورد.
 *
 * پیش‌تر تایپش inferred بود و از یک useMemo داخل App.tsx بیرون نمی‌آمد. حالا
 * که داشبورد فایل جداست، به یک تایپ صریح نیاز دارد.
 *
 * سه راه اقدام، بسته به اینکه قدم بعدی کجاست:
 *   go    — رفتن به یک بخش دیگر
 *   focus — همان‌جا ماندن ولی یک تب مشخص را باز کردن
 *   act   — باز کردن یک مودال، بدون جابه‌جایی
 */
export interface NextAction {
  tone: 'start' | 'live' | 'learn' | 'insight';
  title: string;
  body: string;
  cta: string;
  go?: RouteId;
  focus?: 'positions' | 'history';
  act?: () => void;
}

/** یک دور گفتگو با مربی درباره‌ی یک معامله‌ی مشخص. */
export type AnalysisTurn = { question: string | null; content: string };

/** وضعیت پنجره‌ی تحلیل معامله. سهمیه از سرور می‌آید، نه از شمارش سمت کلاینت. */
export type AnalysisState = {
  trade: CompletedTrade;
  turns: AnalysisTurn[];
  loading: boolean;
  error: string;
  quota: { remaining: number; limit: number } | null;
};
