import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { MemoryEngine } from '../services/MemoryEngine.js';
import { scoreTrade } from '../services/accuracy.js';
import { reportableWeek, buildWeeklyReport } from '../services/weeklyReport.js';
import { computePortfolio, INITIAL_RIAL_BALANCE } from '../services/portfolio.js';
import { detectPatterns } from '../services/patterns.js';
import { evaluateCommitment, KNOWN_COMMITMENTS } from '../services/commitments.js';
import { buildDnaProfile, monthKey, monthRange, previousMonth } from '../services/dnaProfile.js';
import { dayKey, dayRange, validatePlan, liveStatus, reviewDay, keptStreak, breachesFor, bucketByDay, EMPTY_DAY, BIASES } from '../services/dailyPlan.js';

/** آستانه‌ی «معامله‌ی دقیق» — همان مرز درجه‌ی «عالی» در accuracy.js. */
const ACCURATE_THRESHOLD = 85;
import { buildDnaInsights } from '../services/dnaInsights.js';
import { buildProgress } from '../services/levels.js';
import { validateBatch, toClient, MAX_PER_USER } from '../services/drawingStore.js';
import { isValidAvatar, isAvatarUnlocked, avatarsForLevel, DEFAULT_AVATAR } from '../services/avatars.js';
import { TOUR_IDS, TOUR_STATUSES, EVENT_TYPES, readTourState, stateUpdateData, logTourEvent } from '../services/hugoTour.js';
import prisma from '../config/db.js';

const router = Router();

const MAX_PAGE_SIZE = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(authMiddleware);

/**
 * آمار خامی که سطح از رویش حساب می‌شود.
 *
 * ⚠️ از دیتابیس خوانده می‌شود نه از بدنه‌ی درخواست: سطح، سهمیه‌ی تحلیل و آواتارهای
 * باز‌شده را تعیین می‌کند، پس اگر کلاینت بتواند عددش را بگوید، همه‌شان بی‌معنا می‌شوند.
 */
export async function levelStatsFor(userId) {
  const [closedTrades, profileAnswers, dna] = await Promise.all([
    prisma.trade.findMany({ where: { userId, status: 'closed' } }),
    prisma.profileAnswer.count({ where: { userId } }),
    prisma.userTradingDNA.findUnique({ where: { userId }, select: { daysActive: true } }),
  ]);

  const withStop = closedTrades.filter((t) => t.stopLoss != null || t.takeProfit != null).length;
  // «دقیق» یعنی امتیاز دقت ۸۵ به بالا — که سود در آن هیچ نقشی ندارد.
  const accurate = closedTrades.filter((t) => scoreTrade(t).score >= ACCURATE_THRESHOLD).length;

  return {
    trades: closedTrades.length,
    tradesWithStop: withStop,
    tradesAccurate: accurate,
    profileAnswers,
    activeDays: dna?.daysActive ?? 1,
  };
}

