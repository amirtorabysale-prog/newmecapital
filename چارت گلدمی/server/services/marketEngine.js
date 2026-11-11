import {
  INITIAL_GRAM_PRICE, CANDLE_INTERVAL_MS, MAX_CANDLES, MAX_ORDER_BOOK_ROWS,
} from '../types.js';

class MarketEngine {
  /**
   * @param {number} initialPrice قیمت شروع، در همان مقیاسِ مظنه‌ای که price نمایش
   *   می‌دهد. اگر داده نشود، از INITIAL_GRAM_PRICE استفاده می‌شود (فقط برای زمانی
   *   که اوراکل هنوز هیچ مقداری نداده — در عمل سرور همیشه با قیمت واقعی صدا می‌زند).
   */
  constructor(initialPrice = INITIAL_GRAM_PRICE) {
    // ثابت‌های نوسان این فایل (در _init و _generateOrderBook) اصلاً برای مقیاس
    // «قیمت گرم» (INITIAL_GRAM_PRICE ≈ ۴٫۲۵ میلیون) تنظیم شده بودند. از وقتی price
    // مستقیماً مظنه شد (~۸۰ میلیون، تقریباً ۱۹ برابر)، این ثابت‌ها بدون تناسب با
    // مقیاس واقعی باقی مانده بودند — نتیجه‌اش ۱۰۰ کندل تاریخیِ تقریباً کاملاً صاف
    // (نوسانی هزاران‌بار کوچک‌تر از قیمت واقعی) کنار یک کندلِ زنده در مقیاس درست.
    // این ضریب همان نسبت تناسب را نگه می‌دارد، مستقل از اینکه initialPrice چند باشد.
    this.scale = initialPrice / INITIAL_GRAM_PRICE;

    this.currentTick = {
      price: initialPrice, change24h: 0,
      high24h: initialPrice * 1.025, low24h: initialPrice * 0.985,
      lastTickTime: Date.now(),
      // مقدار موقت تا اولین تیکِ اوراکل برسد؛ applyOraclePrices مقدار واقعی را می‌نویسد.
      maznePrice: 0,
      globalGoldSpot: 2340.0, usdIrtPrice: 59000,
      marketOpen: false, marketStatus: 'WAITING',
    };
    // مرجع محاسبه‌ی درصد تغییر — با اولین قیمت واقعیِ اوراکل مقداردهی می‌شود
    this.sessionOpenPrice = null;
    this.candles = [];
    this.activeCandle = null;
    this.activeCandleStartTime = 0;
    this.marketOpen = false;
    this.closedSessionCandle = false;
    this.orderBook = { bids: [], asks: [] };
    // 🐛 تا وقتی اوراکل قیمت واقعی نداده، موتور هیچ کندلی نمی‌سازد. پیش‌تر بلافاصله
    // یک کندل روی قیمتِ seed (مقدار موقتِ نوشته‌شده در priceService) باز می‌شد و
    // چند ثانیه بعد که قیمت واقعی می‌رسید، همان کندل تا قیمت واقعی کشیده می‌شد —
    // یک شمعِ غول‌پیکر که یک حرکت ۵–۶ درصدیِ کاملاً ساختگی نشان می‌داد. آن حرکت
    // هرگز در بازار رخ نداده بود؛ فقط فاصله‌ی بین مقدار موقت و مقدار واقعی بود.
    this.isActive = false;
    this.orderBook = this._generateOrderBook(initialPrice);
  }

  /**
   * با رسیدن اولین قیمتِ واقعیِ اوراکل صدا زده می‌شود. از این لحظه به بعد کندل ساخته
   * می‌شود و مرجع درصد تغییر و کف/سقف روی همان قیمت واقعی تنظیم می‌شود — نه روی seed.
   * فراخوانی دوباره بی‌اثر است.
   */
  activate(realPrice, marketOpen = true) {
    if (this.isActive) return;
    this.isActive = true;
    this.marketOpen = marketOpen;
    this.closedSessionCandle = false;
    this.scale = realPrice / INITIAL_GRAM_PRICE;
    this.sessionOpenPrice = realPrice;
    this.currentTick = {
      ...this.currentTick,
      // maznePrice عمداً دست نمی‌خورد: متعلق به اوراکل است، نه موتور بازار.
      price: realPrice,
      high24h: realPrice, low24h: realPrice, change24h: 0,
      lastTickTime: Date.now(),
    };
    // اگر تاریخچه‌ای از دیتابیس بارگذاری شده باشد، کندلِ جاری بعد از آن شروع می‌شود.
    this.activeCandle = marketOpen ? {
      time: Math.floor(Date.now() / 1000),
      open: realPrice, high: realPrice, low: realPrice, close: realPrice,
    } : null;
    this.activeCandleStartTime = marketOpen ? Date.now() : 0;
    this.orderBook = this._generateOrderBook(realPrice);
  }

