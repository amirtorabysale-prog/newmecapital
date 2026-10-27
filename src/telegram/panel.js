/**
 * صفحه‌های پنل. هر صفحه یک تابعِ خالص است: وضعیت ← { text, buttons }.
 * bot.js همین را روی *همان* پیام ویرایش می‌کند، پس پنل یک پیام است که با
 * هر دکمه عوض می‌شود — نه رشته‌ای از پیام‌های تازه.
 *
 * callback_data:
 *   nav:<صفحه>[:آرگومان]   رفتن به صفحه
 *   act:<کار>[:آرگومان…]   انجامِ کار و نمایشِ صفحه‌ی مربوط
 *   ok:<id> / no:<id>       تأیید/ردِ هشدار (روی پیامِ عکس، نه پنل)
 *
 * ⚠️ callback_data حداکثر ۶۴ بایت است؛ برای همین پارامترها id ِ عددی دارند.
 */

import { CONDITIONS, PARAMS, paramById, getPath, formatValue } from '../strategy/params.js';
import { esc, strategyText, coinReport, rowIcon, verdict, TF_FA } from '../messages.js';
import { SCAN_INTERVALS, TIMEFRAMES } from '../config.js';
import { utc } from '../format.js';

const b = (text, data) => ({ text, callback_data: data });
const HOME = b('🏠 خانه', 'nav:home');
const pairs = (arr) => arr.reduce((rows, x, i) => (i % 2 ? rows[rows.length - 1].push(x) : rows.push([x]), rows), []);
const check = (on) => (on ? '✓ ' : '');

export function home(s) {
  const { cfg, lastScan, pending, nextScanAt } = s;
  return {
    text: [
      '🤖 <b>پنلِ بات سیگنال</b>',
      '',
      `📋 واچ‌لیست: <b>${cfg.watchlist.length}</b> ارز`,
      `⏱ اسکن هر <b>${cfg.scanEvery}</b> · تحلیل روی تایم‌فریمِ <b>${TF_FA[cfg.timeframe]}</b>`,
      `🎯 هشدار از امتیازِ <b>${cfg.alertThreshold}</b> · جهت: ${cfg.directions.map((d) => (d === 'long' ? 'خرید' : 'فروش')).join(' و ')}`,
      '',
      `آخرین اسکن: ${lastScan ? `${utc(lastScan.at)} UTC — ${lastScan.alerts} هشدار` : 'هنوز انجام نشده'}`,
      `اسکنِ بعدی: ${nextScanAt ? `${utc(nextScanAt)} UTC` : '—'}`,
      `در انتظارِ تأیید: ${pending}`,
    ].join('\n'),
    buttons: [
      [b('🔎 اسکنِ همین الان', 'act:scan')],
      [b('📊 نتایجِ آخرین اسکن', 'nav:res'), b('📋 واچ‌لیست', 'nav:wl')],
      [b('🧠 استراتژی', 'nav:st'), b('⚙️ تنظیمات', 'nav:set')],
      [b(`🔔 در انتظارِ تأیید (${pending})`, 'nav:pend'), b('👥 ادمین‌ها', 'nav:adm')],
    ],
  };
}

export function scanning(done, total, current) {
  const bar = '▰'.repeat(done) + '▱'.repeat(Math.max(0, total - done));
  return {
    text: `⏳ <b>در حالِ اسکن…</b>\n\n${bar} ${done}/${total}${current ? `\nالان: ${esc(current)}` : ''}`,
    buttons: [],
  };
}

