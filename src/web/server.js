/**
 * Mini App ِ «چارتِ زنده»: صفحه‌ای داخلِ تلگرام که چارتِ یک ارز را با تحلیلِ
 * بات نشان می‌دهد و استراتژی را با اسلایدر، یا با رسمِ خطِ استاد، تنظیم می‌کند.
 *
 * تحلیل در خودِ مرورگر اجرا می‌شود: همان فایل‌های src/strategy (بدونِ هیچ
 * import ِ Node) این‌جا سرو می‌شوند، پس چیزی که صفحه نشان می‌دهد دقیقاً همان
 * چیزی است که اسکن می‌بیند و با هر حرکتِ اسلایدر بی‌درنگ دوباره حساب می‌شود.
 * سرور فقط کندل می‌دهد و ذخیره می‌کند.
 *
 * ورود: هر درخواستِ /api با initData ِ تلگرام امضا شده (HMAC با توکنِ بات) و
 * فقط ادمین‌ها پذیرفته می‌شوند. صفحه بیرون از تلگرام هیچ داده‌ای نمی‌گیرد.
 */

import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCandles, fetchFrom } from '../exchanges/index.js';
import { LTF } from '../scanner.js';
import { setParam } from '../config.js';
import { PARAMS, paramByPath, getPath, coerce } from '../strategy/params.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const STRATEGY = join(HERE, '..', 'strategy');
const AUTH_MAX_AGE = 24 * 3600;
const CANDLE_TTL = 60_000;
const LTF_CANDLES = 300;

/** initData ِ Telegram.WebApp ← کاربر، یا null اگر امضا/زمان نخواند */
export function verifyInitData(initData, token, now = Date.now()) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const sig = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(sig, Buffer.from(hash, 'hex'))) return null;
  const at = Number(params.get('auth_date'));
  if (!(at > 0) || now / 1000 - at > AUTH_MAX_AGE) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

/** همان‌جایی که دکمه‌ی تلگرام باید بازش کند؛ بدونِ دامنه‌ی عمومی ← null */
export function webAppUrl(env = process.env) {
  if (env.WEBAPP_URL) return env.WEBAPP_URL.replace(/\/+$/, '') + '/';
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}/`;
  return null;
}

/** پارامترهایی که صفحه نشان می‌دهد: همه‌ی استراتژی + آستانه */
const EDITABLE = PARAMS.filter((p) => p.path.startsWith('strategy.') || p.path === 'alertThreshold');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function createWebServer({ cfg, token, isAdmin, onSaved = () => {}, log = console }) {
  // فایل‌ها یک بار خوانده می‌شوند؛ فقط همین‌ها سرو می‌شوند (نه هر مسیری)
  const files = new Map();
  for (const f of readdirSync(PUBLIC)) files.set(`/${f}`, join(PUBLIC, f));
  for (const f of readdirSync(STRATEGY).filter((x) => x.endsWith('.js'))) files.set(`/strategy/${f}`, join(STRATEGY, f));
  files.set('/', join(PUBLIC, 'index.html'));

  const cache = new Map(); // base ← { at, data }

  async function candles(base) {
    const hit = cache.get(base);
    if (hit && Date.now() - hit.at < CANDLE_TTL) return hit.data;
    const item = cfg.watchlist.find((w) => w.base === base);
    if (!item) throw Object.assign(new Error('این ارز در واچ‌لیست نیست'), { status: 404 });
    const d = await fetchCandles(item, cfg);
    let ltf = null;
    try {
      ltf = await fetchFrom(d.exchangeKey, d.symbol, LTF, LTF_CANDLES);
    } catch { /* واگراییِ 5 دقیقه در حالتِ اختیاری بدونِ داده کنار می‌رود */ }
    const data = { base, id: item.id, exchange: d.exchange, pretty: d.pretty, timeframe: cfg.timeframe, candles: d.candles, ltf };
    cache.set(base, { at: Date.now(), data });
    return data;
  }

  const values = (src) => Object.fromEntries(EDITABLE.map((p) => [p.path, getPath(src, p.path)]));

  function init(user) {
    return {
      user: { id: user.id, name: user.first_name || user.username || '' },
      watchlist: cfg.watchlist.map((w) => ({ id: w.id, base: w.base })),
      directions: cfg.directions,
      timeframe: cfg.timeframe,
      strategy: cfg.strategy,
      values: values(cfg),
      defaults: values(cfg.defaults),
      paths: EDITABLE.map((p) => p.path),
    };
  }

  function save(user, body) {
    const changes = [];
    const errors = [];
    for (const [path, raw] of Object.entries(body?.values || {})) {
      const p = paramByPath(path);
      if (!p || !EDITABLE.includes(p)) { errors.push(`${path}: ناشناخته`); continue; }
      try {
        const v = coerce(p, raw);
        if (p.type === 'choice' && !p.choices.includes(v)) throw new Error('گزینه‌ی نامعتبر');
        const from = getPath(cfg, path);
        if (JSON.stringify(from) === JSON.stringify(v)) continue;
        setParam(cfg, path, v);
        changes.push({ p, from, to: v });
      } catch (e) {
        errors.push(`${p.fa}: ${e.message}`);
      }
    }
    if (changes.length) {
      log.info(`[web] ${user.id} ${changes.length} تغییر: ${changes.map((c) => c.p.path).join(', ')}`);
      onSaved(user, changes, body?.note || '');
    }
    return { saved: changes.length, errors, values: values(cfg) };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };

    if (!url.pathname.startsWith('/api/')) {
      const f = files.get(url.pathname);
      if (req.method !== 'GET' || !f) return send(404, 'not found', 'text/plain');
      return send(200, readFileSync(f), TYPES[f.slice(f.lastIndexOf('.'))] || 'text/plain');
    }

    const auth = String(req.headers.authorization || '');
    const user = verifyInitData(auth.startsWith('tma ') ? auth.slice(4) : '', token);
    if (!user) return send(401, { error: 'ورود نامعتبر — صفحه را از داخلِ بات باز کن.' });
    if (!isAdmin(user.id)) return send(403, { error: 'فقط ادمین‌های بات.' });

    try {
      if (req.method === 'GET' && url.pathname === '/api/init') return send(200, init(user));
      if (req.method === 'GET' && url.pathname === '/api/candles') return send(200, await candles(url.searchParams.get('base') || ''));
      if (req.method === 'POST' && url.pathname === '/api/save') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 64_000) return send(413, { error: 'خیلی بزرگ' });
        }
        return send(200, save(user, JSON.parse(raw || '{}')));
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      log.error('[web]', e.message);
      return send(e.status || 500, { error: e.message });
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error('[web]', e);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  return {
    server,
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => resolve(server.address().port));
      });
    },
  };
}
