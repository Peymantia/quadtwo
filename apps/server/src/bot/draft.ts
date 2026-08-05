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
import {
  getServerlessPricingConfig,
  isServerlessCategory,
  isServerlessEnabled,
  listServerlessDurations,
  SERVERLESS_CATEGORY,
  snapServerlessGb,
} from "../services/serverless.js";

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
  if (isServerlessCategory(draft.category)) {
    const cfg = await getServerlessPricingConfig();
    const months = draft.months <= 0 ? 0 : draft.months;
    const cur = snapServerlessGb(draft.trafficGb ?? cfg.weeklyMinGb, months, cfg);
    const next = snapServerlessGb(cur + dir, months, cfg);
    return prisma.buyDraft.update({
      where: { telegramId },
      data: { trafficGb: next, unlimited: false, quantity: 1 },
    });
  }
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

export async function setDraftServerlessDuration(
  telegramId: bigint,
  months: number,
) {
  await getOrCreateDraft(telegramId);
  const cfg = await getServerlessPricingConfig();
  const durations = listServerlessDurations(cfg);
  const m = months <= 0 ? 0 : Math.min(2, Math.max(1, Math.floor(months)));
  const d = durations.find((x) => x.months === m);
  if (!d) throw new Error("این مدت اعتبار فعلاً فعال نیست");
  const defaultIp = await getDefaultLimitIp();
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      category: SERVERLESS_CATEGORY,
      unlimited: false,
      trafficGb: d.minGb,
      months: d.months,
      quantity: 1,
      limitIp: defaultIp,
      limitIpTouched: false,
      priceCellId: null,
      discountCode: null,
    },
  });
}

export async function setDraftCategory(telegramId: bigint, category: PlanCategory) {
  if (await isServerlessEnabled()) {
    return setDraftServerlessDuration(telegramId, 1);
  }
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
  plan: { id: string; trafficGb: number | null; months: number; category: string; limitIp?: number },
) {
  await getOrCreateDraft(telegramId);
  const defaultIp = await getDefaultLimitIp();
  const cat = plan.category.trim().toLowerCase();
  const limitIp =
    typeof plan.limitIp === "number" && plan.limitIp > 0
      ? Math.max(0, Math.min(10, Math.floor(plan.limitIp)))
      : defaultIp;
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      category: cat === "reseller" ? "wholesale" : cat,
      unlimited: cat === "unlimited" || plan.trafficGb == null,
      trafficGb: cat === "unlimited" ? null : plan.trafficGb,
      months: await capMonths(plan.months),
      quantity: 1,
      limitIp,
      limitIpTouched: typeof plan.limitIp === "number" && plan.limitIp > 0,
      ...(isOfferCategory(cat) || cat === "wholesale" || cat === "reseller" ? { discountCode: null } : {}),
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
  const pricedUser = withEffectiveRole(user, telegramId ?? user.telegramId);
  if (isServerlessCategory(draft.category) || (await isServerlessEnabled())) {
    const { resolveServerlessPrice } = await import("../services/serverless.js");
    return resolveServerlessPrice(pricedUser, draft.trafficGb, draft.months);
  }
  const gb = draft.unlimited || draft.category === "unlimited" ? null : draft.trafficGb;
  const category = (draft.category as PlanCategory) || (gb === null ? "unlimited" : "data");
  return resolvePrice(pricedUser, gb, draft.months, category);
}

export { resolvePurchaseLimitIp };
