import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("file:./prisma/dev.db"),
  BOT_TOKEN: z.string().min(1),
  BOT_MODE: z.enum(["webhook", "polling"]).default("polling"),
  TELEGRAM_WEBHOOK_PATH: z.string().default("/telegram/webhook"),
  ADMIN_TELEGRAM_IDS: z.string().default(""),
  XUI_BASE_URL: z.string().optional(),
  XUI_API_TOKEN: z.string().optional(),
  XUI_INBOUND_ID: z.coerce.number().default(1),
  XUI_SUB_BASE: z.string().optional(),
  PUBLIC_DOMAIN: z.string().optional(),
});

export const env = schema.parse(process.env);

export function adminIds(): bigint[] {
  if (!env.ADMIN_TELEGRAM_IDS.trim()) return [];
  return env.ADMIN_TELEGRAM_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => BigInt(s));
}

export function isAdminTelegramId(id: number | bigint | undefined): boolean {
  if (id === undefined) return false;
  const n = BigInt(id);
  return adminIds().includes(n);
}
