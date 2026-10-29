/**
 * لایه‌ی رسم روی چارت (primitive ِ lightweight-charts v5)، به سبکِ چارتِ گلدمی
 * (src/chart/drawings.ts ِ آن پروژه): خط و پرتو، فلش، جعبه‌ی فیبو، ناحیه‌ی
 * ورود/حد ضرر، و نوار و رنگِ اشباعِ RSI.
 *
 * x همیشه شماره‌ی منطقیِ کندل است (logicalToCoordinate)، پس رسم می‌تواند از
 * آخرین کندل جلوتر برود — جعبه‌ی فیبو و ناحیه‌ی پلن در فضای خالیِ سمت راست.
 *
 * ⚠️ متنِ روی بوم لاتین است: فارسی بی‌دوجهته و برعکس کشیده می‌شود.
 */

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
// رنگِ سطح‌های فیبو مثلِ تریدینگ‌ویو، کم‌رنگ؛ سطحِ استراتژی پررنگ کشیده می‌شود
const FIB_COLORS = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86'];

class Primitive {
  constructor(zOrder) {
    const view = { zOrder: () => zOrder, renderer: () => ({ draw: (t) => this.draw(t) }) };
    this.views = [view];
  }
  attached({ chart, series, requestUpdate }) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }
  detached() {
    this.chart = this.series = this.requestUpdate = null;
  }
  updateAllViews() {}
  paneViews() {
    return this.views;
  }
  x(i) {
    return this.chart?.timeScale().logicalToCoordinate(i) ?? null;
  }
  y(p) {
    return this.series?.priceToCoordinate(p) ?? null;
  }
  fmt(p) {
    return this.series.priceFormatter().format(p);
  }
  draw(target) {
    if (!this.chart) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize));
  }
}

/**
 * شکل‌ها:
 *   { kind: 'seg', a: [i, price], b: [i, price], color, width, dash, ray, arrow }
 *   { kind: 'dot', at: [i, price], color, r }
 *   { kind: 'fib', from, to, lo: [i, price], hi: [i, price], levels, chosen }
 *       قیمتِ سطحِ L = hi - L × (hi - lo)؛ سطحِ 1 روی lo
 *   { kind: 'zone', from, to, a, b, color, text }
 */
export class Overlay extends Primitive {
  constructor() {
    super('top');
    this.shapes = [];
  }
  set(shapes) {
    this.shapes = shapes;
    this.requestUpdate?.();
  }
  paint(ctx, size) {
    for (const s of this.shapes) {
      ctx.save();
      try {
        this[s.kind]?.(ctx, s, size);
      } finally {
        ctx.restore();
      }
    }
  }

