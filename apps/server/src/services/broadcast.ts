import type { Api } from "grammy";
import { prisma } from "../db.js";

export type BroadcastResult = {
  total: number;
  sent: number;
  failed: number;
};

const DELAY_MS = 40; // ~25 msgs/sec — under Telegram flood limits

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Count users that can receive a broadcast. */
export async function countBroadcastRecipients(excludeTelegramId?: number): Promise<number> {
  return prisma.user.count({
    where: excludeTelegramId
      ? { telegramId: { not: BigInt(excludeTelegramId) } }
      : undefined,
  });
}

/**
 * Send plain text to every bot user (best-effort).
 * Skips blocked/deleted chats; does not throw on individual failures.
 */
export async function broadcastTextToAllUsers(
  api: Api,
  text: string,
  opts?: {
    excludeTelegramId?: number;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  },
): Promise<BroadcastResult> {
  const users = await prisma.user.findMany({
    select: { telegramId: true },
    orderBy: { createdAt: "asc" },
  });
  const targets = opts?.excludeTelegramId
    ? users.filter((u) => Number(u.telegramId) !== opts.excludeTelegramId)
    : users;

  let sent = 0;
  let failed = 0;
  const total = targets.length;

  for (let i = 0; i < targets.length; i++) {
    const chatId = Number(targets[i]!.telegramId);
    try {
      await api.sendMessage(chatId, text);
      sent++;
    } catch (err) {
      failed++;
      console.warn("broadcast failed", chatId, err);
    }
    if (opts?.onProgress && (i === 0 || (i + 1) % 25 === 0 || i + 1 === total)) {
      await opts.onProgress(i + 1, total);
    }
    if (i + 1 < total) await sleep(DELAY_MS);
  }

  return { total, sent, failed };
}

/**
 * Copy an admin message (text/photo/…) to every user via copyMessage.
 */
export async function broadcastCopyToAllUsers(
  api: Api,
  fromChatId: number,
  messageId: number,
  opts?: {
    excludeTelegramId?: number;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  },
): Promise<BroadcastResult> {
  const users = await prisma.user.findMany({
    select: { telegramId: true },
    orderBy: { createdAt: "asc" },
  });
  const targets = opts?.excludeTelegramId
    ? users.filter((u) => Number(u.telegramId) !== opts.excludeTelegramId)
    : users;

  let sent = 0;
  let failed = 0;
  const total = targets.length;

  for (let i = 0; i < targets.length; i++) {
    const chatId = Number(targets[i]!.telegramId);
    try {
      await api.copyMessage(chatId, fromChatId, messageId);
      sent++;
    } catch (err) {
      failed++;
      console.warn("broadcast copy failed", chatId, err);
    }
    if (opts?.onProgress && (i === 0 || (i + 1) % 25 === 0 || i + 1 === total)) {
      await opts.onProgress(i + 1, total);
    }
    if (i + 1 < total) await sleep(DELAY_MS);
  }

  return { total, sent, failed };
}
