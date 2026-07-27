import { OrderKind, OrderStatus, PaymentMethod, SubscriptionStatus, type Subscription, type User } from "@prisma/client";
import { randomInt } from "node:crypto";
import { prisma } from "../db.js";
import { isDemoMode } from "./license.js";
import { resolvePanelForSubscription } from "./panel-servers.js";
import { getPriceRates, ratesForRoleCategory } from "./settings.js";
import { inferRenewCategory } from "./renew-eligibility.js";
import { withEffectiveRole } from "./demo-role.js";
import { gbToBytes } from "../utils/format.js";
import { expiryTimeForPanel } from "./panel-expiry.js";

export const ADD_DAY_PRICE_TOMAN = 2_000;
export const ADD_DAY_MAX = 10;
export const ADD_GB_MAX = 100;

function sanitizeAccountName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
  return cleaned || `qt${randomInt(100, 1000)}`;
}

async function ownedSub(userId: string, subId: string) {
  const sub = await prisma.subscription.findFirst({ where: { id: subId, userId } });
  if (!sub) throw new Error("سرویس پیدا نشد");
  return sub;
}

export function clampAddDays(days: number) {
  const n = Math.floor(Number(days) || 0);
  if (n < 1 || n > ADD_DAY_MAX) throw new Error(`تعداد روز باید بین ۱ و ${ADD_DAY_MAX} باشد`);
  return n;
}

export function clampAddGb(gb: number) {
  const n = Math.floor(Number(gb) || 0);
  if (n < 1 || n > ADD_GB_MAX) throw new Error(`حجم باید بین ۱ و ${ADD_GB_MAX} گیگابایت باشد`);
  return n;
}

export function quoteAddDays(days: number) {
  const d = clampAddDays(days);
  return { days: d, price: d * ADD_DAY_PRICE_TOMAN, perDay: ADD_DAY_PRICE_TOMAN, maxDays: ADD_DAY_MAX };
}

export async function quoteAddGb(user: User, subId: string, gb: number) {
  const sub = await ownedSub(user.id, subId);
  if (sub.isTest) throw new Error("سرویس تست قابل افزایش حجم نیست");
  if (sub.trafficGb == null || sub.trafficGb <= 0) {
    throw new Error("سرویس نامحدود است؛ افزایش حجم اعمال نمی‌شود");
  }
  const g = clampAddGb(gb);
  const pricedUser = withEffectiveRole(user, user.telegramId);
  const category = await inferRenewCategory(sub);
  const rates = await getPriceRates();
  const roleRates = ratesForRoleCategory(pricedUser.role, category, rates);
  const perGb = Math.max(0, Number(roleRates.perGb) || 0);
  if (perGb <= 0) throw new Error("قیمت هر گیگ برای نقش شما تنظیم نشده است");
  return {
    gb: g,
    price: g * perGb,
    perGb,
    currentGb: sub.trafficGb,
    newGb: sub.trafficGb + g,
    category,
    maxGb: ADD_GB_MAX,
  };
}

export async function createAddDaysOrder(input: {
  userId: string;
  subId: string;
  days: number;
  paymentMethod?: PaymentMethod;
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  const sub = await ownedSub(user.id, input.subId);
  if (sub.isTest) throw new Error("سرویس تست قابل افزایش روز نیست");
  const quote = quoteAddDays(input.days);
  return prisma.order.create({
    data: {
      userId: user.id,
      kind: OrderKind.add_days,
      trafficGb: null,
      months: quote.days,
      quantity: 1,
      price: quote.price,
      accountName: sub.email,
      customName: sub.email,
      targetSubId: sub.id,
      panelServerId: sub.panelServerId,
      status: OrderStatus.pending_payment,
      paymentMethod: input.paymentMethod ?? PaymentMethod.card_to_card,
    },
    include: { user: true, targetSub: true },
  });
}

export async function createAddGbOrder(input: {
  userId: string;
  subId: string;
  gb: number;
  paymentMethod?: PaymentMethod;
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  const quote = await quoteAddGb(user, input.subId, input.gb);
  const sub = await ownedSub(user.id, input.subId);
  return prisma.order.create({
    data: {
      userId: user.id,
      kind: OrderKind.add_gb,
      trafficGb: quote.gb,
      months: 0,
      quantity: 1,
      price: quote.price,
      accountName: sub.email,
      customName: sub.email,
      targetSubId: sub.id,
      panelServerId: sub.panelServerId,
      status: OrderStatus.pending_payment,
      paymentMethod: input.paymentMethod ?? PaymentMethod.card_to_card,
    },
    include: { user: true, targetSub: true },
  });
}

function computeExtendedExpiry(sub: Subscription, days: number) {
  const addMs = days * 86_400_000;
  if (sub.startsOnConnect && !sub.activatedAt) {
    const remaining = Math.max(0, sub.expiresAt.getTime() - Date.now());
    const newRemaining = remaining + addMs;
    return {
      expiresAt: new Date(Date.now() + newRemaining),
      panelExpiryTime: -newRemaining,
      startsOnConnect: true as const,
      activatedAt: null as Date | null,
    };
  }
  const base = Math.max(Date.now(), sub.expiresAt.getTime());
  const expiresAt = new Date(base + addMs);
  return {
    expiresAt,
    panelExpiryTime: expiresAt.getTime(),
    startsOnConnect: false as const,
    activatedAt: sub.activatedAt ?? new Date(),
  };
}

/** Apply paid add-days after payment. */
export async function applyAddDays(subId: string, days: number) {
  const d = clampAddDays(days);
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
  const next = computeExtendedExpiry(sub, d);

  if (isDemoMode() || !sub.panelServerId || sub.subUrl?.includes("demo.invalid")) {
    return prisma.subscription.update({
      where: { id: sub.id },
      data: {
        expiresAt: next.expiresAt,
        startsOnConnect: next.startsOnConnect,
        activatedAt: next.activatedAt,
        panelExpiryTime: BigInt(Math.trunc(next.panelExpiryTime)),
        status: SubscriptionStatus.active,
      },
    });
  }

  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    expiryTime: next.panelExpiryTime,
    enable: true,
  });

  return prisma.subscription.update({
    where: { id: sub.id },
    data: {
      expiresAt: next.expiresAt,
      startsOnConnect: next.startsOnConnect,
      activatedAt: next.activatedAt,
      panelExpiryTime: BigInt(Math.trunc(next.panelExpiryTime)),
      status: SubscriptionStatus.active,
      ...(resolved.panel && !sub.panelServerId ? { panelServerId: resolved.panel.id } : {}),
    },
  });
}

