import type { Bot } from "grammy";
import { TenantStatus, type Tenant } from "@prisma/client";
import { env } from "../config/env.js";
import { createBot } from "../bot/index.js";
import { runWithTenantAsync } from "./tenant-context.js";
import { listActiveTenants, tenantBotTokenPlain } from "./tenants.js";
import { prisma } from "../db.js";

type Running = {
  tenantId: string;
  slug: string;
  bot: Bot;
  stop: () => Promise<void>;
};

const running = new Map<string, Running>();

export function getRunningBot(tenantId: string): Bot | null {
  return running.get(tenantId)?.bot ?? null;
}

export function listRunningTenantIds(): string[] {
  return [...running.keys()];
}

async function startOne(tenant: Tenant): Promise<void> {
  if (running.has(tenant.id)) return;
  if (tenant.status !== TenantStatus.active) return;
  let token: string;
  try {
    token = tenantBotTokenPlain(tenant);
  } catch (err) {
    console.error(`tenant ${tenant.slug}: bad bot token`, err);
    return;
  }
  if (!token || token === "pending" || token.length < 20) {
    console.warn(`tenant ${tenant.slug}: skipping bot (no token)`);
    return;
  }

  const bot = createBot(token, {
    tenantId: tenant.id,
    slug: tenant.slug,
    isPlatform: tenant.isPlatform,
  });

  let stopFn: () => Promise<void> = async () => undefined;

  if (env.BOT_MODE === "polling") {
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch (err) {
      console.warn(`tenant ${tenant.slug} deleteWebhook`, err);
    }
    const runner = bot.start({
      onStart: (info) => console.log(`bot @${info.username} polling [${tenant.slug}]`),
    });
    runner.catch((err) => {
      console.error(`tenant ${tenant.slug} polling error`, err);
    });
    stopFn = async () => {
      try {
        await bot.stop();
      } catch (err) {
        console.warn(`tenant ${tenant.slug} stop`, err);
      }
    };
  }

  running.set(tenant.id, {
    tenantId: tenant.id,
    slug: tenant.slug,
    bot,
    stop: stopFn,
  });
}

export async function stopTenantBot(tenantId: string): Promise<void> {
  const r = running.get(tenantId);
  if (!r) return;
  await r.stop();
  running.delete(tenantId);
  console.log(`stopped bot for tenant ${r.slug}`);
}

export async function restartTenantBot(tenantId: string): Promise<void> {
  await stopTenantBot(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (tenant) await startOne(tenant);
}

export async function startAllTenantBots(): Promise<{ bots: Bot[]; byTenant: Map<string, Bot> }> {
  const tenants = await listActiveTenants();
  for (const t of tenants) {
    try {
      await startOne(t);
    } catch (err) {
      console.error(`failed to start bot for ${t.slug}`, err);
    }
  }
  const byTenant = new Map<string, Bot>();
  for (const [id, r] of running) byTenant.set(id, r.bot);
  return { bots: [...byTenant.values()], byTenant };
}

/** Register webhook routes on a Hono-like app callback registrar */
export function getWebhookBot(tenantId: string): Bot | null {
  return getRunningBot(tenantId);
}

export async function withTenantBotApi<T>(
  tenantId: string,
  fn: (api: Bot["api"]) => Promise<T>,
): Promise<T | null> {
  const bot = getRunningBot(tenantId);
  if (!bot) return null;
  return runWithTenantAsync({ tenantId }, () => fn(bot.api));
}
