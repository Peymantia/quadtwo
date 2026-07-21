/**
 * Sync control-admin Telegram IDs in the database.
 * Usage (from repo root or apps/server):
 *   npx tsx apps/server/scripts/set-admin.ts 123456789
 *   npx tsx apps/server/scripts/set-admin.ts 111,222
 *
 * - Promotes listed users to admin (if they already exist)
 * - Demotes other DB admins to user
 * - Clears settings.extra_admin_ids
 * Does NOT edit .env — the shell helper `quadtwo set-admin` updates ADMIN_TELEGRAM_IDS.
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, UserRole } from "@prisma/client";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });

function parseIds(argv: string[]): bigint[] {
  const raw = argv.join(",").split(/[,\s]+/).map((s) => s.replace(/^@/, "").trim()).filter(Boolean);
  if (!raw.length) {
    console.error("Usage: set-admin <telegram_id>[,id2,...]");
    process.exit(1);
  }
  for (const id of raw) {
    if (!/^\d{5,20}$/.test(id)) {
      console.error(`Invalid Telegram ID: ${id} (numeric ID only, not @username)`);
      process.exit(1);
    }
  }
  return raw.map((id) => BigInt(id));
}

async function main() {
  const ids = parseIds(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const before = await prisma.user.findMany({
      where: { role: UserRole.admin },
      select: { telegramId: true, username: true },
    });

    await prisma.setting.upsert({
      where: { key: "extra_admin_ids" },
      create: { key: "extra_admin_ids", value: "" },
      update: { value: "" },
    });

    const demoted = await prisma.user.updateMany({
      where: {
        role: UserRole.admin,
        telegramId: { notIn: ids },
      },
      data: { role: UserRole.user },
    });

    const promoted = await prisma.user.updateMany({
      where: { telegramId: { in: ids } },
      data: { role: UserRole.admin },
    });

    const after = await prisma.user.findMany({
      where: { role: UserRole.admin },
      select: { telegramId: true, username: true },
    });

    console.log(`Cleared extra_admin_ids`);
    console.log(`Demoted ${demoted.count} previous admin(s) → user`);
    console.log(`Promoted ${promoted.count} matching user(s) → admin`);
    console.log(
      `Previous DB admins: ${
        before.length ? before.map((u) => `${u.telegramId}${u.username ? ` (@${u.username})` : ""}`).join(", ") : "(none)"
      }`,
    );
    console.log(
      `Current DB admins: ${
        after.length ? after.map((u) => `${u.telegramId}${u.username ? ` (@${u.username})` : ""}`).join(", ") : "(none yet — open the bot and /start)"
      }`,
    );
    console.log(`Env admin IDs to keep: ${ids.map(String).join(",")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
