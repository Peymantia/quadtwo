import type { User, UserRole } from "@prisma/client";
import type { XuiClient } from "../panel/xui-client.js";

/** Panel group for regular customers only */
export const TELEGRAM_GROUP = "Telegram";

/** Roles that must buy into their own named panel group (not Telegram). */
export function needsDedicatedPanelGroup(role: UserRole | string): boolean {
  return role === "admin" || role === "partner" || role === "wholesale";
}

/** ASCII slug for 3x-ui group names (panel usually expects Latin). */
export function sanitizePanelGroupSlug(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 32);
}

/**
 * Build panel group from نماینده name.
 * Requires at least one Latin letter/digit in the name.
 */
export function buildPanelGroupFromAgentName(agentName: string, telegramId: bigint): string {
  const base = sanitizePanelGroupSlug(agentName);
  if (!base) {
    throw new Error(
      "نام نماینده برای گروه پنل باید شامل حروف یا عدد انگلیسی باشد.\nمثال: AliShop یا Reseller01",
    );
  }
  return base;
}

/** @deprecated prefer buildPanelGroupFromAgentName with explicit agentName */
export function partnerPanelGroupName(
  user: { telegramId: bigint; username?: string | null; firstName?: string | null; agentName?: string | null },
  asRole: "partner" | "wholesale",
): string {
  const source = user.agentName || user.username || user.firstName || String(user.telegramId);
  try {
    return buildPanelGroupFromAgentName(source, user.telegramId);
  } catch {
    return `${asRole}_${String(user.telegramId).slice(-8)}`;
  }
}

/**
 * Which 3x-ui group should receive newly created clients for this buyer.
 * - regular user → "Telegram"
 * - admin / partner / wholesale → their panelGroup (from نام نماینده)
 */
export function resolveClientGroup(user: User): string {
  if (!needsDedicatedPanelGroup(user.role)) {
    return TELEGRAM_GROUP;
  }
  if (user.panelGroup?.trim()) {
    return user.panelGroup.trim();
  }
  if (user.agentName?.trim()) {
    return buildPanelGroupFromAgentName(user.agentName, user.telegramId);
  }
  throw new Error(
    "نام نماینده تعریف نشده است. قبل از خرید، نام نماینده را در پنل تنظیم کنید.",
  );
}

/** Block checkout until agent name + panel group are ready. */
export function assertAgentReadyForPurchase(user: User): { ok: true } | { ok: false; message: string } {
  if (!needsDedicatedPanelGroup(user.role)) {
    return { ok: true };
  }
  if (!user.agentName?.trim()) {
    return {
      ok: false,
      message: [
        "❌ نام نماینده هنوز تعریف نشده است.",
        "",
        "ادمین/نماینده نمی‌تواند بدون نام اختصاصی خرید کند.",
        "گروه پنل شما از روی نام نماینده ساخته می‌شود (نه گروه Telegram).",
        "",
        "از «💼 پنل نماینده» یا کنترل سنتر، نام نماینده را تنظیم کنید.",
        "مثال: AliShop",
      ].join("\n"),
    };
  }
  try {
    buildPanelGroupFromAgentName(user.agentName, user.telegramId);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true };
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
