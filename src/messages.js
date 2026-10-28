/**
 * همه‌ی متن‌های فارسیِ بات. ارقام لاتین — قیمت را باید بشود کپی کرد و در
 * صرافی چسباند.
 *
 * ⚠️ کپشنِ عکس در تلگرام حداکثر ۱۰۲۴ کاراکتر است و متنِ پیام ۴۰۹۶.
 */

import { pct, price, utc } from './format.js';
import { TF_MS } from './exchanges/index.js';
import { CONDITIONS } from './strategy/params.js';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const TF_FA = { '1h': 'یک‌ساعته', '4h': 'چهارساعته', '1d': 'روزانه' };
const mark = (c) => (c.ok ? '✅' : c.points > 0 ? '🟡' : '❌');

const dirFa = (res) => (res.direction === 'short' ? 'فروش' : 'خرید');
const dateOf = (candles, i) => utc(candles[i].t).slice(5);

/** یک خط برای هر شرطِ روشن — چه دید و چرا امتیاز گرفت یا نگرفت */
export function evidenceLines(res, candles, cfg) {
  const c = res.components;
  const P = (v) => price(v, res.close);
  const L = res.line;
  const up = res.direction !== 'short';
  const out = [];
  const tag = (key) => `${c[key].required ? ' (الزامی)' : ''}`;
  const Z = cfg.strategy.rsiZone;
  // واگرایی‌ای که RSI اش به اشباع نرسیده هم «پیدا نشد» است — دلیلش گفته شود
  const zoneFa = Z?.enabled ? ` (با RSI ${up ? `زیرِ ${Z.low}` : `بالای ${Z.high}`})` : '';

  if (c.trendline.enabled) {
    const where = L.state === 'touch' ? 'قیمت روی خط است'
      : L.state === 'approach' ? 'قیمت دارد به خط نزدیک می‌شود'
        : 'قیمت از خط دور است';
    out.push(`${mark(c.trendline)} خط روند ${up ? 'صعودی' : 'نزولی'}: ${L.touches.length} برخوردِ ماژور`
      + ` (${L.touches.map((i) => dateOf(candles, i)).join('، ')}) · ${where}`
      + ` — فاصله ${L.distAtr.toFixed(2)} ATR، خط حوالیِ ${P(L.priceNow)}`);
  }
  if (c.fib.enabled) {
    const s = cfg.strategy.fib;
    out.push(`${mark(c.fib)} فیبو ${res.fib.level} = ${P(res.fib.price)} · فاصله تا خط ${res.fib.distAtr.toFixed(2)} ATR`
      + ` (لازم ≤ ${s.toleranceAtr})${tag('fib')}`);
  }
  if (c.divergence.enabled) {
    out.push(res.div
      ? `${mark(c.divergence)} واگراییِ ${res.div.type === 'hidden' ? 'مخفیِ' : 'معمولیِ'} ${up ? 'مثبت' : 'منفی'} RSI:`
        + ` ${res.div.rsiP.toFixed(1)} ← ${res.div.rsiK.toFixed(1)} (قیمت ${P(res.div.priceP)} ← ${P(res.div.priceK)})${tag('divergence')}`
      : `❌ واگرایی RSI${zoneFa}: بینِ کفِ فعلی و کف‌های قبلی پیدا نشد${tag('divergence')}`);
  }
  const c5 = c.divergence5m;
  if (c5 && (c5.enabled || c5.unavailable)) {
    const d = res.div5m;
    const hm = (t) => utc(t).slice(11);
    out.push(c5.unavailable ? `⚪️ واگرایی RSI 5 دقیقه: داده‌ی 5 دقیقه نیامد${c5.enabled ? '' : ' — در امتیاز حساب نشد'}${tag('divergence5m')}`
      : d ? `${mark(c5)} واگراییِ ${d.type === 'hidden' ? 'مخفیِ' : 'معمولیِ'} ${up ? 'مثبت' : 'منفی'} RSI 5 دقیقه:`
        + ` ${d.rsiP.toFixed(1)} ← ${d.rsiK.toFixed(1)} (قیمت ${P(d.priceP)} ← ${P(d.priceK)} · ${hm(d.tP)} ← ${hm(d.tK)} UTC)${tag('divergence5m')}`
        : `❌ واگرایی RSI 5 دقیقه${zoneFa}: ${L.state === 'touch' ? 'روی کفِ 5 دقیقه‌ایِ برخورد پیدا نشد' : 'فقط روی خط بررسی می‌شود'}${tag('divergence5m')}`);
  }
  if (c.candle.enabled) {
    out.push(res.candle
      ? `${mark(c.candle)} کندلِ برگشتی: ${res.candle.fa} (${res.candle.name})${tag('candle')}`
      : `❌ کندلِ برگشتی: ${L.state === 'touch' ? 'هنوز تشکیل نشده' : 'فقط روی خط بررسی می‌شود'}${tag('candle')}`);
  }
  if (c.trendFilter.enabled) {
    out.push(`${mark(c.trendFilter)} فیلترِ روند: قیمت ${res.trend.above === up ? 'بالای' : 'زیرِ'} EMA ${res.trend.period}`
      + ` (${P(res.trend.ema)})${tag('trendFilter')}`);
  }
  if (c.volume.enabled) {
    out.push(`${mark(c.volume)} حجم: ${res.volume.ratio.toFixed(2)}× میانگین (لازم ${res.volume.need}×)${tag('volume')}`);
  }
  return out;
}

