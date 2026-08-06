import type { User, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { formatToman, formatTraffic } from "../utils/format.js";
import {
  getPriceRates,
  getPricingModeForRole,
  ratesForRoleCategory,
  type PriceRates,
  type RoleRates,
} from "./settings.js";
import { isWholesaleFixedCategory, isWholesaleFixedRole, WHOLESALE_FIXED_CATEGORY } from "./roles.js";

export { isWholesaleFixedCategory, isResellerCategory, WHOLESALE_FIXED_CATEGORY, RESELLER_CATEGORY } from "./roles.js";
export const DATA_MIN_GB = 10;
export const DATA_MAX_GB = 50;
export const DATA_STEP_GB = 5;
export const NATIONAL_MIN_GB = 1;
export const NATIONAL_MAX_GB = 20;

/** VIP / custom categories: 10…50 GB in steps of 5 */
export const DATA_VOLUME_PRESETS: readonly number[] = Array.from(
  { length: Math.floor((DATA_MAX_GB - DATA_MIN_GB) / DATA_STEP_GB) + 1 },
  (_, i) => DATA_MIN_GB + i * DATA_STEP_GB,
);

const VOLUME_STEPS = DATA_VOLUME_PRESETS;

export function snapDataGb(raw: number): number {
  const n = Math.round(Number(raw) / DATA_STEP_GB) * DATA_STEP_GB;
  if (!Number.isFinite(n)) return DATA_MIN_GB;
  return Math.max(DATA_MIN_GB, Math.min(DATA_MAX_GB, n));
}

export function snapNationalGb(raw: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return NATIONAL_MIN_GB;
  return Math.max(NATIONAL_MIN_GB, Math.min(NATIONAL_MAX_GB, n));
}

/** Builtin: data | national | unlimited — custom slugs allowed too */
export type PlanCategory = string;

/** Fixed special-offer category: volume/months/price locked; only account name is editable. */
export function isOfferCategory(category: string | null | undefined): boolean {
  return (category || "").trim().toLowerCase() === "offer";
}

/**
 * Single fixed service (no volume/month/qty steppers): offer, unlimited, national, wholesale.
 * Buyer picks a priced plan card; quantity is always 1.
 */
export function isFixedSingleServiceCategory(category: string | null | undefined): boolean {
  const c = (category || "").trim().toLowerCase();
  return c === "offer" || c === "unlimited" || c === "national" || c === "wholesale" || c === "reseller";
}

/** Normalize traffic for purchase (unlimited → null; national 1–20; else 10–50 ×5). */
export function normalizePurchaseTraffic(category: string, trafficGb: number | null): number | null {
  if (category === "unlimited") return null;
  if (isOfferCategory(category) || isWholesaleFixedCategory(category)) {
    if (trafficGb == null) return null;
    const n = Math.floor(Number(trafficGb));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (trafficGb === null) return category === "unlimited" ? null : snapDataGb(10);
  if (category === "national") return snapNationalGb(trafficGb);
  return snapDataGb(trafficGb);
}

export function volumeRulesForCategory(category: string): {
  kind: "unlimited" | "national" | "data" | "offer" | "wholesale" | "reseller";
  min?: number;
  max?: number;
  step?: number;
} {
  if (isOfferCategory(category) || isWholesaleFixedCategory(category)) {
    return { kind: isWholesaleFixedCategory(category) ? "wholesale" : "offer" };
  }
  if (category === "unlimited") return { kind: "unlimited" };
  if (category === "national") {
    return { kind: "national", min: NATIONAL_MIN_GB, max: NATIONAL_MAX_GB, step: 1 };
  }
  return { kind: "data", min: DATA_MIN_GB, max: DATA_MAX_GB, step: DATA_STEP_GB };
}

export function nextVolume(current: number | null, unlimited: boolean, dir: 1 | -1): {
  trafficGb: number | null;
  unlimited: boolean;
} {
  if (unlimited) {
    if (dir === -1) return { trafficGb: DATA_MAX_GB, unlimited: false };
    return { trafficGb: null, unlimited: true };
  }
  const idx = VOLUME_STEPS.indexOf(current as number);
  const i = idx >= 0 ? idx : 0;
  const next = i + dir;
  if (next < 0) return { trafficGb: DATA_MIN_GB, unlimited: false };
  if (next >= VOLUME_STEPS.length) return { trafficGb: null, unlimited: true };
  return { trafficGb: VOLUME_STEPS[next]!, unlimited: false };
}

/** National: 1 GB steps, never unlimited */
export function nextNationalVolume(current: number | null, dir: 1 | -1): number {
  const cur = Math.max(1, Math.min(NATIONAL_MAX_GB, current ?? 1));
  return Math.max(1, Math.min(NATIONAL_MAX_GB, cur + dir));
}

export function clampMonths(m: number) {
  return Math.max(1, Math.min(12, m));
}

export function clampQty(q: number) {
  return Math.max(1, Math.min(50, q));
}

export async function findPriceCell(
  trafficGb: number | null,
  months: number,
  category: PlanCategory = "data",
) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  let cat: string;
  if (isWholesaleFixedCategory(category)) cat = WHOLESALE_FIXED_CATEGORY;
  else if (isOfferCategory(category)) cat = "offer";
  else if (trafficGb === null) cat = "unlimited";
  else cat = category;
  return prisma.priceCell.findFirst({
    where: { tenantId, trafficGb, months, category: cat, active: true },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
  });
}

export async function findPriceCellById(id: string) {
  return prisma.priceCell.findFirst({ where: { id, active: true } });
}

export function priceFromCell(
  role: UserRole,
  cell: {
    priceUser: number;
    pricePartner: number;
    priceWholesale: number;
    priceReseller?: number;
  },
) {
  if (isWholesaleFixedRole(role)) return cell.priceReseller ?? 0;
  if (role === "reseller" || role === "admin") return cell.priceWholesale || cell.pricePartner;
  if (role === "partner") return cell.pricePartner;
  return cell.priceUser;
}

/** Formula: GB×perGb + months×perMonth (unlimited: months×unlimitedPerMonth) */
export function calcRatePriceFromRates(
  trafficGb: number | null,
  months: number,
  r: RoleRates,
): number {
  const m = clampMonths(months);
  if (trafficGb === null) return r.unlimitedPerMonth * m;
  return trafficGb * r.perGb + m * r.perMonth;
}

export function calcRatePrice(
  role: UserRole,
  trafficGb: number | null,
  months: number,
  rates: PriceRates,
  category: PlanCategory = "data",
): number {
  const cat = trafficGb === null ? "unlimited" : category;
  const r = ratesForRoleCategory(role, cat, rates);
  return calcRatePriceFromRates(trafficGb, months, r);
}

export async function resolvePrice(
  user: User,
  trafficGb: number | null,
  months: number,
  category: PlanCategory = "data",
  roleOverride?: UserRole | string | null,
) {
  const role = (roleOverride ?? user.role) as UserRole;

  // Admin checkout is always complimentary (prod + demo)
  if (role === "admin") {
    return { cell: null, price: 0, mode: "rate" as const };
  }

  // Per-agent custom rates / matrix percent
  const override = await prisma.agentPriceOverride.findUnique({ where: { userId: user.id } });
  if (override && (role === "partner" || role === "reseller" || role === "wholesale")) {
    const cat = (category || "").trim().toLowerCase();
    const scopeOk = !override.category || override.category === cat;
    if (scopeOk && !(isOfferCategory(cat) || isWholesaleFixedCategory(cat))) {
      const isUnlimited = trafficGb === null || cat === "unlimited";
      if (isUnlimited && override.unlimitedPerMonth != null && override.unlimitedPerMonth > 0) {
        return {
          cell: null,
          price: override.unlimitedPerMonth * Math.max(1, months),
          mode: "rate" as const,
        };
      }
      if (!isUnlimited && trafficGb != null) {
        const perGb = override.perGb;
        const perMonth = override.perMonth;
        if (perGb != null || perMonth != null) {
          const price =
            (perGb ?? 0) * trafficGb + (perMonth ?? 0) * Math.max(1, months);
          if (price > 0) return { cell: null, price, mode: "rate" as const };
        }
      }
    }
  }

  const applyPartnerPercent = (price: number) => {
    if (!override || override.partnerPricePercent == null || override.partnerPricePercent === 100) {
      return price;
    }
    if (!(role === "partner" || role === "reseller" || role === "wholesale")) return price;
    return Math.max(0, Math.round((price * override.partnerPricePercent) / 100));
  };

  if ((category || "").trim().toLowerCase() === "serverless") {
    const { resolveServerlessPrice } = await import("./serverless.js");
    return resolveServerlessPrice(user, trafficGb, months);
  }

  // Offer / عمده‌فروش fixed plans are always matrix cells (no rate formula / seek bars).
  if (isOfferCategory(category) || isWholesaleFixedCategory(category)) {
    const cell = await findPriceCell(
      trafficGb,
      months,
      isWholesaleFixedCategory(category) ? WHOLESALE_FIXED_CATEGORY : "offer",
    );
    if (!cell) return null;
    const price = applyPartnerPercent(priceFromCell(role, cell));
    if (price <= 0) return null;
    return { cell, price, mode: "matrix" as const };
  }

  const isUnlimited = trafficGb === null || category === "unlimited";
  const mode = await getPricingModeForRole(role);

  // Unlimited: prefer monthly rates; fall back to matrix cell so admin matrix prices still work.
  if (isUnlimited) {
    const cell = await findPriceCell(null, months, "unlimited");
    if (cell?.isGolden) {
      const goldenPrice = applyPartnerPercent(priceFromCell(role, cell));
      if (goldenPrice > 0) return { cell, price: goldenPrice, mode: "rate" as const };
    }
    const rates = await getPriceRates();
    const ratePrice = calcRatePrice(role, null, months, rates, "unlimited");
    if (ratePrice > 0) {
      return { cell: null, price: applyPartnerPercent(ratePrice), mode: "rate" as const };
    }
    if (cell) {
      const matrixPrice = applyPartnerPercent(priceFromCell(role, cell));
      if (matrixPrice > 0) return { cell, price: matrixPrice, mode: "matrix" as const };
    }
    return null;
  }

  if (mode === "rate") {
    // Golden/special matrix cells still override when an exact match exists
    const cell = await findPriceCell(trafficGb, months, category);
    if (cell?.isGolden) {
      return { cell, price: applyPartnerPercent(priceFromCell(role, cell)), mode: "rate" as const };
    }
    const rates = await getPriceRates();
    const price = calcRatePrice(role, trafficGb, months, rates, category);
    if (!price || price <= 0) return null;
    return { cell: null, price: applyPartnerPercent(price), mode: "rate" as const };
  }

  const cell = await findPriceCell(trafficGb, months, category);
  if (!cell) return null;
  return { cell, price: applyPartnerPercent(priceFromCell(role, cell)), mode: "matrix" as const };
}

export function matrixLine(trafficGb: number | null, months: number, price: number | null, qty = 1) {
  const vol = formatTraffic(trafficGb);
  const dur = months === 1 ? "۱ ماه" : `${months} ماه`;
  const unit = price === null ? "قیمت‌گذاری نشده" : formatToman(price);
  const total = price === null ? "" : `\n🧾 جمع ${qty} عدد: ${formatToman(price * qty)}`;
  return `📦 ${vol} · ⏳ ${dur}\n💰 هر عدد: ${unit}${qty > 1 ? total : ""}`;
}

export async function listPriceMatrix(category?: string) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  return prisma.priceCell.findMany({
    where: { tenantId, active: true, ...(category ? { category } : {}) },
    orderBy: [{ isGolden: "desc" }, { sortOrder: "asc" }, { months: "asc" }],
  });
}

