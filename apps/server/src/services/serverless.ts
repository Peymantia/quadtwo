import { OrderKind, OrderStatus, SubscriptionStatus, type User } from "@prisma/client";
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
import { getSetting, isServerlessEnabled, setSetting } from "./settings.js";
import type { ProvisionResult } from "./provision.js";
import QRCode from "qrcode";

export { isServerlessEnabled };

export const SERVERLESS_CATEGORY = "serverless";

/** Buyer-facing — never mention serverless / no-server */
export const SERVERLESS_BUYER_WAIT_MSG =
  "در شرایط فعلی سفارش شما در حال پردازش و آماده‌سازی است و به‌زودی ارسال می‌شود.";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type ServerlessDurationId = "weekly" | "month1" | "month2";

export type ServerlessPricingConfig = {
  pricePerGb: number;
  pricePerMonth: number;
  weeklyMinGb: number;
  weeklyMaxGb: number;
  monthlyMinGb: number;
  monthlyMaxGb: number;
  weeklyEnabled: boolean;
  month1Enabled: boolean;
  month2Enabled: boolean;
};

export type ServerlessDurationOption = {
  id: ServerlessDurationId;
  /** 0 = weekly (7 days) */
  months: number;
  label: string;
  minGb: number;
  maxGb: number;
  step: number;
};

export type FulfillResult =
  | ProvisionResult
  | { kind: "wallet_credit"; balance: number }
  | { kind: "serverless_pending" };

function numSetting(raw: string, fallback: number, min = 0, max = 10_000_000): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function getServerlessPricingConfig(): Promise<ServerlessPricingConfig> {
  const [
    pricePerGb,
    pricePerMonth,
    weeklyMinGb,
    weeklyMaxGb,
    monthlyMinGb,
    monthlyMaxGb,
    weeklyEnabled,
    month1Enabled,
    month2Enabled,
  ] = await Promise.all([
    getSetting("serverless_price_per_gb"),
    getSetting("serverless_price_per_month"),
    getSetting("serverless_weekly_min_gb"),
    getSetting("serverless_weekly_max_gb"),
    getSetting("serverless_monthly_min_gb"),
    getSetting("serverless_monthly_max_gb"),
    getSetting("serverless_weekly_enabled"),
    getSetting("serverless_month1_enabled"),
    getSetting("serverless_month2_enabled"),
  ]);

  let wMin = numSetting(weeklyMinGb, 1, 1, 1000);
  let wMax = numSetting(weeklyMaxGb, 10, 1, 1000);
  if (wMax < wMin) [wMin, wMax] = [wMax, wMin];

  let mMin = numSetting(monthlyMinGb, 10, 1, 1000);
  let mMax = numSetting(monthlyMaxGb, 100, 1, 1000);
  if (mMax < mMin) [mMin, mMax] = [mMax, mMin];

  return {
    pricePerGb: numSetting(pricePerGb, 10_000, 0),
    pricePerMonth: numSetting(pricePerMonth, 30_000, 0),
    weeklyMinGb: wMin,
    weeklyMaxGb: wMax,
    monthlyMinGb: mMin,
    monthlyMaxGb: mMax,
    weeklyEnabled: weeklyEnabled !== "false",
    month1Enabled: month1Enabled !== "false",
    month2Enabled: month2Enabled !== "false",
  };
}

export async function saveServerlessPricingPatch(
  patch: Partial<Record<keyof ServerlessPricingConfig, number | boolean>>,
): Promise<ServerlessPricingConfig> {
  const map: Array<[keyof ServerlessPricingConfig, string]> = [
    ["pricePerGb", "serverless_price_per_gb"],
    ["pricePerMonth", "serverless_price_per_month"],
    ["weeklyMinGb", "serverless_weekly_min_gb"],
    ["weeklyMaxGb", "serverless_weekly_max_gb"],
    ["monthlyMinGb", "serverless_monthly_min_gb"],
    ["monthlyMaxGb", "serverless_monthly_max_gb"],
    ["weeklyEnabled", "serverless_weekly_enabled"],
    ["month1Enabled", "serverless_month1_enabled"],
    ["month2Enabled", "serverless_month2_enabled"],
  ];
  for (const [key, settingKey] of map) {
    if (patch[key] === undefined) continue;
    const v = patch[key]!;
    if (typeof v === "boolean") {
      await setSetting(settingKey, v ? "true" : "false");
    } else {
      await setSetting(settingKey, String(Math.max(0, Math.floor(Number(v) || 0))));
    }
  }
  return getServerlessPricingConfig();
}

