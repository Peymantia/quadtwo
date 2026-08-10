import type { Api, Context } from "grammy";
import type { Message } from "grammy/types";
import { BTN, hearsBtn } from "./keyboards.js";

/** Status / toast bot notices auto-delete after this delay. Change anytime. */
export const EPHEMERAL_TTL_MS = 10_000;

type Deleter = Pick<Api, "deleteMessage">;

let menuTriggerSet: Set<string> | null = null;

function menuTriggerTexts(): Set<string> {
  if (menuTriggerSet) return menuTriggerSet;
  const set = new Set<string>();
  for (const label of Object.values(BTN)) {
    for (const v of hearsBtn(label)) set.add(v);
  }
  for (const v of ["انصراف", "cancel", "Cancel", "CANCEL"]) set.add(v);
  menuTriggerSet = set;
  return set;
}

/** Reply-keyboard taps + short slash commands (not /start). */
export function isEphemeralUserTrigger(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\/start\b/i.test(t)) return false;
  if (/^\/(update|menu|hide|setminiapp)\b/i.test(t)) return true;
  return menuTriggerTexts().has(t);
}

export function scheduleEphemeralDelete(
  api: Deleter,
  chatId: number,
  messageId: number,
  ttlMs: number = EPHEMERAL_TTL_MS,
) {
  const timer = setTimeout(() => {
    void api.deleteMessage(chatId, messageId).catch(() => undefined);
  }, ttlMs);
  timer.unref?.();
}

/** Schedule delete for an already-sent message (bot or user). */
export function markEphemeral(
  ctx: Context,
  message: Message | undefined | null,
  ttlMs: number = EPHEMERAL_TTL_MS,
) {
  const chatId = ctx.chat?.id ?? message?.chat?.id;
  const messageId = message?.message_id;
  if (chatId == null || messageId == null) return;
  scheduleEphemeralDelete(ctx.api, chatId, messageId, ttlMs);
}

/**
 * Auto-delete the user's tap/command that triggered the handler
 * (e.g. «خرید سرویس جدید», /update). Keeps /start. Does not touch ReplyKeyboard.
 */
export function markTriggerEphemeral(ctx: Context, ttlMs: number = EPHEMERAL_TTL_MS) {
  if (!ctx.message?.message_id || ctx.chat?.id == null) return;
  const text = ctx.message.text?.trim() ?? "";
  if (!isEphemeralUserTrigger(text)) return;
  scheduleEphemeralDelete(ctx.api, ctx.chat.id, ctx.message.message_id, ttlMs);
}

/** reply() + auto-delete after TTL. Do NOT attach a ReplyKeyboard — deleting that message removes the keyboard. */
export async function replyEphemeral(
  ctx: Context,
  text: string,
  other?: Parameters<Context["reply"]>[1],
  ttlMs: number = EPHEMERAL_TTL_MS,
) {
  const msg = await ctx.reply(text, other);
  markEphemeral(ctx, msg, ttlMs);
  return msg;
}

/**
 * Short status / toast replies (no ReplyKeyboard).
 * Skips long content (receipts, guides, multi-line summaries).
 */
export async function replyShortEphemeral(
  ctx: Context,
  text: string,
  other?: Parameters<Context["reply"]>[1],
  ttlMs: number = EPHEMERAL_TTL_MS,
) {
  const plain = text.trim();
  const lines = plain.split("\n").filter((l) => l.trim()).length;
  // Keep substantial messages; toast-size only
  if (plain.length > 180 || lines > 4) {
    return ctx.reply(text, other);
  }
  return replyEphemeral(ctx, text, other, ttlMs);
}
