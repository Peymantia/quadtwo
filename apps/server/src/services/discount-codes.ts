import { UserRole, type User } from "@prisma/client";
import { prisma } from "../db.js";
import { getSetting, setSetting } from "./settings.js";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export async function isDiscountCodesEnabled(): Promise<boolean> {
  return (await getSetting("discount_codes_enabled")) === "true";
}

export async function setDiscountCodesEnabled(on: boolean): Promise<void> {
  await setSetting("discount_codes_enabled", on ? "true" : "false");
}

/** Max percent partners/wholesale may set when creating codes. Admin: 100. */
export async function getDiscountMaxPercentForRole(role: UserRole | string): Promise<number> {
  if (role === UserRole.admin || role === "admin") return 100;
  const n = Number(await getSetting("discount_max_percent"));
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(100, Math.floor(n));
}

export function canManageDiscountCodes(role: UserRole | string): boolean {
  return role === UserRole.admin || role === UserRole.partner || role === UserRole.wholesale
    || role === "admin" || role === "partner" || role === "wholesale";
}

export type AppliedDiscount = {
  codeId: string;
  code: string;
  percentOff: number;
  discountAmount: number;
  priceBefore: number;
  priceAfter: number;
};

export type DiscountPreview = AppliedDiscount | { error: string };

/**
 * Codes only apply to the creator's own checkout (فروش خودش).
 */
export async function previewDiscount(opts: {
  buyer: Pick<User, "id" | "role">;
  code: string;
  price: number;
}): Promise<DiscountPreview> {
  if (!(await isDiscountCodesEnabled())) {
    return { error: "کد تخفیف فعلاً غیرفعال است" };
  }
  const normalized = normalizeDiscountCode(opts.code);
  if (!normalized) return { error: "کد تخفیف را وارد کنید" };
  if (opts.price <= 0) {
    return {
      codeId: "",
      code: normalized,
      percentOff: 0,
      discountAmount: 0,
      priceBefore: 0,
      priceAfter: 0,
    };
  }

  const row = await prisma.discountCode.findUnique({ where: { code: normalized } });
  if (!row || !row.active) return { error: "کد تخفیف معتبر نیست" };
  if (row.createdByUserId !== opts.buyer.id) {
    // Admin-created codes are global promos; partner/wholesale codes stay creator-scoped
    const creator = await prisma.user.findUnique({
      where: { id: row.createdByUserId },
      select: { role: true },
    });
    if (creator?.role !== UserRole.admin && creator?.role !== "admin") {
      return { error: "این کد فقط برای فروش سازنده‌اش قابل استفاده است" };
    }
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { error: "مهلت این کد تخفیف تمام شده است" };
  }
  if (row.maxUses != null && row.usedCount >= row.maxUses) {
    return { error: "ظرفیت استفاده از این کد تمام شده است" };
  }

  const percent = Math.max(1, Math.min(100, row.percentOff));
  const discountAmount = Math.min(opts.price, Math.floor((opts.price * percent) / 100));
  const priceAfter = Math.max(0, opts.price - discountAmount);
  return {
    codeId: row.id,
    code: row.code,
    percentOff: percent,
    discountAmount,
    priceBefore: opts.price,
    priceAfter,
  };
}

export async function assertAndApplyDiscount(opts: {
  buyer: Pick<User, "id" | "role">;
  code: string | null | undefined;
  price: number;
}): Promise<AppliedDiscount | null> {
  const raw = opts.code?.trim();
  if (!raw) return null;
  const preview = await previewDiscount({ buyer: opts.buyer, code: raw, price: opts.price });
  if ("error" in preview) throw new Error(preview.error);
  if (!preview.codeId) return null;
  return preview;
}

/** Call after order is successfully paid (wallet or admin approve). */
export async function recordDiscountUse(discountCodeId: string | null | undefined): Promise<void> {
  if (!discountCodeId) return;
  await prisma.discountCode.updateMany({
    where: { id: discountCodeId },
    data: { usedCount: { increment: 1 } },
  });
}

export async function listDiscountCodesForUser(userId: string, role: string) {
  const where =
    role === "admin"
      ? {}
      : { createdByUserId: userId };
  const rows = await prisma.discountCode.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, username: true, agentName: true, role: true, telegramId: true } },
    },
    take: 200,
  });
  return rows.map(serializeDiscountCode);
}

export function serializeDiscountCode(row: {
  id: string;
  code: string;
  percentOff: number;
  createdByUserId: string;
  active: boolean;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  note: string | null;
  createdAt: Date;
  createdBy?: {
    id: string;
    username: string | null;
    agentName: string | null;
    role: UserRole;
    telegramId: bigint;
  };
}) {
  return {
    id: row.id,
    code: row.code,
    percentOff: row.percentOff,
    createdByUserId: row.createdByUserId,
    active: row.active,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    ownerLabel: row.createdBy
      ? row.createdBy.username
        ? `@${row.createdBy.username}`
        : row.createdBy.agentName || String(row.createdBy.telegramId)
      : undefined,
    ownerRole: row.createdBy?.role,
  };
}

