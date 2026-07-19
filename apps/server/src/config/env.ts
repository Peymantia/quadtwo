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
  XUI_INBOUND_IDS: z.string().default("1,2,3,4,5,6,7,8,9,10"),
  XUI_SUB_BASE: z.string().optional(),
  PUBLIC_DOMAIN: z.string().optional(),
  /** Web dashboard origin, e.g. https://dash.anthropics.ir */
  DASH_DOMAIN: z.string().optional(),
  /** Comma-separated CORS origins; defaults to DASH_DOMAIN + PUBLIC_DOMAIN */
  CORS_ORIGINS: z.string().optional(),
});

export const env = schema.parse(process.env);

export function dashBaseUrl(): string {
  const d = env.DASH_DOMAIN?.trim() || env.PUBLIC_DOMAIN?.trim();
  if (!d) return "http://127.0.0.1:3000";
  return d.startsWith("http") ? d.replace(/\/$/, "") : `https://${d.replace(/\/$/, "")}`;
}

export function corsOrigins(): string[] {
  if (env.CORS_ORIGINS?.trim()) {
    return env.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const list = [env.DASH_DOMAIN, env.PUBLIC_DOMAIN]
    .filter(Boolean)
    .map((d) => (d!.startsWith("http") ? d!.replace(/\/$/, "") : `https://${d!.replace(/\/$/, "")}`));
  if (env.NODE_ENV !== "production") {
    list.push("http://127.0.0.1:3000", "http://localhost:3000");
  }
  return [...new Set(list)];
}

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
