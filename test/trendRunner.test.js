/**
 * جریانِ روند‌گیری در بات، بدونِ شبکه: کاغذی (ورود ← خروج، بی‌تکرار)، زنده
 * (هشدار ← انتشار با قیمتِ لحظه ← خروج با کلوزِ زیرِ EMA در کانال)، و ردِ
 * کندلِ روزانه‌ای که روی روزِ UTC نیست.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cfgJson from '../config/default.json' with { type: 'json' };

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trend-bot-'));

let R; let store; let stopStep;
before(async () => {
  R = await import('../src/trendRunner.js');
  ({ store } = await import('../src/store.js'));
  ({ stopStep } = await import('../src/tracker.js'));
});

const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY) * DAY;

/**
 * ۲۶۰ روزِ نزولی با دامنه‌ی پهن، کندلِ ماقبلِ آخر که بالای EMA50 می‌بندد (تقاطع)
 * و کندلِ آخر که باز هم بالای آن می‌بندد (تأیید ← ورود روی کلوزِ آخر)
 */
function bars(lastT) {
  const n = 260;
  const out = [];
  for (let i = 0; i < n - 2; i++) {
    const c = 100 - i * 0.08;
    out.push({ t: lastT - (n - 1 - i) * DAY, o: c + 0.04, h: c + 5, l: c - 5, c, v: 1 });
  }
  out.push({ t: lastT - DAY, o: 80, h: 96, l: 79, c: 95, v: 1 });
  out.push({ t: lastT, o: 95, h: 96, l: 93, c: 95, v: 1 });
  return out;
}

test('تقاطع بدونِ کلوزِ تأیید ورود نیست', async () => {
  const series = bars(today - DAY).slice(0, -1); // کلوزِ آخر خودِ تقاطع است
  const { api, runner } = setup('paper', series);
  await runner.runDaily(today - DAY + 3_600_000);
  assert.equal(store.trend().book.TEST, undefined);
  assert.equal(api.calls.length, 0);
});

function fakeApi() {
  const calls = [];
  let mid = 100;
  const rec = (name) => async (...args) => { calls.push({ name, args }); return { message_id: ++mid }; };
  return { calls, sendMessage: rec('sendMessage'), sendPhoto: rec('sendPhoto'), editText: rec('editText'), answer: rec('answer') };
}
/** متنِ پیام: sendMessage(chat, text) یا sendPhoto(chat, png, caption) */
const txt = (c) => (c.name === 'sendPhoto' ? c.args[2] : c.args[1]);
const opts = (c) => c.args[c.name === 'sendPhoto' ? 3 : 2];
const isPng = (b) => Buffer.isBuffer(b) && b.subarray(1, 4).toString() === 'PNG';
const quiet = { info() {}, warn() {}, error() {} };

function setup(mode, series) {
  const cfg = structuredClone(cfgJson);
  cfg.watchlist = [{ id: 'TESTUSDT', base: 'TEST' }];
  cfg.trend.mode = mode;
  cfg.trend.alertTtlHours = 48;
  const api = fakeApi();
  const data = { candles: series, exchange: 'Binance', exchangeKey: 'binance', symbol: 'TESTUSDT', pretty: 'TEST/USDT' };
  const runner = R.createTrendRunner({
    api, cfg, log: quiet, adminIds: () => ['111'], channelId: () => '@chan',
    fetchDailyFn: async () => ({ ...data, candles: data.candles }),
  });
  return { cfg, api, runner, data };
}

beforeEach(() => {
  const t = store.trend();
  t.book = {}; t.closed = []; t.seen = {}; t.alerts = {}; delete t.last;
  for (const k of Object.keys(store.get().signals)) delete store.get().signals[k];
  store.save();
});

test('خاموش: هیچ کاری نمی‌کند', async () => {
  const { api, runner } = setup('off', bars(today - DAY));
  assert.equal(await runner.runDaily(), null);
  assert.equal(api.calls.length, 0);
});