  seg(ctx, s, size) {
    let [x1, y1, x2, y2] = [this.x(s.a[0]), this.y(s.a[1]), this.x(s.b[0]), this.y(s.b[1])];
    if ([x1, y1, x2, y2].some((v) => v == null)) return;
    if (s.ray && x2 !== x1) {
      // پرتو تا لبه‌ی راستِ چارت، با همان شیب
      y2 = y1 + ((y2 - y1) * (size.width - x1)) / (x2 - x1);
      x2 = size.width;
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 2;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (s.arrow) {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const L = 9;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - L * Math.cos(ang - 0.45), y2 - L * Math.sin(ang - 0.45));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - L * Math.cos(ang + 0.45), y2 - L * Math.sin(ang + 0.45));
      ctx.stroke();
    }
  }

  dot(ctx, s) {
    const [x, y] = [this.x(s.at[0]), this.y(s.at[1])];
    if (x == null || y == null) return;
    ctx.fillStyle = '#171d2b';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, s.r ?? 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  fib(ctx, s) {
    const x1 = this.x(s.from);
    const x2 = this.x(s.to);
    if (x1 == null || x2 == null) return;
    const [lo, hi] = [s.lo[1], s.hi[1]];
    const levels = [...new Set([...(s.levels || FIB_LEVELS), s.chosen].filter((v) => v != null))].sort((a, b) => a - b);
    const at = (L) => this.y(hi - L * (hi - lo));
    const color = (L) => FIB_COLORS[FIB_LEVELS.indexOf(L)] || '#2dd4bf';
    // نوارهای بینِ سطح‌ها
    for (let n = 0; n < levels.length - 1; n++) {
      const [ya, yb] = [at(levels[n]), at(levels[n + 1])];
      if (ya == null || yb == null) continue;
      ctx.fillStyle = `${color(levels[n + 1])}14`;
      ctx.fillRect(x1, Math.min(ya, yb), x2 - x1, Math.abs(yb - ya));
    }
    // قطرِ موج
    const [dx1, dy1, dx2, dy2] = [this.x(s.lo[0]), this.y(lo), this.x(s.hi[0]), this.y(hi)];
    if (![dx1, dy1, dx2, dy2].includes(null)) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(dx1, dy1);
      ctx.lineTo(dx2, dy2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    // برچسبِ سطح‌های نزدیک به هم روی هم می‌افتد؛ سطحِ استراتژی همیشه برچسب دارد
    const labelled = levels.filter((L) => L === s.chosen);
    for (const L of levels) {
      const y = at(L);
      if (y == null) continue;
      const main = L === s.chosen;
      const crowded = !main && labelled.some((o) => Math.abs(at(o) - y) < 11);
      if (!crowded && !main) labelled.push(L);
      ctx.strokeStyle = main ? '#2dd4bf' : color(L);
      ctx.lineWidth = main ? 2 : 1;
      ctx.globalAlpha = main ? 1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      if (!crowded) ctx.fillText(`${L} (${this.fmt(hi - L * (hi - lo))})`, x1 + 3, y - 1);
      ctx.globalAlpha = 1;
    }
  }

  zone(ctx, s) {
    const [x1, x2, ya, yb] = [this.x(s.from), this.x(s.to), this.y(s.a), this.y(s.b)];
    if ([x1, x2, ya, yb].includes(null)) return;
    ctx.fillStyle = `${s.color}26`;
    ctx.fillRect(x1, Math.min(ya, yb), x2 - x1, Math.abs(yb - ya));
    ctx.strokeStyle = `${s.color}99`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, Math.min(ya, yb), x2 - x1, Math.abs(yb - ya));
    if (s.text) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = s.color;
      ctx.textBaseline = ya < yb ? 'top' : 'bottom';
      ctx.fillText(s.text, x1 + 3, yb < ya ? yb + 2 : yb - 2);
    }
  }
}

/**
 * پسِ زمینه‌ی RSI مثلِ تریدینگ‌ویو: نوارِ بنفش بینِ دو مرزِ اشباع، و پرکردنِ
 * سبز/قرمزِ جایی که RSI از مرز بیرون زده. مرزها همان rsiZone ِ استراتژی‌اند،
 * پس چیزی که روی چارت «اشباع» دیده می‌شود همان است که بات می‌سنجد.
 */
export class RsiBands extends Primitive {
  constructor() {
    super('bottom');
    this.values = [];
    this.low = 30;
    this.high = 70;
  }
  set(values, low, high) {
    Object.assign(this, { values, low, high });
    this.requestUpdate?.();
  }
  paint(ctx, size) {
    const [yh, yl] = [this.y(this.high), this.y(this.low)];
    if (yh == null || yl == null) return;
    ctx.fillStyle = 'rgba(126, 87, 194, 0.10)';
    ctx.fillRect(0, yh, size.width, yl - yh);

    const range = this.chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const pts = [];
    const from = Math.max(0, Math.floor(range.from) - 1);
    const to = Math.min(this.values.length - 1, Math.ceil(range.to) + 1);
    for (let i = from; i <= to; i++) {
      if (!Number.isFinite(this.values[i])) continue;
      const [x, y] = [this.x(i), this.y(this.values[i])];
      if (x != null && y != null) pts.push([x, y]);
    }
    if (pts.length < 2) return;
    const fill = (clipY, toTop, base, c0, c1) => {
      ctx.save();
      ctx.beginPath();
      if (toTop) ctx.rect(0, 0, size.width, clipY);
      else ctx.rect(0, clipY, size.width, size.height - clipY);
      ctx.clip();
      const g = ctx.createLinearGradient(0, toTop ? 0 : size.height, 0, base);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], base);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts.at(-1)[0], base);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    fill(yh, true, yh, 'rgba(34, 197, 94, 0.55)', 'rgba(34, 197, 94, 0.08)');
    fill(yl, false, yl, 'rgba(239, 68, 68, 0.55)', 'rgba(239, 68, 68, 0.08)');
  }
}
