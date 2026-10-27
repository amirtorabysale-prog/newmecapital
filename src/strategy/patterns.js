/**
 * الگوهای کندلیِ برگشتیِ صعودی. نسخه‌ی نزولی لازم نیست: تحلیلِ فروش روی
 * کندل‌های قرینه اجرا می‌شود و چکش آن‌جا خودبه‌خود «ستاره‌ی دنباله‌دار» است.
 *
 * strength: وزنِ الگو بین ۰ و ۱ — اینگالفینگ و ستاره‌ی صبحگاهی قوی‌ترین‌اند،
 * هارامی و دوجی ضعیف‌ترین (فقط تردید را نشان می‌دهند نه برگشت را).
 */

const body = (k) => Math.abs(k.c - k.o);
const range = (k) => k.h - k.l || 1e-12;
const bull = (k) => k.c > k.o;
const bear = (k) => k.c < k.o;
const lowerWick = (k) => Math.min(k.o, k.c) - k.l;
const upperWick = (k) => k.h - Math.max(k.o, k.c);

export const PATTERNS = [
  {
    key: 'morning_star', name: 'Morning Star', bearName: 'Evening Star', fa: 'ستاره‌ی صبحگاهی', faBear: 'ستاره‌ی شامگاهی', strength: 1.0,
    test: (c, i, A) => i >= 2 && bear(c[i - 2]) && body(c[i - 2]) >= 0.6 * A
      && body(c[i - 1]) <= 0.4 * body(c[i - 2])
      && bull(c[i]) && c[i].c >= (c[i - 2].o + c[i - 2].c) / 2,
  },
  {
    key: 'engulfing', name: 'Bullish Engulfing', bearName: 'Bearish Engulfing', fa: 'پوشای صعودی', faBear: 'پوشای نزولی', strength: 1.0,
    test: (c, i) => i >= 1 && bear(c[i - 1]) && bull(c[i])
      && c[i].c >= c[i - 1].o && c[i].o <= c[i - 1].c && body(c[i]) > body(c[i - 1]),
  },
  {
    key: 'hammer', name: 'Hammer', bearName: 'Shooting Star', fa: 'چکش', faBear: 'ستاره‌ی دنباله‌دار', strength: 0.9,
    test: (c, i) => {
      const k = c[i];
      return body(k) <= 0.35 * range(k) && lowerWick(k) >= 2 * Math.max(body(k), 0.05 * range(k))
        && upperWick(k) <= 0.25 * range(k);
    },
  },
  {
    key: 'piercing', name: 'Piercing Line', bearName: 'Dark Cloud Cover', fa: 'نفوذی', faBear: 'ابرِ تیره', strength: 0.85,
    test: (c, i, A) => i >= 1 && bear(c[i - 1]) && body(c[i - 1]) >= 0.5 * A && bull(c[i])
      && c[i].o <= c[i - 1].c && c[i].c > (c[i - 1].o + c[i - 1].c) / 2 && c[i].c < c[i - 1].o,
  },
  {
    key: 'tweezer', name: 'Tweezer Bottom', bearName: 'Tweezer Top', fa: 'انبرکِ کف', faBear: 'انبرکِ سقف', strength: 0.75,
    test: (c, i, A) => i >= 1 && bear(c[i - 1]) && bull(c[i])
      && Math.abs(c[i].l - c[i - 1].l) <= 0.1 * A && body(c[i - 1]) >= 0.3 * A,
  },
  {
    key: 'harami', name: 'Bullish Harami', bearName: 'Bearish Harami', fa: 'هارامیِ صعودی', faBear: 'هارامیِ نزولی', strength: 0.6,
    test: (c, i, A) => i >= 1 && bear(c[i - 1]) && body(c[i - 1]) >= 0.6 * A && bull(c[i])
      && c[i].o >= c[i - 1].c && c[i].c <= c[i - 1].o && body(c[i]) <= 0.6 * body(c[i - 1]),
  },
  {
    key: 'dragonfly', name: 'Dragonfly Doji', bearName: 'Gravestone Doji', fa: 'دوجیِ سنجاقک', faBear: 'دوجیِ سنگ قبر', strength: 0.6,
    test: (c, i) => {
      const k = c[i];
      return body(k) <= 0.1 * range(k) && lowerWick(k) >= 0.6 * range(k);
    },
  },
];

/** قوی‌ترین الگو که روی یکی از `window` کندلِ آخر بسته شده. */
export function findReversal(candles, atrNow, window = 2) {
  const last = candles.length - 1;
  let best = null;
  for (let i = last; i > last - window && i >= 0; i--) {
    for (const p of PATTERNS) {
      if (!p.test(candles, i, atrNow)) continue;
      // کندلِ تازه‌تر با همان قدرت ترجیح دارد
      if (!best || p.strength > best.strength) best = { ...p, idx: i };
      break;
    }
  }
  if (!best) return null;
  const { test, ...rest } = best;
  return rest;
}
