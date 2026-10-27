/**
 * کانالِ انتشار: تمیز کردنِ مقدارِ CHANNEL_ID و سنجیدنِ دسترسی.
 *
 * «chat not found» تقریباً همیشه یعنی مقدار غلط است، نه دسترسی: یوزرنیمِ
 * بی‌@، شناسه‌ی عددیِ بی‌پیشوندِ -100، یا لینکِ t.me. این‌جا هرچه قابلِ
 * تشخیص است درست می‌شود و بقیه با پیامِ روشن رد.
 */

export function normalizeChannel(raw) {
  let v = String(raw || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!v) return { id: '', error: 'خالی است' };
  const link = v.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/(.+)$/i);
  if (link) {
    const path = link[1].replace(/\/.*$/, '');
    if (path.startsWith('+') || path.toLowerCase() === 'joinchat') {
      return { id: '', error: 'لینکِ دعوتِ کانالِ خصوصی شناسه نیست — یک پست از کانال را برای بات فوروارد کن' };
    }
    if (path.toLowerCase() === 'c') {
      const num = link[1].split('/')[1];
      return num ? { id: `-100${num}` } : { id: '', error: 'لینک ناقص است' };
    }
    v = path;
  }
  if (/^-100\d{6,}$/.test(v)) return { id: v };
  if (/^-?\d{6,}$/.test(v)) return { id: `-100${v.replace(/^-/, '')}` };
  if (/^@?[A-Za-z][\w]{3,}$/.test(v)) return { id: v.startsWith('@') ? v : `@${v}` };
  return { id: '', error: `«${v}» نه یوزرنیمِ کانال است نه شناسه‌ی عددی` };
}

/** آیا بات می‌تواند در این کانال پست بگذارد؟ */
export async function checkChannel(api, chatId, botId) {
  if (!chatId) return { ok: false, error: 'کانال تنظیم نشده' };
  let chat;
  try {
    chat = await api.call('getChat', { chat_id: chatId });
  } catch (e) {
    return {
      ok: false,
      error: /not found/i.test(e.message)
        ? 'بات این کانال را پیدا نمی‌کند — شناسه غلط است، یا بات هنوز عضوِ کانال نشده'
        : e.description || e.message,
    };
  }
  try {
    const m = await api.call('getChatMember', { chat_id: chat.id, user_id: botId });
    if (m.status !== 'administrator' && m.status !== 'creator') {
      return { ok: false, chat, error: 'بات ادمینِ کانال نیست' };
    }
    if (chat.type === 'channel' && m.can_post_messages === false) {
      return { ok: false, chat, error: 'بات ادمین است ولی اجازه‌ی «ارسالِ پیام» ندارد' };
    }
  } catch (e) {
    return { ok: false, chat, error: e.description || e.message };
  }
  return { ok: true, chat };
}
