import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData, webAppUrl } from '../src/web/server.js';
import { fitLine, fitDivergence, fitAll, snapLow } from '../src/strategy/fit.js';
import { findDivergence } from '../src/strategy/divergence.js';
import { atr, rsi } from '../src/strategy/indicators.js';
import { findTrendline, lineAt } from '../src/strategy/trendline.js';
import { PARAMS } from '../src/strategy/params.js';

const TOKEN = '123:abcdefghijklmnopqrstuvwxyz0123456789';

function sign(fields, token = TOKEN) {
  const p = new URLSearchParams(fields);
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

test('چارتِ زنده: initData ِ امضاشده پذیرفته، دست‌کاری‌شده و کهنه رد', () => {
  const now = Date.now();
  const good = sign({ auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 42, first_name: 'A' }) });
  assert.equal(verifyInitData(good, TOKEN, now).id, 42);
  assert.equal(verifyInitData(good.replace('42', '43'), TOKEN, now), null);
  assert.equal(verifyInitData(good, '999:other-token-xxxxxxxxxxxxxxxxxxxxxxx', now), null);
  assert.equal(verifyInitData(good, TOKEN, now + 25 * 3600_000), null);
  assert.equal(verifyInitData('', TOKEN, now), null);
});

test('چارتِ زنده: آدرس از WEBAPP_URL یا دامنه‌ی Railway', () => {
  assert.equal(webAppUrl({ WEBAPP_URL: 'https://x.example/app/' }), 'https://x.example/app/');
  assert.equal(webAppUrl({ RAILWAY_PUBLIC_DOMAIN: 'bot.up.railway.app' }), 'https://bot.up.railway.app/');
  assert.equal(webAppUrl({}), null);
});

// کندل‌های مصنوعی: سه کفِ صعودی روی یک خط، با موجِ بالا بینشان
function series() {
  const out = [];
  let t = 0;
  const push = (l, h) => out.push({ t: t++ * 3600_000, o: (l + h) / 2, h, l, c: (l + h) / 2, v: 1 });
  for (let i = 0; i < 40; i++) push(120 - i * 0.2, 122 - i * 0.2); // ریزشِ اول تا ~112
  const lows = [100, 104, 108];
  out.pivots = [];
  for (let w = 0; w < lows.length; w++) {
    for (let i = 0; i < 8; i++) push(lows[w] + 8 - i, lows[w] + 10 - i); // پایین آمدن
    out.pivots.push(out.length);
    push(lows[w], lows[w] + 2); // کف
    for (let i = 1; i <= 25; i++) push(lows[w] + i * 0.6, lows[w] + 2 + i * 0.6); // واکنش
  }
  for (let i = 0; i < 10; i++) push(112 + 6 - i * 0.6, 114 + 6 - i * 0.6); // برگشت به خط
  return out;
}

const strategy = {
  atrPeriod: 14,
  trendline: { lookback: 250, pivotStrength: 6, minSpacing: 12, minBounceAtr: 2, touchToleranceAtr: 0.5, approachAtr: 1.5, breakToleranceAtr: 0.25, maxWickPierceAtr: 0.6, touchWindow: 3 },
};

test('خطِ استاد: snapLow پایین‌ترین کفِ نزدیکِ کلیک را برمی‌دارد', () => {
  const c = series();
  const kf = c.pivots[0];
  assert.equal(snapLow(c, kf + 2), kf);
  assert.equal(snapLow(c, kf - 3), kf);
});

