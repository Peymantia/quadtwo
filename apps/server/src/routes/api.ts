import { Hono } from "hono";
import { cors } from "hono/cors";
import { parseAndValidateInitData, signSession, verifySession } from "../auth/telegram.js";
import { prisma } from "../db.js";
import { corsOrigins } from "../config/env.js";
import { isDemoMode, verifyRequestHost, getLicenseStatus } from "../services/license.js";
import { effectiveRole, parseDemoRole, setDemoRole, getDemoRole } from "../services/demo-role.js";
import { upsertUserFromTelegram } from "../services/users.js";
import { runWithTenantAsync } from "../services/tenant-context.js";
import { resolveTenantFromRequest } from "../services/tenant-resolve.js";
import { getTenantById, tenantBotTokenPlain } from "../services/tenants.js";
import {
  registerDashAuthRoutes,
  registerDashMeRoutes,
  registerDashPartnerRoutes,
  registerDashAdminRoutes,
} from "./dash.js";
import { registerSuperadminRoutes } from "./superadmin.js";

type Vars = { userId: string; role: string; telegramId: string; tenantId: string };

export function createApiApp() {
  const api = new Hono<{ Variables: Vars }>();
  const origins = corsOrigins();

  api.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return origins[0] ?? "*";
        if (origins.includes(origin) || origins.includes("*")) return origin;
        // Allow tenant subdomains of configured origins
        try {
          const u = new URL(origin);
          for (const o of origins) {
            if (o === "*") return origin;
            try {
              const base = new URL(o);
              if (u.hostname === base.hostname || u.hostname.endsWith(`.${base.hostname}`)) {
                return origin;
              }
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
        if (origins.length === 0) return origin;
        return origins[0]!;
      },
      allowHeaders: ["Content-Type", "Authorization", "X-Demo-Role", "X-Tenant-Slug"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      exposeHeaders: ["X-Demo-Mode"],
    }),
  );

  // Resolve tenant from Host / X-Tenant-Slug / ?tenant= and bind ALS for the request
  api.use("*", async (c, next) => {
    const host = c.req.header("x-forwarded-host") || c.req.header("host");
    const headerSlug = c.req.header("x-tenant-slug");
    const querySlug = c.req.query("tenant");
    let resolved: { id: string; slug: string; isPlatform: boolean };
    try {
      resolved = await resolveTenantFromRequest({
        host,
        headerSlug,
        querySlug,
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 404);
    }
    c.set("tenantId", resolved.id);
    return runWithTenantAsync(
      { tenantId: resolved.id, slug: resolved.slug, isPlatform: resolved.isPlatform },
      () => next(),
    );
  });

  api.use("*", async (c, next) => {
    const path = c.req.path;
    if (path.endsWith("/health") || path.includes("/auth/meta") || path.includes("/logo-file")) {
      await next();
      return;
    }
    const st = getLicenseStatus();
    if (st.enforced && !st.ok) {
      return c.json({ error: st.reason || "License required", code: "LICENSE_REQUIRED" }, 403);
    }
    const host = c.req.header("x-forwarded-host") || c.req.header("host");
    if (!verifyRequestHost(host)) {
      return c.json({ error: "این دامنه با لایسنس هم‌خوان نیست", code: "LICENSE_HOST" }, 403);
    }
    await next();
  });

  registerDashAuthRoutes(api);

  api.post("/auth/telegram", async (c) => {
    const body = await c.req.json<{ initData?: string }>();
    if (!body.initData) return c.json({ error: "initData required" }, 400);
    const tenant = await getTenantById(c.get("tenantId"));
    const botToken = tenant ? tenantBotTokenPlain(tenant) : undefined;
    const tg = parseAndValidateInitData(body.initData, botToken);
    const user = await upsertUserFromTelegram({
      id: tg.id,
      username: tg.username,
      first_name: tg.first_name,
      last_name: tg.last_name,
    });
    const role = effectiveRole(user.telegramId, user.role);
    const token = await signSession({
      userId: user.id,
      telegramId: String(user.telegramId),
      role,
    });
    return c.json({
      token,
      user: {
        id: user.id,
        role,
        firstName: user.firstName,
        username: user.username,
        panelGroup: user.panelGroup,
        hasPassword: Boolean(user.passwordHash),
        isSuperAdmin: Boolean(user.isSuperAdmin),
      },
      demoMode: isDemoMode(),
    });
  });

  const authBearer = async (
    c: {
      req: { header: (n: string) => string | undefined; path: string };
      get: (k: keyof Vars) => string;
      set: (k: keyof Vars, v: string) => void;
      json: (b: unknown, s?: number) => Response;
      header: (n: string, v: string) => void;
    },
    next: () => Promise<void>,
    requireAdmin = false,
  ) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
    try {
      const payload = await verifySession(header.slice(7));
      const fresh = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!fresh) return c.json({ error: "Unauthorized" }, 401);

      const tenantId = c.get("tenantId");
      // Superadmin routes may run on platform host while user is platform-scoped
      const isSuperPath = c.req.path.includes("/super/");
      if (!isSuperPath && fresh.tenantId !== tenantId) {
        return c.json({ error: "جلسه متعلق به این مستأجر نیست", code: "TENANT_MISMATCH" }, 403);
      }
      if (isSuperPath && !fresh.isSuperAdmin) {
        return c.json({ error: "فقط سوپرادمین" }, 403);
      }

      let role = fresh.role as string;
      if (isDemoMode()) {
        const fromHeader = parseDemoRole(c.req.header("X-Demo-Role"));
        if (fromHeader) {
          setDemoRole(fresh.telegramId, fromHeader);
          role = fromHeader;
        } else {
          role = getDemoRole(fresh.telegramId) ?? fresh.role;
        }
        c.header("X-Demo-Mode", "1");
      }

      if (requireAdmin && role !== "admin") return c.json({ error: "Forbidden" }, 403);
      c.set("userId", fresh.id);
      c.set("role", role);
      c.set("telegramId", String(fresh.telegramId));
      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  };

  api.use("/me/*", (c, next) => authBearer(c, next, false));
  api.use("/partner/*", (c, next) => authBearer(c, next, false));
  api.use("/admin/*", (c, next) => authBearer(c, next, true));
  api.use("/super/*", async (c, next) => {
    if (c.req.path.includes("/logo-file")) return next();
    return authBearer(c, next, false);
  });

  registerDashMeRoutes(api);
  registerDashPartnerRoutes(api);
  registerDashAdminRoutes(api);
  registerSuperadminRoutes(api);

  // Web receipt uploads — notify admins on Telegram (same queue as bot receipts)
  api.post("/me/orders/:id/receipt", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ receiptText?: string; receiptFileId?: string }>();
    const receiptText = (body.receiptText ?? "رسید از داشبورد وب").trim().slice(0, 500);
    const order = await prisma.order.updateMany({
      where: {
        id,
        userId: c.get("userId"),
        status: { in: ["pending_payment", "awaiting_review"] },
      },
      data: {
        receiptText,
        receiptFileId: body.receiptFileId?.trim() || "dashboard",
        status: "awaiting_review",
      },
    });
    if (!order.count) return c.json({ error: "Not found" }, 404);
    const { auditLog } = await import("../services/audit.js");
    await auditLog({
      action: "receipt_uploaded",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: id,
      detail: "web",
    });
    const { notifyAdminsOrderAwaitingReview } = await import("../services/order-notify.js");
    void notifyAdminsOrderAwaitingReview(id);
    return c.json({ ok: true });
  });

  return api;
}
