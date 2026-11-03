/**
 * استراتژیِ روند‌گیری (src/strategy/trend.js) باید دقیقاً همان معامله‌هایی را
 * بسازد که موتورِ پژوهش ساخته و نتیجه‌اش گزارش شده — وگرنه عددهای پژوهش
 * درباره‌ی چیزی است که روی بات نیست.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prep, FAMILIES, runSymbol } from '../scripts/research/engine.js';
import { DAY, TREND_DEFAULTS, replay, evaluate, indicators, openPosition, advance, closePosition, netR, utcAligned, bookStats } from '../src/strategy/trend.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** کندلِ یک‌ساعته با رژیم‌های روند/رنج و گاه گپ — تا هر سه نوعِ خروج رخ دهد */
function hourly(days, seed) {
  const r = rng(seed);
  const out = [];
  let px = 100;
  let drift = 0;
  const t0 = Date.UTC(2020, 0, 1);
  for (let h = 0; h < days * 24; h++) {
    if (h % (24 * 40) === 0) drift = (r() - 0.45) * 0.004;
    const o = px;
    const shock = r() < 0.0015 ? (r() - 0.6) * 0.25 : 0; // گاه یک سقوط/جهشِ بزرگ
    px = Math.max(0.01, px * (1 + drift + (r() - 0.5) * 0.02 + shock));
    const hi = Math.max(o, px) * (1 + r() * 0.004);
    const lo = Math.min(o, px) * (1 - r() * 0.004);
    out.push({ t: t0 + h * 3_600_000, o, h: hi, l: lo, c: px, v: 1 });
  }
  return out;
}

test('برابری با موتورِ پژوهش: همان ورودها، خروج‌ها و R', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const x = prep({ id: 'T', candles: hourly(1600, seed) });
    const ref = runSymbol(x, FAMILIES.C, { n: 50 }, null, 0, Infinity);
    const got = replay(x.b, TREND_DEFAULTS);
    assert.ok(ref.length >= 8, `معامله‌ی کافی برای آزمون (${ref.length})`);
    assert.equal(got.length, ref.length, `seed ${seed}: تعدادِ معامله`);
    for (let i = 0; i < ref.length; i++) {
      assert.equal(got[i].entryBarT + DAY, ref[i].t, `seed ${seed} #${i}: زمانِ ورود`);
      assert.equal(got[i].exitBarT + DAY, ref[i].exitT, `seed ${seed} #${i}: زمانِ خروج`);
      assert.ok(Math.abs(got[i].entry - ref[i].entry) < 1e-9);
      assert.ok(Math.abs(got[i].risk - ref[i].risk) < 1e-9);
      assert.ok(Math.abs(got[i].r - ref[i].r) < 1e-9, `seed ${seed} #${i}: R ${got[i].r} ≠ ${ref[i].r}`);
    }
    const reasons = new Set(got.map((t) => t.exitReason));
    assert.ok(reasons.has('ema'), 'خروج با EMA رخ داده');
  }
});

test('هر سه نوعِ خروج در سری‌های آزمون دیده می‌شود (استاپ هم)', () => {
  const all = [1, 2, 3, 4, 5].flatMap((s) => replay(prep({ id: 'T', candles: hourly(1600, s) }).b));
  assert.ok(all.some((t) => t.exitReason === 'stop'), 'دست‌کم یک استاپِ فاجعه');
});

test('evaluate: کراسِ رو به بالا فقط روی همان کندل', () => {
  const x = prep({ id: 'T', candles: hourly(900, 7) });
  const ind = indicators(x.b);
  const crosses = [];
  for (let i = 211; i < x.b.length; i++) if (evaluate(x.b, TREND_DEFAULTS, ind, i).crossUp) crosses.push(i);
  assert.ok(crosses.length > 3);
  for (const i of crosses) {
    assert.ok(x.b[i].c > ind.ema[i] && x.b[i - 1].c <= ind.ema[i - 1]);
    assert.equal(evaluate(x.b, TREND_DEFAULTS, ind, i + 1).crossUp, false, 'کندلِ بعد دیگر کراس نیست');
  }
  assert.equal(evaluate(x.b.slice(0, 100)).ok, false, 'تاریخچه‌ی کوتاه رد می‌شود');
});

test('advance: پوزیشن از کندلِ بعد از ورود سنجیده می‌شود و دو بار خروج نمی‌دهد', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 5 }, (_, i) => ({ t: t0 + i * DAY, o: 100, h: 101, l: 99, c: 100 }));
  const pos = openPosition({ close: 100, stop: 90, t: bars[0].t });
  const ind = { ema: [95, 95, 95, 95, 95] };
  assert.equal(advance(pos, bars, TREND_DEFAULTS, ind), null);
  assert.equal(pos.lastT, bars[4].t);
  bars.push({ t: t0 + 5 * DAY, o: 88, h: 89, l: 80, c: 85 });
  const ex = advance(pos, bars, TREND_DEFAULTS, { ema: [...ind.ema, 95] });
  assert.deepEqual([ex.reason, ex.price], ['stop', 88], 'گپ زیرِ استاپ با open پر می‌شود');
  closePosition(pos, ex);
  assert.equal(advance(pos, bars, TREND_DEFAULTS, ind), null);
  assert.ok(pos.r < pos.grossR && pos.grossR === -1.2);
});

test('netR: هزینه‌ها R را کم می‌کنند؛ سربه‌سرِ قیمتی منفی است', () => {
  assert.ok(netR(100, 100, 10) < 0);
  assert.ok(Math.abs(netR(100, 110, 10, { feePct: 0, slippagePct: 0 }) - 1) < 1e-12);
});

test('utcAligned: کندلِ روزانه‌ی ۱۶:۰۰ UTC (LBank/Bitget) رد می‌شود', () => {
  const t = Date.UTC(2026, 0, 1);
  assert.equal(utcAligned([{ t }, { t: t + DAY }]), true);
  assert.equal(utcAligned([{ t: t - 8 * 3_600_000 }]), false);
  assert.equal(utcAligned([]), false);
});

test('bookStats', () => {
  const s = bookStats([{ r: 2 }, { r: -0.5 }, { r: -0.5 }]);
  assert.equal(s.n, 3);
  assert.equal(s.wins, 1);
  assert.ok(Math.abs(s.totalR - 1) < 1e-12 && Math.abs(s.pf - 2) < 1e-12);
});
