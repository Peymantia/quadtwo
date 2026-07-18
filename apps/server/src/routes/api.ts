import { Hono } from "hono";
import { cors } from "hono/cors";
import { OrderKind } from "@prisma/client";
import { parseAndValidateInitData, signSession, verifySession } from "../auth/telegram.js";
import { prisma } from "../db.js";
import { createMatrixOrder, orderSummaryText } from "../services/orders.js";
import { listPriceMatrix, resolvePrice } from "../services/pricing.js";
import { provisionOrder, rotateSubId, rotateUuid } from "../services/provision.js";
import { getAllSettings, getPaymentCard, getSetting, setSetting } from "../services/settings.js";
import { approvePartner, rejectPartner, submitPartnerRequest, upsertUserFromTelegram } from "../services/users.js";
import { formatTraffic } from "../utils/format.js";

type Vars = { userId: string; role: string; telegramId: string };

export function createApiApp() {
  const api = new Hono<{ Variables: Vars }>();

  api.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  api.post("/auth/telegram", async (c) => {
    const body = await c.req.json<{ initData?: string }>();
    if (!body.initData) return c.json({ error: "initData required" }, 400);
    const tg = parseAndValidateInitData(body.initData);
    const user = await upsertUserFromTelegram({
      id: tg.id,
      username: tg.username,
      first_name: tg.first_name,
      last_name: tg.last_name,
    });
    const token = await signSession({
      userId: user.id,
      telegramId: String(user.telegramId),
      role: user.role,
    });
    return c.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        username: user.username,
        panelGroup: user.panelGroup,
      },
    });
  });

  api.use("/me/*", async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
    try {
      const payload = await verifySession(header.slice(7));
      c.set("userId", payload.userId);
      c.set("role", payload.role);
      c.set("telegramId", payload.telegramId);
      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  });

  api.use("/admin/*", async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
    try {
      const payload = await verifySession(header.slice(7));
      if (payload.role !== "admin") return c.json({ error: "Forbidden" }, 403);
      c.set("userId", payload.userId);
      c.set("role", payload.role);
      c.set("telegramId", payload.telegramId);
      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  });

  api.get("/me/profile", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const brand = await getSetting("brand_name");
    const support = await getSetting("support_username");
    return c.json({
      user: {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        username: user.username,
        panelGroup: user.panelGroup,
      },
      brand,
      support,
    });
  });

  api.get("/me/pricing", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const cells = await listPriceMatrix();
    return c.json({
      cells: cells.map((cell) => ({
        trafficGb: cell.trafficGb,
        months: cell.months,
        price: user.role === "partner" || user.role === "admin" ? cell.pricePartner : cell.priceUser,
        priceUser: cell.priceUser,
        pricePartner: cell.pricePartner,
      })),
    });
  });

  api.post("/me/quote", async (c) => {
    const body = await c.req.json<{ trafficGb: number | null; months: number }>();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const priced = await resolvePrice(user, body.trafficGb, body.months);
    if (!priced) return c.json({ price: null });
    return c.json({ price: priced.price });
  });

  api.post("/me/orders", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      accountName?: string;
      kind?: OrderKind;
      targetSubId?: string;
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

  api.post("/me/orders/:id/receipt", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ receiptText?: string; receiptFileId?: string }>();
    const order = await prisma.order.updateMany({
      where: { id, userId: c.get("userId") },
      data: {
        receiptText: body.receiptText ?? "uploaded-via-miniapp",
        receiptFileId: body.receiptFileId ?? "miniapp",
        status: "awaiting_review",
      },
    });
    if (!order.count) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
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
        trafficLabel: formatTraffic(s.trafficGb),
        expiresAt: s.expiresAt.toISOString(),
        subUrl: s.subUrl,
        status: s.status,
      })),
    });
  });

  api.post("/me/subscriptions/:id/rotate-sub", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const result = await rotateSubId(sub.id);
    return c.json({
      code: result.code,
      subUrl: result.subUrl,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  api.post("/me/subscriptions/:id/rotate-uuid", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const result = await rotateUuid(sub.id);
    return c.json({
      code: result.code,
      subUrl: result.subUrl,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  api.post("/me/partner-request", async (c) => {
    const body = await c.req.json<{ fullName: string; phone?: string; note?: string }>();
    const req = await submitPartnerRequest(c.get("userId"), body.fullName, body.phone, body.note);
    return c.json({ id: req.id, status: req.status });
  });

  api.get("/admin/orders/pending", async (c) => {
    const orders = await prisma.order.findMany({
      where: { status: "awaiting_review" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    return c.json({
      orders: orders.map((o) => ({
        id: o.id,
        price: o.price,
        summary: orderSummaryText(o),
        user: { username: o.user.username, telegramId: String(o.user.telegramId) },
      })),
    });
  });

  api.post("/admin/orders/:id/approve", async (c) => {
    const id = c.req.param("id");
    await prisma.order.update({ where: { id }, data: { status: "paid" } });
    const result = await provisionOrder(id);
    if ("kind" in result && result.kind === "wallet_credit") {
      return c.json({ type: "wallet_credit", balance: result.balance });
    }
    return c.json({
      type: "subscription",
      code: result.code,
      subUrl: result.subUrl,
      email: result.email,
    });
  });

  api.post("/admin/orders/:id/reject", async (c) => {
    await prisma.order.update({
      where: { id: c.req.param("id") },
      data: { status: "rejected", adminNote: "rejected via miniapp" },
    });
    return c.json({ ok: true });
  });

  api.get("/admin/matrix", async (c) => {
    const cells = await listPriceMatrix();
    return c.json({ cells });
  });

  api.put("/admin/matrix", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      priceUser: number;
      pricePartner: number;
    }>();
    const { upsertPriceCell } = await import("../services/pricing.js");
    const cell = await upsertPriceCell(body);
    return c.json({ cell });
  });

  api.get("/admin/settings", async (c) => c.json({ settings: await getAllSettings() }));

  api.put("/admin/settings", async (c) => {
    const body = await c.req.json<Record<string, string>>();
    for (const [k, v] of Object.entries(body)) {
      await setSetting(k, String(v));
    }
    return c.json({ ok: true });
  });

  api.get("/admin/partners/pending", async (c) => {
    const rows = await prisma.partnerRequest.findMany({
      where: { status: "pending" },
      include: { user: true },
    });
    return c.json({
      requests: rows.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        phone: r.phone,
        note: r.note,
        telegramId: String(r.user.telegramId),
        username: r.user.username,
      })),
    });
  });

  api.post("/admin/partners/:id/approve", async (c) => {
    const req = await approvePartner(c.req.param("id"));
    return c.json({ ok: true, group: req.user.panelGroup });
  });

  api.post("/admin/partners/:id/reject", async (c) => {
    await rejectPartner(c.req.param("id"));
    return c.json({ ok: true });
  });

  return api;
}
