/**
 * Goldemy — Portfolio & Order Rules
 *
 * تمام محاسبات مالی اینجا متمرکز شده‌اند تا یک نقطه‌ی حقیقت داشته باشند و قابل تست باشند.
 *
 * ⚠️ قانون بنیادی: هیچ عدد مالی‌ای از کلاینت پذیرفته نمی‌شود.
 *    قیمت اجرا همیشه از اوراکل سرور می‌آید. تنها چیزی که کاربر تعیین می‌کند
 *    نوع سفارش، حجم، و (اختیاری) سقف/کف قیمت قابل قبول است.
 */

/** موجودی اولیه‌ی هر حساب مجازی (تومان). */
export const INITIAL_RIAL_BALANCE = 25_000_000;

/** هر مثقال برابر ۴٫۶۰۸۳ گرم است. */
export const GRAMS_PER_MESGHAL = 4.6083;

/**
 * واحد حجم: گرم.
 *
 * پیش‌تر واحد «مثقال» بود و قیمتِ محاسبات هم «مظنه» (بهای هر مثقال). نتیجه‌اش
 * این بود که کوچک‌ترین معامله‌ی ممکن ده‌ها میلیون تومان می‌شد — عددی که برای
 * تمرین کردن غیرواقعی است و کاربر تازه‌کار را می‌ترساند.
 *
 * حالا واحد گرم است و قیمتِ همه‌ی محاسبات «بهای هر گرم» = مظنه ÷ ۴٫۶۰۸۳.
 * مظنه سر جایش می‌ماند ولی فقط به‌عنوان قیمت مرجعِ بازار نمایش داده می‌شود،
 * چون زبان رایج بازار طلای ایران همان است.
 */
export const UNIT_LABEL = 'گرم';

/** ریزترین معامله: یک دهمِ گرم. */
export const MIN_ORDER_AMOUNT = 0.1;
export const MAX_ORDER_AMOUNT = 5_000;

// ══════════════════════════════════════════════
// معاملات تعهدی (اهرمی)
// ══════════════════════════════════════════════

/**
 * دو حالت معامله وجود دارد و هر دو واقعی‌اند:
 *
 * ۱. نقدی (leverage = ۱): کاربر پول می‌دهد و طلا می‌گیرد. ضرر حداکثر همان
 *    چیزی است که گذاشته.
 *
 * ۲. تعهدی (leverage = ۵): طلایی جابه‌جا نمی‌شود. کاربر «وجه تضمین» می‌گذارد و
 *    فقط تفاوت قیمت تسویه می‌شود — همان کاری که پلتفرم‌های تعهدی طلا در ایران
 *    می‌کنند. با یک‌پنجم پول، همان اندازه پوزیشن؛ یعنی سود و ضرر هر دو پنج برابر.
 *
 * اهرم عمداً روی ۵ ثابت است. گلدمی آموزشی است و انتخاب‌های ۵۰ و ۱۰۰ برابری تنها
 * کاری که می‌کنند این است که حساب کاربر تازه‌کار را در چند دقیقه صفر کنند.
 */
export const LEVERAGE_OPTIONS = [1, 5];
export const MAX_LEVERAGE = 5;

/**
 * وقتی زیانِ یک پوزیشن به این نسبت از وجه تضمین برسد، پوزیشن به‌اجبار بسته
 * می‌شود (کال مارجین). ۹۰٪ و نه ۱۰۰٪، تا چیزی از وجه تضمین برگردد و کاربر
 * تفاوت «ضرر» و «صفر شدن» را با پوستش حس کند، نه فقط در متن آموزشی.
 */
export const MAINTENANCE_RATIO = 0.9;

/** وجه تضمینِ یک پوزیشن. برای پوزیشن نقدی صفر است. */
export function marginFor(trade) {
  const leverage = normalizeLeverage(trade.leverage);
  if (leverage <= 1) return 0;
  // مقدارِ ثبت‌شده در لحظه‌ی باز کردن، مرجع است؛ محاسبه فقط برای داده‌ی قدیمی.
  if (trade.margin !== null && trade.margin !== undefined) return trade.margin;
  const quantity = trade.goldAmount ?? trade.amount ?? 0;
  return Math.round((quantity * trade.entryPrice) / leverage);
}

