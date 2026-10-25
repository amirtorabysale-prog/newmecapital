"""
LBank Watchlist Telegram Bot — v1 (scaffold)

چه کار می‌کند:
  * واچ‌لیست کوین‌های ال‌بانک (افزودن/حذف/مشاهده با دستورات تلگرام)
  * رصد دوره‌ای (فاصله قابل تنظیم) + اجرای استراتژی placeholder روی کندل‌ها
  * ارسال الارم فارسی (قالب شبیه پست نمونه‌ی شما) هنگام برقراری سیگنال
  * جلوگیری از اسپم با Cooldown برای هر (کوین، نوع سیگنال)

Railway deployment:
  * start command:  python bot.py   (railway.json داخل پروژه هست)
  * env vars: BOT_TOKEN (الزامی) + اختیاری‌ها در .env.example
  * برای ماندگاری واچ‌لیست: Volume با mount path = /data
"""

import asyncio
import logging
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

from lbank_api import LBankClient, LBankError, TF_SECONDS
from strategy import evaluate, format_signal, Signal
from storage import Storage

# ------------------------------------------------------------------ #
#  Config (environment variables)
# ------------------------------------------------------------------ #
BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
ENV_ALERT_CHAT_ID = os.environ.get("ALERT_CHAT_ID", "").strip()
DEFAULT_INTERVAL_MIN = int(os.environ.get("CHECK_INTERVAL_MIN", "60"))
DEFAULT_TIMEFRAME = os.environ.get("TIMEFRAME", "day1")
KLINE_LIMIT = int(os.environ.get("KLINE_LIMIT", "200"))
COOLDOWN_HOURS = float(os.environ.get("COOLDOWN_HOURS", "12"))
TIMEZONE = os.environ.get("TIMEZONE", "Asia/Tehran")
MAX_WATCHLIST = int(os.environ.get("MAX_WATCHLIST", "30"))
ADMIN_IDS = {
    int(x) for x in os.environ.get("ADMIN_IDS", "").replace(" ", "").split(",") if x
}

_data_dir = os.environ.get("DATA_DIR", "")
if not _data_dir:
    _data_dir = "/data" if os.path.isdir("/data") else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

TZ = ZoneInfo(TIMEZONE)
log = logging.getLogger("lbank-bot")

storage = Storage(_data_dir, defaults={
    "watchlist": [],
    "cooldowns": {},
    "alert_chat_id": int(ENV_ALERT_CHAT_ID) if ENV_ALERT_CHAT_ID.isdigit() else None,
    "interval_min": DEFAULT_INTERVAL_MIN,
    "timeframe": DEFAULT_TIMEFRAME,
})
lbank = LBankClient()
START_TIME = time.time()

# ------------------------------------------------------------------ #
#  Helpers
# ------------------------------------------------------------------ #
def now_fa() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d %H:%M")


def normalize_symbol(raw: str) -> str:
    """'FET' -> 'fet_usdt' ; 'fet/usdt' -> 'fet_usdt'"""
    s = raw.strip().lower().replace("/", "_").replace("-", "_")
    if "_" not in s:
        s = f"{s}_usdt"
    return s


def display_symbol(sym: str) -> str:
    base, _, quote = sym.partition("_")
    return f"{base.upper()}/{quote.upper()}"


def is_admin(update: Update) -> bool:
    if not ADMIN_IDS:  # no admins configured -> everyone (single-user setup)
        return True
    user = update.effective_user
    return bool(user and user.id in ADMIN_IDS)


async def reply(update: Update, text: str) -> None:
    if update.effective_chat:
        await update.effective_chat.send_message(text)


# ------------------------------------------------------------------ #
#  Core check loop
# ------------------------------------------------------------------ #
async def run_check(app: Application, manual: bool = False, target_chat_id: int | None = None) -> str:
    """Check every watchlist coin against the strategy. Returns a short summary."""
    wl = storage.watchlist
    tf = storage.timeframe
    chat_id = target_chat_id or storage.alert_chat_id
    fired, errors = 0, 0

    if not wl:
        if manual:
            await _send(app, chat_id, "واچ‌لیست خالی است. با دستور /add نام ارز اضافه کنید. مثال:  /add FET")
        return "empty"

    for sym in wl:
        try:
            candles = await lbank.klines(sym, tf, KLINE_LIMIT)
            tick = await lbank.ticker(sym)
            signals = evaluate(display_symbol(sym), candles, tick)
            for sig in signals:
                if not manual and storage.on_cooldown(sym, sig.key, COOLDOWN_HOURS):
                    continue
                storage.mark_signal(sym, sig.key)
                fired += 1
                msg = format_signal(sig, tick, tf, now_fa())
                await _send(app, chat_id if not manual else (target_chat_id or chat_id), msg)
        except LBankError as exc:
            errors += 1
            log.warning("check failed for %s: %s", sym, exc)
        except Exception:
            errors += 1
            log.exception("unexpected error while checking %s", sym)
        await asyncio.sleep(0.35)  # be gentle with the public API

    return f"fired={fired} errors={errors}"


