import { Hono } from "hono";
import { OrderKind, UserRole } from "@prisma/client";
import { signSession } from "../auth/telegram.js";
import { prisma } from "../db.js";
import {
  issueOtpForUser,
  loginWithPassword,
  requestLoginOtp,
  setUserPassword,
  verifyLoginOtp,
  verifyPassword,
} from "../services/web-auth.js";
import {
  createMatrixOrder,
  createWalletChargeOrder,
  getOrderForAdmin,
  markPaid,
  orderSummaryText,
  payOrderWithWallet,
  rejectOrder,
} from "../services/orders.js";
import { deactivateCell, listPriceMatrix, upsertPriceCell, type PlanCategory } from "../services/pricing.js";
import { provisionOrder, rotateSubId, rotateUuid } from "../services/provision.js";
import {
  getCategoryLabels,
  getMaxPurchaseMonths,
  getPaymentCard,
  getSalesCategories,
  getSetting,
  listEnabledSalesCategories,
  saveCategoryLabels,
  saveSalesCategories,
  setSetting,
  getAllSettings,
} from "../services/settings.js";
import { adjustWallet, getWallet } from "../services/wallet.js";
import { claimTestService } from "../services/test-service.js";
import { approvePartner, rejectPartner, submitPartnerRequest } from "../services/users.js";
import { formatTraffic, formatToman } from "../utils/format.js";
import { adminSalesReport, searchUsersAndOrders } from "../services/admin-reports.js";
import { listConfigGroups, listConfigsForGroup, deleteConfig } from "../services/admin-configs.js";
import {
  listPanelServers,
  createPanelServer,
  updatePanelServer,
  testPanelConnection,
  getPanelServer,
} from "../services/panel-servers.js";
import { listRecentAudit, auditLog } from "../services/audit.js";
import { lookupConfigByLinkOrUuid } from "../services/config-lookup.js";
import { importWorkbook, readWorkbookFromBuffer, formatImportResult } from "../services/bulk-import.js";
import { dashBaseUrl, env } from "../config/env.js";

type Vars = { userId: string; role: string; telegramId: string };

/** Fire-and-forget Telegram notification (plain text). */
async function notifyTelegram(chatId: bigint, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text }),
    });
  } catch {
    /* best-effort */
  }
}

async function sessionForUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await signSession({
    userId: user.id,
    telegramId: String(user.telegramId),
    role: user.role,
  });
  return {
    token,
    user: {
      id: user.id,
      role: user.role,
      firstName: user.firstName,
      username: user.username,
      telegramId: String(user.telegramId),
      panelGroup: user.panelGroup,
      agentName: user.agentName,
      hasPassword: Boolean(user.passwordHash),
    },
  };
}

export function registerDashAuthRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/auth/meta", async (c) => {
    const brand = await getSetting("brand_name");
    return c.json({
      brand: brand || "Piing",
      dashUrl: dashBaseUrl(),
      authModes: ["password", "otp"],
    });
  });

  api.post("/auth/password/login", async (c) => {
    const body = await c.req.json<{ login?: string; password?: string }>();
    if (!body.login || !body.password) return c.json({ error: "login و password لازم است" }, 400);
    const result = await loginWithPassword(body.login, body.password);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return c.json(await sessionForUser(result.userId));
  });

  api.post("/auth/otp/request", async (c) => {
    const body = await c.req.json<{ login?: string }>();
    if (!body.login) return c.json({ error: "login لازم است" }, 400);
    const result = await requestLoginOtp(body.login);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, hint: result.hint });
  });

  api.post("/auth/otp/verify", async (c) => {
    const body = await c.req.json<{ login?: string; code?: string }>();
    if (!body.login || !body.code) return c.json({ error: "login و code لازم است" }, 400);
    const result = await verifyLoginOtp(body.login, body.code);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return c.json(await sessionForUser(result.userId));
  });
}