/** اهرم ورودی را به یکی از گزینه‌های مجاز می‌برد؛ هرچیز نامعتبر یعنی نقدی. */
export function normalizeLeverage(raw) {
  const value = Math.round(Number(raw));
  return LEVERAGE_OPTIONS.includes(value) ? value : 1;
}

/**
 * قیمتی که در آن پوزیشن به‌اجبار بسته می‌شود.
 *
 *   زیان = (قیمت انحلال − ورود) × حجم = −MAINTENANCE_RATIO × وجه تضمین
 *   و چون وجه تضمین = حجم × ورود ÷ اهرم، حجم از دو طرف حذف می‌شود:
 *
 *   قیمت انحلال = ورود × (۱ ∓ MAINTENANCE_RATIO ÷ اهرم)
 *
 * یعنی به حجم بستگی ندارد، فقط به اهرم — با اهرم ۵، حدود ۱۸٪ حرکت خلافِ جهت.
 * برای پوزیشن نقدی null برمی‌گردد، چون انحلالی در کار نیست.
 */
export function liquidationPrice({ type, entryPrice, leverage }) {
  const lev = normalizeLeverage(leverage);
  if (lev <= 1) return null;
  const move = MAINTENANCE_RATIO / lev;
  return Math.round(type === 'BUY' ? entryPrice * (1 - move) : entryPrice * (1 + move));
}

/** آیا این پوزیشن به کال مارجین رسیده؟ */
export function checkLiquidation(trade, currentPrice) {
  const margin = marginFor(trade);
  if (margin <= 0) return false;
  return unrealizedPnl(trade, currentPrice) <= -margin * MAINTENANCE_RATIO;
}

/** بهای هر گرم از روی مظنه. تنها جایی که این تبدیل انجام می‌شود همین‌جاست. */
export function gramPriceFromMazne(maznePrice) {
  const mazne = Number(maznePrice);
  if (!Number.isFinite(mazne) || mazne <= 0) return 0;
  return Math.round(mazne / GRAMS_PER_MESGHAL);
}

/** حجم سفارش تا دو رقم اعشار گرد می‌شود تا حجم‌های بی‌معنی ثبت نشود. */
export function normalizeAmount(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/** چک‌این احساسیِ اختیاریِ لحظه‌ی ثبت سفارش — فقط ۱ تا ۵؛ هرچیز دیگر یعنی «پاسخ نداده». */
export function normalizeEmotion(raw) {
  if (raw == null) return null;
  const value = Math.round(Number(raw));
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

/**
 * اعتبارسنجی سفارش. فقط نوع و حجم بررسی می‌شوند —
 * قیمت اصلاً ورودیِ کاربر نیست.
 */
export function validateOrder({ type, amount }) {
  if (type !== 'BUY' && type !== 'SELL') {
    return { ok: false, error: 'نوع سفارش نامعتبر است!' };
  }
  if (amount === null || !Number.isFinite(amount) || amount < MIN_ORDER_AMOUNT) {
    return { ok: false, error: `حداقل حجم سفارش ${MIN_ORDER_AMOUNT} ${UNIT_LABEL} است.` };
  }
  if (amount > MAX_ORDER_AMOUNT) {
    return { ok: false, error: 'حجم سفارش بیش از سقف مجاز است!' };
  }
  return { ok: true };
}

/**
 * محافظ لغزش قیمت (slippage).
 * کاربر می‌تواند بدترین قیمت قابل قبولش را اعلام کند؛ اگر بازار از آن بدتر بود،
 * سفارش رد می‌شود. این جایگزین «سفارش شرطی» واقعی نیست — سفارش معلق هنوز ساخته نشده.
 */
export function checkPriceLimit({ type, executionPrice, limitPrice }) {
  if (limitPrice === undefined || limitPrice === null) return { ok: true };

  const limit = Math.round(Number(limitPrice));
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, error: 'قیمت تعیین‌شده نامعتبر است.' };
  }
  if (type === 'BUY' && executionPrice > limit) {
    return { ok: false, error: `قیمت بازار (${executionPrice.toLocaleString('fa-IR-u-nu-latn')}) از سقفی که گذاشتی بالاتر است. سفارش ثبت نشد.` };
  }
  if (type === 'SELL' && executionPrice < limit) {
    return { ok: false, error: `قیمت بازار (${executionPrice.toLocaleString('fa-IR-u-nu-latn')}) از کفی که گذاشتی پایین‌تر است. سفارش ثبت نشد.` };
  }
  return { ok: true };
}

