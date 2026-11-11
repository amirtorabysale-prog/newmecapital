import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * هندسه‌ی تشخیصِ «کلیک روی کدام رسم» — بازسازی‌شده از src/chartDrawing.ts.
 * (فایل منبع TypeScript است و اجراکننده‌ی تست نود آن را مستقیم نمی‌خواند.)
 *
 * این منطق ظاهراً ساده است ولی اگر بشکند، کاربر یا نمی‌تواند رسمی را انتخاب کند
 * یا با هر کلیک روی چارت یک رسم تصادفی انتخاب می‌شود — هر دو به‌شدت آزاردهنده‌اند.
 */

const HIT_TOLERANCE = 7;
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function distanceToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function distanceToRectEdges(px, py, a, b) {
  const c1 = { x: a.x, y: a.y }, c2 = { x: b.x, y: a.y };
  const c3 = { x: b.x, y: b.y }, c4 = { x: a.x, y: b.y };
  return Math.min(
    distanceToSegment(px, py, c1, c2),
    distanceToSegment(px, py, c2, c3),
    distanceToSegment(px, py, c3, c4),
    distanceToSegment(px, py, c4, c1),
  );
}

function channelOffset(pts) {
  const [a, b, c] = pts;
  if (Math.abs(b.x - a.x) < 0.001) return c.y - a.y;
  const slope = (b.y - a.y) / (b.x - a.x);
  return c.y - (a.y + slope * (c.x - a.x));
}

function distanceToShape(px, py, kind, pts) {
  if (pts.length === 0) return Infinity;
  switch (kind) {
    case 'hline': return Math.abs(py - pts[0].y);
    case 'vline': return Math.abs(px - pts[0].x);
    case 'text':
      return px >= pts[0].x - 6 && px <= pts[0].x + 90 && Math.abs(py - pts[0].y) <= 10
        ? 0 : Math.hypot(px - pts[0].x, py - pts[0].y);
    case 'trend': return pts.length < 2 ? Infinity : distanceToSegment(px, py, pts[0], pts[1]);
    case 'rect':
    case 'measure': return pts.length < 2 ? Infinity : distanceToRectEdges(px, py, pts[0], pts[1]);
    case 'fib': {
      if (pts.length < 2) return Infinity;
      let best = Infinity;
      for (const level of FIB_LEVELS) {
        best = Math.min(best, Math.abs(py - (pts[0].y + (pts[1].y - pts[0].y) * level)));
      }
      return best;
    }
    case 'channel': {
      if (pts.length < 3) return Infinity;
      const offset = channelOffset(pts);
      return Math.min(
        distanceToSegment(px, py, pts[0], pts[1]),
        distanceToSegment(px, py, { x: pts[0].x, y: pts[0].y + offset }, { x: pts[1].x, y: pts[1].y + offset }),
      );
    }
    default: return Infinity;
  }
}

function drawingAt(shapes, x, y) {
  let best = null;
  for (const s of shapes) {
    if (s.preview || !s.id) continue;
    const d = distanceToShape(x, y, s.kind, s.pts);
    if (d <= HIT_TOLERANCE && (!best || d < best.d)) best = { id: s.id, d };
  }
  return best?.id ?? null;
}

const seg = (id, kind, pts) => ({ id, kind, pts, preview: false });
const horizontal = { x1: 0, x2: 200, y: 100 };
const trendShape = seg('t', 'trend', [{ x: 0, y: 100 }, { x: 200, y: 100 }]);

// ══════════════════════════════════════════════
// فاصله تا پاره‌خط — پایه‌ی همه‌ی ابزارها
// ══════════════════════════════════════════════

test('نقطه‌ی روی خط فاصله‌ی صفر دارد', () => {
  assert.equal(distanceToSegment(100, 100, { x: horizontal.x1, y: 100 }, { x: horizontal.x2, y: 100 }), 0);
});

test('فاصله‌ی عمودی از خط درست حساب می‌شود', () => {
  assert.equal(distanceToSegment(100, 105, { x: 0, y: 100 }, { x: 200, y: 100 }), 5);
});

test('فراتر از دو سرِ خط، فاصله تا نزدیک‌ترین سر حساب می‌شود — نه تا امتدادِ خط', () => {
  // اگر پاره‌خط با خطِ بی‌نهایت اشتباه گرفته شود، این نقطه فاصله‌ی ۰ می‌گیرد
  // و کلیک در فضای دور از خط، خط را انتخاب می‌کند.
  assert.equal(distanceToSegment(260, 100, { x: 0, y: 100 }, { x: 200, y: 100 }), 60);
});

test('خطِ نقطه‌ای (دو سرِ یکسان) خطا نمی‌دهد', () => {
  const dot = { x: 50, y: 50 };
  assert.equal(distanceToSegment(53, 54, dot, dot), 5);
});

test('خط مورب هم درست سنجیده می‌شود', () => {
  const d = distanceToSegment(10, 0, { x: 0, y: 0 }, { x: 100, y: 100 });
  assert.ok(Math.abs(d - Math.sqrt(50)) < 1e-9, `فاصله ${d}`);
});

// ══════════════════════════════════════════════
// انتخاب، برای هر ابزار
// ══════════════════════════════════════════════

test('کلیک نزدیک خط روند، همان را انتخاب می‌کند', () => {
  assert.equal(drawingAt([trendShape], 100, 104), 't');
});

test('کلیک دورتر از آستانه هیچ رسمی را انتخاب نمی‌کند', () => {
  assert.equal(drawingAt([trendShape], 100, 120), null);
});