test('کاغذی: ورود یک بار، خروج با کلوزِ زیرِ EMA، هیچ پیامی به کانال', async () => {
  const series = bars(today - 2 * DAY);
  const { api, runner, data } = setup('paper', series);
  const now = today - DAY + 3_600_000;
  await runner.runDaily(now);
  assert.ok(store.trend().book.TEST, 'پوزیشنِ کاغذی باز شد');
  assert.equal(api.calls[0].name, 'sendPhoto', 'ورود با چارت');
  assert.ok(isPng(api.calls[0].args[1]));
  assert.match(txt(api.calls[0]), /کاغذیِ روند.*ورود/s);
  await runner.runDaily(now);
  assert.equal(api.calls.length, 1, 'اجرای دوباره تکرار نمی‌سازد');

  data.candles = [...series, { t: today - DAY, o: 94, h: 95, l: 78, c: 80, v: 1 }];
  await runner.runDaily(today + 3_600_000);
  assert.equal(store.trend().book.TEST, undefined);
  const [pos] = store.trend().closed;
  assert.equal(pos.exitReason, 'ema');
  assert.equal(pos.exit, 80);
  assert.ok(pos.r < 0 && pos.r < pos.grossR, 'R ِ خالص با کارمزد');
  assert.match(txt(api.calls.at(-1)), /خروج.*کلوز زیرِ EMA/s);
  assert.ok(api.calls.every((c) => c.args[0] === '111'), 'فقط ادمین');
});

test('ورود روی کلوزِ کهنه گرفته نمی‌شود', async () => {
  const { api, runner } = setup('paper', bars(today - 5 * DAY));
  await runner.runDaily(today);
  assert.equal(store.trend().book.TEST, undefined);
  assert.equal(api.calls.length, 0);
});

test('زنده: هشدار ← انتشار با قیمتِ لحظه ← استاپ با ۵ دقیقه / خروج با EMA در کانال', async () => {
  const series = bars(today - DAY);
  const { api, runner, data } = setup('live', series);
  await runner.runDaily(today + 600_000);
  const alertMsg = api.calls.find((c) => c.name === 'sendMessage' && c.args[2]?.buttons);
  assert.ok(alertMsg, 'هشدار با دکمه');
  assert.ok(api.calls.some((c) => c.name === 'sendPhoto' && c.args[0] === '111' && /چارتِ روزانه/.test(c.args[2])), 'چارت پیش از هشدار');
  const id = alertMsg.args[2].buttons[0][0].callback_data.split(':')[1];
  assert.ok(store.trend().book.TEST, 'دفترِ کاغذی هم ثبت کرد');

  // قیمتِ لحظه از همان صرافی (کندلِ ۵ دقیقه‌ی بسته)
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const t = Math.floor(Date.now() / 300_000) * 300_000 - 600_000;
    return new Response(JSON.stringify([[t, '95', '95.6', '95', '95.5', '1']]), { status: 200 });
  };
  try {
    await runner.decide({ id: 'cb1', from: { id: 111, username: 'admin' } }, true, id);
  } finally {
    globalThis.fetch = realFetch;
  }
  const post = api.calls.find((c) => c.args[0] === '@chan');
  assert.ok(post, 'پیام در کانال');
  assert.equal(post.name, 'sendPhoto', 'سیگنالِ کانال با چارت');
  assert.match(txt(post), /سیگنالِ روند.*95\.50.*EMA50/s);
  const sig = store.signals().find((s) => s.kind === 'trend');
  assert.equal(sig.entry, 95.5);
  assert.equal(store.trend().alerts[id].status, 'published');

  // دوباره زدن: باز نیست
  await runner.decide({ id: 'cb2', from: { id: 111 } }, true, id);
  assert.match(txt(api.calls.at(-1)), /باز نیست/);

  // استاپ فقط با کندلِ ۵ دقیقه بعد از انتشار
  assert.deepEqual(stopStep(sig, [{ t: sig.lastT - 300_000, l: 1 }]), [], 'کندلِ پیش از انتشار حساب نیست');
  assert.equal(sig.status, 'open');

  // کلوزِ روزِ بعد زیرِ EMA ← پیام در کانال، در جوابِ سیگنال
  data.candles = [...series, { t: today, o: 94, h: 95, l: 78, c: 80, v: 1 }];
  await runner.runDaily(today + DAY + 600_000);
  const closed = store.signals().find((s) => s.kind === 'trend');
  assert.equal(closed.status, 'closed');
  assert.equal(closed.outcome, 'ema');
  assert.ok(Math.abs(closed.realized - (80 - 95.5) / closed.risk) < 1e-9);
  const exitPost = api.calls.filter((c) => c.args[0] === '@chan').at(-1);
  assert.match(txt(exitPost), /خروج/);
  assert.equal(opts(exitPost).replyTo, closed.channelMsgId, 'در جوابِ همان پیامِ سیگنال');
  assert.equal(closed.entryBarT, series.at(-1).t, 'کندلِ ورود برای چارت ذخیره شد');
});

