import { env } from "../config/env.js";
import { listNotifyAdminTelegramIds } from "./users.js";
import { getOrderForAdmin, orderSummaryText } from "./orders.js";
import { attachPremiumTextEntities, getEmojiStyle } from "./emoji-transform.js";

/** Placeholder file ids used for text-only / web receipts (not Telegram photos). */
export function isTelegramReceiptFileId(fileId: string | null | undefined): boolean {
  if (!fileId) return false;
  if (fileId === "dashboard" || fileId === "text") return false;
  return true;
}

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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
  }
  return res.json().catch(() => null);
}

/**
 * Notify all admins that an order is awaiting review (web or bot receipt).
 * Sends photo when a real Telegram file_id is present; otherwise a text message.
 */
export async function notifyAdminsOrderAwaitingReview(orderId: string): Promise<void> {
  const order = await getOrderForAdmin(orderId);
  if (!order) return;

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

  for (const adminId of admins) {
    try {
      if (photo) {
        await telegramApi("sendPhoto", {
          chat_id: adminId,
          photo,
          caption,
          reply_markup,
          ...(entities.length ? { caption_entities: entities } : {}),
        });
      } else {
        await telegramApi("sendMessage", {
          chat_id: adminId,
          text: caption,
          reply_markup,
          ...(entities.length ? { entities } : {}),
        });
      }
    } catch (err) {
      console.error("notifyAdminsOrderAwaitingReview", adminId, err);
    }
  }
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
