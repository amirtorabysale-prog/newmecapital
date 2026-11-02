import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rsi } from '../src/strategy/indicators.js';
import { wilderState, liveRsi, buildZones, simulateTrade, aggregate, RSI3_DEFAULTS, M5, H1 } from '../src/strategy/rsi3.js';

test('RSI ِ زنده همان RSI ِ کندلی است که با قیمتِ فعلی بسته شود', () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 5) + (i % 7) * 0.3);
  const st = wilderState(closes);
  const k = closes.length - 2;
  const price = 93.7;
  const full = rsi([...closes.slice(0, k + 1), price]).at(-1);
  assert.ok(Math.abs(liveRsi(st, closes, k, price) - full) < 1e-9);
  // تجمیع: ۱۲ کندلِ ۵ دقیقه = یک کندلِ یک ساعته
  const c5 = Array.from({ length: 24 }, (_, i) => ({ t: i * M5, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1 }));
  const h1 = aggregate(c5, H1);
  assert.equal(h1.length, 2);
  assert.deepEqual(h1[0], { t: 0, o: 0, h: 12, l: -1, c: 11.5, v: 12 });
});

test('ناحیه‌ها خوشه می‌شوند؛ استاپ و تارگت در یک کندل یعنی استاپ', () => {
  // دو کفِ نزدیک (۱۰۰ و ۱۰۰.۱) با ATR=۱ یک ناحیه با دو برخورد می‌شوند
  const h1 = Array.from({ length: 60 }, (_, i) => ({ t: i * H1, o: 105, h: 106, l: 104, c: 105, v: 1 }));
  h1[15].l = 100; h1[40].l = 100.1;
  const z = buildZones(h1, 59, 1, RSI3_DEFAULTS).find((q) => q.lo === 100);
  assert.equal(z.touches, 2);
  assert.equal(z.hi, 100.1);
  // زنجیره نمی‌شود: ۱۰۰ و ۱۰۰.۲ و ۱۰۰.۴ با ATR=۱ دو ناحیه‌اند، نه یکی به پهنای ۰.۴
  h1[25].l = 100.2; h1[50].l = 100.4; h1[40].l = 104;
  const zs = buildZones(h1, 59, 1, RSI3_DEFAULTS).filter((q) => q.lo < 101);
  assert.equal(zs.length, 2);

  const plan = { dir: 'long', t: 0, entry: 100, sl: 99, risk: 1, tp1: 102, tp2: 103 };
  const c5 = [{ t: -M5, o: 100, h: 100, l: 100, c: 100 }, { t: 0, o: 100, h: 102.5, l: 98.5, c: 100 }];
  const sim = simulateTrade(c5, 0, plan, RSI3_DEFAULTS);
  assert.equal(sim.outcome, 'SL');
  assert.ok(Math.abs(sim.gross + 1) < 1e-9);
  assert.ok(sim.r < -1); // کارمزد کم شده
  // نصف در TP1، بقیه سربه‌سر
  const c5b = [c5[0], { t: 0, o: 100, h: 102.2, l: 100.5, c: 101 }, { t: M5, o: 101, h: 101, l: 99.9, c: 100 }];
  const s2 = simulateTrade(c5b, 0, plan, RSI3_DEFAULTS);
  assert.equal(s2.outcome, 'TP1+BE');
  assert.ok(Math.abs(s2.gross - 1) < 1e-9);
});
