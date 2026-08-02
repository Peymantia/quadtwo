import { OrderStatus, UserRole, type User } from "@prisma/client";
import { prisma } from "../db.js";
import { getSetting, setSetting } from "./settings.js";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeDiscountCode(raw: string): string {
  // en-US so Turkish İ/i quirks never break matching; always case-insensitive
  return raw.trim().replace(/\s+/g, "").toLocaleUpperCase("en-US");
}

/** Find a discount row by code (case-insensitive); heals legacy mixed-case rows to uppercase. */
export async function findDiscountCodeByInput(raw: string) {
  const normalized = normalizeDiscountCode(raw);
  if (!normalized) return null;

  const exact = await prisma.discountCode.findUnique({ where: { code: normalized } });
  if (exact) return exact;

  const hits = await prisma.$queryRaw<Array<{ id: string; code: string }>>`
    SELECT id, code FROM DiscountCode WHERE upper(code) = ${normalized} LIMIT 1
  `;
  const hit = hits[0];
  if (!hit) return null;

  if (hit.code !== normalized) {
    try {
      await prisma.discountCode.update({ where: { id: hit.id }, data: { code: normalized } });
    } catch {
      /* unique conflict if both casings somehow exist — still return the row */
    }
  }
  return prisma.discountCode.findUnique({ where: { id: hit.id } });
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
  return (
    role === UserRole.admin ||
    role === UserRole.partner ||
    role === UserRole.wholesale ||
    role === UserRole.reseller ||
    role === "admin" ||
    role === "partner" ||
    role === "wholesale" ||
    role === "reseller"
  );
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

const MSG = {
  invalid: "کد تخفیف وارد شده صحیح نیست",
  expired: "کد تخفیف منقضی شده",
  alreadyUsed: "شما قبلا از این کد تخفیف استفاده کرده اید",
  disabled: "کد تخفیف فعلاً غیرفعال است",
  empty: "کد تخفیف را وارد کنید",
  creatorOnly: "این کد فقط برای فروش سازنده‌اش قابل استفاده است",
  exhausted: "ظرفیت استفاده از این کد تمام شده است",
} as const;

/** Buyer already consumed this code on a paid / in-flight reviewed order (not abandoned pending). */
async function buyerAlreadyUsedDiscount(buyerId: string, codeId: string): Promise<boolean> {
  const n = await prisma.order.count({
    where: {
      userId: buyerId,
      discountCodeId: codeId,
      status: {
        in: [
          OrderStatus.awaiting_review,
          OrderStatus.paid,
          OrderStatus.provisioning,
          OrderStatus.completed,
        ],
      },
    },
  });
  return n > 0;
}

/** Cancel abandoned pending checkouts that hold a discount code (frees one-time codes). */
export async function cancelStalePendingDiscountOrders(opts?: {
  olderThanMs?: number;
  buyerId?: string;
  discountCodeId?: string;
}): Promise<number> {
  const olderThanMs = opts?.olderThanMs ?? 30 * 60_000;
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.order.updateMany({
    where: {
      status: OrderStatus.pending_payment,
      discountCodeId: opts?.discountCodeId ? opts.discountCodeId : { not: null },
      createdAt: { lt: cutoff },
      ...(opts?.buyerId ? { userId: opts.buyerId } : {}),
    },
    data: {
      status: OrderStatus.cancelled,
      adminNote: "لغو خودکار: سفارش پرداخت‌نشده با کد تخفیف",
    },
  });
  return result.count;
}

/** Drop other open pending orders for this buyer+code so a fresh checkout can proceed. */
export async function cancelOpenPendingForDiscount(buyerId: string, discountCodeId: string): Promise<void> {
  await prisma.order.updateMany({
    where: {
      userId: buyerId,
      discountCodeId,
      status: OrderStatus.pending_payment,
    },
    data: {
      status: OrderStatus.cancelled,
      adminNote: "لغو: سفارش جدید با همان کد تخفیف",
    },
  });
}

/**
 * Validate a code and compute discounted price.
 * Valid codes reduce price; invalid/expired/already-used return a clear Persian error.
 */
export async function previewDiscount(opts: {
  buyer: Pick<User, "id" | "role">;
  code: string;
  price: number;
}): Promise<DiscountPreview> {
  if (!(await isDiscountCodesEnabled())) {
    return { error: MSG.disabled };
  }
  const normalized = normalizeDiscountCode(opts.code);
  if (!normalized) return { error: MSG.empty };
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

  const row = await findDiscountCodeByInput(normalized);
  if (!row || !row.active) return { error: MSG.invalid };

  if (row.createdByUserId !== opts.buyer.id) {
    // Admin-created codes are global promos; shareable partner codes are customer-facing;
    // other partner/wholesale codes stay creator-scoped.
    const creator = await prisma.user.findUnique({
      where: { id: row.createdByUserId },
      select: { role: true },
    });
    if (creator?.role !== UserRole.admin && !row.shareable) {
      return { error: MSG.creatorOnly };
    }
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { error: MSG.expired };
  }

  const isOneTime = row.maxUses === 1;
  if (isOneTime && (await buyerAlreadyUsedDiscount(opts.buyer.id, row.id))) {
    return { error: MSG.alreadyUsed };
  }

  if (row.maxUses != null && row.usedCount >= row.maxUses) {
    return { error: MSG.exhausted };
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

/** Call after order successfully transitions into paid (wallet / approve / complimentary). */
export async function recordDiscountUse(discountCodeId: string | null | undefined): Promise<void> {
  if (!discountCodeId) return;
  const row = await prisma.discountCode.findUnique({
    where: { id: discountCodeId },
    select: { maxUses: true },
  });
  if (!row) return;
  await prisma.discountCode.updateMany({
    where:
      row.maxUses == null
        ? { id: discountCodeId }
        : { id: discountCodeId, usedCount: { lt: row.maxUses } },
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
  shareable?: boolean;
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
    shareable: Boolean(row.shareable),
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
  /** When true, any buyer may use this non-admin code */
  shareable?: boolean;
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

  // Admin codes are already global via creator role; shareable is for partner/wholesale customer codes.
  const shareable = Boolean(opts.shareable);

  try {
    const row = await prisma.discountCode.create({
      data: {
        code: normalized,
        percentOff,
        createdByUserId: ownerId,
        maxUses,
        expiresAt,
        note: opts.note?.trim() ? opts.note.trim().slice(0, 200) : null,
        shareable,
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
  shareable?: boolean;
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
    shareable?: boolean;
  } = {};

  if (opts.active !== undefined) data.active = Boolean(opts.active);
  if (opts.shareable !== undefined) {
    data.shareable = Boolean(opts.shareable);
  }
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
