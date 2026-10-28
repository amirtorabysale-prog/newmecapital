/**
 * فهرستِ پارامترهای قابلِ تغییر از پنلِ بات. هر چیزی که این‌جا نیست از
 * تلگرام عوض نمی‌شود — عمداً: پنل باید فقط چیزهایی را نشان بدهد که معنایشان
 * برای ادمین روشن است.
 *
 * id عددی است چون callback_data ی تلگرام ۶۴ بایت جا دارد.
 */

export const CONDITIONS = {
  trendline: {
    fa: 'خط روند',
    en: 'Trendline',
    locked: true, // پایه‌ی استراتژی؛ خاموش شدنی نیست
    about: 'خطِ روندِ صعودی با دو برخوردِ ماژور، و قیمتِ فعلی روی آن (برخوردِ سوم). '
      + 'برخوردِ ماژور یعنی کفِ چرخشیِ قوی که بعدش قیمت دست‌کم چند ATR از خط فاصله گرفته. '
      + 'روی خط = امتیازِ کامل · در حالِ نزدیک شدن = نصف.',
  },
  fib: {
    fa: 'فیبوناچی',
    en: 'Fib',
    about: 'سطحِ فیبوناچیِ آخرین موجِ صعودی (از کفِ برخوردِ دوم تا سقفِ بعدش) باید روی خط بنشیند. '
      + 'نزدیک = امتیازِ کامل · کمی دورتر = نصف.',
  },
  divergence: {
    fa: 'واگرایی RSI',
    en: 'RSI Div',
    about: 'بینِ کفِ فعلی و یک کفِ قبلی. معمولی: قیمت پایین‌تر، RSI بالاتر. '
      + 'مخفی: قیمت بالاتر، RSI پایین‌تر (ادامه‌ی روند). '
      + 'شدیدترین نقطه‌ی RSI باید از ناحیه‌ی اشباع رد شده باشد: کف زیرِ 30، سقف بالای 80.',
  },
  candle: {
    fa: 'کندلِ برگشتی',
    en: 'Reversal',
    about: 'روی یکی از کندل‌های آخر، کنارِ خط: پوشا و ستاره‌ی صبحگاهی (×1)، چکش (×0.9)، '
      + 'نفوذی (×0.85)، انبرک (×0.75)، هارامی و دوجی (×0.6).',
  },
  trendFilter: {
    fa: 'فیلترِ روند (EMA)',
    en: 'EMA Trend',
    about: 'قیمت بالای میانگینِ متحرکِ نمایی باشد — خرید فقط هم‌جهت با روندِ بزرگ‌تر. '
      + 'در حالتِ «الزامی»، زیرِ EMA هیچ هشداری نمی‌آید.',
  },
  volume: {
    fa: 'تأییدِ حجم',
    en: 'Volume',
    about: 'حجمِ کندلِ برگشتی (یا کفِ برخورد) از میانگینِ حجمِ کندل‌های قبلی بیشتر باشد.',
  },
  divergence5m: {
    fa: 'واگرایی RSI 5 دقیقه',
    en: 'RSI Div 5m',
    about: 'همان واگراییِ RSI، ولی روی کندلِ 5 دقیقه: پایین‌ترین کفِ 5 دقیقه از شروعِ کندلِ برخورد با خط، '
      + 'در برابرِ یک کفِ 5 دقیقه‌ایِ قبلی. فقط وقتی قیمت روی خط است بررسی می‌شود. '
      + 'اگر صرافی داده‌ی 5 دقیقه نداد، این شرط (در حالتِ اختیاری) از امتیاز کنار می‌رود.',
  },
};

