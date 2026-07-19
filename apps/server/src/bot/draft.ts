import { prisma } from "../db.js";
import {
  clampQty,
  nextNationalVolume,
  nextVolume,
  resolvePrice,
  type PlanCategory,
} from "../services/pricing.js";
import { clampLimitIp } from "../services/panel-groups.js";
import { getDefaultLimitIp, getMaxPurchaseMonths, isSalesCategoryEnabled } from "../services/settings.js";
import type { User } from "@prisma/client";

async function capMonths(m: number) {
  const max = await getMaxPurchaseMonths();
  return Math.max(1, Math.min(max, m));
}

export async function getOrCreateDraft(telegramId: bigint) {
  const defaultIp = await getDefaultLimitIp();
  return prisma.buyDraft.upsert({
    where: { telegramId },
    create: {
      telegramId,
      trafficGb: 10,
      months: 1,
      unlimited: false,
      quantity: 1,
      limitIp: defaultIp,
      category: "data",
      accountMode: "random",
    },
    update: {},
  });
}

export async function adjustDraftVolume(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  if (draft.category === "national") {
    const gb = nextNationalVolume(draft.trafficGb, dir);
    return prisma.buyDraft.update({
      where: { telegramId },
      data: { trafficGb: gb, unlimited: false, months: 1 },
    });
  }
  const next = nextVolume(draft.trafficGb, draft.unlimited, dir);
  if (next.unlimited && !(await isSalesCategoryEnabled("unlimited"))) {
    return draft;
  }
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      trafficGb: next.trafficGb,
      unlimited: next.unlimited,
      category: next.unlimited ? "unlimited" : draft.category === "unlimited" ? "data" : draft.category,
    },
  });
}

export async function adjustDraftMonths(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  const max = await getMaxPurchaseMonths();
  if (max <= 1 || draft.category === "national") {
    return prisma.buyDraft.update({
      where: { telegramId },
      data: { months: 1 },
    });
  }
  const next = await capMonths(draft.months + dir);
  return prisma.buyDraft.update({
    where: { telegramId },
    data: { months: next },
  });
}

export async function adjustDraftQty(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  return prisma.buyDraft.update({
    where: { telegramId },
    data: { quantity: clampQty(draft.quantity + dir) },
  });
}

export async function adjustDraftLimitIp(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  return prisma.buyDraft.update({
    where: { telegramId },
    data: { limitIp: clampLimitIp(draft.limitIp + dir) },
  });
}

export async function setDraftCategory(telegramId: bigint, category: PlanCategory) {
  await getOrCreateDraft(telegramId);
  const months = await capMonths(1);
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      category,
      unlimited: category === "unlimited",
      trafficGb: category === "unlimited" ? null : category === "national" ? 1 : 10,
      months,
      quantity: 1,
    },
  });
}

export async function setDraftNameMode(telegramId: bigint, mode: "random" | "custom", name?: string) {
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      accountMode: mode,
      accountName: mode === "custom" ? name ?? null : null,
    },
  });
}

export async function draftPrice(
  user: User,
  draft: { trafficGb: number | null; months: number; unlimited: boolean; category?: string },
) {
  const gb = draft.unlimited || draft.category === "unlimited" ? null : draft.trafficGb;
  const category = (draft.category as PlanCategory) || (gb === null ? "unlimited" : "data");
  return resolvePrice(user, gb, draft.months, category);
}
