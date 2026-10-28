import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData, webAppUrl } from '../src/web/server.js';
import { fitLine, snapLow } from '../src/strategy/fit.js';
import { findTrendline, lineAt } from '../src/strategy/trendline.js';
import { atr } from '../src/strategy/indicators.js';
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