function planLines(res) {
  const p = res.plan;
  if (!p) return [];
  const P = (v) => price(v, res.close);
  const out = [
    `ورود ${P(p.entry)} · حد ضرر ${P(p.sl)} (${pct(Math.abs(p.riskPct))})`,
    p.tps.map((t) => `${t.label} ${P(t.price)} (${t.rr.toFixed(1)}R)`).join(' · '),
  ];
  if (p.rrWarning) out.push('⚠️ ریسک به ریوارد تارگتِ اول زیرِ حداقل است');
  return out;
}

/** جمع‌بندیِ یک‌خطی و قابلِ فهم برای یک نماد — برای جدولِ نتایج */
export function verdict(row, cfg) {
  if (row.error) return 'داده نیامد';
  if (!row.result) return 'خط روندِ صعودیِ معتبری نیست';
  const res = row.result;
  if (res.line.state === 'far') return `خط ${res.line.distAtr.toFixed(1)} ATR پایین‌تر از قیمت است`;
  if (res.blocked.length) return `مسدود: ${res.blocked.map((k) => CONDITIONS[k].fa).join('، ')}`;
  if (res.score >= cfg.alertThreshold) return res.complete ? 'ستاپِ کامل' : 'نزدیک به ستاپ — هشدار';
  return res.line.state === 'touch' ? 'روی خط، ولی شرط‌ها کامل نیست' : 'در حالِ نزدیک شدن به خط';
}

export function rowIcon(row, cfg) {
  if (row.error) return '⚠️';
  const res = row.result;
  if (!res || res.line.state === 'far') return '⚪️';
  if (res.alertable && res.score >= cfg.alertThreshold) return '🔔';
  return '🟡';
}

/** تغییرِ قیمت در بازه‌ی جست‌وجوی خط — «چرا خط نیست» با یک عدد */
function trendNote(candles, cfg) {
  const n = Math.min(cfg.strategy.trendline.lookback, candles.length - 1);
  const from = candles[candles.length - 1 - n].c;
  const now = candles.at(-1).c;
  const ch = ((now - from) / from) * 100;
  const days = ((n * TF_MS[cfg.timeframe]) / 86_400_000).toFixed(0);
  return `تغییرِ قیمت در ${days} روزِ اخیر: ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}٪`;
}

