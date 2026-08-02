import { OrderKind, OrderStatus, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { formatToman, persianMonthName, startOfPersianMonth } from "../utils/format.js";

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

export type SalesPeriod = "today" | "week" | "month" | "jalali_month" | "all";

export const SALES_PERIODS: SalesPeriod[] = ["today", "week", "month", "jalali_month", "all"];

export function parseSalesPeriod(raw: string | undefined | null): SalesPeriod {
  const p = (raw || "week").trim() as SalesPeriod;
  return SALES_PERIODS.includes(p) ? p : "week";
}

export function periodSince(period: SalesPeriod): Date | null {
  if (period === "all") return null;
  if (period === "today") return startOfDay();
  if (period === "week") return daysAgo(7);
  if (period === "month") return daysAgo(30);
  return startOfPersianMonth();
}

export function periodLabel(period: SalesPeriod): string {
  if (period === "today") return "امروز";
  if (period === "week") return "۷ روز اخیر";
  if (period === "month") return "۳۰ روز اخیر";
  if (period === "jalali_month") return `ماه ${persianMonthName()}`;
  return "از ابتدا";
}

export type SalesRecentRow = {
  id: string;
  kind: string;
  price: number;
  at: string;
  who: string | null;
  accountName: string | null;
  email: string | null;
  botSubId: string | null;
  trafficGb: number | null;
};

export type SalesTopDiscount = {
  code: string;
  uses: number;
  saved: number;
};

export type SalesStats = {
  period: SalesPeriod;
  periodLabel: string;
  since: string | null;
  total: number;
  count: number;
  newCount: number;
  renewCount: number;
  avgOrder: number;
  walletChargeTotal: number;
  walletChargeCount: number;
  activeSubs: number;
  /** Sum of discountAmount on completed orders */
  discountTotal: number;
  discountOrderCount: number;
  topDiscountCodes: SalesTopDiscount[];
  recent: SalesRecentRow[];
  text: string;
};

export type AgentSalesRow = {
  id: string;
  telegramId: string;
  username: string | null;
  name: string | null;
  agentName: string | null;
  group: string | null;
  orders: number;
  sales: number;
  newCount: number;
  renewCount: number;
  activeSubs: number;
};

function whoLabel(u: {
  username: string | null;
  firstName: string | null;
  telegramId: bigint;
  agentName?: string | null;
}): string {
  if (u.username) return `@${u.username}`;
  if (u.agentName) return u.agentName;
  if (u.firstName) return u.firstName;
  return String(u.telegramId);
}

/**
 * Sales stats for one seller (partner/wholesale/admin self) or global (userId = null).
 */
export async function buildSalesStats(opts: {
  userId?: string | null;
  period: SalesPeriod;
  recentLimit?: number;
  /** Include wallet_charge aggregates (usually admin-only) */
  includeWallet?: boolean;
  title?: string;
}): Promise<SalesStats> {
  const period = opts.period;
  const since = periodSince(period);
  const recentLimit = opts.recentLimit ?? 12;
  const includeWallet = opts.includeWallet !== false && !opts.userId;

  const orderWhere = {
    status: OrderStatus.completed,
    excludedFromSales: false,
    kind: { in: [OrderKind.new, OrderKind.renew] as OrderKind[] },
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(since ? { updatedAt: { gte: since } } : {}),
  };

  const [orders, activeSubs, walletAgg] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      include: {
        user: { select: { username: true, firstName: true, telegramId: true, agentName: true } },
        targetSub: { select: { id: true, email: true, title: true, trafficGb: true } },
        subscription: { select: { id: true, email: true, title: true, trafficGb: true } },
        discountCode: { select: { code: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.subscription.count({
      where: {
        status: "active",
        ...(opts.userId ? { userId: opts.userId } : {}),
      },
    }),
    includeWallet
      ? prisma.order.aggregate({
          where: {
            status: OrderStatus.completed,
            kind: OrderKind.wallet_charge,
            ...(since ? { updatedAt: { gte: since } } : {}),
          },
          _sum: { price: true },
          _count: true,
        })
      : Promise.resolve({ _sum: { price: null as number | null }, _count: 0 }),
  ]);

  const total = orders.reduce((s, o) => s + o.price, 0);
  const newCount = orders.filter((o) => o.kind === OrderKind.new).length;
  const renewCount = orders.filter((o) => o.kind === OrderKind.renew).length;
  const avgOrder = orders.length ? Math.round(total / orders.length) : 0;
  const walletChargeTotal = walletAgg._sum.price ?? 0;
  const walletChargeCount = typeof walletAgg._count === "number" ? walletAgg._count : 0;
  const discounted = orders.filter((o) => (o.discountAmount ?? 0) > 0);
  const discountTotal = discounted.reduce((s, o) => s + (o.discountAmount ?? 0), 0);
  const discountOrderCount = discounted.length;
  const codeAgg = new Map<string, { uses: number; saved: number }>();
  for (const o of discounted) {
    const code = o.discountCode?.code || "—";
    const cur = codeAgg.get(code) ?? { uses: 0, saved: 0 };
    cur.uses += 1;
    cur.saved += o.discountAmount ?? 0;
    codeAgg.set(code, cur);
  }
  const topDiscountCodes: SalesTopDiscount[] = [...codeAgg.entries()]
    .map(([code, v]) => ({ code, uses: v.uses, saved: v.saved }))
    .sort((a, b) => b.saved - a.saved || b.uses - a.uses)
    .slice(0, 5);

  const recent: SalesRecentRow[] = orders.slice(0, recentLimit).map((o) => {
    const linked = o.targetSub ?? o.subscription;
    const email = linked?.email ?? (o.accountName && o.accountName !== "renew" && o.accountName !== "wallet" ? o.accountName : null);
    return {
      id: o.id,
      kind: o.kind,
      price: o.price,
      at: o.updatedAt.toISOString(),
      who: opts.userId ? null : whoLabel(o.user),
      accountName: linked?.title || o.accountName || email,
      email,
      botSubId: linked?.id ?? null,
      trafficGb: linked?.trafficGb ?? o.trafficGb ?? null,
    };
  });

  const label = periodLabel(period);
  const title = opts.title ?? (opts.userId ? "گزارش فروش شما" : "گزارش فروش");
  const lines = [
    `📈 ${title} — ${label}`,
    "",
    `تعداد سفارش تکمیل‌شده: ${orders.length.toLocaleString("fa-IR")}`,
    `  • خرید جدید: ${newCount.toLocaleString("fa-IR")}`,
    `  • تمدید: ${renewCount.toLocaleString("fa-IR")}`,
    `جمع فروش: ${formatToman(total)}`,
    orders.length ? `میانگین سفارش: ${formatToman(avgOrder)}` : "",
    discountOrderCount
      ? `تخفیف اعمال‌شده: ${discountOrderCount.toLocaleString("fa-IR")} سفارش · ${formatToman(discountTotal)}`
      : "",
    topDiscountCodes.length
      ? `پرکاربردترین کدها: ${topDiscountCodes.map((c) => `${c.code}(${c.uses})`).join(" · ")}`
      : "",
    `سرویس فعال: ${activeSubs.toLocaleString("fa-IR")}`,
  ].filter(Boolean);

  if (includeWallet) {
    lines.push(
      `شارژ کیف پول: ${walletChargeCount.toLocaleString("fa-IR")} مورد · ${formatToman(walletChargeTotal)}`,
    );
  }

  lines.push("", recent.length ? "آخرین سفارش‌ها:" : "سفارشی در این بازه نیست.");
  for (const o of recent) {
    const kindFa = o.kind === "renew" ? "تمدید" : "خرید";
    const acct = o.email || o.accountName;
    const who = o.who ? ` — ${o.who}` : "";
    const acctPart = acct ? ` · ${acct}` : "";
    lines.push(`• ${kindFa} ${formatToman(o.price)}${who}${acctPart}`);
  }

  return {
    period,
    periodLabel: label,
    since: since?.toISOString() ?? null,
    total,
    count: orders.length,
    newCount,
    renewCount,
    avgOrder,
    walletChargeTotal,
    walletChargeCount,
    activeSubs,
    discountTotal,
    discountOrderCount,
    topDiscountCodes,
    recent,
    text: lines.join("\n"),
  };
}

/** @deprecated prefer buildSalesStats — kept for older callers */
export async function adminSalesReport(period: "today" | "week" | "month") {
  return buildSalesStats({ userId: null, period, includeWallet: true });
}

export async function agentsSalesLeaderboard(opts: {
  role: "partner" | "wholesale" | "reseller";
  period: SalesPeriod;
}): Promise<{ period: SalesPeriod; periodLabel: string; rows: AgentSalesRow[]; text: string }> {
  const since = periodSince(opts.period);
  const role =
    opts.role === "wholesale"
      ? UserRole.wholesale
      : opts.role === "reseller"
        ? UserRole.reseller
        : UserRole.partner;
  const users = await prisma.user.findMany({
    where: { role },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      agentName: true,
      panelGroup: true,
      orders: {
        where: {
          status: OrderStatus.completed,
          excludedFromSales: false,
          kind: { in: [OrderKind.new, OrderKind.renew] },
          ...(since ? { updatedAt: { gte: since } } : {}),
        },
        select: { price: true, kind: true },
      },
      subscriptions: {
        where: { status: "active" },
        select: { id: true },
      },
    },
  });

  const rows: AgentSalesRow[] = users
    .map((u) => {
      const sales = u.orders.reduce((s, o) => s + o.price, 0);
      return {
        id: u.id,
        telegramId: String(u.telegramId),
        username: u.username,
        name: u.firstName,
        agentName: u.agentName,
        group: u.panelGroup,
        orders: u.orders.length,
        sales,
        newCount: u.orders.filter((o) => o.kind === OrderKind.new).length,
        renewCount: u.orders.filter((o) => o.kind === OrderKind.renew).length,
        activeSubs: u.subscriptions.length,
      };
    })
    .sort((a, b) => b.sales - a.sales || b.orders - a.orders);

  const title =
    opts.role === "wholesale" ? "عمده‌فروش‌ها" : opts.role === "reseller" ? "همکاران ویژه" : "همکاران";
  const label = periodLabel(opts.period);
  const lines = [
    `📊 گزارش فروش ${title} — ${label}`,
    "",
    ...(rows.length
      ? rows.slice(0, 40).map((r) => {
          const who = r.username ? `@${r.username}` : r.agentName || r.telegramId;
          return `• ${who} — ${r.orders.toLocaleString("fa-IR")} سفارش · ${formatToman(r.sales)} · ${r.activeSubs.toLocaleString("fa-IR")} فعال`;
        })
      : ["موردی نیست."]),
  ];

  return {
    period: opts.period,
    periodLabel: label,
    rows,
    text: lines.join("\n"),
  };
}

/** @deprecated use agentsSalesLeaderboard */
export async function partnerSalesReport(role: "partner" | "wholesale" | "reseller") {
  const { rows } = await agentsSalesLeaderboard({ role, period: "all" });
  return rows.map((r) => ({
    id: r.id,
    telegramId: r.telegramId,
    username: r.username,
    name: r.name,
    group: r.group,
    orders: r.orders,
    sales: r.sales,
    subs: r.activeSubs,
  }));
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
