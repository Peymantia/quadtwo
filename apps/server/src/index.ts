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
const { createBot } = await import("./bot/index.js");
const { healthRoutes } = await import("./routes/health.js");
const { seedIfNeeded } = await import("./services/seed.js");

await seedIfNeeded();

const app = new Hono();
const bot = createBot();

app.route("/health", healthRoutes);
app.get("/api", (c) => c.json({ name: "quadtwo", version: "0.1.0" }));

if (env.BOT_MODE === "webhook") {
  app.post(env.TELEGRAM_WEBHOOK_PATH, webhookCallback(bot, "hono"));
}

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`quadtwo server listening on :${env.PORT}`);
});

if (env.BOT_MODE === "polling") {
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
  } catch (err) {
    console.warn("deleteWebhook failed ( ادامه با polling ):", String(err));
  }

  bot.start({
    onStart: (info) => console.log(`bot @${info.username} polling`),
  }).catch((err) => {
    console.error(
      "ربات به api.telegram.org وصل نشد. روی VPS پنل اجرا کن یا TELEGRAM_PROXY را در .env ست کن.",
      err,
    );
  });
}