export async function listGoldenOffers() {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  return prisma.priceCell.findMany({
    where: { tenantId, active: true, isGolden: true },
    orderBy: { sortOrder: "asc" },
  });
}

/** Active fixed plans in the `offer` category. */
export async function listOfferPlans() {
  return listFixedPlans("offer");
}

/** Active fixed plans for عمده‌فروش (wholesale category). */
export async function listResellerPlans() {
  return listFixedPlans(WHOLESALE_FIXED_CATEGORY);
}

/** Active priced plans for a fixed single-service category. */
export async function listFixedPlans(category: string) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const cat = (category || "").trim().toLowerCase();
  if (!isFixedSingleServiceCategory(cat)) return [];
  const whereCat =
    cat === "wholesale" || cat === "reseller"
      ? { in: ["wholesale", "reseller"] }
      : cat;
  return prisma.priceCell.findMany({
    where: { tenantId, active: true, category: whereCat },
    orderBy: [{ sortOrder: "asc" }, { months: "asc" }, { trafficGb: "asc" }],
  });
}

/** Distinct months that have active data plans, plus empty months 1–3 for easy navigation */
export async function listDataMonths(): Promise<Array<{ months: number; count: number }>> {
  const cells = await listPriceMatrix("data");
  const map = new Map<number, number>();
  for (const c of cells) {
    map.set(c.months, (map.get(c.months) ?? 0) + 1);
  }
  for (const m of [1, 2, 3]) {
    if (!map.has(m)) map.set(m, 0);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([months, count]) => ({ months, count }));
}

