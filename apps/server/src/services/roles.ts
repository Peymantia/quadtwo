/** Shared role helpers — Persian labels + permission groups. */

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
    case "wholesale":
      return "همکار ویژه";
    case "reseller":
      return "عمده‌فروش";
    default:
      return "کاربر";
  }
}

/** Partner / همکار ویژه / عمده‌فروش / admin — seller-side features. */
export function isSellerRole(role: string): boolean {
  return role === "partner" || role === "wholesale" || role === "reseller" || role === "admin";
}

/** Roles that may use seek/custom volume purchase (not reseller). */
export function canSeekBuy(role: string): boolean {
  return role !== "reseller";
}

/** Category key for admin-defined fixed plans for عمده‌فروش. */
export const RESELLER_CATEGORY = "reseller";

export function isResellerCategory(category: string | null | undefined): boolean {
  return (category || "").trim().toLowerCase() === RESELLER_CATEGORY;
}

export function isResellerRole(role: string): boolean {
  return role === "reseller";
}
