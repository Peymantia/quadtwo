import type { Api, Bot } from "grammy";
import { resolveMiniAppUrl } from "../services/settings.js";

/** Slash commands shown in the chat menu (☰ next to the input). */
export async function syncTelegramMenu(api: Api) {
  const commands = [
    { command: "start", description: "منوی اصلی" },
    { command: "update", description: "به‌روزرسانی منو و تغییرات جدید" },
    { command: "hide", description: "مخفی کردن کیبورد (نمایش تمام‌صفحه)" },
    { command: "app", description: "ورود به پنل وب‌اپ / مرورگر" },
    { command: "buy", description: "خرید سرویس" },
    { command: "services", description: "سرویس‌های من" },
    { command: "wallet", description: "کیف پول" },
    { command: "support", description: "پشتیبانی" },
  ];

  await api.setMyCommands(commands);
  try {
    await api.setMyCommands(commands, { language_code: "fa" });
  } catch {
    /* older API / ignore */
  }

  const miniUrl = await resolveMiniAppUrl();
  if (miniUrl) {
    // Chat-list «OPEN» / bottom Menu → opens Mini App (silent Telegram login)
    await api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "پنل",
        web_app: { url: miniUrl },
      },
    });
  } else {
    await api.setChatMenuButton({
      menu_button: { type: "commands" },
    });
  }
}

export async function syncTelegramMenuSafe(bot: Bot) {
  try {
    await syncTelegramMenu(bot.api);
    console.log("telegram menu commands synced");
  } catch (err) {
    console.warn("syncTelegramMenu failed:", err);
  }
}
