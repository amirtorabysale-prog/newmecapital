/**
 * نقطه‌ی ورود. هر کمبودی در تنظیمات همین‌جا با یک پیامِ روشن متوقف می‌شود —
 * نه یک stack trace وسطِ لاگِ Railway، و نه یک باتِ روشن که بی‌صدا هیچ کاری
 * نمی‌کند.
 */

import { loadConfig, loadEnv } from './config.js';
import { createApi } from './telegram/api.js';
import { createBot } from './telegram/bot.js';
import { checkFonts } from './chart/render.js';
import { createWebServer, webAppUrl } from './web/server.js';

const env = loadEnv();
const problems = [];
if (!/^\d+:[\w-]{30,}$/.test(env.token)) problems.push('BOT_TOKEN خالی یا نامعتبر است (از @BotFather).');
if (!env.adminIds.length) problems.push('ADMIN_IDS خالی است — بدونِ ادمین هیچ هشداری به کسی نمی‌رسد.');
if (env.adminIds.some((id) => !/^-?\d+$/.test(id))) problems.push('ADMIN_IDS باید شناسه‌ی عددی باشد، نه یوزرنیم.');
if (!env.channelId) console.warn('⚠️ CHANNEL_ID خالی است — از پنل: تنظیمات ← کانال، با فورواردِ یک پست.');

if (problems.length) {
  console.error('❌ بات بالا نیامد:\n  - ' + problems.join('\n  - '));
  // ⚠️ exit با کدِ صفر نه: Railway باید سرویس را «ناموفق» نشان بدهد.
  process.exit(1);
}

const cfg = loadConfig();

// فونت را همین اول امتحان کن، نه سرِ اولین هشدار ساعت‌ها بعد
try {
  checkFonts();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const bot = createBot({ api: createApi(env.token), env, cfg });

// چارتِ زنده (Mini App). Railway پورت را در PORT می‌دهد؛ دکمه‌ی تلگرام فقط
// وقتی ظاهر می‌شود که دامنه‌ی عمومی باشد (Settings ← Networking ← Generate Domain).
const web = createWebServer({ cfg, token: env.token, isAdmin: bot.isAdmin, onSaved: bot.onWebSave });
web.listen(Number(process.env.PORT) || 8080)
  .then((port) => console.log(`[web] چارتِ زنده روی پورتِ ${port} · ${webAppUrl() || 'بدونِ دامنه‌ی عمومی — دکمه پنهان است'}`))
  .catch((e) => console.error('[web] بالا نیامد:', e.message));

bot.start().catch((e) => {
  console.error('❌ اتصال به تلگرام ناموفق:', e.message);
  process.exit(1);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[bot] ${sig} — خاموش می‌شود`);
    process.exit(0);
  });
}
