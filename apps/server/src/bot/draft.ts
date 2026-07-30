import { prisma } from "../db.js";
import {
  clampQty,
  nextNationalVolume,
  nextVolume,
  resolvePrice,
  isOfferCategory,
  isFixedSingleServiceCategory,
  listFixedPlans,
  type PlanCategory,
} from "../services/pricing.js";
import { clampLimitIp } from "../services/panel-groups.js";
import { getDefaultLimitIp, getMaxPurchaseMonths, isSalesCategoryEnabled, resolvePurchaseLimitIp } from "../services/settings.js";
import { withEffectiveRole } from "../services/demo-role.js";
import type { User } from "@prisma/client";

async function capMonths(m: number) {
  const max = await getMaxPurchaseMonths();
  return Math.max(1, Math.min(max, m));
}

export async function getOrCreateDraft(telegramId: bigint) {
  const defaultIp = await getDefaultLimitIp();
  const draft = await prisma.buyDraft.upsert({
    where: { telegramId },
    create: {
      telegramId,
      trafficGb: 10,
      months: 1,
      unlimited: false,
      quantity: 1,
      limitIp: defaultIp,
      limitIpTouched: false,
      category: "data",
      accountMode: "random",
    },
    update: {},
  });

  if (!draft.limitIpTouched && draft.limitIp === 0 && defaultIp > 0) {
    return prisma.buyDraft.update({
      where: { telegramId },
      data: { limitIp: defaultIp },
    });
  }
  return draft;
}

export async function adjustDraftVolume(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  if (isFixedSingleServiceCategory(draft.category)) return draft;
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
  if (isFixedSingleServiceCategory(draft.category)) return draft;
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
  if (isFixedSingleServiceCategory(draft.category)) return draft;
  return prisma.buyDraft.update({
    where: { telegramId },
    data: { quantity: clampQty(draft.quantity + dir) },
  });
}

export async function adjustDraftLimitIp(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  if (isFixedSingleServiceCategory(draft.category)) return draft;
  const current = await resolvePurchaseLimitIp(draft);
  return prisma.buyDraft.update({
    where: { telegramId },
    data: { limitIp: clampLimitIp(current + dir), limitIpTouched: true },
  });
}

export async function setDraftCategory(telegramId: bigint, category: PlanCategory) {
  await getOrCreateDraft(telegramId);
  const months = await capMonths(1);
  const defaultIp = await getDefaultLimitIp();

  if (isFixedSingleServiceCategory(category)) {
    const cat = category.trim().toLowerCase();
    const plans = await listFixedPlans(cat);
    const first = plans[0];
    return prisma.buyDraft.update({
      where: { telegramId },
      data: {
        category: cat,
        unlimited: cat === "unlimited" || (first ? first.trafficGb == null : false),
        trafficGb: cat === "unlimited" ? null : first?.trafficGb ?? (cat === "national" ? 1 : 10),
        months: first ? await capMonths(first.months) : months,
        quantity: 1,
        limitIp: defaultIp,
        limitIpTouched: false,
        ...(isOfferCategory(cat) ? { discountCode: null } : {}),
        priceCellId: first?.id ?? null,
      },
    });
  }

  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      category,
      unlimited: false,
      trafficGb: 10,
      months,
      quantity: 1,
      limitIp: defaultIp,
      limitIpTouched: false,
      priceCellId: null,
    },
  });
}

/** Lock draft to a specific fixed plan price cell (offer / unlimited / national). */
export async function setDraftFixedPlan(
  telegramId: bigint,
  plan: { id: string; trafficGb: number | null; months: number; category: string },
) {
  await getOrCreateDraft(telegramId);
  const defaultIp = await getDefaultLimitIp();
  const cat = plan.category.trim().toLowerCase();
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      category: cat,
      unlimited: cat === "unlimited" || plan.trafficGb == null,
      trafficGb: cat === "unlimited" ? null : plan.trafficGb,
      months: await capMonths(plan.months),
      quantity: 1,
      limitIp: defaultIp,
      limitIpTouched: false,
      ...(isOfferCategory(cat) ? { discountCode: null } : {}),
      priceCellId: plan.id,
    },
  });
}

/** @deprecated Prefer setDraftFixedPlan — kept for offer deep-links. */
export async function setDraftOfferPlan(
  telegramId: bigint,
  plan: { id: string; trafficGb: number | null; months: number },
) {
  return setDraftFixedPlan(telegramId, { ...plan, category: "offer" });
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

export async function setDraftDiscountCode(telegramId: bigint, code: string | null) {
  const { normalizeDiscountCode } = await import("../services/discount-codes.js");
  return prisma.buyDraft.update({
    where: { telegramId },
    data: { discountCode: code ? normalizeDiscountCode(code) : null },
  });
}

export async function draftPrice(
  user: User,
  draft: { trafficGb: number | null; months: number; unlimited: boolean; category?: string },
  telegramId?: string | number | bigint,
) {
  const gb = draft.unlimited || draft.category === "unlimited" ? null : draft.trafficGb;
  const category = (draft.category as PlanCategory) || (gb === null ? "unlimited" : "data");
  const pricedUser = withEffectiveRole(user, telegramId ?? user.telegramId);
  return resolvePrice(pricedUser, gb, draft.months, category);
}

export { resolvePurchaseLimitIp };
