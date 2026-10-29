import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanDrawing, trendAt, levelsAt, touches, timeToLogical, logicalToTime, summarize } from '../src/strategy/watch.js';
import { fitFib } from '../src/strategy/fit.js';

const H = 3_600_000;
const k = (i, o, h, l, c) => ({ t: i * H, o, h, l, c, v: 1 });

test('رسمِ آزاد: ورودیِ نامعتبر رد، معتبر تمیز', () => {
  assert.throws(() => cleanDrawing({ kind: 'x', points: [] }));
  assert.throws(() => cleanDrawing({ kind: 'trend', points: [{ t: 1, p: 2 }] }));
  assert.throws(() => cleanDrawing({ kind: 'trend', points: [{ t: 1, p: 2 }, { t: 1, p: 3 }] }));
  assert.throws(() => cleanDrawing({ kind: 'hline', points: [{ t: 1, p: -2 }] }));
  const d = cleanDrawing({ id: 'a<b>', kind: 'fib', points: [{ t: 1, p: 1 }, { t: 2, p: 2 }], levels: [0.618, 9], alerted: { x: 1 } });
  assert.equal(d.id, 'ab');
  assert.deepEqual(d.levels, [0.618]);
  // وضعیتِ تماشا مالِ سرور است
  assert.equal(d.alerted, undefined);
});

test('رسمِ آزاد: خطِ روند پرتو است و از نقطه‌ی اول به بعد', () => {
  const d = { kind: 'trend', points: [{ t: 0, p: 100 }, { t: 10 * H, p: 110 }] };
  assert.equal(trendAt(d, 20 * H), 120);
  assert.equal(levelsAt(d, -H).length, 0);
  assert.equal(levelsAt(d, 20 * H)[0].price, 120);
});

test('رسمِ آزاد: برخورد از بالا حمایت (خرید)، از پایین مقاومت (فروش)', () => {
  const line = { kind: 'hline', points: [{ t: 0, p: 100 }] };
  const fromAbove = [k(0, 105, 106, 104, 105), k(1, 105, 105, 99.9, 101)];
  assert.deepEqual(touches(line, fromAbove, 1).map((x) => x.side), ['long']);
  const fromBelow = [k(0, 95, 96, 94, 95), k(1, 95, 100.1, 95, 99)];
  assert.deepEqual(touches(line, fromBelow, 1).map((x) => x.side), ['short']);
  const far = [k(0, 95, 96, 94, 95), k(1, 95, 97, 94, 96)];
  assert.equal(touches(line, far, 1).length, 0);
});

test('رسمِ آزاد: زمان ↔ شماره‌ی کندل، حتی بعد از آخرین کندل', () => {
  const cs = [k(0, 1, 1, 1, 1), k(1, 1, 1, 1, 1), k(2, 1, 1, 1, 1)];
  assert.equal(timeToLogical(cs, 1.5 * H, H), 1.5);
  assert.equal(timeToLogical(cs, 5 * H, H), 5);
  assert.equal(logicalToTime(cs, 4, H), 4 * H);
});

test('رسمِ آزاد: خلاصه وقتی بیشترِ فیبوها از برخوردِ اول‌اند پیشنهاد می‌دهد', () => {
  const fib = (anchor) => ({ kind: 'fib', features: { anchor, gap: 30, rsi: [25, 60] } });
  const s = summarize({ ADA: [fib('line1'), fib('line1')], BTC: [fib('line1'), fib('line2')] });
  assert.equal(s.total, 4);
  assert.equal(s.coins, 2);
  assert.equal(s.suggest, 'fibFromLine1');
});

test('فیبوی استاد: ❌ نقطه‌های بات را با زمان می‌گوید و دکمه‌ی درست کردن دارد', () => {
  const cs = Array.from({ length: 60 }, (_, i) => k(i, 100 + i, 101 + i, 99 + i, 100 + i));
  const strategy = { atrPeriod: 14, fib: { level: 0.618, toleranceAtr: 0.5, nearToleranceAtr: 1 } };
  // خط در کندلِ برخورد روی سطحِ 0.618 ِ فیبوی بات (151 − 0.618 × 12)
  const bot = { line: { a: 0, b: 10, p0: 143.6, slope: 0 }, lowIdx: 40, highIdx: 50, k: 55 };
  const f = fitFib(cs, strategy, bot, 5, 30);
  assert.equal(f.ok, false);
  assert.deepEqual(f.fix.to, [40, 50]);
  assert.equal(fitFib(cs, strategy, bot, ...f.fix.to).ok, true);
  assert.match(f.reasons[0], /UTC/);
  assert.doesNotMatch(f.reasons[0], /کندلِ 40/);
  // اگر حتی فیبوی خودِ بات جور نشود، پیشنهادی نمی‌دهد که دوباره ❌ بگیرد
  const far = fitFib(cs, strategy, { ...bot, line: { ...bot.line, p0: 99, slope: 1 } }, 5, 30);
  assert.equal(far.fix, undefined);
  assert.match(far.reasons.at(-1), /حتی فیبوی خودِ بات/);
});

test('رسم‌ها روی دیسک: جایگزینی، حفظِ وضعیتِ هشدار، ردِ ورودیِ بد', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'draw-'));
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const { drawings } = await import('../src/drawings.js');
    drawings._reset();
    const d = { id: 'x1', kind: 'hline', points: [{ t: 1, p: 5 }] };
    drawings.put('ADA', [d]);
    drawings.markAlerted('ADA', 'x1', 'h', 123);
    drawings.put('ADA', [d]);
    assert.deepEqual(drawings.of('ADA')[0].alerted, { h: 123 });
    assert.throws(() => drawings.put('ADA', [{ kind: 'nope' }]), (e) => e.status === 400);
    drawings.put('ADA', []);
    drawings._reset();
    assert.deepEqual(drawings.all(), {});
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('رسمِ آزاد: نوسان دورِ سطح فقط یک هشدار می‌دهد', async () => {
  const { freshTouches } = await import('../src/strategy/watch.js');
  const line = { kind: 'hline', points: [{ t: 0, p: 100 }] };
  const cs = [k(0, 105, 106, 104, 105), k(1, 105, 105, 99.9, 101), k(2, 101, 102, 99.8, 100.5), k(3, 100.5, 101, 99.9, 100.2)];
  assert.equal(freshTouches(line, cs.slice(0, 2), 1).length, 1);
  assert.equal(freshTouches(line, cs.slice(0, 3), 1).length, 0);
  assert.equal(freshTouches(line, cs, 1).length, 0);
});
