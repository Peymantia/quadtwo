import { OrderKind, OrderStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "../db.js";
import { resolvePanelForCategory, resolvePanelForSubscription } from "./panel-servers.js";
import { checkRenewEligibility, inferRenewCategory } from "./renew-eligibility.js";
import { canEditLimitIp, getDefaultLimitIp } from "./settings.js";
import { clampMonths, normalizePurchaseTraffic, resolvePrice, isOfferCategory, findPriceCell, priceFromCell, type PlanCategory } from "./pricing.js";
import { debitWallet } from "./wallet.js";
import { provisionOrder } from "./provision.js";
import { withEffectiveRole } from "./demo-role.js";
import { isDemoMode } from "./license.js";
import { assertAndApplyDiscount, recordDiscountUse, cancelOpenPendingForDiscount } from "./discount-codes.js";

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

  let category = (input.category as PlanCategory) || "data";
  let panelServerId: string | null = null;
  let accountName = input.accountName;
  let orderUserId = user.id;

  if (kind === OrderKind.renew) {
    if (!input.targetSubId) throw new Error("سرویس هدف برای تمدید مشخص نشده است");
    const target = await prisma.subscription.findFirst({
      where: input.forceRenew
        ? { id: input.targetSubId }
        : { id: input.targetSubId, userId: input.userId },
    });
    if (!target) throw new Error("سرویس برای تمدید پیدا نشد");
    if (!input.forceRenew) {
      const eligibility = await checkRenewEligibility(target.id);
      if (!eligibility.ok) throw new Error(eligibility.message);
    }
    category = await inferRenewCategory(target);
    accountName = target.email;
    orderUserId = target.userId;
    if (target.panelServerId) {
      panelServerId = target.panelServerId;
    } else if (!isDemoMode()) {
      const resolved = await resolvePanelForSubscription(target);
      panelServerId = resolved.panel?.id ?? null;
    }
  } else if (!isDemoMode()) {
    const resolved = await resolvePanelForCategory(category);
    panelServerId = resolved.panel?.id ?? null;
  }

  let trafficGb = normalizePurchaseTraffic(category, input.trafficGb);
  let months = clampMonths(input.months);
  let offerLocked = isOfferCategory(category);
  let selectedCell: Awaited<ReturnType<typeof findPriceCell>> = null;

  if (input.priceCellId?.trim()) {
    selectedCell = await prisma.priceCell.findFirst({
      where: { id: input.priceCellId.trim(), active: true },
    });
    if (!selectedCell) throw new Error("پلن انتخاب‌شده پیدا نشد یا غیرفعال است");
    if (offerLocked && selectedCell.category !== "offer") {
      throw new Error("این پیشنهاد ویژه موجود نیست یا غیرفعال است");
    }
    trafficGb = selectedCell.trafficGb;
    months = clampMonths(selectedCell.months);
    if (selectedCell.category === "offer") {
      category = "offer";
      offerLocked = true;
    } else if (selectedCell.category === "unlimited") {
      category = "unlimited";
      trafficGb = null;
    } else {
      category = selectedCell.category as PlanCategory;
    }
  } else if (offerLocked) {
    selectedCell = await findPriceCell(trafficGb, months, "offer");
    if (!selectedCell?.active) throw new Error("این پیشنهاد ویژه موجود نیست یا غیرفعال است");
  }

  const priced =
    selectedCell && offerLocked
      ? pricedUser.role === "admin"
        ? { cell: selectedCell, price: 0, mode: "matrix" as const }
        : (() => {
            const price = priceFromCell(pricedUser.role, selectedCell);
            return price > 0 ? { cell: selectedCell, price, mode: "matrix" as const } : null;
          })()
      : await resolvePrice(pricedUser, trafficGb, months, category);
  if (!priced) throw new Error("این ترکیب حجم/مدت قیمت‌گذاری نشده است");
  const quantity = kind === OrderKind.renew ? 1 : Math.max(1, Math.min(50, input.quantity ?? 1));
  const defaultIp = await getDefaultLimitIp();
  const limitIp = !canEditLimitIp(pricedUser.role)
    ? defaultIp
    : input.limitIp === undefined
      ? defaultIp
      : Math.max(0, Math.min(10, Math.floor(input.limitIp)));
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;

  const priceBefore = priced.price * (offerLocked ? 1 : quantity);
  const applied =
    offerLocked || !input.discountCode?.trim()
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

  return prisma.order.create({
    data: {
      userId: orderUserId,
      kind,
      trafficGb,
      months,
      quantity: offerLocked ? 1 : quantity,
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
  if (amount < 10_000) throw new Error("حداقل شارژ ۱۰٬۰۰۰ تومان است");
  return prisma.order.create({
    data: {
      userId,
      kind: OrderKind.wallet_charge,
      trafficGb: null,
      months: 0,
      price: amount,
      accountName: "wallet",
      status: OrderStatus.pending_payment,
      paymentMethod: PaymentMethod.card_to_card,
    },
    include: { user: true },
  });
}

/** Pay with wallet: debit then provision immediately */
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
  return provisionOrder(order.id);
}

/** Admin complimentary create: mark paid without debit, then provision. */
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
      adminNote: order.kind === OrderKind.renew ? "تمدید رایگان توسط ادمین" : "ساخت رایگان توسط ادمین",
    },
  });
  await recordDiscountUse(order.discountCodeId);
  return provisionOrder(order.id);
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
    order.kind === OrderKind.add_days || order.kind === OrderKind.add_gb || !(order.months > 0)
      ? ""
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