// group: کدام صفحه‌ی پنل · type: num | bool | choice | list
export const PARAMS = [
  // خط روند
  { id: 1, group: 'trendline', path: 'strategy.trendline.pivotStrength', fa: 'قدرتِ کف', unit: 'کندل هر طرف', step: 1, min: 2, max: 20, about: 'کف وقتی کفِ چرخشی است که پایین‌ترینِ این تعداد کندل در دو طرفش باشد. بزرگ‌تر = کف‌های مهم‌تر و کمتر.' },
  { id: 2, group: 'trendline', path: 'strategy.trendline.minBounceAtr', fa: 'حداقلِ واکنش', unit: 'ATR', step: 0.5, min: 0.5, max: 10, about: 'بعد از هر برخورد، قیمت دست‌کم این‌قدر از خط دور شده باشد تا برخورد «ماژور» حساب شود.' },
  { id: 3, group: 'trendline', path: 'strategy.trendline.touchToleranceAtr', fa: 'تحملِ برخورد', unit: 'ATR', step: 0.1, min: 0.1, max: 3, about: 'کفِ فعلی تا این فاصله از خط = «روی خط است».' },
  { id: 4, group: 'trendline', path: 'strategy.trendline.approachAtr', fa: 'فاصله‌ی «نزدیک شدن»', unit: 'ATR', step: 0.25, min: 0.25, max: 5, about: 'تا این فاصله، خط نصفِ امتیاز می‌گیرد (قیمت دارد به خط می‌رسد).' },
  { id: 5, group: 'trendline', path: 'strategy.trendline.lookback', fa: 'بازه‌ی جست‌وجو', unit: 'کندل', step: 25, min: 50, max: 380, about: 'خط روند در این تعداد کندلِ آخر جست‌وجو می‌شود.' },
  { id: 6, group: 'trendline', path: 'strategy.trendline.minSpacing', fa: 'حداقلِ فاصله‌ی دو برخورد', unit: 'کندل', step: 2, min: 3, max: 60 },
  { id: 7, group: 'trendline', path: 'strategy.trendline.breakToleranceAtr', fa: 'تحملِ شکست', unit: 'ATR', step: 0.05, min: 0, max: 1, about: 'بسته شدنِ کندل تا این مقدار زیرِ خط هنوز شکست حساب نمی‌شود.' },
  { id: 8, group: 'trendline', path: 'strategy.trendline.maxWickPierceAtr', fa: 'تحملِ سایه', unit: 'ATR', step: 0.1, min: 0, max: 3, about: 'سایه‌ی کندل تا این مقدار می‌تواند از خط رد شود و خط هنوز معتبر است.' },

  // فیبو
  { id: 10, group: 'fib', path: 'strategy.fib.level', fa: 'سطحِ فیبو', type: 'choice', choices: [0.382, 0.5, 0.618, 0.705, 0.786], about: 'سطحی که باید روی خط بنشیند.' },
  { id: 11, group: 'fib', path: 'strategy.fib.toleranceAtr', fa: 'تحمل (امتیازِ کامل)', unit: 'ATR', step: 0.1, min: 0.1, max: 3 },
  { id: 12, group: 'fib', path: 'strategy.fib.nearToleranceAtr', fa: 'تحمل (نصفِ امتیاز)', unit: 'ATR', step: 0.1, min: 0.1, max: 5 },

  // واگرایی
  { id: 20, group: 'divergence', path: 'strategy.rsiPeriod', fa: 'دوره‌ی RSI', unit: 'کندل', step: 1, min: 5, max: 30 },
  { id: 19, group: 'divergence', path: 'strategy.divergence.pivotStrength', fa: 'قدرتِ کفِ قبلی', unit: 'کندل هر طرف', step: 1, min: 2, max: 10, about: 'کفِ قبلیِ واگرایی باید پایین‌ترینِ این تعداد کندل در دو طرفش باشد.' },
  { id: 21, group: 'divergence', path: 'strategy.divergence.lookback', fa: 'بازه‌ی جست‌وجو', unit: 'کندل', step: 10, min: 20, max: 200 },
  { id: 22, group: 'divergence', path: 'strategy.divergence.minGap', fa: 'حداقلِ فاصله‌ی دو کف', unit: 'کندل', step: 1, min: 3, max: 40 },
  { id: 23, group: 'divergence', path: 'strategy.divergence.minRsiDelta', fa: 'حداقلِ اختلافِ RSI', unit: 'واحد', step: 0.5, min: 0.5, max: 20 },
  { id: 24, group: 'divergence', path: 'strategy.divergence.allowHidden', fa: 'واگراییِ مخفی هم قبول', type: 'bool' },
  // ناحیه‌ی اشباع — برای واگراییِ یک‌ساعته و ۵ دقیقه، هر دو
  { id: 70, group: 'divergence', path: 'strategy.rsiZone.enabled', fa: 'شرطِ اشباعِ RSI', type: 'bool', about: 'واگرایی فقط وقتی حساب است که RSI در شدیدترین نقطه‌اش از ناحیه‌ی اشباع رد شده باشد. برای واگراییِ 5 دقیقه هم اعمال می‌شود.' },
  { id: 71, group: 'divergence', path: 'strategy.rsiZone.low', fa: 'اشباعِ فروش (کف)', unit: 'RSI', step: 5, min: 5, max: 50, about: 'در واگرایی کف (خرید)، RSI باید زیرِ این عدد رفته باشد.' },
  { id: 72, group: 'divergence', path: 'strategy.rsiZone.high', fa: 'اشباعِ خرید (سقف)', unit: 'RSI', step: 5, min: 50, max: 95, about: 'در واگرایی سقف (فروش)، RSI باید بالای این عدد رفته باشد.' },

  // واگراییِ 5 دقیقه — دوره‌ی RSI همان دوره‌ی بالاست
  { id: 25, group: 'divergence5m', path: 'strategy.divergence5m.pivotStrength', fa: 'قدرتِ کف', unit: 'کندل هر طرف', step: 1, min: 2, max: 10 },
  { id: 26, group: 'divergence5m', path: 'strategy.divergence5m.lookback', fa: 'بازه‌ی جست‌وجو', unit: 'کندلِ 5 دقیقه', step: 12, min: 24, max: 240 },
  { id: 27, group: 'divergence5m', path: 'strategy.divergence5m.minGap', fa: 'حداقلِ فاصله‌ی دو کف', unit: 'کندلِ 5 دقیقه', step: 1, min: 3, max: 60 },
  { id: 28, group: 'divergence5m', path: 'strategy.divergence5m.minRsiDelta', fa: 'حداقلِ اختلافِ RSI', unit: 'واحد', step: 0.5, min: 0.5, max: 20 },
  { id: 29, group: 'divergence5m', path: 'strategy.divergence5m.allowHidden', fa: 'واگراییِ مخفی هم قبول', type: 'bool' },

  // کندل
  { id: 30, group: 'candle', path: 'strategy.candles.window', fa: 'کندل‌های بررسی‌شده', unit: 'کندلِ آخر', step: 1, min: 1, max: 5 },

  // فیلترِ روند
  { id: 40, group: 'trendFilter', path: 'strategy.trendFilter.emaPeriod', fa: 'دوره‌ی EMA', unit: 'کندل', step: 10, min: 20, max: 300 },

  // حجم
  { id: 45, group: 'volume', path: 'strategy.volume.period', fa: 'میانگینِ حجم', unit: 'کندل', step: 5, min: 5, max: 100 },
  { id: 46, group: 'volume', path: 'strategy.volume.multiplier', fa: 'ضریبِ لازم', unit: '× میانگین', step: 0.1, min: 1, max: 5 },

  // پلنِ معامله
  { id: 50, group: 'plan', path: 'strategy.plan.slBufferAtr', fa: 'فاصله‌ی حد ضرر زیرِ خط', unit: 'ATR', step: 0.25, min: 0, max: 5 },
  { id: 51, group: 'plan', path: 'strategy.plan.tpExtensions', fa: 'تارگت‌ها (اکستنشن)', type: 'list', about: 'هر عدد یک تارگت: 0 = سقفِ موج، 0.272 = اکستنشنِ 1.272، 0.618 = اکستنشنِ 1.618. با کاما بنویس، مثلاً: 0, 0.272, 0.618' },
  { id: 52, group: 'plan', path: 'strategy.plan.minRR', fa: 'حداقلِ R:R تارگتِ اول', unit: 'R', step: 0.25, min: 0, max: 5, about: 'کمتر از این، هشدار با علامتِ ⚠️ می‌آید.' },

  // عمومی
  { id: 60, group: 'general', path: 'alertThreshold', fa: 'آستانه‌ی هشدار', unit: 'از 100', step: 5, min: 30, max: 100 },
  { id: 61, group: 'general', path: 'cooldownHours', fa: 'فاصله‌ی تکرارِ هشدارِ یک ستاپ', unit: 'ساعت', step: 2, min: 1, max: 72 },
  { id: 63, group: 'general', path: 'maxHoldHours', fa: 'حداکثر عمرِ پیگیریِ سیگنال', unit: 'ساعت', step: 12, min: 12, max: 336, about: 'سیگنالی که تا این زمان نه تارگتِ آخر و نه حد ضرر خورد، با قیمتِ همان لحظه بسته و در کارنامه ثبت می‌شود.' },
  { id: 64, group: 'general', path: 'nearAlerts', fa: 'هشدارِ نزدیک شدن به خط', type: 'bool', about: 'وقتی قیمتِ یک ارز به خط روند نزدیک می‌شود، پیش از ستاپ یک پیامِ کوتاه برای ادمین‌ها می‌آید.' },
  { id: 62, group: 'general', path: 'alertTtlHours', fa: 'اعتبارِ دکمه‌ی انتشار', unit: 'ساعت', step: 1, min: 1, max: 24 },
  { id: 65, group: 'general', path: 'publishMaxDriftAtr', fa: 'حداکثر فاصله‌ی قیمت از ورود هنگامِ انتشار', unit: 'ATR', step: 0.25, min: 0.25, max: 3, about: 'لحظه‌ی زدنِ «انتشار» قیمتِ فعلی گرفته می‌شود. اگر از ورودِ پلن بیش از این فاصله گرفته باشد، انتشار متوقف می‌شود تا ورود را ویرایش کنی.' },
];