/** Apply paid add-gb after payment. */
export async function applyAddGb(subId: string, addGb: number) {
  const g = clampAddGb(addGb);
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
  if (sub.trafficGb == null || sub.trafficGb <= 0) {
    throw new Error("سرویس نامحدود است؛ افزایش حجم اعمال نمی‌شود");
  }
  const newGb = sub.trafficGb + g;
  const totalGB = gbToBytes(newGb);

  if (isDemoMode() || !sub.panelServerId || sub.subUrl?.includes("demo.invalid")) {
    return prisma.subscription.update({
      where: { id: sub.id },
      data: { trafficGb: newGb, status: SubscriptionStatus.active },
    });
  }

  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    totalGB,
    enable: true,
    expiryTime: expiryTimeForPanel(sub),
  });

  return prisma.subscription.update({
    where: { id: sub.id },
    data: {
      trafficGb: newGb,
      status: SubscriptionStatus.active,
      ...(resolved.panel && !sub.panelServerId ? { panelServerId: resolved.panel.id } : {}),
    },
  });
}

async function emailTaken(email: string, exceptSubId?: string) {
  const inDb = await prisma.subscription.findFirst({
    where: {
      email: { equals: email },
      ...(exceptSubId ? { NOT: { id: exceptSubId } } : {}),
    },
    select: { id: true },
  });
  if (inDb) return true;
  return false;
}

async function panelEmailExists(email: string, sub: Subscription): Promise<boolean> {
  if (isDemoMode() || !sub.panelServerId || sub.subUrl?.includes("demo.invalid")) return false;
  try {
    const resolved = await resolvePanelForSubscription(sub);
    const got = await resolved.xui.getClient(email);
    return Boolean(got.obj?.client);
  } catch {
    return false;
  }
}

/** Rename subscription email (panel + DB). Free. */
export async function renameSubscriptionEmail(userId: string, subId: string, desiredName: string) {
  const sub = await ownedSub(userId, subId);
  let base = sanitizeAccountName(desiredName);
  if (base.length > 29) base = base.slice(0, 29);

  let candidate = base;
  let attempts = 0;
  while (
    (candidate !== sub.email && (await emailTaken(candidate, sub.id))) ||
    (candidate !== sub.email && (await panelEmailExists(candidate, sub)))
  ) {
    attempts += 1;
    if (attempts > 20) throw new Error("نام‌های مشابه زیاد است؛ نام دیگری انتخاب کنید");
    const suffix = String(randomInt(100, 1000));
    candidate = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
  }

  if (candidate === sub.email) {
    return { email: sub.email, changed: false as const };
  }

  if (isDemoMode() || !sub.panelServerId || sub.subUrl?.includes("demo.invalid")) {
    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        email: candidate,
        title: sub.title === sub.email ? candidate : sub.title,
      },
    });
    return { email: updated.email, changed: true as const };
  }

  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: candidate,
  });

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      email: candidate,
      title: !sub.title || sub.title === sub.email ? candidate : sub.title,
      ...(resolved.panel && !sub.panelServerId ? { panelServerId: resolved.panel.id } : {}),
    },
  });

  return { email: updated.email, changed: true as const };
}

/**
 * Secure sub link: Base64 of the subscription URL only (tap-to-copy friendly).
 */
export async function getSecureConfigBase64(userId: string, subId: string) {
  const sub = await ownedSub(userId, subId);
  let subUrl = (sub.subUrl || "").trim();
  if (!subUrl || !subUrl.startsWith("http")) {
    try {
      const { refreshSubscriptionSubUrl } = await import("./provision.js");
      subUrl = (await refreshSubscriptionSubUrl(sub.id))?.trim() || subUrl;
    } catch {
      /* keep existing */
    }
  }
  if (!subUrl) throw new Error("لینک اشتراک در دسترس نیست");

  return {
    base64: Buffer.from(subUrl, "utf8").toString("base64"),
    linkCount: 1,
    email: sub.email,
    subUrl,
  };
}
