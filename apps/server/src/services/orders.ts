import { OrderKind, OrderStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "../db.js";
import { resolvePanelForCategory, resolvePanelForSubscription } from "./panel-servers.js";
import { checkRenewEligibility, inferRenewCategory } from "./renew-eligibility.js";
import { canEditLimitIp, getDefaultLimitIp, UNLIMITED_LIMIT_IP } from "./settings.js";
import {
  clampMonths,
  normalizePurchaseTraffic,
  resolvePrice,
  isOfferCategory,
  isFixedSingleServiceCategory,
  findPriceCell,
  priceFromCell,
  isWholesaleFixedCategory,
  WHOLESALE_FIXED_CATEGORY,
  type PlanCategory,
} from "./pricing.js";
import { debitWallet } from "./wallet.js";
import { withEffectiveRole } from "./demo-role.js";
import { isDemoMode } from "./license.js";
import { assertAndApplyDiscount, recordDiscountUse, cancelOpenPendingForDiscount } from "./discount-codes.js";
import { isWholesaleFixedRole } from "./roles.js";
import { assertValidAccountName } from "../utils/account-name.js";
import { assertPurchasesAllowed } from "./purchase-gate.js";
import { monthsToMs } from "../utils/format.js";
import type { Subscription } from "@prisma/client";
import {
  assertServerlessPlanAllowed,
  fulfillAfterPaid,
  getServerlessPricingConfig,
  isServerlessCategory,
  isServerlessEnabled,
  resolveServerlessPrice,
  SERVERLESS_CATEGORY,
  snapServerlessGb,
} from "./serverless.js";

export async function createMatrixOrder(input: {
  userId: string;
  trafficGb: number | null;
  months: number;
  accountName: string;
  kind?: OrderKind;
  targetSubId?: string;
  paymentMethod?: PaymentMethod;
  quantity?: number;
  category?: string;
  limitIp?: number;
  note?: string | null;
  /** Admin renew of any account — skip ownership/eligibility checks */
  forceRenew?: boolean;
  /** Optional discount code (creator-scoped / shareable / admin-global) */
  discountCode?: string | null;
  /** Prefer exact price cell (offer cards with same GB/months) */
  priceCellId?: string | null;
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  const pricedUser = withEffectiveRole(user, user.telegramId);
  const kind = input.kind ?? OrderKind.new;

  if (!input.forceRenew) {
    await assertPurchasesAllowed(input.userId);
  }

  let category = (input.category as PlanCategory) || "data";
  let editTarget: Subscription | null = null;
  // عمده‌فروش (wholesale): فقط پلن‌های ثابت
  if (isWholesaleFixedRole(pricedUser.role) && kind === OrderKind.new) {
    category = WHOLESALE_FIXED_CATEGORY;
  }
  // پلن‌های عمده‌فروش فقط برای نقش عمده‌فروش (نه کاربر/همکار/همکار ویژه/ادمین)
  if (
    kind === OrderKind.new &&
    isWholesaleFixedCategory(category) &&
    !isWholesaleFixedRole(pricedUser.role)
  ) {
    throw new Error("پلن‌های عمده‌فروش فقط برای نقش عمده‌فروش قابل خرید است");
  }
  let panelServerId: string | null = null;
  let accountName = input.accountName;
  let orderUserId = user.id;
  const serverlessOn = await isServerlessEnabled();

  // When serverless mode is on, all new purchases use the dedicated plan catalog
  if (serverlessOn && kind === OrderKind.new) {
    category = SERVERLESS_CATEGORY;
  }
  if (serverlessOn && kind === OrderKind.new && isWholesaleFixedRole(pricedUser.role)) {
    throw new Error("در شرایط فعلی خرید عمده‌فروشی فعال نیست");
  }

  if (kind === OrderKind.renew || kind === OrderKind.edit || kind === OrderKind.renew_reserve) {
    if (!input.targetSubId) throw new Error("سرویس هدف مشخص نشده است");
    const target = await prisma.subscription.findFirst({
      where: input.forceRenew
        ? { id: input.targetSubId }
        : { id: input.targetSubId, userId: input.userId },
    });
    if (!target) throw new Error("سرویس پیدا نشد");
    if (target.isTest) throw new Error("سرویس تست قابل ویرایش/تمدید نیست");

    if (kind === OrderKind.renew && !input.forceRenew) {
      const eligibility = await checkRenewEligibility(target.id);
      if (!eligibility.ok) throw new Error(eligibility.message);
    }

    if (kind === OrderKind.edit) {
      if (target.startsOnConnect && !target.activatedAt && !input.forceRenew) {
        throw new Error("این سرویس هنوز فعال نشده؛ بعد از اولین اتصال می‌توانید ویرایش کنید.");
      }
      editTarget = target;
    }

    if (kind === OrderKind.renew_reserve) {
      if (target.startsOnConnect && !target.activatedAt && !input.forceRenew) {
        throw new Error("این سرویس هنوز فعال نشده؛ بعد از اولین اتصال می‌توانید رزرو تمدید بگذارید.");
      }
      if (!input.forceRenew) {
        const eligibility = await checkRenewEligibility(target.id);
        if (eligibility.ok) {
          throw new Error("این سرویس الان قابل تمدید فوری است؛ رزرو لازم نیست. از تمدید استفاده کنید.");
        }
      }
      const existingReserve = await prisma.order.findFirst({
        where: {
          targetSubId: target.id,
          kind: OrderKind.renew_reserve,
          status: {
            in: [
              OrderStatus.pending_payment,
              OrderStatus.awaiting_review,
              OrderStatus.reserved,
              OrderStatus.paid,
            ],
          },
        },
      });
      if (existingReserve) {
        throw new Error("برای این سرویس قبلاً یک رزرو تمدید ثبت شده است");
      }
    }

    if (target.serverless || serverlessOn) {
      category = SERVERLESS_CATEGORY;
    } else {
      category = await inferRenewCategory(target);
    }
    accountName = target.email;
    orderUserId = target.userId;
    if (target.serverless) {
      panelServerId = null;
    } else if (target.panelServerId) {
      panelServerId = target.panelServerId;
    } else if (!isDemoMode() && !serverlessOn) {
      const resolved = await resolvePanelForSubscription(target);
      panelServerId = resolved.panel?.id ?? null;
    }
  } else if (!isDemoMode() && !serverlessOn && !isServerlessCategory(category)) {
    const resolved = await resolvePanelForCategory(category);
    panelServerId = resolved.panel?.id ?? null;
  }

  if (kind === OrderKind.new) {
    accountName = assertValidAccountName(accountName);
  }

  // ——— Serverless formula plans (weekly months=0, or 1–2 months) ———
  if (serverlessOn && (kind === OrderKind.new || kind === OrderKind.renew || kind === OrderKind.edit || kind === OrderKind.renew_reserve)) {
    category = SERVERLESS_CATEGORY;
    const cfg = await getServerlessPricingConfig();
    const monthsRaw = Number(input.months);
    const months = monthsRaw <= 0 ? 0 : Math.min(2, Math.max(1, Math.floor(monthsRaw)));
    if (input.trafficGb == null) throw new Error("حجم سرویس مشخص نشده است");
    const trafficGb = snapServerlessGb(input.trafficGb, months, cfg);
    assertServerlessPlanAllowed(trafficGb, months, cfg);
    const priced = await resolveServerlessPrice(pricedUser, trafficGb, months);
    if (!priced) throw new Error("این ترکیب حجم/مدت قیمت‌گذاری نشده است");
    const defaultIp = await getDefaultLimitIp();
    const limitIp = !canEditLimitIp(pricedUser.role)
      ? defaultIp
      : input.limitIp === undefined
        ? defaultIp
        : Math.max(0, Math.min(10, Math.floor(input.limitIp)));
    const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
    const priceBefore = priced.price;
    const applied =
      !input.discountCode?.trim()
        ? null
        : await assertAndApplyDiscount({
            buyer: pricedUser,
            code: input.discountCode,
            price: priceBefore,
          });
    if (applied?.codeId) {
      await cancelOpenPendingForDiscount(orderUserId, applied.codeId);
    }
    const finalPrice = applied ? applied.priceAfter : priceBefore;
    const { resolveTenantIdOrPlatform } = await import("./tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    return prisma.order.create({
      data: {
        tenantId,
        userId: orderUserId,
        kind,
        trafficGb,
        months,
        quantity: 1,
        limitIp,
        note,
        panelServerId: null,
        price: finalPrice,
        discountCodeId: applied?.codeId ?? null,
        discountAmount: applied?.discountAmount ?? 0,
        priceBeforeDiscount: applied ? applied.priceBefore : null,
        accountName,
        customName: accountName,
        targetSubId: input.targetSubId,
        status: OrderStatus.pending_payment,
        paymentMethod: input.paymentMethod ?? PaymentMethod.card_to_card,
      },
      include: { user: true, targetSub: true, discountCode: true },
    });
  }

  let trafficGb = normalizePurchaseTraffic(category, input.trafficGb);
  let months = clampMonths(input.months);
  let offerLocked = isOfferCategory(category);
  let fixedSingle = isFixedSingleServiceCategory(category);
  let selectedCell: Awaited<ReturnType<typeof findPriceCell>> = null;

  if (input.priceCellId?.trim()) {
    selectedCell = await prisma.priceCell.findFirst({
      where: { id: input.priceCellId.trim(), active: true },
    });
    if (!selectedCell) throw new Error("پلن انتخاب‌شده پیدا نشد یا غیرفعال است");
    if (offerLocked && selectedCell.category !== "offer") {
      throw new Error("این پیشنهاد ویژه موجود نیست یا غیرفعال است");
    }
    if (isWholesaleFixedRole(pricedUser.role) && kind === OrderKind.new && !isWholesaleFixedCategory(selectedCell.category)) {
      throw new Error("عمده‌فروش فقط می‌تواند پلن‌های تعریف‌شده عمده‌فروشی را بخرد");
    }
    if (
      kind === OrderKind.new &&
      isWholesaleFixedCategory(selectedCell.category) &&
      !isWholesaleFixedRole(pricedUser.role)
    ) {
      throw new Error("پلن‌های عمده‌فروش فقط برای نقش عمده‌فروش قابل خرید است");
    }
    if (fixedSingle && !isOfferCategory(selectedCell.category) && selectedCell.category !== category) {
      // Allow locking via cell only when categories match (or offer)
      if (
        selectedCell.category !== "unlimited" &&
        selectedCell.category !== "national" &&
        !isWholesaleFixedCategory(selectedCell.category)
      ) {
        throw new Error("پلن انتخاب‌شده با دسته خرید هم‌خوان نیست");
      }
    }
    trafficGb = selectedCell.trafficGb;
    months = clampMonths(selectedCell.months);
    if (selectedCell.category === "offer") {
      category = "offer";
      offerLocked = true;
      fixedSingle = true;
    } else if (selectedCell.category === "unlimited") {
      category = "unlimited";
      trafficGb = null;
      fixedSingle = true;
    } else if (selectedCell.category === "national") {
      category = "national";
      fixedSingle = true;
    } else if (isWholesaleFixedCategory(selectedCell.category)) {
      category = WHOLESALE_FIXED_CATEGORY;
      fixedSingle = true;
    } else {
      category = selectedCell.category as PlanCategory;
    }
  } else if (offerLocked) {
    selectedCell = await findPriceCell(trafficGb, months, "offer");
    if (!selectedCell?.active) throw new Error("این پیشنهاد ویژه موجود نیست یا غیرفعال است");
  } else if (isWholesaleFixedRole(pricedUser.role) && kind === OrderKind.new) {
    throw new Error("برای خرید عمده‌فروشی باید یکی از پلن‌های ثابت را انتخاب کنید");
  } else if (fixedSingle && kind !== OrderKind.renew) {
    selectedCell = await findPriceCell(trafficGb, months, category);
    if (!selectedCell?.active) throw new Error("این پلن پیدا نشد یا قیمت‌گذاری نشده است");
  }

  const useCellPrice = Boolean(selectedCell && (offerLocked || (fixedSingle && kind !== OrderKind.renew)));
  const priced =
    useCellPrice && selectedCell
      ? pricedUser.role === "admin"
        ? { cell: selectedCell, price: 0, mode: "matrix" as const }
        : (() => {
            const price = priceFromCell(pricedUser.role, selectedCell);
            return price > 0 ? { cell: selectedCell, price, mode: "matrix" as const } : null;
          })()
      : await resolvePrice(pricedUser, trafficGb, months, category);
  if (!priced) throw new Error("این ترکیب حجم/مدت قیمت‌گذاری نشده است");

  /** Non-admin edit: only increases; charge delta vs current package. */
  let editDeltaPrice: number | null = null;
  if (kind === OrderKind.edit && editTarget && !input.forceRenew && pricedUser.role !== "admin") {
    const curGb = editTarget.trafficGb;
    if (curGb == null && trafficGb != null) {
      throw new Error("نمی‌توانید از نامحدود به حجم محدود کاهش دهید");
    }
    if (curGb != null && trafficGb != null && trafficGb + 1e-9 < curGb) {
      throw new Error("حجم جدید نمی‌تواند کمتر از حجم فعلی باشد");
    }
    const remainingMs = editTarget.expiresAt.getTime() - Date.now();
    const remainingMonths = Math.max(1, Math.ceil(remainingMs / monthsToMs(1)));
    if (months < remainingMonths) {
      throw new Error(
        `مدت جدید نمی‌تواند کوتاه‌تر از باقی‌مانده باشد (حداقل ${remainingMonths} ماه)`,
      );
    }
    const sameTraffic =
      (curGb == null && trafficGb == null) ||
      (curGb != null && trafficGb != null && Math.abs(curGb - trafficGb) < 1e-9);
    if (sameTraffic && months === remainingMonths) {
      throw new Error("برای ویرایش باید حجم یا مدت را افزایش دهید");
    }
    const oldPriced = await resolvePrice(pricedUser, curGb, remainingMonths, category);
    const newPriced = await resolvePrice(pricedUser, trafficGb, months, category);
    if (!oldPriced || !newPriced) throw new Error("این ترکیب قیمت‌گذاری نشده است");
    editDeltaPrice = Math.max(0, newPriced.price - oldPriced.price);
  }

  const quantity =
    kind === OrderKind.renew ||
    kind === OrderKind.edit ||
    kind === OrderKind.renew_reserve ||
    serverlessOn
      ? 1
      : Math.max(1, Math.min(50, input.quantity ?? 1));
  const defaultIp = await getDefaultLimitIp();
  const cellLimitIp =
    selectedCell && typeof selectedCell.limitIp === "number" && selectedCell.limitIp > 0
      ? Math.max(0, Math.min(10, Math.floor(selectedCell.limitIp)))
      : null;
  const baseLimitIp =
    cellLimitIp != null
      ? cellLimitIp
      : !canEditLimitIp(pricedUser.role)
        ? defaultIp
        : input.limitIp === undefined
          ? defaultIp
          : Math.max(0, Math.min(10, Math.floor(input.limitIp)));
  const limitIp = category === "unlimited" ? UNLIMITED_LIMIT_IP : baseLimitIp;
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;

  const priceBefore =
    editDeltaPrice != null ? editDeltaPrice : priced.price * (fixedSingle ? 1 : quantity);
  const applied =
    offerLocked ||
    isWholesaleFixedRole(pricedUser.role) ||
    isWholesaleFixedCategory(category) ||
    !input.discountCode?.trim()
      ? null
      : await assertAndApplyDiscount({
          buyer: pricedUser,
          code: input.discountCode,
          price: priceBefore,
        });
  if (applied?.codeId) {
    await cancelOpenPendingForDiscount(orderUserId, applied.codeId);
  }
  const finalPrice = applied ? applied.priceAfter : priceBefore;

  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  return prisma.order.create({
    data: {
      tenantId,
      userId: orderUserId,
      kind,
      trafficGb,
      months,
      quantity: fixedSingle ? 1 : quantity,
      limitIp: offerLocked ? defaultIp : limitIp,
      note,
      panelServerId,
      price: finalPrice,
      discountCodeId: applied?.codeId ?? null,
      discountAmount: applied?.discountAmount ?? 0,
      priceBeforeDiscount: applied ? applied.priceBefore : null,
      accountName,
      customName: accountName,
      targetSubId: input.targetSubId,
      status: OrderStatus.pending_payment,
      paymentMethod: input.paymentMethod ?? PaymentMethod.card_to_card,
    },
    include: { user: true, targetSub: true, discountCode: true },
  });
}

export async function createWalletChargeOrder(userId: string, amount: number) {
  const { assertPurchasesAllowed } = await import("./purchase-gate.js");
  await assertPurchasesAllowed(userId);
  const { assertWalletChargeMin } = await import("./negative-credit.js");
  await assertWalletChargeMin(userId, amount);
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  return prisma.order.create({
    data: {
      tenantId,
      userId,
      kind: OrderKind.wallet_charge,
      trafficGb: null,
      months: 0,
      price: Math.floor(amount),
      accountName: "wallet",
      status: OrderStatus.pending_payment,
      paymentMethod: PaymentMethod.card_to_card,
    },
    include: { user: true },
  });
}

/** Pay with wallet: debit then fulfill (panel provision or serverless queue) */
export async function payOrderWithWallet(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId, status: OrderStatus.pending_payment },
  });
  if (!order) throw new Error("سفارش پیدا نشد");
  if (order.kind === OrderKind.wallet_charge) {
    throw new Error("شارژ کیف پول باید کارت‌به‌کارت باشد");
  }

  if (order.price > 0) {
    await debitWallet(userId, order.price, `order:${order.id}`);
  }
  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentMethod: PaymentMethod.wallet,
      status: OrderStatus.paid,
    },
  });
  await recordDiscountUse(order.discountCodeId);
  const result = await fulfillAfterPaid(order.id);
  try {
    const { markUnsettledFromWalletPurchase } = await import("./negative-credit.js");
    await markUnsettledFromWalletPurchase(
      order.id,
      result && typeof result === "object" && "subscriptionId" in result
        ? (result as { subscriptionId: string; bulk?: Array<{ subscriptionId: string }> })
        : null,
    );
  } catch (err) {
    console.warn("[negative-credit] mark unsettled failed", order.id, err);
  }
  return result;
}

