# SaaS white-label (ops)

Manual tenant activation on one VPS — no self-serve license checkout in this phase.

## Sell flow

1. Buyer creates a Telegram bot via @BotFather and sends you the token.
2. Platform superadmin opens Admin → **مستأجرها**, enters name + slug + bot token (+ optional owner Telegram id).
3. System validates token (`getMe`), encrypts it, seeds settings, starts the bot (hot-reload).
4. Share the dash URL: `https://{slug}.{DASH_DOMAIN}` (dev: `http://localhost:3000/?tenant={slug}`).
5. Buyer admin logs in on their subdomain, configures 3x-ui panels, brand, card, prices.

## Superadmin

- Flagged via `ADMIN_TELEGRAM_IDS` on the **platform** tenant (`isSuperAdmin`).
- Suspend stops that tenant’s bot; platform tenant cannot be suspended.
- Logo upload: `uploads/tenants/{id}/logo*`.

## DNS / Nginx

- Cloudflare: `A dash` + `A *.dash` → VPS.
- Nginx `server_name` must include `*.dash.example.com` (see `deploy/nginx-dash.anthropics.ir.conf`).
- API resolves tenant from Host first label, or `X-Tenant-Slug` / `?tenant=`.

## Runtime

- One Node process; `BotManager` polls/webhooks per active tenant.
- Webhook path: `{TELEGRAM_WEBHOOK_PATH}/:tenantId`.
- Crons (notifications, panel reconcile, stale discounts) loop active tenants with ALS.
- Full SQLite backup still one file (platform bot notifies).

## Per-agent pricing

Admin → Users → agent → **قیمت اختصاصی**: `perGb` / `perMonth` / `unlimitedPerMonth`, or `partnerPricePercent` on matrix/rate.
