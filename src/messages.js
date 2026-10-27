/**
 * همه‌ی متن‌های فارسیِ بات. ارقام لاتین — قیمت را باید بشود کپی کرد و در
 * صرافی چسباند.
 *
 * ⚠️ کپشنِ عکس در تلگرام حداکثر ۱۰۲۴ کاراکتر است (با احتسابِ تگ‌های HTML
 * نه، ولی با احتسابِ متن). هشدارِ ادمین و پستِ تحلیل هر دو کپشن‌اند.
 */

import { pct, price, utc } from './format.js';
import { TF_MS } from './exchanges/index.js';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TF_FA = { '1h': 'یک‌ساعته', '4h': 'چهارساعته', '1d': 'روزانه' };
const mark = (c) => (c.ok ? '✅' : c.points > 0 ? '🟡' : '❌');

function dirFa(res) {
  return res.direction === 'short' ? 'فروش' : 'خرید';
}

function dateOf(candles, i) {
  return utc(candles[i].t).slice(5);
}

/** خطوطِ «شواهد» — مشترک بین هشدارِ ادمین و پیام‌های دیگر */
export function evidenceLines(res, candles) {
  const c = res.components;
  const P = (v) => price(v, res.close);
  const L = res.line;
  const up = res.direction !== 'short';
  const lines = [];

  lines.push(`${mark(c.trendline)} خط روند ${up ? 'صعودی' : 'نزولی'}: ${L.touches.length} برخوردِ ماژور`
    + ` (${L.touches.map((i) => dateOf(candles, i)).join('، ')})`
    + ` · ${L.state === 'touch' ? 'قیمت روی خط است' : 'قیمت در حالِ نزدیک شدن'} (${L.distAtr.toFixed(2)} ATR)`);

  lines.push(`${mark(c.fib)} فیبو ${res.fib.level} = ${P(res.fib.price)} · فاصله تا خط ${res.fib.distAtr.toFixed(2)} ATR`
    + ` · اصلاحِ فعلی ${(res.fib.retrace * 100).toFixed(1)}٪`);

  lines.push(res.div
    ? `${mark(c.divergence)} واگرایی ${res.div.type === 'hidden' ? 'مخفیِ' : 'معمولیِ'} ${up ? 'مثبت' : 'منفی'} RSI:`
      + ` ${res.div.rsiP.toFixed(1)} ← ${res.div.rsiK.toFixed(1)} (قیمت ${P(res.div.priceP)} ← ${P(res.div.priceK)})`
    : '❌ واگرایی RSI: پیدا نشد');

  lines.push(res.candle
    ? `${mark(c.candle)} الگوی برگشتی: ${res.candle.fa} (${res.candle.name})`
    : `❌ الگوی کندلیِ برگشتی: ${L.state === 'touch' ? 'هنوز تشکیل نشده' : 'قیمت هنوز به خط نرسیده'}`);

  return lines;
}

function planLines(res) {
  const p = res.plan;
  if (!p) return ['هنوز پلنِ ورود ساخته نشده — قیمت باید به خط برسد.'];
  const P = (v) => price(v, res.close);
  const out = [
    `ورود ${P(p.entry)} · حد ضرر ${P(p.sl)} (${pct(p.riskPct)})`,
    p.tps.map((t) => `${t.label} ${P(t.price)} (${t.rr.toFixed(1)}R)`).join(' · '),
  ];
  if (p.rrWarning) out.push('⚠️ ریسک به ریوارد تارگتِ اول زیرِ حداقل است');
  return out;
}

export function adminAlert({ item, data, result: res }, cfg) {
  const last = data.candles.length - 1;
  const closeTime = utc(data.candles[last].t + TF_MS[cfg.timeframe]);
  const kind = res.complete ? 'ستاپِ کامل' : 'نزدیک به ستاپ';
  return [
    `🔔 <b>${kind} ${dirFa(res)} — ${esc(data.pretty)}</b>`,
    `امتیاز <b>${res.score}/${res.maxScore}</b> · ${esc(data.exchange)} · ${cfg.timeframe.toUpperCase()} · ${closeTime} UTC`,
    '',
    '<b>شواهد</b>',
    ...evidenceLines(res, data.candles).map(esc),
    '',
    '<b>پلنِ پیشنهادی</b>',
    ...planLines(res).map(esc),
    '',
    `<i>${esc(item.id)}</i> — تأیید کنی، تحلیل و سیگنال در کانال منتشر می‌شود.`,
  ].join('\n');
}

