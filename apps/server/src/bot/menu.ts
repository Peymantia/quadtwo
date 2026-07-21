import type { Api, Bot } from "grammy";

/** Slash commands shown in the chat menu (☰ next to the input). */
export async function syncTelegramMenu(api: Api) {
  const commands = [
    { command: "start", description: "منوی اصلی" },
    { command: "update", description: "به‌روزرسانی منو و تغییرات جدید" },
    { command: "hide", description: "مخفی کردن کیبورد (نمایش تمام‌صفحه)" },
    { command: "app", description: "ورود به داشبورد (شناسه و رمز)" },
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

  // Commands menu only — Mini App must not open before OTP credentials are shown.
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
