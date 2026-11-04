import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelRecord, stepLevel, levelStats, prune, setupRecord, levelAt } from '../src/journal.js';
import { step } from '../src/tracker.js';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 1);
const k = (i, l, h, c = (l + h) / 2) => ({ t: T0 + i * H, o: c, h, l, c, v: 1 });
const rec = (over = {}) => levelRecord({
  id: 'x', kind: 'watch', base: 'T', symbol: 'TUSDT', pretty: 'T/USDT', exchangeKey: 'lbank', exSymbol: 't_usdt',
  side: 'long', lvl: { t0: T0, p0: 100, perMs: 0 }, atr: 1, startT: T0, touchedT: T0, ...over,
});

test('سطح: حرکتِ ۱.۵ ATR به سمتِ برگشت ← bounce، کندلِ برخورد حساب نمی‌شود', () => {
  const r = rec();
  assert.equal(stepLevel(r, [k(0, 99, 110), k(1, 100.2, 101), k(2, 100.5, 101.6)]), true);
  assert.equal(r.outcome, 'bounce');
  assert.equal(r.closedAt, T0 + 2 * H);
});

test('سطح: کلوزِ ۱ ATR آن طرف ← break؛ هر دو در یک کندل ← break', () => {
  const r = rec();
  stepLevel(r, [k(1, 98.5, 100.5, 98.9)]);
  assert.equal(r.outcome, 'break');
  const q = rec();
  stepLevel(q, [k(1, 98, 102, 98.9)]);
  assert.equal(q.outcome, 'break');
});

test('سطح: مقاومت (فروش) قرینه است', () => {
  const r = rec({ side: 'short' });
  stepLevel(r, [k(1, 98.4, 100.1)]);
  assert.equal(r.outcome, 'bounce');
});

test('سطح: ۲۴ ساعت بی‌واکنش ← none؛ کندل‌ها دو بار شمرده نمی‌شوند', () => {
  const r = rec();
  const cs = Array.from({ length: 30 }, (_, i) => k(i + 1, 99.8, 100.6));
  stepLevel(r, cs.slice(0, 10));
  assert.equal(r.status, 'open');
  stepLevel(r, cs);
  assert.equal(r.outcome, 'none');
  assert.equal(r.closedAt, T0 + 24 * H);
});

test('نزدیک شدن به خط: نرسید ← noTouch؛ رسید ← واکنش از کندلِ بعد', () => {
  const far = rec({ kind: 'near', touchedT: null });
  stepLevel(far, Array.from({ length: 30 }, (_, i) => k(i, 103, 104)));
  assert.equal(far.outcome, 'noTouch');
  // خطِ صعودی: سطح در کندلِ ۵ = 105
  const up = rec({ kind: 'near', touchedT: null, lvl: { t0: T0, p0: 100, perMs: 1 / H } });
  assert.equal(levelAt(up.lvl, T0 + 5 * H), 105);
  stepLevel(up, [k(0, 103, 104), k(5, 105.1, 106), k(6, 106, 108.6)]);
  assert.equal(up.touchedT, T0 + 5 * H);
  assert.equal(up.outcome, 'bounce');
});

test('آمار و هرس', () => {
  const list = [rec(), rec({ id: 'y' }), rec({ id: 'z', kind: 'near', touchedT: null })];
  stepLevel(list[0], [k(1, 100, 102)]);
  stepLevel(list[1], [k(1, 98, 100, 98.5)]);
  stepLevel(list[2], Array.from({ length: 30 }, (_, i) => k(i, 103, 104)));
  const st = levelStats(list);
  assert.deepEqual([st.closed, st.touched, st.bounce, st.break, st.noTouch], [3, 2, 1, 1, 1]);
  assert.equal(st.bounceRate, 0.5);
  const map = Object.fromEntries(list.map((x) => [x.id, x]));
  prune(map);
  assert.equal(Object.keys(map).length, 3);
});

test('ستاپ: از کلوزِ کندلِ اسکن پیگیری می‌شود، مثلِ سیگنالِ منتشرشده', () => {
  const row = {
    item: { id: 'TUSDT', base: 'T' }, data: { pretty: 'T/USDT', exchangeKey: 'lbank', symbol: 't_usdt' },
    result: { direction: 'long', score: 60, plan: { entry: 100, sl: 98, tps: [{ label: 'TP1', price: 102, rr: 1 }, { label: 'TP2', price: 104, rr: 2 }] } },
  };
  const s = setupRecord({ key: 'K', row, closeT: T0, alerted: false, maxHoldHours: 120 });
  assert.equal(s.kind, 'setup');
  assert.equal(s.alerted, false);
  assert.equal('channelMsgId' in s, false);
  const M5 = 300_000;
  step(s, [{ t: T0 - M5, o: 100, h: 90, l: 90, c: 90 }, { t: T0, o: 100, h: 102.1, l: 99.5, c: 102 }, { t: T0 + M5, o: 102, h: 102, l: 99.9, c: 100 }], T0 + 2 * M5);
  assert.equal(s.outcome, 'be');
  assert.ok(Math.abs(s.realized - 0.5) < 1e-9);
});
