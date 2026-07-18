import QRCode from "qrcode";
import type { Order, Plan, User } from "@prisma/client";
import { OrderStatus, SubscriptionStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { createXuiFromEnv } from "../panel/xui-client.js";
import { gbToBytes, randomSubId, shortCode } from "../utils/format.js";

export type ProvisionResult = {
  subscriptionId: string;
  code: string;
  email: string;
  subUrl: string;
  shareLinks: string[];
  expiresAt: Date;
  qrPng: Buffer;
};

function buildSubUrl(subId: string, settings?: Record<string, unknown>): string {
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

  // fallback: panel host + /sub/
  try {
    const u = new URL(env.XUI_BASE_URL!);
    return `${u.protocol}//${u.hostname}:2096/sub/${subId}`;
  } catch {
    return `sub://${subId}`;
  }
}

export async function provisionOrder(orderId: string): Promise<ProvisionResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: true, user: true, subscription: true },
  });

  if (!order) throw new Error("سفارش پیدا نشد");
  if (order.subscription) {
    throw new Error("برای این سفارش قبلاً اشتراک ساخته شده");
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.provisioning },
  });

  try {
    const result = await createPanelClient(order.user, order.plan, order);
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

async function createPanelClient(
  user: User,
  plan: Plan,
  order: Order,
): Promise<ProvisionResult> {
  const xui = createXuiFromEnv(env);
  const code = shortCode("QT");
  const email = `qt${code.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
  const subId = randomSubId();
  const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);
  const totalGB = gbToBytes(plan.trafficGb);

  await xui.addClient({
    client: {
      email,
      enable: true,
      expiryTime: expiresAt.getTime(),
      totalGB,
      limitIp: 0,
      tgId: Number(user.telegramId),
      subId,
      comment: order.customName ?? code,
    },
    inboundIds: [env.XUI_INBOUND_ID],
  });

  let settings: Record<string, unknown> | undefined;
  try {
    const s = await xui.getSettings();
    settings = s.obj;
  } catch {
    settings = undefined;
  }

  let shareLinks: string[] = [];
  try {
    const links = await xui.clientLinks(email);
    shareLinks = Array.isArray(links.obj) ? links.obj : [];
  } catch {
    shareLinks = [];
  }

  let clientUuid: string | null = null;
  try {
    const got = await xui.getClient(email);
    clientUuid = got.obj?.client?.uuid ?? got.obj?.client?.id ?? null;
    if (got.obj?.client?.subId) {
      // prefer panel subId if returned
    }
  } catch {
    /* ignore */
  }

  const subUrl = buildSubUrl(subId, settings);
  const qrTarget = subUrl.startsWith("http") ? subUrl : shareLinks[0] ?? subUrl;
  const qrPng = await QRCode.toBuffer(qrTarget, { type: "png", width: 512, margin: 2 });

  const subscription = await prisma.subscription.create({
    data: {
      code,
      userId: user.id,
      orderId: order.id,
      title: order.customName ?? plan.title,
      email,
      clientUuid,
      trafficGb: plan.trafficGb,
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
    shareLinks,
    expiresAt,
    qrPng,
  };
}
