/**
 * تنظیمات: پیش‌فرض‌ها از config/default.json، و هر چیزی که ادمین از داخلِ
 * تلگرام عوض کند در data/settings.json روی آن می‌نشیند.
 *
 * ⚠️ فقط کلیدهای «قابلِ تغییر از تلگرام» در settings.json ذخیره می‌شوند، نه
 * کلِ پیکربندی. وگرنه هر تغییری که بعداً در default.json بدهی (مثلاً یک
 * پارامترِ استراتژی) زیرِ یک کپیِ قدیمی دفن می‌شد و هیچ اثری نمی‌کرد.
 *
 * پارامترهای عددی (استراتژی، آستانه، …) به‌شکلِ `overrides` ذخیره می‌شوند:
 * فقط مسیرهایی که ادمین واقعاً عوض کرده، نه کلِ درختِ استراتژی. «بازگشت به
 * پیش‌فرض» یعنی پاک کردنِ همان یک کلید.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getPath, setPath } from './strategy/params.js';

export const ROOT = process.cwd();
const DEFAULTS_PATH = join(ROOT, 'config', 'default.json');
// DATA_DIR روی Railway باید یک Volume باشد — store.js را ببین
let settingsPath = join(process.env.DATA_DIR || join(ROOT, 'data'), 'settings.json');

export const MUTABLE_KEYS = ['watchlist', 'scanEvery', 'directions', 'timeframe', 'overrides', 'admins', 'channel'];
export const TIMEFRAMES = ['1h', '4h', '1d'];
export const SCAN_INTERVALS = { '1h': 1, '4h': 4, '1d': 24 };

export function loadEnv() {
  const p = join(ROOT, '.env');
  if (existsSync(p)) process.loadEnvFile(p);
  // ⚠️ بعد از خواندنِ .env دوباره ساخته می‌شود؛ DATA_DIR ممکن است همان‌جا باشد
  settingsPath = join(process.env.DATA_DIR || join(ROOT, 'data'), 'settings.json');
  return {
    token: process.env.BOT_TOKEN || '',
    adminIds: (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    channelId: process.env.CHANNEL_ID || '',
  };
}

function readJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2));
}

export function loadConfig() {
  const defaults = readJson(DEFAULTS_PATH, null);
  if (!defaults) throw new Error(`config/default.json خوانده نشد: ${DEFAULTS_PATH}`);
  const saved = readJson(settingsPath, {});
  // نسخه‌ی قبلی آستانه را مستقیم ذخیره می‌کرد
  if (saved.alertThreshold !== undefined) {
    saved.overrides = { alertThreshold: saved.alertThreshold, ...saved.overrides };
    delete saved.alertThreshold;
  }
  const cfg = structuredClone(defaults);
  cfg.defaults = defaults;
  cfg.overrides = {};
  for (const k of MUTABLE_KEYS) if (saved[k] !== undefined) cfg[k] = saved[k];
  for (const [path, v] of Object.entries(cfg.overrides)) {
    // مسیری که دیگر در پیش‌فرض‌ها نیست (پارامترِ حذف‌شده) نادیده گرفته می‌شود
    if (getPath(defaults, path) !== undefined) setPath(cfg, path, v);
    else delete cfg.overrides[path];
  }
  return cfg;
}

export function saveSettings(cfg) {
  const out = {};
  for (const k of MUTABLE_KEYS) out[k] = cfg[k];
  writeJson(settingsPath, out);
}

/** یک پارامتر را عوض می‌کند و ذخیره. برابر با پیش‌فرض ← از overrides پاک می‌شود. */
export function setParam(cfg, path, value) {
  setPath(cfg, path, value);
  if (JSON.stringify(getPath(cfg.defaults, path)) === JSON.stringify(value)) delete cfg.overrides[path];
  else cfg.overrides[path] = value;
  saveSettings(cfg);
}

export function resetParams(cfg, prefix = '') {
  for (const path of Object.keys(cfg.overrides)) {
    if (!path.startsWith(prefix)) continue;
    setPath(cfg, path, structuredClone(getPath(cfg.defaults, path)));
    delete cfg.overrides[path];
  }
  saveSettings(cfg);
}

/**
 * «SOLUSDT»، «sol»، «SOL/USDT» یا «BTCUSD» ← یک ردیفِ واچ‌لیست.
 * نگاشتِ اختصاصی (مثل طلا) فقط از default.json می‌آید.
 */
export function parseSymbol(input) {
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const base = raw.replace(/(USDT|USDC|USD|PERP)+$/, '') || raw;
  return { id: raw.endsWith('USD') || raw.endsWith('USDT') ? raw : `${base}USDT`, base };
}
