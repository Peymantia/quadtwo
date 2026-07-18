# Quadtwo — فروش VPN روی 3x-ui

ربات تلگرام + Mini App + پنل مدیریت برای فروش اشتراک، متصل به پنل رسمی [3x-ui (MHSanaei)](https://github.com/MHSanaei/3x-ui/wiki).

## هدف نسخه ۱

یک سیستم قابل‌استفاده روی **همان سرور پنل** که کاربر بتواند بخرد، ادمین تأیید کند، و اکانت روی 3x-ui ساخته شود.

## داخل محدوده (v1)

- ربات تلگرام (webhook روی دامنه)
- Telegram Mini App (خرید و مشاهده اشتراک)
- پنل وب ادمین (سفارش‌ها، قیمت‌ها، تنظیمات)
- نقش‌ها: `user` | `partner` | `admin`
- عضویت اجباری کانال (قابل تنظیم)
- قیمت‌گذاری جدول دستی برای user و partner (نه درصد)
- خرید با انتخاب حجم/مدت از پلن‌های تعریف‌شده
- پرداخت کارت‌به‌کارت + ارسال رسید + تأیید/رد ادمین
- کیف پول (شارژ کارت‌به‌کارت + خرید از موجودی)
- اتصال به 3x-ui رسمی با **API Token (Bearer)**
- ساخت کلاینت، لینک ساب، QR Code
- یک سرور/پنل در عمل؛ مدل دیتابیس آمادهٔ چند سرور
- Docker Compose برای deploy

## خارج از محدوده (فعلاً)

- Multi-tenant / لایسنس / فروش به دیگران
- Plugin system عمومی / Payment providerهای آمادهٔ خاموش
- درگاه آنلاین و کریپتو (فقط جای خالی «به‌زودی»)
- Marzban و پنل‌های غیررسمی
- چند سطح همکاری (فقط user / partner)
- Redis / صف پیام سنگین
- Serverless

## مرجع API پنل

- ویکی: https://github.com/MHSanaei/3x-ui/wiki
- OpenAPI داخل پنل: `/panel/api/openapi.json`
- احراز هویت پیشنهادی: `Authorization: Bearer <API Token>` از Settings → Security
- کلاینت جدید: endpointهای `/panel/api/clients/*` (طبق نسخه پنل؛ مرجع نهایی Swagger خود پنل است)

## استقرار

- همه چیز روی **همان VPS پنل 3x-ui**
- فراخوانی API پنل از `localhost` (بدون افشای توکن به کلاینت)
- دامنه + HTTPS برای webhook، Mini App و Admin