  /**
   * تاریخچه‌ی کندل‌ها را از منبع پایدار (دیتابیس) بارگذاری می‌کند تا با هر ری‌استارت
   * سرور — که در Railway با هر استقرار جدید اتفاق می‌افتد — چارت از صفر شروع نشود.
   */
  loadHistory(candles) {
    if (!Array.isArray(candles) || candles.length === 0) return;
    this.candles = candles.slice(-MAX_CANDLES);
  }

  _generateOrderBook(currentPrice) {
    const bids = [], asks = [];
    let totalBidVolume = 0, totalAskVolume = 0;
    const step = 150 * this.scale;
    const spread = 40 * this.scale;
    for (let i = 0; i < MAX_ORDER_BOOK_ROWS; i++) {
      const bidPrice = Math.round(currentPrice - spread - i * step - Math.random() * spread);
      const bidVolume = Math.round((50 + Math.random() * 800) * 10) / 10;
      totalBidVolume += bidVolume;
      bids.push({ price: bidPrice, volume: bidVolume, percent: 0 });
      const askPrice = Math.round(currentPrice + spread + i * step + Math.random() * spread);
      const askVolume = Math.round((50 + Math.random() * 800) * 10) / 10;
      totalAskVolume += askVolume;
      asks.push({ price: askPrice, volume: askVolume, percent: 0 });
    }
    bids.forEach(item => { item.percent = Math.min(100, Math.round((item.volume / totalBidVolume) * 250)); });
    asks.forEach(item => { item.percent = Math.min(100, Math.round((item.volume / totalAskVolume) * 250)); });
    return { bids, asks };
  }