router.get('/profile', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { tradingDNA: true },
    });
    if (!user) return res.status(404).json({ error: 'کاربر یافت نشد.' });

    const progress = buildProgress(await levelStatsFor(user.id));

    res.json({
      id: user.id, phone: user.phone, email: user.email, displayName: user.displayName,
      avatarId: user.avatarId || DEFAULT_AVATAR,
      // صفحه‌ی پروفایل «عضو از» و شماره‌ی روزهای همراهی را از این می‌سازد.
      createdAt: user.createdAt, tradingDNA: user.tradingDNA,
      progress,
      avatars: avatarsForLevel(progress.level),
      // صفحه‌ی قیمت‌گذاری از همین دو فیلد «پلن فعلی» را نشان می‌دهد — بدون
      // درخواست جدا. role اینجا نمی‌آید چون این پاسخ همان‌جایی است که فرانت‌اند
      // برای هر کاربر (نه فقط ادمین) صدا می‌زند.
      plan: user.plan, planExpiresAt: user.planExpiresAt,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/profile', async (req, res, next) => {
  try {
    const { displayName, email, avatarId } = req.body;
    const data = {};

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.length > 60) {
        return res.status(400).json({ error: 'نام نمایشی باید بین 1 تا 60 کاراکتر باشد.' });
      }
      data.displayName = displayName.trim();
    }

    if (email !== undefined) {
      if (typeof email !== 'string' || !EMAIL_PATTERN.test(email) || email.length > 200) {
        return res.status(400).json({ error: 'ایمیل نامعتبر است.' });
      }
      data.email = email.trim();
    }

    if (avatarId !== undefined) {
      if (!isValidAvatar(avatarId)) {
        return res.status(400).json({ error: 'آواتار انتخاب‌شده معتبر نیست.' });
      }
      // 🛡️ قفلِ سطح سمت سرور بررسی می‌شود. بدون این، یک درخواست دستی می‌توانست
      // آواتارِ سطح هشت را بردارد و پاداشِ سطح را بی‌اثر کند.
      const { level } = buildProgress(await levelStatsFor(req.user.userId));
      if (!isAvatarUnlocked(avatarId, level)) {
        return res.status(403).json({ error: 'این آواتار هنوز برای سطحت باز نشده.' });
      }
      data.avatarId = avatarId;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'داده‌ای برای به‌روزرسانی ارسال نشده است.' });
    }

    const user = await prisma.user.update({
      where: { id: req.user.userId }, data,
      select: { id: true, phone: true, email: true, displayName: true, avatarId: true },
    });
    res.json({ message: 'پروفایل آپدیت شد.', user });
  } catch (err) {
    next(err);
  }
});

router.get('/trades', async (req, res, next) => {
  try {
    const { status } = req.query;
    // بدون کران، parseInt روی ورودی نامعتبر NaN می‌داد و مقدار بزرگ کوئری سنگین می‌ساخت
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_PAGE_SIZE);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const where = { userId: req.user.userId };
    if (status === 'open' || status === 'closed') where.status = status;

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      prisma.trade.count({ where }),
    ]);
    res.json({ trades, total });
  } catch (err) {
    next(err);
  }
});


// ══════════════════════════════════════════════════════════════════════════
// 🛑 مسیر POST /trades حذف شد.
//
// این مسیر به کاربر اجازه می‌داد یک معامله با status و pnl دلخواه ثبت کند.
// چون موجودی ریالی از «۲۵۰ میلیون + مجموع pnl معاملات بسته‌شده» محاسبه می‌شود،
// یک درخواست ساده کافی بود تا کاربر موجودی خودش را از هیچ بسازد — بدون عبور از
// هیچ‌کدام از محافظت‌های موتور معاملاتی (تراکنش، قفل ردیف، بررسی موجودی).
//
// ثبت معامله فقط و فقط از طریق پیام PLACE_ORDER روی WebSocket انجام می‌شود که
// قیمت را از اوراکل سرور می‌گیرد و موجودی را داخل تراکنش قفل‌شده اعتبارسنجی می‌کند.
// فرانت‌اند هرگز از این مسیر استفاده نمی‌کرد.
// ══════════════════════════════════════════════════════════════════════════

