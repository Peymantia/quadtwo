# فروش و دمو QuadTwo

این سند برای **فروشنده** (تو) و **خریدار** (صاحب پنل سنایی) است.

## دمو (پیش‌نمایش یک‌رباته)

سه ربات جدا لازم نیست. **یک نصب** QuadTwo با فلگ `DEMO_MODE=true`:

- همان `BOT_TOKEN` همان ربات BotFather است
- در تلگرام دکمه **تغییر نقش دمو** → ادمین / همکار / عمده / کاربر
- در داشبورد وب نوار زرد بالای صفحه همان سوییچ را دارد
- نقش فقط در سشن دمو عوض می‌شود؛ نقش واقعی دیتابیس ثابت می‌ماند
- لایسنس در دمو چک نمی‌شود
- این نصب را از فروش مشتری جدا نگه دارید (VPS / دامنه / پنل تست جدا)

### نوشتن `.env` برای دمو

حداقل:

```env
DEMO_MODE=true
BOT_TOKEN=123456789:AAH...          # توکن ربات دمو از BotFather
ADMIN_TELEGRAM_IDS=111111111        # تلگرام آیدی شما (عددی)
DASH_DOMAIN=dash.your-demo.com
PUBLIC_DOMAIN=dash.your-demo.com
NEXT_PUBLIC_API_URL=https://dash.your-demo.com
NEXT_PUBLIC_APP_URL=https://dash.your-demo.com
CORS_ORIGINS=https://dash.your-demo.com

# پنل تست 3x-ui
XUI_BASE_URL=http://127.0.0.1:2053/
XUI_API_TOKEN=...
XUI_INBOUND_IDS=1,2,3
```

`DEMO_MODE` مقادیر `true` / `1` / `yes` را می‌پذیرد. برای خاموش کردن: `DEMO_MODE=false` یا حذف خط.

روی نصب مشتری پولی **فعال نکنید**.

### مدیریت از CLI (پیشنهادی)

بعد از `install.sh` روی سرور دمو:

```bash
q2                  # منو → d) demo bot
q2 demo             # همان منوی Demo Bot
q2 demo status      # وضعیت DEMO_MODE + ربات
q2 demo enable      # ویزارد: توکن / ادمین اختیاری + DEMO_MODE=true + ری‌استارت
q2 demo disable     # DEMO_MODE=false + ری‌استارت
```

منوی Demo Bot:

1. status  
2. enable  
3. disable  
4. set-token  
5. set-admin  

---

## لایسنس فاز ۱ (قفل تلگرام + دامنه)

### صدور کلید (روی ماشین فروشنده)

```bash
cd /path/to/quadtwo
npm run issue-license -w @quadtwo/server -- --admins 123456789 --host dash.buyer.com
# چند ادمین:
npm run issue-license -w @quadtwo/server -- --admins 111,222 --host dash.buyer.com
```

خروجی یک کلید `Q2.1.…` است. آن را به خریدار بدهید.

اختیاری: `QUADTWO_LICENSE_SECRET=...` برای امضای اختصاصی (باید همان secret در بیلد خریدار باشد مگر از secret پیش‌فرض محصول استفاده کنید).

### فعال‌سازی (روی VPS خریدار)

بعد از `install.sh`:

```bash
q2 activate
# کلید را بچسبانید
```

یا:

```bash
q2 activate 'Q2.1.xxxxx.yyyyy'
q2 license
```

این کار در `.env` می‌نویسد:

| متغیر | معنی |
|--------|------|
| `LICENSE_KEY` | کلید امضاشده |
| `LICENSE_ADMIN_IDS` | Telegram ID ادمین(های) مجاز |
| `LICENSE_DASH_HOST` | هاست داشبورد (مثلاً `dash.buyer.com`) |
| `LICENSE_REQUIRE=1` | بدون لایسنس معتبر سرویس بالا نمی‌آید |
| `ADMIN_TELEGRAM_IDS` | هم‌تراز با ادمین لایسنس |

رفتار امنیتی:

- ادمین کنترل فقط برای IDهای لایسنس
- درخواست وب با `Host` خارج از دامنه لایسنس → `403 LICENSE_HOST`
- کلید نامعتبر → سرویس در استارت خارج می‌شود

نصب‌های قدیمی بدون کلید همچنان کار می‌کنند تا `LICENSE_REQUIRE=1` یا کلید ست شود.

---

## چک‌لیست تحویل به خریدار

1. دسترسی به ریپو / اسکریپت نصب
2. یک کلید لایسنس (ادمین + دامنه)
3. راهنمای: نصب → `q2 activate` → اتصال 3x-ui → `/start`
4. پشتیبانی: تعویض دامنه = صدور کلید جدید

## تعویض دامنه یا ادمین

کلید جدید صادر کنید و دوباره `q2 activate` بزنید.
