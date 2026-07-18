import type { User, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { formatToman, formatTraffic } from "../utils/format.js";

const VOLUME_STEPS = [10, 15, 20, 25, 30, 35, 40, 45, 50] as const;

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

export function clampMonths(m: number) {
  return Math.max(1, Math.min(12, m));
}

export async function findPriceCell(trafficGb: number | null, months: number) {
  return prisma.priceCell.findFirst({
    where: { trafficGb, months, active: true },
  });
}

export function priceFromCell(
  role: UserRole,
  cell: { priceUser: number; pricePartner: number },
) {
  if (role === "partner" || role === "admin") return cell.pricePartner;
  return cell.priceUser;
}

export async function resolvePrice(user: User, trafficGb: number | null, months: number) {
  const cell = await findPriceCell(trafficGb, months);
  if (!cell) return null;
  return { cell, price: priceFromCell(user.role, cell) };
}

export function matrixLine(trafficGb: number | null, months: number, price: number | null) {
  const vol = formatTraffic(trafficGb);
  const dur = months === 1 ? "۱ ماه" : `${months} ماه`;
  const p = price === null ? "قیمت‌گذاری نشده" : formatToman(price);
  return `📦 ${vol} · ⏳ ${dur}\n💰 ${p}`;
}

export async function listPriceMatrix() {
  return prisma.priceCell.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { months: "asc" }],
  });
}

export async function upsertPriceCell(input: {
  trafficGb: number | null;
  months: number;
  priceUser: number;
  pricePartner: number;
}) {
  const existing = await prisma.priceCell.findFirst({
    where: { trafficGb: input.trafficGb, months: input.months },
  });
  if (existing) {
    return prisma.priceCell.update({
      where: { id: existing.id },
      data: {
        priceUser: input.priceUser,
        pricePartner: input.pricePartner,
        active: true,
      },
    });
  }
  return prisma.priceCell.create({
    data: {
      ...input,
      sortOrder: (input.trafficGb ?? 999) * 10 + input.months,
    },
  });
}