export async function createDiscountCode(opts: {
  actor: Pick<User, "id" | "role">;
  code: string;
  percentOff: number;
  maxUses?: number | null;
  expiresAt?: string | null;
  note?: string | null;
  /** Admin may create a code owned by another user */
  ownerUserId?: string | null;
}) {
  if (!canManageDiscountCodes(opts.actor.role)) {
    throw new Error("اجازه ساخت کد تخفیف ندارید");
  }
  if (!(await isDiscountCodesEnabled()) && opts.actor.role !== UserRole.admin) {
    throw new Error("کد تخفیف توسط ادمین غیرفعال است");
  }

  const normalized = normalizeDiscountCode(opts.code);
  if (!CODE_RE.test(normalized)) {
    throw new Error("کد باید ۳ تا ۳۲ کاراکتر انگلیسی/عدد باشد (خط تیره مجاز)");
  }

  const maxPct = await getDiscountMaxPercentForRole(opts.actor.role);
  const percentOff = Math.floor(Number(opts.percentOff));
  if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > maxPct) {
    throw new Error(`درصد تخفیف باید بین ۱ تا ${maxPct} باشد`);
  }

  let ownerId = opts.actor.id;
  if (opts.ownerUserId && opts.actor.role === UserRole.admin) {
    const owner = await prisma.user.findUnique({ where: { id: opts.ownerUserId } });
    if (!owner) throw new Error("کاربر مالک کد پیدا نشد");
    if (!canManageDiscountCodes(owner.role)) {
      throw new Error("مالک کد باید ادمین، همکار یا عمده‌فروش باشد");
    }
    ownerId = owner.id;
  }

  let expiresAt: Date | null = null;
  if (opts.expiresAt) {
    const d = new Date(opts.expiresAt);
    if (!Number.isFinite(d.getTime())) throw new Error("تاریخ انقضای کد نامعتبر است");
    expiresAt = d;
  }

  const maxUses =
    opts.maxUses == null || opts.maxUses === undefined
      ? null
      : Math.max(1, Math.floor(Number(opts.maxUses)));

  try {
    const row = await prisma.discountCode.create({
      data: {
        code: normalized,
        percentOff,
        createdByUserId: ownerId,
        maxUses,
        expiresAt,
        note: opts.note?.trim() ? opts.note.trim().slice(0, 200) : null,
        active: true,
      },
      include: {
        createdBy: { select: { id: true, username: true, agentName: true, role: true, telegramId: true } },
      },
    });
    return serializeDiscountCode(row);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/unique|Unique/i.test(msg)) throw new Error("این کد قبلاً ثبت شده است");
    throw err;
  }
}

export async function updateDiscountCode(opts: {
  actor: Pick<User, "id" | "role">;
  id: string;
  active?: boolean;
  percentOff?: number;
  maxUses?: number | null;
  expiresAt?: string | null;
  note?: string | null;
}) {
  const row = await prisma.discountCode.findUnique({ where: { id: opts.id } });
  if (!row) throw new Error("کد پیدا نشد");
  if (opts.actor.role !== UserRole.admin && row.createdByUserId !== opts.actor.id) {
    throw new Error("اجازه ویرایش این کد را ندارید");
  }

  const data: {
    active?: boolean;
    percentOff?: number;
    maxUses?: number | null;
    expiresAt?: Date | null;
    note?: string | null;
  } = {};

  if (opts.active !== undefined) data.active = Boolean(opts.active);
  if (opts.percentOff !== undefined) {
    const maxPct = await getDiscountMaxPercentForRole(
      opts.actor.role === UserRole.admin ? UserRole.admin : opts.actor.role,
    );
    const percentOff = Math.floor(Number(opts.percentOff));
    if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > maxPct) {
      throw new Error(`درصد تخفیف باید بین ۱ تا ${maxPct} باشد`);
    }
    data.percentOff = percentOff;
  }
  if (opts.maxUses !== undefined) {
    data.maxUses =
      opts.maxUses == null ? null : Math.max(1, Math.floor(Number(opts.maxUses)));
  }
  if (opts.expiresAt !== undefined) {
    if (!opts.expiresAt) data.expiresAt = null;
    else {
      const d = new Date(opts.expiresAt);
      if (!Number.isFinite(d.getTime())) throw new Error("تاریخ انقضا نامعتبر است");
      data.expiresAt = d;
    }
  }
  if (opts.note !== undefined) {
    data.note = opts.note?.trim() ? opts.note.trim().slice(0, 200) : null;
  }

  const updated = await prisma.discountCode.update({
    where: { id: opts.id },
    data,
    include: {
      createdBy: { select: { id: true, username: true, agentName: true, role: true, telegramId: true } },
    },
  });
  return serializeDiscountCode(updated);
}

export async function deleteDiscountCode(opts: {
  actor: Pick<User, "id" | "role">;
  id: string;
}) {
  const row = await prisma.discountCode.findUnique({ where: { id: opts.id } });
  if (!row) throw new Error("کد پیدا نشد");
  if (opts.actor.role !== UserRole.admin && row.createdByUserId !== opts.actor.id) {
    throw new Error("اجازه حذف این کد را ندارید");
  }
  await prisma.discountCode.delete({ where: { id: opts.id } });
  return { ok: true as const };
}