/** Admin complimentary create: mark paid without debit, then fulfill. */
export async function provisionAdminComplimentary(orderId: string, _adminUserId?: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, status: OrderStatus.pending_payment },
  });
  if (!order) throw new Error("سفارش پیدا نشد");
  if (order.kind === OrderKind.wallet_charge) {
    throw new Error("شارژ کیف پول باید کارت‌به‌کارت باشد");
  }
  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentMethod: PaymentMethod.wallet,
      status: OrderStatus.paid,
      adminNote:
        order.kind === OrderKind.renew
          ? "تمدید رایگان توسط ادمین"
          : order.kind === OrderKind.edit
            ? "ویرایش رایگان توسط ادمین"
            : order.kind === OrderKind.renew_reserve
              ? "رزرو تمدید رایگان توسط ادمین"
              : "ساخت رایگان توسط ادمین",
    },
  });
  await recordDiscountUse(order.discountCodeId);
  return fulfillAfterPaid(order.id);
}

export async function attachReceipt(orderId: string, userId: string, fileId: string, caption?: string) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
      status: { in: [OrderStatus.pending_payment, OrderStatus.awaiting_review] },
    },
  });
  if (!order) throw new Error("سفارش فعال برای ثبت رسید پیدا نشد");

  return prisma.order.update({
    where: { id: order.id },
    data: {
      receiptFileId: fileId,
      receiptText: caption ?? null,
      status: OrderStatus.awaiting_review,
    },
    include: { user: true, targetSub: true },
  });
}