/** توضیحِ کاملِ یک نماد — صفحه‌ی نماد در پنل */
export function coinReport(row, cfg) {
  const head = `<b>${esc(row.item.id)}</b>`;
  if (row.error) {
    return [
      `${head} — ⚠️ داده نیامد`,
      '',
      'هر صرافی به ترتیبِ اولویت امتحان شد:',
      ...(row.tried || []).map((t) => `• ${esc(t.exchange)}: ${esc(t.error)}`),
      '',
      'اگر نماد درست است و همه «پشتیبانی نمی‌شود» گفته‌اند، این ارز در هیچ‌کدام از این صرافی‌ها لیست نیست.',
    ].join('\n');
  }
  const src = `${esc(row.data.pretty)} · ${esc(row.data.exchange)} · ${cfg.timeframe.toUpperCase()}`;
  const priceNow = price(row.data.candles.at(-1).c);
  if (!row.result) {
    return [
      `${head} — ⚪️ خط روندی نیست`,
      `${src} · قیمت ${priceNow}`,
      '',
      `در ${cfg.strategy.trendline.lookback} کندلِ اخیر دو کفِ ماژورِ بالارونده پیدا نشد که خطِ بینشان سالم مانده باشد.`,
      'یعنی بازار الان روندِ صعودیِ قابلِ اتکایی برای این استراتژی ندارد.',
    ].join('\n');
  }
  const res = row.result;
  const L = res.line;
  const out = [
    `${head} — ${rowIcon(row, cfg)} ${verdict(row, cfg)}`,
    `${src} · قیمت ${priceNow}`,
    `امتیاز <b>${res.score}/100</b> · آستانه ${cfg.alertThreshold}`,
    '',
  ];
  if (L.state === 'far') {
    const atrPct = (res.atr / res.close) * 100;
    out.push(`نزدیک‌ترین خطِ روندِ معتبر حوالیِ <b>${price(L.priceNow, res.close)}</b> است.`
      + ` قیمت ${L.distAtr.toFixed(1)} ATR (حدود ${(L.distAtr * atrPct).toFixed(1)}٪) بالاتر از آن است.`);
    out.push(`بررسیِ شرط‌ها از وقتی شروع می‌شود که قیمت به ${cfg.strategy.trendline.approachAtr} ATR ِ خط برسد.`);
    return out.join('\n');
  }
  out.push(...evidenceLines(res, row.data.candles, cfg).map(esc));
  if (res.blocked.length) {
    out.push('', `⛔️ شرطِ الزامیِ «${res.blocked.map((k) => CONDITIONS[k].fa).join('، ')}» برقرار نیست؛ هشدار نمی‌آید.`);
  } else if (res.score < cfg.alertThreshold) {
    out.push('', `تا آستانه ${cfg.alertThreshold - res.score} امتیاز مانده.`);
  }
  const plan = planLines(res);
  if (plan.length) out.push('', '<b>پلنِ پیشنهادی</b>', ...plan.map(esc));
  return out.join('\n');
}

export function adminAlert({ item, data, result: res }, cfg) {
  const last = data.candles.length - 1;
  const closeTime = utc(data.candles[last].t + TF_MS[cfg.timeframe]);
  const kind = res.complete ? 'ستاپِ کامل' : 'نزدیک به ستاپ';
  return [
    `🔔 <b>${kind} ${dirFa(res)} — ${esc(data.pretty)}</b>`,
    `امتیاز <b>${res.score}/100</b> · ${esc(data.exchange)} · ${cfg.timeframe.toUpperCase()} · ${closeTime} UTC`,
    '',
    ...evidenceLines(res, data.candles, cfg).map(esc),
    '',
    ...planLines(res).map(esc),
    '',
    `<i>${esc(item.id)}</i> — تأیید کنی، تحلیل و سیگنال در کانال منتشر می‌شود.`,
  ].join('\n');
}

export function channelAnalysis({ data, result: res }, cfg, { note } = {}) {
  const c = data.candles;
  const P = (v) => price(v, res.close);
  const up = res.direction !== 'short';
  const L = res.line;
  const tf = TF_FA[cfg.timeframe] || cfg.timeframe;
  const parts = [];

  parts.push(`📊 <b>تحلیل ${esc(data.pretty)} — تایم‌فریم ${tf}</b>`);
  parts.push('');
  parts.push(`قیمت به خط روندِ ${up ? 'صعودی' : 'نزولی'}ای رسیده که پیش‌تر ${L.touches.length === 2 ? 'دو' : L.touches.length} بار`
    + ` از آن واکنشِ جدی گرفته (${L.touches.map((i) => dateOf(c, i)).join(' و ')}).`);

  if (res.components.fib.enabled && res.components.fib.points > 0) {
    parts.push(`این ناحیه با سطحِ ${res.fib.level} فیبوناچیِ آخرین موجِ ${up ? 'صعودی' : 'نزولی'}`
      + ` (${P(res.fib.start)} تا ${P(res.fib.end)}) هم‌پوشانی دارد — حوالیِ ${P(res.fib.price)}.`);
  }
  if (res.components.divergence.enabled && res.div) {
    parts.push(res.div.type === 'hidden'
      ? `RSI واگراییِ مخفیِ ${up ? 'مثبت' : 'منفی'} نشان می‌دهد: قیمت کفِ ${up ? 'بالاتر' : 'پایین‌تر'} ساخته ولی RSI ریست شده — نشانه‌ی ادامه‌ی روند.`
      : `RSI واگراییِ ${up ? 'مثبت' : 'منفی'} نشان می‌دهد: قیمت ${up ? 'کفِ پایین‌تر' : 'سقفِ بالاتر'} زده ولی قدرتِ ${up ? 'فروشنده' : 'خریدار'} کم شده.`);
  }
  if (res.components.divergence5m?.enabled && res.div5m) {
    parts.push(`در تایم‌فریمِ 5 دقیقه هم RSI واگراییِ ${res.div5m.type === 'hidden' ? 'مخفیِ ' : ''}${up ? 'مثبت' : 'منفی'} دارد — برگشت از خط در تایمِ پایین هم تأیید شده.`);
  }
  if (res.components.candle.enabled && res.candle) parts.push(`روی همین ناحیه کندلِ برگشتیِ «${res.candle.fa}» بسته شده.`);
  if (res.components.trendFilter.enabled && res.components.trendFilter.ok) {
    parts.push(`قیمت ${up ? 'بالای' : 'زیرِ'} EMA ${res.trend.period} است؛ روندِ بزرگ‌تر هم‌جهت است.`);
  }

  parts.push('');
  if (res.plan) {
    parts.push(`تا وقتی کندلِ ${tf} ${up ? 'زیرِ' : 'بالای'} ${P(res.plan.invalidation)} بسته نشده،`
      + ` سناریوی ${up ? 'صعودی' : 'نزولی'} معتبر است.`);
  }
  if (note) parts.push('', `📝 ${esc(note)}`);
  parts.push(`<i>داده: ${esc(data.exchange)} · ${esc(data.pretty)}</i>`);
  return parts.join('\n');
}

