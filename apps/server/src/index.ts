import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });

const { serve } = await import("@hono/node-server");
const { webhookCallback } = await import("grammy");
const { Hono } = await import("hono");
const { env } = await import("./config/env.js");
const { healthRoutes } = await import("./routes/health.js");
const { createApiApp } = await import("./routes/api.js");
const { seedIfNeeded } = await import("./services/seed.js");
const { ensurePlatformTenant } = await import("./services/tenants.js");
const { startAllTenantBots, getWebhookBot } = await import("./services/bot-manager.js");
const { runWithTenantAsync } = await import("./services/tenant-context.js");

await ensurePlatformTenant();
await seedIfNeeded();

const { assertLicenseAtStartup } = await import("./services/license.js");
assertLicenseAtStartup();

const app = new Hono();

app.route("/health", healthRoutes);
app.route("/api", createApiApp());

const { bots, byTenant } = await startAllTenantBots();

if (env.BOT_MODE === "webhook") {
  app.post(env.TELEGRAM_WEBHOOK_PATH + "/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    if (!tenantId) return c.text("missing tenant", 400);
    const bot = getWebhookBot(tenantId);
    if (!bot) return c.text("unknown tenant", 404);
    const handler = webhookCallback(bot, "hono");
    return runWithTenantAsync({ tenantId }, () => handler(c));
  });
  // legacy single path → platform bot
  const { getPlatformTenantId } = await import("./services/tenants.js");
  try {
    const platformId = await getPlatformTenantId();
    const bot = byTenant.get(platformId) ?? bots[0];
    if (bot) {
      app.post(env.TELEGRAM_WEBHOOK_PATH, async (c) => {
        const handler = webhookCallback(bot, "hono");
        return runWithTenantAsync({ tenantId: platformId }, () => handler(c));
      });
    }
  } catch (err) {
    console.warn("legacy webhook mount skipped", err);
  }
}

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`quadtwo server listening on :${env.PORT} (${bots.length} bot(s))`);
});

const apiForTenant = (tenantId: string) => byTenant.get(tenantId)?.api;

if (bots.length) {
  const { startNotificationCron } = await import("./services/notifications.js");
  startNotificationCron(apiForTenant);
  console.log("notification cron started (every 20m, per tenant)");

  const { startPanelReconcileCron } = await import("./services/admin-configs.js");
  startPanelReconcileCron();
  console.log("panel reconcile cron started (every 10m, per tenant)");

  const { startBackupCron } = await import("./services/backup.js");
  const { isDemoMode } = await import("./services/license.js");
  if (isDemoMode()) {
    console.log("backup cron skipped (DEMO_MODE — scheduled backups only on main bot)");
  } else {
    // Full DB dump once; notify platform admins via platform bot
    const { getPlatformTenantId } = await import("./services/tenants.js");
    const platformId = await getPlatformTenantId();
    const platformApi = apiForTenant(platformId) ?? bots[0]!.api;
    startBackupCron(platformApi);
    console.log("backup cron started (checks every 1m)");
  }
}

const { cancelStalePendingDiscountOrders } = await import("./services/discount-codes.js");
const { forEachActiveTenant } = await import("./services/tenants.js");
const runStaleDiscountCleanup = () => {
  void forEachActiveTenant(async (t) => {
    const n = await cancelStalePendingDiscountOrders({ olderThanMs: 30 * 60_000 });
    if (n > 0) console.log(`cancelled ${n} stale pending discount order(s) [${t.slug}]`);
  }).catch((err) => console.warn("stale discount cleanup", err));
};
runStaleDiscountCleanup();
setInterval(runStaleDiscountCleanup, 15 * 60_000);
console.log("stale discount-order cleanup started (every 15m)");