export function listServerlessDurations(cfg: ServerlessPricingConfig): ServerlessDurationOption[] {
  const out: ServerlessDurationOption[] = [];
  if (cfg.weeklyEnabled) {
    out.push({
      id: "weekly",
      months: 0,
      label: "اعتبار هفتگی",
      minGb: cfg.weeklyMinGb,
      maxGb: cfg.weeklyMaxGb,
      step: 1,
    });
  }
  if (cfg.month1Enabled) {
    out.push({
      id: "month1",
      months: 1,
      label: "اعتبار یک‌ماهه",
      minGb: cfg.monthlyMinGb,
      maxGb: cfg.monthlyMaxGb,
      step: 1,
    });
  }
  if (cfg.month2Enabled) {
    out.push({
      id: "month2",
      months: 2,
      label: "اعتبار دوماهه",
      minGb: cfg.monthlyMinGb,
      maxGb: cfg.monthlyMaxGb,
      step: 1,
    });
  }
  return out;
}

export function durationLabel(months: number): string {
  if (months <= 0) return "هفتگی";
  if (months === 1) return "یک‌ماهه";
  if (months === 2) return "دوماهه";
  return `${months} ماه`;
}

export function isServerlessCategory(category: string | null | undefined): boolean {
  return (category || "").trim().toLowerCase() === SERVERLESS_CATEGORY;
}

/** weeks: months=0 → 7 days; else N×31-day months */
export function serverlessDurationMs(months: number): number {
  if (months <= 0) return WEEK_MS;
  return monthsToMs(months);
}

export function snapServerlessGb(gb: number, months: number, cfg: ServerlessPricingConfig): number {
  const weekly = months <= 0;
  const min = weekly ? cfg.weeklyMinGb : cfg.monthlyMinGb;
  const max = weekly ? cfg.weeklyMaxGb : cfg.monthlyMaxGb;
  const n = Math.floor(Number(gb));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function calcServerlessPrice(
  trafficGb: number,
  months: number,
  cfg: ServerlessPricingConfig,
): number {
  const gb = snapServerlessGb(trafficGb, months, cfg);
  if (months <= 0) {
    return gb * cfg.pricePerGb;
  }
  return gb * cfg.pricePerGb + months * cfg.pricePerMonth;
}

export async function resolveServerlessPrice(
  user: User,
  trafficGb: number | null,
  months: number,
): Promise<{ cell: null; price: number; mode: "rate" } | null> {
  if (user.role === "admin") {
    return { cell: null, price: 0, mode: "rate" };
  }
  if (trafficGb == null || trafficGb <= 0) return null;
  const cfg = await getServerlessPricingConfig();
  const durations = listServerlessDurations(cfg);
  const ok = durations.some((d) => d.months === (months <= 0 ? 0 : months));
  if (!ok) return null;
  const price = calcServerlessPrice(trafficGb, months, cfg);
  if (price < 0) return null;
  return { cell: null, price, mode: "rate" };
}

export function assertServerlessPlanAllowed(
  trafficGb: number,
  months: number,
  cfg: ServerlessPricingConfig,
): void {
  const durations = listServerlessDurations(cfg);
  const d = durations.find((x) => x.months === (months <= 0 ? 0 : months));
  if (!d) throw new Error("این مدت اعتبار فعلاً فعال نیست");
  const gb = Math.floor(trafficGb);
  if (!Number.isFinite(gb) || gb < d.minGb || gb > d.maxGb) {
    throw new Error(`حجم باید بین ${d.minGb} تا ${d.maxGb} گیگ باشد`);
  }
}

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
    return false;
  }

  if (order.kind === OrderKind.renew) {
    const target = order.targetSub;
    if (!target) return true;
    return isServerlessNativeSub(target);
  }

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

  await finalizeAdminReviewMessages(
    "order",
    orderId,
    "✅ پرداخت تأیید شد — در انتظار ارسال لینک ساب",
  );

  await notifyBuyerWaiting(order.user.telegramId);

  const userLabel = `${order.user.firstName ?? ""} @${order.user.username ?? "—"}`.trim();
  const caption = [
    "🟣 سفارش دستی — در انتظار لینک ساب",
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
    throw new Error("این سفارش در صف ارسال دستی نیست");
  }

  const expiresAt = new Date(Date.now() + serverlessDurationMs(order.months));
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
      `✅ لینک ارسال شد — ${updated.code}`,
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
    throw new Error("این نوع سفارش در شرایط فعلی پشتیبانی نمی‌شود");
  }

  const code = shortCode("SL");
  const emailBase =
    (order.accountName || order.customName || code).replace(/[^\w.-]/g, "").slice(0, 32) || code;
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
  await finalizeAdminReviewMessages("order", orderId, `✅ لینک ارسال شد — ${code}`);

  return {
    subscriptionId: subscription.id,
    code,
    email,
    subUrl,
    expiresAt,
    qrPng,
  };
}