export function results(s) {
  const { cfg, rows, lastScan } = s;
  if (!rows.length) {
    return {
      text: '📊 هنوز اسکنی انجام نشده.\nبا «اسکنِ همین الان» شروع کن.',
      buttons: [[b('🔎 اسکنِ همین الان', 'act:scan')], [HOME]],
    };
  }
  const order = { '🔔': 0, '🟡': 1, '⚪️': 2, '⚠️': 3 };
  const sorted = [...rows].sort((x, y) => order[rowIcon(x, cfg)] - order[rowIcon(y, cfg)]
    || (y.result?.score ?? -1) - (x.result?.score ?? -1));
  const lines = sorted.map((r) => {
    const score = r.result && r.result.line.state !== 'far' ? ` <b>${r.result.score}</b>` : '';
    return `${rowIcon(r, cfg)} <b>${esc(r.item.id)}</b>${score} — ${esc(verdict(r, cfg))}`;
  });
  return {
    text: [
      `📊 <b>نتایجِ اسکن</b> · ${lastScan ? `${utc(lastScan.at)} UTC` : ''} · آستانه ${cfg.alertThreshold}`,
      '',
      ...lines,
      '',
      '🔔 هشدار داد · 🟡 نزدیکِ خط، شرط‌ها ناقص · ⚪️ دور از خط یا بی‌خط · ⚠️ بی‌داده',
      'روی هر ارز بزن تا دلیلِ کامل و چارتش را ببینی.',
    ].join('\n'),
    buttons: [
      ...pairs(sorted.map((r) => b(`${rowIcon(r, cfg)} ${r.item.base}`, `nav:coin:${r.item.base}`))),
      [b('🔄 اسکنِ دوباره', 'act:scan'), HOME],
    ],
  };
}

export function coin(s, base) {
  const { cfg, rows } = s;
  const row = rows.find((r) => r.item.base === base);
  const inList = cfg.watchlist.some((w) => w.base === base);
  const buttons = [
    [b('🖼 تحلیل روی چارت', `act:chart:${base}`), b('🔄 تحلیلِ دوباره', `act:re:${base}`)],
  ];
  if (inList) buttons.push([b('🗑 حذف از واچ‌لیست', `act:rm?:${base}`)]);
  buttons.push([b('🔙 نتایج', 'nav:res'), b('📋 واچ‌لیست', 'nav:wl'), HOME]);
  return { text: row ? coinReport(row, cfg) : `${esc(base)} — هنوز تحلیل نشده.`, buttons };
}

export function confirmRemove(base) {
  return {
    text: `🗑 <b>${esc(base)}</b> از واچ‌لیست حذف شود؟`,
    buttons: [[b('بله، حذف کن', `act:rm:${base}`), b('نه', `nav:coin:${base}`)]],
  };
}

export function watchlist(s) {
  const { cfg, rows } = s;
  const src = (base) => rows.find((r) => r.item.base === base)?.data?.exchange;
  return {
    text: [
      `📋 <b>واچ‌لیست</b> (${cfg.watchlist.length})`,
      '',
      ...cfg.watchlist.map((w, i) => `${i + 1}. <b>${esc(w.id)}</b>${src(w.base) ? ` · ${esc(src(w.base))}` : ''}`),
      '',
      `داده به ترتیب از: ${cfg.exchanges.join(' ← ')}`,
      'روی هر ارز بزن تا تحلیلش را ببینی یا حذفش کنی.',
    ].join('\n'),
    buttons: [
      ...pairs(cfg.watchlist.map((w) => b(w.base, `nav:coin:${w.base}`))),
      [b('➕ افزودنِ ارز', 'nav:add')],
      [HOME],
    ],
  };
}

export function addPrompt(note = '') {
  return {
    text: [
      '➕ <b>افزودنِ ارز</b>',
      '',
      'نامِ ارز را همین‌جا بفرست. مثلاً: <code>SOL</code> یا <code>SOLUSDT</code>',
      'چندتا را با فاصله بفرست: <code>ARB OP TIA</code>',
      '',
      'هر ارز اول در صرافی‌ها جست‌وجو می‌شود؛ اگر هیچ‌جا نبود اضافه نمی‌شود.',
      note,
    ].join('\n'),
    buttons: [[b('🔙 لغو', 'nav:wl')]],
  };
}

