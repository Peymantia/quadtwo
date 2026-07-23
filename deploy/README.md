# نصب وب‌پنل Piing (`dash.anthropics.ir`)

داشبورد گرافیکی روی همان سرور ربات اجرا می‌شود: API روی پورت `4000` و Next.js روی `3000`، پشت Nginx و Cloudflare.

## پیش‌نیاز

- ربات Quadtwo از قبل با `install.sh` نصب شده باشد (`/opt/quadtwo`)
- دامنه در Cloudflare روی IP سرور پوینت شده باشد
- دسترسی root به VPS

## ۱) DNS در Cloudflare

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `dash` | IP سرور | Proxied (نارنجی) |

### SSL/TLS (مهم)

| حالت | چه موقع |
|------|---------|
| **Flexible** | پیش‌فرض همین راهنما — Nginx فقط روی پورت **80** (بدون گواهی روی سرور) |
| **Full** / **Full Strict** | فقط بعد از نصب گواهی واقعی روی origin (certbot) |

اگر Cloudflare روی **Full** باشد ولی روی سرور `listen 443 ssl` بدون فایل گواهی باشد، مرورگر خطای `SSL_ERROR_RX_RECORD_TOO_LONG` می‌دهد.

مثال کامل: `dash.anthropics.ir`

## ۲) متغیرهای `.env`

```bash
quadtwo env
# یا
nano /opt/quadtwo/.env
```

```env
DASH_DOMAIN=dash.anthropics.ir
PUBLIC_DOMAIN=app.anthropics.ir
NEXT_PUBLIC_API_URL=https://dash.anthropics.ir
NEXT_PUBLIC_APP_URL=https://dash.anthropics.ir
CORS_ORIGINS=https://dash.anthropics.ir,https://app.anthropics.ir
```

## ۳) به‌روزرسانی و بیلد

```bash
quadtwo update
```

سرویس‌ها:

| سرویس | نقش | پورت |
|--------|-----|------|
| `quadtwo` | API + ربات | 4000 |
| `quadtwo-web` | داشبورد Next.js | 3000 |

```bash
systemctl status quadtwo quadtwo-web
curl -s http://127.0.0.1:4000/health
curl -sI http://127.0.0.1:3000/login
```

## ۴) Nginx (فقط HTTP روی ۸۰ — مناسب Cloudflare Flexible)

```bash
cp /opt/quadtwo/deploy/nginx-dash.anthropics.ir.conf /etc/nginx/sites-available/dash.anthropics.ir
ln -sf /etc/nginx/sites-available/dash.anthropics.ir /etc/nginx/sites-enabled/

# اگر سایت قدیمی با 443 خراب دارید، همان را جایگزین کنید
nginx -t && systemctl reload nginx
```

در Cloudflare → **SSL/TLS** → حالت را روی **Flexible** بگذارید.

بررسی از خود سرور:

```bash
curl -sI -H "Host: dash.anthropics.ir" http://127.0.0.1/login
# باید 200 یا 307 از Next باشد، نه اتصال SSL
```

### ارتقا به Full (اختیاری)

```bash
apt install -y certbot python3-certbot-nginx
# موقتاً SSL را Flexible نگه دارید یا DNS challenge استفاده کنید
certbot --nginx -d dash.anthropics.ir
```

بعد از موفق بودن certbot، در Cloudflare SSL را به **Full (strict)** تغییر دهید.

## ۵) رفع سریع `SSL_ERROR_RX_RECORD_TOO_LONG`

علت: چیزی روی پورت **443** پاسخ **غیر TLS** می‌دهد (مثلاً Nginx با `listen 443 ssl` بدون `ssl_certificate`).

روی سرور:

```bash
# ببینید 443 به چه گوش می‌دهد
ss -tlnp | grep -E ':80|:443'

# کانفیگ جدید (فقط :80) را بگذارید
cp /opt/quadtwo/deploy/nginx-dash.anthropics.ir.conf /etc/nginx/sites-available/dash.anthropics.ir
nginx -t && systemctl reload nginx

# هر vhost دیگری که 443 ssl بدون گواهی دارد را پیدا/حذف کنید
grep -R "listen 443" /etc/nginx/sites-enabled/ || true
```

در Cloudflare:

1. SSL/TLS → **Flexible**
2. Cache → Purge Everything
3. دوباره `https://dash.anthropics.ir/login` را باز کنید

## ۶) اولین ورود

1. در تلگرام `/start`
2. دکمه **کد ورود داشبورد**
3. `https://dash.anthropics.ir/login` + کد OTP
4. در تنظیمات داشبورد رمز وب بگذارید

| نقش | مسیر |
|-----|------|
| کاربر | `/app` |
| همکار | `/partner` |
| ریسلر | `/reseller` |
| ادمین | `/admin` |

## عیب‌یابی

| مشکل | بررسی |
|------|--------|
| `SSL_ERROR_RX_RECORD_TOO_LONG` | بخش ۵ — Nginx فقط :80 + Cloudflare Flexible |
| **404 nginx/Ubuntu** | سایت `default` فعال است یا کانفیگ dash لود نشده — دستورات زیر |
| 502 | `systemctl status quadtwo-web` و `curl -sI http://127.0.0.1:3000/login` |
| صفحه سفید / API خطا | `NEXT_PUBLIC_API_URL` و بیلد دوباره وب |
| **Application error / chunk 404** | HTML قدیمی + بیلد جدید — دستورات «رفع chunk 404» زیر |
| OTP نمی‌رسد | ربات آنلاین؛ کاربر `/start` زده باشد |

### رفع chunk 404 (`/_next/static/chunks/…` Not Found)

بعد از آپدیت، اگر مرورگر/Cloudflare HTML قدیمی نگه دارد، به فایل‌های hashشدهٔ قبلی درخواست می‌زند و اپ می‌ترکد.

```bash
cd /opt/quadtwo
git pull
rm -rf apps/web/.next
# دامنه داشبورد را از .env بخوانید
set -a; source .env; set +a
NEXT_PUBLIC_API_URL="https://${DASH_DOMAIN:-dash.anthropics.ir}" npm run build -w @quadtwo/web
systemctl restart quadtwo-web

# nginx: کش HTML خاموش
cp deploy/nginx-dash.anthropics.ir.conf /etc/nginx/sites-available/dash.anthropics.ir
nginx -t && systemctl reload nginx

# چک محلی
curl -sI http://127.0.0.1:3000/login | head
ls apps/web/.next/static/chunks | head
```

در Cloudflare: **Caching → Configuration → Purge Everything** (یا فقط `dash.anthropics.ir`).
سپس در مرورگر hard refresh / کش مینی‌اپ را پاک کنید.

### رفع 404 از nginx (نه از Next)

```bash
# وب باید مستقیم جواب بدهد
curl -sI http://127.0.0.1:3000/login
systemctl status quadtwo-web --no-pager

# سایت پیش‌فرض اوبونتو را خاموش کنید
rm -f /etc/nginx/sites-enabled/default

# کانفیگ dash را دوباره بگذارید
cd /opt/quadtwo && git pull
cp deploy/nginx-dash.anthropics.ir.conf /etc/nginx/sites-available/dash.anthropics.ir
ln -sf /etc/nginx/sites-available/dash.anthropics.ir /etc/nginx/sites-enabled/dash.anthropics.ir

nginx -t && systemctl reload nginx

# باید از پروکسی Next باشد (نه 404 خالی nginx)
curl -sI -H "Host: dash.anthropics.ir" http://127.0.0.1/login
ls -la /etc/nginx/sites-enabled/
```

```bash
journalctl -u quadtwo -u quadtwo-web -f
```