// وزن و روشن/خاموش/الزامیِ هر شرط هم پارامترند، با idِ ساخته‌شده از ترتیبِ CONDITIONS.
// ⚠️ شرطِ تازه فقط ته اضافه شود؛ وگرنه idِ دکمه‌های شرط‌های قبلی جابه‌جا می‌شود.
const CKEYS = Object.keys(CONDITIONS);
CKEYS.forEach((key, i) => {
  PARAMS.push(
    { id: 100 + i * 3, group: key, path: `strategy.conditions.${key}.weight`, fa: 'وزن', unit: 'امتیاز', step: 5, min: 5, max: 100, hidden: true },
    { id: 101 + i * 3, group: key, path: `strategy.conditions.${key}.enabled`, fa: 'روشن', type: 'bool', hidden: true },
    { id: 102 + i * 3, group: key, path: `strategy.conditions.${key}.required`, fa: 'الزامی', type: 'bool', hidden: true },
  );
});

export const paramById = (id) => PARAMS.find((p) => p.id === Number(id));
export const paramByPath = (path) => PARAMS.find((p) => p.path === path);

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

/** مقدار را تمیز و محدود می‌کند؛ ورودیِ نامعتبر ← خطا با پیامِ فارسی. */
export function coerce(p, raw) {
  if (p.type === 'bool') return typeof raw === 'boolean' ? raw : /^(1|true|on|yes|بله|روشن)$/i.test(String(raw).trim());
  if (p.type === 'list') {
    const arr = String(raw).split(/[,،\s]+/).filter(Boolean).map(Number);
    if (!arr.length || arr.some((x) => !Number.isFinite(x) || x < 0 || x > 5)) throw new Error('فقط عدد بین 0 و 5، جدا با کاما');
    return [...new Set(arr)].sort((a, b) => a - b).slice(0, 5);
  }
  const n = Number(String(raw).replace('/', '.').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (!Number.isFinite(n)) throw new Error('عدد بنویس');
  if (p.type === 'choice') return n;
  if (n < p.min || n > p.max) throw new Error(`باید بین ${p.min} و ${p.max} باشد`);
  const decimals = (String(p.step).split('.')[1] || '').length + 1;
  return Number(n.toFixed(decimals));
}

export function formatValue(p, v) {
  if (p.type === 'bool') return v ? 'بله' : 'نه';
  if (p.type === 'list') return v.join(', ');
  return `${v}${p.unit ? ` ${p.unit}` : ''}`;
}
