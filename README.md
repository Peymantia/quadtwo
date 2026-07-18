# Quadtwo

ربات تلگرام فروش VPN متصل به [3x-ui](https://github.com/MHSanaei/3x-ui/wiki) + اسکلت Mini App / Admin.

مستندات: [`docs/PROJECT.md`](docs/PROJECT.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md)

## نصب یک‌خطی روی سرور (Ubuntu/Debian و مشابه)

با دسترسی root:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Peymantia/quadtwo/main/install.sh)
```

اسکریپت Node.js، کلون پروژه در `/opt/quadtwo`، دیتابیس، و سرویس `systemd` را راه می‌اندازد.

بعد از نصب:

```bash
quadtwo status
quadtwo logs
quadtwo restart
quadtwo env      # ویرایش .env
quadtwo update   # به‌روزرسانی از GitHub
```

حذف:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Peymantia/quadtwo/main/install.sh) --uninstall
```

### قبل از نصب آماده کنید
- `BOT_TOKEN` از BotFather
- Telegram numeric ID ادمین
- Base URL پنل 3x-ui (ترجیحاً `http://127.0.0.1:PORT/basepath/` روی همان سرور)
- API Token از پنل: Settings → Security
- Inbound ID فروش (مثلاً `1`)

بعد از بالا آمدن ربات در تلگرام `/start` بزنید و کارت را ست کنید:

```text
/setcard 6037-xxxx-xxxx-xxxx|نام صاحب حساب
/setsupport @username
/setminiapp https://app.piing.ir
```

به‌روزرسانی سرور موجود:

```bash
quadtwo update
```

## امکانات فعلی
- ماتریکس قیمت حجم×مدت (user / partner)
- خرید با دکمه‌های +/- حجم و مدت
- همکار + گروه در 3x-ui
- تمدید / تغییر لینک ساب / باطل‌کردن کانفیگ قدیم
- تحویل فقط لینک ساب + QR
- Mini App (Buy / Services / Admin) + REST `/api`

## توسعه لوکال

```bash
cp .env.example .env
npm install
npm run db:push -w @quadtwo/server
npm run dev -w @quadtwo/server
```

اگر از ایران به `api.telegram.org` وصل نمی‌شوید، روی VPS پنل اجرا کنید یا `TELEGRAM_PROXY` بگذارید.

## ساختار

```text
apps/server      API + ربات (Hono + grammY + Prisma/SQLite)
apps/web         Mini App + Admin (Next.js) — فاز بعدی UI
packages/shared  تایپ‌های مشترک
install.sh       نصب‌کننده سرور
```