router.get('/dna', async (req, res, next) => {
  try {
    const dna = await MemoryEngine.getUserDNA(req.user.userId);
    // تفسیر کنار خود اعداد می‌آید تا فرانت‌اند مجبور نباشد آستانه‌ها را دوباره تعریف کند
    // (و با تغییر فرمول‌ها، هر دو جا از هم جدا نیفتند).
    const insights = buildDnaInsights({
      totalTrades: dna.totalTrades,
      greedLevel: dna.psychology.greedLevel,
      fearLevel: dna.psychology.fearLevel,
      disciplineScore: dna.psychology.disciplineScore,
      avgRiskReward: dna.avgRiskReward,
      fomoTrades: dna.fomoTrades,
      revengeTrades: dna.revengeTrades,
    });
    res.json({ ...dna, insights });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════
// رسم‌های چارت
// ══════════════════════════════════════════════
//
// 🐛 اول فقط در localStorage بودند و کاربر گزارش داد با خروج و ورود دوباره
// می‌پرند. حالا به حساب کاربر بسته‌اند، پس بین نشست‌ها و بین دستگاه‌ها می‌مانند.
//
// ⚠️ همه‌ی داده اینجا از مرورگر می‌آید و پیش از ذخیره اعتبارسنجی می‌شود
// (server/services/drawingStore.js).

router.get('/drawings', async (req, res, next) => {
  try {
    const rows = await prisma.chartDrawing.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_USER,
    });
    res.json({ drawings: rows.map(toClient) });
  } catch (err) { next(err); }
});

/**
 * جایگزینیِ کاملِ رسم‌های کاربر.
 *
 * چرا کل فهرست و نه تک‌تک: کاربر ممکن است چند رسم را پشت سر هم اضافه، جابه‌جا و
 * حذف کند. با یک درخواستِ «این است وضعیت نهایی»، هیچ حالتی نمی‌ماند که سرور و
 * مرورگر با هم اختلاف داشته باشند — و چون تعدادشان کم است، هزینه‌اش ناچیز است.
 */
router.put('/drawings', async (req, res, next) => {
  try {
    const result = validateBatch(req.body?.drawings);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const userId = req.user.userId;
    await prisma.$transaction([
      prisma.chartDrawing.deleteMany({ where: { userId } }),
      ...(result.drawings.length > 0
        ? [prisma.chartDrawing.createMany({
            data: result.drawings.map((d) => ({ ...d, userId })),
          })]
        : []),
    ]);

    res.json({ ok: true, count: result.drawings.length });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════
// تورهای راهنمای هوگو — وضعیتِ resume به حساب بسته است (src/hugo/services/hugoTour.js
// توضیح می‌دهد چرا)، رویدادها فقط برای تحلیل افزوده می‌شوند.
// ══════════════════════════════════════════════

router.get('/hugo-tour-state', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { hugoTourState: true, hugoQuickTourStatus: true, hugoAdvTourStatus: true },
    });
    res.json({ state: readTourState(user) });
  } catch (err) { next(err); }
});

