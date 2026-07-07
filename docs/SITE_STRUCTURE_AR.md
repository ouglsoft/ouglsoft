# بنية الموقع النهائية

يعتمد المشروع بنية نظيفة تفصل ملفات النشر الثابتة عن الوظائف والوثائق.

```text
site/
  en/
  ar/
  fr/
  assets/
  404.html
  _headers
  _redirects
  robots.txt
  sitemap.xml
functions/
docs/
deploy/
```

- مجلد `site/` هو مجلد النشر في Cloudflare Pages.
- مجلد `functions/` يحتوي Cloudflare Pages Functions.
- مجلد `assets/` يحتوي CSS و JavaScript والصور وبيانات التحميل.
- كل لغة لها نفس بنية الصفحات تحت `/en/` و `/ar/` و `/fr/`.
- الصفحة الجذرية `/` تتحول إلى `/en/`.
