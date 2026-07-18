import { OrderStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { formatToman } from "../utils/format.js";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number) {
  const x = startOfDay();
  x.setDate(x.getDate() - n);
  return x;
}

export type SalesPeriod = "today" | "week" | "month";

export async function adminSalesReport(period: SalesPeriod) {
  const since =
    period === "today" ? startOfDay() : period === "week" ? daysAgo(7) : daysAgo(30);

  const orders = await prisma.order.findMany({
    where: {
      status: OrderStatus.completed,
      kind: { in: ["new", "renew"] },
      updatedAt: { gte: since },
    },
    include: { user: true },
    orderBy: { updatedAt: "desc" },
  });

  const total = orders.reduce((s, o) => s + o.price, 0);
  const byKind = {
    new: orders.filter((o) => o.kind === "new").length,
    renew: orders.filter((o) => o.kind === "renew").length,
  };
  const walletCharges = await prisma.order.aggregate({
    where: {
      status: OrderStatus.completed,
      kind: "wallet_charge",
      updatedAt: { gte: since },
    },
    _sum: { price: true },
    _count: true,
  });

  const label = period === "today" ? "امروز" : period === "week" ? "۷ روز اخیر" : "۳۰ روز اخیر";

  const lines = [
    `📈 گزارش فروش — ${label}`,
    "",
    `تعداد سفارش تکمیل‌شده: ${orders.length}`,
    `  • خرید جدید: ${byKind.new}`,
    `  • تمدید: ${byKind.renew}`,
    `جمع فروش: ${formatToman(total)}`,
    `شارژ کیف پول: ${walletCharges._count} مورد · ${formatToman(walletCharges._sum.price ?? 0)}`,
    "",
    orders.length ? "آخرین سفارش‌ها:" : "سفارشی در این بازه نیست.",
    ...orders.slice(0, 12).map((o) => {
      const who = o.user.username ? `@${o.user.username}` : o.user.firstName || String(o.user.telegramId);
      return `• ${o.kind === "renew" ? "تمدید" : "خرید"} ${formatToman(o.price)} — ${who}`;
    }),
  ];

  return { text: lines.join("\n"), total, count: orders.length };
}

export async function searchUsersAndOrders(query: string) {
  const q = query.trim().replace(/^@/, "");
  if (!q) return { users: [], orders: [] };

  const asBig = /^\d+$/.test(q) ? BigInt(q) : null;

  const users = await prisma.user.findMany({
    where: {
      OR: [
        ...(asBig !== null ? [{ telegramId: asBig }] : []),
        { username: { contains: q } },
        { firstName: { contains: q } },
        { id: q },
      ],
    },
    take: 10,
    include: {
      _count: { select: { orders: true, subscriptions: true } },
      wallet: true,
    },
  });

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { id: { contains: q } },
        { accountName: { contains: q } },
        ...(asBig !== null
          ? [{ user: { telegramId: asBig } }]
          : [{ user: { username: { contains: q } } }]),
      ],
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return { users, orders };
}

export function formatSearchResults(result: Awaited<ReturnType<typeof searchUsersAndOrders>>) {
  const { users, orders } = result;
  if (!users.length && !orders.length) {
    return "نتیجه‌ای پیدا نشد.\nآی‌دی عددی تلگرام، یوزرنیم، یا بخشی از شناسه سفارش را بفرستید.";
  }

  const lines = ["🔍 نتیجه جستجو", ""];

  if (users.length) {
    lines.push("👤 کاربران:");
    for (const u of users) {
      const name = u.username ? `@${u.username}` : u.firstName || "—";
      const bal = u.wallet?.balance ?? 0;
      lines.push(
        `• ${name} · TG ${u.telegramId} · ${u.role}`,
        `  سفارش: ${u._count.orders} · سرویس: ${u._count.subscriptions} · کیف: ${formatToman(bal)}`,
      );
    }
    lines.push("");
  }

  if (orders.length) {
    lines.push("🧾 سفارش‌ها:");
    for (const o of orders) {
      const who = o.user.username ? `@${o.user.username}` : String(o.user.telegramId);
      lines.push(
        `• …${o.id.slice(-10)} · ${o.status} · ${o.kind} · ${formatToman(o.price)}`,
        `  ${who}${o.accountName ? ` · ${o.accountName}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}