/**
 * اعتبارسنجی سطوح حد سود / حد ضرر نسبت به نوع سفارش و قیمت اجرا.
 * هر دو اختیاری‌اند؛ هرکدام داده نشود null برمی‌گردد (یعنی «تنظیم نشده»).
 *
 * منطق جهت: برای خرید، سود با بالا رفتن قیمت محقق می‌شود پس حد سود باید بالاتر
 * از قیمت ورود و حد ضرر پایین‌تر باشد؛ برای فروش برعکس.
 */
export function validateTpSl({ type, executionPrice, takeProfit, stopLoss }) {
  const result = { ok: true, takeProfit: null, stopLoss: null };

  if (takeProfit !== undefined && takeProfit !== null && takeProfit !== '') {
    const tp = Math.round(Number(takeProfit));
    if (!Number.isFinite(tp) || tp <= 0) return { ok: false, error: 'حد سود نامعتبر است.' };
    if (type === 'BUY' && tp <= executionPrice) return { ok: false, error: 'حد سود باید بالاتر از قیمت ورود باشد.' };
    if (type === 'SELL' && tp >= executionPrice) return { ok: false, error: 'حد سود باید پایین‌تر از قیمت ورود باشد.' };
    result.takeProfit = tp;
  }

  if (stopLoss !== undefined && stopLoss !== null && stopLoss !== '') {
    const sl = Math.round(Number(stopLoss));
    if (!Number.isFinite(sl) || sl <= 0) return { ok: false, error: 'حد ضرر نامعتبر است.' };
    if (type === 'BUY' && sl >= executionPrice) return { ok: false, error: 'حد ضرر باید پایین‌تر از قیمت ورود باشد.' };
    if (type === 'SELL' && sl <= executionPrice) return { ok: false, error: 'حد ضرر باید بالاتر از قیمت ورود باشد.' };
    result.stopLoss = sl;
  }

  return result;
}

/**
 * آیا قیمت جاری به یکی از سطوح حد سود/ضرر یک پوزیشن باز رسیده؟
 * خروجی 'takeProfit' | 'stopLoss' | null. اگر هر دو هم‌زمان برخورد کنند
 * (جهش قیمتی بزرگ)، حد ضرر اولویت دارد — محافظه‌کارانه‌تر برای کاربر.
 */
export function checkTpSlTrigger({ type, takeProfit, stopLoss, currentPrice }) {
  if (type === 'BUY') {
    if (stopLoss != null && currentPrice <= stopLoss) return 'stopLoss';
    if (takeProfit != null && currentPrice >= takeProfit) return 'takeProfit';
  } else if (type === 'SELL') {
    if (stopLoss != null && currentPrice >= stopLoss) return 'stopLoss';
    if (takeProfit != null && currentPrice <= takeProfit) return 'takeProfit';
  }
  return null;
}

/**
 * سود/زیان تحقق‌نیافته‌ی یک پوزیشن باز.
 * هم ردیف دیتابیس (goldAmount) و هم پوزیشن ارسالی به کلاینت (amount) را می‌پذیرد.
 */
export function unrealizedPnl(position, currentPrice) {
  const quantity = position.goldAmount ?? position.amount ?? 0;
  const diff = position.type === 'BUY'
    ? currentPrice - position.entryPrice
    : position.entryPrice - currentPrice;
  return diff * quantity;
}

