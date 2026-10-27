/**
 * پنل: یک پیام که با هر دکمه ویرایش می‌شود. همه‌چیز بدونِ شبکه.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { longSetup, candlesFrom, path } from './fixtures.js';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'signal-panel-'));

let createBot;
let loadConfig;
let buildChartSvg;
let analyze;
before(async () => {
  ({ createBot } = await import('../src/telegram/bot.js'));
  ({ loadConfig } = await import('../src/config.js'));
  ({ buildChartSvg } = await import('../src/chart/render.js'));
  ({ analyze } = await import('../src/strategy/analyze.js'));
});

const hour = () => Math.floor(Date.now() / 3_600_000) * 3_600_000;
function shifted(c) {
  const shift = hour() - c.at(-1).t - 3_600_000;
  return c.map((k) => ({ ...k, t: k.t + shift }));
}

// LBank: TEST ستاپ دارد، FLAT خطی ندارد، MAGMA نیست. بایننس 451 (سرورِ آمریکا). MEXC: MAGMA هست.
globalThis.fetch = async (url) => {
  const u = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (u.includes('lbkex')) {
    if (u.includes('symbol=test_usdt')) return json({ result: 'true', data: shifted(longSetup()).map((k) => [k.t / 1000, k.o, k.h, k.l, k.c, k.v]) });
    if (u.includes('symbol=flat_usdt')) {
      const c = shifted(candlesFrom(path([[0, 100], [200, 60]])));
      return json({ result: 'true', data: c.map((k) => [k.t / 1000, k.o, k.h, k.l, k.c, k.v]) });
    }
    return json({ result: 'false', msg: 'currency pair nonsupport', error_code: 10008 });
  }
  if (u.includes('binance')) return json({ code: 0, msg: 'Service unavailable from a restricted location' }, 451);
  if (u.includes('mexc') && u.includes('MAGMAUSDT')) {
    return json(shifted(longSetup()).map((k) => [k.t, String(k.o), String(k.h), String(k.l), String(k.c), String(k.v)]));
  }
  if (u.includes('mexc')) return json({ code: -1121, msg: 'Invalid symbol.' }, 400);
  if (u.includes('gateio')) return json({ label: 'INVALID_CURRENCY_PAIR', message: 'Invalid currency pair' }, 400);
  if (u.includes('bitget')) return json({ code: '40034', msg: 'Parameter does not exist' }, 400);
  return json({}, 404);
};

function fakeApi() {
  const calls = [];
  let mid = 500;
  const rec = (name) => async (...args) => {
    calls.push({ name, args });
    return { message_id: ++mid };
  };
  return {
    calls,
    sendPhoto: rec('sendPhoto'), sendMessage: rec('sendMessage'), editCaption: rec('editCaption'),
    editText: rec('editText'), deleteMessage: rec('deleteMessage'), answer: rec('answer'), call: rec('call'),
  };
}

function setup() {
  const cfg = loadConfig();
  cfg.watchlist = [{ id: 'TESTUSDT', base: 'TEST' }, { id: 'FLATUSDT', base: 'FLAT' }, { id: 'MAGMAUSDT', base: 'MAGMA' }];
  cfg.candles = 140;
  cfg.minCandles = 120;
  const api = fakeApi();
  const bot = createBot({ api, env: { adminIds: ['7'], channelId: '@c' }, cfg, log: { info() {}, warn() {}, error() {} } });
  const press = (data, msgId = 900) => bot.onCallback({ id: 'q', data, from: { id: 7 }, message: { chat: { id: 7 }, message_id: msgId } });
  const type = (text) => bot.onMessage({ text, from: { id: 7 }, chat: { id: 7 }, message_id: 1 });
  const lastScreen = () => [...api.calls].reverse().find((c) => c.name === 'editText' || c.name === 'sendMessage');
  const btns = (call) => (call.name === 'editText' ? call.args[3] : call.args[2]?.buttons).flat();
  return { cfg, api, bot, press, type, lastScreen, btns };
}

test('پنل: /panel یک پیام می‌فرستد و دکمه‌ها همان را ویرایش می‌کنند', async () => {
  const { api, press, type, lastScreen } = setup();
  await type('/panel');
  assert.equal(api.calls.at(-1).name, 'sendMessage');
  assert.match(api.calls.at(-1).args[1], /پنلِ بات سیگنال/);
  const sends = api.calls.filter((c) => c.name === 'sendMessage').length;
  await press('nav:st');
  await press('nav:set');
  await press('nav:wl');
  assert.equal(api.calls.filter((c) => c.name === 'sendMessage').length, sends, 'ناوبری نباید پیامِ تازه بسازد');
  assert.match(lastScreen().args[2], /واچ‌لیست/);
});

test('اسکن از پنل: نتایج با توضیح، و MAGMA از MEXC وقتی بایننس 451 می‌دهد', async () => {
  const { press, lastScreen, btns } = setup();
  await press('act:scan');
  const res = lastScreen().args[2];
  assert.match(res, /TESTUSDT/);
  assert.match(res, /FLATUSDT.*خط روندِ صعودیِ معتبری نیست/);
  assert.doesNotMatch(res, /MAGMAUSDT.*داده نیامد/, 'MAGMA باید از MEXC بیاید');
  assert.ok(btns(lastScreen()).some((b) => b.callback_data === 'nav:coin:TEST'));

  await press('nav:coin:MAGMA');
  assert.match(lastScreen().args[2], /MEXC/);
  await press('nav:coin:FLAT');
  assert.match(lastScreen().args[2], /دو کفِ ماژورِ بالارونده پیدا نشد/);
});

test('چارت از پنل: با پلن ← دکمه‌ی انتشار؛ بی‌خط ← عکس با دکمه‌ی بستن', async () => {
  const { api, press } = setup();
  await press('act:chart:TEST');
  let photo = api.calls.filter((c) => c.name === 'sendPhoto').at(-1);
  assert.ok(Buffer.isBuffer(photo.args[1]));
  assert.match(JSON.stringify(photo.args[3]), /ok:/);

  await press('act:chart:FLAT');
  photo = api.calls.filter((c) => c.name === 'sendPhoto').at(-1);
  assert.match(JSON.stringify(photo.args[3]), /act:close/);
});

test('استراتژی: + و − مقدار را عوض و ذخیره می‌کنند؛ پیش‌فرض برمی‌گرداند', async () => {
  const { cfg, press, lastScreen } = setup();
  const before = cfg.strategy.trendline.pivotStrength;
  await press('act:inc:1:1');
  assert.equal(cfg.strategy.trendline.pivotStrength, before + 1);
  assert.equal(loadConfig().strategy.trendline.pivotStrength, before + 1, 'روی دیسک ذخیره نشد');
  assert.match(lastScreen().args[2], /مقدارِ فعلی/);
  await press('act:def:1');
  assert.equal(cfg.strategy.trendline.pivotStrength, before);
  assert.equal(loadConfig().overrides['strategy.trendline.pivotStrength'], undefined);
});

test('استراتژی: نوشتنِ مقدارِ دلخواه — نامعتبر رد، معتبر ذخیره', async () => {
  const { cfg, press, type, lastScreen } = setup();
  await press('act:in:2');
  await type('abc');
  assert.match(lastScreen().args[2], /عدد بنویس/);
  await type('99');
  assert.match(lastScreen().args[2], /باید بین/);
  await type('3.5');
  assert.equal(cfg.strategy.trendline.minBounceAtr, 3.5);
  await press('act:def:2');
});

test('شرط‌ها: روشن کردنِ فیلترِ روند، الزامی، وزن؛ خط روند خاموش‌شدنی نیست', async () => {
  const { cfg, press, lastScreen, btns } = setup();
  await press('nav:cond:trendline');
  assert.ok(!btns(lastScreen()).some((b) => /خاموش/.test(b.text)), 'خط روند دکمه‌ی خاموش دارد');
  await press('nav:cond:trendFilter');
  const toggle = btns(lastScreen()).find((b) => /روشن شود/.test(b.text));
  await press(toggle.callback_data);
  assert.equal(cfg.strategy.conditions.trendFilter.enabled, true);
  const weightUp = btns(lastScreen()).find((b) => b.text === '+ 5');
  await press(weightUp.callback_data);
  assert.equal(cfg.strategy.conditions.trendFilter.weight, 20);
  await press('act:rg:trendFilter');
  assert.equal(cfg.strategy.conditions.trendFilter.enabled, false);
  assert.equal(cfg.strategy.conditions.trendFilter.weight, 15);
});

test('شرطِ الزامیِ ناموفق هشدار را می‌بندد', () => {
  const cfg = loadConfig();
  cfg.strategy.conditions.trendFilter = { enabled: true, weight: 15, required: true };
  cfg.strategy.trendFilter.emaPeriod = 20;
  const r = analyze(longSetup(), cfg, 'long');
  // در پایانِ اصلاح، قیمت زیرِ EMA ِ کوتاه است
  assert.equal(r.trend.above, false);
  assert.deepEqual(r.blocked, ['trendFilter']);
  assert.equal(r.alertable, false);
});

test('واچ‌لیست: افزودن با تایپ، و حذف با تأیید', async () => {
  const { cfg, press, type, lastScreen } = setup();
  await press('nav:add');
  await type('magma nosuchcoin');
  const t = lastScreen().args[2];
  assert.match(t, /MAGMAUSDT از قبل/);
  assert.match(t, /NOSUCHCOINUSDT: در هیچ صرافی‌ای پیدا نشد/);
  await press('act:rm?:FLAT');
  assert.match(lastScreen().args[2], /حذف شود/);
  await press('act:rm:FLAT');
  assert.ok(!cfg.watchlist.some((w) => w.base === 'FLAT'));
});

test('تنظیمات: فاصله‌ی اسکن، جهت و آستانه از دکمه', async () => {
  const { cfg, press, lastScreen } = setup();
  await press('act:every:1h');
  assert.equal(cfg.scanEvery, '1h');
  await press('act:dir:both');
  assert.deepEqual(cfg.directions, ['long', 'short']);
  const th = cfg.alertThreshold;
  await press('act:th:1');
  assert.equal(cfg.alertThreshold, th + 5);
  assert.match(lastScreen().args[2], /تنظیمات/);
  await press('act:th:-1');
  await press('act:dir:long');
  await press('act:every:4h');
});

test('چارت بدونِ خط و با خطِ دور: بدونِ NaN', () => {
  const cfg = loadConfig();
  const flat = candlesFrom(path([[0, 100], [200, 60]]));
  const meta = { pretty: 'X/USDT', exchange: 'LBank', timeframe: '1h' };
  const svg1 = buildChartSvg({ candles: flat, result: null, meta });
  assert.ok(svg1.includes('NO TRENDLINE') && !svg1.includes('NaN'));

  // ستاپ، بعد صعودِ تند ← خط دور می‌شود
  const c = longSetup();
  const up = candlesFrom(path([[0, c.at(-1).c], [20, c.at(-1).c + 15]]), c.at(-1).t + 3_600_000).slice(1);
  const far = [...c, ...up];
  const r = analyze(far, cfg, 'long');
  assert.equal(r.line.state, 'far');
  assert.equal(r.score, 0);
  const svg2 = buildChartSvg({ candles: far, result: r, meta });
  assert.ok(svg2.includes('ATR to trendline') && !svg2.includes('NaN'));
});
