# إعداد تنزيل التطبيقات في موقع OuglSoft

تم تجهيز الموقع بروابط تنزيل ثابتة لا تتطلب تعديل صفحات HTML عند تحديث التطبيق لاحقًا.

## الروابط العامة داخل الموقع

- `/download/safe-to-spend` → `assets/downloads/apps/safe-to-spend.apk`
- `/download/almoathen-shinqiti` → `assets/downloads/apps/almoathen-shinqiti.apk`

## الملفات الحالية

| التطبيق | اسم الملف داخل الموقع | الإصدار | الحجم | SHA-256 |
|---|---|---:|---:|---|
| Safe-to-Spend | `assets/downloads/apps/safe-to-spend.apk` | 1.1.3 | 0.9 MB | غير مثبت لأن ملف APK الجديد غير مرفق |
| المؤذن الشنقيطي | `assets/downloads/apps/almoathen-shinqiti.apk` | 1.0.0 | 14.1 MB | `3ef6058882c778c5e209ed11e48240534acd1a21562565d84cab7ec91d910f5f` |

## طريقة تحديث التطبيق بدون تعديل كود الموقع

1. جهّز نسخة APK الجديدة.
2. أعد تسميتها بنفس الاسم الثابت:
   - `safe-to-spend.apk`
   - `almoathen-shinqiti.apk`
3. استبدل الملف القديم داخل مجلد `downloads/` في GitHub.
4. اعمل Commit للتغيير.
5. Cloudflare Pages سيبدأ نشرًا جديدًا تلقائيًا إذا كان الموقع مربوطًا بالمستودع.

صفحات الموقع لا تحتاج إلى تعديل لأن الأزرار تشير إلى روابط ثابتة تحت `/download/...`.

## سبب وجود ملف `_redirects`

الأزرار في الموقع لا تشير مباشرة إلى `/assets/downloads/apps/file.apk`، بل تشير إلى مسارات نظيفة مثل:

```text
/download/safe-to-spend
/download/almoathen-shinqiti
```

هذه المسارات يتم تحويلها من Cloudflare Pages إلى ملفات APK الحالية. إذا أردتم لاحقًا نقل الملفات إلى GitHub Releases، غيّروا ملف `_redirects` فقط، ولا تعدلوا صفحات HTML.

## خيار GitHub Releases لاحقًا

يوجد ملف قالب باسم `_redirects.github-releases-template`. بعد إنشاء Releases في GitHub يمكن استخدامه بدل `_redirects` مع تغيير `OWNER` واسم المستودع.

ميزة GitHub Releases أنها تعطي `download_count` عبر GitHub API، بينما الوضع الحالي المباشر داخل الموقع لا يعطي عدّاد تنزيلات رسميًا لكل ملف، لكنه أبسط ويعمل فورًا دون إعداد إضافي.
