import { prisma } from "../db.js";

export type AuditAction =
  | "order_created"
  | "receipt_uploaded"
  | "order_approved"
  | "order_rejected"
  | "provision_ok"
  | "provision_fail"
  | "partner_request"
  | "partner_approved"
  | "partner_rejected"
  | "admin_config_delete"
  | "test_claimed"
  | "backup_sent"
  | "admin_search"
  | "setting_changed";

export async function auditLog(input: {
  action: AuditAction | string;
  actorTelegramId?: number | bigint | null;
  target?: string | null;
  detail?: string | null;
}) {
  try {
    const { resolveTenantIdOrPlatform } = await import("./tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: input.action,
        actorTelegramId: input.actorTelegramId != null ? BigInt(input.actorTelegramId) : null,
        target: input.target?.slice(0, 120) ?? null,
        detail: input.detail?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    console.warn("auditLog failed", err);
  }
}

export async function listRecentAudit(limit = 20) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  return prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
