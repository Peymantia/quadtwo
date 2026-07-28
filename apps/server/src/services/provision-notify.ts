import { env } from "../config/env.js";
import { userServiceActionsKeyboard } from "../bot/keyboards.js";
import { formatTraffic } from "../utils/format.js";
import { applyPremiumReplyMarkup, attachPremiumTextEntities, getEmojiStyle } from "./emoji-transform.js";
import type { ProvisionResult } from "./provision.js";

export type ProvisionResultWithBulk = ProvisionResult & { bulk?: ProvisionResult[] };

type TgEntity = { type: string; offset: number; length: number; custom_emoji_id?: string };
type MsgPart = { text: string; code?: boolean };

/** Build plain text + code entities (no HTML) so Premium custom_emoji can coexist. */
function buildMessage(lines: Array<MsgPart[] | null>): { text: string; entities: TgEntity[] } {
  const entities: TgEntity[] = [];
  const out: string[] = [];
  let offset = 0;
  for (const line of lines) {
    if (!line) continue;
    let lineText = "";
    for (const part of line) {
      if (part.code && part.text) {
        entities.push({ type: "code", offset: offset + lineText.length, length: part.text.length });
      }
      lineText += part.text;
    }
    out.push(lineText);
    offset += lineText.length + 1;
  }
  return { text: out.join("\n"), entities };
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  opts?: { replyMarkup?: unknown; entities?: TgEntity[] },
) {
  const style = await getEmojiStyle();
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (opts?.replyMarkup) {
    const raw =
      opts.replyMarkup &&
      typeof opts.replyMarkup === "object" &&
      "toJSON" in (opts.replyMarkup as object) &&
      typeof (opts.replyMarkup as { toJSON: () => unknown }).toJSON === "function"
        ? (opts.replyMarkup as { toJSON: () => unknown }).toJSON()
        : opts.replyMarkup;
    body.reply_markup = style === "premium" ? await applyPremiumReplyMarkup(raw) : raw;
  }
  let entities = opts?.entities ?? [];
  if (style === "premium") {
    entities = attachPremiumTextEntities(text, entities);
  }
  if (entities.length) body.entities = entities;

  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`sendMessage failed: ${res.status} ${errText}`);
  }
}

/**
 * Same post-purchase / renew message + action keyboard as the bot my-services detail.
 * Used by bot delivery and web admin approve so the user always gets the buttons.
 * No HTML parse_mode — so Premium custom_emoji entities + button icons work.
 */
export async function deliverProvisionToUser(
  telegramId: bigint | number,
  result: ProvisionResultWithBulk | ProvisionResult,
  trafficGb: number | null,
  mode: "new" | "renew" | "addon" = "new",
  opts?: { isAdmin?: boolean },
): Promise<void> {
  const all = "bulk" in result && result.bulk?.length ? [result, ...result.bulk] : [result];
  const chatId = Number(telegramId);

  if (all.length > 1) {
    await sendTelegramMessage(
      chatId,
      `✅ ${all.length} اشتراک آماده شد (خرید عمده)\nحجم هر کدام: ${formatTraffic(trafficGb)}`,
    );
  }

  for (const one of all) {
    const title =
      mode === "addon"
        ? "✅ تغییرات سرویس اعمال شد"
        : mode === "renew"
          ? "✅ سرویس تمدید شد"
          : all.length > 1
            ? "📦 یکی از اکانت‌های عمده"
            : "✅ اشتراک شما آماده شد";
    const exp = one.expiresAt ? new Date(one.expiresAt).toLocaleDateString("fa-IR") : null;
    const { text, entities } = buildMessage([
      [{ text: title }],
      [{ text: "" }],
      [{ text: "کد: " }, { text: one.code, code: true }],
      [{ text: "اکانت: " }, { text: one.email, code: true }],
      trafficGb != null || mode === "new" || mode === "renew"
        ? [{ text: `حجم: ${formatTraffic(trafficGb)}` }]
        : null,
      exp ? [{ text: `انقضا (پس از فعال‌سازی): ${exp}` }] : null,
      mode === "new" || mode === "renew" ? [{ text: "⏳ اعتبار: از اولین اتصال شروع می‌شود" }] : null,
      one.subUrl ? [{ text: "🔗 لینک اشتراک:" }] : null,
      one.subUrl ? [{ text: one.subUrl, code: true }] : null,
      [{ text: "" }],
      [{ text: "دکمه‌های زیر هم برای مدیریت سریع سرویس در دسترس هستند:" }],
    ]);

    await sendTelegramMessage(chatId, text, {
      replyMarkup: userServiceActionsKeyboard(one.subscriptionId, { isAdmin: opts?.isAdmin }),
      entities,
    });
  }
}
