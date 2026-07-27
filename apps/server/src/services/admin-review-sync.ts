import { env } from "../config/env.js";
import { getSetting, setSetting } from "./settings.js";
import { prisma } from "../db.js";

export type AdminReviewMessage = {
  chatId: number;
  messageId: number;
  /** Photo caption vs plain text message */
  isPhoto: boolean;
};

function settingKey(kind: "order" | "partner" | "arename", id: string) {
  return `admin_review_msgs:${kind}:${id}`;
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number; chat?: { id?: number } };
  } | null;
  if (!res.ok || !data?.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${data?.description ?? ""}`);
  }
  return data;
}

export async function loadAdminReviewMessages(
  kind: "order" | "partner" | "arename",
  id: string,
): Promise<AdminReviewMessage[]> {
  const raw = await getSetting(settingKey(kind, id));
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as AdminReviewMessage[];
    return Array.isArray(parsed) ? parsed.filter((m) => m?.chatId && m?.messageId) : [];
  } catch {
    return [];
  }
}

export async function saveAdminReviewMessages(
  kind: "order" | "partner" | "arename",
  id: string,
  messages: AdminReviewMessage[],
): Promise<void> {
  await setSetting(settingKey(kind, id), JSON.stringify(messages));
}

export async function clearAdminReviewMessages(
  kind: "order" | "partner" | "arename",
  id: string,
): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: settingKey(kind, id) } }).catch(() => undefined);
}

/**
 * Edit every stored admin review message to a final status and strip buttons.
 * Safe to call from web or bot after approve/reject.
 */
export async function finalizeAdminReviewMessages(
  kind: "order" | "partner" | "arename",
  id: string,
  statusText: string,
): Promise<void> {
  const messages = await loadAdminReviewMessages(kind, id);
  if (!messages.length) {
    await clearAdminReviewMessages(kind, id);
    return;
  }

  const text = statusText.slice(0, 1024);
  await Promise.all(
    messages.map(async (m) => {
      try {
        if (m.isPhoto) {
          await telegramApi("editMessageCaption", {
            chat_id: m.chatId,
            message_id: m.messageId,
            caption: text,
            reply_markup: { inline_keyboard: [] },
          });
        } else {
          await telegramApi("editMessageText", {
            chat_id: m.chatId,
            message_id: m.messageId,
            text,
            reply_markup: { inline_keyboard: [] },
          });
        }
      } catch (err) {
        // Fallback: at least remove buttons
        try {
          await telegramApi("editMessageReplyMarkup", {
            chat_id: m.chatId,
            message_id: m.messageId,
            reply_markup: { inline_keyboard: [] },
          });
        } catch {
          /* message may be gone */
        }
        console.error("finalizeAdminReviewMessages", kind, id, m.chatId, err);
      }
    }),
  );

  await clearAdminReviewMessages(kind, id);
}

/** Parse sendMessage/sendPhoto Telegram API result into a stored ref. */
export function reviewMessageFromApiResult(
  data: { result?: { message_id?: number; chat?: { id?: number }; photo?: unknown } } | null,
  opts?: { isPhoto?: boolean },
): AdminReviewMessage | null {
  const messageId = data?.result?.message_id;
  const chatId = data?.result?.chat?.id;
  if (!messageId || chatId == null) return null;
  return {
    chatId: Number(chatId),
    messageId: Number(messageId),
    isPhoto: Boolean(opts?.isPhoto ?? data?.result?.photo),
  };
}
