/**
 * Goldemy — Enterprise Backend Server
 * Architecture: Prisma DB + WebSocket + Real AI + Hardened Price Oracle
 */

import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

import prisma from './config/db.js';
import { MarketEngine } from './services/marketEngine.js';
import { PriceService } from './services/priceService.js';
import { fetchGoldSpot, fetchUsdIrt, getUsdSourceReport } from './services/upstreamPrices.js';
import {
  INITIAL_RIAL_BALANCE, computePortfolio, unrealizedPnl,
  normalizeAmount, validateOrder, checkPriceLimit, checkAffordability,
  validateTpSl, checkTpSlTrigger, gramPriceFromMazne,
  normalizeLeverage, checkLiquidation, marginFor, normalizeEmotion,
} from './services/portfolio.js';
import { detectFomo, detectRevenge, computeDnaSnapshot } from './services/dnaEngine.js';
import { loadRecentCandles, saveCandle, dropOutOfScaleCandles } from './services/candleStore.js';
import { goldMarketStatusAt } from './services/marketSchedule.js';
import { ensureMarketHistory } from './services/marketHistory.js';
import { migrateToGramUnits } from './services/unitMigration.js';
import { scoreTrade } from './services/accuracy.js';
import { OpenPositionIndex } from './services/openPositionIndex.js';
import { ensureUserDna } from './services/userDna.js';
import { startRuntimeHealth, runtimeSnapshot } from './services/runtimeHealth.js';
import { applySeo, pageFor } from './services/seo.js';
import { GOLD_PRICE_PATH, renderGoldPricePage } from './services/seo/goldPricePage.js';
import { LEARN_PATH, renderLearnIndex, renderArticle } from './services/seo/learnPages.js';
import {
  COURSE_PATH, renderCourseIndex, renderCourse, renderLesson,
} from './services/seo/coursePages.js';
import { renderSitemap } from './services/seo/sitemap.js';

import { TICK_INTERVAL_MS } from './types.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { initSentry } from './services/sentry.js';
import { reportSystemFailure } from './services/incidentReporter.js';
import { SEVERITY } from './services/severity.js';
import authRoutes from './routes/auth.js';
import aiRoutes from './routes/ai.js';
import userRoutes from './routes/user.js';
import profileQuizRoutes from './routes/profile.js';
import educationRoutes from './routes/education.js';
import { latinDigitsJson } from './services/latinDigits.js';
import arenaRoutes from './routes/arena.js';
import supportRoutes from './routes/support.js';
import onboardingRoutes from './routes/onboarding.js';
import contentRoutes from './routes/content.js';
import { seedEducation } from './services/seedEducation.js';
import { seedCurriculum } from './services/seedCurriculum.js';
import { backfillEducationProgress } from './services/backfillEducationProgress.js';
import { createMarketRoutes } from './routes/market.js';
import { createAdminRoutes } from './routes/admin.js';
import { createMarketingRoutes } from './routes/marketing.js';
import createMarketingCardRoutes from './routes/marketingCard.js';
import createTelegramWebhookRoutes from './routes/telegramWebhook.js';
import { runSchedulerTick } from './services/marketing/scheduler.js';
import { runPlannerTick } from './services/marketing/planner.js';
import { recordPricePoint, prunePriceHistory } from './services/marketing/priceHistory.js';
import { seedTopicsIfEmpty } from './services/marketing/topics.js';

// ══════════════════════════════════════════════
// 🛡️ Logging
// ══════════════════════════════════════════════
const Logger = {
  info: (msg, meta = '') => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, meta),
  error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err?.message || err),
  warn: (msg, meta = '') => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, meta),
};

if (!process.env.JWT_SECRET) {
  Logger.error('🔥 CRITICAL FATAL ERROR: JWT_SECRET is missing in environment variables!');
  process.exit(1);
}

// هرچه زودتر — بدون SENTRY_DSN کاملاً بی‌اثر است (server/services/sentry.js).
initSentry();

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ══════════════════════════════════════════════
// ⚙️ Constants
// ══════════════════════════════════════════════
const WS_RATE_LIMIT = 5;                     // پیام بر ثانیه در هر اتصال
const WS_MAX_PAYLOAD_BYTES = 16 * 1024;
const WS_AUTH_TIMEOUT_MS = 15_000;
// ۶۰ ثانیه × دو دورِ بی‌پاسخ = تا دو دقیقه صبر پیش از قطع کردن یک اتصال.
const WS_HEARTBEAT_MS = 60_000;
// TradingView — رایگان و بدون محدودیت سهمیه. چون دیگر نویز تصادفی روی قیمت
// اضافه نمی‌شود (marketEngine.tick())، تنها منبع حرکتِ واقعیِ چارت همین است؛
// اگر خیلی کند باشد، بیشتر کندل‌ها در بازه‌ی ۱۰ ثانیه‌ای‌شان کاملاً صاف می‌مانند.
const GOLD_REFRESH_MS = 5_000;
// نواسان سهمیه‌ی رایگانش ۱۲۰ درخواست در ماه است. هر ۸ ساعت یک‌بار ≈ ۹۰ درخواست
// در ماه، با حاشیه‌ی امنیت. اگر NAVASAN_API_KEY تنظیم نشده باشد، این فراخوانی
// فقط منابع رایگان صرافی‌های ایرانی را امتحان می‌کند (که معمولاً از خارج ایران
// شکست می‌خورند) و بی‌صدا به اجماع کلاینت‌ها می‌افتد — دقیقاً رفتار قبلی.
const USD_REFRESH_MS = 8 * 60 * 60 * 1000;
const NAVASAN_API_KEY = process.env.NAVASAN_API_KEY || '';
const RECENT_CLOSED_TRADES = 50;

class OrderError extends Error {}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'https://goldemy.org', 'https://www.goldemy.org', 'https://goldemy.up.railway.app'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('دسترسی توسط CORS مسدود شد.'));
  },
  credentials: true,
}));

// ══════════════════════════════════════════════
// 🛡️ Content Security Policy
// فقط میزبان‌هایی که برنامه واقعاً به آن‌ها وصل می‌شود مجاز هستند.
// نکته: 'unsafe-inline' برای script فعلاً لازم است چون index.html اسکریپت‌های
// درون‌خطی گوگل آنالیتیکس و Clarity دارد. برداشتن آن نیازمند انتقال آن‌ها به
// فایل جداگانه یا استفاده از nonce است.
// ══════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      // Cloudflare Web Analytics را خودِ Cloudflare در صفحه تزریق می‌کند (تنظیمِ دامنه، نه
      // کدِ ما)؛ بی static.cloudflareinsights.com هر بازدید یک خطای CSP در کنسول می‌گذاشت
      // و آمارش هم ثبت نمی‌شد. cloudflareinsights.com پایین‌تر در connectSrc است.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com', 'https://www.clarity.ms', 'https://*.clarity.ms', 'https://static.cloudflareinsights.com'],
      // 🐛 پیش‌تر fonts.googleapis.com اینجا نبود، پس فونت فارسی سایت (Vazirmatn)
      // در production بی‌صدا مسدود می‌شد و مرورگر به فونت پیش‌فرض سیستم می‌افتاد.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      workerSrc: ["'self'", 'blob:'],
      connectSrc: [
        "'self'", 'ws:', 'wss:',
        'https://api.nobitex.ir', 'https://api.wallex.ir', 'https://api.allorigins.win',
        'https://scanner.tradingview.com',
        'https://www.google-analytics.com', 'https://*.google-analytics.com',
        'https://*.clarity.ms', 'https://c.bing.com', 'https://cloudflareinsights.com',
        // 🐛 بدون این، Sentry فرانت‌اند هیچ رویدادی نمی‌فرستاد — نه چون کدش خراب
        // بود، چون CSP بی‌صدا هر fetch/XHR/beacon به دامنه‌ی ingestِ Sentry را
        // مسدود می‌کرد. دامنه‌ی دقیق به‌جای سازمان (o<id>.ingest.<region>.sentry.io)
        // است و می‌تواند بین ریجن‌ها فرق کند، پس عمداً کل زیردامنه‌های sentry.io مجازند.
        'https://*.sentry.io', 'https://sentry.io',
      ],
      frameSrc: ['https://s.tradingview.com', 'https://www.tradingview.com'],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(correlationIdMiddleware);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(generalLimiter);

// 🐛 قبلاً MarketEngine همیشه با INITIAL_GRAM_PRICE (مقیاس «قیمت گرم»، ~۴٫۲۵ میلیون)
// ساخته می‌شد، در حالی که PriceService از همان لحظه‌ی اول یک قیمت مظنه‌ی واقعی‌تر
// (~۸۰ میلیون) دارد. نتیجه‌اش کندل‌های تاریخیِ ساخته‌شده در _init() با مقیاسی حدود
// ۱۹ برابر کوچک‌تر از قیمت زنده بود — در چارت کاملاً صاف به نظر می‌رسیدند.
const marketEngine = new MarketEngine(gramPriceFromMazne(PriceService.getLiveTick().maznePrice));

