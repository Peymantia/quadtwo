import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Order, User } from "@prisma/client";
import { OrderKind, OrderStatus, SubscriptionStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { createXuiFromEnv } from "../panel/xui-client.js";
import { gbToBytes, randomSubId, shortCode } from "../utils/format.js";
import { getConfiguredInboundIds } from "./inbounds.js";

export type ProvisionResult = {
  subscriptionId: string;
  code: string;
  email: string;
  subUrl: string;
  expiresAt: Date;
  qrPng: Buffer;
};

export function buildSubUrl(subId: string, settings?: Record<string, unknown>): string {
  if (env.XUI_SUB_BASE?.trim()) {
    const base = env.XUI_SUB_BASE.endsWith("/") ? env.XUI_SUB_BASE : `${env.XUI_SUB_BASE}/`;
    return `${base}${subId}`;
  }

  const subURI = typeof settings?.subURI === "string" ? settings.subURI : "";
  if (subURI) {
    return subURI.endsWith("/") ? `${subURI}${subId}` : `${subURI}/${subId}`;
  }

  const subDomain = typeof settings?.subDomain === "string" ? settings.subDomain : "";
  const subPort = settings?.subPort ?? 2096;
  const subPath = typeof settings?.subPath === "string" ? settings.subPath : "/sub/";
  const subTls = Boolean(settings?.subTLS ?? settings?.subEncrypt);
  if (subDomain) {
    const scheme = subTls ? "https" : "http";
    const path = subPath.endsWith("/") ? subPath : `${subPath}/`;
    return `${scheme}://${subDomain}:${subPort}${path}${subId}`;
  }

  try {
    const u = new URL(env.XUI_BASE_URL!);
    return `${u.protocol}//${u.hostname}:2096/sub/${subId}`;
  } catch {
    return `sub://${subId}`;
  }
}

function sanitizeEmail(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
  return cleaned || `qt${randomBytes(3).toString("hex")}`;
}

async function panelSettings() {
  try {
    const xui = createXuiFromEnv(env);
    const s = await xui.getSettings();
    return s.obj;
  } catch {
    return undefined;
  }
}

async function qrForSub(subUrl: string) {
  return QRCode.toBuffer(subUrl, { type: "png", width: 512, margin: 2 });
}

export async function provisionOrder(orderId: string): Promise<ProvisionResult | { kind: "wallet_credit"; balance: number }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, subscription: true, targetSub: true },
  });

  if (!order) throw new Error("سفارش پیدا نشد");

  if (order.kind === OrderKind.wallet_charge) {
    if (order.status === OrderStatus.completed) {
      throw new Error("این شارژ قبلاً اعمال شده");
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.provisioning },
    });
    try {
      const { creditWallet } = await import("./wallet.js");
      const balance = await creditWallet(order.userId, order.price, `charge:${order.id}`);
      await prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.completed },
      });
      return { kind: "wallet_credit", balance };
    } catch (err) {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.paid, adminNote: String(err) },
      });
      throw err;
    }
  }

  if (order.subscription) {
    throw new Error("برای این سفارش قبلاً اشتراک ساخته شده");
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.provisioning },
  });

  try {
    let result: ProvisionResultWithBulk | ProvisionResult;
    if (order.kind === OrderKind.renew && order.targetSub) {
      result = await renewSubscription(order, order.targetSub.id);
    } else if (order.kind === OrderKind.rotate_sub && order.targetSub) {
      result = await rotateSubId(order.targetSub.id);
    } else if (order.kind === OrderKind.rotate_uuid && order.targetSub) {
      result = await rotateUuid(order.targetSub.id);
    } else {
      result = await createPanelClientsBulk(order.user, order);
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.completed },
    });
    return result;
  } catch (err) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.paid, adminNote: String(err) },
    });
    throw err;
  }
}

export type ProvisionResultWithBulk = ProvisionResult & { bulk?: ProvisionResult[] };

