import { PaymentMethod, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { getSetting } from "./settings.js";
import { getWallet } from "./wallet.js";
import { resolvePanelForSubscription } from "./panel-servers.js";
import { isDemoMode } from "./license.js";

const MS_HOUR = 60 * 60 * 1000;

export async function getNegativeCreditLimitToman(): Promise<number> {
  const raw = Number(await getSetting("negative_credit_limit"));
  if (!Number.isFinite(raw) || raw < 0) return 500_000;
  return Math.floor(raw);
}

export async function getNegativeCreditGraceHours(): Promise<number> {
  const raw = Number(await getSetting("negative_credit_grace_hours"));
  if (!Number.isFinite(raw)) return 24;
  return Math.max(1, Math.min(168, Math.floor(raw)));
}

/** Max overdraft for this user (0 if not allowed). */
export async function getUserNegativeCreditLimit(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { negativeCreditAllowed: true },
  });
  if (!user?.negativeCreditAllowed) return 0;
  return getNegativeCreditLimitToman();
}

/** Available to spend = balance + credit limit (never below credit floor). */
export async function getSpendableBalance(userId: string): Promise<{
  balance: number;
  creditLimit: number;
  spendable: number;
  debt: number;
}> {
  const wallet = await getWallet(userId);
  const creditLimit = await getUserNegativeCreditLimit(userId);
  const debt = wallet.balance < 0 ? -wallet.balance : 0;
  return {
    balance: wallet.balance,
    creditLimit,
    spendable: wallet.balance + creditLimit,
    debt,
  };
}

/**
 * Minimum wallet top-up: if in debt, must cover full debt; otherwise 10_000.
 */
export async function assertWalletChargeMin(userId: string, amount: number) {
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0) throw new Error("مبلغ نامعتبر");
  const wallet = await getWallet(userId);
  if (wallet.balance < 0) {
    const min = -wallet.balance;
    if (n < min) {
      throw new Error(
        `به‌خاطر بدهی کیف پول، حداقل شارژ ${min.toLocaleString("fa-IR")} تومان است (نمی‌توانید کمتر از بدهی شارژ کنید).`,
      );
    }
    return;
  }
  if (n < 10_000) throw new Error("حداقل شارژ ۱۰٬۰۰۰ تومان است");
}

/** Clear unsettled flags after wallet is no longer negative (accounts stay disabled until user enables). */
export async function clearUnsettledAfterSettlement(userId: string, balanceAfter: number) {
  if (balanceAfter < 0) return 0;
  const held = await prisma.subscription.count({
    where: { userId, unsettled: true, unsettledHeld: true },
  });
  const r = await prisma.subscription.updateMany({
    where: { userId, unsettled: true },
    data: {
      unsettled: false,
      unsettledAmount: 0,
      unsettledDeadline: null,
      unsettledHeld: false,
    },
  });
  if (r.count > 0 && held > 0) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      });
      if (user) {
        const { notifyTelegramWithMainMenu } = await import("./push-main-menu.js");
        await notifyTelegramWithMainMenu(
          user.telegramId,
          [
            "✅ بدهی کیف پول تسویه شد",
            "",
            "برچسب «تسویه نشده» از اکانت‌ها برداشته شد.",
            "اکانت‌های غیرفعال‌شده را از «سرویس‌های من» دوباره فعال کنید.",
          ].join("\n"),
        );
      }
    } catch {
      /* best-effort */
    }
  }
  return r.count;
}

type MarkResult = {
  subscriptionId?: string;
  bulk?: Array<{ subscriptionId: string }>;
};