// ⚠️ ترتیب مهم است: مهاجرت واحد باید پیش از بارگذاری کندل‌ها تمام شود، وگرنه
// موتور بازار تاریخچه‌ای در مقیاس قدیم (مظنه) می‌گیرد و کنار قیمت زنده‌ی گرمی
// یک جهش ساختگی نشان می‌دهد — همان باگی که یک‌بار رفع شد.
migrateToGramUnits(prisma)
  .then((result) => {
    if (result) Logger.info(`🔄 واحد معامله به گرم تبدیل شد: ${result.trades} معامله، ${result.candles} کندل.`);
  })
  .catch((err) => Logger.error('مهاجرت واحد معامله ناموفق بود', err))
  // ⚠️ تورِ ایمنی، مستقل از اینکه مهاجرت موفق بوده یا نه. اگر مهاجرت شکست بخورد
  // خطایش فقط لاگ می‌شود و اجرا ادامه پیدا می‌کند — پس بدون این خط، تاریخچه‌ی
  // مقیاسِ قدیم کنار قیمت زنده‌ی گرمی می‌نشیند و چارت را غیرقابل خواندن می‌کند.
  .then(() => dropOutOfScaleCandles(prisma, gramPriceFromMazne(PriceService.getLiveTick().maznePrice)))
  .then((dropped) => {
    if (dropped) Logger.warn(`🧹 ${dropped} کندل خارج از مقیاس حذف شد (بازمانده‌ی واحد قبلی).`);
  })
  .catch((err) => Logger.warn('پاک‌سازی کندل‌های خارج از مقیاس ناموفق بود', err?.message))
  // تاریخچه‌ی چارت از دیتابیس برمی‌گردد. بدون این، هر استقرار جدید روی Railway
  // چارت همه‌ی کاربران را به یک صفحه‌ی خالی برمی‌گرداند.
  .then(() => loadRecentCandles(prisma))
  .then((candles) => {
    marketEngine.loadHistory(candles);
    if (candles.length) Logger.info(`📈 ${candles.length} کندل از تاریخچه بارگذاری شد.`);
  })
  .catch((err) => Logger.warn('بارگذاری تاریخچه‌ی کندل ناموفق بود', err?.message));

const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });

// پوزیشن‌های باز، در حافظه — تا حلقه‌ی تیک هر ثانیه جدول را جارو نکند.
const openPositions = new OpenPositionIndex();
// نگهبانِ هم‌پوشانی: هر لحظه فقط یک دورِ تسویه در جریان باشد.
let settlementInFlight = false;

