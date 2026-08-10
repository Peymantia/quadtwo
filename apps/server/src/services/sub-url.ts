/**
 * A usable sub base must be http(s) and include a path (/info/, /sub/, …).
 * Bare domains like `app.piing.ir` are Mini App hosts — NOT subscription bases.
 */
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

export function normalizeSubBase(base: string): string {
  const raw = base.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "") + "/";
}

/** Typical 3x-ui client subId (random alphanumeric). */
function looksLikeClientSubId(seg: string): boolean {
  return /^[a-zA-Z0-9]{8,32}$/.test(seg);
}

const SUB_PATH_ROOTS = new Set(["info", "sub", "json", "clash"]);

/**
 * Admins sometimes paste a full client subscription URL as "sub base":
 *   https://host:port/info/zdugcvix5jzv9k3v
 * which then becomes …/info/<otherId>/<newId> and 404s.
 * Strip that accidental trailing client id when path is exactly /{info|sub|json|clash}/{id}/.
 */
export function stripAccidentalClientId(base: string): string {
  try {
    const u = new URL(base);
    const parts = u.pathname.split("/").filter(Boolean);
    if (
      parts.length === 2 &&
      SUB_PATH_ROOTS.has(parts[0].toLowerCase()) &&
      looksLikeClientSubId(parts[1])
    ) {
      u.pathname = `/${parts[0]}/`;
      return normalizeSubBase(u.toString());
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function appendSubId(base: string, subId: string) {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return subId;
  // If base already ends with this exact subId, don't double-append
  if (trimmed.endsWith(`/${subId}`)) return trimmed;
  return `${trimmed}/${subId}`;
}

/** Prefer a real sub base; drop Mini App / bare-host junk; strip pasted full client URLs. */
export function sanitizeSubBase(base: string | null | undefined): string | null {
  if (!isValidSubBase(base)) return null;
  return stripAccidentalClientId(normalizeSubBase(base!));
}

/** True when raw looked like a full client URL that we had to strip. */
export function wasContaminatedSubBase(raw: string | null | undefined): boolean {
  if (!raw?.trim() || !isValidSubBase(raw)) return false;
  const normalized = normalizeSubBase(raw);
  return stripAccidentalClientId(normalized) !== normalized;
}