export function strategy(s) {
  const { cfg } = s;
  const C = cfg.strategy.conditions;
  const condBtns = Object.keys(CONDITIONS).map((key) => {
    const c = C[key];
    const icon = !c.enabled ? '⏸' : c.required ? '🔒' : '✅';
    return b(`${icon} ${CONDITIONS[key].fa}${c.enabled ? ` · ${c.weight}` : ''}`, `nav:cond:${key}`);
  });
  return {
    text: strategyText(cfg) + '\n\nروی هر شرط بزن تا عددهایش را عوض کنی، روشن/خاموشش کنی یا الزامی‌اش کنی.',
    buttons: [
      ...pairs(condBtns),
      [b('📐 پلنِ معامله', 'nav:grp:plan'), b('🎯 آستانه و هشدار', 'nav:grp:general')],
      [b('♻️ همه به پیش‌فرض', 'act:reset?')],
      [HOME],
    ],
  };
}

function paramButtons(cfg, group) {
  return PARAMS.filter((p) => p.group === group && !p.hidden)
    .map((p) => [b(`${p.fa}: ${formatValue(p, getPath(cfg, p.path))}${cfg.overrides[p.path] !== undefined ? ' ✏️' : ''}`, `nav:par:${p.id}`)]);
}

export function condition(s, key) {
  const { cfg } = s;
  const c = cfg.strategy.conditions[key];
  const info = CONDITIONS[key];
  const P = (suffix) => PARAMS.find((p) => p.path === `strategy.conditions.${key}.${suffix}`).id;
  const buttons = [];
  if (!info.locked) {
    buttons.push([
      b(c.enabled ? '✅ روشن — بزن تا خاموش شود' : '⏸ خاموش — بزن تا روشن شود', `act:tg:${P('enabled')}`),
    ]);
  }
  if (c.enabled) {
    if (!info.locked) {
      buttons.push([b(c.required ? '🔒 الزامی — بزن تا اختیاری شود' : '🔓 اختیاری — بزن تا الزامی شود', `act:tg:${P('required')}`)]);
    }
    buttons.push([b('− 5', `act:inc:${P('weight')}:-1`), b(`وزن: ${c.weight}`, `nav:par:${P('weight')}`), b('+ 5', `act:inc:${P('weight')}:1`)]);
    buttons.push(...paramButtons(cfg, key));
  }
  buttons.push([b('↩️ این بخش به پیش‌فرض', `act:rg:${key}`)]);
  buttons.push([b('🔙 استراتژی', 'nav:st'), HOME]);
  return {
    text: [
      `<b>${info.fa}</b> ${!c.enabled ? '— ⏸ خاموش' : c.required ? '— 🔒 الزامی' : ''}`,
      '',
      esc(info.about),
      '',
      info.locked ? 'این شرط پایه‌ی استراتژی است و خاموش نمی‌شود.' : '',
      'الزامی یعنی اگر برقرار نباشد، هر امتیازی هم که باشد هشدار نمی‌آید.',
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n'),
    buttons,
  };
}

export function group(s, name) {
  const { cfg } = s;
  const title = name === 'plan' ? '📐 <b>پلنِ معامله</b>' : '🎯 <b>آستانه و هشدار</b>';
  const about = name === 'plan'
    ? 'ورود همیشه قیمتِ بسته‌شدنِ کندلِ سیگنال است. حد ضرر زیرِ پایین‌ترینِ کفِ برخورد یا خط (هرکدام پایین‌تر) با فاصله‌ی زیر.'
    : 'امتیاز از ۱۰۰ است: جمعِ وزنِ شرط‌های برقرار تقسیم بر جمعِ وزنِ شرط‌های روشن.';
  return {
    text: `${title}\n\n${about}`,
    buttons: [...paramButtons(cfg, name), [b('🔙 استراتژی', 'nav:st'), HOME]],
  };
}

export function param(s, id, note = '') {
  const { cfg } = s;
  const p = paramById(id);
  const v = getPath(cfg, p.path);
  const def = getPath(cfg.defaults, p.path);
  const back = p.path.startsWith('strategy.conditions.') || CONDITIONS[p.group]
    ? `nav:cond:${p.group}` : `nav:grp:${p.group}`;
  const buttons = [];
  if (p.type === 'choice') {
    buttons.push(p.choices.map((c) => b(`${check(c === v)}${c}`, `act:set:${p.id}:${c}`)));
  } else if (p.type === 'bool') {
    buttons.push([b(v ? '✅ بله — بزن تا «نه» شود' : '❌ نه — بزن تا «بله» شود', `act:tg:${p.id}`)]);
  } else if (p.type !== 'list') {
    buttons.push([b(`− ${p.step}`, `act:inc:${p.id}:-1`), b(formatValue(p, v), `nav:par:${p.id}`), b(`+ ${p.step}`, `act:inc:${p.id}:1`)]);
  }
  if (p.type !== 'bool') buttons.push([b('✏️ نوشتنِ مقدارِ دلخواه', `act:in:${p.id}`)]);
  if (JSON.stringify(v) !== JSON.stringify(def)) buttons.push([b(`↩️ پیش‌فرض (${formatValue(p, def)})`, `act:def:${p.id}`)]);
  buttons.push([b('🔙 برگشت', back), HOME]);
  return {
    text: [
      `<b>${esc(p.fa)}</b>`,
      p.about ? `\n${esc(p.about)}` : '',
      '',
      `مقدارِ فعلی: <b>${esc(formatValue(p, v))}</b>`,
      `پیش‌فرض: ${esc(formatValue(p, def))}`,
      p.min !== undefined ? `بازه‌ی مجاز: ${p.min} تا ${p.max}` : '',
      note ? `\n${note}` : '',
    ].filter(Boolean).join('\n'),
    buttons,
  };
}

export function paramInput(s, id, note = '') {
  const p = paramById(id);
  return {
    text: [
      `✏️ <b>${esc(p.fa)}</b>`,
      '',
      p.type === 'list' ? 'عددها را با کاما بفرست، مثلاً: <code>0, 0.272, 0.618</code>'
        : `یک عدد بفرست${p.min !== undefined ? ` بین ${p.min} و ${p.max}` : ''}.`,
      note,
    ].join('\n'),
    buttons: [[b('🔙 لغو', `nav:par:${p.id}`)]],
  };
}

export function settings(s) {
  const { cfg } = s;
  const row = (items, cur, act) => items.map(([v, label]) => b(`${check(v === cur)}${label}`, `act:${act}:${v}`));
  const dirKey = cfg.directions.length === 2 ? 'both' : cfg.directions[0];
  return {
    text: [
      '⚙️ <b>تنظیمات</b>',
      '',
      `⏱ <b>فاصله‌ی اسکن:</b> هر ${cfg.scanEvery} — اسکن درست بعد از بسته شدنِ کندل اجرا می‌شود.`,
      `🕯 <b>تایم‌فریمِ تحلیل:</b> ${TF_FA[cfg.timeframe]} — استراتژی برای یک‌ساعته طراحی شده.`,
      `↕️ <b>جهت:</b> ${{ long: 'فقط خرید', short: 'فقط فروش', both: 'خرید و فروش' }[dirKey]}`,
      `🎯 <b>آستانه‌ی هشدار:</b> ${cfg.alertThreshold} از 100`,
      `🔁 <b>تکرارِ هشدارِ یک ستاپ:</b> هر ${cfg.cooldownHours} ساعت حداکثر یک بار`,
    ].join('\n'),
    buttons: [
      row(Object.keys(SCAN_INTERVALS).map((v) => [v, `⏱ ${v}`]), cfg.scanEvery, 'every'),
      row(TIMEFRAMES.map((v) => [v, `🕯 ${v}`]), cfg.timeframe, 'tf'),
      row([['long', 'خرید'], ['short', 'فروش'], ['both', 'هر دو']], dirKey, 'dir'),
      [b('🎯 − 5', 'act:th:-1'), b(`آستانه: ${cfg.alertThreshold}`, 'nav:par:60'), b('🎯 + 5', 'act:th:1')],
      [b(`🔁 تکرارِ هشدار: ${cfg.cooldownHours} ساعت`, 'nav:par:61')],
      [HOME],
    ],
  };
}

export function pendingList(s) {
  const { alerts } = s;
  const list = Object.values(alerts).filter((a) => a.status === 'pending').sort((x, y) => y.createdAt - x.createdAt);
  if (!list.length) return { text: '🔔 هیچ هشداری در انتظارِ تأیید نیست.', buttons: [[HOME]] };
  return {
    text: [
      `🔔 <b>در انتظارِ تأیید</b> (${list.length})`,
      '',
      ...list.map((a) => `• <b>${esc(a.pretty)}</b> — ${a.score}/100 · ${((Date.now() - a.createdAt) / 3_600_000).toFixed(1)} ساعت پیش`),
      '',
      'روی هر کدام بزن تا عکس و دکمه‌ی انتشار دوباره بیاید.',
    ].join('\n'),
    buttons: [...list.slice(0, 10).map((a) => [b(`📤 ${a.pretty} · ${a.score}`, `act:show:${a.id}`)]), [HOME]],
  };
}

export function confirmReset() {
  return {
    text: '♻️ همه‌ی عددهای استراتژی و آستانه به پیش‌فرض برگردند؟\nواچ‌لیست و فاصله‌ی اسکن دست نمی‌خورند.',
    buttons: [[b('بله، برگردان', 'act:reset'), b('نه', 'nav:st')]],
  };
}

export function admins(s, canManage) {
  const { owners, admins: added, names } = s;
  const label = (id, name) => `${name || names[id] ? `${esc(name || names[id])} · ` : ''}<code>${id}</code>`;
  const lines = [
    '👥 <b>ادمین‌ها</b>',
    '',
    '<b>مالک‌ها</b> — از تنظیماتِ ریل‌وی، از این‌جا حذف نمی‌شوند:',
    ...owners.map((id) => `👑 ${label(id)}`),
    '',
    '<b>ادمین‌های پنل:</b>',
    ...(added.length ? added.map((a) => `🛡 ${label(a.id, a.name)}`) : ['— هنوز کسی اضافه نشده']),
    '',
    'هر ادمین هشدارها را می‌گیرد و به همه‌ی پنل دسترسی دارد.',
    canManage ? '' : 'فقط مالک‌ها ادمین اضافه یا حذف می‌کنند.',
  ];
  const buttons = [];
  if (canManage) {
    buttons.push(...added.map((a) => [b(`🗑 حذفِ ${a.name || names[a.id] || a.id}`, `act:arm?:${a.id}`)]));
    buttons.push([b('➕ افزودنِ ادمین', 'nav:admadd')]);
  }
  buttons.push([HOME]);
  return { text: lines.filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim(), buttons };
}

export function adminPrompt(note = '') {
  return {
    text: [
      '➕ <b>افزودنِ ادمین</b>',
      '',
      'یکی از این دو کار را بکن:',
      '• <b>یک پیام از آن شخص را همین‌جا فوروارد کن</b>، یا',
      '• <b>شناسه‌ی عددی‌اش را بفرست</b> — خودش با فرستادنِ /id به این بات می‌گیردش.',
      '',
      'یوزرنیم (@…) کار نمی‌کند؛ تلگرام از روی یوزرنیم شناسه نمی‌دهد.',
      note ? `\n${note}` : '',
    ].join('\n'),
    buttons: [[b('🔙 لغو', 'nav:adm')]],
  };
}

export function confirmAdminRemove(s, id) {
  const a = s.admins.find((x) => String(x.id) === String(id));
  const name = a?.name || s.names[id] || id;
  return {
    text: `🗑 دسترسیِ <b>${esc(name)}</b> برداشته شود؟\nدیگر هشدار نمی‌گیرد و پنل برایش باز نمی‌شود.`,
    buttons: [[b('بله، حذف کن', `act:arm:${id}`), b('نه', 'nav:adm')]],
  };
}