server.on('upgrade', (request, socket, head) => {
  const pathname = (request.url || '').split('?')[0];
  if (pathname === '/ws' || pathname === '/ws/' || pathname.endsWith('/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

const safeSend = (ws, payload) => {
  if (ws.readyState !== 1) return;
  try {
    ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  } catch (err) {
    Logger.warn('WS send failed', err?.message);
  }
};

// extra برای داده‌ی ساختاریافته کنار متن (مثلاً pnl) — تا کلاینت مجبور نباشد
// تصمیمش را از روی *متنِ* پیام بگیرد.
const notify = (ws, message, type = 'info', extra = null) =>
  safeSend(ws, { type: 'NOTIFICATION', data: { message, type, ...(extra || {}) } });

// 💰 محاسبات مالی در server/services/portfolio.js متمرکز شده‌اند (قابل تست، بدون دیتابیس).

/** 🔒 قفل ردیف کاربر — جلوگیری از رقابت هم‌زمان (double-spend) بین چند اتصال */
const lockUserRow = (tx, userId) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

/**
 * تسویه‌ی یک پوزیشن باز — چه با دستور دستی کاربر (CLOSE_POSITION) و چه با
 * برخورد خودکار به حد سود/ضرر (checkTakeProfitStopLoss). هر دو مسیر باید
 * دقیقاً همین شرطِ status:'open' و همین بازسازیِ کامل DNA را طی کنند تا
 * تسویه‌ی دوباره غیرممکن بماند و DNA هیچ‌وقت با تاریخچه‌ی واقعی دچار انحراف نشود.
 * ⚠️ فراخوان مسئول باز کردن lockUserRow(tx, userId) پیش از این تابع است.
 */
async function settleOpenTrade(tx, { id, userId, exitPrice, pnl, isFomo, isRevenge }) {
  const updated = await tx.trade.updateMany({
    where: { id, userId, status: 'open' },
    data: { status: 'closed', exitPrice, pnl, closedAt: new Date(), isFomo, isRevenge },
  });
  if (updated.count !== 1) throw new OrderError('این معامله پیش‌تر تسویه شده است.');

  // ⚡ فقط ستون‌هایی که computeDnaSnapshot واقعاً می‌خواند. پیش‌تر کلِ ردیف
  // خوانده می‌شد — شاملِ متن یادداشت و ستون‌هایی که در این محاسبه هیچ نقشی
  // ندارند. برای کاربری با هزاران معامله، همین تفاوت یعنی چند برابر داده‌ی
  // کمتر روی شبکه و کارِ کمترِ deserialize، آن هم داخلِ تراکنشی که ردیفِ کاربر
  // را قفل نگه داشته است.
  const closedTrades = await tx.trade.findMany({
    where: { userId, status: 'closed' },
    select: {
      pnl: true, isFomo: true, isRevenge: true,
      goldAmount: true, entryPrice: true, createdAt: true, closedAt: true,
    },
  });
  const dnaSnapshot = computeDnaSnapshot(closedTrades, INITIAL_RIAL_BALANCE);

  await tx.userTradingDNA.upsert({
    where: { userId },
    create: { userId, ...dnaSnapshot },
    update: dnaSnapshot,
  });
}

/**
 * دروازه‌ی ورود — حداکثر چند نفر هم‌زمان می‌توانند «حسابشان بارگذاری» شود.
 *
 * 🐛 در تست بار با ۵۰۰ کاربر، زمانِ «از اتصال تا آماده شدن حساب» به ۳۸ ثانیه
 * رسید. علتش سقفِ ظرفیت نبود، هجوم بود: وقتی چند صد نفر با هم وارد می‌شوند،
 * هر کدام چند کوئری می‌زند و همه با هم روی استخرِ اتصال می‌ریزند. نتیجه این
 * می‌شود که *همه* کند می‌شوند — حتی کسی که تنها یک صفحه باز کرده.
 *
 * با یک صف، هر لحظه تعداد محدودی بارگذاری در جریان است. مجموعِ زمان همان است،
 * ولی به‌جای اینکه همه ۳۸ ثانیه صبر کنند، نفرات اول تقریباً آنی جواب می‌گیرند و
 * بقیه به‌ترتیب — و مهم‌تر: بقیه‌ی سایت زیر پای این هجوم از دست نمی‌رود.
 */
const HYDRATE_CONCURRENCY = 24;
let hydrateActive = 0;
const hydrateQueue = [];

function withHydrateSlot(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      hydrateActive += 1;
      task().then(resolve, reject).finally(() => {
        hydrateActive -= 1;
        const next = hydrateQueue.shift();
        if (next) next();
      });
    };
    if (hydrateActive < HYDRATE_CONCURRENCY) run();
    else hydrateQueue.push(run);
  });
}

/**
 * امتیازِ دقتِ یک معامله‌ی بسته‌شده هیچ‌وقت عوض نمی‌شود، ولی hydrateUserState
 * پس از *هر* دستور کاربر آن را برای ۵۰ معامله‌ی آخر از نو حساب می‌کرد. با ۵۰۰
 * کاربر فعال یعنی ده‌ها هزار محاسبه‌ی تکراری در دقیقه، روی همان تک‌رشته‌ای که
 * باید به بقیه‌ی سایت هم برسد.
 *
 * کش با کلیدِ شناسه‌ی معامله، و سقفِ ساده‌ی FIFO تا حافظه بی‌مرز رشد نکند.
 */
const ACCURACY_CACHE_MAX = 20_000;
const accuracyCache = new Map();

function cachedAccuracy(trade) {
  const hit = accuracyCache.get(trade.id);
  if (hit) return hit;

  const { score, grade, tone, factors, biggestMistake } = scoreTrade(trade);
  const value = { score, grade, tone, factors, biggestMistake };

  if (accuracyCache.size >= ACCURACY_CACHE_MAX) {
    accuracyCache.delete(accuracyCache.keys().next().value);
  }
  accuracyCache.set(trade.id, value);
  return value;
}

/**
 * بارگذاری‌های پشت‌سرهمِ *یک* کاربر با هم جمع می‌شوند.
 *
 * 🐛 در تست ۵۰۰ کاربره، p95 «از اتصال تا آماده شدن حساب» حتی با دروازه ۱۰.۷
 * ثانیه ماند. علتش این بود که هر اقدامِ کاربر (ثبت سفارش، بستن پوزیشن، برخوردِ
 * حد ضرر) هم یک بارگذاریِ کاملِ دیگر می‌سازد؛ صف پر از کارِ تکراری می‌شد و
 * ورودِ تازه پشتشان می‌ماند.
 *
 * ⚠️ نمی‌شود صرفاً بارگذاریِ *در جریان* را به همه پس داد: اگر آن یکی پیش از
 * ثبتِ سفارشِ جدید شروع شده باشد، نتیجه‌اش آن سفارش را ندارد و کاربر معامله‌اش
 * را نمی‌بیند. پس به‌جای آن، درخواست‌های تازه به یک بارگذاریِ *صف‌شده* وصل
 * می‌شوند که هنوز شروع نشده — چنین بارگذاری‌ای قطعاً بعد از همه‌ی نوشتن‌های
 * همین لحظه اجرا می‌شود، پس برای همه‌شان جواب درست است.
 */
const hydrateTail = new Map(); // آخرین بارگذاریِ در جریان یا صف‌شده‌ی هر کاربر
const hydrateQueued = new Map(); // بارگذاریِ صف‌شده‌ای که هنوز شروع نشده

function hydrateUserState(userId, currentPrice) {
  const queued = hydrateQueued.get(userId);
  if (queued) return queued;

  const tail = hydrateTail.get(userId);
  const build = () => withHydrateSlot(() => buildUserState(userId, currentPrice));

  let promise;
  if (!tail) {
    promise = build();
  } else {
    const startNow = () => {
      // از لحظه‌ی *شروع* دیگر تازه نیست؛ درخواستِ بعدی باید بارگذاریِ خودش را بگیرد.
      if (hydrateQueued.get(userId) === promise) hydrateQueued.delete(userId);
      return build();
    };
    promise = tail.then(startNow, startNow);
    hydrateQueued.set(userId, promise);
  }

  const cleanup = () => {
    if (hydrateTail.get(userId) === promise) hydrateTail.delete(userId);
    if (hydrateQueued.get(userId) === promise) hydrateQueued.delete(userId);
  };
  hydrateTail.set(userId, promise);
  promise.then(cleanup, cleanup);
  return promise;
}

async function buildUserState(userId, currentPrice) {
  // این تابع پس از *هر* اقدام کاربر و در هر ورود صدا زده می‌شود، پس مسیرِ
  // معمولی‌اش باید فقط خواندن باشد.
  //
  // 🐛 دو اشتباه پشت‌سرهم این‌جا رخ داد و هر دو در تست بار خودشان را نشان دادند:
  //   ۱. اولش findUnique و سپس create بود — دو تبِ هم‌زمانِ یک کاربر هر دو
  //      «نبود» را می‌دیدند و دومی با P2002 می‌شکست.
  //   ۲. بعد به upsert تغییر کرد، که رقابت را حل نکرد (Prisma این‌جا هنوز
  //      P2002 می‌دهد) و بدتر: هر ورود را به یک *نوشتن* تبدیل کرد. با ۵۰۰
  //      کاربر که هم‌زمان وارد می‌شوند، همان طوفانِ نوشتن سرور را زمین زد.
  //
  // شکلِ درست: خواندن، و فقط اگر واقعاً نبود ساختن — و اگر همان لحظه کسِ دیگری
  // زودتر ساخت، همان را برداشتن. مسیرِ معمولی هیچ نوشتنی ندارد.
  const dna = await ensureUserDna(prisma, userId);

  const [portfolio, recentClosedRaw] = await Promise.all([
    computePortfolio(prisma, userId, currentPrice),
    prisma.trade.findMany({
      where: { userId, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      take: RECENT_CLOSED_TRADES,
    }),
  ]);

  const completedTrades = recentClosedRaw.map((t) => {
    // امتیاز دقت همراه خودِ معامله می‌رود: قطعی، آنی و بدون هزینه محاسبه می‌شود،
    // پس دلیلی ندارد کاربر برای دیدنش درخواست جدا بفرستد یا سهمیه خرج کند.
    const { score, grade, tone, factors, biggestMistake } = cachedAccuracy(t);
    return {
      id: t.id, type: t.type, amount: t.goldAmount, entryPrice: t.entryPrice,
      exitPrice: t.exitPrice, pnl: t.pnl ?? 0,
      timestamp: t.closedAt ? t.closedAt.getTime() : t.createdAt.getTime(),
      // داشبورد از این‌ها می‌فهمد کاربر واقعاً از حد ضرر/سود استفاده کرده یا نه —
      // یکی از قدم‌های مسیر پیشرفت، به رفتار درست پاداش می‌دهد نه به سود.
      takeProfit: t.takeProfit, stopLoss: t.stopLoss,
      leverage: t.leverage ?? 1,
      // ⚠️ سرور خودش تشخیصِ «معامله‌ی انتقامی» را موقعِ تسویه ذخیره می‌کند
      // (detectRevenge)، ولی این پرچم هیچ‌وقت به کلاینت نمی‌رسید — پس واکنشِ
      // `revenge_trade` هوگو متن داشت و هیچ‌وقت صدا زده نمی‌شد.
      isRevenge: Boolean(t.isRevenge),
      accuracy: { score, grade, tone, factors, biggestMistake },
    };
  });

  let pnlAccumulated = 0;
  const chartData = [...completedTrades].reverse().map((t) => {
    pnlAccumulated += t.pnl;
    return {
      time: new Date(t.timestamp).toLocaleTimeString('fa-IR-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
      pnl: pnlAccumulated,
    };
  });

  return {
    rialBalance: portfolio.rialBalance,
    goldBalance: portfolio.goldBalance,
    // وجه تضمینِ قفل‌شده — از موجودی آزاد کم شده ولی خرج نشده، و با بستن
    // پوزیشن برمی‌گردد. کاربر باید این تفکیک را ببیند.
    blockedMargin: portfolio.blockedMargin,
    positions: portfolio.positions,
    completedTrades,
    pnl: portfolio.totalClosedPnl,
    pnlHistory: chartData.length > 0 ? chartData : [{ time: new Date().toLocaleTimeString('fa-IR-u-nu-latn'), pnl: 0 }],
    tradingDNA: dna,
  };
}

// ══════════════════════════════════════════════
// 🚀 REAL TIME PRICE ENGINE
// ══════════════════════════════════════════════
const OPTIMIZED_TICK_INTERVAL = Math.max(TICK_INTERVAL_MS || 1000, 1000);

/** قیمت مورد اعتماد را در تیک موتور بازار تزریق می‌کند. */
const applyOraclePrices = () => {
  const prices = PriceService.getLiveTick();
  const tick = marketEngine.currentTick;
  if (!tick) return prices;

  // ⚠️ price همان قیمتی است که معامله با آن اجرا می‌شود و کندل‌ها از آن ساخته
  // می‌شوند — و واحدِ معامله گرم است، پس این باید بهای هر گرم باشد.
  // مظنه جدا فرستاده می‌شود چون قیمت مرجعِ بازار است و کاربر ایرانی با همان
  // بازار را می‌شناسد؛ ولی هیچ محاسبه‌ی مالی‌ای رویش انجام نمی‌شود.
  tick.price = gramPriceFromMazne(prices.maznePrice);
  tick.maznePrice = prices.maznePrice;
  tick.globalGoldSpot = prices.globalGoldSpot;
  tick.usdIrtPrice = prices.usdIrtPrice;
  // کف/سقف و درصد تغییر در MarketEngine.tick() نگهداری می‌شوند تا منطق در یک جا بماند.

  return prices;
};

/**
 * پایش خودکار حد سود/ضرر — مستقل از اتصال کاربر. چون کاربر ممکن است هنگام
 * برخورد قیمت به سطحش آفلاین باشد، این چک نمی‌تواند داخل هندلر یک پیام WS
 * زندگی کند؛ باید بخشی از حلقه‌ی تیک بازار باشد که همیشه در حال اجراست.
 *
 * قیمتِ خروج دقیقاً همان سطح TP/SL ثبت‌شده است (نه قیمت لحظه‌ی برخورد) —
 * ساده‌تر و برای کاربر قابل پیش‌بینی‌تر از شبیه‌سازی لغزش قیمت (slippage).
 */
async function checkTakeProfitStopLoss(currentPrice) {
  // ⚡ پیش‌تر این‌جا هر ثانیه کلِ معاملاتِ بازِ *همه‌ی* کاربران از دیتابیس خوانده
  // می‌شد. حالا فهرست در حافظه است (openPositionIndex) و دیتابیس فقط وقتی لمس
  // می‌شود که واقعاً چیزی برخورد کرده باشد.
  const candidates = openPositions
    .triggered(currentPrice, { checkTpSlTrigger, checkLiquidation })
    .filter((hit) => hit.kind !== 'liquidation');
  if (candidates.length === 0) return;

  for (const { position, kind: trigger } of candidates) {
    const exitPrice = trigger === 'takeProfit' ? position.takeProfit : position.stopLoss;
    const pnl = Math.round(unrealizedPnl(position, exitPrice));
    const isFomo = detectFomo({ type: position.type, entryPrice: position.entryPrice, high24h: marketEngine.currentTick.high24h });
    const lastTrade = await prisma.trade.findFirst({
      where: { userId: position.userId, status: 'closed' },
      orderBy: { closedAt: 'desc' },
    });
    const isRevenge = detectRevenge({ previousClosedTrade: lastTrade, openedAt: position.createdAt });

    try {
      // ⚠️ پیش از تراکنش، نه داخلش: ساختنِ ردیفِ DNA داخلِ تراکنش اگر با
      // P2002 بخورد، کلِ تراکنش abort می‌شود و دیگر قابلِ جبران نیست.
      await ensureUserDna(prisma, position.userId);
      await prisma.$transaction(async (tx) => {
        await lockUserRow(tx, position.userId);
        await settleOpenTrade(tx, { id: position.id, userId: position.userId, exitPrice, pnl, isFomo, isRevenge });
      });
      openPositions.untrack(position.id);
    } catch (err) {
      // کاربر خودش هم‌زمان دستی تسویه کرده — نه خطا، فقط رقابت بی‌ضرر روی زمان.
      // در هر دو حالت دیگر باز نیست، پس از نمایه بیرون می‌رود.
      openPositions.untrack(position.id);
      if (err instanceof OrderError) continue;
      Logger.error('TP/SL auto-settle failed', err);
      reportSystemFailure(err, { severity: SEVERITY.CRITICAL, feature: 'auto-settlement-tp-sl', userId: position.userId });
      continue;
    }

    const label = trigger === 'takeProfit' ? 'حد سود' : 'حد ضرر';
    for (const client of wss.clients) {
      if (client.readyState !== 1 || client.userId !== position.userId) continue;
      try {
        client.userState = await hydrateUserState(position.userId, currentPrice);
        safeSend(client, { type: 'USER_UPDATE', data: client.userState });
        notify(client, `پوزیشن با ${label} در قیمت ${exitPrice.toLocaleString('fa-IR-u-nu-latn')} به‌طور خودکار تسویه شد.`, pnl >= 0 ? 'success' : 'error');
      } catch (err) {
        Logger.error('TP/SL notify failed', err);
      }
    }
  }
}

/**
 * پایش کال مارجین پوزیشن‌های تعهدی.
 *
 * چرا جدا از حد ضرر: حد ضرر اختیاری است و کاربر می‌تواند نگذاردش، ولی انحلال
 * اختیاری نیست — وقتی زیان به وجه تضمین می‌رسد، پوزیشن باید بسته شود وگرنه
 * موجودی کاربر منفی می‌شود، چیزی که در حساب واقعی هم اجازه‌اش را نمی‌دهند.
 *
 * قیمت خروج، قیمتِ لحظه‌ی برخورد است نه سطح نظری انحلال، چون بین دو تیک ممکن
 * است بازار از آن سطح رد شده باشد و وانمود کردن به خروجِ دقیق، به کاربر درسِ
 * غلط می‌دهد: در بازار واقعی هم انحلال دقیقاً سر عدد اتفاق نمی‌افتد.
 */
async function checkLiquidations(currentPrice) {
  // ⚡ مثل حد سود/ضرر، از نمایه‌ی حافظه — نه یک اسکنِ جدول در هر ثانیه.
  const positions = openPositions
    .triggered(currentPrice, { checkTpSlTrigger, checkLiquidation })
    .filter((hit) => hit.kind === 'liquidation')
    .map((hit) => hit.position);
  if (positions.length === 0) return;

  for (const position of positions) {
    const pnl = Math.round(unrealizedPnl(position, currentPrice));
    const isFomo = detectFomo({ type: position.type, entryPrice: position.entryPrice, high24h: marketEngine.currentTick.high24h });
    const lastTrade = await prisma.trade.findFirst({
      where: { userId: position.userId, status: 'closed' },
      orderBy: { closedAt: 'desc' },
    });
    const isRevenge = detectRevenge({ previousClosedTrade: lastTrade, openedAt: position.createdAt });

    try {
      // ⚠️ پیش از تراکنش، نه داخلش: ساختنِ ردیفِ DNA داخلِ تراکنش اگر با
      // P2002 بخورد، کلِ تراکنش abort می‌شود و دیگر قابلِ جبران نیست.
      await ensureUserDna(prisma, position.userId);
      await prisma.$transaction(async (tx) => {
        await lockUserRow(tx, position.userId);
        await settleOpenTrade(tx, { id: position.id, userId: position.userId, exitPrice: currentPrice, pnl, isFomo, isRevenge });
      });
      openPositions.untrack(position.id);
    } catch (err) {
      openPositions.untrack(position.id);
      if (err instanceof OrderError) continue;
      Logger.error('liquidation settle failed', err);
      reportSystemFailure(err, { severity: SEVERITY.CRITICAL, feature: 'auto-settlement-liquidation', userId: position.userId });
      continue;
    }

    const margin = marginFor(position);
    for (const client of wss.clients) {
      if (client.readyState !== 1 || client.userId !== position.userId) continue;
      try {
        client.userState = await hydrateUserState(position.userId, currentPrice);
        safeSend(client, { type: 'USER_UPDATE', data: client.userState });
        notify(
          client,
          `کال مارجین: پوزیشن تعهدی‌ات در ${currentPrice.toLocaleString('fa-IR-u-nu-latn')} بسته شد. از ${margin.toLocaleString('fa-IR-u-nu-latn')} تومان وجه تضمین، ${Math.max(0, margin + pnl).toLocaleString('fa-IR-u-nu-latn')} تومان برگشت.`,
          'error'
        );
      } catch (err) {
        Logger.error('liquidation notify failed', err);
      }
    }
  }
}

// ══════════════════════════════════════════════
// واکشی قیمت از منابع مورد اعتماد سرور — طلا و دلار با فرکانس جدا، چون طلا
// (TradingView) رایگان و بدون محدودیت است ولی دلار (نواسان) سهمیه‌ی ماهانه دارد.
// ══════════════════════════════════════════════
const refreshGoldPrice = async () => {
  try {
    const globalGoldSpot = await fetchGoldSpot();
    if (globalGoldSpot !== null) PriceService.setUpstream({ globalGoldSpot });
  } catch (err) {
    Logger.error('Gold price refresh failed', err);
  }
};

const refreshUsdPrice = async () => {
  try {
    const usdIrtPrice = await fetchUsdIrt(NAVASAN_API_KEY);
    if (usdIrtPrice !== null) {
      PriceService.setUpstream({ usdIrtPrice });
    } else {
      // 🐛 قبلاً فقط یک جمله‌ی کلی لاگ می‌شد و معلوم نبود کدام منبع چرا شکسته.
      // نتیجه‌اش این بود که دلار روزها روی مقدار موقت ماند بدون هیچ سرنخی.
      const detail = getUsdSourceReport().map((r) => `${r.source}: ${r.ok ? r.value : r.reason}`).join(' · ');
      Logger.warn(`⚠️ هیچ منبعی نرخ دلار نداد — اجماع کلاینت‌ها جایگزین می‌شود. ${detail}`);
    }
  } catch (err) {
    Logger.error('USD price refresh failed', err);
  }
};

/**
 * 🐛 تا وقتی دلار هنوز همان عددِ موقتِ نوشته‌شده در کد است (seed = ۱۸۵٬۰۰۰)،
 * منتظرِ نوبتِ بعدیِ ۸ ساعته نمی‌مانیم.
 *
 * چرا لازم شد: یک شکستِ گذرا در لحظه‌ی بالا آمدن سرور کافی بود تا دلار هشت
 * ساعتِ تمام روی seed بماند و کلِ محصول با قیمتِ ساختگی کار کند. اجماع
 * کلاینت‌ها هم نجاتش نمی‌داد، چون با کمتر از دو گزارش‌دهنده‌ی مستقل هر تیک فقط
 * ۰٫۰۵٪ حرکت می‌کند.
 *
 * چرا محدود و با فاصله‌ی رو به رشد: سهمیه‌ی رایگانِ نواسان ماهی ۱۲۰ درخواست است.
 * حداکثر چهار تلاشِ اضافه در هر ری‌استارت، هزینه‌ی قابل‌قبولی برای بیرون آمدن از
 * seed است.
 */
const USD_BOOTSTRAP_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 45 * 60_000];
let usdBootstrapTimer = null;

const usdIsSeed = () => PriceService.getDiagnostics().usd.source === 'seed';

const scheduleUsdBootstrapRetry = (attempt = 0) => {
  if (attempt >= USD_BOOTSTRAP_RETRY_MS.length || !usdIsSeed()) return;

  usdBootstrapTimer = setTimeout(async () => {
    if (!usdIsSeed()) return;
    Logger.warn(`⏳ دلار هنوز روی مقدار موقت است — تلاش مجدد ${attempt + 1} از ${USD_BOOTSTRAP_RETRY_MS.length}.`);
    await refreshUsdPrice();
    scheduleUsdBootstrapRetry(attempt + 1);
  }, USD_BOOTSTRAP_RETRY_MS[attempt]);
  usdBootstrapTimer.unref?.();
};

refreshGoldPrice();
refreshUsdPrice().then(() => scheduleUsdBootstrapRetry());
const goldInterval = setInterval(refreshGoldPrice, GOLD_REFRESH_MS);
const usdInterval = setInterval(refreshUsdPrice, USD_REFRESH_MS);

const marketInterval = setInterval(() => {
  const marketStatus = goldMarketStatusAt();
  PriceService.reconcile();
  const prices = applyOraclePrices();

  // موتور فقط پس از رسیدن قیمت *واقعی* شروع به ساختن کندل می‌کند. تا آن لحظه
  // قیمت همان مقدار موقتِ seed است و ثبتش روی چارت یک شمع ساختگی می‌سازد.
  if (PriceService.isReal()) marketEngine.activate(gramPriceFromMazne(prices.maznePrice), marketStatus.isOpen);

  const result = marketEngine.tick({ marketOpen: marketStatus.isOpen, marketStatus: marketStatus.code });
  const payload = JSON.stringify({ type: 'TICK', data: { tick: result.tick, orderBook: result.orderBook } });

  wss.clients.forEach((client) => {
    if (client.readyState !== 1) return;
    safeSend(client, payload);

    if (client.isAuthenticated && client.userState?.positions?.length > 0) {
      // ⚡ پیش‌تر این‌جا هر ثانیه *کلِ* userState دوباره سریال و فرستاده می‌شد —
      // شاملِ ۵۰ معامله‌ی بسته‌شده با تحلیل دقتشان، نمودار سود و شناسنامه‌ی
      // رفتاری — فقط برای اینکه یک عددِ سود/زیانِ لحظه‌ای تغییر کرده بود.
      // با ۵۰۰ کاربر یعنی ده‌ها مگابایت در ثانیه سریال‌سازی روی همان تک‌رشته.
      // حالا فقط همان چند عددِ تغییرکرده می‌رود.
      const moved = [];
      client.userState.positions.forEach((p) => {
        const newPnl = unrealizedPnl(p, result.tick.price);
        if (newPnl !== p.pnl) { p.pnl = newPnl; moved.push({ id: p.id, pnl: newPnl }); }
      });
      if (moved.length) safeSend(client, { type: 'POSITIONS_PNL', data: { positions: moved } });
    }
  });

  if (result.candleUpdate) {
    const candlePayload = JSON.stringify({ type: 'CANDLE_UPDATE', data: result.candleUpdate });
    wss.clients.forEach((client) => safeSend(client, candlePayload));
  }

  // کندلِ تازه بسته‌شده ماندگار می‌شود تا ری‌استارت سرور تاریخچه را پاک نکند.
  // fire-and-forget: اگر دیتابیس لحظه‌ای در دسترس نباشد، چارت زنده نباید بایستد.
  if (result.newCandle) {
    const closed = marketEngine.candles[marketEngine.candles.length - 1];
    if (closed) saveCandle(prisma, closed).catch((err) => Logger.warn('ذخیره‌ی کندل ناموفق بود', err?.message));
  }

  // 🎯 fire-and-forget — نباید حلقه‌ی تیکِ هر-یک-ثانیه‌ی بازار را منتظر یک کوئری دیتابیس نگه دارد.
  // ⚠️ ترتیب مهم است: حد ضرر قبل از انحلال. حد ضررِ کاربر همیشه نزدیک‌تر به
  // قیمت ورود از سطح انحلال است، پس اگر هر دو در یک تیک برخورد کنند، کاربر
  // باید با حد ضرر خودش خارج شود نه با کال مارجین.
  // نمایه‌ی پوزیشن‌ها هر دقیقه کامل از دیتابیس بازسازی می‌شود. این تنها کوئریِ
  // دوره‌ای این حلقه است — به‌جای دو کوئری در هر ثانیه.
  // ⚠️ اگر یک دورِ تسویه بیشتر از یک ثانیه طول بکشد (مثلاً ده‌ها پوزیشن هم‌زمان
  // به حد ضرر خورده‌اند)، دورِ بعدی نباید رویش سوار شود. بدون این نگهبان،
  // دورهای نیمه‌تمام روی هم انباشته می‌شوند و همان پوزیشن‌ها را دوباره می‌بینند —
  // یعنی درست در بدترین لحظه، فشار چند برابر می‌شود.
  if (!settlementInFlight) {
    settlementInFlight = true;
    openPositions.resyncIfDue(prisma)
      .catch((err) => Logger.warn('بازسازی نمایه‌ی پوزیشن‌ها ناموفق بود', err?.message))
      .then(() => checkTakeProfitStopLoss(result.tick.price))
      .then(() => checkLiquidations(result.tick.price))
      .catch((err) => {
        Logger.error('auto-settle failed', err);
        // این خطا از داخلِ هیچ حلقه‌ای نیامده (آن‌ها خودشان catch دارند) —
        // یعنی یک چیزِ سیستمی خراب است، مثلاً خودِ کوئریِ اولیه به دیتابیس نرسیده.
        reportSystemFailure(err, { severity: SEVERITY.CRITICAL, feature: 'market-tick-loop' });
      })
      .finally(() => { settlementInFlight = false; });
  }
}, OPTIMIZED_TICK_INTERVAL);

// ══════════════════════════════════════════════
// 📣 مرکز بازاریابی هوشمند — صف/زمان‌بند + برنامه‌ریزِ روزانه
// عمداً حلقه‌ی جدا از marketInterval: خطای اینجا نباید تیکِ قیمتِ زنده را کند کند
// یا با آن قاطی شود. هر دو تابع خودشان kill switch (MarketingSetting) را چک
// می‌کنند؛ وقتی خاموش است فوراً برمی‌گردند.
// ══════════════════════════════════════════════
const MARKETING_SCHEDULER_INTERVAL_MS = 60_000;
const MARKETING_PLANNER_INTERVAL_MS = 15 * 60_000;

const marketingSchedulerInterval = setInterval(() => {
  runSchedulerTick().catch((err) => {
    Logger.error('marketing scheduler tick failed', err);
    reportSystemFailure(err, { severity: SEVERITY.HIGH, feature: 'marketing-scheduler-tick' });
  });
}, MARKETING_SCHEDULER_INTERVAL_MS);

const marketingPlannerInterval = setInterval(() => {
  runPlannerTick().catch((err) => {
    Logger.error('marketing planner tick failed', err);
    reportSystemFailure(err, { severity: SEVERITY.HIGH, feature: 'marketing-planner-tick' });
  });
}, MARKETING_PLANNER_INTERVAL_MS);

/**
 * ثبتِ تاریخچه‌ی قیمتِ واقعی — برای نمودارِ کارت‌های مارکتینگ.
 *
 * ⚠️ روی همان تیکِ برنامه‌ریز سوار می‌شود چون هر دو پانزده‌دقیقه‌ای‌اند و
 * `recordPricePoint` خودش idempotent است (upsert روی کلیدِ زمان). یک تایمرِ
 * سوم برای کاری که در بازه‌ی یکسان انجام می‌شود، فقط یک چیزِ دیگر است که
 * می‌تواند خراب شود.
 *
 * هرس جدا و کم‌تکرار است تا هر تیک یک DELETE نزند.
 */
const pricePointInterval = setInterval(() => {
  recordPricePoint().catch((err) => Logger.warn('ثبتِ نقطه‌ی قیمت ناموفق بود', err?.message));
}, MARKETING_PLANNER_INTERVAL_MS);

const pricePruneInterval = setInterval(() => {
  prunePriceHistory().catch((err) => Logger.warn('هرسِ تاریخچه‌ی قیمت ناموفق بود', err?.message));
}, 24 * 3600_000);

/**
 * اتصال‌های نیمه‌باز را پاک می‌کند تا حافظه و لیست گزارش‌دهنده‌ها نشت نکند.
 *
 * 🐛 پیش‌تر یک دورِ بی‌پاسخ (۳۰ ثانیه) کافی بود تا اتصال کشته شود. زیر بار، وقتی
 * حلقه‌ی Node شلوغ است، pong کاربرانِ کاملاً سالم دیر خوانده می‌شود و سرور
 * خودش آن‌ها را بیرون می‌انداخت. در تست بار، ۱۰۳ اتصال از ۲۰۰ همین‌طور افتادند —
 * و چون کلاینت خودکار وصل می‌شود، همه با هم برمی‌گشتند و فشار را بیشتر می‌کردند.
 *
 * حالا دو دورِ بی‌پاسخ لازم است. یعنی برای تشخیصِ یک اتصالِ واقعاً مرده حداکثر
 * دو برابر طول می‌کشد — هزینه‌ی ناچیزی در برابر قطع کردنِ کاربرِ سالم.
 */
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.missedPongs >= 2) return client.terminate();
    client.missedPongs = (client.missedPongs || 0) + 1;
    try { client.ping(); } catch { /* در حال بسته شدن */ }
  });
}, WS_HEARTBEAT_MS);

