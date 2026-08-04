import { OrderKind, OrderStatus, SubscriptionStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { monthsToMs, randomSubId, shortCode } from "../utils/format.js";
import { attachPremiumTextEntities, getEmojiStyle } from "./emoji-transform.js";
import {
  finalizeAdminReviewMessages,
  reviewMessageFromApiResult,
  saveAdminReviewMessages,
  type AdminReviewMessage,
} from "./admin-review-sync.js";
import { isServerlessEnabled } from "./settings.js";
import type { ProvisionResult } from "./provision.js";
import QRCode from "qrcode";

export { isServerlessEnabled };

export const SERVERLESS_BUYER_WAIT_MSG =
  "سفارش شما در حال پردازش و آماده‌سازی است و به‌زودی ارسال می‌شود.";

export type FulfillResult =
  | ProvisionResult
  | { kind: "wallet_credit"; balance: number }
  | { kind: "serverless_pending" };

function isServerlessNativeSub(sub: {
  serverless: boolean;
  panelServerId: string | null;
  clientUuid: string | null;
}): boolean {
  if (sub.serverless) return true;
  return !sub.panelServerId && !sub.clientUuid;
}

/** New buys (and renews of serverless-native subs) need manual URL delivery. */
export async function orderNeedsServerlessDelivery(order: {
  kind: OrderKind;
  targetSub?: {
    serverless: boolean;
    panelServerId: string | null;
    clientUuid: string | null;
  } | null;
}): Promise<boolean> {
  if (!(await isServerlessEnabled())) return false;
  if (order.kind === OrderKind.wallet_charge) return false;

  if (
    order.kind === OrderKind.add_days ||
    order.kind === OrderKind.add_gb ||
    order.kind === OrderKind.rotate_sub ||
    order.kind === OrderKind.rotate_uuid
  ) {
    // Add-ons / rotate need panel API — not supported via manual URL paste
    return false;
  }

  if (order.kind === OrderKind.renew) {
    const target = order.targetSub;
    if (!target) return true;
    return isServerlessNativeSub(target);
  }

  // new (and any other create kinds)
  return true;
}

export function normalizeSubUrl(raw: string): string {
  const url = raw.trim().replace(/^<|>$/g, "");
  if (!/^https?:\/\/\S+/i.test(url)) {
    throw new Error("لینک ساب باید با http:// یا https:// شروع شود");
  }
  if (url.length > 2000) throw new Error("لینک ساب خیلی بلند است");
  return url;
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !(data as { ok?: boolean })?.ok) {
    const text = typeof data === "object" && data ? JSON.stringify(data) : String(data);
    throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
  }
  return data as {
    ok: boolean;
    result?: { message_id?: number; chat?: { id?: number }; photo?: unknown };
  };
}

async function notifyBuyerWaiting(telegramId: bigint | number) {
  try {
    await telegramApi("sendMessage", {
      chat_id: Number(telegramId),
      text: SERVERLESS_BUYER_WAIT_MSG,
    });
  } catch (err) {
    console.error("serverless buyer wait notify", err);
  }
}

function serverlessAdminKeyboard(orderId: string) {
  return {
    inline_keyboard: [
      [{ text: "🔗 ارسال لینک ساب", callback_data: `adm:sl:paste:${orderId}` }],
      [{ text: "❌ رد سفارش", callback_data: `adm:no:${orderId}` }],
    ],
  };
}

export function serverlessConfirmKeyboard(orderId: string) {
  return {
    inline_keyboard: [
      [{ text: "✅ ارسال به خریدار", callback_data: `adm:sl:send:${orderId}` }],
      [{ text: "✏️ لینک دیگر", callback_data: `adm:sl:paste:${orderId}` }],
      [{ text: "« انصراف", callback_data: `adm:sl:cancel:${orderId}` }],
    ],
  };
}

/** After payment: queue for admin paste instead of panel provision. */
export async function enterServerlessAwaitingDelivery(orderId: string): Promise<{
  kind: "serverless_pending";
}> {
  const { getOrderForAdmin, orderSummaryText } = await import("./orders.js");
  const order = await getOrderForAdmin(orderId);
  if (!order) throw new Error("سفارش پیدا نشد");
  if (order.status === OrderStatus.completed) {
    throw new Error("این سفارش قبلاً تکمیل شده");
  }
  if (order.status === OrderStatus.awaiting_delivery) {
    return { kind: "serverless_pending" };
  }
  if (order.subscription) {
    throw new Error("برای این سفارش قبلاً اشتراک ساخته شده");
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.awaiting_delivery },
  });

  // Clear old review-message buttons before sending the paste-URL prompt
  await finalizeAdminReviewMessages(
    "order",
    orderId,
    "✅ پرداخت تأیید شد — صف ارسال سرورلس",
  );

  await notifyBuyerWaiting(order.user.telegramId);

  const userLabel = `${order.user.firstName ?? ""} @${order.user.username ?? "—"}`.trim();
  const caption = [
    "🟣 سفارش سرورلس — در انتظار لینک ساب",
    "",
    `کاربر: ${userLabel}`,
    `تلگرام: ${order.user.telegramId}`,
    orderSummaryText(order),
    `سفارش: ${order.id.slice(-8)}`,
    "",
    "لینک ساب را بسازید/بگیرید، سپس «ارسال لینک ساب» را بزنید.",
  ].join("\n");

  const style = await getEmojiStyle();
  const entities = style === "premium" ? attachPremiumTextEntities(caption) : [];
  const reply_markup = serverlessAdminKeyboard(order.id);

  const { listNotifyAdminTelegramIds } = await import("./users.js");
  const admins = await listNotifyAdminTelegramIds();
  const stored: AdminReviewMessage[] = [];
  for (const adminId of admins) {
    try {
      const data = await telegramApi("sendMessage", {
        chat_id: adminId,
        text: caption,
        reply_markup,
        ...(entities.length ? { entities } : {}),
      });
      const ref = reviewMessageFromApiResult(data, { isPhoto: false });
      if (ref) stored.push(ref);
    } catch (err) {
      console.error("notifyAdminsServerlessDelivery", adminId, err);
    }
  }
  if (stored.length) await saveAdminReviewMessages("order", order.id, stored);

  return { kind: "serverless_pending" };
}