/** After a wallet purchase that left the user in debt, flag affected accounts. */
export async function markUnsettledFromWalletPurchase(
  orderId: string,
  result?: MarkResult | null,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { subscription: true },
  });
  if (!order) return;
  if (order.paymentMethod !== PaymentMethod.wallet) return;
  if (order.price <= 0) return;

  const wallet = await getWallet(order.userId);
  if (wallet.balance >= 0) return;

  const ids = new Set<string>();
  if (order.targetSubId) ids.add(order.targetSubId);
  if (order.subscription?.id) ids.add(order.subscription.id);
  if (result?.subscriptionId) ids.add(result.subscriptionId);
  if (result?.bulk) {
    for (const b of result.bulk) ids.add(b.subscriptionId);
  }
  // Bulk extras without orderId link
  if (ids.size === 0) {
    const linked = await prisma.subscription.findMany({
      where: { orderId: order.id },
      select: { id: true },
    });
    for (const s of linked) ids.add(s.id);
  }

  if (!ids.size) return;

  const graceH = await getNegativeCreditGraceHours();
  const deadline = new Date(Date.now() + graceH * MS_HOUR);
  const qty = Math.max(1, order.quantity ?? 1);
  const perAmount = Math.max(0, Math.round(order.price / qty));

  await prisma.subscription.updateMany({
    where: { id: { in: [...ids] }, userId: order.userId },
    data: {
      unsettled: true,
      unsettledAmount: perAmount,
      unsettledDeadline: deadline,
      unsettledHeld: false,
    },
  });
}

export async function assertCanEnableSubscription(sub: {
  userId: string;
  unsettled: boolean;
  unsettledHeld: boolean;
  unsettledDeadline: Date | null;
}) {
  if (!sub.unsettled && !sub.unsettledHeld) return;
  const wallet = await getWallet(sub.userId);
  if (wallet.balance >= 0 && !sub.unsettled) return;

  const pastDeadline =
    sub.unsettledHeld ||
    (sub.unsettledDeadline != null && sub.unsettledDeadline.getTime() <= Date.now());

  if (sub.unsettled && wallet.balance < 0 && pastDeadline) {
    throw new Error(
      "این اکانت به‌خاطر بدهی تسویه‌نشده غیرفعال است. ابتدا کیف پول را حداقل به اندازه بدهی شارژ کنید، سپس فعال کنید.",
    );
  }
}

async function setPanelEnable(subId: string, enable: boolean) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
  if (isDemoMode() || !sub.panelServerId || sub.subUrl?.includes("demo.invalid")) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: enable ? SubscriptionStatus.active : SubscriptionStatus.disabled },
    });
    return;
  }
  const resolved = await resolvePanelForSubscription(sub);
  const got = await resolved.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");
  await resolved.xui.updateClient(sub.email, {
    ...client,
    email: sub.email,
    enable,
  });
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: enable ? SubscriptionStatus.active : SubscriptionStatus.disabled },
  });
}

/** Disable unsettled accounts whose grace deadline passed. */
export async function disableOverdueUnsettledAccounts(): Promise<number> {
  const due = await prisma.subscription.findMany({
    where: {
      unsettled: true,
      unsettledHeld: false,
      unsettledDeadline: { lte: new Date() },
      status: { not: SubscriptionStatus.disabled },
    },
    include: { user: { select: { telegramId: true } } },
    orderBy: { unsettledDeadline: "asc" },
    take: 40,
  });

  let n = 0;
  for (const sub of due) {
    try {
      await setPanelEnable(sub.id, false);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.disabled,
          unsettledHeld: true,
        },
      });
      n += 1;
      try {
        const { notifyTelegramWithMainMenu } = await import("./push-main-menu.js");
        await notifyTelegramWithMainMenu(
          sub.user.telegramId,
          [
            "⚠️ اکانت تسویه‌نشده غیرفعال شد",
            "",
            `اکانت: ${sub.email}`,
            `بدهی این اکانت: ${sub.unsettledAmount.toLocaleString("fa-IR")} تومان`,
            "",
            "برای فعال‌سازی مجدد، کیف پول را حداقل به اندازه کل بدهی شارژ کنید و سپس اکانت را فعال کنید.",
          ].join("\n"),
        );
      } catch {
        /* best-effort */
      }
    } catch (err) {
      console.warn("[negative-credit] disable failed", sub.id, err);
    }
  }
  return n;
}

export function startUnsettledDisableCron() {
  const tick = async () => {
    try {
      const n = await disableOverdueUnsettledAccounts();
      if (n > 0) console.log(`[negative-credit] disabled ${n} unsettled account(s)`);
    } catch (err) {
      console.warn("[negative-credit] cron error", err);
    }
  };
  void tick();
  setInterval(() => void tick(), 5 * 60 * 1000);
}