export function registerDashMeRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/me/home", async (c) => {
    const userId = c.get("userId");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const wallet = await getWallet(userId);
    const subs = await prisma.subscription.count({ where: { userId } });
    const active = await prisma.subscription.count({ where: { userId, status: "active" } });
    const brand = await getSetting("brand_name");
    const support = await getSetting("support_username");
    return c.json({
      brand: brand || "Piing",
      support,
      user: {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        username: user.username,
        telegramId: String(user.telegramId),
        panelGroup: user.panelGroup,
        agentName: user.agentName,
        hasPassword: Boolean(user.passwordHash),
        testClaimed: Boolean(user.testClaimedAt),
      },
      wallet: { balance: wallet.balance },
      stats: { subscriptions: subs, active },
    });
  });

  api.post("/me/password", async (c) => {
    const body = await c.req.json<{ password?: string; currentPassword?: string }>();
    if (!body.password) return c.json({ error: "password لازم است" }, 400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    if (user.passwordHash) {
      if (!body.currentPassword || !verifyPassword(body.currentPassword, user.passwordHash)) {
        return c.json({ error: "رمز فعلی نادرست است" }, 400);
      }
    }
    try {
      await setUserPassword(user.id, body.password);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
    await auditLog({
      action: "web_password_set",
      actorTelegramId: user.telegramId,
      target: user.id,
    });
    return c.json({ ok: true });
  });

  api.get("/me/wallet", async (c) => {
    const wallet = await getWallet(c.get("userId"));
    const txs = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return c.json({ balance: wallet.balance, txs });
  });

  api.get("/me/subscriptions", async (c) => {
    const subs = await prisma.subscription.findMany({
      where: { userId: c.get("userId") },
      orderBy: { createdAt: "desc" },
    });
    return c.json({
      subscriptions: subs.map((s) => ({
        id: s.id,
        code: s.code,
        email: s.email,
        title: s.title,
        note: s.note,
        trafficLabel: formatTraffic(s.trafficGb),
        trafficGb: s.trafficGb,
        expiresAt: s.expiresAt.toISOString(),
        subUrl: s.subUrl,
        status: s.status,
        isTest: s.isTest,
      })),
    });
  });

  api.patch("/me/subscriptions/:id/note", async (c) => {
    const body = await c.req.json<{ note?: string | null }>();
    const note = body.note?.trim() ? body.note.trim().slice(0, 500) : null;
    const updated = await prisma.subscription.updateMany({
      where: { id: c.req.param("id"), userId: c.get("userId") },
      data: { note },
    });
    if (!updated.count) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true, note });
  });

  api.post("/me/subscriptions/:id/rotate-sub", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const result = await rotateSubId(sub.id);
    return c.json({ code: result.code, subUrl: result.subUrl, expiresAt: result.expiresAt.toISOString() });
  });

  api.post("/me/subscriptions/:id/rotate-uuid", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const result = await rotateUuid(sub.id);
    return c.json({ code: result.code, subUrl: result.subUrl, expiresAt: result.expiresAt.toISOString() });
  });

  api.post("/me/orders/:id/pay-wallet", async (c) => {
    try {
      const result = await payOrderWithWallet(c.req.param("id"), c.get("userId"));
      return c.json({ ok: true, result });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/test", async (c) => {
    try {
      const sub = await claimTestService(c.get("userId"));
      return c.json({
        ok: true,
        subscription: {
          code: sub.code,
          email: sub.email,
          subUrl: sub.subUrl,
          expiresHint: sub.expiresHint,
        },
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/me/catalog", async (c) => {
    const cats = await listEnabledSalesCategories();
    const labels = await getCategoryLabels();
    const maxMonths = await getMaxPurchaseMonths();
    const cells = await listPriceMatrix();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    return c.json({
      categories: cats,
      categoryLabels: labels,
      maxMonths,
      cells: cells
        .filter((cell) => cell.active && cell.months <= maxMonths)
        .filter((cell) => cats.includes(cell.category as "data" | "national" | "unlimited"))
        .map((cell) => ({
          id: cell.id,
          category: cell.category,
          trafficGb: cell.trafficGb,
          months: cell.months,
          title: cell.title,
          isGolden: cell.isGolden,
          price:
            user.role === "wholesale"
              ? cell.priceWholesale
              : user.role === "partner" || user.role === "admin"
                ? cell.pricePartner
                : cell.priceUser,
        })),
    });
  });

  api.get("/me/orders", async (c) => {
    const orders = await prisma.order.findMany({
      where: { userId: c.get("userId") },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return c.json({
      orders: orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        price: o.price,
        trafficGb: o.trafficGb,
        months: o.months,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  });

  api.post("/me/wallet/charge", async (c) => {
    const body = await c.req.json<{ amount?: number; note?: string }>();
    const amount = Math.floor(Number(body.amount ?? 0));
    if (!amount || amount < 10_000) return c.json({ error: "حداقل شارژ ۱۰٬۰۰۰ تومان است" }, 400);
    try {
      const order = await createWalletChargeOrder(c.get("userId"), amount);
      // Dashboard flow: receipt info is text-only; goes straight to admin review
      await prisma.order.update({
        where: { id: order.id },
        data: {
          receiptText: body.note?.trim() ? body.note.trim().slice(0, 500) : "درخواست شارژ از داشبورد وب",
          status: "awaiting_review",
        },
      });
      const card = await getPaymentCard();
      await auditLog({
        action: "web_wallet_charge_request",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: order.id,
        detail: String(amount),
      });
      return c.json({ order: { id: order.id, price: order.price }, card });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/orders", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      accountName?: string;
      kind?: OrderKind;
      targetSubId?: string;
      payWithWallet?: boolean;
    }>();
    const accountName = body.accountName?.trim() || `u${Date.now().toString(36)}`;
    const order = await createMatrixOrder({
      userId: c.get("userId"),
      trafficGb: body.trafficGb,
      months: body.months,
      accountName,
      kind: body.kind,
      targetSubId: body.targetSubId,
    });
    if (body.payWithWallet) {
      try {
        const result = await payOrderWithWallet(order.id, c.get("userId"));
        return c.json({ order: { id: order.id, price: order.price }, provisioned: result });
      } catch (err) {
        return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
      }
    }
    const card = await getPaymentCard();
    return c.json({
      order: {
        id: order.id,
        price: order.price,
        summary: orderSummaryText(order),
        trafficGb: order.trafficGb,
        months: order.months,
      },
      card,
    });
  });

  api.post("/me/partner-request", async (c) => {
    const body = await c.req.json<{ fullName: string; phone?: string; note?: string }>();
    const req = await submitPartnerRequest(c.get("userId"), body.fullName, body.phone, body.note);
    return c.json({ id: req.id, status: req.status });
  });

  api.get("/me/guide", async (c) => {
    const keys = ["guide_ios", "guide_android", "guide_windows", "guide_mac", "guide_text", "support_username"];
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = await getSetting(k);
    return c.json({ guide: out });
  });

  api.post("/me/lookup", async (c) => {
    const body = await c.req.json<{ input?: string }>();
    if (!body.input) return c.json({ error: "input لازم است" }, 400);
    return c.json(await lookupConfigByLinkOrUuid(body.input));
  });
}

export function registerDashPartnerRoutes(api: Hono<{ Variables: Vars }>) {
  api.use("/partner/*", async (c, next) => {
    const role = c.get("role");
    if (role !== "partner" && role !== "wholesale" && role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });

  api.get("/partner/home", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const orders = await prisma.order.findMany({
      where: {
        userId: user.id,
        status: "completed",
        kind: { in: ["new", "renew"] },
        updatedAt: { gte: since },
      },
    });
    const sales = orders.reduce((s, o) => s + o.price, 0);
    return c.json({
      agentName: user.agentName,
      panelGroup: user.panelGroup,
      role: user.role,
      report: {
        period: "30d",
        orders: orders.length,
        sales,
        salesLabel: formatToman(sales),
      },
    });
  });

  api.get("/partner/configs", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    if (!user.panelGroup) return c.json({ items: [], total: 0, title: "بدون گروه" });
    const groups = await listConfigGroups();
    const mine = groups.find((g) => g.panelGroup === user.panelGroup);
    if (!mine) return c.json({ items: [], total: 0, title: user.panelGroup });
    return c.json(await listConfigsForGroup(mine.key, 0, 100));
  });

  api.post("/partner/create", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      accountName?: string;
      payWithWallet?: boolean;
    }>();
    const order = await createMatrixOrder({
      userId: c.get("userId"),
      trafficGb: body.trafficGb,
      months: body.months ?? 1,
      accountName: body.accountName?.trim() || `p${Date.now().toString(36)}`,
      kind: OrderKind.new,
    });
    if (body.payWithWallet) {
      try {
        const result = await payOrderWithWallet(order.id, c.get("userId"));
        return c.json({ order: { id: order.id, price: order.price }, provisioned: result });
      } catch (err) {
        return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
      }
    }
    const card = await getPaymentCard();
    return c.json({
      order: { id: order.id, price: order.price, summary: orderSummaryText(order) },
      card,
    });
  });
}

export function registerDashAdminRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/admin/home", async (c) => {
    const pending = await prisma.order.count({ where: { status: "awaiting_review" } });
    const users = await prisma.user.count();
    const activeSubs = await prisma.subscription.count({ where: { status: "active" } });
    const sales = await adminSalesReport("today");
    return c.json({
      pendingOrders: pending,
      users,
      activeSubs,
      salesToday: { total: sales.total, count: sales.count, label: formatToman(sales.total) },
    });
  });

  api.get("/admin/reports/sales", async (c) => {
    const period = (c.req.query("period") as "today" | "week" | "month") || "week";
    return c.json(await adminSalesReport(period));
  });

  api.get("/admin/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const result = await searchUsersAndOrders(q);
    await auditLog({
      action: "admin_search",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: q.slice(0, 80),
    });
    return c.json({
      users: result.users.map((u) => ({
        id: u.id,
        telegramId: String(u.telegramId),
        username: u.username,
        role: u.role,
        balance: u.wallet?.balance ?? 0,
        orders: u._count.orders,
        subscriptions: u._count.subscriptions,
      })),
      orders: result.orders.map((o) => ({
        id: o.id,
        status: o.status,
        kind: o.kind,
        price: o.price,
        accountName: o.accountName,
        user: o.user.username ? `@${o.user.username}` : String(o.user.telegramId),
      })),
    });
  });

  api.get("/admin/audit", async (c) => {
    const rows = await listRecentAudit(50);
    return c.json({
      logs: rows.map((r) => ({
        id: r.id,
        action: r.action,
        target: r.target,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
        actorTelegramId: r.actorTelegramId != null ? String(r.actorTelegramId) : null,
      })),
    });
  });

  api.get("/admin/orders/pending", async (c) => {
    const orders = await prisma.order.findMany({
      where: { status: { in: ["awaiting_review", "pending_payment"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: true },
    });
    return c.json({
      orders: orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        price: o.price,
        summary: orderSummaryText(o),
        receiptText: o.receiptText,
        createdAt: o.createdAt.toISOString(),
        user: {
          username: o.user.username,
          telegramId: String(o.user.telegramId),
          firstName: o.user.firstName,
        },
      })),
    });
  });

  api.post("/admin/orders/:id/approve", async (c) => {
    const orderId = c.req.param("id");
    const order = await getOrderForAdmin(orderId);
    if (!order) return c.json({ error: "سفارش پیدا نشد" }, 404);
    if (order.status === "completed") return c.json({ error: "قبلاً تکمیل شده" }, 400);
    try {
      await markPaid(orderId);
      await auditLog({
        action: "order_approved",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: orderId,
      });
      const result = await provisionOrder(orderId);
      if ("kind" in result && result.kind === "wallet_credit") {
        await notifyTelegram(
          order.user.telegramId,
          `✅ کیف پول شارژ شد\nموجودی: ${formatToman(result.balance)}`,
        );
        return c.json({ ok: true, walletBalance: result.balance });
      }
      const prov = result as { code: string; subUrl: string | null };
      await notifyTelegram(
        order.user.telegramId,
        `✅ سفارش شما تأیید شد\nکد: ${prov.code}${prov.subUrl ? `\nلینک اشتراک:\n${prov.subUrl}` : ""}`,
      );
      return c.json({ ok: true, code: prov.code, subUrl: prov.subUrl });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/orders/:id/reject", async (c) => {
    const body = await c.req.json<{ note?: string }>().catch(() => ({ note: undefined }));
    const order = await rejectOrder(c.req.param("id"), body.note?.trim() || "رد شده توسط ادمین");
    await auditLog({
      action: "order_rejected",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: order.id,
    });
    await notifyTelegram(order.user.telegramId, `❌ سفارش شما رد شد.\n${body.note?.trim() || ""}`.trim());
    return c.json({ ok: true });
  });

  api.get("/admin/prices", async (c) => {
    const cells = await prisma.priceCell.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { months: "asc" }, { trafficGb: "asc" }],
    });
    return c.json({
      cells: cells.map((x) => ({
        id: x.id,
        title: x.title,
        category: x.category,
        trafficGb: x.trafficGb,
        months: x.months,
        priceUser: x.priceUser,
        pricePartner: x.pricePartner,
        priceWholesale: x.priceWholesale,
        isGolden: x.isGolden,
      })),
    });
  });

  api.post("/admin/prices", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      priceUser: number;
      pricePartner: number;
      priceWholesale?: number;
      category?: PlanCategory;
      isGolden?: boolean;
      title?: string;
    }>();
    if (!Number.isFinite(body.months) || body.months < 1) return c.json({ error: "ماه نامعتبر" }, 400);
    const cell = await upsertPriceCell(body);
    await auditLog({
      action: "web_price_upsert",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: cell.id,
    });
    return c.json({ ok: true, id: cell.id });
  });

  api.put("/admin/prices/:id", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const data: Record<string, unknown> = {};
    for (const k of ["title", "priceUser", "pricePartner", "priceWholesale", "isGolden", "trafficGb", "months", "category"]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    await prisma.priceCell.update({ where: { id: c.req.param("id") }, data });
    return c.json({ ok: true });
  });

  api.delete("/admin/prices/:id", async (c) => {
    await deactivateCell(c.req.param("id"));
    await auditLog({
      action: "web_price_delete",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: c.req.param("id"),
    });
    return c.json({ ok: true });
  });

  /** Bulk price edit: percent or fixed amount, per role columns, optional category filter. */
  api.post("/admin/prices/bulk", async (c) => {
    const body = await c.req.json<{
      category?: string;
      mode: "percent" | "amount";
      value: number;
      fields?: Array<"priceUser" | "pricePartner" | "priceWholesale">;
      roundTo?: number;
    }>();
    const fields = body.fields?.length ? body.fields : (["priceUser", "pricePartner", "priceWholesale"] as const);
    const value = Number(body.value);
    if (!Number.isFinite(value) || value === 0) return c.json({ error: "مقدار نامعتبر" }, 400);
    const roundTo = Math.max(1, Math.floor(body.roundTo ?? 1000));
    const cells = await prisma.priceCell.findMany({
      where: { active: true, ...(body.category ? { category: body.category } : {}) },
    });
    let updated = 0;
    for (const cell of cells) {
      const data: Record<string, number> = {};
      for (const f of fields) {
        const cur = cell[f];
        const next =
          body.mode === "percent" ? cur + (cur * value) / 100 : cur + value;
        data[f] = Math.max(0, Math.round(next / roundTo) * roundTo);
      }
      await prisma.priceCell.update({ where: { id: cell.id }, data });
      updated++;
    }
    await auditLog({
      action: "web_price_bulk",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: `${body.mode}:${value} cat:${body.category ?? "all"} n:${updated}`,
    });
    return c.json({ ok: true, updated });
  });

  api.get("/admin/categories", async (c) => {
    const enabled = await getSalesCategories();
    const labels = await getCategoryLabels();
    const counts = await prisma.priceCell.groupBy({
      by: ["category"],
      where: { active: true },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((x) => [x.category, x._count._all]));
    return c.json({
      categories: (["data", "national", "unlimited"] as const).map((key) => ({
        key,
        label: labels[key],
        enabled: enabled[key],
        cellCount: countMap.get(key) ?? 0,
      })),
    });
  });

  api.put("/admin/categories/:key", async (c) => {
    const key = c.req.param("key") as "data" | "national" | "unlimited";
    if (!["data", "national", "unlimited"].includes(key)) return c.json({ error: "دسته نامعتبر" }, 400);
    const body = await c.req.json<{ label?: string; enabled?: boolean }>();
    if (body.label?.trim()) {
      const labels = await getCategoryLabels();
      labels[key] = body.label.trim().slice(0, 40);
      await saveCategoryLabels(labels);
    }
    if (typeof body.enabled === "boolean") {
      const cats = await getSalesCategories();
      cats[key] = body.enabled;
      await saveSalesCategories(cats);
    }
    return c.json({ ok: true });
  });

  /** "Delete" a category: disable sales + deactivate all its price cells. */
  api.delete("/admin/categories/:key", async (c) => {
    const key = c.req.param("key") as "data" | "national" | "unlimited";
    if (!["data", "national", "unlimited"].includes(key)) return c.json({ error: "دسته نامعتبر" }, 400);
    const cats = await getSalesCategories();
    cats[key] = false;
    await saveSalesCategories(cats);
    const res = await prisma.priceCell.updateMany({
      where: { category: key, active: true },
      data: { active: false },
    });
    await auditLog({
      action: "web_category_delete",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: key,
      detail: `deactivated:${res.count}`,
    });
    return c.json({ ok: true, deactivated: res.count });
  });

  api.get("/admin/sales-categories", async (c) => c.json({ categories: await getSalesCategories() }));

  api.put("/admin/sales-categories", async (c) => {
    const body = await c.req.json<{ data?: boolean; national?: boolean; unlimited?: boolean }>();
    const cats = await getSalesCategories();
    if (typeof body.data === "boolean") cats.data = body.data;
    if (typeof body.national === "boolean") cats.national = body.national;
    if (typeof body.unlimited === "boolean") cats.unlimited = body.unlimited;
    await saveSalesCategories(cats);
    return c.json({ categories: cats });
  });

  api.get("/admin/configs/groups", async (c) => c.json({ groups: await listConfigGroups() }));

  api.get("/admin/configs/:groupKey", async (c) => {
    const page = Number(c.req.query("page") ?? 0);
    return c.json(await listConfigsForGroup(c.req.param("groupKey"), page, 30));
  });

  api.post("/admin/configs/delete", async (c) => {
    const body = await c.req.json<{ email: string; subId?: string | null }>();
    const result = await deleteConfig({ email: body.email, subId: body.subId });
    await auditLog({
      action: "admin_config_delete",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: body.email,
    });
    return c.json(result);
  });

  api.get("/admin/panels", async (c) => {
    const panels = await listPanelServers();
    return c.json({
      panels: panels.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        hasToken: Boolean(p.apiToken),
        inboundIds: p.inboundIds,
        subBase: p.subBase,
        categories: p.categories,
        weight: p.weight,
        active: p.active,
        sellEnabled: p.sellEnabled,
      })),
    });
  });

  api.post("/admin/panels", async (c) => {
    const body = await c.req.json<{
      name: string;
      baseUrl: string;
      apiToken: string;
      inboundIds?: string;
      subBase?: string | null;
      categories?: ("data" | "national" | "unlimited")[];
      weight?: number;
    }>();
    const p = await createPanelServer(body);
    return c.json({ id: p.id });
  });

  api.put("/admin/panels/:id", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Parameters<typeof updatePanelServer>[1] = {};
    for (const k of ["name", "baseUrl", "apiToken", "inboundIds", "subBase", "weight", "active", "sellEnabled"] as const) {
      if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
    }
    if (body.categories) patch.categories = body.categories as ("data" | "national" | "unlimited")[];
    await updatePanelServer(c.req.param("id"), patch);
    return c.json({ ok: true });
  });

  api.post("/admin/panels/:id/test", async (c) => {
    const panel = await getPanelServer(c.req.param("id"));
    if (!panel) return c.json({ error: "Not found" }, 404);
    try {
      return c.json(await testPanelConnection(panel));
    } catch (err) {
      return c.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/import", async (c) => {
    const buf = Buffer.from(await c.req.arrayBuffer());
    const result = await importWorkbook(readWorkbookFromBuffer(buf));
    return c.json({ result, text: formatImportResult(result) });
  });

  api.get("/admin/users", async (c) => {
    const role = c.req.query("role");
    const users = await prisma.user.findMany({
      where: role ? { role: role as UserRole } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { wallet: true },
    });
    return c.json({
      users: users.map((u) => ({
        id: u.id,
        telegramId: String(u.telegramId),
        username: u.username,
        firstName: u.firstName,
        role: u.role,
        agentName: u.agentName,
        panelGroup: u.panelGroup,
        balance: u.wallet?.balance ?? 0,
        hasPassword: Boolean(u.passwordHash),
      })),
    });
  });

  api.get("/admin/users/:id", async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.req.param("id") },
      include: {
        wallet: { include: { txs: { orderBy: { createdAt: "desc" }, take: 20 } } },
        subscriptions: { orderBy: { createdAt: "desc" }, take: 20 },
        orders: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!user) return c.json({ error: "کاربر پیدا نشد" }, 404);
    return c.json({
      user: {
        id: user.id,
        telegramId: String(user.telegramId),
        username: user.username,
        firstName: user.firstName,
        role: user.role,
        agentName: user.agentName,
        panelGroup: user.panelGroup,
        balance: user.wallet?.balance ?? 0,
        createdAt: user.createdAt.toISOString(),
      },
      txs: (user.wallet?.txs ?? []).map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
      subscriptions: user.subscriptions.map((s) => ({
        id: s.id,
        code: s.code,
        email: s.email,
        status: s.status,
        trafficGb: s.trafficGb,
        expiresAt: s.expiresAt.toISOString(),
      })),
      orders: user.orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        price: o.price,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  });

  api.post("/admin/users/:id/role", async (c) => {
    const body = await c.req.json<{ role: UserRole }>();
    if (!["user", "partner", "wholesale", "admin"].includes(body.role)) {
      return c.json({ error: "نقش نامعتبر" }, 400);
    }
    const target = await prisma.user.findUnique({ where: { id: c.req.param("id") } });
    if (!target) return c.json({ error: "کاربر پیدا نشد" }, 404);
    await prisma.user.update({ where: { id: target.id }, data: { role: body.role } });
    await auditLog({
      action: "web_role_change",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: target.id,
      detail: `${target.role} -> ${body.role}`,
    });
    return c.json({ ok: true });
  });

  /** Manual wallet adjustment: positive = credit, negative = debit. */
  api.post("/admin/users/:id/wallet", async (c) => {
    const body = await c.req.json<{ amount?: number; note?: string }>();
    const amount = Math.trunc(Number(body.amount ?? 0));
    if (!amount) return c.json({ error: "مبلغ نامعتبر" }, 400);
    try {
      const balance = await adjustWallet(c.req.param("id"), amount, body.note?.trim() || undefined);
      await auditLog({
        action: "web_wallet_adjust",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: c.req.param("id"),
        detail: String(amount),
      });
      const target = await prisma.user.findUnique({ where: { id: c.req.param("id") } });
      if (target) {
        await notifyTelegram(
          target.telegramId,
          amount > 0
            ? `💳 کیف پول شما ${formatToman(amount)} شارژ شد.\nموجودی: ${formatToman(balance)}`
            : `💳 ${formatToman(-amount)} از کیف پول شما کسر شد.\nموجودی: ${formatToman(balance)}`,
        );
      }
      return c.json({ ok: true, balance });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/settings", async (c) => c.json({ settings: await getAllSettings() }));

  api.put("/admin/settings", async (c) => {
    const body = await c.req.json<Record<string, string>>();
    for (const [k, v] of Object.entries(body)) {
      await setSetting(k, String(v));
    }
    return c.json({ ok: true, settings: await getAllSettings() });
  });

  api.post("/admin/partners/:id/approve", async (c) => {
    const req = await approvePartner(c.req.param("id"));
    return c.json({ ok: true, group: req.user.panelGroup });
  });

  api.post("/admin/partners/:id/reject", async (c) => {
    await rejectPartner(c.req.param("id"));
    return c.json({ ok: true });
  });
}

export async function mintOtpPayloadForTelegramUser(telegramId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) throw new Error("کاربر یافت نشد — /start بزنید");
  const code = await issueOtpForUser(user.id);
  return { code, login: user.username ? `@${user.username}` : String(user.telegramId) };
}