/**
 * Paid order fulfillment: wallet credit, serverless queue, or panel provision.
 */
export async function fulfillAfterPaid(orderId: string): Promise<FulfillResult> {
  const { getOrderForAdmin } = await import("./orders.js");
  const order = await getOrderForAdmin(orderId);
  if (!order) throw new Error("سفارش پیدا نشد");

  if (order.kind === OrderKind.wallet_charge) {
    const { provisionOrder } = await import("./provision.js");
    return provisionOrder(orderId);
  }

  if (await orderNeedsServerlessDelivery(order)) {
    return enterServerlessAwaitingDelivery(orderId);
  }

  const { provisionOrder } = await import("./provision.js");
  return provisionOrder(orderId);
}

export function isServerlessPending(
  result: FulfillResult,
): result is { kind: "serverless_pending" } {
  return "kind" in result && result.kind === "serverless_pending";
}

async function qrForSub(subUrl: string) {
  return QRCode.toBuffer(subUrl, { type: "png", width: 512, margin: 2 });
}

/** Create or renew subscription from admin-pasted sub URL, then mark order completed. */
export async function completeServerlessDelivery(
  orderId: string,
  rawSubUrl: string,
): Promise<ProvisionResult> {
  const { getOrderForAdmin } = await import("./orders.js");
  const subUrl = normalizeSubUrl(rawSubUrl);
  const order = await getOrderForAdmin(orderId);
  if (!order) throw new Error("سفارش پیدا نشد");
  if (order.status === OrderStatus.completed && order.subscription) {
    throw new Error("این سفارش قبلاً تکمیل شده");
  }
  if (
    order.status !== OrderStatus.awaiting_delivery &&
    order.status !== OrderStatus.paid
  ) {
    throw new Error("این سفارش در صف ارسال سرورلس نیست");
  }

  const months = order.months || 1;
  const expiresAt = new Date(Date.now() + monthsToMs(months));
  const qrPng = await qrForSub(subUrl);

  if (order.kind === OrderKind.renew && order.targetSub) {
    const target = order.targetSub;
    const updated = await prisma.subscription.update({
      where: { id: target.id },
      data: {
        subUrl,
        trafficGb: order.trafficGb,
        expiresAt,
        startsOnConnect: true,
        activatedAt: null,
        panelExpiryTime: null,
        status: SubscriptionStatus.active,
        serverless: true,
        panelServerId: null,
        note: order.note?.trim()
          ? order.note.trim().slice(0, 500)
          : target.note,
      },
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.completed },
    });
    await finalizeAdminReviewMessages(
      "order",
      orderId,
      `✅ لینک سرورلس ارسال شد — ${updated.code}`,
    );
    return {
      subscriptionId: updated.id,
      code: updated.code,
      email: updated.email,
      subUrl,
      expiresAt,
      qrPng,
    };
  }

  if (order.kind !== OrderKind.new && order.kind !== OrderKind.renew) {
    throw new Error("این نوع سفارش در سرورلس پشتیبانی نمی‌شود");
  }

  const code = shortCode("SL");
  const emailBase = (order.accountName || order.customName || code).replace(/[^\w.-]/g, "").slice(0, 32) || code;
  let email = emailBase;
  for (let i = 0; i < 8; i++) {
    const clash = await prisma.subscription.findFirst({ where: { email } });
    if (!clash) break;
    email = `${emailBase.slice(0, 28)}${100 + i}`;
  }

  const subscription = await prisma.subscription.create({
    data: {
      code,
      userId: order.userId,
      orderId: order.id,
      panelServerId: null,
      title: email.slice(0, 80),
      email,
      clientUuid: null,
      panelSubId: randomSubId(),
      trafficGb: order.trafficGb,
      limitIp: order.limitIp ?? 0,
      startsOnConnect: true,
      activatedAt: null,
      expiresAt,
      subUrl,
      note: order.note?.trim() ? order.note.trim().slice(0, 500) : null,
      status: SubscriptionStatus.active,
      isTest: false,
      serverless: true,
    },
  });

  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.completed },
  });
  await finalizeAdminReviewMessages("order", orderId, `✅ لینک سرورلس ارسال شد — ${code}`);

  return {
    subscriptionId: subscription.id,
    code,
    email,
    subUrl,
    expiresAt,
    qrPng,
  };
}
