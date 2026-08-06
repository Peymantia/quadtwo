import { prisma } from "../db.js";
import { PLATFORM_TENANT_SLUG } from "./tenant-context.js";
import { getPlatformTenantId } from "./tenants.js";

/**
 * Resolve tenant from Host header.
 * - acme.dash.example.com → slug acme
 * - dash.example.com / localhost → platform
 * - ?tenant=slug query / X-Tenant-Slug header for local dev
 */
export async function resolveTenantFromRequest(opts: {
  host?: string | null;
  headerSlug?: string | null;
  querySlug?: string | null;
}): Promise<{ id: string; slug: string; isPlatform: boolean }> {
  const header = (opts.headerSlug || "").trim().toLowerCase();
  const query = (opts.querySlug || "").trim().toLowerCase();
  const explicit = header || query;
  if (explicit) {
    const t = await prisma.tenant.findUnique({ where: { slug: explicit } });
    if (t && t.status === "active") {
      return { id: t.id, slug: t.slug, isPlatform: t.isPlatform };
    }
    throw new Error("مستأجر پیدا نشد یا غیرفعال است");
  }

  const host = (opts.host || "").split(":")[0]?.toLowerCase() || "";
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    // slug.dash.domain.com → first label if not "dash" / "www" / "api"
    const parts = host.split(".");
    if (parts.length >= 3) {
      const sub = parts[0]!;
      if (sub && sub !== "www" && sub !== "api" && sub !== "dash") {
        const t = await prisma.tenant.findUnique({ where: { slug: sub } });
        if (t && t.status === "active") {
          return { id: t.id, slug: t.slug, isPlatform: t.isPlatform };
        }
      }
    }
  }

  const platformId = await getPlatformTenantId();
  return { id: platformId, slug: PLATFORM_TENANT_SLUG, isPlatform: true };
}
