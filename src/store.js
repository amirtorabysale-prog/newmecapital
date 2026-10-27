/**
 * وضعیتِ زمانِ اجرا در data/state.json: هشدارهای در انتظارِ تأیید، کلیدهای
 * فرستاده‌شده (برای cooldown)، و خلاصه‌ی آخرین اسکن.
 *
 * ⚠️ روی Railway دیسک با هر دیپلوی پاک می‌شود. بدونِ Volume، بعد از هر
 * ری‌استارت ستاپی که همین الان هشدارش رفته دوباره هشدار داده می‌شود و دکمه‌های
 * هشدارهای قبلی «منقضی» جواب می‌دهند. DATA_DIR را روی یک Volume بگذار.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from './config.js';

// تابع، نه ثابت: DATA_DIR ممکن است از .env بیاید که بعد از import خوانده می‌شود
export const dataDir = () => process.env.DATA_DIR || join(process.cwd(), 'data');
const statePath = () => join(dataDir(), 'state.json');

let state;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    state = {};
  }
  state.alerts ??= {};
  state.sent ??= {};
  state.updateOffset ??= 0;
  return state;
}

function save() {
  writeJson(statePath(), state);
}

export const store = {
  get: () => load(),
  save,

  onCooldown(key, hours) {
    const t = load().sent[key];
    return t !== undefined && Date.now() - t < hours * 3_600_000;
  },

  markSent(key) {
    const s = load();
    s.sent[key] = Date.now();
    const cutoff = Date.now() - 14 * 86_400_000;
    for (const [k, t] of Object.entries(s.sent)) if (t < cutoff) delete s.sent[k];
    save();
  },

  putAlert(alert) {
    const s = load();
    s.alerts[alert.id] = alert;
    // هشدارهای قدیمی‌تر از یک هفته — هر وضعیتی — دور ریخته می‌شوند
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const [id, a] of Object.entries(s.alerts)) if (a.createdAt < cutoff) delete s.alerts[id];
    save();
  },

  alert: (id) => load().alerts[id],

  updateAlert(id, patch) {
    const a = load().alerts[id];
    if (!a) return null;
    Object.assign(a, patch);
    save();
    return a;
  },
};
