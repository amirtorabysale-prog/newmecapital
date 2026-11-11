/**
 * Goldemy — رسم‌های چارت
 *
 * ⚠️ این حساس‌ترین state محصول است. اگر بعد از تغییری رسم‌های کاربر پاک شدند،
 * اول اینجا را نگاه کن.
 *
 * سه قاعده که هیچ‌کدام تزئینی نیستند و هر سه با یک باگ واقعی نوشته شده‌اند:
 *
 * ۱. تا وقتی نسخه‌ی سرور نیامده، هیچ چیزی به سرور نوشته نمی‌شود (قفلِ
 *    `loaded`). بدون آن، همان چند صدم ثانیه‌ای که وضعیت هنوز خالی است
 *    به‌عنوان «وضعیت نهایی» روی سرور می‌نشیند و تحلیل کاربر را پاک می‌کند.
 *
 * ۲. اگر سرور در دسترس نبود (`null`)، کشِ محلی دست‌نخورده می‌ماند — وگرنه یک
 *    قطعیِ لحظه‌ای اینترنت، تحلیل کاربر را از جلوی چشمش پاک می‌کند.
 *
 * ۳. شرط `isLoggedIn` در افکتِ ذخیره حیاتی است. بدون آن، خروج از حساب یک نشتِ
 *    حریم خصوصی بود: پاک‌سازی حافظه انجام می‌شد، ولی چون `authToken` عوض
 *    می‌شد افکت دوباره اجرا می‌شد و رسم‌هایی که هنوز در state بودند را دوباره
 *    می‌نوشت — و نفر بعدی روی همان مرورگر، تحلیل کاربر قبلی را می‌دید.
 *
 * ⚠️ این هوک باید جایی صدا زده شود که با جابه‌جایی بین بخش‌ها unmount نشود.
 * اگر به داخل صفحه‌ی ترمینال ببریش، با هر بار خروج و برگشت، رسم‌ها می‌پرند.
 * ترمینال همه‌ی این‌ها را به‌صورت prop می‌گیرد.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Drawing } from './drawings';
import {
  loadCachedDrawings, cacheDrawings, clearCachedDrawings, fetchDrawings, pushDrawings,
} from './persistence';

export function useDrawings({ isLoggedIn, authToken }: { isLoggedIn: boolean; authToken: string }) {
  const [drawings, setDrawings] = useState<Drawing[]>(loadCachedDrawings);

  const add = useCallback((drawing: Drawing) => {
    setDrawings((d) => [...d, drawing]);
  }, []);

  const remove = useCallback((id: string) => {
    setDrawings((d) => d.filter((x) => x.id !== id));
  }, []);

  /** جابه‌جایی یا ویرایش یک رسمِ موجود — ترتیب حفظ می‌شود تا شکل جلو و عقب نپرد. */
  const update = useCallback((next: Drawing) => {
    setDrawings((d) => d.map((x) => (x.id === next.id ? next : x)));
  }, []);

  /** قاعده‌ی ۱ — تا این true نشود، چیزی به سرور نوشته نمی‌شود. */
  const loaded = useRef(false);

  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    let cancelled = false;
    (async () => {
      const remote = await fetchDrawings(authToken);
      if (cancelled) return;
      // قاعده‌ی ۲ — null یعنی سرور در دسترس نبود؛ کشِ محلی نگه داشته می‌شود.
      if (remote) { setDrawings(remote); cacheDrawings(remote); }
      loaded.current = true;
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, authToken]);

  /** کش بلافاصله نوشته می‌شود تا رفرش آنی باشد؛ سرور کمی بعد و بی‌سروصدا. */
  useEffect(() => {
    if (!isLoggedIn) return;                       // قاعده‌ی ۳
    cacheDrawings(drawings);
    if (!loaded.current || !authToken) return;     // قاعده‌ی ۱
    const timer = setTimeout(() => { pushDrawings(authToken, drawings); }, 600);
    return () => clearTimeout(timer);
  }, [drawings, authToken, isLoggedIn]);

  /**
   * پاک‌سازی هنگام خروج از حساب.
   *
   * ترتیب مهم است: اول state خالی می‌شود و قفل برمی‌گردد به false تا هیچ
   * افکتی نتواند دوباره چیزی بنویسد، بعد کشِ محلی پاک می‌شود.
   */
  const reset = useCallback(() => {
    setDrawings([]);
    loaded.current = false;
    clearCachedDrawings();
  }, []);

  return { drawings, setDrawings, add, remove, update, reset };
}
