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

export function appendSubId(base: string, subId: string) {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return subId;
  return `${trimmed}/${subId}`;
}

/** Prefer a real sub base; drop Mini App / bare-host junk. */
export function sanitizeSubBase(base: string | null | undefined): string | null {
  return isValidSubBase(base) ? normalizeSubBase(base!) : null;
}