async def _send(app: Application, chat_id: int | None, text: str) -> None:
    if not chat_id:
        log.warning("no alert chat id set yet — /start the bot first. Message skipped:\n%s", text)
        return
    try:
        await app.bot.send_message(chat_id, text)
    except Exception:
        log.exception("failed to send message to %s", chat_id)


async def check_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    result = await run_check(context.application, manual=False)
    log.info("scheduled check done: %s", result)


# ------------------------------------------------------------------ #
#  Telegram commands
# ------------------------------------------------------------------ #
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    storage.set_alert_chat(update.effective_chat.id)
    await reply(update, (
        "سلام! 👋 بات رصد واچ‌لیست ال‌بانک فعال شد.\n\n"
        "دستورات:\n"
        "/add FET — افزودن ارز به واچ‌لیست\n"
        "/remove FET — حذف ارز\n"
        "/list — نمایش واچ‌لیست با قیمت لحظه‌ای\n"
        "/price FET — قیمت لحظه‌ای یک ارز\n"
        "/analyze FET — اجرای فوری استراتژی روی یک ارز\n"
        "/check — اجرای فوری چک روی کل واچ‌لیست\n"
        "/interval 60 — فاصله‌ی رصد (دقیقه)\n"
        "/tf day1 — تایم‌فریم رصد (minute15 / hour1 / hour4 / day1 ...)\n"
        "/status — وضعیت بات\n\n"
        f"تنظیم فعلی: تایم‌فریم {storage.timeframe} | فاصله {storage.interval_min} دقیقه"
    ))


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await cmd_start(update, context)


async def cmd_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update):
        return
    if not context.args:
        await reply(update, "نماد را بنویسید. مثال:  /add FET")
        return
    raw = " ".join(context.args)
    sym = normalize_symbol(raw)
    if len(storage.watchlist) >= MAX_WATCHLIST:
        await reply(update, f"واچ‌لیست پر است (حداکثر {MAX_WATCHLIST} ارز).")
        return
    await reply(update, f"در حال بررسی {display_symbol(sym)} روی LBank ...")
    try:
        if not await lbank.validate_symbol(sym):
            await reply(update, f"❌ جفت‌ارز {display_symbol(sym)} روی ال‌بانک پیدا نشد.")
            return
        if storage.add_symbol(sym):
            tick = await lbank.ticker(sym)
            await reply(update, f"✅ {display_symbol(sym)} به واچ‌لیست اضافه شد. (قیمت فعلی {tick['latest']:g} $)")
        else:
            await reply(update, f"{display_symbol(sym)} قبلاً در واچ‌لیست بود.")
    except LBankError as exc:
        await reply(update, f"خطا در ارتباط با ال‌بانک: {exc}")


async def cmd_remove(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update):
        return
    if not context.args:
        await reply(update, "نماد را بنویسید. مثال:  /remove FET")
        return
    sym = normalize_symbol(" ".join(context.args))
    if storage.remove_symbol(sym):
        await reply(update, f"🗑 {display_symbol(sym)} از واچ‌لیست حذف شد.")
    else:
        await reply(update, f"{display_symbol(sym)} در واچ‌لیست نبود.")


