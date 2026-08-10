/**
 * A usable sub base must be http(s) and include a path (/info/, /sub/, …).
 * Bare domains like `app.piing.ir` are Mini App hosts — NOT subscription bases.
 */

const RESERVED_SUB_ROOTS = new Set(["sub", "info", "json", "clash"]);

/** Client subId tokens from 3x-ui / our randomSubId (hex) / short alphanumeric. */
const SUB_ID_SEGMENT_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function isValidSubBase(base: string | null | undefined): boolean {
  const raw = (base ?? "").trim();
  if (!raw) return false;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    if (!u.hostname) return false;
    const path = u.pathname.replace(/\/+$/, "");
    return path.length > 0;
  } catch {
    return false;
  }
}

/**
 * If someone pasted a full subscription URL as the base
 * (e.g. https://host:port/info/oldSubId or https://host:port/randPath/oldSubId),
 * strip the trailing client id so appendSubId does not create
 * /info/oldId/newId → 404 on 3x-ui.
 *
 * Keeps single-segment custom subPaths like /zdugcvix5jzv9k3v/ intact.
 */
export function stripTrailingClientSubId(base: string): string {
  try {
    const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
    const u = new URL(withScheme);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return base;

    const last = parts[parts.length - 1]!;
    const prev = parts[parts.length - 2]!;
    const lastIsSubId =
      SUB_ID_SEGMENT_RE.test(last) && !RESERVED_SUB_ROOTS.has(last.toLowerCase());
    if (!lastIsSubId) return base;

    // /sub/ABC or /info/ABC or /customPath/ABC → drop ABC
    if (RESERVED_SUB_ROOTS.has(prev.toLowerCase()) || SUB_ID_SEGMENT_RE.test(prev)) {
      parts.pop();
      u.pathname = `/${parts.join("/")}/`;
      return u.toString();
    }
    return base;
  } catch {
    return base;
  }
}

export function normalizeSubBase(base: string): string {
  const stripped = stripTrailingClientSubId(base.trim());
  const withScheme = /^https?:\/\//i.test(stripped) ? stripped : `https://${stripped}`;
  return withScheme.replace(/\/+$/, "") + "/";
}

export function appendSubId(base: string, subId: string) {
  const id = subId.trim().replace(/^\/+|\/+$/g, "");
  if (!id) return base.trim().replace(/\/+$/, "") + "/";
  const trimmed = normalizeSubBase(base).replace(/\/+$/, "");
  if (!trimmed) return id;
  // Avoid /base/id/id when base already ends with this subId
  if (trimmed.endsWith(`/${id}`)) return trimmed;
  return `${trimmed}/${id}`;
}

/** Prefer a real sub base; drop Mini App / bare-host junk; strip pasted client ids. */
export function sanitizeSubBase(base: string | null | undefined): string | null {
  if (!isValidSubBase(base)) return null;
  return normalizeSubBase(base!);
}

function isLoopbackSubHost(base: string): boolean {
  try {
    const h = new URL(base).hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

function panelSubTls(settings?: Record<string, unknown>) {
  const cert = settings?.subCertFile;
  const key = settings?.subKeyFile;
  if (typeof cert === "string" && cert.trim() && typeof key === "string" && key.trim()) return true;
  if (settings?.subTLS === true) return true;
  return false;
}

function hostnameFromPanelUrl(panelBaseUrl?: string | null, envPanelBaseUrl?: string | null): string {
  for (const c of [panelBaseUrl, envPanelBaseUrl]) {
    if (!c?.trim()) continue;
    try {
      const host = new URL(c).hostname;
      if (host && host !== "127.0.0.1" && host !== "localhost") return host;
      if (host) return host;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** Rebuild like 3x-ui BuildSubURIBase + subPath. */
export function reconstructSubBase(
  settings?: Record<string, unknown>,
  panelBaseUrl?: string | null,
  envPanelBaseUrl?: string | null,
): string | null {
  const subPathRaw =
    typeof settings?.subPath === "string" && settings.subPath.trim()
      ? settings.subPath.trim()
      : "/sub/";
  const subPath = subPathRaw.startsWith("/") ? subPathRaw : `/${subPathRaw}`;
  const pathNorm = subPath.endsWith("/") ? subPath : `${subPath}/`;

  const subDomain =
    (typeof settings?.subDomain === "string" && settings.subDomain.trim()) ||
    hostnameFromPanelUrl(panelBaseUrl, envPanelBaseUrl);
  if (!subDomain) return null;

  const subPort = Number(settings?.subPort ?? 2096);
  const subTls = panelSubTls(settings);
  const scheme = subTls ? "https" : "http";
  const hidePort = (subPort === 443 && subTls) || (subPort === 80 && !subTls);
  const host = hidePort ? subDomain : `${subDomain}:${subPort}`;
  return `${scheme}://${host}${pathNorm}`;
}

export type BuildSubUrlEnv = {
  /** XUI_SUB_BASE */
  subBase?: string | null;
  /** XUI_BASE_URL — only for hostname fallback in reconstruct */
  panelBaseUrl?: string | null;
};

/**
 * Build subscription page URL the same way 3x-ui panel does.
 * Prefer panel defaultSettings.subURI (Sanaei source of truth) over manual
 * XUI_SUB_BASE / PanelServer.subBase — those often still hold the docs example
 * `…/info/` while the panel's real subPath is a random token.
 * Manual override still wins when panel only returns a loopback host (API via 127.0.0.1).
 * Never falls back to PUBLIC_DOMAIN / Mini App host.
 */
export function buildSubUrl(
  subId: string,
  settings?: Record<string, unknown>,
  subBaseOverride?: string | null,
  panelBaseUrl?: string | null,
  envFallback?: BuildSubUrlEnv,
): string {
  const id = subId.trim();
  if (!id) return "sub://";

  // 1) Panel-computed subURI (= BuildSubURIBase + subPath) — same as Client Info page
  const subURI = typeof settings?.subURI === "string" ? settings.subURI.trim() : "";
  const fromPanel = sanitizeSubBase(subURI);
  if (fromPanel && !isLoopbackSubHost(fromPanel)) return appendSubId(fromPanel, id);

  // 2) Reconstruct from subDomain / subPort / subPath when subURI was empty
  const rebuilt = reconstructSubBase(settings, panelBaseUrl, envFallback?.panelBaseUrl);
  if (rebuilt && !isLoopbackSubHost(rebuilt)) return appendSubId(rebuilt, id);

  // 3) Manual override / env — when panel host is loopback or settings unavailable
  const override = sanitizeSubBase(subBaseOverride);
  if (override) return appendSubId(override, id);

  const fromEnv = sanitizeSubBase(envFallback?.subBase);
  if (fromEnv) return appendSubId(fromEnv, id);

  // 4) Last resort: loopback panel base (dev)
  if (fromPanel) return appendSubId(fromPanel, id);
  if (rebuilt) return appendSubId(rebuilt, id);

  return `sub://${id}`;
}
