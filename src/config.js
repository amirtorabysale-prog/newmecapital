/**
 * تنظیمات: پیش‌فرض‌ها از config/default.json، و هر چیزی که ادمین از داخلِ
 * تلگرام عوض کند در data/settings.json روی آن می‌نشیند.
 *
 * ⚠️ فقط کلیدهای «قابلِ تغییر از تلگرام» در settings.json ذخیره می‌شوند، نه
 * کلِ پیکربندی. وگرنه هر تغییری که بعداً در default.json بدهی (مثلاً یک
 * پارامترِ استراتژی) زیرِ یک کپیِ قدیمی دفن می‌شد و هیچ اثری نمی‌کرد.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ROOT = process.cwd();
const DEFAULTS_PATH = join(ROOT, 'config', 'default.json');
// DATA_DIR روی Railway باید یک Volume باشد — store.js را ببین
let settingsPath = join(process.env.DATA_DIR || join(ROOT, 'data'), 'settings.json');

export const MUTABLE_KEYS = ['watchlist', 'scanEvery', 'alertThreshold', 'directions'];
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
  const cfg = structuredClone(defaults);
  for (const k of MUTABLE_KEYS) if (saved[k] !== undefined) cfg[k] = saved[k];
  return cfg;
}

export function saveSettings(cfg) {
  const out = {};
  for (const k of MUTABLE_KEYS) out[k] = cfg[k];
  writeJson(settingsPath, out);
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
