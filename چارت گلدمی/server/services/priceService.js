/**
 * Goldemy — Price Service (Hardened Oracle)
 *
 * مدل اعتماد:
 *   ۱. منبع اصلی = واکشی سمت سرور (upstreamPrices.js). تا وقتی تازه است، گزارش کلاینت‌ها
 *      کاملاً نادیده گرفته می‌شوند.
 *   ۲. اگر منبع سرور در دسترس نبود، گزارش کلاینت‌ها فقط به‌صورت «اجماع میانه» بین
 *      گزارش‌دهنده‌های مجزا استفاده می‌شود — نه آخرین گزارش (last-writer-wins).
 *   ۳. هر مقدار پذیرفته‌شده باید هم‌زمان از سه فیلتر بگذرد:
 *        الف) کران مطلق  ب) حداکثر گام تغییر در هر به‌روزرسانی  ج) حداکثر انحراف از لنگر
 *      «لنگر» آخرین مقداری است که از منبع مورد اعتماد سرور گرفته شده.
 *
 * ⚠️ واقعیت عملیاتی: صرافی‌های ایرانی (نوبیتکس و مشابه) معمولاً فقط از IPهای داخل
 * ایران در دسترس‌اند. سروری که خارج از ایران میزبانی شده (مثلاً Railway) به آن‌ها
 * نمی‌رسد — یعنی upstreamPrices.js برای فیلد usd معمولاً هرگز موفق نمی‌شود و
 * «لنگر»ِ usd هیچ‌وقت تنظیم نمی‌شود. نتیجه‌اش این بود که لایه‌ی دوم دفاع (بند ج) برای
 * usd در عمل همیشه خاموش می‌ماند و تنها سد باقی‌مانده، گام حداکثریِ هر تیک بود —
 * که با یک گزارش‌دهنده‌ی تنها (یعنی وقتی فقط یک کاربر آنلاین است)، ظرف حدود ۵ دقیقه
 * می‌توانست قیمت را چیزی حدود ۴٫۵ برابر کند.
 *
 * برای همین، گام مجاز به تعداد گزارش‌دهنده‌های مستقل وابسته شده: با حداقل دو
 * گزارش‌دهنده‌ی مستقل، قیمت با سرعت عادی به سمت میانه حرکت می‌کند؛ با یک گزارش‌دهنده
 * (یا هیچ)، گام به یک‌دهم کاهش می‌یابد — همان‌قدر که برای دنبال کردن نوسان طبیعی
 * بازار در طول دقایق/ساعت کافی است، اما برای دستکاری سریع توسط یک کاربر تنها،
 * غیرعملی است.
 */

const BOUNDS = {
  gold: { min: 500, max: 20000 },      // دلار بر هر اونس
  usd: { min: 20000, max: 5000000 },   // تومان بر هر تتر
};

const UPSTREAM_TRUST_MS = 90 * 1000;       // مقدار سمت سرور تا این مدت معتبر است
const REPORT_TTL_MS = 20 * 1000;           // گزارش کلاینت پس از این مدت از اجماع خارج می‌شود
// ⚠️ باید حداقل به‌اندازه‌ی فاصله‌ی بین دو فراخوانی upstream دلار باشد (فعلاً
// هر ۸ ساعت، به‌خاطر سهمیه‌ی نواسان — رجوع کنید به USD_REFRESH_MS در index.js).
// اگر کوتاه‌تر از آن باشد، لنگر همیشه بین دو فراخوانی منقضی می‌شود و هیچ اثری
// نمی‌گذارد. ۱۰ ساعت کمی حاشیه‌ی امنیت روی ۸ ساعت می‌دهد.
const ANCHOR_TTL_MS = 10 * 60 * 60 * 1000;
const MAX_ANCHOR_DRIFT_RATIO = 0.05;       // حداکثر ۵٪ انحراف از آخرین مقدار مورد اعتماد
const MAZNE_DIVISOR = 9.5742;

// گام مجاز در هر به‌روزرسانیِ اجماعی، وابسته به تعداد گزارش‌دهنده‌ی مستقل
const MIN_REPORTERS_FOR_FULL_STEP = 2;
const FULL_CONFIDENCE_STEP_RATIO = 0.005;   // ۰٫۵٪ — با حداقل دو گزارش‌دهنده‌ی هم‌رأی
const LOW_CONFIDENCE_STEP_RATIO = 0.0005;   // ۰٫۰۵٪ — با یک گزارش‌دهنده یا هیچ

