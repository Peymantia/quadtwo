import type { Api, Bot } from "grammy";
import { getSetting } from "../services/settings.js";

/** Slash commands shown in the chat menu (☰ next to the input). */
export async function syncTelegramMenu(api: Api) {
  const miniapp = (await getSetting("miniapp_url")).trim();

  const commands = [
    { command: "start", description: "منوی اصلی" },
    ...(miniapp
      ? [{ command: "app", description: "باز کردن وب‌اپ" }]
      : []),
    { command: "buy", description: "خرید سرویس" },
    { command: "services", description: "سرویس‌های من" },
    { command: "wallet", description: "کیف پول من" },
    { command: "support", description: "پشتیبانی" },
  ];

  await api.setMyCommands(commands);
  try {
    await api.setMyCommands(commands, { language_code: "fa" });
  } catch {
    /* older API / ignore */
  }

  // Show command list on the menu button beside the text field
  await api.setChatMenuButton({
    menu_button: { type: "commands" },
  });
}

export async function syncTelegramMenuSafe(bot: Bot) {
  try {
    await syncTelegramMenu(bot.api);
    console.log("telegram menu commands synced");
  } catch (err) {
    console.warn("syncTelegramMenu failed:", err);
  }
}
