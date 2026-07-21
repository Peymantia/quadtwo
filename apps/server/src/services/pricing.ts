import type { User, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { formatToman, formatTraffic } from "../utils/format.js";
import { getPriceRates, getPricingMode, type RoleRates } from "./settings.js";

const VOLUME_STEPS = [10, 15, 20, 25, 30, 35, 40, 45, 50] as const;
export const NATIONAL_MAX_GB = 100;
export const DATA_VOLUME_PRESETS = [10, 15, 20, 25, 30, 35, 40, 45, 50] as const;

/** Builtin: data | national | unlimited — custom slugs allowed too */
export type PlanCategory = string;

export function nextVolume(current: number | null, unlimited: boolean, dir: 1 | -1): {
  trafficGb: number | null;
  unlimited: boolean;
} {
  if (unlimited) {
    if (dir === -1) return { trafficGb: 50, unlimited: false };
    return { trafficGb: null, unlimited: true };
  }
  const idx = VOLUME_STEPS.indexOf(current as (typeof VOLUME_STEPS)[number]);
  const i = idx >= 0 ? idx : 0;
  const next = i + dir;
  if (next < 0) return { trafficGb: 10, unlimited: false };
  if (next >= VOLUME_STEPS.length) return { trafficGb: null, unlimited: true };
  return { trafficGb: VOLUME_STEPS[next], unlimited: false };
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
  const cat = trafficGb === null ? "unlimited" : category;
  return prisma.priceCell.findFirst({
    where: { trafficGb, months, category: cat, active: true },
  });
}

export function priceFromCell(
  role: UserRole,
  cell: { priceUser: number; pricePartner: number; priceWholesale: number },
) {
  if (role === "wholesale") return cell.priceWholesale || cell.pricePartner;
  if (role === "partner" || role === "admin") return cell.pricePartner;
  return cell.priceUser;
}

function ratesForRole(role: UserRole, rates: Awaited<ReturnType<typeof getPriceRates>>): RoleRates {
  if (role === "wholesale") return rates.wholesale;
  if (role === "partner" || role === "admin") return rates.partner;
  return rates.user;
}

/** Formula: GB×perGb + months×perMonth (unlimited: months×unlimitedPerMonth) */
export function calcRatePrice(
  role: UserRole,
  trafficGb: number | null,
  months: number,
  rates: Awaited<ReturnType<typeof getPriceRates>>,
): number {
  const r = ratesForRole(role, rates);
  const m = clampMonths(months);
  if (trafficGb === null) return r.unlimitedPerMonth * m;
  return trafficGb * r.perGb + m * r.perMonth;
}

export async function resolvePrice(
  user: User,
  trafficGb: number | null,
  months: number,
  category: PlanCategory = "data",
) {
  const mode = await getPricingMode();
  if (mode === "rate") {
    // Golden/special matrix cells still override when an exact match exists
    const cell = await findPriceCell(trafficGb, months, category);
    if (cell?.isGolden) {
      return { cell, price: priceFromCell(user.role, cell), mode: "rate" as const };
    }
    const rates = await getPriceRates();
    const price = calcRatePrice(user.role, trafficGb, months, rates);
    return { cell: null, price, mode: "rate" as const };
  }

  const cell = await findPriceCell(trafficGb, months, category);
  if (!cell) return null;
  return { cell, price: priceFromCell(user.role, cell), mode: "matrix" as const };
}

export function matrixLine(trafficGb: number | null, months: number, price: number | null, qty = 1) {
  const vol = formatTraffic(trafficGb);
  const dur = months === 1 ? "۱ ماه" : `${months} ماه`;
  const unit = price === null ? "قیمت‌گذاری نشده" : formatToman(price);
  const total = price === null ? "" : `\n🧾 جمع ${qty} عدد: ${formatToman(price * qty)}`;
  return `📦 ${vol} · ⏳ ${dur}\n💰 هر عدد: ${unit}${qty > 1 ? total : ""}`;
}

export async function listPriceMatrix(category?: string) {
  return prisma.priceCell.findMany({
    where: { active: true, ...(category ? { category } : {}) },
    orderBy: [{ isGolden: "desc" }, { sortOrder: "asc" }, { months: "asc" }],
  });
}

export async function listGoldenOffers() {
  return prisma.priceCell.findMany({
    where: { active: true, isGolden: true },
    orderBy: { sortOrder: "asc" },
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
  category?: PlanCategory;
  isGolden?: boolean;
  title?: string;
}) {
  const category = input.trafficGb === null ? "unlimited" : (input.category ?? "data");
  const existing = await prisma.priceCell.findFirst({
    where: { trafficGb: input.trafficGb, months: input.months, category },
  });
  const data = {
    priceUser: input.priceUser,
    pricePartner: input.pricePartner,
    priceWholesale: input.priceWholesale ?? input.pricePartner,
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