export function channelSignal({ data, result: res }, cfg) {
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
    `❗️ ابطال: بسته شدنِ کندلِ ${TF_FA[cfg?.timeframe] || 'یک‌ساعته'} ${up ? 'زیرِ' : 'بالای'} <code>${P(p.invalidation)}</code>`,
    '📌 با رسیدن به تارگتِ اول، حد ضرر به نقطه‌ی ورود منتقل شود.',
    '⚖️ ریسکِ هر معامله حداکثر ۱ تا ۲ درصدِ سرمایه. این پیام توصیه‌ی مالی نیست.',
  ].join('\n');
}

/** متنِ کاملِ استراتژی با همه‌ی عددهای فعلی */
export function strategyText(cfg) {
  const s = cfg.strategy;
  const C = s.conditions;
  const on = Object.entries(C).filter(([, c]) => c.enabled);
  const total = on.reduce((t, [, c]) => t + c.weight, 0);
  const T = s.trendline;
  const lines = [
    '🧠 <b>استراتژیِ فعلی</b>',
    `تایم‌فریم ${TF_FA[cfg.timeframe]} · جهت ${cfg.directions.map((d) => (d === 'long' ? 'خرید' : 'فروش')).join(' و ')}`
      + ` · هشدار از امتیازِ ${cfg.alertThreshold}`,
    '',
  ];
  for (const [key, c] of Object.entries(C)) {
    const info = CONDITIONS[key];
    const head = c.enabled
      ? `${c.required ? '🔒' : '✅'} <b>${info.fa}</b> — وزن ${c.weight} (${Math.round((c.weight / total) * 100)}٪)${c.required ? ' · الزامی' : ''}`
      : `⏸ <s>${info.fa}</s> — خاموش`;
    lines.push(head);
    if (!c.enabled) continue;
    if (key === 'trendline') {
      lines.push(`   کف: ${T.pivotStrength} کندل هر طرف · واکنش ≥ ${T.minBounceAtr} ATR · فاصله‌ی دو برخورد ≥ ${T.minSpacing} کندل`);
      lines.push(`   روی خط ≤ ${T.touchToleranceAtr} ATR · نزدیک ≤ ${T.approachAtr} ATR · جست‌وجو در ${T.lookback} کندل`);
    } else if (key === 'fib') {
      lines.push(`   سطحِ ${s.fib.level} · کامل ≤ ${s.fib.toleranceAtr} ATR · نصف ≤ ${s.fib.nearToleranceAtr} ATR`);
    } else if (key === 'divergence') {
      lines.push(`   RSI ${s.rsiPeriod} · کفِ قبلی ${s.divergence.minGap} تا ${s.divergence.lookback} کندل قبل`
        + ` · اختلاف ≥ ${s.divergence.minRsiDelta} · مخفی ${s.divergence.allowHidden ? 'قبول' : 'نه'}${s.rsiZone?.enabled ? ` · اشباع: کف < ${s.rsiZone.low}، سقف > ${s.rsiZone.high}` : ''}`);
    } else if (key === 'divergence5m') {
      const d = s.divergence5m;
      lines.push(`   کندلِ 5 دقیقه · RSI ${s.rsiPeriod} · کفِ قبلی ${d.minGap} تا ${d.lookback} کندل قبل`
        + ` · اختلاف ≥ ${d.minRsiDelta} · مخفی ${d.allowHidden ? 'قبول' : 'نه'}${s.rsiZone?.enabled ? ` · اشباع: کف < ${s.rsiZone.low}، سقف > ${s.rsiZone.high}` : ''}`);
    } else if (key === 'candle') {
      lines.push(`   روی ${s.candles.window} کندلِ آخر · پوشا/ستاره ×1، چکش ×0.9، نفوذی ×0.85، انبرک ×0.75، هارامی/دوجی ×0.6`);
    } else if (key === 'trendFilter') {
      lines.push(`   قیمت بالای EMA ${s.trendFilter.emaPeriod}`);
    } else if (key === 'volume') {
      lines.push(`   حجم ≥ ${s.volume.multiplier}× میانگینِ ${s.volume.period} کندل`);
    }
  }
  const P = s.plan;
  lines.push('');
  lines.push('📐 <b>پلنِ معامله</b>');
  lines.push(`   ورود: بسته‌شدنِ کندل · حد ضرر: ${P.slBufferAtr} ATR زیرِ خط/کف`);
  lines.push(`   تارگت‌ها: ${P.tpExtensions.map((e) => (e === 0 ? 'سقفِ موج' : `${(1 + e).toFixed(3).replace(/0+$/, '')}`)).join(' · ')}`
    + ` · حداقل R:R ${P.minRR}`);
  const changed = Object.keys(cfg.overrides || {}).length;
  if (changed) lines.push('', `✏️ ${changed} مقدار با پیش‌فرض فرق دارد.`);
  return lines.join('\n');
}

