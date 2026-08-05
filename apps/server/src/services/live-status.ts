import { prisma } from "../db.js";
import { formatExpiryLabel, formatTraffic, bytesToGb } from "../utils/format.js";
import { resolvePanelForSubscription } from "./panel-servers.js";
import { syncSubscriptionExpiryFromPanel, refreshSubscriptionSubUrl } from "./provision.js";
import { applyPanelExpiryToBotData, panelExpiryDiffersFromBot } from "./panel-expiry.js";
import { isDemoMode } from "./license.js";
import { DEMO_SAMPLE_MARKER } from "./demo-samples.js";

const TEST_BYTES = 250 * 1024 * 1024;

export type LiveSubStatus = {
  code: string;
  email: string;
  status: string;
  isTest: boolean;
  trafficLabel: string;
  usedLabel: string;
  remainingLabel: string;
  expiryLabel: string;
  onlineHint: string;
  limitIpLabel: string;
  subUrl: string | null;
  panelEnabled: boolean | null;
  panelName: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "۰";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} گیگ`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} مگ`;
  return `${Math.round(bytes / 1024)} کیلوبایت`;
}

function isLocalDemoSub(sub: {
  subUrl: string | null;
  note: string | null;
  panelServerId: string | null;
}): boolean {
  if (isDemoMode()) return true;
  if (sub.subUrl?.includes("demo.invalid")) return true;
  if (sub.note?.includes(DEMO_SAMPLE_MARKER)) return true;
  return false;
}

function staticDbStatus(
  sub: {
    code: string;
    email: string;
    status: string;
    isTest: boolean;
    trafficGb: number | null;
    expiresAt: Date;
    startsOnConnect: boolean;
    activatedAt: Date | null;
    createdAt: Date;
    subUrl: string | null;
    limitIp: number;
  },
  onlineHint: string,
  panelName: string | null = null,
): LiveSubStatus {
  const total = sub.isTest ? TEST_BYTES : sub.trafficGb == null ? 0 : sub.trafficGb * 1024 ** 3;
  const lip = sub.limitIp ?? 0;
  return {
    code: sub.code,
    email: sub.email,
    status: sub.status,
    isTest: sub.isTest,
    trafficLabel: sub.isTest ? "۲۵۰ مگابایت" : formatTraffic(sub.trafficGb),
    usedLabel: "—",
    remainingLabel: sub.isTest
      ? formatBytes(TEST_BYTES)
      : total <= 0
        ? "نامحدود / نامشخص"
        : formatBytes(total),
    expiryLabel: formatExpiryLabel({
      expiresAt: sub.expiresAt,
      startsOnConnect: sub.startsOnConnect,
      activatedAt: sub.activatedAt,
      createdAt: sub.createdAt,
    }),
    onlineHint,
    limitIpLabel: lip <= 0 ? "نامحدود" : `${lip} دستگاه`,
    subUrl: sub.subUrl,
    panelEnabled: null,
    panelName,
  };
}

function localDemoStatus(sub: {
  code: string;
  email: string;
  status: string;
  isTest: boolean;
  trafficGb: number | null;
  expiresAt: Date;
  startsOnConnect: boolean;
  activatedAt: Date | null;
  createdAt: Date;
  subUrl: string | null;
  limitIp: number;
}): LiveSubStatus {
  return staticDbStatus(sub, "🎭 نمایشی — به پنل واقعی وصل نیست", "دیتابیس نمایشی");
}

function isServerlessNativeSub(sub: {
  serverless?: boolean;
  panelServerId: string | null;
  clientUuid: string | null;
}): boolean {
  if (sub.serverless) return true;
  return !sub.panelServerId && !sub.clientUuid;
}