// ══════════════════════════════════════════════
// 🔌 WebSocket
// احراز هویت با پیام AUTH پس از اتصال انجام می‌شود — توکن دیگر در URL نیست.
// ══════════════════════════════════════════════
let connectionCounter = 0;

wss.on('connection', (ws) => {
  ws.missedPongs = 0;
  ws.isAuthenticated = false;
  ws.userId = null;
  ws.reporterId = `ws_${++connectionCounter}_${Date.now()}`;
  ws.messageCount = 0;
  ws.lastMessageTime = Date.now();

  ws.on('pong', () => { ws.missedPongs = 0; });

  applyOraclePrices();
  const snapshot = marketEngine.getSnapshot();
  safeSend(ws, {
    type: 'INIT',
    data: {
      tick: snapshot.tick,
      orderBook: snapshot.orderBook,
      candles: snapshot.candles,
      user: { rialBalance: INITIAL_RIAL_BALANCE, goldBalance: 0, positions: [], completedTrades: [], pnlHistory: [], pnl: 0 },
    },
  });

  const authTimer = setTimeout(() => {
    if (!ws.isAuthenticated) {
      notify(ws, 'ورودت تأیید نشد. دوباره وارد شو.', 'error');
      ws.close(4001, 'Unauthorized');
    }
  }, WS_AUTH_TIMEOUT_MS);

  ws.on('close', () => {
    clearTimeout(authTimer);
    PriceService.dropReporter(ws.reporterId);
  });

  ws.on('error', (err) => Logger.warn('WS socket error', err?.message));

  ws.on('message', async (message) => {
    try {
      const now = Date.now();
      if (now - ws.lastMessageTime > 1000) {
        ws.messageCount = 0;
        ws.lastMessageTime = now;
      }
      ws.messageCount++;
      if (ws.messageCount > WS_RATE_LIMIT) {
        return notify(ws, 'درخواست‌هایت بیش از حد مجاز است. کمی صبر کن و دوباره بفرست.', 'warning');
      }

      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        return notify(ws, 'قالب پیام نامعتبر است.', 'error');
      }

      // ── احراز هویت ──
      if (parsed.type === 'AUTH') {
        if (ws.isAuthenticated) return;

        let decoded;
        try {
          decoded = jwt.verify(String(parsed.data?.token || ''), JWT_SECRET);
        } catch {
          notify(ws, 'نشستِ ورودت معتبر نیست. دوباره وارد شو.', 'error');
          return ws.close(4001, 'Unauthorized');
        }

        const userId = decoded.userId || decoded.id;
        const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }) : null;
        if (!user) {
          notify(ws, 'حسابت پیدا نشد. دوباره وارد شو.', 'error');
          return ws.close(4001, 'Unauthorized');
        }

        clearTimeout(authTimer);
        ws.isAuthenticated = true;
        ws.userId = user.id;
        ws.userState = await hydrateUserState(user.id, marketEngine.currentTick.price);
        return safeSend(ws, { type: 'USER_UPDATE', data: ws.userState });
      }

      // 🛡️ هر دستور دیگری فقط پس از احراز هویت پذیرفته می‌شود
      if (!ws.isAuthenticated) return;

      const userId = ws.userId;
      const currentPrice = marketEngine.currentTick.price;

      // ── گزارش قیمت از کلاینت (غیرقابل‌اعتماد؛ فقط ورودی اجماع) ──
      if (parsed.type === 'REPORT_PRICES') {
        PriceService.ingestClientReport(ws.reporterId, parsed.data || {});
        return;
      }

      // ── ثبت سفارش ──
      if (parsed.type === 'PLACE_ORDER') {
        const type = parsed.data?.type;
        const orderAmount = normalizeAmount(parsed.data?.amount);
        // ⚖️ اهرم هم مثل قیمت، هرگز خام از کلاینت پذیرفته نمی‌شود: هر مقدار
        // خارج از LEVERAGE_OPTIONS به ۱ (نقدی) برمی‌گردد.
        const leverage = normalizeLeverage(parsed.data?.leverage);
        const emotionScore = normalizeEmotion(parsed.data?.emotion);

        const validation = validateOrder({ type, amount: orderAmount });
        if (!validation.ok) return notify(ws, validation.error, 'error');

        // 🛡️ قیمت اجرا همیشه از اوراکل سرور می‌آید.
        // پیش‌تر عددِ ارسالی کلاینت مستقیماً به‌عنوان entryPrice ثبت می‌شد؛ کاربر می‌توانست
        // قیمت ورود ۱ تومان بدهد و بعد با بستن پوزیشن سود نجومی بسازد.
        const executionPrice = currentPrice;

        // عدد کاربر فقط به‌عنوان بدترین قیمت قابل قبول تفسیر می‌شود.
        const priceGuard = checkPriceLimit({ type, executionPrice, limitPrice: parsed.data?.limitPrice });
        if (!priceGuard.ok) return notify(ws, priceGuard.error, 'error');

        const tpSl = validateTpSl({
          type, executionPrice,
          takeProfit: parsed.data?.takeProfit,
          stopLoss: parsed.data?.stopLoss,
        });
        if (!tpSl.ok) return notify(ws, tpSl.error, 'error');

        let createdTrade = null;
        try {
          // ✅ چک موجودی داخل تراکنش و روی داده‌ی دیتابیس انجام می‌شود، نه روی کش اتصال
          await prisma.$transaction(async (tx) => {
            await lockUserRow(tx, userId);
            const { rialBalance, goldBalance } = await computePortfolio(tx, userId, executionPrice);

            const affordability = checkAffordability({ type, amount: orderAmount, executionPrice, rialBalance, goldBalance, leverage });
            if (!affordability.ok) throw new OrderError(affordability.error);

            createdTrade = await tx.trade.create({
              data: {
                userId, type, goldAmount: orderAmount, entryPrice: executionPrice,
                takeProfit: tpSl.takeProfit, stopLoss: tpSl.stopLoss,
                leverage, emotionScore,
                // وجه تضمین همین‌جا قفل می‌شود و تا لحظه‌ی بستن ثابت می‌ماند.
                margin: leverage > 1 ? Math.round((orderAmount * executionPrice) / leverage) : null,
              },
            });
          });
        } catch (err) {
          if (err instanceof OrderError) return notify(ws, err.message, 'error');
          throw err;
        }

        // ⚠️ فقط بعد از commit موفق وارد نمایه می‌شود — پوزیشنی که ثبت نشده نباید
        // پایش شود، و پوزیشنی که ثبت شده باید از همان تیکِ بعدی پایش شود.
        if (createdTrade) openPositions.track(createdTrade);

        ws.userState = await hydrateUserState(userId, executionPrice);
        safeSend(ws, { type: 'USER_UPDATE', data: ws.userState });
        return notify(
          ws,
          `سفارش ${type === 'BUY' ? 'خرید' : 'فروش'}${leverage > 1 ? ` تعهدی (اهرم ${leverage})` : ''} با قیمت ${executionPrice.toLocaleString('fa-IR-u-nu-latn')} ثبت شد.`,
          'success'
        );
      }

      // ── تسویه‌ی پوزیشن ──
      if (parsed.type === 'CLOSE_POSITION') {
        const id = parsed.data?.id;
        if (!id || typeof id !== 'string') {
          return notify(ws, 'آیدی معامله نامعتبر است.', 'error');
        }

        const position = await prisma.trade.findFirst({ where: { id, userId, status: 'open' } });
        if (!position) return notify(ws, 'معامله‌ی بازی با این مشخصات یافت نشد.', 'error');

        // ⚠️ pnl در دیتابیس Int است — بدون گرد کردن، تسویه‌ی حجم‌های اعشاری خطا می‌داد
        const pnl = Math.round(unrealizedPnl(position, currentPrice));
        const isFomo = detectFomo({ type: position.type, entryPrice: position.entryPrice, high24h: marketEngine.currentTick.high24h });

        const lastTrade = await prisma.trade.findFirst({
          where: { userId, status: 'closed' },
          orderBy: { closedAt: 'desc' },
        });
        const isRevenge = detectRevenge({ previousClosedTrade: lastTrade, openedAt: position.createdAt });

        try {
          // ✅ شرط status:'open' و بازسازی DNA در settleOpenTrade متمرکز شده‌اند —
          // همان مسیری که checkTakeProfitStopLoss برای تسویه‌ی خودکار استفاده می‌کند.
          await ensureUserDna(prisma, userId);
          await prisma.$transaction(async (tx) => {
            await lockUserRow(tx, userId);
            await settleOpenTrade(tx, { id, userId, exitPrice: currentPrice, pnl, isFomo, isRevenge });
          });
          openPositions.untrack(id);
        } catch (err) {
          // چه تسویه شده باشد چه پیش‌تر تسویه شده بود، دیگر باز نیست.
          openPositions.untrack(id);
          if (err instanceof OrderError) return notify(ws, err.message, 'error');
          throw err;
        }

        ws.userState = await hydrateUserState(userId, currentPrice);
        safeSend(ws, { type: 'USER_UPDATE', data: ws.userState });
        // ⚠️ «تسویه با زیان» یک نتیجه‌ی طبیعیِ بازار است، نه خطای سیستم. اگر با
        // نوع error بیاید، همان قاب و صدایی را می‌گیرد که «سرور خراب شد» —
        // ‏(‏CLAUDE.md: سبز و قرمز فقط برای جهت بازار).
        return notify(ws, `تسویه شد. سود/زیان: ${pnl.toLocaleString('fa-IR-u-nu-latn')} تومان`, 'info', { pnl });
      }

      // ── ریست حساب ──
      if (parsed.type === 'RESET_ACCOUNT') {
        await ensureUserDna(prisma, userId);
        await prisma.$transaction(async (tx) => {
          await lockUserRow(tx, userId);
          await tx.trade.deleteMany({ where: { userId } });
          // بدون معامله، snapshot دقیقاً همان مقادیر خنثی پیش‌فرض را می‌دهد —
          // یک منبع واحد برای «حالت اولیه»، به‌جای فهرست کردن دستیِ فیلدها.
          const dnaSnapshot = computeDnaSnapshot([], INITIAL_RIAL_BALANCE);
          await tx.userTradingDNA.upsert({
            where: { userId },
            create: { userId, ...dnaSnapshot },
            update: dnaSnapshot,
          });
        });

        // پوزیشن‌های این کاربر پاک شده‌اند؛ نمایه هم باید همان را ببیند، وگرنه
        // حلقه‌ی تیک تا بازسازیِ بعدی سراغ معاملاتی می‌رود که دیگر وجود ندارند.
        openPositions.untrackUser(userId);

        ws.userState = await hydrateUserState(userId, currentPrice);
        safeSend(ws, { type: 'USER_UPDATE', data: ws.userState });
        return notify(ws, 'حساب با موفقیت ریست شد.', 'info');
      }
    } catch (err) {
      Logger.error('WS Action Error:', err);
      // این‌جا یعنی یک دستورِ کاربر (ثبت سفارش، بستن پوزیشن و…) به‌طور غیرمنتظره
      // شکست خورد — نه یک خطای اعتبارسنجیِ عادی (آن‌ها با notify مدیریت می‌شوند
      // و اصلاً این catch را نمی‌رسند).
      reportSystemFailure(err, { severity: SEVERITY.HIGH, feature: 'ws-action', route: 'ws:message', userId: ws.userId });
      notify(ws, 'درخواستت انجام نشد — مشکل سمتِ ما بود. دوباره امتحان کن.', 'error');
    }
  });
});

