/**
 * One-shot SQLite migration: single-tenant → multi-tenant without wiping rows.
 * Run: npx tsx src/scripts/migrate-to-tenants.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../../.env") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });

function cuidLike() {
  return "c" + randomBytes(12).toString("hex");
}

function encryptBotToken(plain: string): string {
  // Store plain for migration bootstrap; runtime encrypt on next update
  return plain;
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  // Detect if Tenant already exists
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM Tenant LIMIT 1`);
    console.log("Tenant table already present — checking backfill…");
  } catch {
    console.log("Creating Tenant table…");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Tenant" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "slug" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "botToken" TEXT NOT NULL,
        "botUsername" TEXT,
        "brandName" TEXT NOT NULL DEFAULT '',
        "logoUrl" TEXT,
        "welcomeText" TEXT,
        "supportUsername" TEXT,
        "ownerTelegramId" BIGINT,
        "isPlatform" BOOLEAN NOT NULL DEFAULT false,
        "status" TEXT NOT NULL DEFAULT 'active',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug")`,
    );
  }

  let platformId: string | null = null;
  const existing = (await prisma.$queryRawUnsafe(
    `SELECT id FROM Tenant WHERE isPlatform = 1 OR slug = 'platform' LIMIT 1`,
  )) as Array<{ id: string }>;
  if (existing[0]?.id) {
    platformId = existing[0].id;
  } else {
    platformId = cuidLike();
    const token = process.env.BOT_TOKEN || "pending";
    await prisma.$executeRawUnsafe(
      `INSERT INTO Tenant (id, slug, name, botToken, brandName, isPlatform, status, createdAt, updatedAt)
       VALUES (?, 'platform', 'Platform', ?, 'پیـنگ', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      platformId,
      encryptBotToken(token),
    );
    console.log("inserted platform tenant", platformId);
  }

  const tablesNeedTenant = [
    "User",
    "Plan",
    "PriceCell",
    "PanelServer",
    "Order",
    "Subscription",
    "PartnerRequest",
    "AgentRenameRequest",
    "DiscountCode",
    "AccountArchive",
    "BuyDraft",
    "AuditLog",
  ];

  for (const table of tablesNeedTenant) {
    const cols = (await prisma.$queryRawUnsafe(
      `PRAGMA table_info("${table}")`,
    )) as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "tenantId")) {
      console.log(`ADD tenantId to ${table}`);
      // SQLite: add as nullable first
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "tenantId" TEXT`,
      );
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "tenantId" = ? WHERE "tenantId" IS NULL`,
      platformId,
    );
  }

  // User: drop old unique on telegramId if needed — prisma push will recreate indexes
  // Setting rebuild
  const settingCols = (await prisma.$queryRawUnsafe(
    `PRAGMA table_info("Setting")`,
  )) as Array<{ name: string }>;
  const hasTenantOnSetting = settingCols.some((c) => c.name === "tenantId");
  const hasIdOnSetting = settingCols.some((c) => c.name === "id");

  if (!hasTenantOnSetting || !hasIdOnSetting) {
    console.log("Rebuilding Setting table…");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Setting_new" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT key, value, updatedAt FROM Setting`,
    )) as Array<{ key: string; value: string; updatedAt: string }>;
    for (const r of rows) {
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO Setting_new (id, tenantId, key, value, updatedAt) VALUES (?, ?, ?, ?, ?)`,
        cuidLike(),
        platformId,
        r.key,
        r.value,
        r.updatedAt || new Date().toISOString(),
      );
    }
    await prisma.$executeRawUnsafe(`DROP TABLE Setting`);
    await prisma.$executeRawUnsafe(`ALTER TABLE Setting_new RENAME TO Setting`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Setting_tenantId_key_key" ON "Setting"("tenantId", "key")`,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE Setting SET tenantId = ? WHERE tenantId IS NULL OR tenantId = ''`,
      platformId,
    );
  }

  // AgentPriceOverride table
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM AgentPriceOverride LIMIT 1`);
  } catch {
    console.log("Creating AgentPriceOverride…");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "AgentPriceOverride" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "userId" TEXT NOT NULL UNIQUE,
        "category" TEXT NOT NULL DEFAULT '',
        "perGb" INTEGER,
        "perMonth" INTEGER,
        "unlimitedPerMonth" INTEGER,
        "partnerPricePercent" INTEGER NOT NULL DEFAULT 100,
        "note" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // User.isSuperAdmin
  const userCols = (await prisma.$queryRawUnsafe(
    `PRAGMA table_info("User")`,
  )) as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === "isSuperAdmin")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false`,
    );
  }

  console.log("raw migration done. Now run: npx prisma db push");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
