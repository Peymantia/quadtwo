import { OrderKind, OrderStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "../db.js";
import { resolvePanelForCategory, resolvePanelForSubscription } from "./panel-servers.js";
import { canEditLimitIp, getDefaultLimitIp } from "./settings.js";
import { clampMonths, normalizePurchaseTraffic, resolvePrice, type PlanCategory } from "./pricing.js";
import { debitWallet } from "./wallet.js";
import { provisionOrder } from "./provision.js";

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
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  const category = (input.category as PlanCategory) || "data";
  const trafficGb = normalizePurchaseTraffic(category, input.trafficGb);
  const months = clampMonths(input.months);
  const priced = await resolvePrice(user, trafficGb, months, category);
  if (!priced) throw new Error("این ترکیب حجم/مدت قیمت‌گذاری نشده است");
  const quantity = Math.max(1, Math.min(50, input.quantity ?? 1));
  const defaultIp = await getDefaultLimitIp();
  const limitIp = !canEditLimitIp(user.role)
    ? defaultIp
    : input.limitIp === undefined
      ? defaultIp
      : Math.max(0, Math.min(10, Math.floor(input.limitIp)));
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;

  const kind = input.kind ?? OrderKind.new;
  let panelServerId: string | null = null;

  if (kind === OrderKind.renew && input.targetSubId) {
    const target = await prisma.subscription.findUnique({ where: { id: input.targetSubId } });
    if (target?.panelServerId) {
      panelServerId = target.panelServerId;
    } else if (target) {
      const resolved = await resolvePanelForSubscription(target);
      panelServerId = resolved.panel?.id ?? null;
    }
  } else if (kind === OrderKind.new || !input.targetSubId) {
    const resolved = await resolvePanelForCategory(category);
    panelServerId = resolved.panel?.id ?? null;
  }

  return prisma.order.create({
    data: {
      userId: user.id,
      kind,
      trafficGb,
      months,
      quantity,
      limitIp,
      note,
      panelServerId,
      price: priced.price * quantity,
      accountName: input.accountName,
      customName: input.accountName,
      targetSubId: input.targetSubId,
      status: OrderStatus.pending_payment,
      paymentMethod: input.paymentMethod ?? PaymentMethod.card_to_card,
    },
    include: { user: true, targetSub: true },
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

  await debitWallet(userId, order.price, `order:${order.id}`);
  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentMethod: PaymentMethod.wallet,
      status: OrderStatus.paid,
    },
  });
  return provisionOrder(order.id);
}

/** Admin complimentary create: mark paid without debit, then provision. */
export async function provisionAdminComplimentary(orderId: string, adminUserId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: adminUserId, status: OrderStatus.pending_payment },
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
      adminNote: "ساخت رایگان توسط ادمین",
    },
  });
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

export async function findPendingPaymentOrder(userId: string) {
  return prisma.order.findFirst({
    where: {
      userId,
      status: OrderStatus.pending_payment,
      paymentMethod: PaymentMethod.card_to_card,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrderForAdmin(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, subscription: true, targetSub: true },
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
  return prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.paid },
  });
}

export function orderSummaryText(order: {
  trafficGb: number | null;
  months: number;
  price: number;
  accountName?: string | null;
  kind?: OrderKind;
  quantity?: number;
  limitIp?: number;
}) {
  if (order.kind === OrderKind.wallet_charge) {
    return [`نوع: ➕ شارژ کیف پول`, `مبلغ: ${order.price.toLocaleString("fa-IR")} تومان`].join("\n");
  }
  const qty = order.quantity ?? 1;
  const vol = order.trafficGb === null ? "نامحدود" : `${order.trafficGb} گیگ`;
  const kindLabel =
    order.kind === OrderKind.renew
      ? "تمدید"
      : order.kind === OrderKind.rotate_sub
        ? "تغییر لینک ساب"
        : order.kind === OrderKind.rotate_uuid
          ? "تغییر لینک کانفیگ"
          : qty > 1
            ? "خرید عمده (Bulk)"
            : "خرید جدید";
  const ip =
    order.limitIp === undefined
      ? ""
      : order.limitIp <= 0
        ? "محدودیت کاربر: نامحدود"
        : `محدودیت کاربر: ${order.limitIp} کاربر`;
  return [
    `نوع: ${kindLabel}`,
    `حجم: ${vol}`,
    order.months > 0 ? `مدت: ${order.months} ماه` : "",
    `تعداد: ${qty}`,
    ip,
    order.accountName ? `نام پایه: ${order.accountName}` : "",
    `مبلغ کل: ${order.price.toLocaleString("fa-IR")} تومان`,
  ]
    .filter(Boolean)
    .join("\n");
}
