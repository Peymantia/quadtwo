import type { Api, Context } from "grammy";
import type { Message } from "grammy/types";

/** Status / toast bot notices auto-delete after this delay. Change anytime. */
export const EPHEMERAL_TTL_MS = 10_000;

type Deleter = Pick<Api, "deleteMessage">;

export function scheduleEphemeralDelete(
  api: Deleter,
  chatId: number,
  messageId: number,
  ttlMs: number = EPHEMERAL_TTL_MS,
) {
  const timer = setTimeout(() => {
    void api.deleteMessage(chatId, messageId).catch(() => undefined);
  }, ttlMs);
  // Don't keep the Node process alive only for toast cleanup
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

/** Delete the user's command / button text that triggered the handler (e.g. /update). */
export function markTriggerEphemeral(ctx: Context, ttlMs: number = EPHEMERAL_TTL_MS) {
  if (!ctx.message?.message_id || ctx.chat?.id == null) return;
  scheduleEphemeralDelete(ctx.api, ctx.chat.id, ctx.message.message_id, ttlMs);
}

/** reply() + auto-delete after TTL (reply keyboard, if any, stays). */
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
