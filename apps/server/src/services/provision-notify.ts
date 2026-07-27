import { env } from "../config/env.js";
import { userServiceActionsKeyboard } from "../bot/keyboards.js";
import { formatTraffic } from "../utils/format.js";
import { attachPremiumTextEntities, getEmojiStyle } from "./emoji-transform.js";
import type { ProvisionResult } from "./provision.js";

export type ProvisionResultWithBulk = ProvisionResult & { bulk?: ProvisionResult[] };

async function sendTelegramMessage(
  chatId: number,
  text: string,
  opts?: { replyMarkup?: unknown; parseMode?: "HTML" },
) {
  const style = await getEmojiStyle();
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (opts?.replyMarkup) body.reply_markup = opts.replyMarkup;
  if (opts?.parseMode) body.parse_mode = opts.parseMode;
  if (style === "premium" && !opts?.parseMode) {
    const entities = attachPremiumTextEntities(text);
    if (entities.length) body.entities = entities;
  }
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
 */
export async function deliverProvisionToUser(
  telegramId: bigint | number,
  result: ProvisionResultWithBulk | ProvisionResult,
  trafficGb: number | null,
  mode: "new" | "renew" | "addon" = "new",
): Promise<void> {
  const all = "bulk" in result && result.bulk?.length ? [result, ...result.bulk] : [result];
  const chatId = Number(telegramId);

  if (all.length > 1) {
    await sendTelegramMessage(
      chatId,
      `🎉 ${all.length} اشتراک آماده شد (خرید عمده)\nحجم هر کدام: ${formatTraffic(trafficGb)}`,
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
            : "🎉 اشتراک شما آماده شد";
    const exp = one.expiresAt ? new Date(one.expiresAt).toLocaleDateString("fa-IR") : null;
    const text = [
      title,
      "",
      `کد: <code>${one.code}</code>`,
      `اکانت: <code>${one.email}</code>`,
      trafficGb != null || mode === "new" || mode === "renew" ? `حجم: ${formatTraffic(trafficGb)}` : "",
      exp ? `انقضا (پس از فعال‌سازی): ${exp}` : "",
      mode === "new" || mode === "renew" ? "⏱ اعتبار: از اولین اتصال شروع می‌شود" : "",
      "",
      "از دکمه‌های زیر لینک یا QR را بگیرید:",
    ]
      .filter(Boolean)
      .join("\n");

    await sendTelegramMessage(chatId, text, {
      replyMarkup: userServiceActionsKeyboard(one.subscriptionId),
      parseMode: "HTML",
    });
  }
}
