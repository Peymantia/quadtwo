import { GrammyError, HttpError, InlineKeyboard, InputFile } from "grammy";
import { OrderStatus, UserRole } from "@prisma/client";
import { isAdminTelegramId } from "../config/env.js";
import { prisma } from "../db.js";
import {
  attachReceipt,
  createCardOrder,
  findPendingPaymentOrder,
  getOrderForAdmin,
  listActivePlans,
  markPaid,
  rejectOrder,
} from "../services/orders.js";
import { provisionOrder } from "../services/provision.js";
import { getPaymentCard, getSetting, setSetting } from "../services/settings.js";
import { upsertUserFromTelegram } from "../services/users.js";
import { formatToman, formatTraffic } from "../utils/format.js";
import {
  adminOrderKeyboard,
  mainMenuKeyboard,
  payConfirmKeyboard,
  planSummary,
  plansKeyboard,
} from "./keyboards.js";
import { createTelegramBot } from "./telegram.js";
import type { Context } from "grammy";

async function requireChannel(ctx: Context) {
  const required = (await getSetting("channel_required")) === "true";
  const channel = await getSetting("channel_username");
  if (!required || !channel) return true;

  const username = channel.replace(/^@/, "");
  try {
    const member = await ctx.api.getChatMember(`@${username}`, ctx.from!.id);
    const ok = ["creator", "administrator", "member", "restricted"].includes(member.status);
    if (ok) return true;
  } catch {
    /* channel missing or bot not admin */
  }

  await ctx.reply(
    `برای استفاده از ربات ابتدا در کانال عضو شوید:\n\n@${username}`,
    {
      reply_markup: new InlineKeyboard()
        .url("📢 عضویت در کانال", `https://t.me/${username}`)
        .row()
        .text("✅ بررسی عضویت", "check:channel"),
    },
  );
  return false;
}

