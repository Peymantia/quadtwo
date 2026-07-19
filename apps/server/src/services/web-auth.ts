import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../config/env.js";
import { checkRateLimit } from "./rate-limit.js";
import { auditLog } from "./audit.js";

const SCRYPT_N = 16384;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(code: string): string {
  return createHash("sha256").update(`quadtwo-otp:${code}`).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const calc = scryptSync(password, salt!, 64, { N: SCRYPT_N });
  const a = Buffer.from(hash!, "hex");
  if (a.length !== calc.length) return false;
  return timingSafeEqual(a, calc);
}

export async function findUserByLogin(login: string) {
  const q = login.trim().replace(/^@/, "");
  if (!q) return null;
  if (/^\d+$/.test(q)) {
    return prisma.user.findUnique({ where: { telegramId: BigInt(q) } });
  }
  return prisma.user.findFirst({
    where: { username: { equals: q } },
  });
}

export async function setUserPassword(userId: string, password: string) {
  if (password.length < 8) throw new Error("رمز باید حداقل ۸ کاراکتر باشد");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(password), passwordSetAt: new Date() },
  });
}

async function sendTelegramText(chatId: bigint, text: string) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ارسال پیام تلگرام ناموفق: ${body.slice(0, 120)}`);
  }
}

/** Create OTP and deliver via Telegram. Returns masked destination. */
export async function requestLoginOtp(login: string): Promise<{ ok: true; hint: string } | { ok: false; error: string }> {
  const rl = checkRateLimit(`otp-req:${login.toLowerCase()}`, { max: 5, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) return { ok: false, error: `لطفاً ${rl.retryAfterSec} ثانیه صبر کنید` };

  const user = await findUserByLogin(login);
  if (!user) {
    // Do not leak existence — still pretend success timing
    return { ok: true, hint: "اگر حساب وجود داشته باشد، کد به تلگرام ارسال شد" };
  }

  const code = String(randomInt(100000, 999999));
  await prisma.loginOtp.create({
    data: {
      userId: user.id,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  const dash = env.DASH_DOMAIN?.trim() || "dash.anthropics.ir";
  try {
    await sendTelegramText(
      user.telegramId,
      [
        "🔐 *کد ورود داشبورد Piing*",
        "",
        `\`${code}\``,
        "",
        "اعتبار: ۵ دقیقه",
        `ورود: https://${dash.replace(/^https?:\/\//, "")}`,
      ].join("\n"),
    );
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }

  await auditLog({
    action: "web_otp_sent",
    actorTelegramId: user.telegramId,
    target: user.id,
  });

  const uname = user.username ? `@${user.username}` : `id ${user.telegramId}`;
  return { ok: true, hint: `کد به تلگرام ${uname} ارسال شد` };
}

/** Issue OTP for the currently authenticated Telegram user (from bot button). */
export async function issueOtpForUser(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const code = String(randomInt(100000, 999999));
  await prisma.loginOtp.create({
    data: {
      userId: user.id,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  return code;
}

export async function verifyLoginOtp(
  login: string,
  code: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const rl = checkRateLimit(`otp-ver:${login.toLowerCase()}`, { max: 20, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) return { ok: false, error: `لطفاً ${rl.retryAfterSec} ثانیه صبر کنید` };

  const user = await findUserByLogin(login);
  if (!user) return { ok: false, error: "کد یا شناسه نامعتبر است" };

  const otp = await prisma.loginOtp.findFirst({
    where: {
      userId: user.id,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { ok: false, error: "کد منقضی شده یا یافت نشد" };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "تعداد تلاش بیش از حد — کد جدید بگیرید" };
  }

  const match =
    otp.codeHash.length === hashOtp(code.trim()).length &&
    timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(hashOtp(code.trim())));
  await prisma.loginOtp.update({
    where: { id: otp.id },
    data: { attempts: { increment: 1 }, ...(match ? { consumedAt: new Date() } : {}) },
  });

  if (!match) return { ok: false, error: "کد نادرست است" };

  await auditLog({
    action: "web_login_otp",
    actorTelegramId: user.telegramId,
    target: user.id,
  });
  return { ok: true, userId: user.id };
}

export async function loginWithPassword(
  login: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const rl = checkRateLimit(`pwd:${login.toLowerCase()}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) return { ok: false, error: `لطفاً ${rl.retryAfterSec} ثانیه صبر کنید` };

  const user = await findUserByLogin(login);
  if (!user?.passwordHash) return { ok: false, error: "نام کاربری یا رمز نادرست است" };
  if (!verifyPassword(password, user.passwordHash)) {
    await auditLog({
      action: "web_login_fail",
      actorTelegramId: user.telegramId,
      detail: "bad_password",
    });
    return { ok: false, error: "نام کاربری یا رمز نادرست است" };
  }

  await auditLog({
    action: "web_login_password",
    actorTelegramId: user.telegramId,
    target: user.id,
  });
  return { ok: true, userId: user.id };
}
