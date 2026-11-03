import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backtestPullback, simulatePullback, pbStats, PULLBACK_DEFAULTS } from '../src/strategy/pullback.js';

const H = 3_600_000;
const bar = (i, c, w = 0.3) => ({ t: i * H, o: c, h: c + w, l: c - w, c, v: 1 });

test('روندِ صعودی + افتِ اشباعی ← یک خرید که به تارگت می‌رسد', () => {
  const h1 = [];
  let c = 100;
  for (let i = 0; i < 400; i++) {
    if (i >= 300 && i < 305) c -= 1;      // افتِ تند: RSI زیرِ ۳۰
    else if (i >= 305 && i < 315) c += 1; // برگشت
    else c += 0.1;
    h1.push(bar(i, c));
  }
  const p = { trendEma: 50, feePct: 0, slippagePct: 0, maxStopAtr: 10, directions: ['long', 'short'] };
  const { trades, funnel } = backtestPullback(h1, 250 * H, 400 * H, p);
  assert.equal(trades.length, 1, JSON.stringify(funnel));
  assert.equal(trades[0].dir, 'long');
  assert.equal(trades[0].why, 'TP');
  assert.ok(Math.abs(trades[0].r - trades[0].atr / trades[0].risk) < 1e-9); // TP = ۱ATR
});

test('استاپ و تارگت در یک کندل ← استاپ؛ کارمزد و لغزش از R کم می‌شود', () => {
  const p = { ...PULLBACK_DEFAULTS, feePct: 0.1, slippagePct: 0.05 };
  const plan = { dir: 'long', entry: 100, sl: 98, risk: 2, tp: 101 };
  const h1 = [bar(0, 100), { t: H, o: 100, h: 101.5, l: 97.5, c: 100, v: 1 }];
  const s = simulatePullback(h1, 0, plan, p);
  assert.equal(s.why, 'SL');
  assert.equal(s.ambiguous, true);
  assert.equal(s.gross, -1);
  // ورود ۱۰۰.۰۵، خروج ۹۷.۹۵۱، کارمزد ۰.۱٪ هر طرف
  const expect = (97.951 - 100.05 - 0.001 * (100.05 + 97.951)) / 2;
  assert.ok(Math.abs(s.r - expect) < 1e-9);
  // فروش: قرینه
  const sh = simulatePullback([bar(0, 100), { t: H, o: 100, h: 100.2, l: 98.9, c: 99, v: 1 }], 0,
    { dir: 'short', entry: 100, sl: 102, risk: 2, tp: 99 }, { ...p, feePct: 0, slippagePct: 0 });
  assert.equal(sh.why, 'TP');
  assert.equal(sh.r, 0.5);
  const st = pbStats([{ r: 0.5, exitT: 1 }, { r: -1, exitT: 2 }, { r: 0.5, exitT: 3 }]);
  assert.equal(st.maxDD, 1);
  assert.ok(Math.abs(st.winRate - 2 / 3) < 1e-9);
});
