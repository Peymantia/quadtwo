# SaaS white-label (ops)

Manual tenant activation on one VPS — no self-serve license checkout in this phase.

## Sell flow

1. Buyer creates a Telegram bot via @BotFather and sends you the token + their Telegram numeric id.
2. Platform superadmin opens Admin → **مستأجرها**, enters name + slug + bot token + **owner Telegram id** (required).
3. System validates token (`getMe`), encrypts it, seeds settings, creates owner as admin, starts the bot (hot-reload).
4. Share the dash URL: `https://{slug}.{DASH_DOMAIN}` (dev: `http://localhost:3000/?tenant={slug}`).
5. Buyer admin opens their subdomain (or `/start` on their bot), configures 3x-ui panels, brand, card, prices.
6. Edit later from the same tab: rotate bot token, change owner id, brand, logo, suspend/activate.

## Production checklist

```bash
# On VPS after git pull / q2 update
cd /opt/quadtwo/apps/server
# If upgrading an older single-tenant DB:
npx tsx src/scripts/migrate-to-tenants.ts
npx prisma db push
```

`.env` (recommended):

```env
TENANT_TOKEN_SECRET=long-random-string-not-bot-token
DASH_DOMAIN=dash.example.com
BOT_MODE=polling
```

Without `TENANT_TOKEN_SECRET`, bot tokens are encrypted with a key derived from platform `BOT_TOKEN` (weaker for multi-tenant).

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
- Webhook path: `{TELEGRAM_WEBHOOK_PATH}/:tenantId` (prefer polling until per-tenant setWebhook is wired).
- Crons (notifications, panel reconcile, stale discounts) loop active tenants with ALS.
- Full SQLite backup still one file (platform bot notifies).

## Per-agent pricing

Admin → Users → agent → **قیمت اختصاصی**: `perGb` / `perMonth` / `unlimitedPerMonth`, or `partnerPricePercent` on matrix/rate.
