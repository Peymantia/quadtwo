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

SSL/TLS در Cloudflare روی **Full** (یا Full Strict اگر گواهی معتبر روی origin دارید).

مثال کامل: `dash.anthropics.ir`

## ۲) متغیرهای `.env`

```bash
quadtwo env
# یا
nano /opt/quadtwo/.env
```

این خطوط را اضافه/به‌روز کنید:

```env
DASH_DOMAIN=dash.anthropics.ir
PUBLIC_DOMAIN=app.anthropics.ir
NEXT_PUBLIC_API_URL=https://dash.anthropics.ir
NEXT_PUBLIC_APP_URL=https://dash.anthropics.ir
CORS_ORIGINS=https://dash.anthropics.ir,https://app.anthropics.ir
```

ذخیره کنید.

## ۳) به‌روزرسانی و بیلد

```bash
quadtwo update
```

یا دستی:

```bash
cd /opt/quadtwo
git pull
npm install
npm run db:generate -w @quadtwo/server
DATABASE_URL="file:/opt/quadtwo/data/quadtwo.db" npm run db:push -w @quadtwo/server
npm run build -w @quadtwo/server
NEXT_PUBLIC_API_URL=https://dash.anthropics.ir npm run build -w @quadtwo/web
systemctl restart quadtwo quadtwo-web
```

سرویس‌ها:

| سرویس | نقش | پورت |
|--------|-----|------|
| `quadtwo` | API + ربات | 4000 |
| `quadtwo-web` | داشبورد Next.js | 3000 |

بررسی:

```bash
systemctl status quadtwo quadtwo-web
curl -s http://127.0.0.1:4000/health
curl -sI http://127.0.0.1:3000/login
```

## ۴) Nginx

```bash
cp /opt/quadtwo/deploy/nginx-dash.anthropics.ir.conf /etc/nginx/sites-available/dash.anthropics.ir
ln -sf /etc/nginx/sites-available/dash.anthropics.ir /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

نمونه کانفیگ: [`nginx-dash.anthropics.ir.conf`](./nginx-dash.anthropics.ir.conf)

- `/api/` و `/health` و `/telegram/` → API (`4000`)
- بقیه مسیرها → وب (`3000`)

اگر TLS را خودتان روی سرور می‌خواهید (نه فقط Cloudflare):

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d dash.anthropics.ir
```

و خطوط `ssl_certificate` داخل فایل Nginx را از حالت کامنت خارج کنید.

## ۵) اولین ورود

1. در تلگرام به ربات `/start` بزنید.
2. دکمه **کد ورود داشبورد** را بزنید و کد ۶ رقمی را بگیرید.
3. مرورگر: `https://dash.anthropics.ir/login`
4. یوزرنیم تلگرام یا آی‌دی عددی + کد OTP.
5. از تب تنظیمات داخل داشبورد، **رمز عبور** بگذارید تا بعداً بدون OTP هم وارد شوید.

مسیرها بر اساس نقش:

| نقش | مسیر |
|-----|------|
| کاربر | `/app` |
| همکار | `/partner` |
| ریسلر | `/reseller` |
| ادمین | `/admin` |

## ۶) دکمه ربات

منوی ربات لینک داشبورد را از `DASH_DOMAIN` می‌سازد:

- 🌐 داشبورد وب
- 🔐 کد ورود داشبورد

## عیب‌یابی سریع

| مشکل | بررسی |
|------|--------|
| صفحه سفید / API خطا | `CORS_ORIGINS` و `NEXT_PUBLIC_API_URL` باید همان دامنه داشبورد باشند؛ وب را دوباره بیلد کنید |
| OTP نمی‌رسد | ربات باید آنلاین باشد؛ کاربر قبلاً `/start` زده باشد |
| 502 از Cloudflare | `quadtwo-web` و Nginx را چک کنید |
| نقش اشتباه | در کنترل سنتر ادمین / تب کاربران داشبورد، نقش را عوض کنید |

```bash
journalctl -u quadtwo -u quadtwo-web -f
```
