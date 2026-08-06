import { Hono } from "hono";
import { TenantStatus } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { prisma } from "../db.js";
import {
  activateTenant,
  createTenant,
  suspendTenant,
  tenantDashUrl,
  updateTenant,
} from "../services/tenants.js";
import { restartTenantBot, stopTenantBot } from "../services/bot-manager.js";
import { auditLog } from "../services/audit.js";

type Vars = { userId: string; role: string; telegramId: string; tenantId: string };

function requireSuper(c: { get: (k: "userId") => string }) {
  return prisma.user.findUnique({ where: { id: c.get("userId") } }).then((u) => {
    if (!u?.isSuperAdmin) return null;
    return u;
  });
}

export function registerSuperadminRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/super/tenants", async (c) => {
    const user = await requireSuper(c);
    if (!user?.isSuperAdmin) return c.json({ error: "فقط سوپرادمین" }, 403);
    const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "asc" } });
    return c.json({
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        brandName: t.brandName,
        logoUrl: t.logoUrl,
        botUsername: t.botUsername,
        status: t.status,
        isPlatform: t.isPlatform,
        ownerTelegramId: t.ownerTelegramId != null ? String(t.ownerTelegramId) : null,
        dashUrl: tenantDashUrl(t.slug),
        createdAt: t.createdAt.toISOString(),
      })),
    });
  });

  api.post("/super/tenants", async (c) => {
    const user = await requireSuper(c);
    if (!user?.isSuperAdmin) return c.json({ error: "فقط سوپرادمین" }, 403);
    const body = await c.req.json<{
      name: string;
      slug: string;
      botToken: string;
      brandName?: string;
      ownerTelegramId?: string;
      welcomeText?: string;
      supportUsername?: string;
    }>();
    try {
      const tenant = await createTenant({
        name: body.name,
        slug: body.slug,
        botToken: body.botToken,
        brandName: body.brandName,
        ownerTelegramId: body.ownerTelegramId ? BigInt(body.ownerTelegramId) : null,
        welcomeText: body.welcomeText,
        supportUsername: body.supportUsername,
      });
      await restartTenantBot(tenant.id);
      await auditLog({
        action: "tenant_created",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: tenant.id,
        detail: tenant.slug,
      });
      return c.json({
        ok: true,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          dashUrl: tenantDashUrl(tenant.slug),
          botUsername: tenant.botUsername,
        },
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.patch("/super/tenants/:id", async (c) => {
    const user = await requireSuper(c);
    if (!user?.isSuperAdmin) return c.json({ error: "فقط سوپرادمین" }, 403);
    const id = c.req.param("id");
    const body = await c.req.json<{
      name?: string;
      brandName?: string;
      welcomeText?: string | null;
      supportUsername?: string | null;
      botToken?: string;
      ownerTelegramId?: string | null;
      status?: "active" | "suspended";
    }>();
    try {
      const tenant = await updateTenant(id, {
        name: body.name,
        brandName: body.brandName,
        welcomeText: body.welcomeText,
        supportUsername: body.supportUsername,
        botToken: body.botToken,
        ownerTelegramId:
          body.ownerTelegramId === null
            ? null
            : body.ownerTelegramId
              ? BigInt(body.ownerTelegramId)
              : undefined,
        status: body.status as TenantStatus | undefined,
      });
      if (body.botToken || body.status === "active") await restartTenantBot(id);
      if (body.status === "suspended") await stopTenantBot(id);
      return c.json({ ok: true, tenant: { id: tenant.id, slug: tenant.slug, status: tenant.status } });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/super/tenants/:id/suspend", async (c) => {
    const user = await requireSuper(c);
    if (!user?.isSuperAdmin) return c.json({ error: "فقط سوپرادمین" }, 403);
    try {
      await suspendTenant(c.req.param("id"));
      await stopTenantBot(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/super/tenants/:id/activate", async (c) => {
    const user = await requireSuper(c);
    if (!user?.isSuperAdmin) return c.json({ error: "فقط سوپرادمین" }, 403);
    await activateTenant(c.req.param("id"));
    await restartTenantBot(c.req.param("id"));
    return c.json({ ok: true });
  });

  api.post("/super/tenants/:id/logo", async (c) => {
    const user = await requireSuper(c);
    if (!user?.isSuperAdmin) return c.json({ error: "فقط سوپرادمین" }, 403);
    const id = c.req.param("id");
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return c.json({ error: "پیدا نشد" }, 404);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!file || typeof file === "string") return c.json({ error: "فایل لوگو لازم است" }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 2_000_000) return c.json({ error: "حداکثر ۲ مگابایت" }, 400);
    const ext = extname(file.name || "").toLowerCase() || ".png";
    const dir = join(process.cwd(), "uploads", "tenants", id);
    await mkdir(dir, { recursive: true });
    const filename = `logo${ext}`;
    await writeFile(join(dir, filename), buf);
    const logoUrl = `/api/super/tenants/${id}/logo-file`;
    await updateTenant(id, { logoUrl });
    // Also store as tenant setting when in that tenant context later
    return c.json({ ok: true, logoUrl });
  });

  api.get("/super/tenants/:id/logo-file", async (c) => {
    const id = c.req.param("id");
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant?.logoUrl) return c.json({ error: "لوگو نیست" }, 404);
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = join(process.cwd(), "uploads", "tenants", id);
    try {
      const files = await readdir(dir);
      const logo = files.find((f) => f.startsWith("logo"));
      if (!logo) return c.json({ error: "فایل نیست" }, 404);
      const buf = await readFile(join(dir, logo));
      const type = logo.endsWith(".svg")
        ? "image/svg+xml"
        : logo.endsWith(".webp")
          ? "image/webp"
          : logo.endsWith(".jpg") || logo.endsWith(".jpeg")
            ? "image/jpeg"
            : "image/png";
      return new Response(buf, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" } });
    } catch {
      return c.json({ error: "فایل نیست" }, 404);
    }
  });
}