/** Fetch live traffic/expiry from the subscription's 3x-ui panel. */
export async function getLiveSubscriptionStatus(subscriptionId: string): Promise<LiveSubStatus | null> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return null;

  if (isLocalDemoSub(sub)) {
    return localDemoStatus(sub);
  }

  // Serverless-delivered (no panel link): always show static order/DB data
  if (isServerlessNativeSub(sub)) {
    return staticDbStatus(sub, "📦 در شرایط فعلی اطلاعات مصرف زنده در دسترس نیست — بر اساس سفارش", "بدون پنل");
  }

  const { isServerlessEnabled } = await import("./settings.js");
  const serverlessMode = await isServerlessEnabled();

  try {
    await syncSubscriptionExpiryFromPanel(sub.id);
  } catch {
    if (serverlessMode) {
        return staticDbStatus(sub, "⚠️ در شرایط فعلی وضعیت پنل در دسترس نیست — اطلاعات بر اساس سفارش");
    }
  }
  let subUrl: string | null = sub.subUrl;
  try {
    subUrl = await refreshSubscriptionSubUrl(sub.id);
  } catch {
    if (serverlessMode) {
        return staticDbStatus(sub, "⚠️ در شرایط فعلی وضعیت پنل در دسترس نیست — اطلاعات بر اساس سفارش");
    }
  }
  let fresh = (await prisma.subscription.findUnique({ where: { id: sub.id } })) ?? sub;

  let used = 0;
  let total = fresh.trafficGb === null ? 0 : fresh.trafficGb * 1024 * 1024 * 1024;
  let onlineHint = "";
  let limitIpLabel = "";
  let panelEnabled: boolean | null = null;
  let panelName: string | null = null;

  try {
    const resolved = await resolvePanelForSubscription(fresh);
    panelName = resolved.name;
    const traf = await resolved.xui.getClientTraffic(fresh.email);
    if (traf) {
      used = traf.used;
      if (traf.total > 0) total = traf.total;
      if (traf.enable !== undefined) panelEnabled = traf.enable;
      onlineHint = traf.enable === false ? "🔴 غیرفعال در پنل" : "🟢 فعال در پنل";
    }
    const got = await resolved.xui.getClient(fresh.email).catch(() => null);
    const client = got?.obj?.client;
    if (!client) {
      if (serverlessMode) {
      return staticDbStatus(fresh, "⚠️ در شرایط فعلی وضعیت پنل در دسترس نیست — اطلاعات بر اساس سفارش", panelName);
      }
      onlineHint = "🔴 در پنل پیدا نشد";
      panelEnabled = false;
      if (fresh.status === "active") {
        fresh = await prisma.subscription.update({
          where: { id: fresh.id },
          data: { status: "disabled" },
        });
      }
    } else {
      const lip = Number(client.limitIp ?? 0);
      limitIpLabel = lip <= 0 ? "نامحدود" : `${lip} دستگاه`;
      if (client.enable !== undefined) panelEnabled = client.enable;

      const patch: {
        status?: "active" | "disabled" | "expired";
        trafficGb?: number | null;
        expiresAt?: Date;
        activatedAt?: Date | null;
        startsOnConnect?: boolean;
        panelExpiryTime?: bigint;
      } = {};

      if (client.enable === false && fresh.status === "active") {
        patch.status = "disabled";
        onlineHint = "🔴 غیرفعال در پنل";
      } else if (client.enable !== false && fresh.status === "disabled" && fresh.expiresAt.getTime() > Date.now()) {
        patch.status = "active";
        onlineHint = "🟢 فعال در پنل";
      }

      const bytes = Number(client.totalGB ?? 0);
      const panelGb = bytes > 0 ? bytesToGb(bytes) : null;
      if (panelGb !== fresh.trafficGb && (bytes > 0 || client.totalGB === 0 || client.totalGB == null)) {
        // totalGB 0 → unlimited (null)
        const nextGb = !bytes ? null : panelGb;
        if (nextGb !== fresh.trafficGb) patch.trafficGb = nextGb;
      }

      const panelExp = Number(client.expiryTime ?? 0);
      if (panelExpiryDiffersFromBot(panelExp, fresh)) {
        const next = applyPanelExpiryToBotData(panelExp, fresh);
        patch.expiresAt = next.expiresAt;
        patch.activatedAt = next.activatedAt;
        patch.startsOnConnect = next.startsOnConnect;
        patch.panelExpiryTime = next.panelExpiryTime;
      }

      if (Object.keys(patch).length) {
        fresh = await prisma.subscription.update({
          where: { id: fresh.id },
          data: patch,
        });
      }
    }
  } catch {
    if (serverlessMode) {
      return staticDbStatus(fresh, "⚠️ در شرایط فعلی وضعیت پنل در دسترس نیست — اطلاعات بر اساس سفارش");
    }
    onlineHint = "⚠️ وضعیت پنل در دسترس نیست";
  }

  const remaining = total > 0 ? Math.max(0, total - used) : null;

  return {
    code: fresh.code,
    email: fresh.email,
    status: fresh.status,
    isTest: fresh.isTest,
    trafficLabel: fresh.isTest ? "۲۵۰ مگابایت" : formatTraffic(fresh.trafficGb),
    usedLabel: formatBytes(used),
    remainingLabel: fresh.isTest
      ? formatBytes(Math.max(0, TEST_BYTES - used))
      : remaining === null
        ? "نامحدود / نامشخص"
        : formatBytes(remaining),
    expiryLabel: formatExpiryLabel({
      expiresAt: fresh.expiresAt,
      startsOnConnect: fresh.startsOnConnect,
      activatedAt: fresh.activatedAt,
      createdAt: fresh.createdAt,
    }),
    onlineHint,
    limitIpLabel,
    subUrl: subUrl ?? fresh.subUrl,
    panelEnabled,
    panelName,
  };
}

