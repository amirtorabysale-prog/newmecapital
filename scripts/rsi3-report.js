/**
 * گزارشِ تصویریِ بک‌تستِ rsi3: خلاصه، منحنیِ سرمایه، جدولِ هر نماد و برای هر
 * معامله چارتِ یک ساعته (ناحیه، ورود، استاپ، تارگت‌ها) با سه پنلِ RSI، و
 * علامتِ «درست / غلط» برای بازبینیِ استاد. فایلِ HTML ِ تک و بدونِ وابستگی.
 */

import { H1, M5 } from '../src/strategy/rsi3.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iso = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const fmtR = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const px = (v) => String(+v.toPrecision(6));
const MAX_CHARTS = 300;

function equitySvg(all) {
  const tr = [...all].sort((a, b) => a.exitT - b.exitT);
  if (!tr.length) return '<p class="muted">معامله‌ای نبود.</p>';
  const W = 900; const H = 220; const P = 36;
  const eq = [0]; for (const t of tr) eq.push(eq.at(-1) + t.r);
  const lo = Math.min(0, ...eq); const hi = Math.max(0, ...eq); const span = hi - lo || 1;
  const x = (i) => P + (i / (eq.length - 1 || 1)) * (W - 2 * P);
  const y = (v) => H - P + 10 - ((v - lo) / span) * (H - 2 * P);
  const pts = eq.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="eq" role="img" aria-label="منحنیِ سرمایه بر حسبِ R">
  <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" class="grid"/>
  <text x="${P - 6}" y="${y(hi) + 4}" class="ax" text-anchor="end">${fmtR(hi)}</text>
  <text x="${P - 6}" y="${y(0) + 4}" class="ax" text-anchor="end">0</text>
  <text x="${P - 6}" y="${y(lo) + 4}" class="ax" text-anchor="end">${fmtR(lo)}</text>
  <polyline points="${pts}" class="eqline"/>
  ${eq.slice(1).map((v, i) => `<circle cx="${x(i + 1)}" cy="${y(v)}" r="2.5" class="${tr[i].r >= 0 ? 'up' : 'dn'}f"/>`).join('')}
  <text x="${W - P}" y="${H - 4}" class="ax" text-anchor="end">${tr.length} معامله، به ترتیبِ خروج</text>
</svg>`;
}

function tradeSvg(res, t) {
  const { h1, h4, r1, r4, r5, c5 } = res;
  const p = res.params;
  const e = t.h1Idx;
  const exitH = Math.min(h1.length - 1, e + Math.ceil((t.exitT - t.t) / H1) + 4);
  const a = Math.max(0, e - 60);
  const bars = h1.slice(a, exitH + 1);
  const W = 860; const L = 8; const R = 70; const top = 8;
  const priceH = 300; const rsiH = 70; const gap = 14;
  const totalH = top + priceH + 3 * (rsiH + gap) + 18;
  const t0 = bars[0].t; const t1 = bars.at(-1).t + H1;
  const X = (time) => L + ((time - t0) / (t1 - t0)) * (W - L - R);
  const bw = Math.max(1.5, ((W - L - R) / bars.length) * 0.7);
  let lo = Math.min(...bars.map((k) => k.l), t.sl, t.zone.lo);
  let hi = Math.max(...bars.map((k) => k.h), t.sl, t.zone.hi);
  const visTp = [t.tp1, t.tp2].filter((v) => v <= hi + (hi - lo) * 0.6 && v >= lo - (hi - lo) * 0.6);
  lo = Math.min(lo, ...visTp); hi = Math.max(hi, ...visTp);
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * priceH;
  const out = [];
  out.push(`<svg viewBox="0 0 ${W} ${totalH}" class="tc" role="img" aria-label="چارتِ یک ساعته‌ی معامله">`);
  // ناحیه
  out.push(`<rect x="${L}" width="${W - L - R}" y="${Y(t.zone.hi)}" height="${Math.max(2, Y(t.zone.lo) - Y(t.zone.hi))}" class="zone"/>`);
  for (const pt of t.zone.points) if (pt >= t0) out.push(`<circle cx="${X(pt + H1 / 2)}" cy="${Y((t.zone.lo + t.zone.hi) / 2)}" r="3" class="touch"/>`);
  // کندل‌ها
  for (const k of bars) {
    const cx = X(k.t + H1 / 2); const up = k.c >= k.o;
    out.push(`<line x1="${cx}" x2="${cx}" y1="${Y(k.h)}" y2="${Y(k.l)}" class="${up ? 'up' : 'dn'}s"/>`);
    out.push(`<rect x="${cx - bw / 2}" width="${bw}" y="${Y(Math.max(k.o, k.c))}" height="${Math.max(1, Math.abs(Y(k.o) - Y(k.c)))}" class="${up ? 'up' : 'dn'}f"/>`);
  }
  // سطوح
  const xs = X(t.t); const xe = X(t.exitT);
  const lvl = (v, cls, label) => {
    if (v < lo || v > hi) return;
    out.push(`<line x1="${xs}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="${cls}"/>`);
    out.push(`<text x="${W - R + 4}" y="${Y(v) + 4}" class="lbl ${cls}t">${label} ${px(v)}</text>`);
  };
  lvl(t.entry, 'en', 'ورود'); lvl(t.sl, 'sl', 'استاپ'); lvl(t.tp1, 'tp', 'TP1'); if (t.tp2 !== t.tp1) lvl(t.tp2, 'tp', 'TP2');
  out.push(`<line x1="${X(t.armedT)}" x2="${X(t.armedT)}" y1="${top}" y2="${top + priceH}" class="arm"/>`);
  out.push(`<path d="M${xs} ${Y(t.entry) + (t.dir === 'long' ? 14 : -14)} l-5 ${t.dir === 'long' ? 8 : -8} h10 z" class="enm"/>`);
  for (const f of t.fills) out.push(`<circle cx="${X(f.t)}" cy="${Y(f.px)}" r="4" class="ex ${f.why === 'SL' ? 'dn' : 'up'}f"/>`);
  out.push(`<rect x="${xs}" width="${Math.max(1, xe - xs)}" y="${top}" height="${priceH}" class="hold"/>`);
  // پنل‌های RSI
  const panel = (k, label, series) => {
    const y0 = top + priceH + gap + k * (rsiH + gap);
    const Yr = (v) => y0 + (1 - v / 100) * rsiH;
    out.push(`<rect x="${L}" y="${y0}" width="${W - L - R}" height="${rsiH}" class="pnl"/>`);
    for (const lvlv of [p.oversold, p.overbought]) out.push(`<line x1="${L}" x2="${W - R}" y1="${Yr(lvlv)}" y2="${Yr(lvlv)}" class="band"/>`);
    out.push(`<text x="${W - R + 4}" y="${y0 + 12}" class="lbl">${label}</text>`);
    out.push(`<text x="${W - R + 4}" y="${Yr(p.oversold) + 4}" class="ax">${p.oversold}</text>`);
    out.push(`<text x="${W - R + 4}" y="${Yr(p.overbought) + 4}" class="ax">${p.overbought}</text>`);
    const pts = series.filter(([tm, v]) => tm >= t0 && tm <= t1 && Number.isFinite(v)).map(([tm, v]) => `${X(tm).toFixed(1)},${Yr(v).toFixed(1)}`);
    if (pts.length) out.push(`<polyline points="${pts.join(' ')}" class="rsi"/>`);
    out.push(`<line x1="${X(t.armedT)}" x2="${X(t.armedT)}" y1="${y0}" y2="${y0 + rsiH}" class="arm"/>`);
  };
  const i5a = c5.findIndex((k) => k.t >= t0);
  const s5 = [];
  for (let i = Math.max(0, i5a); i < c5.length && c5[i].t < t1; i++) s5.push([c5[i].t + M5, r5[i]]);
  panel(0, 'RSI ۵د', s5);
  panel(1, 'RSI ۱س', h1.map((k, i) => [k.t + H1, r1[i]]));
  const s4 = [];
  h4.forEach((k, i) => { s4.push([k.t, r4[i - 1]], [k.t + 14_400_000, r4[i]]); });
  panel(2, 'RSI ۴س', s4);
  out.push('</svg>');
  return out.join('');
}

