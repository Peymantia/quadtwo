import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../db.js";
import { forcePremiumTextAndMarkup } from "./emoji-transform.js";
import { getSetting, resolveMiniAppUrl, setSetting } from "./settings.js";

export const DEFAULT_MINIAPP_PIN_TEXT = [
  "📱 پنل وب‌اپ",
  "",
  "با دکمه زیر مستقیم از تلگرام وارد وب پنل شوید...",
].join("\n");

export const MINIAPP_PIN_BTN = "📱 ورود به وب پنل";

const DELAY_MS = 40;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getMiniAppPinText(): Promise<string> {
  const t = (await getSetting("miniapp_pin_text")).trim();
  return t || DEFAULT_MINIAPP_PIN_TEXT;
}

export async function setMiniAppPinText(text: string): Promise<void> {
  await setSetting("miniapp_pin_text", text.trim() || DEFAULT_MINIAPP_PIN_TEXT);
}

/** Auto-pin on /start and /update when not disabled. */
export async function isMiniAppPinAutoEnabled(): Promise<boolean> {
  const v = (await getSetting("miniapp_pin_auto")).trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

export async function setMiniAppPinAuto(enabled: boolean): Promise<void> {
  await setSetting("miniapp_pin_auto", enabled ? "1" : "0");
}

function pinReplyMarkup(miniUrl: string) {
  return new InlineKeyboard().webApp(MINIAPP_PIN_BTN, miniUrl).success();
}

export type PinChatResult = { ok: true; messageId: number } | { ok: false; error: string };

/** Send (or replace) the pinned Mini App banner in one private chat. Always uses Premium emoji. */
export async function sendAndPinMiniAppBanner(api: Api, chatId: number): Promise<PinChatResult> {
  const mini = await resolveMiniAppUrl();
  if (!mini) return { ok: false, error: "آدرس وب پنل (HTTPS) تنظیم نشده" };

  const text = await getMiniAppPinText();
  const forced = forcePremiumTextAndMarkup(text, pinReplyMarkup(mini));

  try {
    await api.unpinAllChatMessages(chatId).catch(() => undefined);
    const msg = await api.sendMessage(chatId, forced.text, {
      entities: forced.entities as never,
      reply_markup: forced.reply_markup as never,
    });
    await api.pinChatMessage(chatId, msg.message_id, { disable_notification: true });
    return { ok: true, messageId: msg.message_id };
  } catch (err) {
    return { ok: false, error: String(err).replace(/^Error:\s*/, "") };
  }
}

export async function unpinMiniAppBanner(api: Api, chatId: number): Promise<PinChatResult> {
  try {
    await api.unpinAllChatMessages(chatId);
    return { ok: true, messageId: 0 };
  } catch (err) {
    return { ok: false, error: String(err).replace(/^Error:\s*/, "") };
  }
}

export type PinBroadcastResult = { total: number; sent: number; failed: number };

async function eachUserChat(
  opts: {
    excludeTelegramId?: number;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  },
  fn: (chatId: number) => Promise<boolean>,
): Promise<PinBroadcastResult> {
  const users = await prisma.user.findMany({
    select: { telegramId: true },
    orderBy: { createdAt: "asc" },
  });
  const targets = opts.excludeTelegramId
    ? users.filter((u) => Number(u.telegramId) !== opts.excludeTelegramId)
    : users;

  let sent = 0;
  let failed = 0;
  const total = targets.length;

  for (let i = 0; i < total; i++) {
    const chatId = Number(targets[i]!.telegramId);
    try {
      const ok = await fn(chatId);
      if (ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
    if (opts.onProgress && (i === 0 || (i + 1) % 25 === 0 || i + 1 === total)) {
      await opts.onProgress(i + 1, total);
    }
    if (i + 1 < total) await sleep(DELAY_MS);
  }

  return { total, sent, failed };
}

/** Re-send + pin banner for every bot user. */
export async function broadcastPinMiniAppBanner(
  api: Api,
  opts?: {
    excludeTelegramId?: number;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  },
): Promise<PinBroadcastResult> {
  return eachUserChat(opts ?? {}, async (chatId) => {
    const r = await sendAndPinMiniAppBanner(api, chatId);
    return r.ok;
  });
}

/** Unpin all pinned messages in every user's private chat with the bot. */
export async function broadcastUnpinMiniAppBanner(
  api: Api,
  opts?: {
    excludeTelegramId?: number;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  },
): Promise<PinBroadcastResult> {
  return eachUserChat(opts ?? {}, async (chatId) => {
    const r = await unpinMiniAppBanner(api, chatId);
    return r.ok;
  });
}
