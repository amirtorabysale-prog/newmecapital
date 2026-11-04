/** برابریِ src/strategy/trend.js با موتورِ پژوهش، روی داده‌ی واقعیِ هر ۲۸ نماد */
import { loadConfig } from '../../src/config.js';
import { loadUniverse, EXTRA_UNIVERSE, DAY } from './lib.js';
import { prep, FAMILIES, runSymbol } from './engine.js';
import { replay } from '../../src/strategy/trend.js';

const cfg = loadConfig();
const xs = [
  ...(await loadUniverse(cfg.watchlist, { years: 5, warmupDays: 60 })).data,
  ...(await loadUniverse(EXTRA_UNIVERSE, { years: 5, warmupDays: 60 })).data,
].map(prep);
let n = 0; let bad = 0; let sumRef = 0; let sumGot = 0;
for (const x of xs) {
  const ref = runSymbol(x, FAMILIES.C, { n: 50, confirm: 1 }, null, 0, Infinity);
  // موتور فقط بعد از x.startT وارد می‌شود؛ replay از کندلِ ۲۱۱ام — اگر سری پیوسته باشد یکی‌اند
  const got = replay(x.b);
  n += ref.length;
  sumRef += ref.reduce((s, t) => s + t.r, 0); sumGot += got.reduce((s, t) => s + t.r, 0);
  const same = got.length === ref.length && ref.every((t, i) => got[i].entryBarT + DAY === t.t && got[i].exitBarT + DAY === t.exitT && Math.abs(got[i].r - t.r) < 1e-9);
  if (!same) { bad++; console.log(`✗ ${x.id}: موتور ${ref.length}، بات ${got.length}`); }
}
console.log(`${xs.length} نماد، ${n} معامله · ناهمخوان: ${bad} · مجموع R موتور ${sumRef.toFixed(2)} / بات ${sumGot.toFixed(2)}`);
