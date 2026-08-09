import { TenantStatus } from "@prisma/client";
import { dashBaseUrl, env } from "../config/env.js";
import { prisma } from "../db.js";
import { PLATFORM_TENANT_SLUG, runWithTenantAsync } from "./tenant-context.js";
import { decryptBotToken, encryptBotToken, normalizeTenantSlug } from "./tenant-crypto.js";

let cachedPlatformId: string | null = null;

export async function getPlatformTenantId(): Promise<string> {
  if (cachedPlatformId) return cachedPlatformId;
  const t = await prisma.tenant.findFirst({
    where: { OR: [{ isPlatform: true }, { slug: PLATFORM_TENANT_SLUG }] },
  });
  if (!t) throw new Error("platform tenant missing — run ensurePlatformTenant()");
  cachedPlatformId = t.id;
  return t.id;
}

export async function resolveTenantIdOrPlatform(): Promise<string> {
  const { tryTenantId } = await import("./tenant-context.js");
  return tryTenantId() ?? (await getPlatformTenantId());
}

/** Run fn inside ALS for every active tenant (crons, sweeps). */
export async function forEachActiveTenant(
  fn: (tenant: {
    id: string;
    slug: string;
    isPlatform: boolean;
    botToken: string;
    brandName: string;
  }) => Promise<void>,
): Promise<void> {
  const tenants = await listActiveTenants();
  for (const t of tenants) {
    await runWithTenantAsync(
      { tenantId: t.id, slug: t.slug, isPlatform: t.isPlatform },
      () => fn(t),
    );
  }
}

/** Create/migrate the default platform tenant from env BOT_TOKEN. */
export async function ensurePlatformTenant(): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.tenant.findFirst({
    where: { OR: [{ isPlatform: true }, { slug: PLATFORM_TENANT_SLUG }] },
  });
  if (existing) {
    cachedPlatformId = existing.id;
    // Keep platform token in sync with .env when empty or still placeholder
    if (env.BOT_TOKEN && (!existing.botToken || existing.botToken === "pending")) {
      await prisma.tenant.update({
        where: { id: existing.id },
        data: { botToken: encryptBotToken(env.BOT_TOKEN) },
      });
    }
    const { adminIds } = await import("../config/env.js");
    for (const tid of adminIds()) {
      await prisma.user.updateMany({
        where: { tenantId: existing.id, telegramId: tid },
        data: { isSuperAdmin: true, role: "admin" },
      });
    }
    return { id: existing.id, created: false };
  }

  const brand = "پیـنگ";
  const tenant = await prisma.tenant.create({
    data: {
      slug: PLATFORM_TENANT_SLUG,
      name: "Platform",
      botToken: encryptBotToken(env.BOT_TOKEN || "pending"),
      brandName: brand,
      isPlatform: true,
      status: TenantStatus.active,
    },
  });
  cachedPlatformId = tenant.id;
  console.log(`created platform tenant ${tenant.id}`);

  // Flag env admins as superadmins on platform
  const { adminIds } = await import("../config/env.js");
  for (const tid of adminIds()) {
    await prisma.user.updateMany({
      where: { tenantId: tenant.id, telegramId: tid },
      data: { isSuperAdmin: true, role: "admin" },
    });
  }

  return { id: tenant.id, created: true };
}

export async function listActiveTenants() {
  return prisma.tenant.findMany({
    where: { status: TenantStatus.active },
    orderBy: { createdAt: "asc" },
  });
}

export async function getTenantById(id: string) {
  return prisma.tenant.findUnique({ where: { id } });
}

export async function getTenantBySlug(slug: string) {
  return prisma.tenant.findUnique({ where: { slug: slug.trim().toLowerCase() } });
}

export function tenantBotTokenPlain(tenant: { botToken: string }): string {
  return decryptBotToken(tenant.botToken);
}

export type CreateTenantInput = {
  name: string;
  slug: string;
  botToken: string;
  brandName?: string;
  ownerTelegramId: bigint | number;
  welcomeText?: string | null;
  supportUsername?: string | null;
};