export async function listDataPlansForMonth(months: number) {
  return prisma.priceCell.findMany({
    where: { active: true, category: "data", months },
    orderBy: [{ sortOrder: "asc" }, { trafficGb: "asc" }],
  });
}

export async function upsertPriceCell(input: {
  trafficGb: number | null;
  months: number;
  priceUser: number;
  pricePartner: number;
  priceWholesale?: number;
  priceReseller?: number;
  limitIp?: number;
  category?: PlanCategory;
  isGolden?: boolean;
  title?: string;
}) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const requested = (input.category ?? "data").trim() || "data";
  const category = isWholesaleFixedCategory(requested)
    ? WHOLESALE_FIXED_CATEGORY
    : isOfferCategory(requested)
      ? "offer"
      : input.trafficGb === null
        ? "unlimited"
        : requested;
  const existing = await prisma.priceCell.findFirst({
    where: { tenantId, trafficGb: input.trafficGb, months: input.months, category },
  });
  const data = {
    priceUser: input.priceUser,
    pricePartner: input.pricePartner,
    priceWholesale: input.priceWholesale ?? input.pricePartner,
    priceReseller: input.priceReseller ?? input.priceUser,
    ...(input.limitIp !== undefined
      ? { limitIp: Math.max(0, Math.min(10, Math.floor(input.limitIp))) }
      : {}),
    category,
    isGolden: input.isGolden ?? false,
    title: input.title,
    active: true,
  };
  if (existing) {
    return prisma.priceCell.update({ where: { id: existing.id }, data });
  }
  return prisma.priceCell.create({
    data: {
      tenantId,
      trafficGb: input.trafficGb,
      months: input.months,
      ...data,
      sortOrder: (input.trafficGb ?? 999) * 10 + input.months,
    },
  });
}

export async function setCellGolden(id: string, isGolden: boolean) {
  return prisma.priceCell.update({ where: { id }, data: { isGolden } });
}

export async function deactivateCell(id: string) {
  return prisma.priceCell.update({ where: { id }, data: { active: false } });
}
