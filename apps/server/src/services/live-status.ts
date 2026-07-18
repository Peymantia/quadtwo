import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { createXuiFromEnv } from "../panel/xui-client.js";
import { formatExpiryLabel, formatTraffic } from "../utils/format.js";
import { syncSubscriptionExpiryFromPanel } from "./provision.js";

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
  subUrl: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "۰";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} گیگ`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} مگ`;
  return `${Math.round(bytes / 1024)} کیلوبایت`;
}

/** Fetch live traffic/expiry from 3x-ui and format a user-facing card. */
export async function getLiveSubscriptionStatus(subscriptionId: string): Promise<LiveSubStatus | null> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return null;

  await syncSubscriptionExpiryFromPanel(sub.id);
  const fresh = (await prisma.subscription.findUnique({ where: { id: sub.id } })) ?? sub;

  let used = 0;
  let total = fresh.trafficGb === null ? 0 : fresh.trafficGb * 1024 * 1024 * 1024;
  let onlineHint = "";

  try {
    if (env.XUI_BASE_URL && env.XUI_API_TOKEN) {
      const xui = createXuiFromEnv(env);
      const traf = await xui.getClientTraffic(fresh.email);
      if (traf) {
        used = traf.used;
        if (traf.total > 0) total = traf.total;
        onlineHint = traf.enable === false ? "🔴 غیرفعال در پنل" : "🟢 فعال در پنل";
      }
      const got = await xui.getClient(fresh.email).catch(() => null);
      const panelExp = Number(got?.obj?.client?.expiryTime ?? 0);
      if (panelExp > 0 && (!fresh.activatedAt || fresh.expiresAt.getTime() !== panelExp)) {
        await prisma.subscription.update({
          where: { id: fresh.id },
          data: {
            expiresAt: new Date(panelExp),
            activatedAt: fresh.activatedAt ?? new Date(),
          },
        });
        fresh.expiresAt = new Date(panelExp);
        fresh.activatedAt = fresh.activatedAt ?? new Date();
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
    subUrl: fresh.subUrl,
  };
}

export function liveStatusText(live: LiveSubStatus): string {
  return [
    live.isTest ? "🧪 سرویس تست" : "📦 سرویس شما",
    "",
    `🆔 ${live.code}`,
    `اکانت: ${live.email}`,
    `حجم کل: ${live.trafficLabel}`,
    `مصرف‌شده: ${live.usedLabel}`,
    `باقی‌مانده: ${live.remainingLabel}`,
    `انقضا: ${live.expiryLabel}`,
    `وضعیت: ${live.status}`,
    live.onlineHint,
  ]
    .filter(Boolean)
    .join("\n");
}
