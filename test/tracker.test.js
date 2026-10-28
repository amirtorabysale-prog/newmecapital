import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSignal, step, summarize, catchUp, needsCatchUp } from '../src/tracker.js';
import { applyEdits, validatePlan, hasEdits, checkLivePrice } from '../src/planEdit.js';

const T0 = Date.UTC(2026, 9, 1, 12);
const M5 = 300_000;
const plan = {
  entry: 100, sl: 98, risk: 2, riskPct: 2,
  tps: [{ label: 'TP1', price: 102, rr: 1 }, { label: 'TP2', price: 104, rr: 2 }, { label: 'TP3', price: 106, rr: 3 }],
};
const sig = (over = {}) => newSignal({
  id: 'x', item: { id: 'TESTUSDT' }, data: { pretty: 'TEST/USDT', exchangeKey: 'lbank', symbol: 'test_usdt' },
  direction: 'long', plan, publishedAt: T0, channelMsgId: 5, maxHoldHours: 120, ...over,
});
// کندلِ i ام بعد از انتشار
const k = (i, l, h, c = (l + h) / 2) => ({ t: T0 + i * M5, o: c, h, l, c, v: 1 });

test('پیگیری: سه تارگت پشتِ‌سرِ هم ← کامل بسته، R = (1+2+3)/3', () => {
  const s = sig();
  const ev = step(s, [k(0, 99.5, 101), k(1, 100.5, 102.5), k(2, 101, 104.2), k(3, 103, 106.1)], T0 + 4 * M5);
  assert.deepEqual(ev.map((e) => `${e.type}${e.index ?? ''}`), ['tp1', 'tp2', 'tp3']);
  assert.equal(s.status, 'closed');
  assert.equal(s.outcome, 'tp_all');
  assert.ok(Math.abs(s.realized - 2) < 1e-9);
});

test('پیگیری: حد ضرر پیش از هر تارگت ← −1R', () => {
  const s = sig();
  const ev = step(s, [k(0, 99, 101), k(1, 97.9, 99.5)], T0 + 2 * M5);
  assert.equal(ev[0].type, 'sl');
  assert.equal(s.realized, -1);
});

test('پیگیری: بعد از تارگتِ ۱ برگشت به ورود ← سربه‌سر، فقط سهمِ تارگتِ ۱', () => {
  const s = sig();
  step(s, [k(0, 100.5, 102.2)], T0 + M5);
  assert.equal(s.slNow, 100, 'حد ضرر به ورود نرفت');
  const ev = step(s, [k(0, 100.5, 102.2), k(1, 99.9, 101)], T0 + 2 * M5);
  assert.deepEqual(ev.map((e) => e.type), ['be'], 'کندلِ خوانده‌شده دوباره شمرده شد');
  assert.ok(Math.abs(s.realized - 1 / 3) < 1e-9);
});

test('پیگیری: یک کندل هم حد ضرر هم تارگت ← بدبینانه حد ضرر', () => {
  const s = sig();
  const ev = step(s, [k(0, 97.5, 102.5)], T0 + M5);
  assert.equal(ev[0].type, 'sl');
});

test('پیگیری: کندلِ پیش از انتشار حساب نمی‌شود', () => {
  const s = sig();
  const ev = step(s, [{ t: T0 - M5, o: 100, h: 110, l: 90, c: 100 }], T0 + M5);
  assert.equal(ev.length, 0);
  assert.equal(s.status, 'open');
});

test('پیگیری: پایانِ زمان ← با قیمتِ آخر بسته می‌شود', () => {
  const s = sig({ maxHoldHours: 1 });
  const ev = step(s, [k(0, 99.5, 100.5), k(13, 100.5, 101.5, 101)], T0 + 2 * 3_600_000);
  assert.equal(ev.at(-1).type, 'expired');
  assert.ok(Math.abs(s.realized - 0.5) < 1e-9);
});

test('پیگیری: فروش قرینه است', () => {
  const short = {
    entry: 100, sl: 102, risk: 2, riskPct: 2,
    tps: [{ label: 'TP1', price: 98, rr: 1 }, { label: 'TP2', price: 96, rr: 2 }],
  };
  const s = sig({ direction: 'short', plan: short });
  const ev = step(s, [k(0, 97.9, 100.5), k(1, 95.9, 98)], T0 + 2 * M5);
  assert.deepEqual(ev.map((e) => e.type), ['tp', 'tp']);
  assert.ok(Math.abs(s.realized - 1.5) < 1e-9);
});