export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export const isInBounds = (value, bounds) =>
  Number.isFinite(value) && value >= bounds.min && value <= bounds.max;

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * یک مرحله از اجماع را محاسبه می‌کند — تابعی خالص و بدون وابستگی به زمان سیستم یا
 * state کلاس، تا مستقل از بقیه‌ی PriceService قابل تست باشد.
 *
 * @param {number} current      مقدار جاری
 * @param {number[]} samples    گزارش‌های کلاینت‌های مختلف برای همین فیلد
 * @param {{min:number,max:number}} bounds  کران مطلق فیلد
 * @param {number|null} anchor  آخرین مقدار مورد اعتماد سرور (یا null اگر هرگز تنظیم نشده)
 * @param {boolean} anchorIsFresh  آیا لنگر هنوز منقضی نشده
 * @returns {number} مقدار بعدی
 */
export function reconcileStep({ current, samples, bounds, anchor, anchorIsFresh, isSeed = false }) {
  let target = median(samples);

  // قید ۱: انحراف از لنگر (تا وقتی لنگر منقضی نشده و اصلاً تنظیم شده باشد)
  if (anchor !== null && anchorIsFresh) {
    const drift = anchor * MAX_ANCHOR_DRIFT_RATIO;
    target = clamp(target, anchor - drift, anchor + drift);
  }

  const enoughReporters = samples.length >= MIN_REPORTERS_FOR_FULL_STEP;

  // 🐛 وقتی مقدار جاری هنوز همان عددِ موقتِ نوشته‌شده در کد است (seed)، گام‌به‌گام
  // رفتن به سمت قیمت واقعی معنا ندارد: محدودیت گام برای این ساخته شده که کسی نتواند
  // قیمتِ *درست* را به‌تدریج منحرف کند، نه اینکه از یک عددِ بی‌معنی آهسته دور شویم.
  // نتیجه‌ی آن رفتار این بود که فاصله‌ی seed تا قیمت واقعی (گاهی ۶٪) به‌شکل یک
  // صعودِ تدریجیِ کاملاً ساختگی روی چارت ثبت می‌شد.
  //
  // پس یک‌باره به اجماع می‌پریم — اما فقط وقتی حداقل دو گزارش‌دهنده‌ی مستقل هم‌رأی
  // باشند؛ وگرنه یک کاربر تنها می‌توانست در لحظه‌ی بالا آمدن سرور قیمت را هرجا
  // که کران مطلق اجازه می‌دهد بنشاند.
  if (isSeed && enoughReporters) {
    return clamp(target, bounds.min, bounds.max);
  }

  // قید ۲: حداکثر گام، وابسته به تعداد گزارش‌دهنده‌های مستقل
  const stepRatio = enoughReporters ? FULL_CONFIDENCE_STEP_RATIO : LOW_CONFIDENCE_STEP_RATIO;
  const step = Math.abs(current) * stepRatio;
  let next = clamp(target, current - step, current + step);

  // قید ۳: کران مطلق
  return clamp(next, bounds.min, bounds.max);
}

const SEED_GOLD = 4121.0;
const SEED_USD = 185000;

class PriceService {
  // مقدار جاری هر فیلد + منبع و زمان آن
  static _gold = { value: SEED_GOLD, source: 'seed', at: 0 };
  static _usd = { value: SEED_USD, source: 'seed', at: 0 };

  // آخرین مقدار مورد اعتماد سرور (لنگر مقاومت در برابر drift)
  static _anchor = { gold: null, usd: null, at: 0 };

  // reporterId → { gold, usd, at }
  static _reports = new Map();

  static _mazne = Math.floor((SEED_GOLD * SEED_USD) / MAZNE_DIVISOR / 1000) * 1000;

  // ─────────────────────────────────────────────
  // منبع مورد اعتماد (واکشی سمت سرور)
  // ─────────────────────────────────────────────
  static setUpstream({ globalGoldSpot, usdIrtPrice }) {
    const now = Date.now();
    let accepted = false;

    if (isInBounds(globalGoldSpot, BOUNDS.gold)) {
      this._gold = { value: Number(globalGoldSpot.toFixed(2)), source: 'upstream', at: now };
      this._anchor.gold = this._gold.value;
      accepted = true;
    }
    if (isInBounds(usdIrtPrice, BOUNDS.usd)) {
      this._usd = { value: Math.floor(usdIrtPrice), source: 'upstream', at: now };
      this._anchor.usd = this._usd.value;
      accepted = true;
    }

    if (accepted) {
      this._anchor.at = now;
      this._recalculateMazne();
    }
    return accepted;
  }