router.put('/hugo-tour-state', async (req, res, next) => {
  try {
    const { tourId, status, stepId } = req.body || {};
    if (!TOUR_IDS.includes(tourId)) return res.status(400).json({ error: 'شناسه‌ی تور نامعتبر است.' });
    if (!TOUR_STATUSES.includes(status)) return res.status(400).json({ error: 'وضعیتِ تور نامعتبر است.' });
    if (stepId != null && typeof stepId !== 'string') return res.status(400).json({ error: 'شناسه‌ی قدم نامعتبر است.' });

    // ⚠️ خواندن پیش از نوشتن لازم است چون همه‌ی تورها در یک ستونِ JSON اند:
    // بدونِ آن، نوشتنِ وضعیتِ یک بخش وضعیتِ بقیه را پاک می‌کند.
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { hugoTourState: true, hugoQuickTourStatus: true, hugoAdvTourStatus: true },
    });
    await prisma.user.update({
      where: { id: req.user.userId },
      data: stateUpdateData(user, tourId, status, stepId),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** فقط ثبت — نباید هیچ‌وقت تور را بشکند، برای همین کلاینت هم نتیجه‌اش را منتظر نمی‌ماند. */
router.post('/hugo-tour-event', async (req, res, next) => {
  try {
    const { tourId, eventType, stepId, stepIndex, totalSteps } = req.body || {};
    if (!TOUR_IDS.includes(tourId)) return res.status(400).json({ error: 'شناسه‌ی تور نامعتبر است.' });
    if (!EVENT_TYPES.includes(eventType)) return res.status(400).json({ error: 'نوعِ رویداد نامعتبر است.' });

    await logTourEvent(req.user.userId, { tourId, eventType, stepId, stepIndex, totalSteps });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

// ══════════════════════════════════════════════
// گزارش هفتگی
//
// گزارش ذخیره نمی‌شود؛ هر بار از روی معاملات واقعی همان بازه ساخته می‌شود.
// تنها چیزی که ذخیره می‌شود این است که کاربر کدام هفته را دیده — تا نشانِ
// «گزارش تازه» بتواند خودش را نشان بدهد بدون اینکه گزارشِ بیات نگه داریم.
// ══════════════════════════════════════════════

router.get('/weekly-report', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const week = reportableWeek();
    const previousStart = new Date(week.start.getTime() - 7 * 86_400_000);

    const [trades, previousTrades, user] = await Promise.all([
      prisma.trade.findMany({
        where: { userId, status: 'closed', closedAt: { gte: week.start, lt: week.end } },
      }),
      prisma.trade.findMany({
        where: { userId, status: 'closed', closedAt: { gte: previousStart, lt: week.start } },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { lastReportSeen: true } }),
    ]);

    const report = buildWeeklyReport({ weekKey: week.key, start: week.start, end: week.end, trades, previousTrades });
    res.json({ report, isNew: user?.lastReportSeen !== week.key });
  } catch (err) {
    next(err);
  }
});

router.post('/weekly-report/seen', async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { lastReportSeen: reportableWeek().key },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════
// پیمان روزانه و گزارش پایان روز
//
// حلقه‌ی دوسر: صبح کاربر پیمان می‌بندد، شب سایت پیمان را با واقعیت مقایسه
// می‌کند. قضاوت با معیارِ خودِ کاربر انجام می‌شود، نه معیار ما.
// ══════════════════════════════════════════════

/** معاملات باز‌شده و بسته‌شده‌ی یک روزِ تهران. */
async function tradesOfDay(userId, key) {
  const { start, end } = dayRange(key);
  const [openedToday, closedToday] = await Promise.all([
    prisma.trade.findMany({ where: { userId, createdAt: { gte: start, lt: end } } }),
    prisma.trade.findMany({ where: { userId, status: 'closed', closedAt: { gte: start, lt: end } } }),
  ]);
  return { openedToday, closedToday };
}

/**
 * بازبینیِ چند روز — با دو کوئری، نه دو کوئری برای هر روز.
 *
 * ⚠️ نسخه‌ی قبلی برای هر پیمان `tradesOfDay` را صدا می‌زد؛ یعنی ۲×N کوئریِ
 * پشت‌سرهم در یک درخواست. در تست ۵۰۰ کاربره همین الگو در `/dna-profile` که شش
 * ماه را می‌سازد به صدها رفت‌وبرگشت می‌رسید و استخر اتصال را برای *بقیه‌ی* سایت
 * هم می‌بلعید. حالا کل بازه یک بار خوانده و در حافظه به روز تقسیم می‌شود.
 */
async function reviewsForPlans(userId, plans) {
  if (!plans.length) return [];
  const ranges = plans.map((p) => dayRange(p.date));
  const start = new Date(Math.min(...ranges.map((r) => r.start.getTime())));
  const end = new Date(Math.max(...ranges.map((r) => r.end.getTime())));
  const [opened, closed] = await Promise.all([
    prisma.trade.findMany({ where: { userId, createdAt: { gte: start, lt: end } } }),
    prisma.trade.findMany({ where: { userId, status: 'closed', closedAt: { gte: start, lt: end } } }),
  ]);
  const byDay = bucketByDay(opened, closed);
  return plans.map((p) => reviewDay({ plan: p, ...(byDay.get(p.date) ?? EMPTY_DAY) }));
}

router.get('/daily-plan', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const today = dayKey();

    const [plan, day] = await Promise.all([
      prisma.dailyPlan.findUnique({ where: { userId_date: { userId, date: today } } }),
      tradesOfDay(userId, today),
    ]);

    if (!plan) {
      return res.json({ plan: null, status: null, breaches: null, review: null, streak: 0, today, biases: BIASES });
    }

    // آخرین پیمان‌ها برای شمردن زنجیره. ۶۰ روز کافی است و مرزی برای رشد دارد.
    const recent = await prisma.dailyPlan.findMany({
      where: { userId }, orderBy: { date: 'desc' }, take: 60,
    });
    const reviews = await reviewsForPlans(userId, recent);

    const status = liveStatus(plan, day);
    res.json({
      plan,
      status,
      // دلایل نقض از قبل و برای هر دو جهت حساب می‌شوند تا کلاینت مجبور نباشد
      // منطق پیمان را دوباره پیاده کند — دو پیاده‌سازی یعنی دو رفتار متفاوت.
      breaches: { BUY: breachesFor(plan, status, 'BUY'), SELL: breachesFor(plan, status, 'SELL') },
      review: reviewDay({ plan, ...day }),
      streak: keptStreak(reviews, today),
      today,
      biases: BIASES,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/daily-plan', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const today = dayKey();

    // موجودی از دیتابیس خوانده می‌شود، نه از بدنه‌ی درخواست — سقف زیان باید
    // در برابر پول واقعی کاربر سنجیده شود نه عددی که خودش فرستاده.
    const { rialBalance } = await computePortfolio(prisma, userId, 0);

    const validation = validatePlan(req.body || {}, { rialBalance });
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const plan = await prisma.dailyPlan.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, ...validation.plan },
      update: validation.plan,
    });

    const day = await tradesOfDay(userId, today);
    res.json({ plan, status: liveStatus(plan, day), today });
  } catch (err) {
    next(err);
  }
});

/**
 * حافظه‌ی معاملاتی — الگوهای واقعی کاربر با عدد.
 *
 * همان چیزی که به پرامپت مربی داده می‌شود، اینجا مستقیم هم نشان داده می‌شود:
 * محاسبه‌اش قطعی و رایگان است، پس دلیلی ندارد پشت سهمیه‌ی تحلیل قفل بماند.
 */
router.get('/patterns', async (req, res, next) => {
  try {
    const trades = await prisma.trade.findMany({
      where: { userId: req.user.userId, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      take: 100,
    });
    res.json(detectPatterns(trades));
  } catch (err) {
    next(err);
  }
});

/**
 * پروفایل پویای DNA — ماه جاری، با مقایسه‌ی ماه قبل و روند شش ماه.
 *
 * گزارش ذخیره نمی‌شود؛ هر بار از روی معاملات واقعی همان ماه ساخته می‌شود، پس
 * هیچ‌وقت با داده ناسازگار نمی‌شود.
 */
router.get('/dna-profile', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const current = monthKey();

    // شش ماهِ آخر، از قدیم به جدید.
    const keys = [];
    let cursor = current;
    for (let n = 0; n < 6; n++) { keys.unshift(cursor); cursor = previousMonth(cursor); }
    const prevKey = previousMonth(current);

    // ⚠️ قبلاً هر ماه کوئری‌های خودش را داشت و برای هر پیمانِ هر ماه هم دو
    // کوئریِ دیگر — یعنی صدها رفت‌وبرگشت در یک درخواست. حالا کلِ شش ماه در سه
    // کوئری خوانده می‌شود و تقسیمِ ماه و روز در حافظه انجام می‌گیرد.
    const span = { start: monthRange(keys[0]).start, end: monthRange(current).end };
    const [closedTrades, openedTrades, plans] = await Promise.all([
      prisma.trade.findMany({ where: { userId, status: 'closed', closedAt: { gte: span.start, lt: span.end } } }),
      prisma.trade.findMany({ where: { userId, createdAt: { gte: span.start, lt: span.end } } }),
      prisma.dailyPlan.findMany({ where: { userId, date: { gte: keys[0] + '-01', lte: current + '-31' } } }),
    ]);

    const byDay = bucketByDay(openedTrades, closedTrades);
    const monthOf = (key) => {
      const trades = closedTrades.filter((t) => monthKey(t.closedAt) === key);
      const reviews = plans
        .filter((pl) => pl.date.slice(0, 7) === key)
        .map((pl) => reviewDay({ plan: pl, ...(byDay.get(pl.date) ?? EMPTY_DAY) }));
      return { trades, reviews };
    };

    const data = new Map(keys.map((key) => [key, monthOf(key)]));
    const now = data.get(current);
    const prev = data.get(prevKey) ?? { trades: [], reviews: [] };

    const previousProfile = buildDnaProfile({ ...prev, initialBalance: INITIAL_RIAL_BALANCE, period: prevKey });
    const profile = buildDnaProfile({ ...now, initialBalance: INITIAL_RIAL_BALANCE, period: current, previous: previousProfile });

    // روند شش ماه — فقط نمره‌ها، برای نمودار تکامل.
    const history = keys.map((key) => {
      const pr = buildDnaProfile({ ...data.get(key), initialBalance: INITIAL_RIAL_BALANCE, period: key });
      return { period: key, ready: pr.ready, scores: pr.ready ? pr.scores : null, trades: pr.trades };
    });

    res.json({ profile, history });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════
// تعهد و پیگیری
//
// وقتی کاربر یک قانون را می‌پذیرد، اینجا ثبت می‌شود و از آن لحظه به بعد
// رفتارش نسبت به آن سنجیده می‌شود. مربی در هر گفتگو اول همین را پیگیری می‌کند.
// ══════════════════════════════════════════════

router.get('/commitment', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const active = await prisma.commitment.findFirst({
      where: { userId, resolvedAt: null }, orderBy: { createdAt: 'desc' },
    });
    if (!active) return res.json({ commitment: null, evaluation: null });

    const [trades, plans] = await Promise.all([
      prisma.trade.findMany({ where: { userId, status: 'closed' } }),
      prisma.dailyPlan.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 30 }),
    ]);
    const reviews = await reviewsForPlans(userId, plans);

    res.json({ commitment: active, evaluation: evaluateCommitment(active, trades, reviews) });
  } catch (err) {
    next(err);
  }
});

