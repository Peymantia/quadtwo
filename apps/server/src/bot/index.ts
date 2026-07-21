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
  refreshSubscriptionSubUrl,
  rotateSubId,
  rotateUuid,
  type ProvisionResult,
  type ProvisionResultWithBulk,
} from "../services/provision.js";
import { claimTestService } from "../services/test-service.js";
import { getChannels, getPaymentCard, getMaxPurchaseMonths, getSalesCategories, getCategoryLabels, getSetting, listEnabledSalesCategories, resolvePurchaseLimitIp, setSetting } from "../services/settings.js";
import { getConfiguredInboundIds, parseInboundIds } from "../services/inbounds.js";
import { getWallet } from "../services/wallet.js";
import {
  approvePartner,
  listNotifyAdminTelegramIds,
  rejectPartner,
  setAgentName,
  approveAgentRename,
  rejectAgentRename,
  submitPartnerRequest,
  upsertUserFromTelegram,
} from "../services/users.js";
import { assertAgentReadyForPurchase, sanitizePanelGroupSlug } from "../services/panel-groups.js";
import { clampMonths, nextNationalVolume, nextVolume } from "../services/pricing.js";
import { lookupConfigByLinkOrUuid } from "../services/config-lookup.js";
import {
  checkRenewEligibility,
  inferRenewCategory,
  listRenewableSubscriptions,
} from "../services/renew-eligibility.js";
import { formatToman, formatTraffic } from "../utils/format.js";
import { friendlyBotError } from "../panel/xui-errors.js";
import { auditLog } from "../services/audit.js";
import {
  limitBuy,
  limitPartnerRequest,
  limitReceipt,
  limitTestClaim,
} from "../services/rate-limit.js";
import {
  ccWait,
  handleBroadcastMedia,
  handleControlCenterText,
  handleExcelImportDocument,
  isControlAdmin,
  registerControlCenter,
  showControlCenter,
} from "./admin-center.js";
import { registerAdminConfigs, showConfigGroups } from "./admin-configs.js";
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
  clearMyServicesWaits,
  handleMyServicesSearch,
  handleServiceNoteText,
  registerMyServicesHandlers,
  showMyServicesList,
} from "./my-services.js";
import {
  adminOrderKeyboard,
  BTN,
  buyCategoryKeyboard,
  buyDraftText,
  buyWizardKeyboard,
  guideKeyboard,
  mainMenuReply,
  orderPayText,
  partnerContactKeyboard,
  partnerRequestKeyboard,
  payConfirmKeyboard,
  payMethodKeyboard,
  removeReplyKeyboard,
  renewPickKeyboard,
  renewWizardKeyboard,
  showMenuInlineKeyboard,
  walletChargeAmountsKeyboard,
  walletMenuKeyboard,
} from "./keyboards.js";
import { createTelegramBot } from "./telegram.js";
import { syncTelegramMenu, syncTelegramMenuSafe } from "./menu.js";

const waitingName = new Set<number>();
const waitingPartner = new Map<number, { step: "compose" | "name" | "phone" | "note"; fullName?: string; phone?: string }>();
const waitingMatrix = new Map<number, string>();
const waitingWalletAmount = new Set<number>();
const waitingAgentName = new Set<number>();
/** Renew wizard: telegramId → { subId, months } */
const renewState = new Map<
  number,
  { subId: string; months: number; trafficGb: number | null; unlimited: boolean; category: string }
>();
const waitingConfigLookup = new Set<number>();
/** Prevent double-tap checkout / wallet pay creating duplicate accounts */
const checkoutLocks = new Set<number>();
const walletPayLocks = new Set<string>();

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
  const isAdmin = await isControlAdmin(ctx.from!.id);
  await ctx.reply(preface?.trim() || "منوی اصلی", {
    reply_markup: mainMenuReply({
      isAdmin,
      isPartner: user.role === "partner",
      isWholesale: user.role === "wholesale",
      miniappUrl: miniapp || undefined,
    }),
  });
}

/** Temporarily hide sticky reply keyboard for a fuller chat surface. */
async function hideMainKeyboard(ctx: Context) {
  await ctx.reply("⬇️ کیبورد مخفی شد — صفحهٔ چت بازتر است.", {
    reply_markup: removeReplyKeyboard(),
  });
  await ctx.reply("هر وقت خواستید منو برگردد:", {
    reply_markup: showMenuInlineKeyboard(),
  });
}

