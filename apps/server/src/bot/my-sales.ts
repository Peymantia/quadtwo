import { InlineKeyboard, type Bot, type Context } from "grammy";
import { upsertUserFromTelegram } from "../services/users.js";
import { effectiveRole } from "../services/demo-role.js";
import { buildSalesStats, parseSalesPeriod, type SalesPeriod } from "../services/admin-reports.js";

async function showMySales(ctx: Context, period: SalesPeriod = "jalali_month", edit = true) {
  if (!ctx.from) return;
  const user = await upsertUserFromTelegram(ctx.from);
  const role = effectiveRole(ctx.from.id, user.role);
  if (role !== "partner" && role !== "wholesale" && role !== "reseller" && role !== "admin") {
    await ctx.reply("این بخش برای همکار، همکار ویژه، عمده‌فروش و ادمین است.");
    return;
  }
  const stats = await buildSalesStats({
    userId: role === "admin" ? null : user.id,
    period,
    includeWallet: role === "admin",
    title: role === "admin" ? "گزارش فروش" : "گزارش فروش شما",
  });
  const p = (key: SalesPeriod, label: string) => (period === key ? `• ${label}` : label);
  const kb = new InlineKeyboard()
    .text(p("today", "امروز"), "mysales:today")
    .text(p("week", "هفته"), "mysales:week")
    .text(p("jalali_month", "ماه"), "mysales:jalali_month")
    .row()
    .text(p("month", "۳۰روز"), "mysales:month")
    .text(p("all", "کل"), "mysales:all")
    .row()
    .text("« بازگشت", role === "admin" ? "cc:home" : "m:partnerpanel");

  const text = stats.text.slice(0, 3900);
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: kb });
      return;
    } catch {
      /* fall through */
    }
  }
  await ctx.reply(text, { reply_markup: kb });
}

export function registerMySalesBotHandlers(bot: Bot) {
  bot.callbackQuery("mysales:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMySales(ctx, "jalali_month", true);
  });

  bot.callbackQuery(/^mysales:(today|week|month|jalali_month|all)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMySales(ctx, parseSalesPeriod(ctx.match![1]), true);
  });
}
