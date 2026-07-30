/**
 * After re-adding Order.price / months / status (accidentally dropped), heal row defaults.
 *
 * Usage (from repo root, with DATABASE_URL set):
 *   npx tsx apps/server/scripts/heal-order-columns.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OrderStatus, PrismaClient } from "@prisma/client";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    include: {
      subscription: { select: { id: true } },
      user: { select: { id: true, telegramId: true } },
    },
  });
  const txs = await prisma.walletTransaction.findMany({
    where: {
      OR: [{ note: { startsWith: "order:" } }, { note: { startsWith: "charge:" } }],
    },
    select: { note: true, amount: true },
  });
  const priceByOrderId = new Map<string, number>();
  for (const tx of txs) {
    const note = tx.note ?? "";
    const m = /^(?:order|charge):(.+)$/.exec(note);
    if (!m) continue;
    const id = m[1]!;
    const amt = Math.abs(tx.amount);
    if (amt > 0) priceByOrderId.set(id, amt);
  }

  let statusFixed = 0;
  let priceFixed = 0;

  for (const o of orders) {
    const data: { status?: OrderStatus; price?: number } = {};

    if (o.subscription) {
      if (o.status !== OrderStatus.completed) {
        data.status = OrderStatus.completed;
      }
    } else if (o.kind === "wallet_charge" && priceByOrderId.has(o.id)) {
      if (o.status !== OrderStatus.completed) {
        data.status = OrderStatus.completed;
      }
    } else if (o.receiptFileId || o.receiptText) {
      if (o.status === OrderStatus.pending_payment) {
        data.status = OrderStatus.awaiting_review;
      }
    }

    if (!o.price || o.price <= 0) {
      const fromWallet = priceByOrderId.get(o.id);
      if (fromWallet && fromWallet > 0) {
        data.price = fromWallet;
      } else if (o.priceBeforeDiscount != null && o.priceBeforeDiscount > 0) {
        data.price = Math.max(0, o.priceBeforeDiscount - (o.discountAmount ?? 0));
      }
    }

    if (Object.keys(data).length === 0) continue;
    await prisma.order.update({ where: { id: o.id }, data });
    if (data.status) statusFixed += 1;
    if (data.price != null) priceFixed += 1;
    console.log(
      `healed ${o.id.slice(-8)} kind=${o.kind}` +
        (data.status ? ` status→${data.status}` : "") +
        (data.price != null ? ` price→${data.price}` : ""),
    );
  }

  console.log(`Done. status fixed: ${statusFixed}, price fixed: ${priceFixed}, total orders: ${orders.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
