/** Shared role helpers — Persian labels + permission groups.
 *
 * reseller  = همکار ویژه (former «عمده» tier: seek/matrix, limitIp editable)
 * wholesale = عمده‌فروش (fixed admin-defined plans only, no limitIp edit)
 */

export type AppRole = "user" | "partner" | "wholesale" | "reseller" | "admin";

export const APP_ROLES: AppRole[] = ["user", "partner", "wholesale", "reseller", "admin"];

export function isAppRole(v: unknown): v is AppRole {
  return typeof v === "string" && (APP_ROLES as string[]).includes(v);
}

/** Persian display name for dashboards / bot. */
export function roleLabelFa(role: string): string {
  switch (role) {
    case "admin":
      return "ادمین";
    case "partner":
      return "همکار";
    case "reseller":
      return "همکار ویژه";
    case "wholesale":
      return "عمده‌فروش";
    default:
      return "کاربر";
  }
}

/** Partner / همکار ویژه / عمده‌فروش / admin — seller-side features. */
export function isSellerRole(role: string): boolean {
  return role === "partner" || role === "wholesale" || role === "reseller" || role === "admin";
}

/** Roles that may use seek/custom volume purchase (عمده‌فروش cannot). */
export function canSeekBuy(role: string): boolean {
  return role !== "wholesale";
}

/**
 * Category key for admin-defined fixed plans for عمده‌فروش (`wholesale` role).
 * Legacy DB value `reseller` is still accepted via isWholesaleFixedCategory.
 */
export const WHOLESALE_FIXED_CATEGORY = "wholesale";

/** @deprecated use WHOLESALE_FIXED_CATEGORY */
export const RESELLER_CATEGORY = WHOLESALE_FIXED_CATEGORY;

export function isWholesaleFixedCategory(category: string | null | undefined): boolean {
  const c = (category || "").trim().toLowerCase();
  return c === WHOLESALE_FIXED_CATEGORY || c === "reseller";
}

/** @deprecated use isWholesaleFixedCategory */
export function isResellerCategory(category: string | null | undefined): boolean {
  return isWholesaleFixedCategory(category);
}

/** عمده‌فروش — فقط پلن ثابت */
export function isWholesaleFixedRole(role: string): boolean {
  return role === "wholesale";
}

/** @deprecated use isWholesaleFixedRole */
export function isResellerRole(role: string): boolean {
  return isWholesaleFixedRole(role);
}

/** همکار ویژه */
export function isSpecialPartnerRole(role: string): boolean {
  return role === "reseller";
}
