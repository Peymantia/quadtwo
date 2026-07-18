import { OrderKind, OrderStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "../db.js";
import { resolvePrice } from "./pricing.js";

export async function createMatrixOrder(input: {
  userId: string;
  trafficGb: number | null;
  months: number;
  accountName: string;
  kind?: OrderKind;
  targetSubId?: string;
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  const priced = await resolvePrice(user, input.trafficGb, input.months);
  if (!priced) throw new Error("این ترکیب حجم/مدت قیمت‌گذاری نشده است");

  return prisma.order.create({
    data: {
      userId: user.id,
      kind: input.kind ?? OrderKind.new,
      trafficGb: input.trafficGb,
      months: input.months,
      price: priced.price,
      accountName: input.accountName,
      customName: input.accountName,
      targetSubId: input.targetSubId,
      status: OrderStatus.pending_payment,
      paymentMethod: PaymentMethod.card_to_card,
    },
    include: { user: true, targetSub: true },
  });
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
}) {
  const vol = order.trafficGb === null ? "نامحدود" : `${order.trafficGb} گیگ`;
  const kindLabel =
    order.kind === OrderKind.renew
      ? "تمدید"
      : order.kind === OrderKind.rotate_sub
        ? "تغییر لینک ساب"
        : order.kind === OrderKind.rotate_uuid
          ? "تغییر لینک کانفیگ"
          : "خرید جدید";
  return [
    `نوع: ${kindLabel}`,
    `حجم: ${vol}`,
    `مدت: ${order.months} ماه`,
    order.accountName ? `نام اکانت: ${order.accountName}` : "",
    `مبلغ: ${order.price.toLocaleString("fa-IR")} تومان`,
  ]
    .filter(Boolean)
    .join("\n");
}
