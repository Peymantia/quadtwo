import type { AgentPriceOverride, User, UserRole } from "@prisma/client";
import { prisma } from "../db.js";

export type PriceOverrideDto = {
  id: string;
  category: string;
  perGb: number | null;
  perMonth: number | null;
  unlimitedPerMonth: number | null;
  partnerPricePercent: number;
  note: string | null;
};

export function mapPriceOverride(row: AgentPriceOverride): PriceOverrideDto {
  return {
    id: row.id,
    category: row.category,
    perGb: row.perGb,
    perMonth: row.perMonth,
    unlimitedPerMonth: row.unlimitedPerMonth,
    partnerPricePercent: row.partnerPricePercent,
    note: row.note,
  };
}

/** Whether checkout should apply stored custom rates for this user. */
export function shouldApplyCustomPricing(user: Pick<User, "useCustomPricing" | "role">): boolean {
  if (user.role === "admin") return false;
  return Boolean(user.useCustomPricing);
}

/**
 * Pick the override for a category. Exact category match first; legacy empty-category
 * row applies as fallback for all services.
 */
export function pickOverrideForCategory(
  overrides: AgentPriceOverride[],
  category: string,
): AgentPriceOverride | null {
  const cat = (category || "").trim().toLowerCase();
  const exact = overrides.find((o) => (o.category || "").trim().toLowerCase() === cat);
  if (exact) return exact;
  const legacyAll = overrides.find((o) => !(o.category || "").trim());
  return legacyAll ?? null;
}

export async function loadUserPriceOverrides(userId: string): Promise<AgentPriceOverride[]> {
  return prisma.agentPriceOverride.findMany({
    where: { userId },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
  });
}