/** Text-only receipt (e.g. crypto tx hash from bot/web). */
export async function attachTextReceipt(orderId: string, userId: string, receiptText: string) {
  const text = receiptText.trim().slice(0, 500);
  if (!text) throw new Error("متن رسید خالی است");
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
      status: { in: [OrderStatus.pending_payment, OrderStatus.awaiting_review] },
    },
  });
  if (!order) throw new Error("سفارش فعال برای ثبت رسید پیدا نشد");

  return prisma.order.update({
    where: { id: order.id },
    data: {
      receiptFileId: order.receiptFileId || "text",
      receiptText: text,
      status: OrderStatus.awaiting_review,
    },
    include: { user: true, targetSub: true },
  });
}

export async function findPendingPaymentOrder(userId: string) {
  return prisma.order.findFirst({
    where: {
      userId,
      status: OrderStatus.pending_payment,
      paymentMethod: { in: [PaymentMethod.card_to_card, PaymentMethod.crypto] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function setOrderPaymentMethod(orderId: string, userId: string, method: PaymentMethod) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId, status: OrderStatus.pending_payment },
  });
  if (!order) throw new Error("سفارش پیدا نشد");
  return prisma.order.update({
    where: { id: order.id },
    data: { paymentMethod: method },
  });
}

export async function getOrderForAdmin(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, subscription: true, targetSub: true, discountCode: true },
  });
}