export function channelAnalysis({ data, result: res }, cfg) {
  const c = data.candles;
  const P = (v) => price(v, res.close);
  const up = res.direction !== 'short';
  const L = res.line;
  const parts = [];

  parts.push(`📊 <b>تحلیل ${esc(data.pretty)} — تایم‌فریم ${TF_FA[cfg.timeframe] || cfg.timeframe}</b>`);
  parts.push('');
  parts.push(`قیمت به خط روندِ ${up ? 'صعودی' : 'نزولی'}ای رسیده که پیش‌تر ${L.touches.length === 2 ? 'دو' : L.touches.length} بار`
    + ` از آن واکنشِ جدی گرفته (${L.touches.map((i) => dateOf(c, i)).join(' و ')}).`);

  if (res.components.fib.points > 0) {
    parts.push(`این ناحیه با سطحِ ${res.fib.level} فیبوناچیِ آخرین موجِ ${up ? 'صعودی' : 'نزولی'}`
      + ` (${P(res.fib.start)} تا ${P(res.fib.end)}) هم‌پوشانی دارد — حوالیِ ${P(res.fib.price)}.`);
  }
  if (res.div) {
    parts.push(res.div.type === 'hidden'
      ? `RSI واگراییِ مخفیِ ${up ? 'مثبت' : 'منفی'} نشان می‌دهد: قیمت کفِ ${up ? 'بالاتر' : 'پایین‌تر'} ساخته ولی RSI ریست شده — نشانه‌ی ادامه‌ی روند.`
      : `RSI واگراییِ ${up ? 'مثبت' : 'منفی'} نشان می‌دهد: قیمت ${up ? 'کفِ پایین‌تر' : 'سقفِ بالاتر'} زده ولی قدرتِ ${up ? 'فروشنده' : 'خریدار'} کم شده.`);
  }
  if (res.candle) parts.push(`روی همین ناحیه کندلِ برگشتیِ «${res.candle.fa}» بسته شده.`);

  parts.push('');
  if (res.plan) {
    parts.push(`تا وقتی کندلِ ${TF_FA[cfg.timeframe] || ''} ${up ? 'زیرِ' : 'بالای'} ${P(res.plan.invalidation)} بسته نشده،`
      + ` سناریوی ${up ? 'صعودی' : 'نزولی'} معتبر است.`);
  }
  parts.push(`<i>داده: ${esc(data.exchange)} · ${esc(data.pretty)}</i>`);
  return parts.join('\n');
}

export function channelSignal({ data, result: res }) {
  const p = res.plan;
  const P = (v) => price(v, res.close);
  const up = res.direction !== 'short';
  return [
    `${up ? '🟢' : '🔴'} <b>سیگنال ${dirFa(res)} | ${esc(data.pretty)}</b>`,
    '',
    `📍 ورود: <code>${P(p.entry)}</code>`,
    `🛑 حد ضرر: <code>${P(p.sl)}</code> (${pct(Math.abs(p.riskPct))})`,
    ...p.tps.map((t, i) => `🎯 تارگت ${i + 1}: <code>${P(t.price)}</code> (R:R ${t.rr.toFixed(1)})`),
    '',
    `❗️ ابطال: بسته شدنِ کندلِ یک‌ساعته ${up ? 'زیرِ' : 'بالای'} <code>${P(p.invalidation)}</code>`,
    '📌 با رسیدن به تارگتِ اول، حد ضرر به نقطه‌ی ورود منتقل شود.',
    '⚖️ ریسکِ هر معامله حداکثر ۱ تا ۲ درصدِ سرمایه. این پیام توصیه‌ی مالی نیست.',
  ].join('\n');
}

export function scanSummary(results, cfg, { manual = false } = {}) {
  const rows = results.map((r) => {
    if (r.error) return `⚠️ ${esc(r.item.id)} — داده نیامد`;
    if (!r.result) return `▫️ ${esc(r.item.id)} — خط روندی نزدیکِ قیمت نیست`;
    const s = r.result.score;
    const flag = s >= cfg.alertThreshold ? '🔔' : s >= cfg.alertThreshold * 0.6 ? '👀' : '▫️';
    return `${flag} ${esc(r.item.id)} — ${s}/${r.result.maxScore} (${esc(r.data.exchange)})`;
  });
  return [`🔎 <b>${manual ? 'اسکنِ دستی' : 'اسکن'}</b> · ${utc(Date.now())} UTC · آستانه ${cfg.alertThreshold}`, '', ...rows].join('\n');
}

export const HELP = [
  '<b>دستورها</b>',
  '/list — واچ‌لیست و تنظیمات',
  '/add SOL — افزودنِ ارز',
  '/remove SOL — حذفِ ارز',
  '/every 4h — فاصله‌ی اسکن: 1h یا 4h یا 1d',
  '/threshold 70 — حداقلِ امتیاز برای هشدار',
  '/direction long — جهت: long یا short یا both',
  '/scan — اسکنِ فوری کلِ واچ‌لیست',
  '/scan SOL — اسکن و تصویرِ یک ارز، حتی زیرِ آستانه',
  '/status — آخرین اسکن و اسکنِ بعدی',
  '/id — شناسه‌ی عددیِ تو',
].join('\n');
