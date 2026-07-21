import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { prisma } from "../db.js";
import { dashBaseUrl } from "../config/env.js";
import { auditLog } from "./audit.js";

type ChallengeKind = "reg" | "auth";

const challenges = new Map<string, { challenge: string; kind: ChallengeKind; expiresAt: number }>();

function challengeKey(kind: ChallengeKind, id: string) {
  return `${kind}:${id}`;
}

function putChallenge(kind: ChallengeKind, id: string, challenge: string) {
  challenges.set(challengeKey(kind, id), {
    challenge,
    kind,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
}

function takeChallenge(kind: ChallengeKind, id: string): string | null {
  const key = challengeKey(kind, id);
  const row = challenges.get(key);
  challenges.delete(key);
  if (!row || row.expiresAt < Date.now()) return null;
  return row.challenge;
}

function rpFromDash() {
  const origin = dashBaseUrl();
  let hostname = "localhost";
  try {
    hostname = new URL(origin).hostname;
  } catch {
    /* keep localhost */
  }
  // WebAuthn rpID must not include port; localhost is fine for local HTTPS/HTTP in some browsers
  return { rpID: hostname, origin, rpName: "Piing Dashboard" };
}

function parseTransports(raw: string | null | undefined): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return undefined;
    return arr.filter((t): t is AuthenticatorTransportFuture => typeof t === "string") as AuthenticatorTransportFuture[];
  } catch {
    return undefined;
  }
}

export async function userPasskeyCount(userId: string) {
  return prisma.webAuthnCredential.count({ where: { userId } });
}

export async function listUserPasskeys(userId: string) {
  const rows = await prisma.webAuthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label || "Passkey",
    deviceType: r.deviceType,
    backedUp: r.backedUp,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function deleteUserPasskey(userId: string, credentialRowId: string) {
  const row = await prisma.webAuthnCredential.findFirst({
    where: { id: credentialRowId, userId },
  });
  if (!row) throw new Error("Passkey پیدا نشد");
  await prisma.webAuthnCredential.delete({ where: { id: row.id } });
}

export async function beginPasskeyRegistration(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { rpID, rpName } = rpFromDash();
  const existing = await prisma.webAuthnCredential.findMany({ where: { userId } });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.username ? `@${user.username}` : String(user.telegramId),
    userDisplayName: user.firstName || user.username || String(user.telegramId),
    userID: isoBase64URL.toBuffer(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
  });

  putChallenge("reg", userId, options.challenge);
  return options;
}

export async function finishPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  label?: string,
) {
  const expectedChallenge = takeChallenge("reg", userId);
  if (!expectedChallenge) throw new Error("چالش منقضی شده؛ دوباره تلاش کنید");

  const { rpID, origin } = rpFromDash();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("ثبت Passkey ناموفق بود");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const credentialId = credential.id;
  const publicKey = isoBase64URL.fromBuffer(credential.publicKey);

  await prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId,
      publicKey,
      counter: BigInt(credential.counter ?? 0),
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      label: label?.trim().slice(0, 60) || "Face ID / اثرانگشت",
    },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  await auditLog({
    action: "web_passkey_register",
    actorTelegramId: user?.telegramId,
    target: userId,
  });

  return { ok: true as const };
}

/** Discoverable / usernameless authentication options. */
export async function beginPasskeyAuthentication(loginHint?: string) {
  const { rpID } = rpFromDash();
  let allowCredentials:
    | Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>
    | undefined;

  let challengeOwner = `anon:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (loginHint?.trim()) {
    const raw = loginHint.trim().replace(/^@/, "");
    const user = /^\d+$/.test(raw)
      ? await prisma.user.findUnique({ where: { telegramId: BigInt(raw) } })
      : await prisma.user.findFirst({
          where: { username: { equals: raw } },
        });
    if (user) {
      challengeOwner = user.id;
      const creds = await prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
      if (!creds.length) throw new Error("برای این حساب هنوز Passkey ثبت نشده است");
      allowCredentials = creds.map((c) => ({
        id: c.credentialId,
        transports: parseTransports(c.transports),
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials,
  });

  putChallenge("auth", challengeOwner, options.challenge);
  // Return challengeOwner so client can send it back (needed for anonymous flow)
  return { options, challengeId: challengeOwner };
}

export async function finishPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  challengeId?: string,
): Promise<{ userId: string }> {
  const credentialId = response.id;
  const cred = await prisma.webAuthnCredential.findUnique({
    where: { credentialId },
    include: { user: true },
  });
  if (!cred) throw new Error("این Passkey در سیستم ثبت نیست");

  const ownerKey = challengeId?.trim() || cred.userId;
  let expectedChallenge = takeChallenge("auth", ownerKey);
  if (!expectedChallenge && ownerKey !== cred.userId) {
    expectedChallenge = takeChallenge("auth", cred.userId);
  }
  if (!expectedChallenge) throw new Error("چالش منقضی شده؛ دوباره تلاش کنید");

  const { rpID, origin } = rpFromDash();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: cred.credentialId,
      publicKey: isoBase64URL.toBuffer(cred.publicKey),
      counter: Number(cred.counter),
      transports: parseTransports(cred.transports),
    },
  });

  if (!verification.verified) throw new Error("تأیید بیومتریک ناموفق بود");

  const newCounter = verification.authenticationInfo.newCounter;
  await prisma.webAuthnCredential.update({
    where: { id: cred.id },
    data: {
      counter: BigInt(newCounter),
      lastUsedAt: new Date(),
    },
  });

  await auditLog({
    action: "web_login_passkey",
    actorTelegramId: cred.user.telegramId,
    target: cred.userId,
  });

  return { userId: cred.userId };
}

export function webAuthnSupportedHint() {
  return "برای Face ID / اثرانگشت به HTTPS و مرورگر سازگار نیاز است.";
}
