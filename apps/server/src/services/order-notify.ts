import { env } from "../config/env.js";
import { listNotifyAdminTelegramIds } from "./users.js";
import { getOrderForAdmin, orderSummaryText } from "./orders.js";
import { attachPremiumTextEntities, getEmojiStyle } from "./emoji-transform.js";
import {
  finalizeAdminReviewMessages,
  reviewMessageFromApiResult,
  saveAdminReviewMessages,
  type AdminReviewMessage,
} from "./admin-review-sync.js";
import { formatToman, formatTraffic } from "../utils/format.js";
import { roleLabelFa } from "./roles.js";

/** Placeholder file ids used for text-only / web receipts (not Telegram photos). */
export function isTelegramReceiptFileId(fileId: string | null | undefined): boolean {
  if (!fileId) return false;
  if (fileId === "dashboard" || fileId === "text") return false;
  return true;
}

export type ProvisionBrief = {
  code: string;
  email: string;
  subUrl?: string | null;
  expiresAt?: Date | string | null;
  bulk?: Array<{ code: string; email: string; subUrl?: string | null; expiresAt?: Date | string | null }>;
};

export type OrderFulfilledAdminReport = {
  title: string;
  amountLabel: string;
  price: number;
  buyer: {
    username: string | null;
    firstName: string | null;
    telegramId: string;
    role: string;
    roleLabel: string;
    agentName: string | null;
  };
  receiptText: string | null;
  hasReceiptImage: boolean;
  orderSummary: string;
  orderKind: string;
  configs: Array<{
    code: string;
    email: string;
    subUrl: string | null;
    expiresAt: string | null;
  }>;
  walletBalance?: number;
  text: string;
};

