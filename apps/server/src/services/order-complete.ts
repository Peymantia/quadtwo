import { OrderStatus } from "@prisma/client";
import { prisma } from "../db.js";

/** Mark order completed and stamp completedAt for sales reports (never use updatedAt). */
export async function markOrderCompleted(orderId: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.completed,
      completedAt: new Date(),
    },
  });
}

/**
 * One-shot backfill: completed orders without completedAt ← createdAt
 * so «فروش امروز» is not inflated by panel reassign/sync touching updatedAt.
 */
export async function backfillOrderCompletedAt(): Promise<number> {
  try {
    const r = await prisma.$executeRawUnsafe(
      `UPDATE "Order" SET "completedAt" = "createdAt" WHERE status = 'completed' AND "completedAt" IS NULL`,
    );
    return typeof r === "number" ? r : 0;
  } catch (err) {
    console.warn("backfillOrderCompletedAt raw SQL failed, falling back", err);
    const rows = await prisma.order.findMany({
      where: { status: OrderStatus.completed, completedAt: null },
      select: { id: true, createdAt: true },
      take: 5000,
    });
    for (const row of rows) {
      await prisma.order.update({
        where: { id: row.id },
        data: { completedAt: row.createdAt },
      });
    }
    return rows.length;
  }
}
