import { GrammyError, HttpError, InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import { OrderKind, OrderStatus, UserRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { isAdminTelegramId } from "../config/env.js";
import { prisma } from "../db.js";
import {
  attachReceipt,
  createMatrixOrder,
  createWalletChargeOrder,
  findPendingPaymentOrder,
  getOrderForAdmin,
  markPaid,
  orderSummaryText,
  payOrderWithWallet,
  rejectOrder,
} from "../services/orders.js";
import { listPriceMatrix, upsertPriceCell } from "../services/pricing.js";
import { provisionOrder, rotateSubId, rotateUuid, type ProvisionResult } from "../services/provision.js";
import { getPaymentCard, getSetting, setSetting } from "../services/settings.js";
import { getConfiguredInboundIds, parseInboundIds } from "../services/inbounds.js";
import { getWallet } from "../services/wallet.js";
import {
  approvePartner,
  rejectPartner,
  submitPartnerRequest,
  upsertUserFromTelegram,
} from "../services/users.js";
import { formatToman, formatTraffic } from "../utils/format.js";
import {
  adjustDraftMonths,
  adjustDraftVolume,
  draftPrice,
  getOrCreateDraft,
  setDraftNameMode,
} from "./draft.js";
import {
  adminOrderKeyboard,
  BTN,
  buyDraftText,
  buyWizardKeyboard,
  mainMenuKeyboard,
  orderPayText,
  partnerRequestKeyboard,
  payConfirmKeyboard,
  payMethodKeyboard,
  renewPickKeyboard,
  subscriptionKeyboard,
  walletChargeAmountsKeyboard,
  walletMenuKeyboard,
} from "./keyboards.js";
import { createTelegramBot } from "./telegram.js";

const waitingName = new Set<number>();
const waitingPartner = new Map<number, { step: "name" | "phone" | "note"; fullName?: string; phone?: string }>();
const waitingMatrix = new Map<number, string>();
const waitingWalletAmount = new Set<number>();

async function requireChannel(ctx: Context) {
  const required = (await getSetting("channel_required")) === "true";
  const channel = await getSetting("channel_username");
  if (!required || !channel) return true;

  const username = channel.replace(/^@/, "");
  try {
    const member = await ctx.api.getChatMember(`@${username}`, ctx.from!.id);
    if (["creator", "administrator", "member", "restricted"].includes(member.status)) return true;
  } catch {
    /* ignore */
  }

  await ctx.reply(`برای استفاده از ربات ابتدا در کانال عضو شوید:\n\n@${username}`, {
    reply_markup: new InlineKeyboard()
      .url("📢 عضویت در کانال", `https://t.me/${username}`)
      .row()
      .text("✅ بررسی عضویت", "check:channel"),
  });
  return false;
}

async function showBuyWizard(ctx: Context, edit = false) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const draft = await getOrCreateDraft(BigInt(ctx.from!.id));
  const priced = await draftPrice(user, draft);
  const text = buyDraftText({
    trafficGb: draft.unlimited ? null : draft.trafficGb,
    months: draft.months,
    price: priced?.price ?? null,
    accountMode: draft.accountMode,
    accountName: draft.accountName,
  });
  const kb = buyWizardKeyboard({
    trafficGb: draft.trafficGb,
    months: draft.months,
    unlimited: draft.unlimited,
    price: priced?.price ?? null,
  });
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

async function deliverResult(
  api: Context["api"],
  telegramId: bigint | number,
  result: ProvisionResult,
  trafficGb: number | null,
) {
  const text = [
    "🎉 اشتراک شما آماده شد",
    "",
    `کد: \`${result.code}\``,
    `اکانت: \`${result.email}\``,
    `حجم: ${formatTraffic(trafficGb)}`,
    `انقضا: ${result.expiresAt.toLocaleDateString("fa-IR")}`,
    "",
    "🔗 لینک اشتراک:",
    `\`${result.subUrl}\``,
  ].join("\n");
  await api.sendMessage(Number(telegramId), text, { parse_mode: "Markdown" });
  await api.sendPhoto(Number(telegramId), new InputFile(result.qrPng, "qr.png"), {
    caption: "QR Code اشتراک — اسکن کنید",
  });
}

async function startCardPayment(ctx: Context, orderId: string, summary: string) {
  const card = await getPaymentCard();
  const text = orderPayText(summary, card, orderId);
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: payConfirmKeyboard(orderId) });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: payConfirmKeyboard(orderId) });
  }
}

