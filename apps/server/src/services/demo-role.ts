import type { UserRole } from "@prisma/client";
import { isDemoMode } from "./license.js";

const ROLES = new Set<string>(["user", "partner", "wholesale", "admin"]);

/** In-memory demo role overlay (per Telegram ID). Lost on process restart — fine for demos. */
const byTelegramId = new Map<string, UserRole>();

export type DemoRole = "user" | "partner" | "wholesale" | "admin";

export function parseDemoRole(raw: string | undefined | null): DemoRole | null {
  if (!raw) return null;
  const r = raw.trim().toLowerCase();
  if (!ROLES.has(r)) return null;
  return r as DemoRole;
}

export function getDemoRole(telegramId: string | number | bigint): DemoRole | null {
  if (!isDemoMode()) return null;
  return byTelegramId.get(String(telegramId)) ?? null;
}

export function setDemoRole(telegramId: string | number | bigint, role: DemoRole): void {
  if (!isDemoMode()) return;
  byTelegramId.set(String(telegramId), role);
}

export function clearDemoRole(telegramId: string | number | bigint): void {
  byTelegramId.delete(String(telegramId));
}

/** Resolve menu/API role: demo overlay wins when DEMO_MODE is on. */
export function effectiveRole(
  telegramId: string | number | bigint | undefined,
  dbRole: UserRole | string,
): UserRole {
  if (telegramId !== undefined && isDemoMode()) {
    const demo = getDemoRole(telegramId);
    if (demo) return demo as UserRole;
  }
  return dbRole as UserRole;
}

export function demoRoleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "ادمین";
    case "partner":
      return "همکار";
    case "wholesale":
      return "عمده‌فروش";
    default:
      return "کاربر";
  }
}