async function showBuyCategoryPicker(ctx: Context, edit = false) {
  const enabled = await listEnabledSalesCategories();
  const cats = await getSalesCategories();
  const labels = await getCategoryLabels();

  /** Always list national (even when sales-off) so users see the emergency notice. */
  const keys = [...enabled];
  if (!keys.includes("national")) keys.push("national");

  if (!keys.length) {
    await ctx.reply("فعلاً هیچ دسته‌ای برای فروش فعال نیست. با پشتیبانی تماس بگیرید.");
    return;
  }
  if (keys.length === 1 && cats[keys[0]!] === true) {
    await setDraftCategory(BigInt(ctx.from!.id), keys[0]!);
    await showBuyWizard(ctx, edit);
    return;
  }
  const text = "🛒 خرید سرویس\n\nنوع سرویس را انتخاب کنید:";
  const kb = buyCategoryKeyboard(
    keys.map((key) => ({
      key,
      label: labels[key] || key,
    })),
  );
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

const NATIONAL_EMERGENCY_MSG = "این سرویس در شرایط اضطراری فعال می‌شود.";

async function startBuyFlow(ctx: Context) {
  if (!(await requireChannel(ctx))) return;
  await showBuyCategoryPicker(ctx);
}

async function showRenewWizard(
  ctx: Context,
  subId: string,
  opts: { months?: number; trafficGb?: number | null; unlimited?: boolean } = {},
  edit = false,
) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const sub = await prisma.subscription.findFirst({ where: { id: subId, userId: user.id } });
  if (!sub) {
    await ctx.reply("سرویس پیدا نشد.");
    return;
  }

  const eligibility = await checkRenewEligibility(sub.id);
  if (!eligibility.ok) {
    await ctx.reply(eligibility.message);
    return;
  }

  const category = await inferRenewCategory(sub);
  const maxMonths = await getMaxPurchaseMonths();
  const prev = renewState.get(ctx.from!.id);
  const same = prev?.subId === subId ? prev : null;

  let unlimited =
    opts.unlimited ??
    same?.unlimited ??
    (category === "unlimited" || sub.trafficGb === null);
  let trafficGb =
    opts.trafficGb !== undefined
      ? opts.trafficGb
      : (same?.trafficGb ?? (unlimited ? null : sub.trafficGb ?? 10));
  if (category === "unlimited") {
    unlimited = true;
    trafficGb = null;
  } else if (category === "national" && (trafficGb === null || trafficGb < 1)) {
    unlimited = false;
    trafficGb = Math.max(1, sub.trafficGb ?? 1);
  }

  const months = Math.min(maxMonths, clampMonths(opts.months ?? same?.months ?? 1));
  renewState.set(ctx.from!.id, { subId, months, trafficGb, unlimited, category });

  const priced = await draftPrice(user, {
    trafficGb,
    months,
    unlimited,
    category,
  });

  const text = [
    "♻️ تمدید سرویس",
    "",
    `سرویس: ${sub.code}`,
    `اکانت: ${sub.email}`,
    `حجم فعلی: ${sub.isTest ? "۲۵۰ مگابایت" : formatTraffic(sub.trafficGb)}`,
    eligibility.reason ? `وضعیت: ${eligibility.message}` : "",
    "",
    "حجم و مدت تمدید را با +/− انتخاب کنید.",
    maxMonths <= 1 ? "مدت: ۱ ماهه (فعلاً فقط یک‌ماهه)." : "",
    "",
    `حجم تمدید: ${unlimited ? "نامحدود" : formatTraffic(trafficGb)}`,
    `مدت: ${months} ماه`,
    priced ? `قیمت: ${formatToman(priced.price)}` : "این ترکیب قیمت‌گذاری نشده.",
  ]
    .filter(Boolean)
    .join("\n");

  const kb = renewWizardKeyboard({
    subId,
    months,
    trafficGb,
    unlimited,
    price: priced?.price ?? null,
    maxMonths,
    category,
  });
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

async function showBuyWizard(ctx: Context, edit = false) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const draft = await getOrCreateDraft(BigInt(ctx.from!.id));
  const limitIp = await resolvePurchaseLimitIp(draft);
  const priced = await draftPrice(user, draft);
  const text = buyDraftText({
    trafficGb: draft.unlimited ? null : draft.trafficGb,
    months: draft.months,
    price: priced?.price ?? null,
    quantity: draft.quantity,
    limitIp,
    accountMode: draft.accountMode,
    accountName: draft.accountName,
    category: draft.category,
  });
  const maxMonths = await getMaxPurchaseMonths();
  const kb = buyWizardKeyboard({
    trafficGb: draft.trafficGb,
    months: draft.months,
    unlimited: draft.unlimited,
    quantity: draft.quantity,
    limitIp,
    price: priced?.price ?? null,
    category: draft.category,
    maxMonths,
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
      `کد: <code>${one.code}</code>`,
      `اکانت: <code>${one.email}</code>`,
      `حجم: ${formatTraffic(trafficGb)}`,
      mode === "renew"
        ? `انقضا: ${one.expiresAt.toLocaleDateString("fa-IR")}`
        : "⏱ اعتبار: از اولین اتصال شروع می‌شود",
      "",
      "🔗 لینک اشتراک:",
      `<code>${one.subUrl}</code>`,
    ].join("\n");
    await api.sendMessage(Number(telegramId), text, { parse_mode: "HTML" });
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
  await showMyServicesList(ctx);
}

async function handleRenew(ctx: Context) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const subs = await listRenewableSubscriptions(user.id);
  if (!subs.length) {
    await ctx.reply(
      [
        "سرویسی آمادهٔ تمدید نیست.",
        "",
        "تمدید فقط وقتی فعال می‌شود که سرویس:",
        "• در حال اتمام باشد (حجم یا تاریخ)، یا",
        "• تمام شده باشد.",
      ].join("\n"),
    );
    return;
  }
  await ctx.reply("کدام سرویس را تمدید می‌کنید؟", {
    reply_markup: renewPickKeyboard(subs.map((s) => ({ id: s.id, code: s.code, email: s.email }))),
  });
}