test('زنده: عکس به کانال نرفت ← همان سیگنال بی‌عکس منتشر می‌شود', async () => {
  const { api, runner } = setup('live', bars(today - DAY));
  api.sendPhoto = async () => { throw new Error('upload failed'); };
  await runner.runDaily(today + 600_000);
  const alertMsg = api.calls.find((c) => c.name === 'sendMessage' && c.args[2]?.buttons);
  const id = alertMsg.args[2].buttons[0][0].callback_data.split(':')[1];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const t = Math.floor(Date.now() / 300_000) * 300_000 - 600_000;
    return new Response(JSON.stringify([[t, '95', '95.6', '95', '95.5', '1']]), { status: 200 });
  };
  try {
    await runner.decide({ id: 'cb1', from: { id: 111 } }, true, id);
  } finally {
    globalThis.fetch = realFetch;
  }
  const post = api.calls.find((c) => c.args[0] === '@chan');
  assert.equal(post?.name, 'sendMessage');
  assert.match(post.args[1], /سیگنالِ روند/);
  assert.equal(store.trend().alerts[id].status, 'published');
});

test('چارتِ پنل: در حالتِ خاموش هم؛ پوزیشنِ قاعده‌ای و معامله‌های گذشته روی تصویر', async () => {
  const series = bars(today - DAY);
  const { runner } = setup('off', series);
  const { png, caption } = await runner.chart({ id: 'TESTUSDT', base: 'TEST' });
  assert.ok(isPng(png));
  assert.match(caption, /ورودِ تازه.*طبقِ قاعده/s, 'کلوزِ آخر تقاطع است ← ورودِ تازه طبقِ قاعده');

  const { buildTrendSvg } = await import('../src/chart/trendChart.js');
  const { replay, TREND_DEFAULTS } = await import('../src/strategy/trend.js');
  const down = [...series, { t: today, o: 94, h: 95, l: 78, c: 80, v: 1 }];
  const all = replay(down, TREND_DEFAULTS);
  assert.equal(all.at(-1).exitReason, 'ema');
  const svg = buildTrendSvg({ bars: down, trades: all, open: null, meta: { pretty: 'TEST/USDT', exchange: 'Binance' } });
  assert.match(svg, /EXIT · below EMA 50/);
  assert.match(svg, /Rule trades on chart: 1 /);
});

test('stopStep: حد ضرر با کندلِ ۵ دقیقه', () => {
  const sig = { status: 'open', entry: 100, sl: 90, slNow: 90, risk: 10, lastT: 1000, events: [] };
  assert.deepEqual(stopStep(sig, [{ t: 1000, l: 95 }]), []);
  const [e] = stopStep(sig, [{ t: 1300, l: 89 }]);
  assert.equal(e.type, 'sl');
  assert.equal(sig.realized, -1);
  assert.equal(sig.status, 'closed');
});