test('خطِ استاد: خطی که بات با تنظیمِ فعلی پیدا نمی‌کند ← تنظیمِ لازم، و بات بعدش همان را پیدا می‌کند', () => {
  const c = series();
  const [a, b] = c.pivots;
  // با واکنشِ لازمِ خیلی بزرگ، هیچ خطی پیدا نمی‌شود
  const strict = { ...strategy, trendline: { ...strategy.trendline, minBounceAtr: 9.5 } };
  const A = atr(c, 14).at(-1);
  assert.equal(findTrendline(c, A, strict.trendline), null);
  const f = fitLine(c, strict, a, b);
  assert.ok(f.ok, f.reasons.join(' | '));
  const bounce = f.changes.find((x) => x.path === 'strategy.trendline.minBounceAtr');
  assert.ok(bounce && bounce.to < 9.5);
  // تنظیمِ پیشنهادی را اعمال کن ← خطِ بات از هر دو کفِ استاد رد می‌شود
  // (سه کفِ این داده هم‌خط‌اند؛ بات ممکن است لنگرِ دیگری از همان خط را بردارد)
  const T = { ...strict.trendline };
  for (const x of f.changes) T[x.path.split('.').at(-1)] = x.to;
  const got = findTrendline(c, A, T);
  for (const i of [a, b]) assert.ok(Math.abs(lineAt(got, i) - c[i].l) <= 0.3 * A, `کفِ ${i}`);
  // مقدارها روی گام و در محدوده‌ی پنل
  for (const x of f.changes) {
    const p = PARAMS.find((q) => q.path === x.path);
    assert.ok(x.to >= p.min && x.to <= p.max, x.path);
  }
});

test('خطِ استاد: کفِ دومِ پایین‌تر ← توضیح، نه تنظیم', () => {
  const c = series();
  const [a, b] = c.pivots;
  c[b] = { ...c[b], l: 99 };
  // ترتیبِ کلیک مهم نیست
  for (const f of [fitLine(c, strategy, a, b), fitLine(c, strategy, b, a)]) {
    assert.equal(f.ok, false);
    assert.match(f.reasons[0], /پایین‌تر/);
  }
});

const divStrategy = {
  ...strategy,
  rsiPeriod: 14,
  rsiZone: { enabled: true, low: 30, high: 80 },
  divergence: { pivotStrength: 3, lookback: 60, minGap: 8, minRsiDelta: 3, allowHidden: true },
};

test('واگراییِ استاد: بدونِ خط یا کفِ دومِ دور از برخورد ← توضیح', () => {
  const c = series();
  const [a, b, k] = c.pivots;
  let f = fitDivergence(c, divStrategy, a, b, null);
  assert.equal(f.ok, false);
  assert.match(f.reasons[0], /خطِ روندی/);
  f = fitDivergence(c, divStrategy, a, b, k);
  assert.equal(f.ok, false);
  assert.match(f.reasons[0], /برخورد/);
});

// کندل‌های مصنوعی با واگراییِ معمولی: ریزشِ تند تا 80 (RSI خیلی پایین)، واکنش،
// بعد ریزشِ آرام تا کفِ پایین‌ترِ 78 با RSI ِ بالاتر
function divSeries() {
  const out = [];
  let t = 0;
  let c = 100;
  const step = (to) => {
    const o = c;
    c = to;
    out.push({ t: t++ * 3600_000, o, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 0.3, c, v: 1 });
  };
  for (let i = 0; i < 30; i++) step(100 + (i % 2 ? 0.5 : -0.5));
  for (let i = 1; i <= 8; i++) step(100 - i * 2.5);
  out.p = out.length - 1;
  for (let i = 1; i <= 10; i++) step(80 + i);
  for (let i = 1; i <= 15; i++) step(90 - i * 0.8);
  out.k = out.length - 1;
  for (let i = 1; i <= 4; i++) step(78 + i * 0.5);
  return out;
}