async function createOnePanelClient(
  user: User,
  order: Order,
  opts: { email: string; linkOrderId: boolean },
): Promise<ProvisionResult> {
  const xui = createXuiFromEnv(env);
  const code = shortCode("QT");
  const email = sanitizeEmail(opts.email);
  const subId = randomSubId();
  const months = order.months || 1;
  const expiresAt = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000);
  const totalGB = gbToBytes(order.trafficGb);
  const inboundIds = await getConfiguredInboundIds();
  if (!inboundIds.length) {
    throw new Error("هیچ inbound id تنظیم نشده است");
  }

  await xui.addClient({
    client: {
      email,
      enable: true,
      expiryTime: expiresAt.getTime(),
      totalGB,
      limitIp: 0,
      tgId: Number(user.telegramId),
      subId,
      comment: email,
    },
    inboundIds,
  });

  if (user.panelGroup) {
    try {
      await xui.createGroup(user.panelGroup);
    } catch {
      /* may already exist */
    }
    try {
      await xui.bulkAddToGroup([email], user.panelGroup);
    } catch (err) {
      console.warn("bulkAddToGroup failed", err);
    }
  }

  const settings = await panelSettings();
  let clientUuid: string | null = null;
  let panelSubId = subId;
  try {
    const got = await xui.getClient(email);
    clientUuid = got.obj?.client?.uuid ?? got.obj?.client?.id ?? null;
    if (got.obj?.client?.subId) panelSubId = got.obj.client.subId;
  } catch {
    /* ignore */
  }

  const subUrl = buildSubUrl(panelSubId, settings);
  const qrPng = await qrForSub(subUrl);

  const subscription = await prisma.subscription.create({
    data: {
      code,
      userId: user.id,
      orderId: opts.linkOrderId ? order.id : null,
      title: email,
      email,
      clientUuid,
      panelSubId,
      trafficGb: order.trafficGb,
      expiresAt,
      subUrl,
      status: SubscriptionStatus.active,
    },
  });

  return {
    subscriptionId: subscription.id,
    code,
    email,
    subUrl,
    expiresAt,
    qrPng,
  };
}

/** Create 1..N panel clients (quantity > 1 = bulk). First sub is linked to the order. */
async function createPanelClientsBulk(user: User, order: Order): Promise<ProvisionResultWithBulk> {
  const qty = Math.max(1, Math.min(50, order.quantity ?? 1));
  const base = sanitizeEmail(order.accountName || order.customName || shortCode("QT"));
  const results: ProvisionResult[] = [];

  for (let i = 0; i < qty; i++) {
    const email = qty === 1 ? base : `${base}_${i + 1}`;
    const one = await createOnePanelClient(user, order, {
      email,
      linkOrderId: i === 0,
    });
    results.push(one);
  }

  const [first, ...rest] = results;
  return { ...first!, bulk: rest.length ? rest : undefined };
}

export async function renewSubscription(order: Order, subscriptionId: string): Promise<ProvisionResult> {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const xui = createXuiFromEnv(env);
  const got = await xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  const base = Math.max(Date.now(), sub.expiresAt.getTime(), client.expiryTime ?? 0);
  const months = order.months || 1;
  const expiresAt = new Date(base + months * 30 * 24 * 60 * 60 * 1000);
  const totalGB =
    order.trafficGb !== undefined && order.trafficGb !== null
      ? gbToBytes(order.trafficGb)
      : (client.totalGB ?? gbToBytes(sub.trafficGb));

  await xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    expiryTime: expiresAt.getTime(),
    totalGB,
    enable: true,
  });

  const settings = await panelSettings();
  const panelSubId = client.subId ?? sub.panelSubId ?? randomSubId();
  const subUrl = buildSubUrl(panelSubId, settings);
  const qrPng = await qrForSub(subUrl);

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      expiresAt,
      trafficGb: order.trafficGb ?? sub.trafficGb,
      subUrl,
      panelSubId,
      status: SubscriptionStatus.active,
    },
  });

  return {
    subscriptionId: updated.id,
    code: updated.code,
    email: updated.email,
    subUrl,
    expiresAt,
    qrPng,
  };
}

export async function rotateSubId(subscriptionId: string): Promise<ProvisionResult> {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const xui = createXuiFromEnv(env);
  const got = await xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  const newSubId = randomSubId();
  await xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    subId: newSubId,
  });

  const settings = await panelSettings();
  const subUrl = buildSubUrl(newSubId, settings);
  const qrPng = await qrForSub(subUrl);

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { panelSubId: newSubId, subUrl },
  });

  return {
    subscriptionId: updated.id,
    code: updated.code,
    email: updated.email,
    subUrl,
    expiresAt: updated.expiresAt,
    qrPng,
  };
}

export async function rotateUuid(subscriptionId: string): Promise<ProvisionResult> {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const xui = createXuiFromEnv(env);
  const got = await xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  let newUuid = randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  try {
    const nu = await xui.getNewUUID();
    if (typeof nu.obj === "string" && nu.obj) newUuid = nu.obj;
  } catch {
    /* use local uuid */
  }

  await xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    id: newUuid,
  });

  const settings = await panelSettings();
  const panelSubId = client.subId ?? sub.panelSubId ?? randomSubId();
  const subUrl = buildSubUrl(panelSubId, settings);
  const qrPng = await qrForSub(subUrl);

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { clientUuid: newUuid, subUrl, panelSubId },
  });

  return {
    subscriptionId: updated.id,
    code: updated.code,
    email: updated.email,
    subUrl,
    expiresAt: updated.expiresAt,
    qrPng,
  };
}
