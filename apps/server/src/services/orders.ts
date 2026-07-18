import { OrderStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "../db.js";
import { priceForUser } from "./users.js";

export async function listActivePlans() {
  return prisma.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createCardOrder(userId: string, planId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = await prisma.plan.findFirst({
    where: { id: planId, active: true },
  });
  if (!plan) throw new Error("پلن یافت نشد");

  const price = priceForUser(user, plan);

  return prisma.order.create({
    data: {
      userId: user.id,
      planId: plan.id,
      price,
      status: OrderStatus.pending_payment,
      paymentMethod: PaymentMethod.card_to_card,
    },
    include: { plan: true, user: true },
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
    include: { plan: true, user: true },
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
    include: { plan: true },
  });
}

export async function getOrderForAdmin(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: true, user: true, subscription: true },
  });
}

export async function rejectOrder(orderId: string, note: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.rejected,
      adminNote: note,
    },
    include: { user: true, plan: true },
  });
}

export async function markPaid(orderId: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.paid },
  });
}