  static _isUpstreamFresh(field) {
    const state = field === 'gold' ? this._gold : this._usd;
    return state.source === 'upstream' && Date.now() - state.at < UPSTREAM_TRUST_MS;
  }

  // ─────────────────────────────────────────────
  // گزارش کلاینت‌ها (غیرقابل‌اعتماد — فقط ورودی اجماع)
  // ─────────────────────────────────────────────
  static ingestClientReport(reporterId, { globalGoldSpot, usdIrtPrice } = {}) {
    if (!reporterId) return false;

    const gold = isInBounds(Number(globalGoldSpot), BOUNDS.gold) ? Number(globalGoldSpot) : null;
    const usd = isInBounds(Number(usdIrtPrice), BOUNDS.usd) ? Number(usdIrtPrice) : null;
    if (gold === null && usd === null) return false;

    this._reports.set(reporterId, { gold, usd, at: Date.now() });
    return true;
  }

  static dropReporter(reporterId) {
    this._reports.delete(reporterId);
  }

  static _pruneReports() {
    const cutoff = Date.now() - REPORT_TTL_MS;
    for (const [id, report] of this._reports) {
      if (report.at < cutoff) this._reports.delete(id);
    }
  }

  /**
   * هر تیک صدا زده می‌شود. اگر منبع سرور تازه باشد کاری نمی‌کند؛
   * در غیر این صورت مقدار جاری را با گام محدود به سمت اجماع کلاینت‌ها می‌برد.
   */
  static reconcile() {
    this._pruneReports();

    for (const field of ['gold', 'usd']) {
      if (this._isUpstreamFresh(field)) continue;

      const samples = [];
      for (const report of this._reports.values()) {
        if (report[field] !== null) samples.push(report[field]);
      }
      if (samples.length === 0) continue;

      const current = field === 'gold' ? this._gold.value : this._usd.value;
      const anchor = this._anchor[field];
      const anchorIsFresh = Date.now() - this._anchor.at < ANCHOR_TTL_MS;

      const isSeed = (field === 'gold' ? this._gold.source : this._usd.source) === 'seed';
      const next = reconcileStep({ current, samples, bounds: BOUNDS[field], anchor, anchorIsFresh, isSeed });

      const state = { value: field === 'gold' ? Number(next.toFixed(2)) : Math.floor(next), source: 'consensus', at: Date.now() };
      if (field === 'gold') this._gold = state;
      else this._usd = state;
    }

    this._recalculateMazne();
  }

  // ─────────────────────────────────────────────
  // محاسبه مظنه ۱۷ عیار بازار تهران
  // ─────────────────────────────────────────────
  static _recalculateMazne() {
    const raw = (this._gold.value * this._usd.value) / MAZNE_DIVISOR;
    this._mazne = Math.floor(raw / 1000) * 1000;
  }

  /**
   * آیا قیمت جاری واقعی است یا هنوز همان مقدار موقتِ نوشته‌شده در کد (seed)؟
   *
   * مظنه از حاصل‌ضرب اونس و دلار ساخته می‌شود، پس تا وقتی *هر دو* از منبع واقعی
   * نیامده باشند، عدد نهایی قابل استناد نیست. موتور بازار تا آن لحظه هیچ کندلی
   * نمی‌سازد؛ وگرنه فاصله‌ی بین seed و قیمت واقعی به‌شکل یک شمعِ غول‌پیکرِ ساختگی
   * روی چارت می‌نشیند.
   */
  static isReal() {
    return this._gold.source !== 'seed' && this._usd.source !== 'seed';
  }

  static getLiveTick() {
    return {
      maznePrice: this._mazne,
      globalGoldSpot: this._gold.value,
      usdIrtPrice: this._usd.value,
      lastUpdate: new Date().toISOString(),
    };
  }

  /** برای پایش سلامت اوراکل — از جمله اینکه الان چند گزارش‌دهنده‌ی زنده وجود دارد. */
  static getDiagnostics() {
    let goldReporters = 0;
    let usdReporters = 0;
    for (const report of this._reports.values()) {
      if (report.gold !== null) goldReporters++;
      if (report.usd !== null) usdReporters++;
    }

    return {
      gold: { ...this._gold, reporters: goldReporters },
      usd: { ...this._usd, reporters: usdReporters },
      activeReporters: this._reports.size,
      anchorAgeMs: this._anchor.at ? Date.now() - this._anchor.at : null,
    };
  }
}

export { PriceService };
