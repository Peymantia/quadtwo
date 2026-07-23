import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Shared HMAC secret embedded in shipped builds (not DRM — raises the bar for casual forks).
 * Override when issuing keys: QUADTWO_LICENSE_SECRET
 */
const EMBEDDED_VERIFY_SECRET = "q2-lic-v1-piing-sanaei-2026-bind";

export type LicensePayload = {
  v: 1;
  admins: string;
  host: string;
  iat: number;
};

export type LicenseStatus = {
  demo: boolean;
  enforced: boolean;
  ok: boolean;
  reason?: string;
  keyPresent: boolean;
  adminIds: bigint[];
  dashHost: string | null;
};

function verifySecret(): string {
  return (process.env.QUADTWO_LICENSE_SECRET || EMBEDDED_VERIFY_SECRET).trim();
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function signPayload(payloadJson: string): string {
  return createHmac("sha256", verifySecret()).update(payloadJson).digest("base64url");
}

export function isDemoMode(): boolean {
  const v = (env.DEMO_MODE || "").toString().trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function issueLicenseKey(admins: string, host: string): string {
  const cleanAdmins = admins
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .join(",");
  if (!cleanAdmins) throw new Error("At least one numeric Telegram admin ID is required");
  const cleanHost = normalizeHost(host);
  if (!cleanHost) throw new Error("Dashboard host is required (e.g. dash.example.com)");
  const payload: LicensePayload = { v: 1, admins: cleanAdmins, host: cleanHost, iat: Math.floor(Date.now() / 1000) };
  const json = JSON.stringify(payload);
  return `Q2.1.${b64url(json)}.${signPayload(json)}`;
}

export function parseLicenseKey(key: string): { ok: true; payload: LicensePayload } | { ok: false; reason: string } {
  const raw = key.trim();
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "Q2" || parts[1] !== "1") {
    return { ok: false, reason: "Invalid license key format (expected Q2.1.…)" };
  }
  let json: string;
  try {
    json = fromB64url(parts[2]!).toString("utf8");
  } catch {
    return { ok: false, reason: "Corrupt license payload" };
  }
  const expected = signPayload(json);
  const given = parts[3]!;
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "License signature mismatch" };
    }
  } catch {
    return { ok: false, reason: "License signature mismatch" };
  }
  try {
    const payload = JSON.parse(json) as LicensePayload;
    if (payload.v !== 1 || !payload.admins || !payload.host) {
      return { ok: false, reason: "Invalid license payload" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "Invalid license JSON" };
  }
}

export function normalizeHost(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "");
  h = h.split("/")[0] || "";
  h = h.split(":")[0] || "";
  return h;
}

function parseIdList(raw: string): bigint[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => BigInt(s));
}

/** Effective licensed admin IDs: LICENSE_ADMIN_IDS, else decoded from LICENSE_KEY, else empty. */
export function licensedAdminIds(): bigint[] {
  const fromEnv = (env.LICENSE_ADMIN_IDS || "").trim();
  if (fromEnv) return parseIdList(fromEnv);
  const key = (env.LICENSE_KEY || "").trim();
  if (!key) return [];
  const parsed = parseLicenseKey(key);
  if (!parsed.ok) return [];
  return parseIdList(parsed.payload.admins);
}

export function licensedDashHost(): string | null {
  const fromEnv = (env.LICENSE_DASH_HOST || "").trim();
  if (fromEnv) return normalizeHost(fromEnv);
  const key = (env.LICENSE_KEY || "").trim();
  if (!key) return null;
  const parsed = parseLicenseKey(key);
  if (!parsed.ok) return null;
  return normalizeHost(parsed.payload.host);
}

export function isLicensedAdminTelegramId(id: number | bigint | undefined): boolean {
  if (id === undefined) return false;
  const ids = licensedAdminIds();
  if (!ids.length) return false;
  return ids.includes(BigInt(id));
}

/**
 * License enforced when LICENSE_KEY is set (must validate) or LICENSE_REQUIRE=1.
 * Existing seller installs without a key keep running; buyers get REQUIRE via q2 activate.
 */
export function getLicenseStatus(): LicenseStatus {
  if (isDemoMode()) {
    return {
      demo: true,
      enforced: false,
      ok: true,
      keyPresent: Boolean((env.LICENSE_KEY || "").trim()),
      adminIds: licensedAdminIds(),
      dashHost: licensedDashHost(),
      reason: "DEMO_MODE — license checks skipped",
    };
  }

  const key = (env.LICENSE_KEY || "").trim();
  const requireLic =
    (env.LICENSE_REQUIRE || "").toString().trim().toLowerCase() === "1" ||
    (env.LICENSE_REQUIRE || "").toString().trim().toLowerCase() === "true";

  if (!key) {
    if (requireLic) {
      return {
        demo: false,
        enforced: true,
        ok: false,
        keyPresent: false,
        adminIds: [],
        dashHost: null,
        reason: "LICENSE_KEY missing — run: q2 activate",
      };
    }
    return {
      demo: false,
      enforced: false,
      ok: true,
      keyPresent: false,
      adminIds: [],
      dashHost: null,
      reason: env.NODE_ENV === "production" ? "No LICENSE_KEY (unbound install)" : "No license (development)",
    };
  }

  const parsed = parseLicenseKey(key);
  if (!parsed.ok) {
    return {
      demo: false,
      enforced: true,
      ok: false,
      keyPresent: true,
      adminIds: [],
      dashHost: null,
      reason: parsed.reason,
    };
  }

  const adminIds = licensedAdminIds();
  const dashHost = licensedDashHost();
  if (!adminIds.length) {
    return {
      demo: false,
      enforced: true,
      ok: false,
      keyPresent: true,
      adminIds: [],
      dashHost,
      reason: "License has no admin Telegram IDs",
    };
  }
  if (!dashHost) {
    return {
      demo: false,
      enforced: true,
      ok: false,
      keyPresent: true,
      adminIds,
      dashHost: null,
      reason: "License has no dashboard host",
    };
  }

  return {
    demo: false,
    enforced: true,
    ok: true,
    keyPresent: true,
    adminIds,
    dashHost,
  };
}

export function assertLicenseAtStartup(): void {
  const st = getLicenseStatus();
  if (st.demo) {
    console.log("[license] DEMO_MODE enabled — role switcher active, license skipped");
    return;
  }
  if (!st.ok && st.enforced) {
    console.error(`[license] FAILED: ${st.reason}`);
    console.error("[license] Activate with: q2 activate");
    process.exit(1);
  }
  if (st.ok && st.keyPresent) {
    console.log(
      `[license] OK — admins=${st.adminIds.map(String).join(",")} host=${st.dashHost}`,
    );
  } else if (!st.keyPresent) {
    console.log("[license] development mode (no LICENSE_KEY)");
  }
}

/** Returns false if request Host must be rejected. */
export function verifyRequestHost(hostHeader: string | undefined): boolean {
  const st = getLicenseStatus();
  if (!st.enforced || !st.ok || !st.dashHost) return true;
  const host = normalizeHost(hostHeader || "");
  if (!host) return false;
  if (host === st.dashHost) return true;
  if (host === `www.${st.dashHost}`) return true;
  // local health / direct IP access for ops
  if (host === "127.0.0.1" || host === "localhost") return true;
  return false;
}