/** Lightweight used/total bytes for dashboard progress bars. */
export async function getSubscriptionTrafficBytes(
  subscriptionId: string,
): Promise<{ usedBytes: number; totalBytes: number; totalGb: number | null }> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return { usedBytes: 0, totalBytes: 0, totalGb: null };
  if (isLocalDemoSub(sub)) {
    if (sub.isTest) return { usedBytes: 0, totalBytes: TEST_BYTES, totalGb: 0.25 };
    const totalBytes = sub.trafficGb == null ? 0 : sub.trafficGb * 1024 ** 3;
    return { usedBytes: 0, totalBytes, totalGb: sub.trafficGb };
  }
  if (sub.serverless || (!sub.panelServerId && !sub.clientUuid)) {
    const totalBytes = sub.isTest ? TEST_BYTES : sub.trafficGb == null ? 0 : sub.trafficGb * 1024 ** 3;
    return { usedBytes: 0, totalBytes, totalGb: sub.isTest ? 0.25 : sub.trafficGb };
  }
  let usedBytes = 0;
  let totalBytes = sub.trafficGb == null ? 0 : sub.trafficGb * 1024 ** 3;
  let totalGb = sub.trafficGb;
  try {
    const resolved = await resolvePanelForSubscription(sub);
    const traf = await resolved.xui.getClientTraffic(sub.email);
    if (traf) {
      usedBytes = traf.used;
      if (traf.total > 0) {
        totalBytes = traf.total;
        totalGb = bytesToGb(traf.total) ?? totalGb;
      }
    }
  } catch {
    /* keep DB totals */
  }
  if (sub.isTest) {
    totalBytes = TEST_BYTES;
    totalGb = 0.25;
  }
  return { usedBytes, totalBytes, totalGb };
}

export function liveStatusText(live: LiveSubStatus): string {
  return [
    live.isTest ? "🧪 سرویس تست" : "📦 سرویس شما",
    "",
    `🔑 ${live.code}`,
    `اکانت: ${live.email}`,
    live.panelName ? `🖥 سرور: ${live.panelName}` : "",
    `حجم کل: ${live.trafficLabel}`,
    `مصرف‌شده: ${live.usedLabel}`,
    `باقی‌مانده: ${live.remainingLabel}`,
    live.limitIpLabel ? `📱 محدودیت کاربر: ${live.limitIpLabel}` : "",
    `انقضا: ${live.expiryLabel}`,
    `وضعیت: ${live.status}`,
    live.onlineHint,
  ]
    .filter(Boolean)
    .join("\n");
}
