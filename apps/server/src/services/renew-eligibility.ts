import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { resolvePanelForSubscription } from "./panel-servers.js";
import { syncSubscriptionExpiryFromPanel } from "./provision.js";
import { getNotifConfig } from "./settings.js";
import type { PlanCategory } from "./pricing.js";

const MS_HOUR = 60 * 60 * 1000;

export type RenewEligibility = {
  ok: boolean;
  /** User-facing deny reason when ok=false */
  message: string;
  /** Why renew is allowed */
  reason?: "expired_date" | "expired_traffic" | "near_date" | "near_traffic" | "disabled";
  remainingMb?: number | null;
  hoursLeft?: number | null;
};

/**
 * Renew only when service is finished or about to finish (volume or date).
 * Thresholds reuse notification settings (expiry hours / traffic MB).
 */
export async function checkRenewEligibility(subscriptionId: string): Promise<RenewEligibility> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) {
    return { ok: false, message: "سرویس پیدا نشد." };
  }
  if (sub.isTest) {
    return { ok: false, message: "سرویس تست قابل تمدید نیست. لطفاً سرویس اصلی بخرید." };
  }

  const cfg = await getNotifConfig();
  const nearHours = Math.max(1, cfg.expiryDays?.hours ?? 24);
  const nearMb = Math.max(1, cfg.traffic?.megabytes ?? 200);

  await syncSubscriptionExpiryFromPanel(sub.id).catch(() => undefined);
  const fresh = (await prisma.subscription.findUnique({ where: { id: sub.id } })) ?? sub;

  if (fresh.status === SubscriptionStatus.disabled) {
    return {
      ok: true,
      reason: "disabled",
      message: "سرویس غیرفعال است و می‌توانید تمدید کنید.",
    };
  }

  const now = Date.now();
  const clockStarted = !fresh.startsOnConnect || Boolean(fresh.activatedAt);

  // Not started yet — nothing to renew
  if (!clockStarted) {
    return {
      ok: false,
      message: "این سرویس هنوز فعال نشده (منتظر اولین اتصال است). تمدید فقط نزدیک اتمام یا بعد از اتمام ممکن است.",
    };
  }

  const msLeft = fresh.expiresAt.getTime() - now;
  const hoursLeft = msLeft / MS_HOUR;

  if (msLeft <= 0 || fresh.status === SubscriptionStatus.expired) {
    return {
      ok: true,
      reason: "expired_date",
      hoursLeft: 0,
      message: "سرویس از نظر تاریخ تمام شده و قابل تمدید است.",
    };
  }

  if (hoursLeft <= nearHours) {
    return {
      ok: true,
      reason: "near_date",
      hoursLeft,
      message: `حدود ${Math.max(1, Math.round(hoursLeft))} ساعت تا اتمام تاریخ باقی مانده.`,
    };
  }

  // Volume check (skip unlimited)
  if (fresh.trafficGb !== null) {
    try {
      const resolved = await resolvePanelForSubscription(fresh);
      const traf = await resolved.xui.getClientTraffic(fresh.email);
      if (traf) {
        const total = traf.total > 0 ? traf.total : fresh.trafficGb * 1024 * 1024 * 1024;
        const remaining = Math.max(0, total - traf.used);
        const remainingMb = remaining / (1024 * 1024);

        if (remainingMb <= 0 || (traf.enable === false && remainingMb <= nearMb)) {
          return {
            ok: true,
            reason: "expired_traffic",
            remainingMb,
            hoursLeft,
            message: "حجم سرویس تمام شده و قابل تمدید است.",
          };
        }
        if (remainingMb <= nearMb) {
          return {
            ok: true,
            reason: "near_traffic",
            remainingMb,
            hoursLeft,
            message: `حدود ${Math.round(remainingMb)} مگابایت حجم باقی مانده.`,
          };
        }
      }
    } catch {
      /* panel down — fall through to deny by date only */
    }
  }

  return {
    ok: false,
    hoursLeft,
    message: [
      "⏳ تمدید فقط وقتی ممکن است که سرویس:",
      "• در حال اتمام باشد (حجم یا تاریخ)، یا",
      "• تمام شده باشد.",
      "",
      `الان حدود ${Math.max(1, Math.round(hoursLeft))} ساعت تا انقضا باقی است`,
      fresh.trafficGb !== null ? "و حجم هنوز به آستانه اتمام نرسیده." : "و سرویس نامحدود است.",
      "",
      `آستانه: ${nearHours} ساعت قبل از انقضا` +
        (fresh.trafficGb !== null ? ` / کمتر از ${nearMb} مگ حجم` : ""),
    ].join("\n"),
  };
}

export async function listRenewableSubscriptions(userId: string) {
  const subs = await prisma.subscription.findMany({
    where: {
      userId,
      isTest: false,
      status: { in: [SubscriptionStatus.active, SubscriptionStatus.expired, SubscriptionStatus.disabled] },
    },
    orderBy: { expiresAt: "asc" },
    take: 40,
  });

  const out: typeof subs = [];
  for (const s of subs) {
    const el = await checkRenewEligibility(s.id);
    if (el.ok) out.push(s);
  }
  return out.slice(0, 12);
}

/** Infer plan category for renew pricing (Order has no category column). */
export async function inferRenewCategory(sub: {
  trafficGb: number | null;
  panelServerId: string | null;
  orderId: string | null;
}): Promise<PlanCategory> {
  if (sub.trafficGb === null) return "unlimited";

  if (sub.panelServerId) {
    const panel = await prisma.panelServer.findUnique({ where: { id: sub.panelServerId } });
    if (panel) {
      try {
        const cats = JSON.parse(panel.categories) as string[];
        if (Array.isArray(cats)) {
          if (cats.includes("national") && !cats.includes("data")) return "national";
        }
      } catch {
        /* ignore */
      }
    }
  }

  return "data";
}