function adminReviewKeyboard(orderId: string) {
  return {
    inline_keyboard: [
      [{ text: "✅ تأیید و ساخت/اعمال", callback_data: `adm:ok:${orderId}` }],
      [{ text: "❌ رد سفارش", callback_data: `adm:no:${orderId}` }],
    ],
  };
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

/**
 * Notify all admins that an order is awaiting review (web or bot receipt).
 * Sends photo when a real Telegram file_id is present; otherwise a text message.
 * Stores message refs so web/bot approve-reject can update every admin chat.
 */
export async function notifyAdminsOrderAwaitingReview(orderId: string): Promise<void> {
  const order = await getOrderForAdmin(orderId);
  if (!order) return;

  // Previous pending messages (e.g. re-upload) — clear buttons / mark superseded
  await finalizeAdminReviewMessages("order", order.id, "🔄 رسید به‌روز شد — پیام جدید ارسال شده است");

  const userLabel = `${order.user.firstName ?? ""} @${order.user.username ?? "—"}`.trim();
  const receiptLine = order.receiptText?.trim()
    ? `رسید: ${order.receiptText.trim().slice(0, 400)}`
    : isTelegramReceiptFileId(order.receiptFileId)
      ? "رسید: عکس ارسال‌شده"
      : "رسید: —";

  const caption = [
    "🔔 سفارش در انتظار تأیید",
    "",
    `کاربر: ${userLabel}`,
    orderSummaryText(order),
    receiptLine,
    `سفارش: ${order.id.slice(-8)}`,
  ].join("\n");

  const style = await getEmojiStyle();
  const entities = style === "premium" ? attachPremiumTextEntities(caption) : [];
  const admins = await listNotifyAdminTelegramIds();
  const reply_markup = adminReviewKeyboard(order.id);
  const photo = isTelegramReceiptFileId(order.receiptFileId) ? order.receiptFileId! : null;

  const stored: AdminReviewMessage[] = [];
  for (const adminId of admins) {
    try {
      if (photo) {
        const data = await telegramApi("sendPhoto", {
          chat_id: adminId,
          photo,
          caption,
          reply_markup,
          ...(entities.length ? { caption_entities: entities } : {}),
        });
        const ref = reviewMessageFromApiResult(data, { isPhoto: true });
        if (ref) stored.push(ref);
      } else {
        const data = await telegramApi("sendMessage", {
          chat_id: adminId,
          text: caption,
          reply_markup,
          ...(entities.length ? { entities } : {}),
        });
        const ref = reviewMessageFromApiResult(data, { isPhoto: false });
        if (ref) stored.push(ref);
      }
    } catch (err) {
      console.error("notifyAdminsOrderAwaitingReview", adminId, err);
    }
  }

  if (stored.length) await saveAdminReviewMessages("order", order.id, stored);
}

export async function finalizeOrderAdminMessages(
  orderId: string,
  statusText: string,
): Promise<void> {
  await finalizeAdminReviewMessages("order", orderId, statusText);
}

export function orderApprovedAdminStatus(opts: {
  kind: string;
  price: number;
  code?: string;
  quantity?: number;
  wallet?: boolean;
}): string {
  if (opts.wallet) return `✅ شارژ کیف پول — ${formatToman(opts.price)}`;
  if (opts.kind === "renew") return `✅ تمدید شد — ${opts.code ?? ""}`.trim();
  if ((opts.quantity ?? 1) > 1) return `✅ Bulk ${opts.quantity} اکانت — ${opts.code ?? ""}`.trim();
  return `✅ انجام شد — ${opts.code ?? ""}`.trim();
}

function fmtExpiry(iso: Date | string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fa-IR");
}

function buyerLines(user: {
  firstName: string | null;
  username: string | null;
  telegramId: bigint | number;
  role: string;
  agentName?: string | null;
}): string[] {
  const name = [user.firstName?.trim(), user.username ? `@${user.username}` : null]
    .filter(Boolean)
    .join(" · ");
  return [
    "👤 مشخصات خریدار:",
    name || "—",
    `آی‌دی تلگرام: ${String(user.telegramId)}`,
    user.agentName?.trim() ? `برند / نماینده: ${user.agentName.trim()}` : "",
    `نوع همکاری: ${roleLabelFa(user.role)}`,
  ].filter(Boolean);
}

function configLines(
  order: { trafficGb: number | null; months: number; kind: string; limitIp?: number },
  provision?: ProvisionBrief | null,
): string[] {
  if (!provision) return [];
  const all = provision.bulk?.length ? [provision, ...provision.bulk] : [provision];
  const lines: string[] = ["⚙️ مشخصات کانفیگ:"];
  if (all.length === 1) {
    const one = all[0]!;
    lines.push(`کد: ${one.code}`);
    lines.push(`اکانت: ${one.email}`);
    lines.push(`حجم: ${formatTraffic(order.trafficGb)}`);
    if (order.kind !== "add_days" && order.kind !== "add_gb") {
      lines.push(order.months <= 0 ? "مدت: هفتگی" : `مدت: ${order.months} ماه`);
    }
    if (typeof order.limitIp === "number") {
      lines.push(
        order.limitIp <= 0 ? "محدودیت کاربر: نامحدود" : `محدودیت کاربر: ${order.limitIp} کاربر`,
      );
    }
    const exp = fmtExpiry(one.expiresAt);
    if (exp) lines.push(`انقضا: ${exp}`);
    if (one.subUrl) {
      lines.push("لینک اشتراک:");
      lines.push(one.subUrl);
    }
  } else {
    lines.push(`تعداد اکانت: ${all.length}`);
    lines.push(`حجم هر کدام: ${formatTraffic(order.trafficGb)}`);
    for (let i = 0; i < all.length; i++) {
      const one = all[i]!;
      lines.push(`${i + 1}) ${one.code} · ${one.email}`);
    }
  }
  return lines;
}

/** Structured + plain-text report shown to admins after approve + provision. */
export function buildOrderFulfilledAdminReport(opts: {
  order: NonNullable<Awaited<ReturnType<typeof getOrderForAdmin>>>;
  provision?: ProvisionBrief | null;
  walletBalance?: number;
}): OrderFulfilledAdminReport {
  const { order, provision, walletBalance } = opts;
  const wallet = order.kind === "wallet_charge" || walletBalance != null;
  const title = wallet
    ? "✅ شارژ کیف پول تأیید شد"
    : order.kind === "renew"
      ? "✅ تمدید تأیید و اعمال شد"
      : order.kind === "add_days" || order.kind === "add_gb"
        ? "✅ افزایش سرویس تأیید و اعمال شد"
        : "✅ سفارش تأیید و اکانت ساخته شد";

  const receiptNote = order.receiptText?.trim()
    ? `رسید: ${order.receiptText.trim().slice(0, 400)}`
    : isTelegramReceiptFileId(order.receiptFileId)
      ? "رسید: عکس تأییدشده (بالا)"
      : "رسید: —";

  const text = [
    title,
    "",
    `🧾 ${receiptNote}`,
    `💰 مبلغ: ${formatToman(order.price)}`,
    "",
    ...buyerLines(order.user),
    "",
    orderSummaryText(order),
    "",
    ...configLines(order, provision),
    walletBalance != null ? `موجودی کیف پول: ${formatToman(walletBalance)}` : "",
    "",
    `کد سفارش: ${order.id.slice(-8)}`,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();

  const configs = (provision
    ? provision.bulk?.length
      ? [provision, ...provision.bulk]
      : [provision]
    : []
  ).map((p) => ({
    code: p.code,
    email: p.email,
    subUrl: p.subUrl ?? null,
    expiresAt: p.expiresAt
      ? p.expiresAt instanceof Date
        ? p.expiresAt.toISOString()
        : String(p.expiresAt)
      : null,
  }));

  return {
    title,
    amountLabel: formatToman(order.price),
    price: order.price,
    buyer: {
      username: order.user.username,
      firstName: order.user.firstName,
      telegramId: String(order.user.telegramId),
      role: order.user.role,
      roleLabel: roleLabelFa(order.user.role),
      agentName: order.user.agentName ?? null,
    },
    receiptText: order.receiptText,
    hasReceiptImage: isTelegramReceiptFileId(order.receiptFileId),
    orderSummary: orderSummaryText(order),
    orderKind: order.kind,
    configs,
    walletBalance,
    text,
  };
}

/**
 * After approve: strip buttons on pending review messages, then send every admin
 * a fulfillment report (receipt photo + amount / buyer / role / config).
 */
export async function notifyAdminsOrderFulfilled(
  orderId: string,
  opts: {
    provision?: ProvisionBrief | null;
    walletBalance?: number;
    shortStatus?: string;
  } = {},
): Promise<OrderFulfilledAdminReport | null> {
  const order = await getOrderForAdmin(orderId);
  if (!order) return null;

  const report = buildOrderFulfilledAdminReport({
    order,
    provision: opts.provision,
    walletBalance: opts.walletBalance,
  });

  const short =
    opts.shortStatus ??
    orderApprovedAdminStatus({
      kind: order.kind,
      price: order.price,
      code: opts.provision?.code,
      quantity: order.quantity,
      wallet: opts.walletBalance != null || order.kind === "wallet_charge",
    });

  await finalizeOrderAdminMessages(orderId, short);

  const style = await getEmojiStyle();
  const photo = isTelegramReceiptFileId(order.receiptFileId) ? order.receiptFileId! : null;
  const admins = await listNotifyAdminTelegramIds();
  const CAPTION_MAX = 1024;

  for (const adminId of admins) {
    try {
      if (photo) {
        const caption =
          report.text.length <= CAPTION_MAX
            ? report.text
            : `${report.title}\n\n💰 ${report.amountLabel}\n${buyerLines(order.user).join("\n")}\n\nجزئیات کامل در پیام بعدی.`.slice(
                0,
                CAPTION_MAX,
              );
        const entities = style === "premium" ? attachPremiumTextEntities(caption) : [];
        await telegramApi("sendPhoto", {
          chat_id: adminId,
          photo,
          caption,
          ...(entities.length ? { caption_entities: entities } : {}),
        });
        if (report.text.length > CAPTION_MAX) {
          const entities2 = style === "premium" ? attachPremiumTextEntities(report.text) : [];
          await telegramApi("sendMessage", {
            chat_id: adminId,
            text: report.text,
            ...(entities2.length ? { entities: entities2 } : {}),
          });
        }
      } else {
        const entities = style === "premium" ? attachPremiumTextEntities(report.text) : [];
        await telegramApi("sendMessage", {
          chat_id: adminId,
          text: report.text,
          ...(entities.length ? { entities: entities } : {}),
        });
      }
    } catch (err) {
      console.error("notifyAdminsOrderFulfilled", adminId, err);
    }
  }

  return report;
}

/** Download a Telegram file by file_id (for admin web receipt preview). */
export async function fetchTelegramFileById(
  fileId: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isTelegramReceiptFileId(fileId)) return null;
  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    const meta = (await metaRes.json()) as { ok?: boolean; result?: { file_path?: string } };
    const filePath = meta.result?.file_path;
    if (!meta.ok || !filePath) return null;
    const fileRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
    if (!fileRes.ok) return null;
    const ab = await fileRes.arrayBuffer();
    const lower = filePath.toLowerCase();
    const contentType = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return { buffer: Buffer.from(ab), contentType };
  } catch (err) {
    console.error("fetchTelegramFileById", err);
    return null;
  }
}