// ══════════════════════════════════════════════
// 🚀 API Routes
// ══════════════════════════════════════════════
// oracle در پاسخ می‌آید تا بتوان تأیید کرد منبع مورد اعتماد سرور در دسترس است.
// اگر source برابر 'upstream' نبود، یعنی سرور به APIهای قیمت نمی‌رسد و
// سیستم روی اجماع کلاینت‌ها (حالت پشتیبان) کار می‌کند.
/**
 * یک منبع برای «حالِ سرور» — هم `/api/health` از آن ساخته می‌شود هم دستورِ
 * `/status` باتِ تلگرام. اگر دو جا جدا محاسبه شوند، روزی که از هم جدا بیفتند
 * هیچ‌کس نمی‌فهمد کدام درست است.
 */
const healthSnapshot = () => ({
  status: 'ok',
  oracle: PriceService.getDiagnostics(),
  // آخرین تلاشِ هر منبعِ دلار — بدون این، شکستِ upstream از بیرون نامرئی بود.
  usdSources: getUsdSourceReport(),
  // بدون این اعداد، هر تشخیصی درباره‌ی کندیِ سایت حدس است — رجوع کنید به
  // server/services/runtimeHealth.js.
  runtime: runtimeSnapshot({ wsClients: wss.clients.size, openPositions: openPositions.size() }),
  // ⚠️ فقط *وجودِ* پیکربندی، نه مقدارش. بدون این، «کد ارسال نشد» دو علتِ کاملاً
  // متفاوت داشت — توکن تنظیم نشده، یا تنظیم شده و خودِ ارسال شکست خورده — و از
  // بیرون هیچ راهی برای تفکیکشان نبود.
  delivery: {
    otpTelegram: Boolean(process.env.TELEGRAM_GATEWAY_TOKEN),
    otpSms: Boolean(process.env.SMS_API_KEY),
    adminAlerts: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALERT_CHAT_ID),
    telegramWebhook: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    // ⚠️ باتی که در کانال پست می‌کند می‌تواند با باتِ اعلانِ داخلی فرق کند و
    // آن‌وقت باید ادمینِ کانال باشد. بدونِ این دو خط، «پست نرفت» سه علتِ
    // کاملاً متفاوت داشت — توکنِ کانال نبود، بات ادمینِ کانال نبود، یا خودِ
    // ارسال شکست خورد — و از بیرون هیچ‌کدام قابلِ تفکیک نبودند.
    channelBotToken: Boolean(process.env.TELEGRAM_CHANNEL_BOT_TOKEN),
    // بدونِ PUBLIC_URL، تلگرام نمی‌تواند تصویرِ کارت را بگیرد و پست بی‌عکس می‌رود.
    publicUrl: Boolean(process.env.PUBLIC_URL),
  },
});
app.get('/api/health', (req, res) => res.json(healthSnapshot()));
app.use('/api', createMarketRoutes({ marketEngine }));
// پنل ادمین. tick و تعداد اتصال‌ها تزریق می‌شوند تا admin.js به موتور بازار
// وابسته نشود و بشود جدا تستش کرد.
app.use('/api/admin', createAdminRoutes({
  getTick: () => marketEngine.currentTick,
  getWsClientCount: () => [...wss.clients].filter((c) => c.readyState === 1).length,
}));
// 📣 مرکز بازاریابی هوشمند — احراز هویت داخلِ خودِ روتر. انتشار مستقیم با باتِ
// خودِ گلدمی انجام می‌شود؛ مسیرِ callbackِ n8n دیگر وجود ندارد.
app.use('/api/admin/marketing', createMarketingRoutes());
// تصویرِ کارتِ هر پست — عمومی، چون خودِ تلگرام آن را باز می‌کند (marketingCard.js).
app.use('/api/card', createMarketingCardRoutes());
// وب‌هوکِ تلگرام — هویتش با secret_token خودِ تلگرام تأیید می‌شود (telegramWebhook.js).
app.use('/api/internal/telegram', createTelegramWebhookRoutes({ getStatus: healthSnapshot }));
// اعلان فعال — عمداً بدون احراز هویت و فقط-خواندنی: نوار اطلاع‌رسانی باید حتی
// پیش از ورود هم دیده شود (مثلاً «امشب سرویس قطع است»).
app.get('/api/announcement', async (req, res) => {
  try {
    const announcement = await prisma.announcement.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, body: true, tone: true, createdAt: true },
    });
    res.json({ announcement: announcement ?? null });
  } catch {
    // اعلان یک قابلیت جانبی است؛ خطایش نباید صفحه‌ی کاربر را بشکند.
    res.json({ announcement: null });
  }
});
// ⚠️ عمداً پیش از `app.use('/api', profileQuizRoutes)` می‌آید: آن روتر روی
// «/api» بدون مسیر مشخص نصب شده و خودش هم `router.use(authMiddleware)` بدون
// مسیر دارد — یعنی هر درخواستی که به آن برسد، حتی مسیرهای این‌جا، اول با آن
// احرازِ هویت رد می‌شود و هرگز به مسیرهای بعدی (مثل همین‌جا) نمی‌رسد. مسیر
// عمومیِ محتوا باید زودتر از آن ثبت شود، وگرنه همیشه ۴۰۱ می‌گیرد.
// متنِ دیتابیس (بانک سؤال، سناریو، محتوای سایت) با ارقامِ لاتین به کاربر می‌رسد — services/latinDigits.js
app.use(['/api/content', '/api/education', '/api/arena', '/api/onboarding', '/api/user'], latinDigitsJson);
app.use('/api/content', contentRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', aiRoutes);
app.use('/api/user', userRoutes);
app.use('/api', profileQuizRoutes);
app.use('/api/education', educationRoutes);
app.use('/api/arena', arenaRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/onboarding', onboardingRoutes);

// ✅ بدون این، مسیرهای ناشناخته‌ی /api به catch-all پایین می‌رسیدند و
// به‌جای ۴۰۴ صفحه‌ی HTML برمی‌گرداندند (که در فرانت‌اند خطای parse می‌داد).
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'مسیر API یافت نشد.' }));

