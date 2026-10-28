/**
 * چارتِ زنده بیرون از تلگرام، برای توسعه:
 *
 *   node scripts/webapp-dev.js            ← یک لینکِ localhost چاپ می‌کند
 *
 * یک توکنِ تصادفی می‌سازد و initData را با همان امضا می‌کند و در hash ِ لینک
 * می‌گذارد — telegram-web-app.js آن را از hash می‌خواند، درست مثلِ تلگرام.
 * ⚠️ «ذخیره» این‌جا data/settings.json ِ همین سیستم را عوض می‌کند، نه سرور را.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createWebServer } from '../src/web/server.js';

const token = `1:${randomBytes(24).toString('hex')}`;
const user = { id: 1, first_name: 'Dev' };
const cfg = loadConfig();

const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
const secret = createHmac('sha256', 'WebAppData').update(token).digest();
params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));

const web = createWebServer({
  cfg, token, isAdmin: (id) => id === user.id,
  onSaved: (u, changes) => console.log('[save]', changes.map((c) => `${c.p.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join(', ')),
});
const port = await web.listen(Number(process.env.PORT) || 8080);
const coin = process.argv[2] ? `?coin=${process.argv[2].toUpperCase()}` : '';
console.log(`http://localhost:${port}/${coin}#tgWebAppData=${encodeURIComponent(params.toString())}&tgWebAppVersion=7.0&tgWebAppPlatform=web`);
