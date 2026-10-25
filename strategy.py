"""
Strategy engine — v1 PLACEHOLDER

⛔ این فایل بعداً کامل عوض می‌شود.
 الان یک استراتژی ساده‌ی نمونه (RSI) داخلش گذاشته شده تا بات از روز اول
 کار کند و شکل سیگنال/پیام مشخص باشد. وقتی استراتژی کامل خودت را دادی،
 فقط تابع evaluate() را بازنویسی می‌کنیم — بقیه‌ی بات دست‌نخورده می‌ماند.

Interface contract:
    evaluate(symbol_display, candles, ticker) -> list[Signal]

    Signal fields:
      key       : شناسه‌ی یکتای سیگنال (برای جلوگیری از الارم تکراری)
      direction : "BUY" | "SELL" | "INFO"
      title     : عنوان کوتاه
      reasons   : لیست رشته‌ها — دلایل/شرایط برقرار شده
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Signal:
    key: str
    direction: str          # BUY | SELL | INFO
    title: str
    reasons: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------- #
#  Indicators (minimal, dependency-free)
# ---------------------------------------------------------------------- #
def rsi_wilder(closes: list[float], period: int = 14) -> Optional[float]:
    """Classic Wilder RSI. Returns None if not enough data."""
    if len(closes) < period + 1:
        return None
    gains, losses = 0.0, 0.0
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def ema(values: list[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    k = 2.0 / (period + 1)
    e = sum(values[:period]) / period
    for v in values[period:]:
        e = v * k + e * (1 - k)
    return e


# ---------------------------------------------------------------------- #
#  ⚠️ PLACEHOLDER STRATEGY — replace evaluate() with the real one later
# ---------------------------------------------------------------------- #
def evaluate(symbol_display: str, candles: list[dict], ticker: Optional[dict] = None) -> list[Signal]:
    """
    Demo strategy v1:
      * RSI(14) < 30  -> BUY  signal  (oversold)
      * RSI(14) > 70  -> SELL signal  (overbought)
    Later: خط روند + برخورد سوم + همپوشانی حمایت (استراتژی شما)
    """
    closes = [c["close"] for c in candles]
    if len(closes) < 25:
        return []

    price = closes[-1]
    r = rsi_wilder(closes, 14)
    signals: list[Signal] = []

    if r is not None and r < 30:
        signals.append(
            Signal(
                key="rsi_oversold",
                direction="BUY",
                title=f"{symbol_display} | RSI در اشباع فروش",
                reasons=[
                    f"RSI(14): {r:.1f} — زیر سطح ۳۰",
                    f"قیمت بسته‌شدن آخرین کندل: {price:g} $",
                ],
            )
        )
    elif r is not None and r > 70:
        signals.append(
            Signal(
                key="rsi_overbought",
                direction="SELL",
                title=f"{symbol_display} | RSI در اشباع خرید",
                reasons=[
                    f"RSI(14): {r:.1f} — بالای سطح ۷۰",
                    f"قیمت بسته‌شدن آخرین کندل: {price:g} $",
                ],
            )
        )

    return signals


# ---------------------------------------------------------------------- #
#  Message template — same structure as the sample Telegram post
# ---------------------------------------------------------------------- #
DIR_EMOJI = {"BUY": "🟢", "SELL": "🔴", "INFO": "ℹ️"}
TF_FA = {
    "minute5": "۵ دقیقه",
    "minute15": "۱۵ دقیقه",
    "minute30": "۳۰ دقیقه",
    "hour1": "۱ ساعته",
    "hour4": "۴ ساعته",
    "hour8": "۸ ساعته",
    "day1": "روزانه",
    "week1": "هفتگی",
}


def format_signal(sig: Signal, ticker: Optional[dict], tf: str, time_fa: str) -> str:
    change_line = ""
    price_line = ""
    if ticker:
        price_line = f"▫️ قیمت فعلی: {ticker['latest']:g} $\n"
        change_line = f"▫️ تغییر ۲۴ ساعته: {ticker['change']:+g} %\n"
    tf_fa = TF_FA.get(tf, tf)
    reasons = "\n".join(f"• {r}" for r in sig.reasons)
    return (
        f"{DIR_EMOJI.get(sig.direction, 'ℹ️')} سیگنال | {sig.title} ({tf_fa})\n\n"
        f"▫️ صرافی: LBank\n"
        f"{price_line}"
        f"{change_line}"
        f"▫️ زمان: {time_fa} (تهران)\n\n"
        f"🔍 دلیل سیگنال:\n{reasons}"
    )