const distPath = path.join(process.cwd(), 'dist');

/**
 * ⚡ فایل‌های ساخته‌شده‌ی Vite هش در نامشان دارند (app-a1b2c3.js)، یعنی محتوای‌شان
 * هیچ‌وقت عوض نمی‌شود؛ نسخه‌ی جدید = نامِ جدید. پس مرورگر می‌تواند برای همیشه
 * نگهشان دارد و اصلاً دوباره درخواست نکند.
 *
 * بدون این، هر بازدید دوباره‌ی هر کاربر یک دور درخواستِ اضافه به همان پردازه‌ای
 * می‌زد که موتور بازار در آن می‌چرخد — کاری که اصلاً لازم نبود انجام شود.
 *
 * ⚠️ index.html استثناست و هرگز کش نمی‌شود: اگر کش شود، کاربر بعد از هر انتشار
 * روی نسخه‌ی قدیمی گیر می‌کند و فایل‌های هش‌دارِ جدید را هیچ‌وقت نمی‌بیند.
 */
/**
 * sitemap زنده — ⚠️ **باید پیش از express.static بیاید.**
 *
 * تا امروز `public/sitemap.xml` یک فایلِ ساخته‌شده در build بود و static آن را
 * سرو می‌کرد. حالا که آدرسِ درس‌ها از دیتابیس می‌آید، فایل بیات می‌شود؛ و اگر
 * این مسیر بعد از static ثبت شود، همان فایلِ بیات همیشه برنده است و این کد
 * هیچ‌وقت اجرا نمی‌شود — یک خرابیِ کاملاً بی‌صدا.
 */