test('مرزِ آستانه شامل می‌شود، یک پیکسل آن‌طرف‌تر نه', () => {
  assert.equal(drawingAt([trendShape], 100, 100 + HIT_TOLERANCE), 't');
  assert.equal(drawingAt([trendShape], 100, 100 + HIT_TOLERANCE + 1), null);
});

test('خط افقی از هر جای عرضِ چارت قابل انتخاب است', () => {
  const h = seg('h', 'hline', [{ x: 40, y: 100 }]);
  // نقطه‌ی ذخیره‌شده x=40 است ولی خط تا دو سرِ چارت کشیده می‌شود،
  // پس کلیک در x=900 هم باید بگیرد.
  assert.equal(drawingAt([h], 900, 103), 'h');
  assert.equal(drawingAt([h], 900, 130), null);
});

test('خط عمودی از هر ارتفاعی قابل انتخاب است', () => {
  const v = seg('v', 'vline', [{ x: 120, y: 50 }]);
  assert.equal(drawingAt([v], 123, 400), 'v');
  assert.equal(drawingAt([v], 200, 400), null);
});

test('ناحیه از روی مرزهایش گرفته می‌شود، نه از وسطِ خالی‌اش', () => {
  const r = seg('r', 'rect', [{ x: 100, y: 100 }, { x: 300, y: 200 }]);
  assert.equal(drawingAt([r], 200, 102), 'r', 'روی ضلع بالا');
  assert.equal(drawingAt([r], 300, 150), 'r', 'روی ضلع راست');
  assert.equal(drawingAt([r], 200, 150), null, 'وسطِ ناحیه نباید انتخاب کند');
});

test('فیبوناچی از روی هر کدام از سطوحش گرفته می‌شود', () => {
  const f = seg('f', 'fib', [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
  assert.equal(drawingAt([f], 50, 0), 'f', 'سطح ۰');
  assert.equal(drawingAt([f], 50, 50), 'f', 'سطح ۵۰٪');
  assert.equal(drawingAt([f], 50, 61.8), 'f', 'سطح ۶۱٫۸٪');
  assert.equal(drawingAt([f], 50, 100), 'f', 'سطح ۱۰۰');

  // بزرگ‌ترین فاصله بین دو سطح، بین ۰ و ۲۳٫۶ است؛ وسطش تنها جایی است که
  // در این ابعاد از هر سطحی دورتر از آستانه می‌افتد.
  assert.equal(drawingAt([f], 50, 11.8), null, 'وسطِ بازه‌ی خالی');
});

test('روی فیبوناچیِ فشرده، هر نقطه‌ای انتخاب می‌کند — و این درست است', () => {
  // وقتی موج کوچک است، سطوح چند پیکسل با هم فاصله دارند. فیبوناچی یک شیء
  // واحد است، پس گرفتنش از هر جای نزدیک، رفتار درستی است نه ایراد.
  const tiny = seg('f', 'fib', [{ x: 0, y: 0 }, { x: 200, y: 20 }]);
  assert.equal(drawingAt([tiny], 50, 10), 'f');
});

test('کانال از روی هر دو خط موازی‌اش گرفته می‌شود', () => {
  // خط پایه از (0,100) تا (200,100)، نقطه‌ی سوم ۵۰ پیکسل پایین‌تر
  const c = seg('c', 'channel', [{ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 150 }]);
  assert.equal(drawingAt([c], 100, 100), 'c', 'خط پایه');
  assert.equal(drawingAt([c], 100, 150), 'c', 'خط موازی');
  assert.equal(drawingAt([c], 100, 125), null, 'وسط کانال');
});

test('جابه‌جاییِ خط دومِ کانال از روی نقطه‌ی سوم و شیبِ خط پایه حساب می‌شود', () => {
  // خط پایه شیب ۱ دارد؛ نقطه‌ی سوم ۲۰ پیکسل زیر آن است
  const offset = channelOffset([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 70 }]);
  assert.equal(offset, 20);
});

test('کانالِ عمودی (دو نقطه روی یک x) خطا نمی‌دهد', () => {
  const offset = channelOffset([{ x: 10, y: 0 }, { x: 10, y: 100 }, { x: 60, y: 40 }]);
  assert.equal(offset, 40);
});

test('رسمِ ناقص انتخاب نمی‌شود', () => {
  assert.equal(drawingAt([seg('t', 'trend', [{ x: 0, y: 0 }])], 0, 0), null);
  assert.equal(drawingAt([seg('c', 'channel', [{ x: 0, y: 0 }, { x: 10, y: 10 }])], 5, 5), null);
});

// ══════════════════════════════════════════════
// انتخابِ نزدیک‌ترین
// ══════════════════════════════════════════════

test('وقتی دو رسم نزدیک‌اند، نزدیک‌ترین انتخاب می‌شود', () => {
  const far = seg('far', 'trend', [{ x: 0, y: 106 }, { x: 200, y: 106 }]);
  const near = seg('near', 'trend', [{ x: 0, y: 101 }, { x: 200, y: 101 }]);
  assert.equal(drawingAt([far, near], 100, 100), 'near');
  // ترتیب نباید نتیجه را عوض کند
  assert.equal(drawingAt([near, far], 100, 100), 'near');
});

test('رسمِ پیش‌نمایش انتخاب نمی‌شود — هنوز ثبت نشده که بخواهد حذف شود', () => {
  const preview = { id: null, kind: 'trend', pts: [{ x: 0, y: 100 }, { x: 200, y: 100 }], preview: true };
  assert.equal(drawingAt([preview], 100, 100), null);
});

test('بدون هیچ رسمی، انتخاب خالی است', () => {
  assert.equal(drawingAt([], 100, 100), null);
});
