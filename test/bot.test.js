/**
 * جریانِ کامل بدونِ شبکه: صرافی با fetchِ ساختگی، تلگرام با APIِ ساختگی.
 * اسکن ← هشدار به ادمین ← «انتشار» ← دو پست در کانال ← دکمه‌ها برداشته.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { longSetup } from './fixtures.js';
import cfgJson from '../config/default.json' with { type: 'json' };

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'signal-bot-'));

let createBot;
before(async () => {
  ({ createBot } = await import('../src/telegram/bot.js'));
});

// کندل‌ها را به «حالا» می‌آوریم تا closedOnly حذفشان نکند
function lbankBody() {
  const c = longSetup();
  const shift = Math.floor(Date.now() / 3_600_000) * 3_600_000 - c.at(-1).t - 3_600_000;
  return { result: 'true', data: c.map((k) => [(k.t + shift) / 1000, k.o, k.h, k.l, k.c, k.v]) };
}

globalThis.fetch = async (url) => {
  const body = String(url).includes('lbkex') ? lbankBody() : { msg: 'no' };
  return new Response(JSON.stringify(body), { status: 200 });
};

function fakeApi() {
  const calls = [];
  let mid = 100;
  const rec = (name) => async (...args) => {
    calls.push({ name, args });
    return { message_id: ++mid };
  };
  return {
    calls,
    sendPhoto: rec('sendPhoto'),
    sendMessage: rec('sendMessage'),
    editCaption: rec('editCaption'),
    answer: rec('answer'),
    call: rec('call'),
  };
}

const quiet = { info() {}, warn() {}, error() {} };

function setup() {
  const cfg = structuredClone(cfgJson);
  cfg.watchlist = [{ id: 'TESTUSDT', base: 'TEST' }];
  cfg.candles = 140;
  cfg.minCandles = 120;
  const api = fakeApi();
  const env = { adminIds: ['111'], channelId: '@chan' };
  return { cfg, api, env, bot: createBot({ api, env, cfg, log: quiet }) };
}

test('اسکن ← هشدار با عکس و دکمه ← تأیید ← انتشار در کانال', async () => {
  const { api, bot } = setup();
  await bot.runScan();

  const alert = api.calls.find((c) => c.name === 'sendPhoto');
  assert.ok(alert, 'هشداری فرستاده نشد');
  assert.equal(alert.args[0], '111');
  assert.ok(Buffer.isBuffer(alert.args[1]) && alert.args[1].length > 10_000, 'عکس خالی است');
  const okBtn = alert.args[3].buttons[0][0].callback_data;
  assert.match(okBtn, /^ok:/);

  api.calls.length = 0;
  await bot.decide({ id: 'cb1', from: { id: 111, username: 'admin' } }, true, okBtn.slice(3));

  const photo = api.calls.find((c) => c.name === 'sendPhoto');
  const signal = api.calls.find((c) => c.name === 'sendMessage');
  assert.equal(photo.args[0], '@chan');
  assert.match(photo.args[2], /تحلیل TEST\/USDT/);
  assert.equal(signal.args[0], '@chan');
  assert.match(signal.args[1], /سیگنال خرید/);
  const photoId = 100 + api.calls.indexOf(photo) + 1 + 0;
  assert.ok(signal.args[2].replyTo > 100, 'سیگنال در پاسخ به پستِ تحلیل');
  void photoId;
  assert.ok(api.calls.some((c) => c.name === 'editCaption' && /منتشر شد/.test(c.args[2])));

  // دوباره زدن چیزی منتشر نمی‌کند
  api.calls.length = 0;
  await bot.decide({ id: 'cb2', from: { id: 111 } }, true, okBtn.slice(3));
  assert.ok(!api.calls.some((c) => c.name === 'sendPhoto'));
});

test('همان ستاپ در دورِ بعد دوباره هشدار نمی‌دهد (cooldown)', async () => {
  const { api, bot } = setup();
  await bot.runScan();
  const n = api.calls.filter((c) => c.name === 'sendPhoto').length;
  assert.equal(n, 0, 'ستاپِ تست اول قبلاً هشدار گرفته');
});

test('غیرِ ادمین نمی‌تواند تأیید کند', async () => {
  const { api, bot, cfg } = setup();
  cfg.cooldownHours = 0;
  await bot.runScan();
  const okBtn = api.calls.find((c) => c.name === 'sendPhoto').args[3].buttons[0][0].callback_data;
  api.calls.length = 0;
  await bot.onCallback({ id: 'x', from: { id: 999 }, data: okBtn });
  assert.ok(api.calls.every((c) => c.args[0] !== '@chan'), 'غیرِ ادمین منتشر کرد');
  assert.equal(api.calls[0].name, 'answer');

  // دستورِ ادمینی از غیرِ ادمین بی‌جواب می‌ماند
  api.calls.length = 0;
  await bot.onMessage({ text: '/remove TEST', from: { id: 999 }, chat: { id: 999 } });
  assert.equal(api.calls.length, 0);
  assert.equal(cfg.watchlist.length, 1);
});

test('هشدارِ «در حالِ انتشار»: پیامِ درست به ادمینِ دوم، و باز شدن بعد از ری‌استارت', async () => {
  const { store } = await import('../src/store.js');
  const { api, bot, cfg } = setup();
  cfg.cooldownHours = 0;
  await bot.runScan();
  const id = api.calls.find((c) => c.name === 'sendPhoto').args[3].buttons[0][0].callback_data.slice(3);
  store.updateAlert(id, { status: 'publishing' });

  api.calls.length = 0;
  await bot.decide({ id: 'cb', from: { id: 111 } }, true, id);
  assert.match(api.calls[0].args[1], /در حالِ انتشار/);
  assert.doesNotMatch(api.calls[0].args[1], /رد شده/);

  // ری‌استارت: یک بات تازه روی همان state
  const again = setup();
  Object.assign(again.api, {
    getMe: async () => ({ id: 1, username: 'b' }),
    deleteWebhook: async () => true,
    setCommands: async () => true,
    getUpdates: () => new Promise(() => {}),
  });
  again.bot.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.alert(id).status, 'pending');
  assert.ok(again.api.calls.some((c) => c.name === 'sendMessage' && /نیمه‌کاره/.test(c.args[1])), 'مالک خبر نگرفت');
});
