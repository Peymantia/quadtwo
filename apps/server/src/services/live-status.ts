import { prisma } from "../db.js";
import { formatExpiryLabel, formatTraffic } from "../utils/format.js";
import { resolvePanelForSubscription } from "./panel-servers.js";
import { syncSubscriptionExpiryFromPanel, refreshSubscriptionSubUrl } from "./provision.js";

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

/** Fetch live traffic/expiry from the subscription's 3x-ui panel. */
export async function getLiveSubscriptionStatus(subscriptionId: string): Promise<LiveSubStatus | null> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return null;

  await syncSubscriptionExpiryFromPanel(sub.id);
  const subUrl = await refreshSubscriptionSubUrl(sub.id);
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
      } = {};

      if (client.enable === false && fresh.status === "active") {
        patch.status = "disabled";
        onlineHint = "🔴 غیرفعال در پنل";
      } else if (client.enable !== false && fresh.status === "disabled" && fresh.expiresAt.getTime() > Date.now()) {
        patch.status = "active";
        onlineHint = "🟢 فعال در پنل";
      }

      const bytes = Number(client.totalGB ?? 0);
      const panelGb = bytes > 0 ? Math.max(1, Math.round(bytes / 1024 ** 3)) : null;
      if (panelGb !== fresh.trafficGb && (bytes > 0 || client.totalGB === 0 || client.totalGB == null)) {
        // totalGB 0 → unlimited (null)
        const nextGb = !bytes ? null : panelGb;
        if (nextGb !== fresh.trafficGb) patch.trafficGb = nextGb;
      }

      const panelExp = Number(client.expiryTime ?? 0);
      if (panelExp > 0 && (!fresh.activatedAt || Math.abs(fresh.expiresAt.getTime() - panelExp) > 60_000)) {
        patch.expiresAt = new Date(panelExp);
        patch.activatedAt = fresh.activatedAt ?? new Date();
        patch.startsOnConnect = false;
      }

      if (Object.keys(patch).length) {
        fresh = await prisma.subscription.update({
          where: { id: fresh.id },
          data: patch,
        });
      }
    }
  } catch {
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
        totalGb = Math.max(1, Math.round(traf.total / 1024 ** 3));
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
    `🆔 ${live.code}`,
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