export function buildHtml({ results, missing, params, changed, days, now, stats, all }) {
  const s = stats(all);
  const outcomeFa = { SL: 'استاپ', BE: 'سربه‌سر', TP2: 'تارگتِ ۲', 'TP1+BE': 'تارگتِ ۱، بقیه سربه‌سر', 'TP1+TIME': 'تارگتِ ۱، بقیه پایانِ ۲۴س', TIME: 'پایانِ ۲۴ ساعت' };
  const symRows = results.map((r) => {
    const st = stats(r.trades);
    const f = r.funnel;
    return `<tr><td>${esc(r.item.id)}<div class="muted sm">${esc(r.exchange)} · ${r.coveredDays.toFixed(0)} روز</div></td>
      <td>${st.n}</td><td>${st.n ? (st.winRate * 100).toFixed(0) + '%' : '—'}</td><td class="${st.totalR >= 0 ? 'pos' : 'neg'}">${fmtR(st.totalR)}</td>
      <td>${st.n ? fmtR(st.avgR) : '—'}</td><td>${st.maxDD.toFixed(2)}</td>
      <td>${f.hours5m}</td><td>${f.hours5m1h}</td><td>${f.hoursTriple} <span class="muted sm">(خ ${f.tripleLong} · ف ${f.tripleShort})</span></td><td>${f.hoursOnZone}</td><td>${f.armed}</td>
      <td>${f.cancelTimeout}</td><td>${f.cancelInvalid}</td><td>${f.rejectStop}</td><td>${f.rejectRR}</td><td>${f.rejectNoTarget}</td></tr>`;
  }).join('') + missing.map((m) => `<tr><td>${esc(m.id)}</td><td colspan="15" class="neg">داده نیامد: ${esc(m.why)}</td></tr>`).join('');

  const cards = [];
  let n = 0;
  for (const r of results) {
    for (const t of r.trades) {
      n++;
      const key = `${r.item.id}_${t.t}`;
      const chart = n <= MAX_CHARTS ? tradeSvg({ ...r, c5: r.c5 }, t) : '<p class="muted">چارت به خاطرِ تعدادِ زیاد حذف شد.</p>';
      cards.push(`<article class="card" data-key="${key}">
  <header><b>${esc(r.item.id)}</b> <span class="tag ${t.dir}">${t.dir === 'long' ? 'خرید' : 'فروش'}</span>
    <span class="muted">${iso(t.t)} UTC</span>
    <span class="res ${t.r >= 0 ? 'pos' : 'neg'}">${fmtR(t.r)}R · ${outcomeFa[t.outcome] || t.outcome}</span></header>
  <div class="body">
    <div class="chart">${chart}</div>
    <aside>
      <dl>
        <dt>اشباع (لحظه‌ی ستاپ)</dt><dd>۵د ${t.rsiAtArm.r5.toFixed(1)} · ۱س ${t.rsiAtArm.r1.toFixed(1)} · ۴س ${t.rsiAtArm.r4.toFixed(1)}</dd>
        <dt>ستاپ / ورود</dt><dd>${iso(t.armedT)} ← ${iso(t.t)}</dd>
        <dt>ناحیه</dt><dd>${px(t.zone.lo)} – ${px(t.zone.hi)} (${t.zone.touches} برخورد)</dd>
        <dt>ورود / استاپ</dt><dd>${px(t.entry)} / ${px(t.sl)}</dd>
        <dt>TP1 / TP2</dt><dd>${px(t.tp1)} (${t.rr1.toFixed(2)}R) / ${px(t.tp2)} (${t.rr2.toFixed(2)}R)</dd>
        <dt>کارمزد</dt><dd>${t.fee.toFixed(2)}R</dd>
      </dl>
      <fieldset><legend>بازبینیِ استاد</legend>
        <label><input type="radio" name="v_${key}" value="ok"> درست</label>
        <label><input type="radio" name="v_${key}" value="bad"> غلط</label>
        <textarea placeholder="توضیح: کدام سطح یا اشباع را بات اشتباه دیده؟" rows="3"></textarea>
      </fieldset>
    </aside>
  </div>
</article>`);
    }
  }

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>بک‌تستِ اشباعِ سه‌تایم‌فریمی</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e2e2dc;--up:#1a8f5a;--dn:#d0453a;--zone:rgba(70,110,220,.16);--zoneb:#466edc;--en:#3d3d3a;--tp:#1a8f5a;--sl:#d0453a;--accent:#466edc}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151514;--card:#1f1f1d;--ink:#ecebe6;--muted:#9c9b94;--line:#33332f;--up:#3fbf83;--dn:#ef6a5f;--zone:rgba(110,145,255,.18);--zoneb:#7d9cff;--en:#d4d3cd;--tp:#3fbf83;--sl:#ef6a5f;--accent:#7d9cff}}
:root[data-theme="dark"]{--bg:#151514;--card:#1f1f1d;--ink:#ecebe6;--muted:#9c9b94;--line:#33332f;--up:#3fbf83;--dn:#ef6a5f;--zone:rgba(110,145,255,.18);--zoneb:#7d9cff;--en:#d4d3cd;--tp:#3fbf83;--sl:#ef6a5f;--accent:#7d9cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 Tahoma,"Vazirmatn",system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 80px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 10px}
.muted{color:var(--muted)}.sm{font-size:12px}.pos{color:var(--up)}.neg{color:var(--dn)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.kpi b{display:block;font-size:22px}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}th{color:var(--muted);font-weight:600}td:first-child,th:first-child{text-align:right}
svg{width:100%;height:auto;display:block}.eq{background:var(--card);border:1px solid var(--line);border-radius:10px}
.grid,.band{stroke:var(--line);stroke-dasharray:4 4}.ax{fill:var(--muted);font-size:11px}.eqline{fill:none;stroke:var(--accent);stroke-width:2}
.upf{fill:var(--up)}.dnf{fill:var(--dn)}.ups{stroke:var(--up)}.dns{stroke:var(--dn)}
.zone{fill:var(--zone);stroke:var(--zoneb);stroke-width:.6}.touch{fill:var(--zoneb)}.hold{fill:var(--accent);opacity:.05}
.en{stroke:var(--en);stroke-dasharray:6 3}.sl{stroke:var(--sl)}.tp{stroke:var(--tp)}.ent{fill:var(--en)}.slt{fill:var(--sl)}.tpt{fill:var(--tp)}
.lbl{font-size:11px;fill:var(--ink)}.arm{stroke:var(--accent);stroke-dasharray:2 3}.enm{fill:var(--accent)}.ex{stroke:var(--card);stroke-width:1.5}
.pnl{fill:none;stroke:var(--line)}.rsi{fill:none;stroke:var(--accent);stroke-width:1.2}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:14px 0;overflow:hidden}
.card header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}
.res{margin-inline-start:auto;font-weight:600}.tag{font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid}.tag.long{color:var(--up)}.tag.short{color:var(--dn)}
.body{display:grid;grid-template-columns:1fr 260px}.chart{padding:8px;direction:ltr}aside{border-inline-start:1px solid var(--line);padding:12px;font-size:13px}
dl{margin:0}dt{color:var(--muted);font-size:12px}dd{margin:0 0 8px}fieldset{border:1px solid var(--line);border-radius:8px;margin-top:10px}
fieldset label{margin-inline-end:12px;cursor:pointer}textarea{width:100%;margin-top:8px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:6px;font:inherit;padding:6px}
.card.ok{border-color:var(--up)}.card.bad{border-color:var(--dn)}
.bar{position:sticky;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:7px 16px;cursor:pointer}
@media (max-width:760px){.body{grid-template-columns:1fr}aside{border-inline-start:0;border-top:1px solid var(--line)}}
</style></head><body><main>
<h1>بک‌تستِ اشباعِ سه‌تایم‌فریمی</h1>
<p class="muted">${days} روزِ اخیر تا ${iso(now)} UTC · پارامترها: ${esc(changed)} · خرید: RSI هر سه ≤ ${params.oversold} روی حمایت · فروش: ≥ ${params.overbought} روی مقاومت · حداقلِ برخورد ${params.minTouches} · کارمزد ${params.feePct}% هر طرف کم شده</p>
<div class="kpis">
  <div class="kpi"><span class="muted">معامله</span><b>${s.n}</b></div>
  <div class="kpi"><span class="muted">درصدِ برد</span><b>${s.n ? (s.winRate * 100).toFixed(0) + '%' : '—'}</b></div>
  <div class="kpi"><span class="muted">مجموع</span><b class="${s.totalR >= 0 ? 'pos' : 'neg'}">${fmtR(s.totalR)}R</b></div>
  <div class="kpi"><span class="muted">میانگین</span><b>${s.n ? fmtR(s.avgR) + 'R' : '—'}</b></div>
  <div class="kpi"><span class="muted">افتِ حداکثر</span><b>${s.maxDD.toFixed(2)}R</b></div>