/**
 * موجودی ریالی و طلایی از روی معاملات باز و مجموع سود معاملات بسته‌شده.
 *
 * خرید باز:  پول از حساب خارج شده، طلا اضافه شده.
 * فروش باز:  پول به حساب آمده، طلا کم شده.
 */
export function balancesFrom(openTrades, totalClosedPnl) {
  let rialBalance = INITIAL_RIAL_BALANCE + totalClosedPnl;
  let goldBalance = 0;
  let blockedMargin = 0;

  for (const trade of openTrades) {
    const margin = marginFor(trade);

    // تعهدی: طلا جابه‌جا نمی‌شود و پول هم خرج نمی‌شود — فقط وجه تضمین قفل
    // می‌شود و هنگام بستن آزاد می‌گردد. برای همین در goldBalance اثری ندارد.
    if (margin > 0) {
      rialBalance -= margin;
      blockedMargin += margin;
      continue;
    }

    const notional = trade.goldAmount * trade.entryPrice;
    if (trade.type === 'BUY') {
      rialBalance -= notional;
      goldBalance += trade.goldAmount;
    } else {
      rialBalance += notional;
      goldBalance -= trade.goldAmount;
    }
  }

  return { rialBalance, goldBalance, blockedMargin };
}

/** شکل پوزیشن‌های باز برای ارسال به کلاینت. */
export function positionsFrom(openTrades, currentPrice) {
  return openTrades.map((trade) => {
    const leverage = normalizeLeverage(trade.leverage);
    const margin = marginFor(trade);
    return {
      id: trade.id,
      type: trade.type,
      amount: trade.goldAmount,
      entryPrice: trade.entryPrice,
      pnl: unrealizedPnl(trade, currentPrice),
      takeProfit: trade.takeProfit ?? null,
      stopLoss: trade.stopLoss ?? null,
      leverage,
      margin,
      // کاربر باید قیمت انحلال را ببیند، نه اینکه ناگهان پوزیشنش بسته شود.
      liquidationPrice: liquidationPrice({ type: trade.type, entryPrice: trade.entryPrice, leverage }),
    };
  });
}

/**
 * وضعیت کامل پرتفوی، مستقیم از دیتابیس.
 * با `prisma` و با یک تراکنش (`tx`) هر دو کار می‌کند.
 */
export async function computePortfolio(client, userId, currentPrice) {
  const [openTrades, closedAgg] = await Promise.all([
    client.trade.findMany({ where: { userId, status: 'open' } }),
    client.trade.aggregate({ where: { userId, status: 'closed' }, _sum: { pnl: true } }),
  ]);

  const totalClosedPnl = closedAgg._sum.pnl || 0;
  const { rialBalance, goldBalance, blockedMargin } = balancesFrom(openTrades, totalClosedPnl);

  return {
    rialBalance,
    goldBalance,
    blockedMargin,
    positions: positionsFrom(openTrades, currentPrice),
    totalClosedPnl,
  };
}

/**
 * آیا موجودی برای این سفارش کافی است؟
 *
 * برای سفارش تعهدی فقط وجه تضمین لازم است، نه کل ارزش پوزیشن — و فروش تعهدی
 * هم به موجودی طلا نیاز ندارد، چون طلایی تحویل داده نمی‌شود.
 */
export function checkAffordability({ type, amount, executionPrice, rialBalance, goldBalance, leverage = 1 }) {
  const lev = normalizeLeverage(leverage);

  if (lev > 1) {
    const margin = Math.round((amount * executionPrice) / lev);
    if (margin > rialBalance) {
      return { ok: false, error: `وجه تضمین این پوزیشن ${margin.toLocaleString('fa-IR-u-nu-latn')} تومان است و موجودی آزادت کمتر از آن است.` };
    }
    return { ok: true };
  }

  if (type === 'BUY' && amount * executionPrice > rialBalance) {
    return { ok: false, error: 'موجودی تومانی‌ات کافی نیست.' };
  }
  if (type === 'SELL' && amount > goldBalance) {
    return { ok: false, error: 'موجودی طلایت کافی نیست.' };
  }
  return { ok: true };
}
