# 🌿 Relax — دليل التحسينات

## 📁 هيكل الملفات الجديد

```
relax/
├── relax-firebase.html    ← الملف الرئيسي (HTML فقط)
├── css/
│   └── styles.css         ← كل التنسيقات (محسّنة)
├── js/
│   └── app.js             ← كل JavaScript (محسّن)
├── firestore.rules        ← قواعد الأمان (مُحكمة)
├── manifest.json
└── sw.js
```

---

## 🔴 1. أمان Firebase — أهم خطوة

### كيفية التطبيق:
1. افتح [Firebase Console](https://console.firebase.google.com)
2. اختر مشروعك `relax-5d7d9`
3. اذهب إلى **Firestore → Rules**
4. انسخ محتوى `firestore.rules` والصقه
5. اضغط **Publish**

### ماذا تحسّن؟
| قبل | بعد |
|-----|-----|
| أي شخص يقدر يكتب أي بيانات | فقط المستخدم المصادق عليه |
| لا تحقق من صحة البيانات | تحقق من النوع والطول والقيم |
| المحادثات مكشوفة | فقط المشاركون يقرأون |
| لا حماية من Spam | تحقق من userId في كل عملية |

### تفعيل Admin عبر Custom Claims:
```javascript
// في Firebase Admin SDK (Node.js):
admin.auth().setCustomUserClaims(uid, { admin: true });
```

---

## ⚡ 2. تحسينات الأداء

### ما الذي تغيّر؟

**Debounced Search** — البحث لا يحدث إلا بعد 250ms من التوقف عن الكتابة
```javascript
// قبل: يُشغّل applyFilters() في كل حرف
// بعد: 
const _debouncedFilter = debounce(applyFilters, 250);
```

**Skeleton Loading** — شاشة تحميل أنيقة بدل الفراغ
```javascript
showSkeletons(); // يظهر 8 بطاقات فارغة أثناء التحميل
```

**Lazy Images** — تحميل الصور فقط عند ظهورها
```html
<img loading="lazy" src="...">
```

**Memory Leak Fix** — إيقاف setInterval عند تسجيل الخروج
```javascript
if (_unreadCheckTimer) clearInterval(_unreadCheckTimer);
```

**XSS Protection** — تنظيف كل المدخلات قبل عرضها
```javascript
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;')...
}
```

**CSS Variables للـ Header Height** — بدل تكرار القيم
```css
:root { --header-h: 66px; }
.filters-section { top: var(--header-h); }
```

---

## 🎨 3. تحسينات التصميم

- إزالة CSS المكرر (dark-mode كان مكتوباً مرتين!)
- `backdrop-filter` مع `-webkit-` prefix للتوافق
- `will-change: transform` فقط على العناصر المتحركة
- استخدام `clamp()` للخطوط المتجاوبة
- تحسين التباين في الألوان

---

## 📁 4. كيف تدمج الملفات في HTML

في `<head>`:
```html
<!-- CSS خارجي بدل style inline -->
<link rel="stylesheet" href="./css/styles.css">
```

قبل `</body>`:
```html
<!-- JS خارجي بدل script inline -->
<script src="./js/app.js" defer></script>
```

**ملاحظة:** ملفات `i18n.js`, `auth.js`, `dashboard.js`, `detail.js` يمكن فصلها لاحقاً.

---

## 🔒 قواعد أمان إضافية

### منع رفع ملفات خطيرة (Cloudinary):
في إعدادات Cloudinary، فعّل:
- Allowed formats: jpg, jpeg, png, webp, gif
- Max file size: 5MB
- Auto moderation

### Rate Limiting (Firebase):
أضف في Security Rules:
```javascript
// منع الإرسال المتكرر
function notRecentlyCreated(uid) {
  return !exists(/databases/$(database)/documents/rate_limits/$(uid));
}
```

---

## 📊 قبل وبعد

| المقياس | قبل | بعد |
|---------|-----|-----|
| حجم ملف HTML | ~220KB | ~80KB |
| CSS مكرر | ✗ نعم | ✓ لا |
| XSS protection | ✗ لا | ✓ نعم |
| Memory leaks | ✗ نعم | ✓ مُصلح |
| Debounced search | ✗ لا | ✓ نعم |
| Firebase Rules | ⚠️ جزئية | ✓ محكمة |
| Lazy loading | ⚠️ جزئي | ✓ كامل |