</div>
<h2>منحنیِ سرمایه (R)</h2>
${equitySvg(all)}
<h2>هر نماد، و کدام شرط ستاپ را رد کرد</h2>
<p class="muted sm">ستون‌های RSI: تعدادِ ساعت‌هایی که شرط دست‌کم در یک کندلِ ۵ دقیقه برقرار بود. «باطل» یعنی پیش از ورود قیمت از جای استاپ رد شد.</p>
<div class="tw"><table><thead><tr><th>نماد</th><th>معامله</th><th>برد</th><th>مجموع R</th><th>میانگین R</th><th>افت R</th>
<th>RSI ۵د</th><th>+۱س</th><th>هر سه</th><th>+ناحیه</th><th>مسلح</th><th>لغوِ ۱۲س</th><th>باطل</th><th>استاپ&gt;۲ATR</th><th>R:R&lt;۲</th><th>بی‌تارگت</th></tr></thead>
<tbody>${symRows}</tbody></table></div>
<h2>معامله‌ها</h2>
<p class="muted sm">چارت یک ساعته است. نوارِ آبی ناحیه، نقطه‌های آبی برخوردها، خطِ‌چینِ عمودی لحظه‌ی ستاپ، مثلث ورود، دایره‌ها خروج‌ها. پنل‌های پایین RSI ِ ۵ دقیقه، یک ساعته و چهار ساعته‌ی بسته‌اند.</p>
${cards.join('\n') || '<p class="muted">معامله‌ای نبود.</p>'}
</main>
<div class="bar"><span id="cnt" class="muted"></span><button id="copy" type="button">کپیِ نتیجه‌ی بازبینی</button></div>
<script>
(function(){
  var KEY='rsi3-review';var st={};try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}}
  var cards=[].slice.call(document.querySelectorAll('.card'));
  function count(){var ok=0,bad=0;for(var k in st){if(st[k].v==='ok')ok++;if(st[k].v==='bad')bad++}document.getElementById('cnt').textContent='درست '+ok+' · غلط '+bad+' از '+cards.length}
  cards.forEach(function(c){var k=c.dataset.key,s=st[k]||{};var ta=c.querySelector('textarea');
    if(s.v){var r=c.querySelector('input[value="'+s.v+'"]');if(r)r.checked=true;c.classList.add(s.v)}if(s.n)ta.value=s.n;
    c.querySelectorAll('input').forEach(function(i){i.addEventListener('change',function(){st[k]=st[k]||{};st[k].v=i.value;c.classList.remove('ok','bad');c.classList.add(i.value);save();count()})});
    ta.addEventListener('input',function(){st[k]=st[k]||{};st[k].n=ta.value;save()})});
  document.getElementById('copy').addEventListener('click',function(){var lines=cards.map(function(c){var s=st[c.dataset.key]||{};return c.dataset.key+'\\t'+(s.v==='ok'?'درست':s.v==='bad'?'غلط':'-')+'\\t'+(s.n||'')});
    var txt=lines.join('\\n');if(navigator.clipboard)navigator.clipboard.writeText(txt).then(function(){document.getElementById('copy').textContent='کپی شد'})});
  count();
})();
</script></body></html>`;
}
