import { Hono } from "hono";
import { cors } from "hono/cors";
import { parseAndValidateInitData, signSession, verifySession } from "../auth/telegram.js";
import { prisma } from "../db.js";
import { orderSummaryText } from "../services/orders.js";
import { listPriceMatrix, resolvePrice } from "../services/pricing.js";
import { provisionOrder } from "../services/provision.js";
import { getAllSettings, getSetting } from "../services/settings.js";
import { upsertUserFromTelegram } from "../services/users.js";
import { corsOrigins } from "../config/env.js";
import {
  registerDashAuthRoutes,
  registerDashMeRoutes,
  registerDashPartnerRoutes,
  registerDashAdminRoutes,
} from "./dash.js";

type Vars = { userId: string; role: string; telegramId: string };

export function createApiApp() {
  const api = new Hono<{ Variables: Vars }>();
  const origins = corsOrigins();

  api.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return origins[0] ?? "*";
        if (origins.includes(origin) || origins.includes("*")) return origin;
        if (origins.length === 0) return origin;
        return origins[0]!;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  registerDashAuthRoutes(api);

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
        hasPassword: Boolean(user.passwordHash),
      },
    });
  });

  const authBearer = async (
    c: { req: { header: (n: string) => string | undefined }; set: (k: keyof Vars, v: string) => void; json: (b: unknown, s?: number) => Response },
    next: () => Promise<void>,
    requireAdmin = false,
  ) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
    try {
      const payload = await verifySession(header.slice(7));
      const fresh = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!fresh) return c.json({ error: "Unauthorized" }, 401);
      if (requireAdmin && fresh.role !== "admin") return c.json({ error: "Forbidden" }, 403);
      c.set("userId", fresh.id);
      c.set("role", fresh.role);
      c.set("telegramId", String(fresh.telegramId));
      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  };

  api.use("/me/*", (c, next) => authBearer(c, next, false));
  api.use("/partner/*", (c, next) => authBearer(c, next, false));
  api.use("/admin/*", (c, next) => authBearer(c, next, true));

  registerDashMeRoutes(api);
  registerDashPartnerRoutes(api);
  registerDashAdminRoutes(api);

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
        hasPassword: Boolean(user.passwordHash),
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

  api.post("/me/orders/:id/receipt", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ receiptText?: string; receiptFileId?: string }>();
    const order = await prisma.order.updateMany({
      where: { id, userId: c.get("userId") },
      data: {
        receiptText: body.receiptText ?? "uploaded-via-dashboard",
        receiptFileId: body.receiptFileId ?? "dashboard",
        status: "awaiting_review",
      },
    });
    if (!order.count) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
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
    const sub = result as { code: string; subUrl: string; email: string };
    return c.json({ type: "subscription", code: sub.code, subUrl: sub.subUrl, email: sub.email });
  });

  api.post("/admin/orders/:id/reject", async (c) => {
    await prisma.order.update({
      where: { id: c.req.param("id") },
      data: { status: "rejected", adminNote: "rejected via dashboard" },
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

  return api;
}
