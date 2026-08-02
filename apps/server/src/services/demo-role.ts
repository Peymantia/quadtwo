import type { User, UserRole } from "@prisma/client";
import { isDemoMode } from "./license.js";
import { APP_ROLES, roleLabelFa, type AppRole, isAppRole } from "./roles.js";

const ROLES = new Set<string>(APP_ROLES);

/** In-memory demo role overlay (per Telegram ID). Lost on process restart — fine for demos. */
const byTelegramId = new Map<string, UserRole>();

export type DemoRole = AppRole;

export function parseDemoRole(raw: string | undefined | null): DemoRole | null {
  if (!raw) return null;
  const r = raw.trim().toLowerCase();
  if (!isAppRole(r)) return null;
  return r;
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

/** User object with role replaced by demo overlay (for pricing / permissions). */
export function withEffectiveRole<T extends { role: UserRole }>(
  user: T,
  telegramId: string | number | bigint | undefined,
): T {
  if (!isDemoMode() || telegramId === undefined) return user;
  const role = effectiveRole(telegramId, user.role);
  if (role === user.role) return user;
  return { ...user, role };
}

export function demoRoleLabel(role: string): string {
  return roleLabelFa(role);
}

export function listDemoRoles(): DemoRole[] {
  return [...ROLES] as DemoRole[];
}
