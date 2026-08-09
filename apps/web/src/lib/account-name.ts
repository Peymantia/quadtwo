/** Custom account names: Latin letters, digits, `.` `_` `-` only. */

export const ACCOUNT_NAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export const ACCOUNT_NAME_HINT =
  "فقط حروف و عدد انگلیسی، نقطه (.)، دش (-) و آندرلاین (_) — ۳ تا ۳۲ کاراکتر";

export function isValidAccountName(name: string): boolean {
  return ACCOUNT_NAME_RE.test(name.trim());
}

/** Strip illegal chars while typing (keeps length ≤ 32). */
export function filterAccountNameInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
}