  tick({ marketOpen = true, marketStatus = marketOpen ? 'OPEN' : 'WEEKEND' } = {}) {
    // پیش از رسیدن قیمت واقعی هیچ کندلی ساخته نمی‌شود (رجوع کنید به activate).
    if (!this.isActive) {
      this.currentTick.marketOpen = marketOpen;
      this.currentTick.marketStatus = marketStatus;
      return { tick: this.currentTick, orderBook: this.orderBook, candleUpdate: null, newCandle: false };
    }

    const previous = this.currentTick;
    // ⚠️ پیش‌تر اینجا (Math.random()-0.5)*200*scale به قیمت واقعی اضافه می‌شد — یک
    // نویز ساختگی از دورانی که این موتور کاملاً شبیه‌سازی‌شده بود. چون applyOraclePrices
    // در server/index.js همین لحظه (درست قبل از فراخوانی tick) قیمت واقعی را در
    // previous.price نشسته، آن نویز عملاً تنها چیزی بود که کندل‌ها را حرکت می‌داد —
    // چون قیمت واقعی معمولاً در بازه‌ی کوتاه هر کندل (۱۰ ثانیه) اصلاً عوض نمی‌شود.
    // نتیجه: کاربر کندل‌هایی می‌دید که کاملاً ساختگی حرکت می‌کردند، نه واقعی.
    // حالا newPrice دقیقاً همان قیمت واقعی است؛ حرکت چارت فقط وقتی رخ می‌دهد که
    // قیمت واقعاً حرکت کرده باشد.
    const newPrice = previous.price;

    // اولین تیک پس از رسیدن قیمت واقعی، مرجع و کف/سقف را بازنشانی می‌کند.
    // بدون این، change24h نسبت به قیمت «گرم» سنجیده می‌شد در حالی که price یک «مظنه» است.
    if (this.sessionOpenPrice === null) {
      this.sessionOpenPrice = newPrice;
      previous.high24h = newPrice;
      previous.low24h = newPrice;
    }

    this.currentTick = {
      price: newPrice,
      change24h: Math.round(((newPrice - this.sessionOpenPrice) / this.sessionOpenPrice) * 10000) / 100,
      high24h: Math.max(previous.high24h, newPrice),
      low24h: Math.min(previous.low24h, newPrice),
      lastTickTime: Date.now(),
      // 🐛 این سه فیلد متعلق به اوراکل‌اند و موتور بازار نباید بازنویسی‌شان کند.
      // maznePrice پیش‌تر با newPrice پر می‌شد؛ از وقتی واحد معامله گرم شد،
      // newPrice قیمتِ گرم است و این یعنی «مظنه» و «هر گرم» در هدر عددِ یکسانی
      // نشان می‌دادند — مظنه حدود پنج برابر قیمت گرم است.
      maznePrice: previous.maznePrice,
      globalGoldSpot: previous.globalGoldSpot,
      usdIrtPrice: previous.usdIrtPrice,
      marketOpen,
      marketStatus,
    };
    this.orderBook = this._generateOrderBook(newPrice);

    let candleUpdate = null;
    let newCandle = false;

    // در لحظه‌ی بسته‌شدن بازار، کندل نیمه‌تمام فقط یک‌بار نهایی می‌شود. پس از آن
    // کندل تخت تازه‌ای ساخته نمی‌شود. اگر نرخ دلار در تعطیلی واقعاً قیمت گرم را
    // تغییر دهد، همه‌ی آن تغییرها در یک کندلِ تجمیعی ثبت می‌شوند تا قیمت روی
    // چارت هرگز از قیمت معامله جدا نماند.
    if (!marketOpen) {
      if (this.marketOpen && this.activeCandle) {
        this.activeCandle.high = Math.max(this.activeCandle.high, newPrice);
        this.activeCandle.low = Math.min(this.activeCandle.low, newPrice);
        this.activeCandle.close = newPrice;
        candleUpdate = { ...this.activeCandle };
        this.candles.push(candleUpdate);
        if (this.candles.length > MAX_CANDLES) this.candles.shift();
        newCandle = true;
        this.activeCandle = null;
        this.activeCandleStartTime = 0;
        this.closedSessionCandle = false;
        this.marketOpen = false;
        return { tick: this.currentTick, orderBook: this.orderBook, candleUpdate, newCandle };
      }

      if (this.closedSessionCandle && this.activeCandle) {
        if (this.activeCandle.close !== newPrice) {
          this.activeCandle.high = Math.max(this.activeCandle.high, newPrice);
          this.activeCandle.low = Math.min(this.activeCandle.low, newPrice);
          this.activeCandle.close = newPrice;
          candleUpdate = { ...this.activeCandle };
        }
      } else {
        const lastClose = this.candles[this.candles.length - 1]?.close ?? newPrice;
        if (lastClose !== newPrice) {
          this.activeCandle = {
            time: Math.floor(Date.now() / 1000),
            open: lastClose,
            high: Math.max(lastClose, newPrice),
            low: Math.min(lastClose, newPrice),
            close: newPrice,
          };
          this.activeCandleStartTime = Date.now();
          this.closedSessionCandle = true;
          candleUpdate = { ...this.activeCandle };
        }
      }
      this.marketOpen = false;
      return { tick: this.currentTick, orderBook: this.orderBook, candleUpdate, newCandle };
    }

    // اولین تیکِ جلسه‌ی تازه از قیمت واقعی همان لحظه یک کندل جدید باز می‌کند.
    if (!this.marketOpen || !this.activeCandle) {
      if (this.closedSessionCandle && this.activeCandle) {
        this.candles.push({ ...this.activeCandle });
        if (this.candles.length > MAX_CANDLES) this.candles.shift();
        newCandle = true;
      }
      this.activeCandle = {
        time: Math.floor(Date.now() / 1000),
        open: newPrice, high: newPrice, low: newPrice, close: newPrice,
      };
      this.activeCandleStartTime = Date.now();
      this.marketOpen = true;
      this.closedSessionCandle = false;
      return { tick: this.currentTick, orderBook: this.orderBook, candleUpdate: { ...this.activeCandle }, newCandle };
    }

    this.marketOpen = true;
    if (this.activeCandle) {
      this.activeCandle.high = Math.max(this.activeCandle.high, newPrice);
      this.activeCandle.low = Math.min(this.activeCandle.low, newPrice);
      this.activeCandle.close = newPrice;
      candleUpdate = this.activeCandle;
    }
    if (Date.now() - this.activeCandleStartTime >= CANDLE_INTERVAL_MS) {
      if (this.activeCandle) { this.candles.push({ ...this.activeCandle }); if (this.candles.length > MAX_CANDLES) this.candles.shift(); }
      this.activeCandle = { time: Math.floor(Date.now() / 1000), open: newPrice, high: newPrice, low: newPrice, close: newPrice };
      this.activeCandleStartTime = Date.now();
      newCandle = true;
    }
    return { tick: this.currentTick, orderBook: this.orderBook, candleUpdate, newCandle };
  }

  getSnapshot() {
    return { tick: this.currentTick, orderBook: this.orderBook, candles: [...this.candles] };
  }
}

export { MarketEngine };
