# OuglSoft

مستودع الموقع الرسمي ولعبة ظامت.

## البنية

```text
site/                  ملفات الموقع العامة
functions/             دوال Cloudflare Pages الخاصة بالموقع
dhamet/site/           واجهة لعبة ظامت
dhamet/worker/         Worker لعبة ظامت
dhamet/shared/         ملفات ظامت المشتركة بين الواجهة والـ Worker
deploy/                سكربتات النشر
.github/workflows/     GitHub Actions
```

## النشر

يتم نشر الصفحات من GitHub Actions عبر Workflow:

```text
Deploy OuglSoft Pages
```

ينشئ هذا workflow مجلد النشر:

```text
.deploy/site
```

ويتضمن ناتج النشر:

```text
ouglsoft.com/          الموقع
ouglsoft.com/dhamet/   واجهة ظامت
```

لا يتضمن نشر الصفحات ملفات Worker أو ملفات GitHub أو سكربتات النشر.

يتم نشر Worker ظامت من GitHub Actions عبر Workflow:

```text
Deploy Dhamet Worker
```

مسار Worker المعتمد:

```text
ouglsoft.com/dhamet/api/*
```

إعداد اسم مشروع Cloudflare Pages موجود في `package.json` داخل:

```json
"cloudflare": {
  "pagesProjectName": "ouglsoft"
}
```
