# نصب وب‌پنل (داشبورد)

API روی پورت `4000` و Next.js روی `3000`، پشت Nginx و Cloudflare.

اسکریپت `install.sh` / `q2 update` به‌صورت خودکار:

1. nginx را نصب می‌کند (اگر نباشد)
2. از `deploy/nginx-dash.conf` سایت را با `DASH_DOMAIN` شما می‌نویسد
3. `sites-enabled/default` را حذف می‌کند تا 404 خالی ندهد

## DNS در Cloudflare

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `dash` (یا دامنه داشبورد) | IP سرور | Proxied (نارنجی) |
| A | `*.dash` | IP سرور | Proxied — برای مستأجرها `{slug}.dash.…` |

### SSL/TLS

| حالت | چه موقع |
|------|---------|
| **Flexible** | پیش‌فرض — Nginx فقط پورت **80** |
| **Full** / **Full Strict** | فقط بعد از گواهی واقعی روی origin (certbot) |

## دستی (اگر لازم شد)

```bash
# دامنه را در .env درست کنید
nano /opt/quadtwo/.env   # DASH_DOMAIN=dash.example.com

# nginx را از روی قالب بسازید
DOMAIN=$(grep '^DASH_DOMAIN=' /opt/quadtwo/.env | cut -d= -f2)
sed "s/__DASH_DOMAIN__/${DOMAIN}/g" /opt/quadtwo/deploy/nginx-dash.conf \
  > /etc/nginx/sites-available/quadtwo-dash
ln -sfn /etc/nginx/sites-available/quadtwo-dash /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable --now nginx

# تست محلی
curl -sI -H "Host: ${DOMAIN}" http://127.0.0.1/login | head -10
```

## بیلد وب با دامنه جدید

```bash
cd /opt/quadtwo
source .env
rm -rf apps/web/.next
NEXT_PUBLIC_API_URL="https://${DASH_DOMAIN}" NEXT_PUBLIC_APP_URL="https://${DASH_DOMAIN}" \
  npm run build -w @quadtwo/web
systemctl restart quadtwo quadtwo-web
```
