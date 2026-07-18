import { GrammyError, HttpError, InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import { OrderStatus } from "@prisma/client";
import { OrderKind } from "@prisma/client";
import { randomBytes } from "node:crypto";
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
import {
  provisionOrder,
  rotateSubId,
  rotateUuid,
  type ProvisionResult,
  type ProvisionResultWithBulk,
} from "../services/provision.js";
import { getLiveSubscriptionStatus, liveStatusText } from "../services/live-status.js";
import { claimTestService } from "../services/test-service.js";
import { getChannels, getPaymentCard, getSetting, setSetting } from "../services/settings.js";
import { getConfiguredInboundIds, parseInboundIds } from "../services/inbounds.js";
import { getWallet } from "../services/wallet.js";
import {
  approvePartner,
  listNotifyAdminTelegramIds,
  rejectPartner,
  submitPartnerRequest,
  upsertUserFromTelegram,
} from "../services/users.js";
import { clampMonths } from "../services/pricing.js";
import { formatToman, formatTraffic, formatExpiryLabel } from "../utils/format.js";
import {
  ccWait,
  handleControlCenterText,
  isControlAdmin,
  registerControlCenter,
  showControlCenter,
} from "./admin-center.js";
import {
  adjustDraftMonths,
  adjustDraftQty,
  adjustDraftLimitIp,
  adjustDraftVolume,
  draftPrice,
  getOrCreateDraft,
  setDraftCategory,
  setDraftNameMode,
} from "./draft.js";
import {
  adminOrderKeyboard,
  BTN,
  buyDraftText,
  buyWizardKeyboard,
  guideKeyboard,
  mainMenuInline,
  orderPayText,
  partnerRequestKeyboard,
  payConfirmKeyboard,
  payMethodKeyboard,
  renewPickKeyboard,
  renewWizardKeyboard,
  subscriptionKeyboard,
  walletChargeAmountsKeyboard,
  walletMenuKeyboard,
} from "./keyboards.js";
import { createTelegramBot } from "./telegram.js";

const waitingName = new Set<number>();
const waitingPartner = new Map<number, { step: "name" | "phone" | "note"; fullName?: string; phone?: string }>();
const waitingMatrix = new Map<number, string>();
const waitingWalletAmount = new Set<number>();
/** Renew wizard: telegramId → { subId, months } */
const renewState = new Map<number, { subId: string; months: number }>();

async function requireChannel(ctx: Context) {
  const channels = await getChannels();
  const required = channels.filter((c) => c.required);
  if (!required.length) return true;

  const missing: string[] = [];
  for (const ch of required) {
    const username = ch.username.replace(/^@/, "");
    try {
      const member = await ctx.api.getChatMember(`@${username}`, ctx.from!.id);
      if (!["creator", "administrator", "member", "restricted"].includes(member.status)) {
        missing.push(username);
      }
    } catch {
      missing.push(username);
    }
  }
  if (!missing.length) return true;

  const kb = new InlineKeyboard();
  for (const username of missing) {
    kb.url(`📢 عضویت @${username}`, `https://t.me/${username}`).row();
  }
  kb.text("✅ بررسی عضویت", "check:channel");
  await ctx.reply(`برای استفاده از ربات ابتدا در کانال(ها) عضو شوید:\n\n${missing.map((u) => `@${u}`).join("\n")}`, {
    reply_markup: kb,
  });
  return false;
}

async function replyMainMenu(ctx: Context, preface?: string) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const miniapp = await getSetting("miniapp_url");
  const brand = await getSetting("brand_name");
  const isAdmin = await isControlAdmin(ctx.from!.id);
  await ctx.reply(preface?.trim() || brand || "Piing", {
    reply_markup: mainMenuInline({
      isAdmin,
      isPartner: user.role === "partner",
      isWholesale: user.role === "wholesale",
      miniappUrl: miniapp || undefined,
    }),
  });
}

