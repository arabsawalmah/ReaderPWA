# Mixed Text Reader

تطبيق React بسيط يقرأ النصوص المختلطة بالعربية والإنجليزية والأرقام، مع اختيار الصوت والتحكم بسرعة القراءة.

## التشغيل

```bash
npm install
npm run dev
```

## البناء

```bash
npm run build
```

التطبيق مجهز كـ PWA ويمكن تثبيته واستخدامه دون إنترنت بعد فتح النسخة المنشورة عبر HTTPS لأول مرة.

## Azure Speech API

النشر السحابي يستخدم Netlify Functions لحماية مفتاح Azure. أضف متغيرات البيئة التالية في Netlify:

```text
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=...
ALLOWED_ORIGIN=https://your-site.netlify.app
VITE_ENABLE_CLOUD_SPEECH=true
```

أصوات Azure تحتاج اتصالاً بالإنترنت، بينما تبقى أصوات الجهاز متاحة دون إنترنت.