const signR = (r) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}R`;

/** رویدادِ پیگیری — در کانال، در جوابِ همان پیامِ سیگنال */
export function trackEventText(sig, e) {
  const P = (v) => price(v, sig.entry);
  const n = sig.tps.length;
  switch (e.type) {
    case 'tp':
      return e.index === n
        ? `🏆 <b>تارگتِ ${e.index} (آخر) خورد</b> — <code>${P(e.price)}</code>\nسیگنالِ ${esc(sig.pretty)} کامل بسته شد · نتیجه ${signR(e.r)}`
        : `✅ <b>تارگتِ ${e.index} خورد</b> — <code>${P(e.price)}</code>`
          + (e.index === 1 ? `\n📌 حد ضرر به نقطه‌ی ورود (${P(sig.entry)}) منتقل شود.` : '');
    case 'sl':
      return `🛑 <b>حد ضرر خورد</b> — <code>${P(e.price)}</code> · ${signR(e.r)}`;
    case 'be':
      return `⚪️ <b>قیمت به نقطه‌ی ورود برگشت</b> — باقیِ پوزیشن سر‌به‌سر بسته شد · نتیجه‌ی کل ${signR(e.r)}`;
    case 'expired':
      return `⏱ <b>پیگیریِ سیگنال تمام شد</b> — بعد از ${Math.round((sig.closedAt - sig.publishedAt) / 3_600_000)} ساعت،`
        + ` با قیمتِ <code>${P(e.price)}</code> · ${signR(e.r)}`;
    default:
      return '';
  }
}

export { signR };

/** هشدارِ «نزدیک شدن به خط» — فقط برای ادمین */
export function nearAlert(row) {
  const res = row.result;
  const L = res.line;
  const atrPct = (res.atr / res.close) * 100;
  const ready = Object.entries(res.components)
    .filter(([k, c]) => k !== 'trendline' && c.enabled && c.points > 0)
    .map(([k]) => CONDITIONS[k].fa);
  return [
    `👀 <b>${esc(row.data.pretty)} به خط روند نزدیک می‌شود</b>`,
    `قیمت ${price(res.close)} · خط حوالیِ <b>${price(L.priceNow, res.close)}</b>`,
    `فاصله ${L.distAtr.toFixed(1)} ATR (حدود ${(L.distAtr * atrPct).toFixed(1)}٪)`,
    ready.length ? `از الان برقرار: ${ready.join('، ')}` : 'هنوز شرطِ دیگری برقرار نیست.',
    '',
    'اگر روی خط شرط‌ها کامل شد، هشدارِ اصلی با دکمه‌ی انتشار می‌آید.',
  ].join('\n');
}
