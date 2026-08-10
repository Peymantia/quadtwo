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
import { corsOrigins, dashBaseUrl } from "../config/env.js";
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

function isLoopbackHttp(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function hostnameOf(originOrUrl: string): string | null {
  try {
    return new URL(originOrUrl).hostname;
  } catch {
    return null;
  }
}

/** Accept browser Origin when it matches configured dash / public / CORS hosts (incl. tenant subdomains). */
function isAllowedWebAuthnOrigin(origin: string): boolean {
  if (!origin) return false;
  if (!/^https:\/\//i.test(origin) && !isLoopbackHttp(origin)) return false;
  const allowed = corsOrigins();
  if (allowed.includes(origin)) return true;
  const host = hostnameOf(origin);
  if (!host) return false;
  const seeds = [dashBaseUrl(), ...allowed]
    .map((o) => hostnameOf(o))
    .filter((h): h is string => !!h);
  for (const seed of seeds) {
    if (host === seed || host.endsWith(`.${seed}`)) return true;
  }
  return false;
}

/**
 * WebAuthn RP must match the page the user is actually on.
 * Prefer request Origin (HTTPS dash / mini-app host); fall back to DASH_DOMAIN.
 */
export function resolveWebAuthnRp(requestOrigin?: string | null) {
  const fallback = dashBaseUrl();
  const raw = (requestOrigin ?? "").trim().replace(/\/$/, "");
  const origin = raw && isAllowedWebAuthnOrigin(raw) ? raw : fallback;
  const hostname = hostnameOf(origin) || hostnameOf(fallback) || "localhost";

  const expectedOrigins = [
    ...new Set(
      [origin, fallback, ...corsOrigins()].filter((o) => {
        const h = hostnameOf(o);
        return (
          h === hostname ||
          (h != null && (hostname.endsWith(`.${h}`) || h.endsWith(`.${hostname}`)))
        );
      }),
    ),
  ];

  return {
    rpID: hostname,
    origin,
    expectedOrigins: expectedOrigins.length ? expectedOrigins : [origin],
    rpName: "داشبورد پیـنگ",
  };
}

export function originFromRequestHeaders(headers: {
  origin?: string | null;
  referer?: string | null;
}): string | null {
  const o = headers.origin?.trim();
  if (o) return o.replace(/\/$/, "");
  const ref = headers.referer?.trim();
  if (!ref) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
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

export async function beginPasskeyRegistration(userId: string, requestOrigin?: string | null) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { rpID, rpName } = resolveWebAuthnRp(requestOrigin);
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
  requestOrigin?: string | null,
) {
  const expectedChallenge = takeChallenge("reg", userId);
  if (!expectedChallenge) throw new Error("چالش منقضی شده؛ دوباره تلاش کنید");

  const { rpID, expectedOrigins } = resolveWebAuthnRp(requestOrigin);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins,
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
export async function beginPasskeyAuthentication(
  loginHint?: string,
  requestOrigin?: string | null,
) {
  const { rpID } = resolveWebAuthnRp(requestOrigin);
  let allowCredentials:
    | Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>
    | undefined;

  let challengeOwner = `anon:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (loginHint?.trim()) {
    const raw = loginHint.trim().replace(/^@/, "");
    const { resolveTenantIdOrPlatform } = await import("./tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const user = /^\d+$/.test(raw)
      ? await prisma.user.findUnique({
          where: { tenantId_telegramId: { tenantId, telegramId: BigInt(raw) } },
        })
      : await prisma.user.findFirst({
          where: { tenantId, username: { equals: raw } },
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
  return { options, challengeId: challengeOwner };
}

export async function finishPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  challengeId?: string,
  requestOrigin?: string | null,
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

  const { rpID, expectedOrigins } = resolveWebAuthnRp(requestOrigin);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins,
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