app.get('/sitemap.xml', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(await renderSitemap());
  } catch (err) {
    Logger.error('sitemap failed', err);
    res.status(500).send('خطای سرور.');
  }
});

app.use(express.static(distPath, {
  maxAge: '1y',
  immutable: true,
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

/**
 * index.html یک بار خوانده و در حافظه نگه داشته می‌شود؛ برای هر درخواست فقط
 * متادیتای همان مسیر داخلش می‌نشیند (server/services/seo.js).
 */
let indexHtmlCache = null;
function readIndexHtml() {
  if (indexHtmlCache == null) {
    indexHtmlCache = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
  }
  return indexHtmlCache;
}

/**
 * صفحه‌ی عمومیِ قیمت طلا — سرور-رندرِ کامل، *پیش* از catch-all.
 *
 * ⚠️ عمداً از SPA رد نمی‌شود: خزنده باید عدد را در همان HTMLِ اول ببیند، و
 * صفحه‌ی فرودِ SPA کلِ باندل را می‌کشد که برای صفحه‌ای که قرار است از گوگل
 * ترافیک بگیرد فاجعه‌ی Core Web Vitals است.
 */
app.get(GOLD_PRICE_PATH, async (req, res) => {
  try {
    // کشِ کوتاه: قیمت مدام عوض می‌شود، ولی چند ثانیه کش جلوی رندرِ تکراری در
    // هجومِ همزمان را می‌گیرد.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.type('html').send(await renderGoldPricePage());
  } catch (err) {
    Logger.error('gold price page failed', err);
    res.status(500).send('خطای سرور.');
  }
});

/**
 * صفحه‌های آموزشیِ عمومی — سرور-رندر، مثلِ صفحه‌ی قیمت.
 *
 * ⚠️ کشِ بلندتر از قیمت: این متن‌ها با کد نسخه می‌خورند و بینِ دو دیپلوی عوض
 * نمی‌شوند.
 */
app.get(LEARN_PATH, (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderLearnIndex());
});

app.get(`${LEARN_PATH}/:slug`, (req, res) => {
  const html = renderArticle(req.params.slug);
  // ⚠️ مقاله‌ی ناموجود باید ۴۰۴ بگیرد، نه اینکه به SPA بیفتد و صفحه‌ی فرود را
  // نشان بدهد — همان soft-404 که کلِ این کار برای رفعش شروع شد.
  if (!html) return res.status(404).type('html').send(renderLearnIndex());

  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.type('html').send(html);
});

/**
 * صفحه‌های عمومیِ دوره و درس — گام ۵ سئو.
 *
 * ⚠️ فقط پیش‌نمایش است: عنوان، خلاصه و اهدافِ یادگیری. متنِ درس، آزمون و
 * تمرین پشتِ ورود می‌مانند. استدلالش در services/seo/coursePages.js.
 */
app.get(COURSE_PATH, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.type('html').send(await renderCourseIndex());
  } catch (err) {
    Logger.error('course index failed', err);
    res.status(500).send('خطای سرور.');
  }
});

