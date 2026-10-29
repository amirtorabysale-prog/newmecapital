/**
 * رسم‌های آزادِ استاد، برای هر ارز، در data/drawings.json (همان Volume ِ
 * state.json). مینی‌اپ می‌نویسد، تماشای بات (bot.js ← runWatch) می‌خواند.
 *
 * هر ارز کلِ فهرستش را یک‌جا می‌فرستد و جایگزین می‌شود — ساده‌تر از
 * افزودن/حذفِ تکی، و با ۴۰ رسم در هر ارز حجمش ناچیز است.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from './config.js';
import { dataDir } from './store.js';
import { cleanDrawing, MAX_DRAWINGS } from './strategy/watch.js';

const path = () => join(dataDir(), 'drawings.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(path(), 'utf8'));
  } catch {
    cache = {};
  }
  cache.coins ??= {};
  return cache;
}

export const drawings = {
  all: () => load().coins,
  of: (base) => load().coins[base] || [],

  /** فهرستِ تازه‌ی یک ارز؛ رسمِ نامعتبر کلِ درخواست را رد می‌کند */
  put(base, list) {
    if (!Array.isArray(list)) throw Object.assign(new Error('فهرستِ رسم لازم است'), { status: 400 });
    if (list.length > MAX_DRAWINGS) throw Object.assign(new Error(`حداکثر ${MAX_DRAWINGS} رسم برای هر ارز`), { status: 400 });
    let clean;
    try {
      clean = list.map(cleanDrawing);
    } catch (e) {
      throw Object.assign(e, { status: 400 });
    }
    const s = load();
    // وضعیتِ تماشا (آخرین هشدار) مالِ سرور است و از مینی‌اپ نمی‌آید
    const old = new Map((s.coins[base] || []).map((d) => [d.id, d]));
    for (const d of clean) if (old.get(d.id)?.alerted) d.alerted = old.get(d.id).alerted;
    if (clean.length) s.coins[base] = clean;
    else delete s.coins[base];
    writeJson(path(), s);
    return clean;
  },

  /** آخرین کندلی که برای هر سطحِ رسم هشدار داده شد — تا یک برخورد دو بار خبر نشود */
  markAlerted(base, id, key, t) {
    const d = this.of(base).find((x) => x.id === id);
    if (!d) return;
    d.alerted = { ...d.alerted, [key]: t };
    writeJson(path(), load());
  },

  // تست
  _reset() {
    cache = null;
  },
};
