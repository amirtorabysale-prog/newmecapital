/**
 * تماسِ خام با Bot API تلگرام — بدونِ کتابخانه.
 *
 * الگو از گلدمی (`server/services/notify/telegramBot.js`) آمده، با دو فرق:
 * عکس با multipart فرستاده می‌شود، و خطا پرت می‌شود. این‌جا تلگرام خودِ
 * محصول است نه یک اعلانِ جانبی؛ انتشارِ ناموفق در کانال باید دیده شود.
 */

const API = 'https://api.telegram.org';

export class TelegramError extends Error {
  constructor(method, description, code) {
    super(`${method}: ${description}`);
    this.code = code;
    this.description = description;
  }
}

export function createApi(token) {
  async function call(method, payload = {}, { timeout = 30_000 } = {}) {
    let body;
    let headers;
    if (payload.photo instanceof Buffer) {
      // عکس → multipart. بقیه‌ی فیلدها رشته یا JSON
      body = new FormData();
      for (const [k, v] of Object.entries(payload)) {
        if (v === undefined) continue;
        if (k === 'photo') body.append('photo', new Blob([v], { type: 'image/png' }), 'chart.png');
        else body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    } else {
      body = JSON.stringify(payload);
      headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST', body, headers, signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new TelegramError(method, data.description || `HTTP ${res.status}`, data.error_code || res.status);
    return data.result;
  }

  const kb = (rows) => (rows ? { inline_keyboard: rows } : undefined);

  return {
    call,
    getMe: () => call('getMe'),
    getUpdates: (offset, timeout = 50) => call('getUpdates',
      { offset, timeout, allowed_updates: ['message', 'callback_query'] },
      { timeout: (timeout + 15) * 1000 }),
    deleteWebhook: () => call('deleteWebhook', { drop_pending_updates: false }),
    sendMessage: (chatId, text, { buttons, replyTo } = {}) => call('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_markup: kb(buttons), reply_parameters: replyTo ? { message_id: replyTo } : undefined,
    }),
    sendPhoto: (chatId, photo, caption, { buttons } = {}) => call('sendPhoto', {
      chat_id: chatId, photo, caption, parse_mode: 'HTML', reply_markup: kb(buttons),
    }, { timeout: 60_000 }),
    editCaption: (chatId, messageId, caption, buttons) => call('editMessageCaption', {
      chat_id: chatId, message_id: messageId, caption, parse_mode: 'HTML', reply_markup: kb(buttons || []),
    }),
    answer: (id, text, alert = false) => call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }),
    setCommands: (commands) => call('setMyCommands', { commands }),
  };
}
