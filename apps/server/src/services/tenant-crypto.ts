import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

function secretKey(): Buffer {
  const raw =
    process.env.TENANT_TOKEN_SECRET?.trim() ||
    env.BOT_TOKEN ||
    "quadtwo-dev-tenant-secret";
  return createHash("sha256").update(raw).digest();
}

/** Encrypt bot token at rest (aes-256-gcm). Prefix `enc:` */
export function encryptBotToken(plain: string): string {
  const text = plain.trim();
  if (!text) return text;
  if (text.startsWith("enc:")) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptBotToken(stored: string): string {
  const text = stored.trim();
  if (!text.startsWith("enc:")) return text;
  const body = text.slice(4);
  const [ivB64, tagB64, dataB64] = body.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("invalid encrypted bot token");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function normalizeTenantSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (s.length < 2) throw new Error("slug باید حداقل ۲ کاراکتر باشد");
  if (s === "www" || s === "api" || s === "admin" || s === "super") {
    throw new Error("این slug رزرو شده است");
  }
  return s;
}
