# Architecture (v1)

## Overview

```text
Telegram User
     │
     ├─ Bot (commands / inline) ──┐
     └─ Mini App (WebApp) ────────┤
                                  ▼
                         Nginx (HTTPS / domain)
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              /webhook        /api/*      /, /admin/*
              (grammY)        (Hono)       (Next.js)
                    │             │
                    └──────┬──────┘
                           ▼
                    PostgreSQL + Prisma
                           │
                           ▼
              3x-ui API (localhost + Bearer)
                           │
                           ▼
                      Xray clients / sub links
```

## Processes

| Process | Tech | Role |
|--------|------|------|
| `apps/server` | Node 22+, Hono, grammY, Prisma | API + Telegram webhook + cron سبک |
| `apps/web` | Next.js (App Router) | Mini App (`/`) + Admin (`/admin`) |
| `sqlite` | SQLite (Prisma) | دیتابیس اپ در v1 — سبک برای همان VPS؛ بعداً قابل ارتقا به PostgreSQL |

یک پروسهٔ `server` هم API را سرو می‌کند هم webhook بات را — مناسب یک VPS.

## Stack why

- **Hono** به‌جای Nest: سبک، TypeScript-first، مناسب یک تیم کوچک و یک سرور.
- **grammY**: مدرن، webhook روی همان Hono.
- **Prisma + SQLite**: برای v1 روی یک سرور کافی و بدون Docker؛ migration آمادهٔ ارتقا.
- **Next.js یک اپ**: Mini App و Admin یک deploy؛ جداسازی با route groups و auth.

## Auth

- **کاربر تلگرام:** `initData` Mini App / `telegram_id` در بات → JWT کوتاه‌عمر برای API.
- **ادمین وب:** تلگرام IDهای ادمین + session؛ عملیات حساس فقط برای role=admin.
- **3x-ui:** فقط سمت سرور، Bearer token در env/`settings` رمزنگاری‌شده.

## Core flows

### خرید کارت‌به‌کارت

```text
انتخاب پلن → ایجاد Order(pending_payment)
  → نمایش کارت → آپلود رسید → Order(awaiting_review)
  → اعلان به ادمین → approve
  → provision 3x-ui → Subscription + sub URL + QR
  → Order(completed) → پیام به کاربر
```

### خرید از کیف پول

```text
انتخاب پلن → اگر balance کافی → کسر کیف پول (با ledger)
  → provision → تحویل
```

### همکار

```text
درخواست → تأیید ادمین → role=partner → قیمت از جدول partner
```

## Modules (server)

- `auth` — Telegram / JWT
- `users` — roles
- `plans` — pricing tables (user/partner)
- `orders` — lifecycle
- `payments` — card-to-card + wallet ledger
- `subscriptions` — local records + panel mapping
- `panel` — 3x-ui HTTP client
- `settings` — channel, cards, brand
- `bot` — grammY handlers
- `admin` — review APIs for web + bot shortcuts

## Same-server notes

- پورت‌های 3x-ui (مثلاً 2053 / 2096) دست نخورده بمانند.
- اپ روی پورت داخلی (مثلاً 3000 web، 4000 api) پشت Nginx.
- توکن پنل هرگز به Mini App/Admin فرانت لو نرود.
- منابع: Postgres سبک + یک Node کافی است؛ مانیتور RAM بعد از deploy.

## Phase 2 (بعد از پایدار شدن فروش)

- درگاه آنلاین / کریپتو
- چند سرور با قوانین انتخاب
- تیکت پشتیبانی
- مانیتورینگ سلامت پنل