test('واگراییِ استاد: واگرایی‌ای که بات رد می‌کند ← تنظیمِ لازم، و بعدش بات همان را می‌بیند', () => {
  const c = divSeries();
  const r = rsi(c.map((x) => x.c), 14);
  const strict = { ...divStrategy, divergence: { ...divStrategy.divergence, minRsiDelta: 19, lookback: 20 } };
  assert.equal(findDivergence(c, r, c.k, { ...strict.divergence, zone: 30 }), null);
  const f = fitDivergence(c, strict, c.p, c.k, c.k);
  assert.ok(f.ok, f.reasons.join(' | '));
  assert.equal(f.type, 'regular');
  const d = { ...strict.divergence };
  for (const x of f.changes) d[x.path.split('.').at(-1)] = x.to;
  assert.equal(findDivergence(c, r, c.k, { ...d, zone: 30 })?.p, c.p);
  // RSI ِ کفِ اول 17 است؛ با اشباعِ 10 تنظیم پیشنهاد می‌شود که اشباع را بالا ببرد
  const z = fitDivergence(c, { ...divStrategy, rsiZone: { enabled: true, low: 10, high: 80 } }, c.p, c.k, c.k);
  assert.ok(z.changes.some((x) => x.path === 'strategy.rsiZone.low' && x.to === 20), JSON.stringify(z.changes));
});

test('واگراییِ استاد: هر پیشنهاد را اعمال کنی، بات همان کفِ قبلی را برمی‌دارد', () => {
  for (const c of [divSeries(), series()]) {
    const k = c.k ?? c.pivots[2];
    const r = rsi(c.map((x) => x.c), 14);
    for (let p = 0; p < k - 2; p++) {
      const f = fitDivergence(c, divStrategy, p, k, k);
      if (!f.ok) { assert.ok(f.reasons.length, `p=${p}`); continue; }
      const s = structuredClone(divStrategy);
      for (const x of f.changes) {
        const [, group, key] = x.path.split('.');
        s[group][key] = x.to;
        const q = PARAMS.find((y) => y.path === x.path);
        if (q.type !== 'bool') assert.ok(x.to >= q.min && x.to <= q.max, x.path);
      }
      const zone = s.rsiZone.enabled ? s.rsiZone.low : null;
      assert.equal(findDivergence(c, r, k, { ...s.divergence, zone })?.p, p, `p=${p}`);
    }
  }
});

// استراتژیِ کاملِ پیش‌فرض برای fitAll (analyze همه‌ی بخش‌ها را می‌خواهد)
const { readFileSync } = await import('node:fs');
const DEF = JSON.parse(readFileSync(new URL('../config/default.json', import.meta.url), 'utf8'));

test('تحلیلِ استاد: تحلیلِ خودِ بات را بکشی ← بدونِ تغییر پذیرفته می‌شود', async () => {
  const { analyze } = await import('../src/strategy/analyze.js');
  const c = series();
  const cfg = { strategy: structuredClone(DEF.strategy) };
  const res = analyze(c, cfg, 'long');
  assert.ok(res, 'بات روی داده‌ی آزمایشی خط پیدا نکرد');
  const f = fitAll(c, cfg, 'long', { line: [res.line.a, res.line.b], fib: [res.fib.lowIdx, res.fib.highIdx], fibLevel: cfg.strategy.fib.level });
  assert.ok(f.items.line.ok, f.items.line.reasons.join(' | '));
  // تحمل فقط بالا می‌رود، پس امتیاز کمتر نمی‌شود
  assert.ok(f.final.score >= res.score, `${f.final.score} < ${res.score}`);
  // فیبو با سطحِ فعلی: یا بی‌تغییر می‌پذیرد یا فقط تحمل را بالا می‌برد
  for (const x of f.changes) assert.match(x.path, /^strategy\.fib\.(toleranceAtr|nearToleranceAtr)$/);
});

test('تحلیلِ استاد: بدونِ خط، بقیه منتظرِ خط‌اند؛ فیبوی جابه‌جا ← توضیح', () => {
  const c = series();
  const cfg = { strategy: structuredClone(DEF.strategy) };
  const [a, b] = c.pivots;
  let f = fitAll(c, cfg, 'long', { div: [a, b], candle: c.length - 1 });
  assert.equal(f.items.div.ok, false);
  assert.match(f.items.div.reasons[0], /خطِ روند/);
  assert.equal(f.final, null);
  f = fitAll(c, cfg, 'long', { line: [a, b], fib: [a, a + 20] });
  assert.equal(f.items.fib.ok, false);
  assert.match(f.items.fib.reasons[0], /بات فیبو را/);
});