async function handleTest(ctx: Context) {
  const rl = limitTestClaim(ctx.from!.id);
  if (!rl.ok) {
    await ctx.reply(`لطفاً ${rl.retryAfterSec} ثانیه صبر کنید و دوباره تلاش کنید.`);
    return;
  }
  const user = await upsertUserFromTelegram(ctx.from!);
  try {
    const result = await claimTestService(user.id);
    await auditLog({
      action: "test_claimed",
      actorTelegramId: ctx.from!.id,
      target: result.code,
    });
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
    await ctx.reply(friendlyBotError(err));
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

async function handleConfigLookup(ctx: Context) {
  if (!(await requireChannel(ctx))) return;
  waitingConfigLookup.add(ctx.from!.id);
  await ctx.reply("🔍 لطفاً لینک کانفیگ یا UUID را ارسال کنید.\n\nلغو: انصراف");
}

async function handleDashboard(ctx: Context) {
  const { dashBaseUrl } = await import("../config/env.js");
  const url = dashBaseUrl();
  await ctx.reply(
    [
      "🌐 *داشبورد وب Piing*",
      "",
      `آدرس: ${url}`,
      "",
      "ورود با رمز عبور یا کد یکبار مصرف از تلگرام.",
      "برای دریافت کد، دکمه «ورود به داشبورد وب اپ» را بزنید.",
    ].join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .url("باز کردن داشبورد", url)
        .row()
        .text("🔐 دریافت کد OTP", "dash:otp"),
    },
  );
}

async function handleDashOtp(ctx: Context) {
  try {
    const { mintOtpPayloadForTelegramUser } = await import("../routes/dash.js");
    const { dashBaseUrl } = await import("../config/env.js");
    const { buildDashboardOtpTelegramMessage } = await import("../services/web-auth.js");
    const user = await upsertUserFromTelegram(ctx.from!);
    const { code, login } = await mintOtpPayloadForTelegramUser(Number(user.telegramId));
    const loginUrl = `${dashBaseUrl().replace(/\/$/, "")}/login`;
    const msg = buildDashboardOtpTelegramMessage(loginUrl, login, String(code));
    await ctx.reply(msg.text, { parse_mode: msg.parse_mode });
  } catch (err) {
    await ctx.reply(friendlyBotError(err));
  }
}

async function handleSupport(ctx: Context) {
  const supportUser = (await getSetting("support_username")).trim().replace(/^@/, "");
  const supportId = (await getSetting("support_telegram_id")).trim();

  let contact: string | null = null;
  if (supportUser) contact = `@${supportUser}`;
  else if (supportId) contact = /^\d+$/.test(supportId) ? supportId : `@${supportId.replace(/^@/, "")}`;

  if (!contact) {
    await ctx.reply("پشتیبانی هنوز تنظیم نشده است.");
    return;
  }

  await ctx.reply(
    [
      "درود بر تو ای عزیز ✨ خوبی شما؟",
      "اگر مشکلی وجود داشت حتما به پشتیبانی پیام بده.",
      "🕵️‍♂️",
      contact,
    ].join("\n"),
  );
}

async function handlePartnerRequest(ctx: Context) {
  const rl = limitPartnerRequest(ctx.from!.id);
  if (!rl.ok) {
    await ctx.reply(`درخواست‌های زیاد. ${rl.retryAfterSec} ثانیه دیگر دوباره تلاش کنید.`);
    return;
  }
  const user = await upsertUserFromTelegram(ctx.from!);
  if (user.role === "admin" || (await isControlAdmin(ctx.from?.id))) {
    await ctx.reply("ادمین نیازی به درخواست نمایندگی ندارد.");
    return;
  }
  if (user.role === "partner" || user.role === "wholesale") {
    await ctx.reply(`شما قبلاً ${user.role === "wholesale" ? "عمده‌فروش" : "نماینده"} هستید.\nگروه پنل: ${user.panelGroup ?? "—"}`);
    return;
  }
  waitingPartner.set(ctx.from!.id, { step: "compose" });
  await ctx.reply(
    [
      "📝 درخواست نمایندگی و همکاری",
      "",
      "* نام و نام خانوادگی:",
      "* شماره موبایل",
      "* لطفاً در قالب یک پیام، توضیح دهید که قصد همکاری به چه شکلی را دارید.",
      "آیا کانال/گروه دارید؟ موبایل فروش هستید ؟ یا برای دوستان و آشنایان خرید می‌کنید؟",
      "میزان فروش حدودی شما چقدر است؟",
      "",
      "👇 پیام خود را بفرستید:",
    ].join("\n"),
  );
}

async function handlePartnerPanel(ctx: Context) {
  const user = await upsertUserFromTelegram(ctx.from!);
  if (user.role !== "partner" && user.role !== "wholesale" && user.role !== "admin") return;
  const ready = assertAgentReadyForPurchase(user);
  await ctx.reply(
    [
      "💼 پنل نماینده / عمده / ادمین",
      `نقش: ${user.role}`,
      `نام نماینده: ${user.agentName ?? "❌ تعریف نشده"}`,
      `گروه پنل: ${user.panelGroup ?? "—"}`,
      "",
      ready.ok
        ? "✅ خریدهای شما داخل گروه اختصاصی‌تان در پنل ثبت می‌شود."
        : "⚠️ قبل از خرید باید نام نماینده را تنظیم کنید.",
      "کاربران عادی → گروه Telegram",
    ].join("\n"),
    {
      reply_markup: new InlineKeyboard()
        .text(user.agentName ? "✏️ تغییر نام (نیاز به تأیید ادمین)" : "➕ تعریف نام نماینده", "agent:set")
        .primary()
        .row()
        .text("« بازگشت", "menu:home"),
    },
  );
}

function clearWaits(tid: number) {
  waitingName.delete(tid);
  waitingPartner.delete(tid);
  waitingMatrix.delete(tid);
  waitingWalletAmount.delete(tid);
  waitingAgentName.delete(tid);
  renewState.delete(tid);
  waitingConfigLookup.delete(tid);
  ccWait.delete(tid);
  clearMyServicesWaits(tid);
}

export function createBot() {
  const bot = createTelegramBot();

  bot.use(async (ctx, next) => {
    if (ctx.from) await upsertUserFromTelegram(ctx.from);
    await next();
  });

  registerControlCenter(bot);
  registerMyServicesHandlers(bot);
  registerAdminConfigs(bot);

  bot.command("start", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const welcome = await getSetting("welcome_text");
    const user = await upsertUserFromTelegram(ctx.from!);
    const miniapp = await getSetting("miniapp_url");
    const isAdmin = await isControlAdmin(ctx.from!.id);
    const displayName = ctx.from?.first_name?.trim() || "دوست";
    const text = [`سلام ${displayName} 🧡`, "", welcome].join("\n");
    await ctx.reply(text, {
      reply_markup: mainMenuReply({
        isAdmin,
        isPartner: user.role === "partner",
        isWholesale: user.role === "wholesale",
        miniappUrl: miniapp || undefined,
      }),
    });
  });

  /** Reload slash-command menu + reply keyboard after bot updates */
  bot.command("update", async (ctx) => {
    if (ctx.from) clearWaits(ctx.from.id);
    if (!(await requireChannel(ctx))) return;
    await syncTelegramMenu(ctx.api).catch(() => undefined);
    await replyMainMenu(
      ctx,
      [
        "🔄 منوی ربات به‌روز شد",
        "",
        "دکمه‌ها و دستورات جدید بارگذاری شدند.",
        "اگر تغییری نمی‌بینید، یک‌بار چت را ببندید و دوباره باز کنید.",
      ].join("\n"),
    );
  });

  bot.command("hide", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    await hideMainKeyboard(ctx);
  });

  bot.command("menu", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    await replyMainMenu(ctx, "📌 منوی اصلی");
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

  bot.callbackQuery("menu:show", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "منو باز شد" });
    await replyMainMenu(ctx, "📌 منوی اصلی برگشت.");
  });

  bot.callbackQuery("buy:cat:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await replyMainMenu(ctx, "به منوی اصلی برگشتید.");
  });

  // Back from buy wizard to category picker (or main menu when only one category)
  bot.callbackQuery("buy:back:cat", async (ctx) => {
    await ctx.answerCallbackQuery();
    const enabled = await listEnabledSalesCategories();
    if (enabled.length <= 1) {
      await ctx.deleteMessage().catch(() => undefined);
      await replyMainMenu(ctx, "به منوی اصلی برگشتید.");
      return;
    }
    await showBuyCategoryPicker(ctx, true);
  });

  bot.callbackQuery(/^buy:cat:(?!cancel$)([a-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const cat = ctx.match![1]!;
    const cats = await getSalesCategories();
    if (!cats[cat]) {
      await ctx.reply(cat === "national" ? NATIONAL_EMERGENCY_MSG : "این دسته فعلاً برای فروش فعال نیست.");
      return;
    }
    await setDraftCategory(BigInt(ctx.from!.id), cat);
    await showBuyWizard(ctx, true);
  });

  bot.command("buy", async (ctx) => {
    await startBuyFlow(ctx);
  });

  bot.command("services", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    await handleMyServices(ctx);
  });

  bot.command("wallet", async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await getWallet(user.id);
    await ctx.reply(`💳 موجودی: ${formatToman(wallet.balance)}`, { reply_markup: walletMenuKeyboard() });
  });

  bot.command("support", async (ctx) => handleSupport(ctx));

  bot.command("app", async (ctx) => {
    const url = await getSetting("miniapp_url");
    if (!url) {
      await ctx.reply("وب‌اپ هنوز تنظیم نشده است.");
      return;
    }
    await ctx.reply("برای باز کردن داشبورد روی دکمه بزنید:", {
      reply_markup: new InlineKeyboard().webApp("🚀 باز کردن وب‌اپ", url),
    });
  });

  bot.callbackQuery("m:buy", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showBuyCategoryPicker(ctx, true);
  });
  bot.callbackQuery("m:national", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    if (!(await getSalesCategories()).national) {
      await ctx.reply(NATIONAL_EMERGENCY_MSG);
      return;
    }
    await setDraftCategory(BigInt(ctx.from!.id), "national");
    await showBuyWizard(ctx, true);
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
  bot.callbackQuery("m:dashotp", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleDashOtp(ctx);
  });
  bot.callbackQuery("dash:otp", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleDashOtp(ctx);
  });
  bot.callbackQuery("m:cfglookup", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleConfigLookup(ctx);
  });
  bot.callbackQuery("m:partner", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePartnerRequest(ctx);
  });
  bot.callbackQuery("m:configs", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await isControlAdmin(ctx.from?.id))) {
      await ctx.reply("فقط ادمین.");
      return;
    }
    await showConfigGroups(ctx);
  });
  bot.callbackQuery("m:partnerpanel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePartnerPanel(ctx);
  });

  bot.callbackQuery("agent:set", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    if (user.role !== "admin" && user.role !== "partner" && user.role !== "wholesale") {
      await ctx.reply("فقط ادمین و نماینده می‌توانند نام نماینده تعریف کنند.");
      return;
    }
    waitingAgentName.add(ctx.from!.id);
    const needsApproval = Boolean(user.agentName?.trim()) && user.role !== "admin";
    await ctx.reply(
      [
        user.agentName ? "نام نماینده جدید را بفرستید:" : "نام نماینده را بفرستید (اجباری):",
        "",
        "• همین نام به‌عنوان گروه پنل 3x-ui استفاده می‌شود",
        "• باید حداقل یک حرف یا عدد انگلیسی داشته باشد",
        "مثال: AliShop",
        needsApproval ? "" : "",
        needsApproval ? "⚠️ تغییر نام بعد از تأیید ادمین اعمال می‌شود و گروه پنل هم تغییر می‌کند." : "",
        "",
        "لغو: /cancel",
      ]
        .filter((l) => l !== undefined)
        .join("\n"),
    );
  });

  bot.callbackQuery("wiz:noop", async (ctx) => ctx.answerCallbackQuery());

  bot.hears(BTN.buy, async (ctx) => {
    await startBuyFlow(ctx);
  });

  bot.hears(BTN.national, async (ctx) => {
    await startBuyFlow(ctx);
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
    const tid = ctx.from!.id;
    if (checkoutLocks.has(tid)) {
      await ctx.answerCallbackQuery({ text: "در حال ثبت سفارش… لطفاً صبر کنید" });
      return;
    }
    checkoutLocks.add(tid);
    try {
      await ctx.answerCallbackQuery({ text: "در حال ثبت…" });
      if (!(await requireChannel(ctx))) return;
      const rl = limitBuy(ctx.from!.id);
      if (!rl.ok) {
        await ctx.reply(`درخواست خرید زیاد است. ${rl.retryAfterSec} ثانیه صبر کنید.`);
        return;
      }
      const user = await upsertUserFromTelegram(ctx.from!);
      const agentOk = assertAgentReadyForPurchase(user);
      if (!agentOk.ok) {
        await ctx.reply(agentOk.message, {
          reply_markup: new InlineKeyboard()
            .text("➕ تعریف نام نماینده", "agent:set")
            .primary()
            .row()
            .text("« بازگشت", "menu:home"),
        });
        return;
      }
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

      // Reuse a very-recent pending order for same draft to avoid duplicates on double-tap
      const recent = await prisma.order.findFirst({
        where: {
          userId: user.id,
          status: OrderStatus.pending_payment,
          kind: OrderKind.new,
          createdAt: { gte: new Date(Date.now() - 15_000) },
          trafficGb: draft.unlimited ? null : draft.trafficGb,
          months: draft.months,
          quantity: draft.quantity,
        },
        orderBy: { createdAt: "desc" },
      });
      const order =
        recent ??
        (await createMatrixOrder({
          userId: user.id,
          trafficGb: draft.unlimited ? null : draft.trafficGb,
          months: draft.months,
          accountName,
          quantity: draft.quantity,
          category: draft.category,
          limitIp: await resolvePurchaseLimitIp(draft),
        }));
      if (!recent) {
        await auditLog({
          action: "order_created",
          actorTelegramId: ctx.from!.id,
          target: order.id,
          detail: `${order.kind} ${formatToman(order.price)}`,
        });
      }
      const wallet = await getWallet(user.id);
      try {
        await ctx.editMessageText(`${orderSummaryText(order)}\n\nروش پرداخت را انتخاب کنید:`, {
          reply_markup: payMethodKeyboard(order.id, wallet.balance),
        });
      } catch {
        await ctx.reply(`${orderSummaryText(order)}\n\nروش پرداخت را انتخاب کنید:`, {
          reply_markup: payMethodKeyboard(order.id, wallet.balance),
        });
      }
    } finally {
      checkoutLocks.delete(tid);
    }
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
    const orderId = ctx.match![1]!;
    const lockKey = `${ctx.from!.id}:${orderId}`;
    if (walletPayLocks.has(lockKey)) {
      await ctx.answerCallbackQuery({ text: "پرداخت در حال انجام است…" });
      return;
    }
    walletPayLocks.add(lockKey);
    try {
      await ctx.answerCallbackQuery({ text: "پرداخت از کیف پول..." });
      const user = await upsertUserFromTelegram(ctx.from!);
      try {
        const result = await payOrderWithWallet(orderId, user.id);
        if ("kind" in result && result.kind === "wallet_credit") {
          await ctx.reply(`شارژ شد. موجودی: ${formatToman(result.balance)}`);
          return;
        }
        const order = await getOrderForAdmin(orderId);
        try {
          await ctx.editMessageText("پرداخت از کیف پول انجام شد ✅");
        } catch {
          /* already edited */
        }
        const mode = order?.kind === OrderKind.renew ? "renew" : "new";
        await deliverResult(ctx.api, user.telegramId, result as ProvisionResultWithBulk, order?.trafficGb ?? null, mode);
      } catch (err) {
        await ctx.reply(friendlyBotError(err));
      }
    } finally {
      walletPayLocks.delete(lockKey);
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
    await replyMainMenu(ctx, "به منوی اصلی برگشتید.");
  });

  // Back from payment-method screen to the previous wizard (cancels the pending order)
  bot.callbackQuery(/^pay:back:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    const order = await prisma.order.findFirst({
      where: { id: ctx.match![1], userId: user.id },
    });
    if (order?.status === OrderStatus.pending_payment) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.cancelled },
      });
    }
    if (order?.kind === OrderKind.wallet_charge) {
      await ctx.editMessageText("مبلغ شارژ را انتخاب کنید (تومان):", {
        reply_markup: walletChargeAmountsKeyboard(),
      });
      return;
    }
    if (order?.kind === OrderKind.renew && order.targetSubId) {
      await showRenewWizard(ctx, order.targetSubId, {}, true);
      return;
    }
    await showBuyWizard(ctx, true);
  });

  // Back from card-payment screen to method selection (order stays pending)
  bot.callbackQuery(/^pay:method:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    const order = await prisma.order.findFirst({
      where: { id: ctx.match![1], userId: user.id, status: OrderStatus.pending_payment },
    });
    if (!order) {
      await ctx.reply("سفارش فعالی پیدا نشد.");
      return;
    }
    if (order.kind === OrderKind.wallet_charge) {
      // Wallet top-up is card-to-card only → back means picking the amount again
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.cancelled },
      });
      await ctx.editMessageText("مبلغ شارژ را انتخاب کنید (تومان):", {
        reply_markup: walletChargeAmountsKeyboard(),
      });
      return;
    }
    const wallet = await getWallet(user.id);
    await ctx.editMessageText(`${orderSummaryText(order)}\n\nروش پرداخت را انتخاب کنید:`, {
      reply_markup: payMethodKeyboard(order.id, wallet.balance),
    });
  });

  // Back from renew wizard to the pick-service list
  bot.callbackQuery("renew:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await handleRenew(ctx);
  });

  // Back from charge-amount picker to wallet menu
  bot.callbackQuery("wallet:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await getWallet(user.id);
    await ctx.editMessageText(`💳 موجودی: ${formatToman(wallet.balance)}`, {
      reply_markup: walletMenuKeyboard(),
    });
  });

  bot.on(
    ["message:photo", "message:document", "message:video", "message:animation", "message:audio", "message:voice", "message:sticker"],
    async (ctx) => {
    if (await handleBroadcastMedia(ctx)) return;
    if (await handleExcelImportDocument(ctx)) return;

    // Receipts: photo or image document only
    if (!ctx.message.photo && !(ctx.message.document?.mime_type?.startsWith("image/"))) return;

    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const pending = await findPendingPaymentOrder(user.id);
    if (!pending) return;

    const rl = limitReceipt(ctx.from!.id);
    if (!rl.ok) {
      await ctx.reply(`ارسال رسید زیاد است. ${rl.retryAfterSec} ثانیه صبر کنید.`);
      return;
    }

    const fileId =
      ctx.message.photo?.at(-1)?.file_id ??
      (ctx.message.document?.mime_type?.startsWith("image/") ? ctx.message.document.file_id : undefined);
    if (!fileId) {
      await ctx.reply("لطفاً عکس رسید را ارسال کنید.");
      return;
    }

    const order = await attachReceipt(pending.id, user.id, fileId, ctx.message.caption);
    await auditLog({
      action: "receipt_uploaded",
      actorTelegramId: ctx.from!.id,
      target: order.id,
    });
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

  bot.on("message:contact", async (ctx) => {
    const tid = ctx.from?.id;
    if (!tid) return;
    const partnerFlow = waitingPartner.get(tid);
    if (!partnerFlow || partnerFlow.step !== "phone") return;

    const contact = ctx.message.contact;
    // Only accept the user's own shared contact
    if (contact.user_id && contact.user_id !== tid) {
      await ctx.reply("لطفاً شماره خودتان را با دکمه تلگرام ارسال کنید.");
      return;
    }

    const phone = contact.phone_number;
    waitingPartner.set(tid, {
      step: "note",
      fullName: partnerFlow.fullName,
      phone,
    });
    await ctx.reply("شماره دریافت شد ✅\nتوضیح کوتاه بفرستید (یا — بزنید):", {
      reply_markup: { remove_keyboard: true },
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
    if (await handleMyServicesSearch(ctx, text)) return;
    if (await handleServiceNoteText(ctx, text)) return;

    if (waitingConfigLookup.has(tid)) {
      if ((Object.values(BTN) as string[]).includes(text)) {
        waitingConfigLookup.delete(tid);
      } else {
        waitingConfigLookup.delete(tid);
        await ctx.reply("⏳ در حال بررسی…");
        try {
          const result = await lookupConfigByLinkOrUuid(text);
          await ctx.reply(result.message);
        } catch (err) {
          await ctx.reply(friendlyBotError(err));
        }
        return;
      }
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

    if (waitingAgentName.has(tid)) {
      try {
        const user = await upsertUserFromTelegram(ctx.from!);
        const result = await setAgentName(user.id, text);
        waitingAgentName.delete(tid);
        if (result.kind === "pending") {
          await ctx.reply(
            [
              "⏳ درخواست تغییر نام ثبت شد",
              `نام جدید: ${result.newName}`,
              `گروه پنل جدید: ${result.newGroup}`,
              "",
              "پس از تأیید ادمین اعمال می‌شود و گروه پنل هم تغییر می‌کند.",
            ].join("\n"),
          );
          const who = user.username ? `@${user.username}` : String(user.telegramId);
          await notifyAllAdmins(ctx.api, async (adminId) => {
            await ctx.api.sendMessage(
              adminId,
              [
                "✏️ درخواست تغییر نام نماینده",
                `کاربر: ${who}`,
                `قبلی: ${user.agentName} / ${user.panelGroup}`,
                `جدید: ${result.newName} / ${result.newGroup}`,
              ].join("\n"),
              {
                reply_markup: new InlineKeyboard()
                  .text("✅ تأیید تغییر نام", `arename:ok:${result.requestId}`)
                  .success()
                  .row()
                  .text("❌ رد", `arename:no:${result.requestId}`)
                  .danger(),
              },
            );
          });
        } else {
          await ctx.reply(
            [
              "✅ نام نماینده ذخیره شد",
              `نام: ${result.user.agentName}`,
              `گروه پنل: ${result.user.panelGroup}`,
              "",
              "از این به بعد خریدهای شما داخل این گروه ساخته می‌شود (نه Telegram).",
            ].join("\n"),
            {
              reply_markup: new InlineKeyboard()
                .text("💼 پنل نماینده", "m:partnerpanel")
                .row()
                .text("🛒 خرید", "m:buy")
                .row()
                .text("« منوی اصلی", "menu:home"),
            },
          );
        }
      } catch (err) {
        await ctx.reply(String(err).replace(/^Error:\s*/, "") + "\nدوباره بفرستید یا /cancel");
      }
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
      if (partnerFlow.step === "compose") {
        if (text.length < 10) {
          await ctx.reply("پیام خیلی کوتاه است. لطفاً نام، موبایل و توضیحات همکاری را در یک پیام بفرستید.");
          return;
        }
        waitingPartner.delete(tid);
        const user = await upsertUserFromTelegram(ctx.from!);
        const phoneMatch = text.match(/(?:\+98|0098|98|0)?9\d{9}/);
        const phone = phoneMatch?.[0];
        const agentLabel =
          sanitizePanelGroupSlug(user.username ?? "") ||
          sanitizePanelGroupSlug(text) ||
          `Partner${String(user.telegramId).slice(-8)}`;
        const req = await submitPartnerRequest(user.id, agentLabel, phone, text);
        await auditLog({
          action: "partner_request",
          actorTelegramId: tid,
          target: req.id,
          detail: agentLabel,
        });
        await ctx.reply("درخواست همکاری ثبت شد. منتظر تأیید ادمین بمانید.");
        await notifyAllAdmins(ctx.api, async (adminId) => {
          await ctx.api.sendMessage(
            adminId,
            [
              "🤝 درخواست نمایندگی و همکاری",
              `@${user.username ?? "—"} · TG: ${user.telegramId}`,
              phone ? `📱 ${phone}` : "",
              "",
              text.slice(0, 3500),
            ]
              .filter(Boolean)
              .join("\n"),
            { reply_markup: partnerRequestKeyboard(req.id) },
          );
        });
        return;
      }
      if (partnerFlow.step === "name") {
        if (!sanitizePanelGroupSlug(text)) {
          await ctx.reply(
            "نام نماینده باید حداقل یک حرف یا عدد انگلیسی داشته باشد.\nمثال: AliShop\nدوباره بفرستید یا انصراف.",
          );
          return;
        }
        waitingPartner.set(tid, { step: "phone", fullName: text });
        await ctx.reply("شماره موبایل را با دکمه زیر ارسال کنید (همان شماره تلگرام شما):", {
          reply_markup: partnerContactKeyboard(),
        });
        return;
      }
      if (partnerFlow.step === "phone") {
        await ctx.reply("لطفاً با دکمه «ارسال شماره موبایل» شماره را بفرستید، نه به‌صورت متن.");
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
        await auditLog({
          action: "partner_request",
          actorTelegramId: tid,
          target: req.id,
          detail: partnerFlow.fullName,
        });
        await ctx.reply("درخواست همکاری ثبت شد. منتظر تأیید ادمین بمانید.", {
          reply_markup: { remove_keyboard: true },
        });
        await notifyAllAdmins(ctx.api, async (adminId) => {
          await ctx.api.sendMessage(
            adminId,
            `🤝 درخواست همکاری\n${partnerFlow.fullName}\n📱 ${partnerFlow.phone ?? "—"}\n@${user.username ?? "—"}\nTG: ${user.telegramId}`,
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
      await auditLog({
        action: "order_approved",
        actorTelegramId: ctx.from?.id,
        target: orderId,
      });
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
      await auditLog({
        action: "provision_ok",
        actorTelegramId: ctx.from?.id,
        target: orderId,
        detail: provisioned.code,
      });
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
      await auditLog({
        action: "provision_fail",
        actorTelegramId: ctx.from?.id,
        target: orderId,
        detail: friendlyBotError(err),
      });
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery(/^adm:no:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const order = await rejectOrder(ctx.match![1], "رد توسط ادمین");
    await auditLog({
      action: "order_rejected",
      actorTelegramId: ctx.from?.id,
      target: order.id,
    });
    await ctx.api.sendMessage(Number(order.user.telegramId), "❌ سفارش شما رد شد.");
    await ctx.editMessageCaption({ caption: "❌ رد شد" }).catch(() => undefined);
  });

  bot.callbackQuery(/^arename:ok:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "در حال اعمال…" });
    try {
      const { user, request } = await approveAgentRename(ctx.match![1]!);
      await auditLog({
        action: "agent_rename_approved",
        actorTelegramId: ctx.from?.id,
        target: user.id,
        detail: `${request.oldGroup}→${request.newGroup}`,
      });
      await ctx.api
        .sendMessage(
          Number(user.telegramId),
          [
            "✅ تغییر نام نماینده تأیید شد",
            `نام: ${user.agentName}`,
            `گروه پنل: ${user.panelGroup}`,
          ].join("\n"),
        )
        .catch(() => undefined);
      await ctx.editMessageText(
        `✅ تغییر نام اعمال شد\n${request.oldName} → ${request.newName}\nگروه: ${request.oldGroup} → ${request.newGroup}`,
      );
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery(/^arename:no:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
      await ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    try {
      const req = await rejectAgentRename(ctx.match![1]!);
      await ctx.api
        .sendMessage(Number(req.user.telegramId), "❌ درخواست تغییر نام نماینده رد شد.")
        .catch(() => undefined);
      await ctx.editMessageText("❌ درخواست تغییر نام رد شد.");
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery(/^prt:ok:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    try {
      const req = await approvePartner(ctx.match![1], "partner");
      await auditLog({
        action: "partner_approved",
        actorTelegramId: ctx.from?.id,
        target: req.id,
        detail: "partner",
      });
      await ctx.api.sendMessage(Number(req.user.telegramId), "✅ درخواست همکاری شما تأیید شد (همکار).");
      await ctx.editMessageText(`همکار تأیید شد — گروه پنل: ${req.user.panelGroup ?? "partner_…"}`);
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery(/^prt:wh:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    try {
      const req = await approvePartner(ctx.match![1], "wholesale");
      await auditLog({
        action: "partner_approved",
        actorTelegramId: ctx.from?.id,
        target: req.id,
        detail: "wholesale",
      });
      await ctx.api.sendMessage(Number(req.user.telegramId), "✅ به‌عنوان عمده‌فروش تأیید شدید.");
      await ctx.editMessageText(`عمده‌فروش تأیید شد — گروه پنل: ${req.user.panelGroup ?? "wholesale_…"}`);
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery(/^prt:no:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return ctx.answerCallbackQuery({ text: "no", show_alert: true });
    await ctx.answerCallbackQuery();
    const req = await rejectPartner(ctx.match![1]);
    await auditLog({
      action: "partner_rejected",
      actorTelegramId: ctx.from?.id,
      target: req.id,
    });
    await ctx.api.sendMessage(Number(req.user.telegramId), "❌ درخواست همکاری رد شد.");
    await ctx.editMessageText("درخواست رد شد.");
  });

  bot.hears(BTN.myServices, async (ctx) => handleMyServices(ctx));
  bot.hears(BTN.renew, async (ctx) => handleRenew(ctx));
  bot.hears(BTN.account, async (ctx) => handleAccount(ctx));
  bot.hears(BTN.wallet, async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    const user = await upsertUserFromTelegram(ctx.from!);
    const wallet = await getWallet(user.id);
    await ctx.reply(`💳 موجودی: ${formatToman(wallet.balance)}`, { reply_markup: walletMenuKeyboard() });
  });
  bot.hears(BTN.test, async (ctx) => handleTest(ctx));
  bot.hears(BTN.guide, async (ctx) => handleGuide(ctx));
  bot.hears(BTN.partner, async (ctx) => handlePartnerRequest(ctx));
  bot.hears(BTN.allConfigs, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
      await ctx.reply("فقط ادمین.");
      return;
    }
    await showConfigGroups(ctx);
  });
  bot.hears(BTN.support, async (ctx) => handleSupport(ctx));
  bot.hears(BTN.dashboard, async (ctx) => handleDashboard(ctx));
  bot.hears(BTN.dashOtp, async (ctx) => handleDashOtp(ctx));
  bot.hears(BTN.hideKeyboard, async (ctx) => {
    if (!(await requireChannel(ctx))) return;
    await hideMainKeyboard(ctx);
  });
  bot.hears(BTN.configLookup, async (ctx) => handleConfigLookup(ctx));
  bot.hears(BTN.agentPanel, async (ctx) => handlePartnerPanel(ctx));
  bot.hears(BTN.controlCenter, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await showControlCenter(ctx, false);
  });
  bot.hears(BTN.partnerPanel, async (ctx) => handlePartnerPanel(ctx));
  bot.hears(BTN.admin, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await showControlCenter(ctx, false);
  });

  bot.callbackQuery(/^sub:link:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subUrl = await refreshSubscriptionSubUrl(ctx.match![1]!);
    if (!subUrl) return ctx.reply("لینک موجود نیست.");
    await ctx.reply(`🔗 لینک اشتراک:\n<code>${subUrl}</code>`, { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^sub:qr:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subUrl = await refreshSubscriptionSubUrl(ctx.match![1]!);
    if (!subUrl) return ctx.reply("لینک موجود نیست.");
    const { default: QRCode } = await import("qrcode");
    const png = await QRCode.toBuffer(subUrl, { type: "png", width: 512, margin: 2 });
    await ctx.replyWithPhoto(new InputFile(png, "qr.png"));
  });

  bot.callbackQuery(/^sub:rotsub:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال تغییر..." });
    try {
      const result = await rotateSubId(ctx.match![1]);
      await deliverResult(ctx.api, ctx.from!.id, result, null);
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery(/^sub:rotuuid:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال تغییر..." });
    try {
      const result = await rotateUuid(ctx.match![1]);
      await deliverResult(ctx.api, ctx.from!.id, result, null);
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
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
    const eligibility = await checkRenewEligibility(sub.id);
    if (!eligibility.ok) return ctx.reply(eligibility.message);
    renewState.delete(ctx.from!.id);
    await showRenewWizard(ctx, sub.id, {});
  });

  bot.callbackQuery(/^renew:vol:([^:]+):([+-])$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match![1]!;
    const dir = ctx.match![2] === "+" ? 1 : -1;
    const cur = renewState.get(ctx.from!.id);
    if (!cur || cur.subId !== subId) {
      await showRenewWizard(ctx, subId, {}, true);
      return;
    }
    if (cur.category === "unlimited") {
      await showRenewWizard(ctx, subId, { months: cur.months, trafficGb: null, unlimited: true }, true);
      return;
    }
    if (cur.category === "national") {
      const gb = nextNationalVolume(cur.trafficGb, dir);
      await showRenewWizard(ctx, subId, { months: cur.months, trafficGb: gb, unlimited: false }, true);
      return;
    }
    const next = nextVolume(cur.trafficGb, cur.unlimited, dir);
    await showRenewWizard(
      ctx,
      subId,
      { months: cur.months, trafficGb: next.trafficGb, unlimited: next.unlimited },
      true,
    );
  });

  bot.callbackQuery(/^renew:mon:([^:]+):([+-])$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match![1]!;
    const dir = ctx.match![2] === "+" ? 1 : -1;
    const cur = renewState.get(ctx.from!.id);
    const maxMonths = await getMaxPurchaseMonths();
    const base = cur?.subId === subId ? cur.months : 1;
    const months = Math.min(maxMonths, clampMonths(base + dir));
    await showRenewWizard(
      ctx,
      subId,
      {
        months,
        trafficGb: cur?.subId === subId ? cur.trafficGb : undefined,
        unlimited: cur?.subId === subId ? cur.unlimited : undefined,
      },
      true,
    );
  });

  bot.callbackQuery(/^renew:checkout:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireChannel(ctx))) return;
    const rl = limitBuy(ctx.from!.id);
    if (!rl.ok) {
      await ctx.reply(`درخواست خرید زیاد است. ${rl.retryAfterSec} ثانیه صبر کنید.`);
      return;
    }
    const user = await upsertUserFromTelegram(ctx.from!);
    const agentOk = assertAgentReadyForPurchase(user);
    if (!agentOk.ok) {
      await ctx.reply(agentOk.message, {
        reply_markup: new InlineKeyboard()
          .text("➕ تعریف نام نماینده", "agent:set")
          .primary()
          .row()
          .text("« بازگشت", "menu:home"),
      });
      return;
    }
    const subId = ctx.match![1]!;
    const sub = await prisma.subscription.findFirst({ where: { id: subId, userId: user.id } });
    if (!sub || sub.isTest) {
      await ctx.reply("سرویس برای تمدید معتبر نیست.");
      return;
    }
    const eligibility = await checkRenewEligibility(sub.id);
    if (!eligibility.ok) {
      await ctx.reply(eligibility.message);
      return;
    }
    const state = renewState.get(ctx.from!.id);
    const unlimited = state?.subId === subId ? state.unlimited : sub.trafficGb === null;
    const trafficGb = state?.subId === subId ? state.trafficGb : sub.trafficGb;
    let category = state?.subId === subId ? state.category : await inferRenewCategory(sub);
    if (unlimited || trafficGb === null) category = "unlimited";
    const months =
      state?.subId === subId ? state.months : Math.min(1, await getMaxPurchaseMonths());
    try {
      const order = await createMatrixOrder({
        userId: user.id,
        trafficGb: unlimited ? null : trafficGb,
        months,
        accountName: sub.email,
        kind: OrderKind.renew,
        targetSubId: sub.id,
        quantity: 1,
        category,
      });
      await auditLog({
        action: "order_created",
        actorTelegramId: ctx.from!.id,
        target: order.id,
        detail: `renew ${formatToman(order.price)}`,
      });
      const wallet = await getWallet(user.id);
      await ctx.editMessageText(`${orderSummaryText(order)}\n\nروش پرداخت را انتخاب کنید:`, {
        reply_markup: payMethodKeyboard(order.id, wallet.balance),
      });
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery("wallet:charge", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("مبلغ شارژ را انتخاب کنید (تومان):", {
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

  bot.command("backup", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.reply("⏳ در حال ساخت پشتیبان…");
    const { sendBackupToAdmins } = await import("../services/backup.js");
    const r = await sendBackupToAdmins(ctx.api, { reason: "دستور /backup" });
    if (r.ok) await ctx.reply(`✅ ارسال شد برای ${r.sent} ادمین\n${r.name}`);
    else await ctx.reply(`❌ ${r.error ?? "خطا"}`);
  });

  bot.command("miniapp", async (ctx) => {
    const url = await getSetting("miniapp_url");
    if (!url) {
      await ctx.reply("وب‌اپ هنوز تنظیم نشده. ادمین: /setminiapp https://...");
      return;
    }
    await ctx.reply("برای باز کردن داشبورد روی دکمه بزنید:", {
      reply_markup: new InlineKeyboard().webApp("🚀 باز کردن وب‌اپ", url),
    });
  });

  bot.command("setminiapp", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const url = (ctx.match ?? "").trim();
    if (!url.startsWith("http")) return ctx.reply("Usage: /setminiapp https://app.example.com");
    await setSetting("miniapp_url", url);
    await syncTelegramMenu(ctx.api).catch(() => undefined);
    await ctx.reply("آدرس وب‌اپ ذخیره شد و منوی ربات به‌روز شد ✅");
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error("Grammy", e.description);
    else if (e instanceof HttpError) console.error("HTTP", e);
    else console.error(e);
  });

  void syncTelegramMenuSafe(bot);

  return bot;
}