export function createBot() {
  const bot = createTelegramBot();

  bot.use(async (ctx, next) => {
    if (ctx.from) await upsertUserFromTelegram(ctx.from);
    await next();
  });

  bot.command("start", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const brand = await getSetting("brand_name");
    const welcome = await getSetting("welcome_text");
    const user = await upsertUserFromTelegram(ctx.from!);
    await ctx.reply(`سلام ${ctx.from?.first_name ?? ""} 👋\nبه ${brand} خوش آمدید.\n\n${welcome}`, {
      reply_markup: mainMenuKeyboard(user.role === "admin" || isAdminTelegramId(ctx.from?.id), user.role === "partner"),
    });
  });

  bot.callbackQuery("check:channel", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    await ctx.reply("عضویت تأیید شد ✅", {
      reply_markup: mainMenuKeyboard(user.role === "admin", user.role === "partner"),
    });
  });

  bot.callbackQuery("menu:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
    const user = await upsertUserFromTelegram(ctx.from!);
    await ctx.reply("منوی اصلی:", {
      reply_markup: mainMenuKeyboard(user.role === "admin", user.role === "partner"),
    });
  });

  bot.callbackQuery("wiz:noop", async (ctx) => ctx.answerCallbackQuery());

  bot.hears(BTN.buy, async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    await showBuyWizard(ctx);
  });

  bot.callbackQuery("wiz:vol:+", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftVolume(BigInt(ctx.from!.id), 1);
    await showBuyWizard(ctx, true);
  });
  bot.callbackQuery("wiz:vol:-", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftVolume(BigInt(ctx.from!.id), -1);
    await showBuyWizard(ctx, true);
  });
  bot.callbackQuery("wiz:mon:+", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftMonths(BigInt(ctx.from!.id), 1);
    await showBuyWizard(ctx, true);
  });
  bot.callbackQuery("wiz:mon:-", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftMonths(BigInt(ctx.from!.id), -1);
    await showBuyWizard(ctx, true);
  });

  bot.callbackQuery("wiz:name:random", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "نام رندوم" });
    waitingName.delete(ctx.from!.id);
    await setDraftNameMode(BigInt(ctx.from!.id), "random");
    await showBuyWizard(ctx, true);
  });

  bot.callbackQuery("wiz:name:custom", async (ctx) => {
    await ctx.answerCallbackQuery();
    waitingName.add(ctx.from!.id);
    await setDraftNameMode(BigInt(ctx.from!.id), "custom");
    await ctx.reply("نام اکانت را ارسال کنید (فقط حروف و عدد انگلیسی):");
  });

  bot.callbackQuery("wiz:checkout", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const draft = await getOrCreateDraft(BigInt(ctx.from!.id));
    const priced = await draftPrice(user, draft);
    if (!priced) {
      await ctx.reply("این ترکیب حجم/مدت قیمت‌گذاری نشده. با پشتیبانی تماس بگیرید.");
      return;
    }
    const accountName =
      draft.accountMode === "custom" && draft.accountName
        ? draft.accountName
        : `u${randomBytes(3).toString("hex")}`;

    const order = await createMatrixOrder({
      userId: user.id,
      trafficGb: draft.unlimited ? null : draft.trafficGb,
      months: draft.months,
      accountName,
    });
    const wallet = await getWallet(user.id);
    await ctx.editMessageText(
      `${orderSummaryText(order)}\n\nروش پرداخت را انتخاب کنید:`,
      { reply_markup: payMethodKeyboard(order.id, wallet.balance) },
    );
  });

  bot.callbackQuery(/^pay:card:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const order = await getOrderForAdmin(ctx.match![1]);
    if (!order || order.userId !== (await upsertUserFromTelegram(ctx.from!)).id) {
      await ctx.reply("سفارش پیدا نشد.");
      return;
    }
    await startCardPayment(ctx, order.id, orderSummaryText(order));
  });

  bot.callbackQuery(/^pay:wallet:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "پرداخت از کیف پول..." });
    const user = await upsertUserFromTelegram(ctx.from!);
    try {
      const result = await payOrderWithWallet(ctx.match![1], user.id);
      if ("kind" in result && result.kind === "wallet_credit") {
        await ctx.reply(`شارژ شد. موجودی: ${formatToman(result.balance)}`);
        return;
      }
      const order = await getOrderForAdmin(ctx.match![1]);
      await ctx.editMessageText("پرداخت از کیف پول انجام شد ✅");
      await deliverResult(ctx.api, user.telegramId, result as ProvisionResult, order?.trafficGb ?? null);
    } catch (err) {
      await ctx.reply(`خطا: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "عکس رسید را بفرستید" });
    await ctx.reply(`سفارش \`${ctx.match![1].slice(-8)}\`\nالان عکس رسید را بفرستید.`, {
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    await prisma.order.updateMany({
      where: { id: ctx.match![1], userId: user.id, status: OrderStatus.pending_payment },
      data: { status: OrderStatus.cancelled },
    });
    await ctx.editMessageText("سفارش لغو شد.");
  });

  bot.on(["message:photo", "message:document"], async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const pending = await findPendingPaymentOrder(user.id);
    if (!pending) return;

    const fileId =
      ctx.message.photo?.at(-1)?.file_id ??
      (ctx.message.document?.mime_type?.startsWith("image/") ? ctx.message.document.file_id : undefined);
    if (!fileId) {
      await ctx.reply("لطفاً عکس رسید را ارسال کنید.");
      return;
    }

    const order = await attachReceipt(pending.id, user.id, fileId, ctx.message.caption);
    await ctx.reply("رسید دریافت شد ✅\nمنتظر تأیید ادمین بمانید.");

    const caption = [
      "🔔 سفارش جدید",
      "",
      `کاربر: ${order.user.firstName ?? ""} @${order.user.username ?? "—"}`,
      orderSummaryText(order),
      `سفارش: \`${order.id}\``,
    ].join("\n");

    const admins = await prisma.user.findMany({ where: { role: UserRole.admin } });
    for (const admin of admins) {
      try {
        await ctx.api.sendPhoto(Number(admin.telegramId), fileId, {
          caption,
          parse_mode: "Markdown",
          reply_markup: adminOrderKeyboard(order.id),
        });
      } catch (err) {
        console.error("notify admin", err);
      }
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const tid = ctx.from?.id;
    if (!tid) return next();

    const text = ctx.message.text.trim();

    // Slash commands must never be trapped by wizard wait-states
    if (text.startsWith("/")) {
      waitingName.delete(tid);
      waitingPartner.delete(tid);
      waitingMatrix.delete(tid);
      waitingWalletAmount.delete(tid);
      return next();
    }

    if (text === "انصراف" || text.toLowerCase() === "cancel") {
      waitingName.delete(tid);
      waitingPartner.delete(tid);
      waitingMatrix.delete(tid);
      waitingWalletAmount.delete(tid);
      await ctx.reply("لغو شد.");
      return;
    }

    if (waitingWalletAmount.has(tid)) {
      const amount = Number(text.replace(/[^\d]/g, ""));
      if (!amount || amount < 10_000) {
        await ctx.reply("مبلغ نامعتبر. حداقل ۱۰٬۰۰۰ تومان.");
        return;
      }
      waitingWalletAmount.delete(tid);
      const user = await upsertUserFromTelegram(ctx.from!);
      const order = await createWalletChargeOrder(user.id, amount);
      await startCardPayment(ctx, order.id, orderSummaryText(order));
      return;
    }

    if (waitingName.has(tid)) {
      const name = text;
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(name)) {
        await ctx.reply("نام نامعتبر است. فقط a-z 0-9 ._- و ۳ تا ۳۲ کاراکتر.\nبرای لغو: انصراف");
        return;
      }
      waitingName.delete(tid);
      await setDraftNameMode(BigInt(tid), "custom", name);
      await ctx.reply(`نام اکانت ذخیره شد: ${name}`);
      await showBuyWizard(ctx);
      return;
    }

    const partnerFlow = waitingPartner.get(tid);
    if (partnerFlow) {
      if (partnerFlow.step === "name") {
        waitingPartner.set(tid, { step: "phone", fullName: text });
        await ctx.reply("شماره تماس را بفرستید (یا — بزنید):");
        return;
      }
      if (partnerFlow.step === "phone") {
        waitingPartner.set(tid, {
          step: "note",
          fullName: partnerFlow.fullName,
          phone: text === "—" ? undefined : text,
        });
        await ctx.reply("توضیح کوتاه (یا — ):");
        return;
      }
      if (partnerFlow.step === "note") {
        waitingPartner.delete(tid);
        const user = await upsertUserFromTelegram(ctx.from!);
        const req = await submitPartnerRequest(
          user.id,
          partnerFlow.fullName!,
          partnerFlow.phone,
          text === "—" ? undefined : text,
        );
        await ctx.reply("درخواست همکاری ثبت شد. منتظر تأیید ادمین بمانید.");
        const admins = await prisma.user.findMany({ where: { role: UserRole.admin } });
        for (const admin of admins) {
          await ctx.api.sendMessage(
            Number(admin.telegramId),
            `🤝 درخواست همکاری\n${partnerFlow.fullName}\n@${user.username ?? "—"}\nTG: ${user.telegramId}`,
            { reply_markup: partnerRequestKeyboard(req.id) },
          );
        }
        return;
      }
    }

    const matrixWait = waitingMatrix.get(tid);
    if (matrixWait && isAdminTelegramId(tid)) {
      const parts = text.split("|").map((s) => s.trim());
      if (parts.length !== 4) {
        await ctx.reply(
          "فرمت اشتباه.\n`gb|months|userPrice|partnerPrice`\nمثال: `25|1|330000|260000`\nنامحدود: `u|1|1500000|1200000`\nلغو: انصراف یا هر دستور /",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const trafficGb = parts[0] === "u" ? null : Number(parts[0]);
      const months = Number(parts[1]);
      const priceUser = Number(parts[2]);
      const pricePartner = Number(parts[3]);
      if ([months, priceUser, pricePartner].some((n) => Number.isNaN(n)) || (parts[0] !== "u" && Number.isNaN(Number(parts[0])))) {
        await ctx.reply("اعداد نامعتبر هستند. دوباره بفرستید یا انصراف.");
        return;
      }
      await upsertPriceCell({ trafficGb, months, priceUser, pricePartner });
      waitingMatrix.delete(tid);
      await ctx.reply("سلول ماتریکس ذخیره شد ✅");
      return;
    }

    return next();
  });

  bot.callbackQuery(/^adm:ok:(.+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "در حال اعمال..." });
    const orderId = ctx.match![1];
    const order = await getOrderForAdmin(orderId);
    if (!order) {
      await ctx.reply("سفارش پیدا نشد.");
      return;
    }
    if (order.status === OrderStatus.completed) {
      await ctx.reply("قبلاً تکمیل شده.");
      return;
    }
    try {
      await markPaid(orderId);
      const result = await provisionOrder(orderId);
      if ("kind" in result && result.kind === "wallet_credit") {
        await ctx.api.sendMessage(
          Number(order.user.telegramId),
          `✅ کیف پول شارژ شد\nموجودی: ${formatToman(result.balance)}`,
        );
        await ctx.editMessageCaption({ caption: `✅ شارژ کیف پول — ${formatToman(order.price)}` }).catch(() => undefined);
        return;
      }
      const provisioned = result as ProvisionResult;
      await deliverResult(ctx.api, order.user.telegramId, provisioned, order.trafficGb);
      await ctx.editMessageCaption({ caption: `✅ انجام شد — ${provisioned.code}` }).catch(() => undefined);
    } catch (err) {
      console.error(err);
      await ctx.reply(`خطا: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^adm:no:(.+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const order = await rejectOrder(ctx.match![1], "رد توسط ادمین");
    await ctx.api.sendMessage(Number(order.user.telegramId), "❌ سفارش شما رد شد.");
    await ctx.editMessageCaption({ caption: "❌ رد شد" }).catch(() => undefined);
  });

  bot.callbackQuery(/^prt:ok:(.+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    const req = await approvePartner(ctx.match![1]);
    await ctx.api.sendMessage(Number(req.user.telegramId), "✅ درخواست همکاری شما تأیید شد.");
    await ctx.editMessageText(`همکار تأیید شد — گروه: reseller_${req.user.telegramId}`);
  });

  bot.callbackQuery(/^prt:no:(.+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    const req = await rejectPartner(ctx.match![1]);
    await ctx.api.sendMessage(Number(req.user.telegramId), "❌ درخواست همکاری رد شد.");
    await ctx.editMessageText("درخواست رد شد.");
  });

  bot.hears(BTN.myServices, async (ctx) => {
    const user = await upsertUserFromTelegram(ctx.from!);
    const subs = await prisma.subscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    if (!subs.length) {
      await ctx.reply("سرویسی ندارید.\nاکانت‌ها با شناسه تلگرام شما ذخیره می‌شوند.");
      return;
    }
    for (const sub of subs) {
      await ctx.reply(
        [
          `🆔 ${sub.code}`,
          `اکانت: ${sub.email}`,
          `حجم: ${formatTraffic(sub.trafficGb)}`,
          `انقضا: ${sub.expiresAt.toLocaleDateString("fa-IR")}`,
          `وضعیت: ${sub.status}`,
        ].join("\n"),
        { reply_markup: subscriptionKeyboard(sub.id) },
      );
    }
  });

  bot.hears(BTN.renew, async (ctx) => {
    const user = await upsertUserFromTelegram(ctx.from!);
    const subs = await prisma.subscription.findMany({
      where: { userId: user.id, status: "active" },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    if (!subs.length) {
      await ctx.reply("سرویس فعالی برای تمدید نیست.");
      return;
    }
    await ctx.reply("کدام سرویس را تمدید می‌کنید؟", {
      reply_markup: renewPickKeyboard(subs.map((s) => ({ id: s.id, code: s.code }))),
    });
  });

  bot.hears(BTN.test, async (ctx) => {
    const enabled = (await getSetting("test_service_enabled")) === "true";
    if (!enabled) {
      await ctx.reply("🧪 سرویس تست فعلاً غیرفعال است.\nبه‌زودی فعال می‌شود.");
      return;
    }
    await ctx.reply("🧪 سرویس تست به‌زودی از همینجا ساخته می‌شود.");
  });

  bot.hears(BTN.national, async (ctx) => {
    await ctx.reply(`🇮🇷 ${(await getSetting("national_service_note")) || "به‌زودی"}`);
  });

  bot.hears(BTN.account, async (ctx) => {
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await getWallet(user.id);
    const roleLabel =
      user.role === "admin" ? "ادمین" : user.role === "partner" ? "نماینده فروش" : "کاربر عادی";
    await ctx.reply(
      [
        "👤 حساب کاربری",
        "",
        `نام: ${user.firstName ?? "—"}`,
        `یوزرنیم: @${user.username ?? "—"}`,
        `آی‌دی تلگرام: \`${user.telegramId}\``,
        `نقش: ${roleLabel}`,
        user.panelGroup ? `گروه پنل: ${user.panelGroup}` : "",
        `موجودی: ${formatToman(wallet.balance)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  bot.hears(BTN.guide, async (ctx) => {
    const url = await getSetting("guide_url");
    const text = await getSetting("guide_text");
    if (url) {
      await ctx.reply(text || "آموزش اتصال:", {
        reply_markup: new InlineKeyboard().url("📖 مشاهده آموزش", url),
      });
      return;
    }
    await ctx.reply(text || "آموزش هنوز تنظیم نشده.");
  });

  bot.hears(BTN.dashboard, async (ctx) => {
    const url = await getSetting("miniapp_url");
    if (!url) {
      await ctx.reply("داشبورد هنوز تنظیم نشده.\nادمین: /setminiapp https://app.anthropics.ir");
      return;
    }
    await ctx.reply("ورود به داشبورد:", {
      reply_markup: new InlineKeyboard().webApp("🚀 باز کردن داشبورد", url),
    });
  });

  bot.callbackQuery(/^sub:link:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const sub = await prisma.subscription.findUnique({ where: { id: ctx.match![1] } });
    if (!sub?.subUrl) return ctx.reply("لینک موجود نیست.");
    await ctx.reply(`🔗 لینک اشتراک:\n\`${sub.subUrl}\``, { parse_mode: "Markdown" });
  });

  bot.callbackQuery(/^sub:qr:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const sub = await prisma.subscription.findUnique({ where: { id: ctx.match![1] } });
    if (!sub?.subUrl) return ctx.reply("لینک موجود نیست.");
    const QRCode = (await import("qrcode")).default;
    const buf = await QRCode.toBuffer(sub.subUrl, { type: "png", width: 512, margin: 2 });
    await ctx.replyWithPhoto(new InputFile(buf, "qr.png"), { caption: "QR اشتراک" });
  });

  bot.callbackQuery(/^sub:rotsub:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال تغییر ساب..." });
    const user = await upsertUserFromTelegram(ctx.from!);
    const sub = await prisma.subscription.findFirst({ where: { id: ctx.match![1], userId: user.id } });
    if (!sub) return ctx.reply("پیدا نشد.");
    try {
      const result = await rotateSubId(sub.id);
      await deliverResult(ctx.api, user.telegramId, result, sub.trafficGb);
    } catch (err) {
      await ctx.reply(`خطا: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^sub:rotuuid:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال تغییر کانفیگ..." });
    const user = await upsertUserFromTelegram(ctx.from!);
    const sub = await prisma.subscription.findFirst({ where: { id: ctx.match![1], userId: user.id } });
    if (!sub) return ctx.reply("پیدا نشد.");
    try {
      const result = await rotateUuid(sub.id);
      await deliverResult(ctx.api, user.telegramId, result, sub.trafficGb);
      await ctx.reply("لینک کانفیگ قبلی باطل شد. از لینک ساب جدید استفاده کنید.");
    } catch (err) {
      await ctx.reply(`خطا: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^sub:renew:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    const sub = await prisma.subscription.findFirst({ where: { id: ctx.match![1], userId: user.id } });
    if (!sub) return ctx.reply("پیدا نشد.");
    const draft = await getOrCreateDraft(BigInt(ctx.from!.id));
    await prisma.buyDraft.update({
      where: { telegramId: BigInt(ctx.from!.id) },
      data: {
        trafficGb: sub.trafficGb ?? 10,
        unlimited: sub.trafficGb === null,
        months: 1,
      },
    });
    const priced = await draftPrice(user, { ...draft, trafficGb: sub.trafficGb, unlimited: sub.trafficGb === null, months: 1 });
    if (!priced) return ctx.reply("قیمت تمدید تعریف نشده.");
    const order = await createMatrixOrder({
      userId: user.id,
      trafficGb: sub.trafficGb,
      months: 1,
      accountName: sub.email,
      kind: OrderKind.renew,
      targetSubId: sub.id,
    });
    const wallet = await getWallet(user.id);
    await ctx.reply(`${orderSummaryText(order)}\n\nروش پرداخت:`, {
      reply_markup: payMethodKeyboard(order.id, wallet.balance),
    });
  });

  bot.hears(BTN.wallet, async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await getWallet(user.id);
    await ctx.reply(`موجودی کیف پول:\n${formatToman(wallet.balance)}`, {
      reply_markup: walletMenuKeyboard(),
    });
  });

  bot.callbackQuery("wallet:charge", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("مبلغ شارژ را انتخاب کنید:", {
      reply_markup: walletChargeAmountsKeyboard(),
    });
  });

  bot.callbackQuery(/^wallet:amt:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const raw = ctx.match![1];
    if (raw === "custom") {
      waitingWalletAmount.add(ctx.from!.id);
      await ctx.reply("مبلغ شارژ را به تومان بفرستید (حداقل ۱۰۰۰۰):");
      return;
    }
    const amount = Number(raw);
    const user = await upsertUserFromTelegram(ctx.from!);
    const order = await createWalletChargeOrder(user.id, amount);
    await startCardPayment(ctx, order.id, orderSummaryText(order));
  });

  bot.hears(BTN.support, async (ctx) => {
    const supportUser = await getSetting("support_username");
    const supportId = await getSetting("support_telegram_id");
    if (supportUser) {
      await ctx.reply(`🆘 پشتیبانی: @${supportUser.replace(/^@/, "")}`);
      return;
    }
    if (supportId) {
      await ctx.reply(`🆘 آی‌دی پشتیبانی: \`${supportId}\``, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply("پشتیبانی هنوز تنظیم نشده است.");
  });

  bot.hears(BTN.partner, async (ctx) => {
    const user = await upsertUserFromTelegram(ctx.from!);
    if (user.role === "partner") {
      await ctx.reply(`شما نماینده هستید.\nگروه پنل: ${user.panelGroup ?? "—"}`);
      return;
    }
    waitingPartner.set(ctx.from!.id, { step: "name" });
    await ctx.reply("🤝 درخواست نمایندگی فروش\nنام و نام خانوادگی را بفرستید:");
  });

  bot.hears(BTN.partnerPanel, async (ctx) => {
    const user = await upsertUserFromTelegram(ctx.from!);
    if (user.role !== "partner" && user.role !== "admin") return;
    await ctx.reply(
      `💼 پنل نماینده\nگروه: ${user.panelGroup ?? "—"}\nخریدها با قیمت نمایندگی محاسبه می‌شوند.\nسرویس‌های من = فقط اکانت‌هایی که با همین تلگرام خریده‌اید.`,
    );
  });

  bot.hears(BTN.admin, async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const pending = await prisma.order.count({ where: { status: OrderStatus.awaiting_review } });
    const partners = await prisma.partnerRequest.count({ where: { status: "pending" } });
    await ctx.reply(
      [
        "👑 پنل ادمین",
        `سفارش‌های باز: ${pending}`,
        `درخواست همکار: ${partners}`,
        "",
        "/pending — سفارش‌ها",
        "/matrix — نمایش ماتریکس",
        "/setmatrix — ویرایش سلول",
        "/setcard NUMBER|NAME",
        "/setchannel @user",
        "/requirechannel on|off",
        "/setsupport @user یا numeric_id",
        "/setinbounds 1-10 یا 1,2,3",
        "/inbounds — نمایش inboundهای فعلی",
      ].join("\n"),
    );
  });

  bot.command("pending", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const orders = await prisma.order.findMany({
      where: { status: OrderStatus.awaiting_review },
      include: { user: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    if (!orders.length) return ctx.reply("موردی نیست.");
    for (const order of orders) {
      const text = [`\`${order.id.slice(-8)}\``, orderSummaryText(order), `@${order.user.username ?? "—"}`].join("\n");
      if (order.receiptFileId) {
        await ctx.replyWithPhoto(order.receiptFileId, {
          caption: text,
          parse_mode: "Markdown",
          reply_markup: adminOrderKeyboard(order.id),
        });
      } else {
        await ctx.reply(text, { parse_mode: "Markdown", reply_markup: adminOrderKeyboard(order.id) });
      }
    }
  });

  bot.command("matrix", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const cells = await listPriceMatrix();
    const lines = cells.slice(0, 40).map(
      (c) =>
        `${c.trafficGb ?? "∞"}GB / ${c.months}m → user ${formatToman(c.priceUser)} | partner ${formatToman(c.pricePartner)}`,
    );
    await ctx.reply(lines.join("\n") || "خالی");
  });

  bot.command("setmatrix", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const raw = (ctx.match ?? "").trim();
    if (raw) {
      const parts = raw.split("|").map((s) => s.trim());
      if (parts.length !== 4) {
        await ctx.reply("Usage: /setmatrix 25|1|330000|260000");
        return;
      }
      const trafficGb = parts[0] === "u" ? null : Number(parts[0]);
      const months = Number(parts[1]);
      const priceUser = Number(parts[2]);
      const pricePartner = Number(parts[3]);
      await upsertPriceCell({ trafficGb, months, priceUser, pricePartner });
      waitingMatrix.delete(ctx.from!.id);
      await ctx.reply("Matrix cell saved.");
      return;
    }
    waitingMatrix.set(ctx.from!.id, "edit");
    await ctx.reply(
      "Send one line:\n`25|1|330000|260000`\nor unlimited: `u|1|1500000|1200000`\nCancel: /cancel or any other /command",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("setinbounds", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const raw = (ctx.match ?? "").trim();
    if (!raw) {
      await ctx.reply("Usage: /setinbounds 1-10\nor /setinbounds 1,2,3,5");
      return;
    }
    const ids = parseInboundIds(raw);
    if (!ids.length) {
      await ctx.reply("No valid ids.");
      return;
    }
    await setSetting("xui_inbound_ids", ids.join(","));
    await ctx.reply(`Inbound IDs saved: ${ids.join(", ")}`);
  });

  bot.command("inbounds", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const ids = await getConfiguredInboundIds();
    await ctx.reply(`Active inbound IDs:\n${ids.join(", ") || "(empty)"}`);
  });

  bot.command("cancel", async (ctx) => {
    const tid = ctx.from!.id;
    waitingName.delete(tid);
    waitingPartner.delete(tid);
    waitingMatrix.delete(tid);
    waitingWalletAmount.delete(tid);
    await ctx.reply("Cancelled.");
  });

  bot.command("setcard", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const raw = ctx.match?.trim();
    if (!raw?.includes("|")) return ctx.reply("Usage: /setcard NUMBER|NAME");
    const [number, holder] = raw.split("|").map((s) => s.trim());
    await setSetting("card_number", number);
    await setSetting("card_holder", holder);
    await ctx.reply("Card saved.");
  });

  bot.command("setchannel", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const value = (ctx.match ?? "").trim().replace(/^@/, "");
    await setSetting("channel_username", value);
    await ctx.reply(value ? `Channel: @${value}` : "Channel cleared");
  });

  bot.command("requirechannel", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const v = (ctx.match ?? "").trim().toLowerCase();
    if (v !== "on" && v !== "off") return ctx.reply("Usage: /requirechannel on|off");
    await setSetting("channel_required", v === "on" ? "true" : "false");
    await ctx.reply(`Required: ${v}`);
  });

  bot.command("setsupport", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const raw = (ctx.match ?? "").trim();
    if (!raw) return ctx.reply("Usage: /setsupport @username OR numeric_id");
    if (raw.startsWith("@") || /[a-zA-Z]/.test(raw)) {
      await setSetting("support_username", raw.replace(/^@/, ""));
      await setSetting("support_telegram_id", "");
    } else {
      await setSetting("support_telegram_id", raw);
      await setSetting("support_username", "");
    }
    await ctx.reply("Support saved.");
  });

  bot.command("miniapp", async (ctx) => {
    const url = await getSetting("miniapp_url");
    if (!url) {
      await ctx.reply("Mini App URL not set. Admin: /setminiapp https://app.anthropics.ir");
      return;
    }
    await ctx.reply("Open Mini App:", {
      reply_markup: new InlineKeyboard().webApp("🚀 Open Piing", url),
    });
  });

  bot.command("setminiapp", async (ctx) => {
    if (!isAdminTelegramId(ctx.from?.id)) return;
    const url = (ctx.match ?? "").trim();
    if (!url.startsWith("http")) return ctx.reply("Usage: /setminiapp https://app.anthropics.ir");
    await setSetting("miniapp_url", url);
    await ctx.reply("Mini App URL saved.");
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error("Grammy", e.description);
    else if (e instanceof HttpError) console.error("HTTP", e);
    else console.error(e);
  });

  return bot;
}