export async function rejectOrder(orderId: string, note: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.rejected,
      adminNote: note,
    },
    include: { user: true },
  });
}

export async function markPaid(orderId: string) {
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing) throw new Error("سفارش پیدا نشد");
  if (
    existing.status === OrderStatus.paid ||
    existing.status === OrderStatus.reserved ||
    existing.status === OrderStatus.awaiting_delivery ||
    existing.status === OrderStatus.provisioning ||
    existing.status === OrderStatus.completed
  ) {
    return existing;
  }
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.paid },
  });
  await recordDiscountUse(order.discountCodeId);
  return order;
}

export function orderSummaryText(order: {
  trafficGb: number | null;
  months: number;
  price: number;
  accountName?: string | null;
  kind?: OrderKind;
  quantity?: number;
  limitIp?: number;
  discountAmount?: number;
  priceBeforeDiscount?: number | null;
  discountCode?: { code: string; percentOff: number } | null;
}) {
  if (order.kind === OrderKind.wallet_charge) {
    return [`نوع: ➕ شارژ کیف پول`, `مبلغ: ${order.price.toLocaleString("fa-IR")} تومان`].join("\n");
  }
  const qty = order.quantity ?? 1;
  const kindLabel =
    order.kind === OrderKind.renew
      ? "تمدید"
      : order.kind === OrderKind.edit
        ? "ویرایش اشتراک"
        : order.kind === OrderKind.renew_reserve
          ? "رزرو تمدید"
          : order.kind === OrderKind.add_days
            ? `افزایش ${order.months} روز`
            : order.kind === OrderKind.add_gb
              ? `افزایش ${order.trafficGb ?? 0} گیگ`
              : order.kind === OrderKind.rotate_sub
                ? "تغییر لینک ساب"
                : order.kind === OrderKind.rotate_uuid
                  ? "تغییر لینک کانفیگ"
                  : qty > 1
                    ? "خرید عمده (Bulk)"
                    : "خرید جدید";
  const vol =
    order.kind === OrderKind.add_days
      ? `${order.months} روز`
      : order.kind === OrderKind.add_gb
        ? `${order.trafficGb ?? 0} گیگ (اضافه)`
        : order.trafficGb === null
          ? "نامحدود"
          : `${order.trafficGb} گیگ`;
  const durationLine =
    order.kind === OrderKind.add_days || order.kind === OrderKind.add_gb
      ? ""
      : order.months <= 0
        ? "مدت: هفتگی"
        : `مدت: ${order.months} ماه`;
  const ip =
    order.limitIp === undefined
      ? ""
      : order.limitIp <= 0
        ? "محدودیت کاربر: نامحدود"
        : `محدودیت کاربر: ${order.limitIp} کاربر`;
  const discountLines: string[] = [];
  if (order.discountAmount && order.discountAmount > 0) {
    const code = order.discountCode?.code;
    discountLines.push(
      code
        ? `تخفیف (${code} ${order.discountCode?.percentOff ?? ""}٪): −${order.discountAmount.toLocaleString("fa-IR")} تومان`
        : `تخفیف: −${order.discountAmount.toLocaleString("fa-IR")} تومان`,
    );
    if (order.priceBeforeDiscount != null) {
      discountLines.push(`قبل از تخفیف: ${order.priceBeforeDiscount.toLocaleString("fa-IR")} تومان`);
    }
  }
  return [
    `نوع: ${kindLabel}`,
    `حجم: ${vol}`,
    durationLine,
    order.kind === OrderKind.add_days || order.kind === OrderKind.add_gb ? "" : `تعداد: ${qty}`,
    ip,
    order.accountName ? `نام پایه: ${order.accountName}` : "",
    ...discountLines,
    `مبلغ کل: ${order.price.toLocaleString("fa-IR")} تومان`,
  ]
    .filter(Boolean)
    .join("\n");
}
