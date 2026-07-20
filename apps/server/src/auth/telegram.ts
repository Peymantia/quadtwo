import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";

const jwtSecret = () => new TextEncoder().encode(env.BOT_TOKEN + ":quadtwo-jwt");

export type TgInitUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export function parseAndValidateInitData(initData: string): TgInitUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Missing hash");

  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(env.BOT_TOKEN).digest();
  const calculated = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");
  const valid =
    a.length === b.length &&
    timingSafeEqual(a, b);

  if (!valid) {
    if (env.NODE_ENV !== "production" && (hash === "dev" || process.env.ALLOW_DEV_AUTH === "1")) {
      const userRaw = params.get("user");
      if (userRaw) return JSON.parse(userRaw) as TgInitUser;
    }
    throw new Error("Invalid initData");
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (authDate && Date.now() / 1000 - authDate > 86400) {
    throw new Error("initData expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Missing user");
  return JSON.parse(userRaw) as TgInitUser;
}

export async function signSession(
  payload: { userId: string; telegramId: string; role: string },
  expiresIn = "7d",
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(jwtSecret());
}

export async function verifySession(token: string) {
  const { payload } = await jwtVerify(token, jwtSecret());
  return payload as { userId: string; telegramId: string; role: string };
}