export async function createTenant(input: CreateTenantInput) {
  const slug = normalizeTenantSlug(input.slug);
  if (slug === PLATFORM_TENANT_SLUG) throw new Error("slug رزرو شده است");
  const token = input.botToken.trim();
  if (token.length < 20) throw new Error("توکن ربات نامعتبر است");
  if (input.ownerTelegramId == null) {
    throw new Error("آی‌دی تلگرام ادمین خریدار لازم است");
  }

  // Validate with Telegram
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()) as {
    ok?: boolean;
    result?: { username?: string; id?: number };
    description?: string;
  };
  if (!me.ok) throw new Error(me.description || "توکن ربات نامعتبر است");

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: input.name.trim().slice(0, 80) || slug,
      botToken: encryptBotToken(token),
      botUsername: me.result?.username ?? null,
      brandName: (input.brandName || input.name).trim().slice(0, 80),
      welcomeText: input.welcomeText?.trim() || null,
      supportUsername: input.supportUsername?.trim() || null,
      ownerTelegramId:
        input.ownerTelegramId != null ? BigInt(input.ownerTelegramId) : null,
      isPlatform: false,
      status: TenantStatus.active,
    },
  });

  // Seed default settings for the new tenant
  await runWithTenantAsync({ tenantId: tenant.id, slug: tenant.slug }, async () => {
    const { ensureDefaultSettings, setSetting } = await import("./settings.js");
    await ensureDefaultSettings();
    if (tenant.brandName) await setSetting("brand_name", tenant.brandName);
    if (tenant.welcomeText) await setSetting("welcome_text", tenant.welcomeText);
    if (tenant.supportUsername) await setSetting("support_username", tenant.supportUsername);
  });

  // Create owner as admin user if telegram id provided
  if (tenant.ownerTelegramId != null) {
    await prisma.user.upsert({
      where: {
        tenantId_telegramId: {
          tenantId: tenant.id,
          telegramId: tenant.ownerTelegramId,
        },
      },
      create: {
        tenantId: tenant.id,
        telegramId: tenant.ownerTelegramId,
        role: "admin",
      },
      update: { role: "admin" },
    });
  }

  return tenant;
}

export async function updateTenant(
  id: string,
  patch: {
    name?: string;
    brandName?: string;
    logoUrl?: string | null;
    welcomeText?: string | null;
    supportUsername?: string | null;
    botToken?: string;
    status?: TenantStatus;
    ownerTelegramId?: bigint | number | null;
  },
) {
  const data: Record<string, unknown> = {};
  if (patch.name != null) data.name = patch.name.trim().slice(0, 80);
  if (patch.brandName != null) data.brandName = patch.brandName.trim().slice(0, 80);
  if (patch.logoUrl !== undefined) data.logoUrl = patch.logoUrl;
  if (patch.welcomeText !== undefined) data.welcomeText = patch.welcomeText?.trim() || null;
  if (patch.supportUsername !== undefined) {
    data.supportUsername = patch.supportUsername?.trim() || null;
  }
  if (patch.status != null) data.status = patch.status;
  if (patch.ownerTelegramId !== undefined) {
    data.ownerTelegramId =
      patch.ownerTelegramId == null ? null : BigInt(patch.ownerTelegramId);
  }
  if (patch.botToken?.trim()) {
    const token = patch.botToken.trim();
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!me.ok) throw new Error(me.description || "توکن ربات نامعتبر است");
    data.botToken = encryptBotToken(token);
    data.botUsername = me.result?.username ?? null;
  }
  const tenant = await prisma.tenant.update({ where: { id }, data });

  if (patch.brandName != null) {
    await runWithTenantAsync({ tenantId: tenant.id, slug: tenant.slug }, async () => {
      const { setSetting } = await import("./settings.js");
      await setSetting("brand_name", tenant.brandName);
    });
  }

  if (patch.ownerTelegramId != null) {
    const tid = BigInt(patch.ownerTelegramId);
    await prisma.user.upsert({
      where: { tenantId_telegramId: { tenantId: tenant.id, telegramId: tid } },
      create: { tenantId: tenant.id, telegramId: tid, role: "admin" },
      update: { role: "admin" },
    });
  }

  return tenant;
}

export async function suspendTenant(id: string) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id } });
  if (t.isPlatform) throw new Error("tenant پلتفرم را نمی‌توان تعلیق کرد");
  return prisma.tenant.update({
    where: { id },
    data: { status: TenantStatus.suspended },
  });
}

export async function activateTenant(id: string) {
  return prisma.tenant.update({
    where: { id },
    data: { status: TenantStatus.active },
  });
}

/** Public dash URL for a tenant slug */
export function tenantDashUrl(slug: string, baseUrl?: string): string {
  const base = (baseUrl ?? dashBaseUrl()).replace(/\/$/, "");
  // Platform tenant is served on the main dash host — no platform.dash.* subdomain.
  if (slug === PLATFORM_TENANT_SLUG) return base;
  try {
    const u = new URL(base);
    if (u.hostname.includes(".")) {
      const host = `${slug}.${u.hostname}`;
      return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}`;
    }
  } catch {
    /* fall through */
  }
  return `${base}/?tenant=${encodeURIComponent(slug)}`;
}