test('livePriceError: زیرِ EMA، زیرِ استاپ، یا دور از کلوز ← رد', () => {
  const ev = { close: 100, ema: 95, stop: 85, atr: 5 };
  assert.equal(R.livePriceError(ev, 101, 0.5), null);
  assert.match(R.livePriceError(ev, 104, 0.5), /ATR/);
  assert.match(R.livePriceError(ev, 94, 0.5), /EMA/);
  assert.match(R.livePriceError(ev, 84, 0.5), /حد ضرر/);
});

test('fetchDaily: کندلِ ۱۶:۰۰ UTC ِ LBank رد و سری‌ِ UTC ِ بایننس گرفته می‌شود', async () => {
  const cfg = structuredClone(cfgJson);
  const realFetch = globalThis.fetch;
  const last = today - DAY;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('lbkex')) {
      const data = Array.from({ length: 300 }, (_, i) => [(last - (299 - i) * DAY - 8 * 3_600_000) / 1000, 1, 1, 1, 1, 1]);
      return new Response(JSON.stringify({ result: 'true', data }), { status: 200 });
    }
    if (u.includes('binance.vision')) {
      return new Response(JSON.stringify(Array.from({ length: 300 }, (_, i) => [last - (299 - i) * DAY, '1', '1', '1', '1', '1'])), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const d = await R.fetchDaily({ id: 'SOLUSDT', base: 'SOL' }, cfg);
    assert.equal(d.exchangeKey, 'binance');
    assert.match(d.tried[0].error, /UTC/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('nextRunAt: چند دقیقه بعد از ۰۰:۰۰ UTC ِ بعدی', () => {
  const cfg = { trend: { runAfterMinutes: 5 } };
  assert.equal(R.nextRunAt(cfg, today + 60_000), today + 300_000);
  assert.equal(R.nextRunAt(cfg, today + 600_000), today + DAY + 300_000);
});

test('پنل: صفحه‌ی روند؛ فقط مالک حالت را عوض می‌کند و تغییر ذخیره می‌شود', async () => {
  const { createBot } = await import('../src/telegram/bot.js');
  const cfg = structuredClone(cfgJson);
  cfg.defaults = structuredClone(cfgJson);
  cfg.overrides = {};
  cfg.watchlist = [];
  const api = { ...fakeApi(), editMessage: async () => ({}) };
  const calls = [];
  for (const k of ['sendMessage', 'editText', 'answer', 'call', 'editCaption', 'sendPhoto', 'deleteMessage']) {
    api[k] = async (...args) => { calls.push({ k, args }); return { message_id: 500 + calls.length }; };
  }
  const bot = createBot({ api, env: { adminIds: ['111'], channelId: '@chan' }, cfg, log: quiet });
  cfg.admins = [{ id: 222 }];
  const cb = (from, data) => ({ id: 'q', from: { id: from }, data, message: { chat: { id: from }, message_id: 9 } });

  await bot.onCallback(cb(111, 'nav:trend'));
  const screen = calls.find((c) => c.args.some((a) => typeof a === 'string' && a.includes('روند‌گیریِ روزانه')));
  assert.ok(screen, 'صفحه‌ی روند نمایش داده شد');

  await bot.onCallback(cb(222, 'act:tmode:live'));
  assert.equal(cfg.trend.mode, 'off', 'ادمینِ غیرمالک نمی‌تواند');
  await bot.onCallback(cb(111, 'act:tmode:paper'));
  assert.equal(cfg.trend.mode, 'paper');
  assert.equal(cfg.overrides['trend.mode'], 'paper', 'در settings ذخیره می‌شود');
  await bot.onCallback(cb(111, 'act:tmode:off'));
  assert.equal(cfg.overrides['trend.mode'], undefined, 'برگشت به پیش‌فرض ← از overrides پاک');
});