router.post('/commitment', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { patternId } = req.body || {};
    if (!KNOWN_COMMITMENTS.includes(patternId)) {
      return res.status(400).json({ error: 'این تعهد شناخته‌شده نیست.' });
    }

    // ⚠️ متن قانون از کلاینت پذیرفته نمی‌شود. اگر بشود هر متنی فرستاد، کاربر
    // می‌تواند تعهدی بسازد که هیچ‌وقت شکسته نشود — و سنجش بی‌معنا می‌شود.
    const trades = await prisma.trade.findMany({
      where: { userId, status: 'closed' }, orderBy: { closedAt: 'desc' }, take: 100,
    });
    const found = detectPatterns(trades).patterns.find((p) => p.id === patternId);
    if (!found) return res.status(400).json({ error: 'این الگو در تاریخچه‌ی تو دیده نمی‌شود.' });

    // تعهد قبلی بسته می‌شود؛ هر بار فقط یک تعهد فعال است چون تمرکز روی یک
    // عادت، شرط تغییر کردنش است.
    const previous = await prisma.commitment.findFirst({ where: { userId, resolvedAt: null }, orderBy: { createdAt: 'desc' } });
    if (previous) {
      const evaluation = evaluateCommitment(previous, trades, []);
      await prisma.commitment.update({
        where: { id: previous.id },
        data: { resolvedAt: new Date(), outcome: evaluation?.status ?? 'pending' },
      });
    }

    const commitment = await prisma.commitment.create({
      data: {
        userId, patternId, rule: found.rule,
        meta: patternId === 'worst-hour' ? { hour: extractHour(found.detail) } : undefined,
      },
    });
    res.json({ commitment });
  } catch (err) {
    next(err);
  }
});

/** ساعت را از متن الگوی «ساعت پرخطر» بیرون می‌کشد تا سنجه بداند چه چیزی را بشمارد. */
function extractHour(detail) {
  const m = String(detail).match(/ساعت (\d{1,2})/);
  return m ? Number(m[1]) : null;
}
