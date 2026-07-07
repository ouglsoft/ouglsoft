# Deployment

## Pages

```bash
npm run deploy:pages
```

ينفذ الأمر:

```bash
npm run prepare:pages
```

ثم ينشر:

```text
.deploy/site
```

محتوى صفحات ظامت المنشور تحت `/dhamet/` يقتصر على ملفات الواجهة المطلوبة:

```text
index.html
assets/
css/
js/
pages/
shared/
```

## Worker

```bash
npm run deploy:worker
```

ينشر Worker من:

```text
dhamet/worker
```

ويضيف إليه الملفات المشتركة من:

```text
dhamet/shared
```

مسار Worker:

```text
ouglsoft.com/dhamet/api/*
```
