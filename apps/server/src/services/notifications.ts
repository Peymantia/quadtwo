import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { formatTraffic } from "../utils/format.js";
import { resolvePanelForSubscription } from "./panel-servers.js";
import { getNotifConfig, type NotifConfig } from "./settings.js";
import { syncSubscriptionExpiryFromPanel } from "./provision.js";

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

function dayBucket(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function alreadySent(subscriptionId: string, kind: string, bucket: string) {
  const row = await prisma.notificationLog.findUnique({
    where: { subscriptionId_kind_bucket: { subscriptionId, kind, bucket } },
  });
  return Boolean(row);
}

async function markSent(subscriptionId: string, kind: string, bucket: string) {
  await prisma.notificationLog
    .create({
      data: { subscriptionId, kind, bucket },
    })
    .catch(() => undefined);
}

function renewKeyboard(subId: string) {
  return new InlineKeyboard().text("♻️ تمدید سرویس", `sub:renew:${subId}`).success();
}

async function sendUser(
  api: Api,
  telegramId: bigint,
  text: string,
  replyMarkup?: InlineKeyboard,
) {
  try {
    await api.sendMessage(Number(telegramId), text, replyMarkup ? { reply_markup: replyMarkup } : undefined);
    return true;
  } catch (err) {
    console.warn("notif send failed", String(telegramId), err);
    return false;
  }
}

function remainingMb(totalBytes: number, usedBytes: number): number | null {
  if (!totalBytes || totalBytes <= 0) return null;
  const rem = Math.max(0, totalBytes - usedBytes);
  return rem / (1024 * 1024);
}

export async function runNotificationSweep(api: Api): Promise<{ sent: number; checked: number }> {
  const cfg = await getNotifConfig();
  if (!cfg.expiryDays.enabled && !cfg.traffic.enabled && !cfg.preDelete.enabled && !cfg.deleted.enabled) {
    return { sent: 0, checked: 0 };
  }

  const subs = await prisma.subscription.findMany({
    where: { status: SubscriptionStatus.active },
    include: { user: true },
    take: 500,
    orderBy: { expiresAt: "asc" },
  });

  let sent = 0;
  const now = Date.now();

  for (const sub of subs) {
    if (sub.startsOnConnect && !sub.activatedAt) {
      await syncSubscriptionExpiryFromPanel(sub.id);
      const fresh = await prisma.subscription.findUnique({ where: { id: sub.id } });
      if (fresh) {
        sub.expiresAt = fresh.expiresAt;
        sub.activatedAt = fresh.activatedAt;
      }
    }

    const clockStarted = !sub.startsOnConnect || Boolean(sub.activatedAt);
    const canOfferRenew = !sub.isTest;

    if (cfg.expiryDays.enabled && clockStarted) {
      const msLeft = sub.expiresAt.getTime() - now;
      const hoursLeft = msLeft / MS_HOUR;
      if (msLeft > 0 && hoursLeft <= cfg.expiryDays.hours) {
        const bucket = `exp:${sub.expiresAt.getTime()}:${cfg.expiryDays.hours}`;
        if (!(await alreadySent(sub.id, "expiryDays", bucket))) {
          const ok = await sendUser(
            api,
            sub.user.telegramId,
            [
              "📅 هشدار اتمام روز",
              "",
              `سرویس: ${sub.code} (${sub.email})`,
              `حجم: ${formatTraffic(sub.trafficGb)}`,
              `انقضا: ${sub.expiresAt.toLocaleString("fa-IR")}`,
              `حدود ${Math.max(1, Math.round(hoursLeft))} ساعت تا پایان اعتبار باقی مانده.`,
              "",
              canOfferRenew ? "برای تمدید، دکمه زیر را بزنید." : "سرویس تست قابل تمدید نیست — سرویس اصلی بخرید.",
            ].join("\n"),
            canOfferRenew ? renewKeyboard(sub.id) : undefined,
          );
          if (ok) {
            await markSent(sub.id, "expiryDays", bucket);
            sent++;
          }
        }
      }
    }

    if (cfg.preDelete.enabled && clockStarted) {
      const msAfter = now - sub.expiresAt.getTime();
      const hoursPast = msAfter / MS_HOUR;
      const msUntil = sub.expiresAt.getTime() - now;
      const inWindow =
        (msUntil > 0 && msUntil <= cfg.preDelete.hours * MS_HOUR) ||
        (msAfter >= 0 && hoursPast <= cfg.preDelete.hours);
      if (inWindow) {
        const bucket = `pre:${sub.expiresAt.getTime()}:${cfg.preDelete.hours}`;
        if (!(await alreadySent(sub.id, "preDelete", bucket))) {
          const ok = await sendUser(
            api,
            sub.user.telegramId,
            [
              "⚠️ هشدار قبل از حذف",
              "",
              `سرویس: ${sub.code} (${sub.email})`,
              `حدود ${cfg.preDelete.hours} ساعت تا حذف خودکار از پنل باقی مانده (یا اخیراً منقضی شده).`,
              "اگر تمدید نکنید، سرویس از پنل پاک می‌شود.",
              "",
              canOfferRenew ? "برای تمدید، دکمه زیر را بزنید." : "سرویس تست قابل تمدید نیست — سرویس اصلی بخرید.",
            ].join("\n"),
            canOfferRenew ? renewKeyboard(sub.id) : undefined,
          );
          if (ok) {
            await markSent(sub.id, "preDelete", bucket);
            sent++;
          }
        }
      }
    }

    let panelXui: Awaited<ReturnType<typeof resolvePanelForSubscription>>["xui"] | null = null;
    if (cfg.traffic.enabled || cfg.deleted.enabled) {
      try {
        panelXui = (await resolvePanelForSubscription(sub)).xui;
      } catch {
        panelXui = null;
      }
    }

    if (cfg.traffic.enabled && sub.trafficGb !== null && panelXui) {
      try {
        const traf = await panelXui.getClientTraffic(sub.email);
        if (traf) {
          const total = traf.total > 0 ? traf.total : sub.trafficGb * 1024 * 1024 * 1024;
          const remMb = remainingMb(total, traf.used);
          if (remMb !== null && remMb <= cfg.traffic.megabytes) {
            const bucket = `traf:${dayBucket()}:${cfg.traffic.megabytes}`;
            if (!(await alreadySent(sub.id, "traffic", bucket))) {
              const ok = await sendUser(
                api,
                sub.user.telegramId,
                [
                  "📦 هشدار اتمام حجم",
                  "",
                  `سرویس: ${sub.code} (${sub.email})`,
                  `باقی‌مانده تقریبی: ${Math.round(remMb)} مگابایت`,
                  `آستانه هشدار: ${cfg.traffic.megabytes} مگابایت`,
                  "",
                  canOfferRenew ? "برای تمدید، دکمه زیر را بزنید." : "سرویس تست قابل تمدید نیست — سرویس اصلی بخرید.",
                ].join("\n"),
                canOfferRenew ? renewKeyboard(sub.id) : undefined,
              );
              if (ok) {
                await markSent(sub.id, "traffic", bucket);
                sent++;
              }
            }
          }
        }
      } catch (err) {
        console.warn("traffic check failed", sub.email, err);
      }
    }

    if (cfg.deleted.enabled && panelXui && clockStarted) {
      const pastGrace = now > sub.expiresAt.getTime() + cfg.preDelete.hours * MS_HOUR;
      if (pastGrace || now > sub.expiresAt.getTime() + 2 * MS_DAY) {
        let missing = false;
        try {
          const got = await panelXui.getClient(sub.email);
          if (!got.obj?.client) missing = true;
          else if (got.obj.client.enable === false && now > sub.expiresAt.getTime()) missing = true;
        } catch {
          missing = true;
        }
        if (missing) {
          const bucket = `del:${sub.expiresAt.getTime()}`;
          if (!(await alreadySent(sub.id, "deleted", bucket))) {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { status: SubscriptionStatus.expired },
            });
            const ok = await sendUser(
              api,
              sub.user.telegramId,
              [
                "🗑 حذف نهایی سرویس",
                "",
                `سرویس ${sub.code} (${sub.email}) از پنل حذف/غیرفعال شده است.`,
                "برای خرید مجدد از منوی ربات استفاده کنید.",
              ].join("\n"),
            );
            if (ok) {
              await markSent(sub.id, "deleted", bucket);
              sent++;
            }
          }
        }
      }
    }
  }

  await prisma.subscription.updateMany({
    where: {
      status: SubscriptionStatus.active,
      expiresAt: { lt: new Date(now - 7 * MS_DAY) },
    },
    data: { status: SubscriptionStatus.expired },
  });

  return { sent, checked: subs.length };
}

export function startNotificationCron(api: Api, intervalMs = 20 * 60 * 1000) {
  const tick = async () => {
    try {
      const r = await runNotificationSweep(api);
      if (r.sent > 0 || r.checked > 0) {
        console.log(`notif sweep: checked=${r.checked} sent=${r.sent}`);
      }
    } catch (err) {
      console.error("notif sweep error", err);
    }
  };
  setTimeout(tick, 45_000);
  return setInterval(tick, intervalMs);
}

export type { NotifConfig };