async function showRenewWizard(ctx: Context, subId: string, months: number, edit = false) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const sub = await prisma.subscription.findFirst({ where: { id: subId, userId: user.id } });
  if (!sub) {
    await ctx.reply("سرویس پیدا نشد.");
    return;
  }
  const m = clampMonths(months);
  renewState.set(ctx.from!.id, { subId, months: m });
  const category = sub.trafficGb === null ? "unlimited" : "data";
  const priced = await draftPrice(user, {
    trafficGb: sub.trafficGb,
    months: m,
    unlimited: sub.trafficGb === null,
    category,
  });
  const text = [
    "♻️ تمدید سرویس",
    "",
    `سرویس: ${sub.code}`,
    `اکانت: ${sub.email}`,
    `حجم فعلی: ${sub.isTest ? "۲۵۰ مگابایت" : formatTraffic(sub.trafficGb)}`,
    "",
    "مدت تمدید را انتخاب کنید (همان سرویس در پنل تمدید می‌شود).",
    priced ? `قیمت: ${formatToman(priced.price)}` : "این مدت قیمت‌گذاری نشده.",
  ].join("\n");
  const kb = renewWizardKeyboard({ subId, months: m, price: priced?.price ?? null });
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

async function showBuyWizard(ctx: Context, edit = false) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const draft = await getOrCreateDraft(BigInt(ctx.from!.id));
  const priced = await draftPrice(user, draft);
  const text = buyDraftText({
    trafficGb: draft.unlimited ? null : draft.trafficGb,
    months: draft.months,
    price: priced?.price ?? null,
    quantity: draft.quantity,
    limitIp: draft.limitIp,
    accountMode: draft.accountMode,
    accountName: draft.accountName,
    category: draft.category,
  });
  const kb = buyWizardKeyboard({
    trafficGb: draft.trafficGb,
    months: draft.months,
    unlimited: draft.unlimited,
    quantity: draft.quantity,
    limitIp: draft.limitIp,
    price: priced?.price ?? null,
    category: draft.category,
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
  result: ProvisionResultWithBulk | ProvisionResult,
  trafficGb: number | null,
  mode: "new" | "renew" = "new",
) {
  const all = "bulk" in result && result.bulk?.length ? [result, ...result.bulk] : [result];
  if (all.length > 1) {
    await api.sendMessage(
      Number(telegramId),
      `🎉 ${all.length} اشتراک آماده شد (خرید عمده)\nحجم هر کدام: ${formatTraffic(trafficGb)}`,
    );
  }
  for (const one of all) {
    const text = [
      mode === "renew" ? "✅ سرویس تمدید شد" : all.length > 1 ? "📦 یکی از اکانت‌های عمده" : "🎉 اشتراک شما آماده شد",
      "",
      `کد: \`${one.code}\``,
      `اکانت: \`${one.email}\``,
      `حجم: ${formatTraffic(trafficGb)}`,
      mode === "renew"
        ? `انقضا: ${one.expiresAt.toLocaleDateString("fa-IR")}`
        : "⏱ اعتبار: از اولین اتصال شروع می‌شود",
      "",
      "🔗 لینک اشتراک:",
      `\`${one.subUrl}\``,
    ].join("\n");
    await api.sendMessage(Number(telegramId), text, { parse_mode: "Markdown" });
    await api.sendPhoto(Number(telegramId), new InputFile(one.qrPng, "qr.png"), {
      caption: `QR — ${one.email}`,
    });
  }
}

async function notifyAllAdmins(api: Context["api"], send: (adminId: number) => Promise<void>) {
  for (const id of await listNotifyAdminTelegramIds()) {
    try {
      await send(id);
    } catch (err) {
      console.error("notify admin", id, err);
    }
  }
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

async function handleMyServices(ctx: Context) {
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
  await ctx.reply("در حال دریافت وضعیت زنده از پنل…");
  for (const sub of subs) {
    const live = await getLiveSubscriptionStatus(sub.id);
    const text = live
      ? liveStatusText(live)
      : [
          `🆔 ${sub.code}`,
          `اکانت: ${sub.email}`,
          `حجم: ${sub.isTest ? "۲۵۰ مگابایت" : formatTraffic(sub.trafficGb)}`,
          `انقضا: ${formatExpiryLabel({
            expiresAt: sub.expiresAt,
            startsOnConnect: sub.startsOnConnect,
            activatedAt: sub.activatedAt,
            createdAt: sub.createdAt,
          })}`,
        ].join("\n");
    await ctx.reply(text, { reply_markup: subscriptionKeyboard(sub.id) });
  }
}

async function handleRenew(ctx: Context) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const subs = await prisma.subscription.findMany({
    where: { userId: user.id, status: "active", isTest: false },
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
}

async function handleTest(ctx: Context) {
  const user = await upsertUserFromTelegram(ctx.from!);
  try {
    const result = await claimTestService(user.id);
    await ctx.reply(
      [
        "🧪 سرویس تست آماده شد",
        "",
        `کد: ${result.code}`,
        `اکانت: ${result.email}`,
        `مشخصات: ${result.expiresHint}`,
        "",
        "🔗 لینک اشتراک:",
        result.subUrl,
      ].join("\n"),
    );
    await ctx.replyWithPhoto(new InputFile(result.qrPng, "qr.png"), {
      caption: "QR سرویس تست — اسکن کنید",
    });
  } catch (err) {
    await ctx.reply(String(err).replace(/^Error:\s*/, ""));
  }
}

async function handleGuide(ctx: Context) {
  const guide = await getSetting("guide_text");
  const urls = {
    ios: (await getSetting("guide_ios_url")) || undefined,
    android: (await getSetting("guide_android_url")) || undefined,
    windows: (await getSetting("guide_windows_url")) || undefined,
    macos: (await getSetting("guide_macos_url")) || undefined,
    extra: (await getSetting("guide_url")) || undefined,
  };
  await ctx.reply(guide || "آموزش اتصال", {
    reply_markup: guideKeyboard(urls),
  });
}

async function handleAccount(ctx: Context) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const roleLabel =
    user.role === "admin"
      ? "ادمین"
      : user.role === "partner"
        ? "نماینده فروش"
        : user.role === "wholesale"
          ? "عمده‌فروش"
          : "کاربر عادی";
  const wallet = await getWallet(user.id);
  await ctx.reply(
    [
      "👤 حساب کاربری",
      `نقش: ${roleLabel}`,
      `آی‌دی: \`${user.telegramId}\``,
      user.panelGroup ? `گروه پنل: ${user.panelGroup}` : "",
      user.testClaimedAt ? "🧪 تست: دریافت‌شده" : "🧪 تست: هنوز نگرفته",
      `موجودی: ${formatToman(wallet.balance)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    { parse_mode: "Markdown" },
  );
}

async function handleDashboard(ctx: Context) {
  const url = await getSetting("miniapp_url");
  if (!url) {
    await ctx.reply("داشبورد هنوز تنظیم نشده است.");
    return;
  }
  await ctx.reply("ورود به داشبورد:", {
    reply_markup: new InlineKeyboard().webApp("🚀 Open", url),
  });
}

async function handleSupport(ctx: Context) {
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
}

async function handlePartnerRequest(ctx: Context) {
  const user = await upsertUserFromTelegram(ctx.from!);
  if (user.role === "partner" || user.role === "wholesale") {
    await ctx.reply(`شما قبلاً ${user.role === "wholesale" ? "عمده‌فروش" : "نماینده"} هستید.\nگروه پنل: ${user.panelGroup ?? "—"}`);
    return;
  }
  waitingPartner.set(ctx.from!.id, { step: "name" });
  await ctx.reply("🤝 درخواست نمایندگی فروش\nنام و نام خانوادگی را بفرستید:");
}

async function handlePartnerPanel(ctx: Context) {
  const user = await upsertUserFromTelegram(ctx.from!);
  if (user.role !== "partner" && user.role !== "wholesale" && user.role !== "admin") return;
  await ctx.reply(
    `💼 پنل نماینده / عمده\nنقش: ${user.role}\nگروه: ${user.panelGroup ?? "—"}\nخریدها با قیمت نقش شما محاسبه می‌شوند.\nسرویس‌های من = فقط اکانت‌هایی که با همین تلگرام خریده‌اید.`,
  );
}

function clearWaits(tid: number) {
  waitingName.delete(tid);
  waitingPartner.delete(tid);
  waitingMatrix.delete(tid);
  waitingWalletAmount.delete(tid);
  renewState.delete(tid);
  ccWait.delete(tid);
}

export function createBot() {
  const bot = createTelegramBot();

  bot.use(async (ctx, next) => {
    if (ctx.from) await upsertUserFromTelegram(ctx.from);
    await next();
  });

  registerControlCenter(bot);

  bot.command("start", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const welcome = await getSetting("welcome_text");
    const user = await upsertUserFromTelegram(ctx.from!);
    const miniapp = await getSetting("miniapp_url");
    const isAdmin = await isControlAdmin(ctx.from!.id);
    const name = ctx.from?.first_name?.trim() || "";
    const text = welcome.replace(/\{name\}/gi, name || "دوست");
    await ctx.reply(text, {
      reply_markup: mainMenuInline({
        isAdmin,
        isPartner: user.role === "partner",
        isWholesale: user.role === "wholesale",
        miniappUrl: miniapp || undefined,
      }),
    });
  });

  bot.callbackQuery("check:channel", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    await replyMainMenu(ctx, "عضویت تأیید شد ✅");
  });

  bot.callbackQuery("menu:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await replyMainMenu(ctx);
  });

  bot.callbackQuery("m:buy", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    await setDraftCategory(BigInt(ctx.from!.id), "data");
    await showBuyWizard(ctx);
  });
  bot.callbackQuery("m:national", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    await setDraftCategory(BigInt(ctx.from!.id), "national");
    await showBuyWizard(ctx);
  });
  bot.callbackQuery("m:renew", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRenew(ctx);
  });
  bot.callbackQuery("m:myservices", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleMyServices(ctx);
  });
  bot.callbackQuery("m:wallet", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await getWallet(user.id);
    await ctx.reply(`💳 موجودی: ${formatToman(wallet.balance)}`, { reply_markup: walletMenuKeyboard() });
  });
  bot.callbackQuery("m:account", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleAccount(ctx);
  });
  bot.callbackQuery("m:guide", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleGuide(ctx);
  });
  bot.callbackQuery("m:support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleSupport(ctx);
  });
  bot.callbackQuery("m:test", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleTest(ctx);
  });
  bot.callbackQuery("m:referral", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "به‌زودی" });
    await ctx.reply("👥 سیستم معرفی به دوستان به‌زودی فعال می‌شود.");
  });
  bot.callbackQuery("m:dashboard", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleDashboard(ctx);
  });
  bot.callbackQuery("m:partner", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePartnerRequest(ctx);
  });
  bot.callbackQuery("m:partnerpanel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePartnerPanel(ctx);
  });

  bot.callbackQuery("wiz:noop", async (ctx) => ctx.answerCallbackQuery());

  bot.hears(BTN.buy, async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    await setDraftCategory(BigInt(ctx.from!.id), "data");
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
  bot.callbackQuery("wiz:qty:+", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftQty(BigInt(ctx.from!.id), 1);
    await showBuyWizard(ctx, true);
  });
  bot.callbackQuery("wiz:qty:-", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftQty(BigInt(ctx.from!.id), -1);
    await showBuyWizard(ctx, true);
  });
  bot.callbackQuery("wiz:ip:+", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftLimitIp(BigInt(ctx.from!.id), 1);
    await showBuyWizard(ctx, true);
  });
  bot.callbackQuery("wiz:ip:-", async (ctx) => {
    await ctx.answerCallbackQuery();
    await adjustDraftLimitIp(BigInt(ctx.from!.id), -1);
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
      quantity: draft.quantity,
      category: draft.category,
      limitIp: draft.limitIp,
    });
    const wallet = await getWallet(user.id);
    await ctx.editMessageText(`${orderSummaryText(order)}\n\nروش پرداخت را انتخاب کنید:`, {
      reply_markup: payMethodKeyboard(order.id, wallet.balance),
    });
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
      const mode = order?.kind === OrderKind.renew ? "renew" : "new";
      await deliverResult(ctx.api, user.telegramId, result as ProvisionResultWithBulk, order?.trafficGb ?? null, mode);
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

    await notifyAllAdmins(ctx.api, async (adminId) => {
      await ctx.api.sendPhoto(adminId, fileId, {
        caption,
        parse_mode: "Markdown",
        reply_markup: adminOrderKeyboard(order.id),
      });
    });
  });

  bot.on("message:text", async (ctx, next) => {
    const tid = ctx.from?.id;
    if (!tid) return next();

    const text = ctx.message.text.trim();

    if (text.startsWith("/")) {
      clearWaits(tid);
      return next();
    }

    if (text === "انصراف" || text.toLowerCase() === "cancel") {
      clearWaits(tid);
      await ctx.reply("لغو شد.");
      return;
    }

    if (await handleControlCenterText(ctx, text)) return;

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
        await notifyAllAdmins(ctx.api, async (adminId) => {
          await ctx.api.sendMessage(
            adminId,
            `🤝 درخواست همکاری\n${partnerFlow.fullName}\n@${user.username ?? "—"}\nTG: ${user.telegramId}`,
            { reply_markup: partnerRequestKeyboard(req.id) },
          );
        });
        return;
      }
    }

    const matrixWait = waitingMatrix.get(tid);
    if (matrixWait && (await isControlAdmin(tid))) {
      const parts = text.split("|").map((s) => s.trim());
      if (parts.length < 4) {
        await ctx.reply(
          "فرمت اشتباه.\n`gb|months|userPrice|partnerPrice|wholesalePrice`\nمثال: `25|1|330000|260000|210000`\nنامحدود: `u|1|1500000|1200000|1000000`\nلغو: انصراف یا هر دستور /",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const trafficGb = parts[0] === "u" ? null : Number(parts[0]);
      const months = Number(parts[1]);
      const priceUser = Number(parts[2]);
      const pricePartner = Number(parts[3]);
      const priceWholesale = parts[4] !== undefined ? Number(parts[4]) : pricePartner;
      if ([months, priceUser, pricePartner, priceWholesale].some((n) => Number.isNaN(n)) || (parts[0] !== "u" && Number.isNaN(Number(parts[0])))) {
        await ctx.reply("اعداد نامعتبر هستند. دوباره بفرستید یا انصراف.");
        return;
      }
      await upsertPriceCell({ trafficGb, months, priceUser, pricePartner, priceWholesale });
      waitingMatrix.delete(tid);
      await ctx.reply("سلول ماتریکس ذخیره شد ✅");
      return;
    }

    return next();
  });

  bot.callbackQuery(/^adm:ok:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
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
      const provisioned = result as ProvisionResultWithBulk;
      const mode = order.kind === OrderKind.renew ? "renew" : "new";
      await deliverResult(ctx.api, order.user.telegramId, provisioned, order.trafficGb, mode);
      const qty = order.quantity ?? 1;
      await ctx
        .editMessageCaption({
          caption:
            order.kind === OrderKind.renew
              ? `✅ تمدید شد — ${provisioned.code}`
              : qty > 1
                ? `✅ Bulk ${qty} اکانت — ${provisioned.code}`
                : `✅ انجام شد — ${provisioned.code}`,
        })
        .catch(() => undefined);
    } catch (err) {
      console.error(err);
      await ctx.reply(`خطا: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^adm:no:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const order = await rejectOrder(ctx.match![1], "رد توسط ادمین");
    await ctx.api.sendMessage(Number(order.user.telegramId), "❌ سفارش شما رد شد.");
    await ctx.editMessageCaption({ caption: "❌ رد شد" }).catch(() => undefined);
  });

  bot.callbackQuery(/^prt:ok:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    const req = await approvePartner(ctx.match![1], "partner");
    await ctx.api.sendMessage(Number(req.user.telegramId), "✅ درخواست همکاری شما تأیید شد (همکار).");
    await ctx.editMessageText(`همکار تأیید شد — گروه پنل: ${req.user.panelGroup ?? "partner_…"}`);
  });

  bot.callbackQuery(/^prt:wh:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    const req = await approvePartner(ctx.match![1], "wholesale");
    await ctx.api.sendMessage(Number(req.user.telegramId), "✅ به‌عنوان عمده‌فروش تأیید شدید.");
    await ctx.editMessageText(`عمده‌فروش تأیید شد — گروه پنل: ${req.user.panelGroup ?? "wholesale_…"}`);
  });

  bot.callbackQuery(/^prt:no:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    const req = await rejectPartner(ctx.match![1]);
    await ctx.api.sendMessage(Number(req.user.telegramId), "❌ درخواست همکاری رد شد.");
    await ctx.editMessageText("درخواست رد شد.");
  });

  bot.hears(BTN.myServices, async (ctx) => handleMyServices(ctx));
  bot.hears(BTN.renew, async (ctx) => handleRenew(ctx));
  bot.hears(BTN.test, async (ctx) => handleTest(ctx));
  bot.hears(BTN.national, async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    await setDraftCategory(BigInt(ctx.from!.id), "national");
    await showBuyWizard(ctx);
  });
  bot.hears(BTN.account, async (ctx) => handleAccount(ctx));
  bot.hears(BTN.guide, async (ctx) => handleGuide(ctx));
  bot.hears(BTN.dashboard, async (ctx) => handleDashboard(ctx));
  bot.hears(BTN.support, async (ctx) => handleSupport(ctx));
  bot.hears(BTN.partner, async (ctx) => handlePartnerRequest(ctx));
  bot.hears(BTN.partnerPanel, async (ctx) => handlePartnerPanel(ctx));

  bot.hears(BTN.admin, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await showControlCenter(ctx, false);
  });

  bot.callbackQuery(/^sub:link:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const sub = await prisma.subscription.findUnique({ where: { id: ctx.match![1] } });
    if (!sub?.subUrl) return ctx.reply("لینک موجود نیست.");
    await ctx.reply(`🔗 \`${sub.subUrl}\``, { parse_mode: "Markdown" });
  });

  bot.callbackQuery(/^sub:qr:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const sub = await prisma.subscription.findUnique({ where: { id: ctx.match![1] } });
    if (!sub?.subUrl) return ctx.reply("لینک موجود نیست.");
    const { default: QRCode } = await import("qrcode");
    const png = await QRCode.toBuffer(sub.subUrl, { type: "png", width: 512, margin: 2 });
    await ctx.replyWithPhoto(new InputFile(png, "qr.png"));
  });

  bot.callbackQuery(/^sub:rotsub:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال تغییر..." });
    try {
      const result = await rotateSubId(ctx.match![1]);
      await deliverResult(ctx.api, ctx.from!.id, result, null);
    } catch (err) {
      await ctx.reply(`خطا: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^sub:rotuuid:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال تغییر..." });
    try {
      const result = await rotateUuid(ctx.match![1]);
      await deliverResult(ctx.api, ctx.from!.id, result, null);
    } catch (err) {
      await ctx.reply(`خطا: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^sub:renew:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    const sub = await prisma.subscription.findFirst({
      where: { id: ctx.match![1], userId: user.id },
    });
    if (!sub) return ctx.reply("سرویس پیدا نشد.");
    if (sub.isTest) return ctx.reply("سرویس تست قابل تمدید نیست. لطفاً سرویس اصلی بخرید.");
    await showRenewWizard(ctx, sub.id, 1);
  });

  bot.callbackQuery(/^renew:mon:([^:]+):([+-])$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match![1];
    const dir = ctx.match![2] === "+" ? 1 : -1;
    const cur = renewState.get(ctx.from!.id);
    const months = clampMonths((cur?.subId === subId ? cur.months : 1) + dir);
    await showRenewWizard(ctx, subId, months, true);
  });

  bot.callbackQuery(/^renew:checkout:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const subId = ctx.match![1];
    const sub = await prisma.subscription.findFirst({ where: { id: subId, userId: user.id } });
    if (!sub || sub.isTest) {
      await ctx.reply("سرویس برای تمدید معتبر نیست.");
      return;
    }
    const months = renewState.get(ctx.from!.id)?.subId === subId ? renewState.get(ctx.from!.id)!.months : 1;
    const category = sub.trafficGb === null ? "unlimited" : "data";
    try {
      const order = await createMatrixOrder({
        userId: user.id,
        trafficGb: sub.trafficGb,
        months,
        accountName: sub.email,
        kind: OrderKind.renew,
        targetSubId: sub.id,
        quantity: 1,
        category,
      });
      const wallet = await getWallet(user.id);
      await ctx.editMessageText(`${orderSummaryText(order)}\n\nروش پرداخت را انتخاب کنید:`, {
        reply_markup: payMethodKeyboard(order.id, wallet.balance),
      });
    } catch (err) {
      await ctx.reply(`خطا: ${String(err).replace(/^Error:\s*/, "")}`);
    }
  });

  bot.hears(BTN.wallet, async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await getWallet(user.id);
    await ctx.reply(`💳 موجودی: ${formatToman(wallet.balance)}`, { reply_markup: walletMenuKeyboard() });
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
      await ctx.reply("مبلغ دلخواه را به تومان بفرستید:");
      return;
    }
    const amount = Number(raw);
    const user = await upsertUserFromTelegram(ctx.from!);
    const order = await createWalletChargeOrder(user.id, amount);
    await startCardPayment(ctx, order.id, orderSummaryText(order));
  });

  bot.command("pending", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
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
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const cells = await listPriceMatrix();
    const lines = cells.slice(0, 40).map(
      (c) =>
        `${c.category} ${c.trafficGb ?? "∞"}GB / ${c.months}m → U ${formatToman(c.priceUser)} | P ${formatToman(c.pricePartner)} | W ${formatToman(c.priceWholesale)}${c.isGolden ? " ⭐" : ""}`,
    );
    await ctx.reply(lines.join("\n") || "خالی");
  });

  bot.command("setmatrix", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const raw = (ctx.match ?? "").trim();
    if (raw) {
      const parts = raw.split("|").map((s) => s.trim());
      if (parts.length < 4) {
        await ctx.reply("Usage: /setmatrix 25|1|330000|260000|210000");
        return;
      }
      const trafficGb = parts[0] === "u" ? null : Number(parts[0]);
      const months = Number(parts[1]);
      const priceUser = Number(parts[2]);
      const pricePartner = Number(parts[3]);
      const priceWholesale = parts[4] !== undefined ? Number(parts[4]) : pricePartner;
      await upsertPriceCell({ trafficGb, months, priceUser, pricePartner, priceWholesale });
      waitingMatrix.delete(ctx.from!.id);
      await ctx.reply("Matrix cell saved.");
      return;
    }
    waitingMatrix.set(ctx.from!.id, "edit");
    await ctx.reply(
      "Send one line:\n`25|1|330000|260000|210000`\nor unlimited: `u|1|1500000|1200000|1000000`\nCancel: /cancel",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("setinbounds", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
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
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const ids = await getConfiguredInboundIds();
    await ctx.reply(`Active inbound IDs:\n${ids.join(", ") || "(empty)"}`);
  });

  bot.command("cancel", async (ctx) => {
    clearWaits(ctx.from!.id);
    await ctx.reply("Cancelled.");
  });

  bot.command("setcard", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const raw = ctx.match?.trim();
    if (!raw?.includes("|")) return ctx.reply("Usage: /setcard NUMBER|NAME");
    const [number, holder] = raw.split("|").map((s) => s.trim());
    await setSetting("card_number", number!);
    await setSetting("card_holder", holder!);
    await ctx.reply("Card saved.");
  });

  bot.command("setchannel", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const value = (ctx.match ?? "").trim().replace(/^@/, "");
    await setSetting("channel_username", value);
    await ctx.reply(value ? `Channel: @${value}` : "Channel cleared");
  });

  bot.command("requirechannel", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const v = (ctx.match ?? "").trim().toLowerCase();
    if (v !== "on" && v !== "off") return ctx.reply("Usage: /requirechannel on|off");
    await setSetting("channel_required", v === "on" ? "true" : "false");
    await ctx.reply(`Required: ${v}`);
  });

  bot.command("setsupport", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
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

  bot.command("control", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await showControlCenter(ctx, false);
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
    if (!(await isControlAdmin(ctx.from?.id))) return;
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
