/**
 * وضعیت جلسه‌ی معاملاتی طلای جهانی (XAUUSD/OANDA).
 *
 * ساعت‌ها بر مبنای نیویورک محاسبه می‌شوند تا تغییر ساعت تابستانی به‌صورت
 * خودکار رعایت شود: بازار از یکشنبه ۱۸:۰۰ تا جمعه ۱۷:۰۰ باز است و هر روز
 * بین ۱۷:۰۰ تا ۱۸:۰۰ وقفه‌ی نگهداری دارد.
 */

const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function newYorkParts(date) {
  const values = {};
  for (const part of nyClock.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    weekday: values.weekday,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function goldMarketStatusAt(date = new Date()) {
  const { weekday, minuteOfDay } = newYorkParts(date);
  const dailyClose = 17 * 60;
  const dailyOpen = 18 * 60;

  let isOpen = false;
  let code = 'WEEKEND';

  if (weekday === 'Sun') {
    isOpen = minuteOfDay >= dailyOpen;
  } else if (weekday === 'Mon' || weekday === 'Tue' || weekday === 'Wed' || weekday === 'Thu') {
    isOpen = minuteOfDay < dailyClose || minuteOfDay >= dailyOpen;
    code = isOpen ? 'OPEN' : 'DAILY_BREAK';
  } else if (weekday === 'Fri') {
    isOpen = minuteOfDay < dailyClose;
  }

  if (isOpen) code = 'OPEN';
  return { isOpen, code };
}

export function isGoldMarketOpenAtUnix(unixSeconds) {
  return goldMarketStatusAt(new Date(Number(unixSeconds) * 1000)).isOpen;
}

export function isFlatCandle(candle) {
  return candle.open === candle.high && candle.high === candle.low && candle.low === candle.close;
}

/** کندل‌های تختی را که هنگام تعطیلی ساخته شده‌اند از نمای زنده حذف می‌کند. */
export function compactClosedMarketCandles(candles) {
  return candles.filter((candle) => !isFlatCandle(candle) || isGoldMarketOpenAtUnix(candle.time));
}
