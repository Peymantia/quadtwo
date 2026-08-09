/** Custom account / panel email names: Latin letters, digits, `.` `_` `-` only. */

export const ACCOUNT_NAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export const ACCOUNT_NAME_HINT =
  "فقط حروف و عدد انگلیسی، نقطه (.)، دش (-) و آندرلاین (_) — ۳ تا ۳۲ کاراکتر";

export function isValidAccountName(name: string): boolean {
  return ACCOUNT_NAME_RE.test(name.trim());
}

/** Throws a Persian error when the name is not allowed. */
export function assertValidAccountName(name: string): string {
  const trimmed = name.trim();
  if (!isValidAccountName(trimmed)) {
    throw new Error(`نام نامعتبر است. ${ACCOUNT_NAME_HINT}`);
  }
  return trimmed;
}

/** Keep only allowed characters (for fallback / random cleanup). */
export function stripAccountName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
}
