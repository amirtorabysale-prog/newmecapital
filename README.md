# 🤖 بات تلگرامی رصد واچ‌لیست ال‌بانک — نسخه ۱ (اسکلت)

باتی که واچ‌لیست کوین‌های شما را هر بازه‌ی زمانی مشخص روی **LBank** رصد می‌کند و وقتی استراتژی روی یکی از آن‌ها برقرار شود، **الارم فارسی** به تلگرام می‌فرستد.

> ⚠️ فعلاً یک **استراتژی نمونه‌ی ساده (RSI)** داخلش گذاشته شده تا بات از روز اول کار کند.
> استراتژی کامل شما (خط روند، برخورد سوم، همپوشانی حمایت و ...) بعداً در `strategy.py` جایگزین می‌شود.

---

## 📁 ساختار پروژه

| فایل | نقش |
|---|---|
| `bot.py` | ورودی اصلی — دستورات تلگرام + حلقه‌ی رصد زمان‌بندی‌شده |
| `lbank_api.py` | ارتباط با API عمومی ال‌بانک (تیکر + کندل) |
| `strategy.py` | ⛔ جای استراتژی شما (فعلاً RSI نمونه) + قالب پیام سیگنال |
| `storage.py` | ذخیره‌ی واچ‌لیست/تنظیمات (JSON) |
| `railway.json` | دستور اجرا روی Railway |
| `.env.example` | لیست متغیرهای محیطی |

---

## 🚀 راه‌اندازی روی Railway — قدم به قدم

### قدم ۱: ساخت بات تلگرام
1. در تلگرام به **@BotFather** پیام دهید
2. دستور `/newbot` را بزنید و یک نام بدهید
3. توکن را کپی کنید (شبیه `123456789:AA...`)

### قدم ۲: گرفتن Chat ID خودتان
- به **@userinfobot** پیام دهید → آی‌دی عددی شما را نشان می‌دهد

### قدم ۳: آپلود کد روی GitHub
1. یک ریپازیتوری جدید در GitHub بسازید (مثلاً `lbank-telegram-bot`)
2. محتوای این پوشه را آپلود کنید:
```bash
git init
git add .
git commit -m "LBank watchlist bot v1"
git remote add origin https://github.com/USERNAME/lbank-telegram-bot.git
git push -u origin main
```

### قدم ۴: دیپلوی در Railway
1. وارد [railway.app](https://railway.app) شوید → **New Project** → **Deploy from GitHub repo** → ریپو را انتخاب کنید
2. روی سرویس کلیک کنید → تب **Variables** → این متغیرها را بسازید:

   | Variable | Value |
   |---|---|
   | `BOT_TOKEN` | توکن BotFather (الزامی) |
   | `ALERT_CHAT_ID` | آی‌دی عددی خودتان (اختیاری) |
   | `ADMIN_IDS` | آی‌دی خودتان (اختیاری — برای محدود کردن دستورات) |
   | `CHECK_INTERVAL_MIN` | `60` (اختیاری) |
   | `TIMEFRAME` | `day1` (اختیاری) |

3. تب **Settings** → **Deploy** → مطمئن شوید Start Command روی `python bot.py` است (فایل `railway.json` خودش این کار را می‌کند)
4. بعد از Deploy، تب **Deployments** → **Deploy Logs** را باز کنید؛ باید ببینید:
   ```
   Bot started. watchlist=[] tf=day1 interval=60min ...
   starting polling ...
   ```
5. در تلگرام به بات `/start` بدهید ✅

### قدم ۵ (مهم): ماندگاری واچ‌لیست
فایل‌سیستم Railway هر بار که دوباره دیپلوی کنید **پاک می‌شود**. برای اینکه واچ‌لیست و تنظیمات نپرند:
1. روی سرویس → تب **Settings** → بخش **Volumes** → **+ New Volume**
2. **Mount Path** را بگذارید: `/data`
3. دیپلوی مجدد — بات به‌طور خودکار از `/data` استفاده می‌کند

> اگر Volume نسازید، بات هم کار می‌کند؛ فقط بعد از هر دیپلوی باید واچ‌لیست را دوباره با `/add` بسازید.

---

## 💬 دستورات بات

| دستور | کار |
|---|---|
| `/start` | فعال‌سازی + ثبت چت مقصد الارم‌ها |
| `/add FET` | افزودن ارز (نام ساده کافی است؛ خودش `fet_usdt` می‌سازد) |
| `/remove FET` | حذف ارز |
| `/list` | واچ‌لیست با قیمت لحظه‌ای و درصد تغییر |
| `/price FET` | قیمت، سقف/کف و حجم ۲۴ ساعته |
| `/analyze FET` | اجرای فوری استراتژی روی یک ارز |
| `/check` | اجرای فوری چک روی کل واچ‌لیست |
| `/interval 30` | تغییر فاصله‌ی رصد (حداقل ۵ دقیقه) |
| `/tf hour4` | تغییر تایم‌فریم (`minute15` تا `week1`) |
| `/status` | وضعیت بات + زمان اجرای بعدی |

---

## 🔁 بعداً: جایگزینی استراتژی
فایل `strategy.py` → تابع `evaluate()`:
```python
def evaluate(symbol_display, candles, ticker) -> list[Signal]:
    # candles: کندل‌های OHLCV  [{time, open, high, low, close, volume}, ...]
    # برگردانید: لیست Signal(key=..., direction="BUY"/"SELL", title=..., reasons=[...])
```
هر چیزی که برگردد، بات خودش قالب پیام فارسی می‌سازد و (با رعایت Cooldown) می‌فرستد.

## 🧪 اجرای محلی (اختیاری)
```bash
pip install -r requirements.txt
export BOT_TOKEN="توکن شما"
python bot.py
```