app.get(`${COURSE_PATH}/:course`, async (req, res) => {
  try {
    const html = await renderCourse(req.params.course);
    // دوره‌ی ناموجود ۴۰۴ می‌گیرد، نه اینکه به SPA بیفتد و صفحه‌ی فرود را نشان
    // بدهد — همان soft-404 که کلِ این کار برای رفعش شروع شد.
    if (!html) return res.status(404).type('html').send(await renderCourseIndex());

    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.type('html').send(html);
  } catch (err) {
    Logger.error('course page failed', err);
    return res.status(500).send('خطای سرور.');
  }
});

app.get(`${COURSE_PATH}/:course/:skill`, async (req, res) => {
  try {
    const html = await renderLesson(req.params.course, req.params.skill);
    if (!html) return res.status(404).type('html').send(await renderCourseIndex());

    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.type('html').send(html);
  } catch (err) {
    Logger.error('lesson page failed', err);
    return res.status(500).send('خطای سرور.');
  }
});

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');

  const known = pageFor(req.path);
  let html;
  try {
    html = applySeo(readIndexHtml(), req.path);
  } catch (err) {
    // اگر خواندنِ فایل شکست خورد، سایت نباید بالا نیاید.
    Logger.error('serving index.html failed', err);
    return res.status(500).send('خطای سرور.');
  }

  // ⚠️ آدرسِ ناشناخته باید ۴۰۴ بگیرد، نه ۲۰۰. تا امروز هر آدرسی ۲۰۰ می‌گرفت و
  // گوگل صفحه‌ای «موجود» می‌دید که محتوایش تکراری بود (soft-404). خودِ برنامه
  // همچنان رندر می‌شود و کاربر صفحه‌ی سالم می‌بیند — فقط کدِ وضعیت راست می‌گوید.
  res.status(known ? 200 : 404).send(html);
});

app.use(errorHandler);

server.listen(PORT, '0.0.0.0', () => {
  Logger.info(`🚀 Goldemy Enterprise Backend running on port ${PORT}`);
  startRuntimeHealth();

  // ⚠️ تا وقتی نمایه پر نشده، حلقه‌ی تیک هیچ پوزیشنی نمی‌بیند. اولین بازسازی
  // باید همین‌جا و زودتر از هر چیز انجام شود، وگرنه در فاصله‌ی بین بالا آمدن
  // سرور و اولین بازسازیِ دوره‌ای، حد ضررِ کاربران پایش نمی‌شود.
  openPositions.resync(prisma)
    .then((count) => Logger.info(`📌 ${count} پوزیشن باز در نمایه بارگذاری شد.`))
    .catch((err) => Logger.error('بارگذاری اولیه‌ی نمایه‌ی پوزیشن‌ها ناموفق بود', err));

  // پس از رسیدن اولین قیمت واقعی، بایگانی بلندمدت در پس‌زمینه و فقط در صورت
  // خالی‌بودن ساخته می‌شود. بالا آمدن سایت منتظر منبع بیرونی نمی‌ماند.
  let historyAttempts = 0;
  const historyBootstrap = setInterval(async () => {
    historyAttempts += 1;
    if (!PriceService.isReal()) {
      if (historyAttempts >= 20) clearInterval(historyBootstrap);
      return;
    }
    clearInterval(historyBootstrap);
    try {
      const result = await ensureMarketHistory(prisma, {
        currentPrice: marketEngine.currentTick.price,
        days: 365,
      });
      if (!result.skipped) {
        const saved = result.results?.reduce((sum, item) => sum + item.saved, 0) || 0;
        Logger.info(`📚 تاریخچهٔ بلندمدت ترمینال آماده شد: ${saved} کندل.`);
      }
    } catch (err) {
      Logger.warn('ساخت خودکار تاریخچهٔ بلندمدت ناموفق بود', err?.message);
    }
  }, 15_000);
  historyBootstrap.unref?.();

  // ⚠️ کاشت درس‌های پایه بعد از بالا آمدن سرور انجام می‌شود و شکستش هم فقط
  // هشدار است. یک درسِ نکاشته نباید مانع بالا آمدن کل سایت شود.
  seedEducation(prisma, Logger)
    .then(() => seedCurriculum(prisma, Logger))
    .then(() => backfillEducationProgress(prisma, Logger))
    .catch((err) => {
      // پیام Prisma با خط خالی شروع می‌شود؛ بدون trim، لاگ فقط یک سطر خالی است.
      Logger.warn(`⚠️ کاشت درس‌های پایه انجام نشد: ${String(err?.message || err).trim().split('\n')[0]}`);
    });

  // موضوع‌های آماده‌ی مارکتینگ — فقط آن‌هایی که هنوز در جدول نیستند. موضوعی
  // که ادمین خاموش کرده دوباره روشن نمی‌شود (مقایسه با عنوان است، نه با
  // isActive).
  seedTopicsIfEmpty()
    .catch((err) => Logger.warn('کاشتِ موضوع‌های مارکتینگ انجام نشد', err?.message));
});

// ══════════════════════════════════════════════
// 🛡️ Graceful Shutdown
// ══════════════════════════════════════════════
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  Logger.warn(`🛑 سیگنال ${signal} دریافت شد. در حال آماده‌سازی برای خاموشی...`);

  clearInterval(marketInterval);
  clearInterval(goldInterval);
  clearInterval(usdInterval);
  if (usdBootstrapTimer) clearTimeout(usdBootstrapTimer);
  clearInterval(heartbeatInterval);
  clearInterval(marketingSchedulerInterval);
  clearInterval(marketingPlannerInterval);
  clearInterval(pricePointInterval);
  clearInterval(pricePruneInterval);

  const forceExit = setTimeout(() => {
    Logger.error('⚠️ هشدار: فرآیند توقف طولانی شد. توقف اجباری سیستم!');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    Logger.info('✅ سرور HTTP متوقف شد.');
    try {
      await prisma.$disconnect();
      Logger.info('✅ ارتباط با دیتابیس (Prisma) در امنیت کامل قطع شد.');
    } catch (error) {
      Logger.error('❌ خطا در هنگام قطع ارتباط با دیتابیس:', error);
    }
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  Logger.error('💥 خطای پیش‌بینی نشده (Uncaught Exception):', error);
  // best-effort: سرور دارد خاموش می‌شود، منتظرِ تمام‌شدنِ ارسال نمی‌مانیم.
  reportSystemFailure(error, { severity: SEVERITY.CRITICAL, feature: 'uncaught-exception' });
  gracefulShutdown('uncaughtException');
});

// ⚠️ یک promise رد شده نباید کل سرور را خاموش کند (رفتار قبلی، باعث قطعی سرویس می‌شد).
process.on('unhandledRejection', (reason) => {
  Logger.error('💥 پرامیسِ هندل‌نشده (Unhandled Rejection)', reason);
  const err = reason instanceof Error ? reason : new Error(String(reason));
  reportSystemFailure(err, { severity: SEVERITY.CRITICAL, feature: 'unhandled-rejection' });
});
