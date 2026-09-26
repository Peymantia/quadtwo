import { OrderKind, OrderStatus, SubscriptionStatus, type Order, type Subscription } from "@prisma/client";
import { prisma } from "../db.js";
import { gbToBytes, monthsToMs } from "../utils/format.js";
import { isDemoMode } from "./license.js";
import { resolvePanelForSubscription } from "./panel-servers.js";
import { checkRenewEligibility } from "./renew-eligibility.js";
import { getSubscriptionTrafficBytes } from "./live-status.js";

/** Apply paid `edit` order: set traffic + absolute expiry from now + months (keeps used traffic). */
export async function editSubscriptionPackage(order: Order, subscriptionId: string) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const months = Math.max(1, order.months || 1);
  const expiresAt = new Date(Date.now() + monthsToMs(months));
  const trafficGb = order.trafficGb;

  if (isDemoMode() || !sub.panelServerId || sub.subUrl?.includes("demo.invalid")) {
    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        trafficGb,
        expiresAt,
        startsOnConnect: false,
        activatedAt: sub.activatedAt ?? new Date(),
        status: SubscriptionStatus.active,
      },
    });
    return updated;
  }

  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  const totalGB = trafficGb == null || trafficGb <= 0 ? 0 : gbToBytes(trafficGb);
  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    expiryTime: expiresAt.getTime(),
    totalGB,
    enable: true,
    ...(typeof order.limitIp === "number" && order.limitIp >= 0 ? { limitIp: order.limitIp } : {}),
  });

  return prisma.subscription.update({
    where: { id: sub.id },
    data: {
      trafficGb,
      expiresAt,
      startsOnConnect: false,
      activatedAt: sub.activatedAt ?? new Date(),
      panelExpiryTime: BigInt(expiresAt.getTime()),
      status: SubscriptionStatus.active,
      ...(resolved.panel && !sub.panelServerId ? { panelServerId: resolved.panel.id } : {}),
      ...(typeof order.limitIp === "number" ? { limitIp: order.limitIp } : {}),
    },
  });
}

/** True when the sub should consume a reserved renew (expired date or traffic depleted). */
export async function subscriptionNeedsReservedRenew(sub: Subscription): Promise<boolean> {
  if (sub.isTest) return false;
  if (sub.status === SubscriptionStatus.expired || sub.status === SubscriptionStatus.disabled) {
    return true;
  }
  if (sub.expiresAt.getTime() <= Date.now()) return true;

  // Traffic depleted (volume plans only)
  if (sub.trafficGb != null && sub.trafficGb > 0) {
    try {
      const traf = await getSubscriptionTrafficBytes(sub.id);
      if (traf.totalBytes > 0 && traf.usedBytes >= traf.totalBytes) return true;
    } catch {
      /* ignore */
    }
  }

  // Near-expiry eligibility also means "ready" for reserved apply if already reserved
  const elig = await checkRenewEligibility(sub.id);
  return elig.ok;
}

/**
 * Apply paid reserved renewals whose target subscription has ended / depleted.
 * Returns number of applied orders.
 */
export async function applyDueRenewalReservations(): Promise<number> {
  const reserved = await prisma.order.findMany({
    where: {
      kind: OrderKind.renew_reserve,
      status: OrderStatus.reserved,
      targetSubId: { not: null },
    },
    include: { targetSub: true, user: true },
    orderBy: { createdAt: "asc" },
    take: 40,
  });

  let applied = 0;
  for (const order of reserved) {
    if (!order.targetSub) continue;
    try {
      const due = await subscriptionNeedsReservedRenew(order.targetSub);
      if (!due) continue;

      const { renewSubscription } = await import("./provision.js");
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.provisioning },
      });
      await renewSubscription(order, order.targetSub.id);
      const { markOrderCompleted } = await import("./order-complete.js");
      await markOrderCompleted(order.id);
      applied += 1;

      try {
        const { notifyTelegramWithMainMenu } = await import("./push-main-menu.js");
        await notifyTelegramWithMainMenu(
          order.user.telegramId,
          [
            "✅ رزرو تمدید اعمال شد",
            "",
            `اکانت: ${order.targetSub.email}`,
            order.trafficGb == null ? "حجم: نامحدود" : `حجم: ${order.trafficGb} گیگ`,
            `مدت: ${order.months} ماه`,
          ].join("\n"),
        );
      } catch {
        /* best-effort */
      }
    } catch (err) {
      console.warn("[renew-reserve] apply failed", order.id, err);
      await prisma.order
        .update({
          where: { id: order.id },
          data: {
            status: OrderStatus.reserved,
            adminNote: String(err instanceof Error ? err.message : err).slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
  }
  return applied;
}

export function startRenewReserveCron() {
  const tick = async () => {
    try {
      const n = await applyDueRenewalReservations();
      if (n > 0) console.log(`[renew-reserve] applied ${n} reservation(s)`);
    } catch (err) {
      console.warn("[renew-reserve] cron error", err);
    }
  };
  void tick();
  setInterval(() => void tick(), 5 * 60 * 1000);
}