async def cmd_list(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    wl = storage.watchlist
    if not wl:
        await reply(update, "واچ‌لیست خالی است. با /add اضافه کنید.")
        return
    lines = ["📋 واچ‌لیست (LBank):"]
    for sym in wl:
        try:
            t = await lbank.ticker(sym)
            lines.append(f"• {display_symbol(sym)} — {t['latest']:g} $ ({t['change']:+g}%)")
        except LBankError:
            lines.append(f"• {display_symbol(sym)} — ⚠️ خطا در دریافت قیمت")
        await asyncio.sleep(0.25)
    await reply(update, "\n".join(lines))


async def cmd_price(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await reply(update, "نماد را بنویسید. مثال:  /price FET")
        return
    sym = normalize_symbol(" ".join(context.args))
    try:
        t = await lbank.ticker(sym)
        await reply(update, (
            f"💱 {display_symbol(sym)} | LBank\n"
            f"▫️ قیمت: {t['latest']:g} $\n"
            f"▫️ تغییر ۲۴ساعته: {t['change']:+g} %\n"
            f"▫️ سقف/کف ۲۴ساعته: {t['high']:g} / {t['low']:g} $\n"
            f"▫️ حجم ۲۴ساعته: {t['turnover']:,.0f} $"
        ))
    except LBankError as exc:
        await reply(update, f"❌ {exc}")


async def cmd_analyze(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await reply(update, "نماد را بنویسید. مثال:  /analyze FET")
        return
    sym = normalize_symbol(" ".join(context.args))
    tf = storage.timeframe
    await reply(update, f"در حال تحلیل {display_symbol(sym)} (تایم‌فریم {tf}) ...")
    try:
        candles = await lbank.klines(sym, tf, KLINE_LIMIT)
        tick = await lbank.ticker(sym)
        signals = evaluate(display_symbol(sym), candles, tick)
        if not signals:
            await reply(update, f"ℹ️ در حال حاضر سیگنالی برای {display_symbol(sym)} طبق استراتژی فعلی وجود ندارد.")
        for sig in signals:
            await reply(update, format_signal(sig, tick, tf, now_fa()))
    except LBankError as exc:
        await reply(update, f"❌ {exc}")


async def cmd_check(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await reply(update, "🔎 در حال چک کردن کل واچ‌لیست ...")
    await run_check(context.application, manual=True, target_chat_id=update.effective_chat.id)


async def cmd_interval(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update):
        return
    if not context.args or not context.args[0].isdigit():
        await reply(update, "فاصله را به دقیقه بنویسید. مثال:  /interval 30")
        return
    minutes = max(5, min(1440, int(context.args[0])))
    storage.set_interval(minutes)
    jq = context.job_queue
    for job in jq.get_jobs_by_name("check"):
        job.schedule_removal()
    jq.run_repeating(check_job, interval=minutes * 60, first=10, name="check")
    await reply(update, f"⏱ فاصله‌ی رصد روی هر {minutes} دقیقه تنظیم شد.")


async def cmd_tf(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update):
        return
    if not context.args or context.args[0] not in TF_SECONDS:
        await reply(update, f"تایم‌فریم معتبر بنویسید: {', '.join(TF_SECONDS)}")
        return
    storage.set_timeframe(context.args[0])
    await reply(update, f"📅 تایم‌فریم رصد روی {context.args[0]} تنظیم شد.")


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    job = context.job_queue.get_jobs_by_name("check")
    nxt = ""
    if job:
        nxt = f"\n▫️ اجرای بعدی: {job[0].next_t.astimezone(TZ).strftime('%H:%M:%S')}"
    uptime_min = int((time.time() - START_TIME) / 60)
    await reply(update, (
        "🤖 وضعیت بات:\n"
        f"▫️ تعداد ارزهای واچ‌لیست: {len(storage.watchlist)}\n"
        f"▫️ تایم‌فریم: {storage.timeframe}\n"
        f"▫️ فاصله‌ی رصد: {storage.interval_min} دقیقه{nxt}\n"
        f"▫️ Cooldown الارم: {COOLDOWN_HOURS:g} ساعت\n"
        f"▫️ مدت فعالیت: {uptime_min} دقیقه\n"
        f"▫️ زمان سرور: {now_fa()} (تهران)"
    ))


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.error("telegram error: %s", context.error)


# ------------------------------------------------------------------ #
#  Startup
# ------------------------------------------------------------------ #
async def post_init(app: Application) -> None:
    minutes = storage.interval_min
    app.job_queue.run_repeating(check_job, interval=minutes * 60, first=15, name="check")
    log.info("Bot started. watchlist=%s tf=%s interval=%smin data_dir=%s",
             storage.watchlist, storage.timeframe, minutes, _data_dir)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    )
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN environment variable is missing!")

    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("add", cmd_add))
    app.add_handler(CommandHandler("remove", cmd_remove))
    app.add_handler(CommandHandler("list", cmd_list))
    app.add_handler(CommandHandler("price", cmd_price))
    app.add_handler(CommandHandler("analyze", cmd_analyze))
    app.add_handler(CommandHandler("check", cmd_check))
    app.add_handler(CommandHandler("interval", cmd_interval))
    app.add_handler(CommandHandler("tf", cmd_tf))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_error_handler(on_error)

    log.info("starting polling ...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
