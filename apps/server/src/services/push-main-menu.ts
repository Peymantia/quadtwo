import { env } from "../config/env.js";
import { mainMenuReply, type MainMenuOpts } from "../bot/keyboards.js";
import { prisma } from "../db.js";
import { effectiveRole } from "./demo-role.js";
import { isDemoMode } from "./license.js";
import { isServerlessEnabled, resolveMiniAppUrl } from "./settings.js";
import { attachPremiumTextEntities, getEmojiStyle } from "./emoji-transform.js";

export async function mainMenuOptsForTelegramId(telegramId: bigint | number): Promise<MainMenuOpts | null> {
  const user = await prisma.user.findFirst({ where: { telegramId: BigInt(telegramId) } });
  if (!user) return null;
  const role = effectiveRole(Number(telegramId), user.role);
  return {
    isAdmin: role === "admin",
    isPartner: role === "partner",
    isWholesale: role === "wholesale",
    isReseller: role === "reseller",
    demoMode: isDemoMode(),
    miniAppUrl: await resolveMiniAppUrl(),
    hidePartner: await isServerlessEnabled(),
  };
}

/** Notify user and (re)attach the sticky reply keyboard for their current role. */
export async function notifyTelegramWithMainMenu(telegramId: bigint | number, text: string) {
  try {
    const opts = await mainMenuOptsForTelegramId(telegramId);
    const style = await getEmojiStyle();
    const body: Record<string, unknown> = {
      chat_id: String(telegramId),
      text,
    };
    if (opts) {
      body.reply_markup = mainMenuReply(opts);
    }
    if (style === "premium") {
      const entities = attachPremiumTextEntities(text);
      if (entities.length) body.entities = entities;
    }
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* best-effort */
  }
}