test('کارنامه: درصدِ موفقیت و جمعِ R', () => {
  const a = sig(); step(a, [k(0, 97, 99)], T0 + M5); // sl
  const b = sig(); step(b, [k(0, 100.5, 102.2), k(1, 99, 100.5)], T0 + 2 * M5); // be
  const c = sig(); // باز
  const st = summarize([a, b, c]);
  assert.equal(st.total, 3);
  assert.equal(st.open, 1);
  assert.equal(st.wins, 1);
  assert.equal(st.losses, 1);
  assert.ok(Math.abs(st.totalR - (-1 + 1 / 3)) < 1e-9);
});

test('ویرایشِ پلن: R:R دوباره حساب می‌شود، تارگتِ حذف‌شده می‌رود، JSON سالم می‌ماند', () => {
  const e = { sl: 99, tps: { 1: null } };
  const roundTrip = JSON.parse(JSON.stringify(e));
  const p = applyEdits(plan, 'long', roundTrip);
  assert.equal(p.risk, 1);
  assert.deepEqual(p.tps.map((t) => t.price), [102, 106]);
  assert.deepEqual(p.tps.map((t) => t.rr), [2, 6]);
  assert.deepEqual(p.tps.map((t) => t.label), ['TP1', 'TP2']);
  assert.equal(validatePlan(p, 'long'), null);
  assert.ok(hasEdits(roundTrip));
  assert.ok(!hasEdits({}));
});

test('ویرایشِ پلن: حد ضرر بالای ورود و تارگتِ زیرِ ورود رد می‌شوند', () => {
  assert.match(validatePlan(applyEdits(plan, 'long', { sl: 101 }), 'long'), /حد ضرر باید زیرِ/);
  assert.match(validatePlan(applyEdits(plan, 'long', { tps: { 0: 99 } }), 'long'), /تارگت باید بالای/);
  assert.match(validatePlan(applyEdits(plan, 'long', { tps: { 0: null, 1: null, 2: null } }), 'long'), /دست‌کم یک تارگت/);
});

test('پیگیری بعد از خاموشیِ طولانی: اولِ فاصله با کندلِ ساعتی، بی‌هم‌پوشانی با 5 دقیقه', () => {
  const H = 3_600_000;
  const s = sig();
  const now = T0 + 100 * H;
  assert.ok(needsCatchUp(s, now));
  assert.ok(!needsCatchUp(s, T0 + 10 * H));
  // حد ضرر در ساعتِ دهم خورده — بیرون از پنجره‌ی 1000 کندلِ 5 دقیقه
  const hourly = Array.from({ length: 100 }, (_, i) => ({ t: T0 + i * H, o: 100, c: 100, h: 100.5, l: i === 10 ? 97 : 99.5, v: 1 }));
  const recentStart = now - 1000 * M5 + 2 * 60_000; // وسطِ یک ساعت
  const recent = Array.from({ length: 999 }, (_, i) => ({ t: Math.ceil(recentStart / M5) * M5 + i * M5, o: 100, c: 100, h: 100.5, l: 99.5, v: 1 }));
  const merged = catchUp(hourly, recent, s.lastT);
  for (let i = 1; i < merged.length; i++) assert.ok(merged[i].t > merged[i - 1].t, 'ترتیب یا هم‌پوشانی');
  const cut = merged[merged.findIndex((k, i) => i && k.t - merged[i - 1].t === M5) - 1].t;
  assert.equal(cut % H, 0, '5 دقیقه باید از مرزِ ساعت شروع شود');
  const ev = step(s, merged, now);
  assert.equal(ev[0]?.type, 'sl');
  assert.equal(ev[0].t, T0 + 10 * H);

  // کندلِ ساعتی‌ای که lastT وسطش است هم دیده می‌شود
  const mid = catchUp(hourly, recent, T0 + 10 * H + 20 * 60_000);
  assert.equal(mid[0].t, T0 + 10 * H + 20 * 60_000);
});

test('انتشار با قیمتِ فعلی: گذشتن از حد ضرر یا تارگتِ اول، یا دور شدن از ورود ← رد', () => {
  // ورود 100، حد ضرر 98، تارگتِ اول 102، ATR 1، حداکثر 0.5 ATR
  assert.equal(checkLivePrice(plan, 'long', 100.3, 1, 0.5), null);
  assert.match(checkLivePrice(plan, 'long', 97.9, 1, 0.5), /حد ضرر/);
  assert.match(checkLivePrice(plan, 'long', 102.1, 1, 0.5), /تارگتِ اول/);
  assert.match(checkLivePrice(plan, 'long', 100.8, 1, 0.5), /0.8 ATR/);
  const short = { entry: 100, sl: 102, tps: [{ label: 'TP1', price: 98, rr: 1 }] };
  assert.equal(checkLivePrice(short, 'short', 99.8, 1, 0.5), null);
  assert.match(checkLivePrice(short, 'short', 102.2, 1, 0.5), /حد ضرر/);
  assert.match(checkLivePrice(short, 'short', 97.5, 1, 0.5), /تارگتِ اول/);
});
