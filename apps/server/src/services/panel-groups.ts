import type { User, UserRole } from "@prisma/client";
import type { XuiClient } from "../panel/xui-client.js";

/** Panel group for regular customers */
export const TELEGRAM_GROUP = "Telegram";

/** Build a stable, human-readable group name for partners / wholesalers. */
export function partnerPanelGroupName(
  user: { telegramId: bigint; username?: string | null; firstName?: string | null },
  asRole: "partner" | "wholesale",
): string {
  const raw = (user.username || user.firstName || String(user.telegramId))
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 24);
  const base = raw || String(user.telegramId);
  return asRole === "wholesale" ? `wholesale_${base}` : `partner_${base}`;
}

/**
 * Which 3x-ui group should receive newly created clients for this buyer.
 * - partner / wholesale → their dedicated panel group
 * - everyone else (user, admin buying personally) → "Telegram"
 */
export function resolveClientGroup(user: User): string {
  if (
    (user.role === "partner" || user.role === "wholesale") &&
    user.panelGroup
  ) {
    return user.panelGroup;
  }
  if (user.role === "partner" || user.role === "wholesale") {
    return partnerPanelGroupName(user, user.role === "wholesale" ? "wholesale" : "partner");
  }
  return TELEGRAM_GROUP;
}

/** Ensure group exists and add client emails into it. */
export async function ensureClientsInGroup(xui: XuiClient, emails: string[], group: string) {
  if (!emails.length || !group) return;
  try {
    await xui.createGroup(group);
  } catch {
    /* already exists */
  }
  try {
    await xui.bulkAddToGroup(emails, group);
  } catch (err) {
    console.warn("bulkAddToGroup failed", group, err);
  }
}

export function clampLimitIp(n: number) {
  return Math.max(0, Math.min(10, Math.floor(n)));
}

export function formatLimitIp(n: number) {
  return n <= 0 ? "نامحدود" : `${n} دستگاه`;
}

export type { UserRole };
