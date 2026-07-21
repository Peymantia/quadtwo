import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Order, User } from "@prisma/client";
import { OrderKind, OrderStatus, SubscriptionStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import type { XuiClient } from "../panel/xui-client.js";
import { gbToBytes, monthsToMs, firstConnectExpiryMs, randomSubId, shortCode } from "../utils/format.js";
import { ensureClientsInGroup, resolveClientGroup } from "./panel-groups.js";
import {
  resolvePanelForCategory,
  resolvePanelForSubscription,
} from "./panel-servers.js";
import type { PlanCategory } from "./pricing.js";
import { getDefaultLimitIp } from "./settings.js";
import { appendSubId, isValidSubBase, sanitizeSubBase } from "./sub-url.js";

export type ProvisionResult = {
  subscriptionId: string;
  code: string;
  email: string;
  subUrl: string;
  expiresAt: Date;
  qrPng: Buffer;
};

async function newClientUuid(xui: XuiClient): Promise<string> {
  try {
    const nu = await xui.getNewUUID();
    if (typeof nu.obj === "string" && nu.obj.trim()) return nu.obj.trim();
  } catch {
    /* fall through */
  }
  return randomBytes(16)
    .toString("hex")
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

function panelSubTls(settings?: Record<string, unknown>) {
  const cert = settings?.subCertFile;
  const key = settings?.subKeyFile;
  if (typeof cert === "string" && cert.trim() && typeof key === "string" && key.trim()) return true;
  if (settings?.subTLS === true) return true;
  return false;
}

function hostnameFromPanelUrl(panelBaseUrl?: string | null): string {
  const candidates = [panelBaseUrl, env.XUI_BASE_URL];
  for (const c of candidates) {
    if (!c?.trim()) continue;
    try {
      const host = new URL(c).hostname;
      if (host && host !== "127.0.0.1" && host !== "localhost") return host;
      if (host) return host;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** Rebuild like 3x-ui BuildSubURIBase + subPath. */
function reconstructSubBase(
  settings?: Record<string, unknown>,
  panelBaseUrl?: string | null,
): string | null {
  const subPathRaw =
    typeof settings?.subPath === "string" && settings.subPath.trim()
      ? settings.subPath.trim()
      : "/sub/";
  const subPath = subPathRaw.startsWith("/") ? subPathRaw : `/${subPathRaw}`;
  const pathNorm = subPath.endsWith("/") ? subPath : `${subPath}/`;

  const subDomain =
    (typeof settings?.subDomain === "string" && settings.subDomain.trim()) ||
    hostnameFromPanelUrl(panelBaseUrl);
  if (!subDomain) return null;

  const subPort = Number(settings?.subPort ?? 2096);
  const subTls = panelSubTls(settings);
  const scheme = subTls ? "https" : "http";
  const hidePort = (subPort === 443 && subTls) || (subPort === 80 && !subTls);
  const host = hidePort ? subDomain : `${subDomain}:${subPort}`;
  return `${scheme}://${host}${pathNorm}`;
}

/**
 * Build subscription page URL the same way 3x-ui panel does.
 * Never falls back to PUBLIC_DOMAIN / Mini App host.
 */
export function buildSubUrl(
  subId: string,
  settings?: Record<string, unknown>,
  subBaseOverride?: string | null,
  panelBaseUrl?: string | null,
): string {
  const override = sanitizeSubBase(subBaseOverride);
  if (override) return appendSubId(override, subId);

  const fromEnv = sanitizeSubBase(env.XUI_SUB_BASE);
  if (fromEnv) return appendSubId(fromEnv, subId);

  const subURI = typeof settings?.subURI === "string" ? settings.subURI.trim() : "";
  const fromPanel = sanitizeSubBase(subURI);
  if (fromPanel) return appendSubId(fromPanel, subId);

  const rebuilt = reconstructSubBase(settings, panelBaseUrl);
  if (rebuilt) return appendSubId(rebuilt, subId);

  return `sub://${subId}`;
}

async function panelSettings(xui: XuiClient) {
  let merged: Record<string, unknown> = {};
  try {
    const all = await xui.getSettings();
    if (all.obj && typeof all.obj === "object") merged = { ...all.obj };
  } catch {
    /* ignore */
  }
  try {
    // defaultSettings includes computed subURI (same as panel UI)
    const def = await xui.getDefaultSettings();
    if (def.obj && typeof def.obj === "object") {
      merged = { ...merged, ...def.obj };
    }
  } catch {
    /* ignore */
  }
  return merged;
}

export async function resolveSubUrl(
  subId: string,
  xui: XuiClient,
  subBaseOverride?: string | null,
): Promise<string> {
  const settings = await panelSettings(xui);
  return buildSubUrl(subId, settings, subBaseOverride, xui.panelBaseUrl);
}

export async function refreshSubscriptionSubUrl(subscriptionId: string): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return null;

  try {
    const resolved = await resolvePanelForSubscription(sub);
    let panelSubId = sub.panelSubId;
    try {
      const got = await resolved.xui.getClient(sub.email);
      if (got.obj?.client?.subId) panelSubId = got.obj.client.subId;
    } catch {
      /* ignore */
    }
    if (!panelSubId) return sub.subUrl;

    const subBase = sanitizeSubBase(resolved.subBase);
    const subUrl = await resolveSubUrl(panelSubId, resolved.xui, subBase);

    // Heal bad PanelServer.subBase so next reads don't keep using Mini App host
    if (resolved.panel && resolved.subBase && !isValidSubBase(resolved.subBase)) {
      try {
        await prisma.panelServer.update({
          where: { id: resolved.panel.id },
          data: { subBase: null },
        });
      } catch {
        /* ignore */
      }
    }

    const data: { subUrl: string; panelSubId: string; panelServerId?: string } = {
      subUrl,
      panelSubId,
    };
    if (resolved.panel && !sub.panelServerId) {
      data.panelServerId = resolved.panel.id;
    }
    if (subUrl !== sub.subUrl || panelSubId !== sub.panelSubId || data.panelServerId) {
      await prisma.subscription.update({ where: { id: sub.id }, data });
    }
    return subUrl;
  } catch (err) {
    console.error("refreshSubscriptionSubUrl", subscriptionId, err);
    if (sub.subUrl?.startsWith("http") && isValidSubBase(sub.subUrl.replace(/\/[^/]+\/?$/, "/"))) {
      return sub.subUrl;
    }
    return sub.subUrl?.startsWith("http") ? sub.subUrl : null;
  }
}

function sanitizeEmail(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
  return cleaned || `qt${randomBytes(3).toString("hex")}`;
}

async function qrForSub(subUrl: string) {
  return QRCode.toBuffer(subUrl, { type: "png", width: 512, margin: 2 });
}

function inferCategoryFromOrder(order: Order): PlanCategory {
  if (order.trafficGb === null) return "unlimited";
  return "data";
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
  opts: {
    email: string;
    linkOrderId: boolean;
    xui: XuiClient;
    inboundIds: number[];
    subBase: string | null;
    panelServerId: string | null;
  },
): Promise<ProvisionResult> {
  const code = shortCode("QT");
  const email = sanitizeEmail(opts.email);
  const subId = randomSubId();
  const months = order.months || 1;
  const panelExpiry = firstConnectExpiryMs(months);
  const expiresAt = new Date(Date.now() + monthsToMs(months));
  const totalGB = gbToBytes(order.trafficGb);
  if (!opts.inboundIds.length) {
    throw new Error("هیچ inbound تنظیم نشده — در کنترل سنتر سرورهای پنل / Inbounds را پر کنید");
  }

  const limitIp =
    typeof order.limitIp === "number" && order.limitIp >= 0
      ? order.limitIp
      : await getDefaultLimitIp();

  await opts.xui.addClient({
    client: {
      id: await newClientUuid(opts.xui),
      email,
      enable: true,
      expiryTime: panelExpiry,
      totalGB,
      limitIp,
      tgId: Number(user.telegramId),
      subId,
      comment: email,
    },
    inboundIds: opts.inboundIds,
  });

  const group = resolveClientGroup(user);
  await ensureClientsInGroup(opts.xui, [email], group);

  let clientUuid: string | null = null;
  let panelSubId = subId;
  try {
    const got = await opts.xui.getClient(email);
    clientUuid = got.obj?.client?.uuid
      ? String(got.obj.client.uuid)
      : got.obj?.client?.id != null
        ? String(got.obj.client.id)
        : null;
    if (got.obj?.client?.subId) panelSubId = got.obj.client.subId;
  } catch {
    /* ignore */
  }

  const subUrl = await resolveSubUrl(panelSubId, opts.xui, opts.subBase);
  const qrPng = await qrForSub(subUrl);

  const note = order.note?.trim() ? order.note.trim().slice(0, 500) : null;
  const subscription = await prisma.subscription.create({
    data: {
      code,
      userId: user.id,
      orderId: opts.linkOrderId ? order.id : null,
      panelServerId: opts.panelServerId,
      title: email,
      email,
      clientUuid,
      panelSubId,
      trafficGb: order.trafficGb,
      startsOnConnect: true,
      activatedAt: null,
      expiresAt,
      subUrl,
      note,
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

async function createPanelClientsBulk(user: User, order: Order): Promise<ProvisionResultWithBulk> {
  let resolved = order.panelServerId
    ? await resolvePanelForSubscription({ panelServerId: order.panelServerId })
    : await resolvePanelForCategory(inferCategoryFromOrder(order));

  if (!order.panelServerId && resolved.panel) {
    await prisma.order.update({
      where: { id: order.id },
      data: { panelServerId: resolved.panel.id },
    });
  }

  const qty = Math.max(1, Math.min(50, order.quantity ?? 1));
  const base = sanitizeEmail(order.accountName || order.customName || shortCode("QT"));
  const results: ProvisionResult[] = [];

  for (let i = 0; i < qty; i++) {
    const email = qty === 1 ? base : `${base}_${i + 1}`;
    const one = await createOnePanelClient(user, order, {
      email,
      linkOrderId: i === 0,
      xui: resolved.xui,
      inboundIds: resolved.inboundIds,
      subBase: resolved.subBase,
      panelServerId: resolved.panel?.id ?? order.panelServerId,
    });
    results.push(one);
  }

  const [first, ...rest] = results;
  return { ...first!, bulk: rest.length ? rest : undefined };
}

export async function renewSubscription(order: Order, subscriptionId: string): Promise<ProvisionResult> {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  const months = order.months || 1;
  const addMs = monthsToMs(months);
  const panelExpiry = Number(client.expiryTime ?? 0);
  let expiryTime: number;
  let expiresAt: Date;
  let startsOnConnect = sub.startsOnConnect;
  let activatedAt = sub.activatedAt;

  if (panelExpiry < 0) {
    expiryTime = panelExpiry - addMs;
    expiresAt = new Date(Date.now() + Math.abs(expiryTime));
    startsOnConnect = true;
    activatedAt = null;
  } else {
    const base = Math.max(Date.now(), sub.expiresAt.getTime(), panelExpiry);
    expiresAt = new Date(base + addMs);
    expiryTime = expiresAt.getTime();
    if (!activatedAt && panelExpiry > 0) activatedAt = new Date();
  }

  const totalGB = order.trafficGb === null ? 0 : gbToBytes(order.trafficGb);

  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    expiryTime,
    totalGB,
    enable: true,
    // Reset usage so the renewed package starts fresh
    up: 0,
    down: 0,
    ...(typeof order.limitIp === "number" && order.limitIp >= 0 ? { limitIp: order.limitIp } : {}),
  });

  const panelSubId = client.subId ?? sub.panelSubId ?? randomSubId();
  const subUrl = await resolveSubUrl(panelSubId, resolved.xui, resolved.subBase);
  const qrPng = await qrForSub(subUrl);

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      expiresAt,
      trafficGb: order.trafficGb ?? sub.trafficGb,
      subUrl,
      panelSubId,
      startsOnConnect,
      activatedAt,
      status: SubscriptionStatus.active,
      ...(resolved.panel && !sub.panelServerId ? { panelServerId: resolved.panel.id } : {}),
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

export async function syncSubscriptionExpiryFromPanel(subscriptionId: string): Promise<void> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || !sub.startsOnConnect || sub.activatedAt) return;
  try {
    const resolved = await resolvePanelForSubscription(sub);
    const got = await resolved.xui.getClient(sub.email);
    const panelExpiry = Number(got.obj?.client?.expiryTime ?? 0);
    if (panelExpiry > 0) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          expiresAt: new Date(panelExpiry),
          activatedAt: new Date(),
        },
      });
    }
  } catch {
    /* panel unreachable */
  }
}

export async function rotateSubId(subscriptionId: string): Promise<ProvisionResult> {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  const newSubId = randomSubId();
  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    subId: newSubId,
  });

  const subUrl = await resolveSubUrl(newSubId, resolved.xui, resolved.subBase);
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

export async function toggleSubscriptionEnabled(subscriptionId: string, userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
  if (!sub) throw new Error("سرویس پیدا نشد");

  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  const currentlyEnabled = client.enable !== false;
  const newEnable = !currentlyEnabled;
  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    enable: newEnable,
  });
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: newEnable ? SubscriptionStatus.active : SubscriptionStatus.disabled,
    },
  });
  return newEnable;
}

export async function rotateUuid(subscriptionId: string): Promise<ProvisionResult> {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  let newUuid = randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  try {
    const nu = await resolved.xui.getNewUUID();
    if (typeof nu.obj === "string" && nu.obj) newUuid = nu.obj;
  } catch {
    /* use local uuid */
  }

  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    id: String(newUuid),
    uuid: String(newUuid),
  });

  const panelSubId = client.subId ?? sub.panelSubId ?? randomSubId();
  const subUrl = await resolveSubUrl(panelSubId, resolved.xui, resolved.subBase);
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