export function createBot() {
  const bot = createTelegramBot();

  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await upsertUserFromTelegram(ctx.from);
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const brand = await getSetting("brand_name");
    const welcome = await getSetting("welcome_text");
    const admin = isAdminTelegramId(ctx.from?.id);
    await ctx.reply(`سلام ${ctx.from?.first_name ?? ""} 👋\nبه ${brand} خوش آمدید.\n\n${welcome}`, {
      reply_markup: mainMenuKeyboard(admin),
    });
  });

  bot.callbackQuery("check:channel", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const admin = isAdminTelegramId(ctx.from?.id);
    await ctx.reply("عضویت تأیید شد ✅", { reply_markup: mainMenuKeyboard(admin) });
  });

  bot.hears("🛒 خرید اشتراک", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const plans = await listActivePlans();
    if (plans.length === 0) {
      await ctx.reply("هنوز پلنی تعریف نشده است.");
      return;
    }
    await ctx.reply("یک پلن انتخاب کنید:", {
      reply_markup: plansKeyboard(plans, user),
    });
  });

  bot.callbackQuery(/^buy:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const planId = ctx.match![1];
    const user = await upsertUserFromTelegram(ctx.from!);
    const order = await createCardOrder(user.id, planId);
    const card = await getPaymentCard();
    const text = [
      "✅ سفارش ثبت شد",
      "",
      planSummary(order.plan, order.price),
      "",
      "💳 کارت‌به‌کارت",
      `شماره کارت: \`${card.number}\``,
      `به نام: ${card.holder}`,
      "",
      "پس از واریز، روی دکمه زیر بزنید و عکس رسید را بفرستید.",
      `کد سفارش: \`${order.id.slice(-8)}\``,
    ].join("\n");

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: payConfirmKeyboard(order.id),
    });
  });

  bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "عکس رسید را ارسال کنید" });
    const orderId = ctx.match![1];
    await ctx.reply(
      `سفارش \`${orderId.slice(-8)}\`\nالان عکس رسید پرداخت را همین‌جا بفرستید.`,
      { parse_mode: "Markdown" },
    );
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = ctx.match![1];
    const user = await upsertUserFromTelegram(ctx.from!);
    await prisma.order.updateMany({
      where: { id: orderId, userId: user.id, status: OrderStatus.pending_payment },
      data: { status: OrderStatus.cancelled },
    });
    await ctx.editMessageText("سفارش لغو شد.");
  });

  bot.callbackQuery("menu:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
    const admin = isAdminTelegramId(ctx.from?.id);
    await ctx.reply("منوی اصلی:", { reply_markup: mainMenuKeyboard(admin) });
  });

  bot.on(["message:photo", "message:document"], async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const pending = await findPendingPaymentOrder(user.id);
    if (!pending) return;

    const fileId =
      ctx.message.photo?.at(-1)?.file_id ??
      (ctx.message.document?.mime_type?.startsWith("image/")
        ? ctx.message.document.file_id
        : undefined);

    if (!fileId) {
      await ctx.reply("لطفاً عکس رسید را ارسال کنید.");
      return;
    }

    const order = await attachReceipt(pending.id, user.id, fileId, ctx.message.caption);
    await ctx.reply("رسید دریافت شد ✅\nسفارش برای بررسی ادمین ارسال شد. لطفاً منتظر بمانید.");

    const admins = await prisma.user.findMany({ where: { role: UserRole.admin } });
    const caption = [
      "🔔 سفارش جدید — در انتظار تأیید",
      "",
      `کاربر: ${order.user.firstName ?? ""} @${order.user.username ?? "—"}`,
      `TG: \`${order.user.telegramId}\``,
      planSummary(order.plan, order.price),
      `سفارش: \`${order.id}\``,
    ].join("\n");

    for (const admin of admins) {
      try {
        await ctx.api.sendPhoto(Number(admin.telegramId), fileId, {
          caption,
          parse_mode: "Markdown",
          reply_markup: adminOrderKeyboard(order.id),
        });
      } catch (err) {
        console.error("notify admin failed", admin.telegramId, err);
      }
    }
  });

  bot.callbackQuery(/^adm:ok:(.+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "در حال ساخت اکانت..." });
    const orderId = ctx.match![1];
    const order = await getOrderForAdmin(orderId);
    if (!order) {
      await ctx.reply("سفارش پیدا نشد.");
      return;
    }
    if (order.status === OrderStatus.completed) {
      await ctx.reply("این سفارش قبلاً تکمیل شده.");
      return;
    }
    if (order.status !== OrderStatus.awaiting_review && order.status !== OrderStatus.paid) {
      await ctx.reply(`وضعیت سفارش قابل تأیید نیست: ${order.status}`);
      return;
    }

    try {
      await markPaid(orderId);
      const result = await provisionOrder(orderId);
      const text = [
        "🎉 اشتراک شما آماده شد",
        "",
        `کد: \`${result.code}\``,
        `حجم: ${formatTraffic(order.plan.trafficGb)}`,
        `انقضا: ${result.expiresAt.toLocaleDateString("fa-IR")}`,
        "",
        "🔗 لینک اشتراک:",
        `\`${result.subUrl}\``,
        result.shareLinks[0] ? `\nکانفیگ:\n\`${result.shareLinks[0]}\`` : "",
      ].join("\n");

      await ctx.api.sendMessage(Number(order.user.telegramId), text, { parse_mode: "Markdown" });
      await ctx.api.sendPhoto(
        Number(order.user.telegramId),
        new InputFile(result.qrPng, "qr.png"),
        { caption: "QR Code اشتراک — با اپلیکیشن اسکن کنید" },
      );

      await ctx.editMessageCaption({
        caption: `✅ تأیید شد و اکانت ساخته شد\n${result.code}`,
      });
    } catch (err) {
      console.error(err);
      await ctx.reply(`خطا در ساخت اکانت:\n${String(err)}`);
    }
  });

  bot.callbackQuery(/^adm:no:(.+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const orderId = ctx.match![1];
    const order = await rejectOrder(orderId, "رد توسط ادمین");
    await ctx.api.sendMessage(
      Number(order.user.telegramId),
      "❌ سفارش شما رد شد.\nاگر مبلغ واریز کرده‌اید با پشتیبانی تماس بگیرید.",
    );
    await ctx.editMessageCaption({ caption: "❌ سفارش رد شد" });
  });

  bot.hears("📄 اشتراک‌های من", async (ctx) => {
    const user = await upsertUserFromTelegram(ctx.from!);
    const subs = await prisma.subscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    if (subs.length === 0) {
      await ctx.reply("اشتراکی ندارید.");
      return;
    }
    for (const sub of subs) {
      await ctx.reply(
        [
          `🆔 ${sub.code}`,
          `وضعیت: ${sub.status}`,
          `حجم: ${formatTraffic(sub.trafficGb)}`,
          `انقضا: ${sub.expiresAt.toLocaleDateString("fa-IR")}`,
          sub.subUrl ? `لینک:\n\`${sub.subUrl}\`` : "",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    }
  });

  bot.hears("💳 کیف پول", async (ctx) => {
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    await ctx.reply(
      `موجودی کیف پول:\n${formatToman(wallet?.balance ?? 0)}\n\nشارژ کیف پول در فاز بعدی فعال می‌شود. فعلاً از کارت‌به‌کارت خرید کنید.`,
    );
  });

  bot.hears("☎️ پشتیبانی", async (ctx) => {
    await ctx.reply("برای پشتیبانی به ادمین پیام دهید.");
  });

  bot.hears("👑 پنل ادمین", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const pending = await prisma.order.count({
      where: { status: OrderStatus.awaiting_review },
    });
    await ctx.reply(
      [
        "👑 پنل ادمین",
        `سفارش‌های در انتظار: ${pending}`,
        "",
        "دستورات:",
        "`/setcard شماره_کارت|نام_صاحب`",
        "`/setchannel @username` یا خالی برای غیرفعال",
        "`/requirechannel on|off`",
        "`/pending` لیست سفارش‌های باز",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  bot.command("setcard", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const raw = ctx.match?.trim();
    if (!raw || !raw.includes("|")) {
      await ctx.reply("فرمت: /setcard 6037-...|نام صاحب");
      return;
    }
    const [number, holder] = raw.split("|").map((s) => s.trim());
    await setSetting("card_number", number);
    await setSetting("card_holder", holder);
    await ctx.reply(`کارت ذخیره شد:\n${number}\n${holder}`);
  });

  bot.command("setchannel", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const value = (ctx.match ?? "").trim().replace(/^@/, "");
    await setSetting("channel_username", value);
    await ctx.reply(value ? `کانال تنظیم شد: @${value}` : "کانال حذف شد");
  });

  bot.command("requirechannel", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const v = (ctx.match ?? "").trim().toLowerCase();
    if (v !== "on" && v !== "off") {
      await ctx.reply("فرمت: /requirechannel on|off");
      return;
    }
    await setSetting("channel_required", v === "on" ? "true" : "false");
    await ctx.reply(`عضویت اجباری: ${v}`);
  });

  bot.command("pending", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const orders = await prisma.order.findMany({
      where: { status: OrderStatus.awaiting_review },
      include: { plan: true, user: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    if (orders.length === 0) {
      await ctx.reply("سفارش معلقی نیست.");
      return;
    }
    for (const order of orders) {
      const text = [
        `سفارش \`${order.id.slice(-8)}\``,
        `@${order.user.username ?? "—"} · ${formatToman(order.price)}`,
        planSummary(order.plan, order.price),
      ].join("\n");
      if (order.receiptFileId) {
        await ctx.replyWithPhoto(order.receiptFileId, {
          caption: text,
          parse_mode: "Markdown",
          reply_markup: adminOrderKeyboard(order.id),
        });
      } else {
        await ctx.reply(text, {
          parse_mode: "Markdown",
          reply_markup: adminOrderKeyboard(order.id),
        });
      }
    }
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error("Grammy error", e.description);
    else if (e instanceof HttpError) console.error("Telegram HTTP", e);
    else console.error("bot error", e);
  });

  return bot;
}
