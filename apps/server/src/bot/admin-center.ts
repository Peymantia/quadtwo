import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { OrderStatus, UserRole } from "@prisma/client";
import { isAdminTelegramId } from "../config/env.js";
import { prisma } from "../db.js";
import { getConfiguredInboundIds, parseInboundIds } from "../services/inbounds.js";
import { orderSummaryText } from "../services/orders.js";
import {
  deactivateCell,
  listPriceMatrix,
  setCellGolden,
  upsertPriceCell,
  type PlanCategory,
} from "../services/pricing.js";
import {
  addExtraAdminId,
  getChannels,
  getExtraAdminIds,
  getNotifConfig,
  getSetting,
  removeExtraAdminId,
  saveChannels,
  saveNotifConfig,
  setSetting,
  type ChannelConfig,
  type NotifConfig,
} from "../services/settings.js";
import { demoteToUser, listNotifyAdminTelegramIds, partnerSalesReport } from "../services/users.js";
import { formatToman } from "../utils/format.js";
import {
  adminOrderKeyboard,
  controlCenterKeyboard,
  notifSettingsKeyboard,
  notifSettingsText,
} from "./keyboards.js";

/** Waiting text input for control-center forms */
export const ccWait = new Map<
  number,
  | { kind: "welcome" }
  | { kind: "channel_add" }
  | { kind: "support" }
  | { kind: "card" }
  | { kind: "inbounds" }
  | { kind: "admin_add" }
  | { kind: "price"; category: PlanCategory }
  | { kind: "notif_thr"; key: "expiryDays" | "traffic" }
>();

export async function isControlAdmin(telegramId: number | undefined): Promise<boolean> {
  if (telegramId === undefined) return false;
  if (isAdminTelegramId(telegramId)) return true;
  const extra = await getExtraAdminIds();
  if (extra.includes(BigInt(telegramId))) return true;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  return user?.role === UserRole.admin;
}

export async function showControlCenter(ctx: Context, edit = true) {
  const pending = await prisma.order.count({ where: { status: OrderStatus.awaiting_review } });
  const partners = await prisma.partnerRequest.count({ where: { status: "pending" } });
  const admins = await listNotifyAdminTelegramIds();
  const text = [
    "🎛 کنترل سنتر ادمین",
    "",
    "از این پنل گرافیکی تنظیمات ربات را بدون خط فرمان مدیریت کنید.",
    "",
    `📋 سفارش‌های باز: ${pending}`,
    `🤝 درخواست همکار: ${partners}`,
    `👑 ادمین‌های اعلان: ${admins.length}`,
  ].join("\n");
  const kb = controlCenterKeyboard();
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

function catLabel(c: string) {
  if (c === "national") return "نت ملی";
  if (c === "unlimited") return "نامحدود";
  if (c === "golden") return "طلایی";
  return "دیتا";
}

async function showPricingMenu(ctx: Context, category?: PlanCategory | "golden") {
  const kb = new InlineKeyboard()
    .text("📦 دیتا", "cc:pricing:data")
    .text("🇮🇷 نت ملی", "cc:pricing:national")
    .row()
    .text("💎 نامحدود", "cc:pricing:unlimited")
    .text("⭐ طلایی", "cc:pricing:golden")
    .row()
    .text("➕ افزودن سلول", "cc:price:add:data")
    .success()
    .row()
    .text("« کنترل سنتر", "cc:home");

  if (!category) {
    await ctx.editMessageText(
      "💰 قیمت‌گذاری اشتراک‌ها\n\nدسته را انتخاب کنید یا سلول جدید اضافه کنید.\nفرمت افزودن:\n`gb|months|user|partner|wholesale`\nمثال: `25|1|330000|260000|210000`\nنامحدود: `u|1|1500000|1200000|1000000`",
      { parse_mode: "Markdown", reply_markup: kb },
    );
    return;
  }

  const cells =
    category === "golden"
      ? await prisma.priceCell.findMany({ where: { active: true, isGolden: true }, orderBy: { sortOrder: "asc" } })
      : await listPriceMatrix(category);

  const lines = cells.slice(0, 25).map((c) => {
    const vol = c.trafficGb === null ? "∞" : `${c.trafficGb}G`;
    const gold = c.isGolden ? "⭐" : "";
    return `${gold}${vol}/${c.months}م · U:${formatToman(c.priceUser)} P:${formatToman(c.pricePartner)} W:${formatToman(c.priceWholesale)}`;
  });

  const listKb = new InlineKeyboard();
  for (const c of cells.slice(0, 8)) {
    const vol = c.trafficGb === null ? "∞" : `${c.trafficGb}`;
    listKb
      .text(`${c.isGolden ? "⭐" : "○"}${vol}/${c.months}`, `cc:price:gold:${c.id}`)
      .text("🗑", `cc:price:del:${c.id}`)
      .row();
  }
  listKb
    .text(`➕ افزودن ${catLabel(category)}`, `cc:price:add:${category === "golden" ? "data" : category}`)
    .success()
    .row()
    .text("« دسته‌ها", "cc:pricing")
    .text("« کنترل سنتر", "cc:home");

  await ctx.editMessageText(
    `💰 ${catLabel(category)}\n\n${lines.join("\n") || "خالی"}\n\n⭐ = پیشنهاد ویژه (طلایی)\nدکمه ستاره را برای طلایی/عادی بزنید.`,
    { reply_markup: listKb },
  );
}

async function showChannels(ctx: Context) {
  const channels = await getChannels();
  const lines = channels.length
    ? channels.map((c, i) => `${i + 1}. @${c.username} — ${c.required ? "🟢 اجباری" : "⚪ اختیاری"}`)
    : ["هنوز کانالی تعریف نشده."];
  const kb = new InlineKeyboard();
  for (let i = 0; i < channels.length; i++) {
    const c = channels[i]!;
    kb.text(`@${c.username}`, `cc:ch:tog:${i}`)
      .text(c.required ? "اجباری🟢" : "اختیاری", `cc:ch:req:${i}`)
      .text("🗑", `cc:ch:del:${i}`)
      .row();
  }
  kb.text("➕ افزودن کانال", "cc:ch:add").success().row();
  kb.text(channels.some((c) => c.required) ? "🔓 خاموش کردن عضویت اجباری" : "🔒 روشن کردن عضویت اجباری", "cc:ch:force").row();
  kb.text("« کنترل سنتر", "cc:home");
  await ctx.editMessageText(
    ["📢 کانال‌های عضویت اجباری", "", ...lines, "", "روی نام کانال بزنید تا اجباری/اختیاری شود. «اجباری» یعنی کاربر باید عضو باشد."].join(
      "\n",
    ),
    { reply_markup: kb },
  );
}

async function showAdmins(ctx: Context) {
  const envIds = (await listNotifyAdminTelegramIds()).map(String);
  const extra = await getExtraAdminIds();
  const lines = [
    "👑 ادمین‌ها",
    "",
    "درخواست‌ها و رسیدها برای همه ادمین‌های زیر ارسال می‌شود.",
    "",
    `لیست اعلان: ${envIds.join(", ") || "—"}`,
    "",
    "ادمین‌های اضافه (قابل حذف از پنل):",
    ...(extra.length ? extra.map((id) => `• \`${id}\``) : ["(خالی)"]),
  ];
  const kb = new InlineKeyboard().text("➕ افزودن ادمین", "cc:admin:add").success().row();
  for (const id of extra) {
    kb.text(`🗑 حذف ${id}`, `cc:admin:del:${id}`).danger().row();
  }
  kb.text("« کنترل سنتر", "cc:home");
  await ctx.editMessageText(lines.join("\n"), { parse_mode: "Markdown", reply_markup: kb });
}

async function showNotifs(ctx: Context) {
  const cfg = await getNotifConfig();
  await ctx.editMessageText(notifSettingsText(cfg), { reply_markup: notifSettingsKeyboard(cfg) });
}

async function showDemote(ctx: Context) {
  const users = await prisma.user.findMany({
    where: { role: { in: [UserRole.partner, UserRole.wholesale] } },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });
  const kb = new InlineKeyboard();
  for (const u of users) {
    const label = `${u.role === "wholesale" ? "عمده" : "همکار"} ${u.username ? `@${u.username}` : u.telegramId}`;
    kb.text(label.slice(0, 40), `cc:demote:do:${u.id}`).row();
  }
  kb.text("« کنترل سنتر", "cc:home");
  await ctx.editMessageText(
    users.length
      ? "⬇️ کاربر را انتخاب کنید تا به یوزر عادی برگردد:"
      : "همکار یا عمده‌فروشی برای تنزل نیست.",
    { reply_markup: kb },
  );
}

async function showReport(ctx: Context, role: "partner" | "wholesale") {
  const rows = await partnerSalesReport(role);
  const title = role === "wholesale" ? "عمده‌فروش‌ها" : "همکاران";
  const lines = rows.length
    ? rows.map(
        (r) =>
          `• ${r.username ? `@${r.username}` : r.telegramId} — ${r.orders} سفارش · ${formatToman(r.sales)} · ${r.subs} سرویس`,
      )
    : ["موردی نیست."];
  await ctx.editMessageText(`📊 گزارش فروش ${title}\n\n${lines.join("\n")}`, {
    reply_markup: new InlineKeyboard().text("« کنترل سنتر", "cc:home"),
  });
}

export function registerControlCenter(bot: Bot) {
  bot.callbackQuery("cc:home", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
      return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    }
    await ctx.answerCallbackQuery();
    await showControlCenter(ctx);
  });

  bot.callbackQuery("cc:welcome", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const welcome = await getSetting("welcome_text");
    await ctx.editMessageText(`📝 متن خوش‌آمد فعلی:\n\n${welcome}\n\nبرای ویرایش دکمه زیر را بزنید.`, {
      reply_markup: new InlineKeyboard()
        .text("✏️ ویرایش متن", "cc:welcome:edit")
        .primary()
        .row()
        .text("« کنترل سنتر", "cc:home"),
    });
  });

  bot.callbackQuery("cc:welcome:edit", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "welcome" });
    await ctx.reply("متن خوش‌آمد جدید را کامل بفرستید (چند خطی مجاز است).\nلغو: /cancel");
  });

  bot.callbackQuery("cc:channels", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showChannels(ctx);
  });

  bot.callbackQuery("cc:ch:add", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "channel_add" });
    await ctx.reply("یوزرنیم کانال را بفرستید (مثلاً @mychannel یا mychannel):\nلغو: /cancel");
  });

  bot.callbackQuery(/^cc:ch:del:(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const idx = Number(ctx.match![1]);
    const channels = await getChannels();
    channels.splice(idx, 1);
    await saveChannels(channels);
    await showChannels(ctx);
  });

  bot.callbackQuery(/^cc:ch:tog:(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const idx = Number(ctx.match![1]);
    const channels = await getChannels();
    if (channels[idx]) {
      channels[idx]!.required = !channels[idx]!.required;
      await saveChannels(channels);
    }
    await showChannels(ctx);
  });

  bot.callbackQuery(/^cc:ch:req:(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const idx = Number(ctx.match![1]);
    const channels = await getChannels();
    if (channels[idx]) {
      channels[idx]!.required = !channels[idx]!.required;
      await saveChannels(channels);
    }
    await showChannels(ctx);
  });

  bot.callbackQuery("cc:ch:force", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const channels = await getChannels();
    const anyRequired = channels.some((c) => c.required);
    const next = channels.map((c) => ({ ...c, required: !anyRequired }));
    await saveChannels(next.length ? next : channels);
    if (!next.length) await setSetting("channel_required", anyRequired ? "false" : "true");
    await showChannels(ctx);
  });

  bot.callbackQuery("cc:pricing", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showPricingMenu(ctx);
  });

  bot.callbackQuery(/^cc:pricing:(data|national|unlimited|golden)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showPricingMenu(ctx, ctx.match![1] as PlanCategory | "golden");
  });

  bot.callbackQuery(/^cc:price:add:(data|national|unlimited)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const category = ctx.match![1] as PlanCategory;
    ccWait.set(ctx.from!.id, { kind: "price", category });
    await ctx.reply(
      `سلول قیمت (${catLabel(category)}) را بفرستید:\n\`gb|months|user|partner|wholesale\`\nمثال: \`30|1|390000|310000|250000\`\nنامحدود: \`u|1|1500000|1200000|1000000\`\nلغو: /cancel`,
      { parse_mode: "Markdown" },
    );
  });

  bot.callbackQuery(/^cc:price:gold:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const cell = await prisma.priceCell.findUnique({ where: { id: ctx.match![1] } });
    if (cell) await setCellGolden(cell.id, !cell.isGolden);
    await showPricingMenu(ctx, cell?.isGolden ? "data" : "golden");
  });

  bot.callbackQuery(/^cc:price:del:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery({ text: "حذف شد" });
    await deactivateCell(ctx.match![1]);
    await showPricingMenu(ctx);
  });

  bot.callbackQuery("cc:admins", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showAdmins(ctx);
  });

  bot.callbackQuery("cc:admin:add", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "admin_add" });
    await ctx.reply("آی‌دی عددی تلگرام ادمین جدید را بفرستید:\nلغو: /cancel");
  });

  bot.callbackQuery(/^cc:admin:del:(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await removeExtraAdminId(BigInt(ctx.match![1]));
    await showAdmins(ctx);
  });

  bot.callbackQuery("cc:support", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const u = await getSetting("support_username");
    const id = await getSetting("support_telegram_id");
    await ctx.editMessageText(
      `🆘 پشتیبانی فعلی:\n${u ? `@${u}` : id || "تنظیم نشده"}\n\nبرای تغییر دکمه ویرایش را بزنید.`,
      {
        reply_markup: new InlineKeyboard()
          .text("✏️ ویرایش", "cc:support:edit")
          .primary()
          .row()
          .text("« کنترل سنتر", "cc:home"),
      },
    );
  });

  bot.callbackQuery("cc:support:edit", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "support" });
    await ctx.reply("آی‌دی پشتیبانی را بفرستید (@username یا عدد):\nلغو: /cancel");
  });

  bot.callbackQuery("cc:notifs", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showNotifs(ctx);
  });

  bot.callbackQuery(/^cc:notif:tog:(expiryDays|traffic|preDelete|deleted)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const key = ctx.match![1] as keyof NotifConfig;
    const cfg = await getNotifConfig();
    const entry = cfg[key];
    if (entry && typeof entry === "object" && "enabled" in entry) {
      entry.enabled = !entry.enabled;
    }
    await saveNotifConfig(cfg);
    await showNotifs(ctx);
  });

  bot.callbackQuery(/^cc:notif:thr:(expiryDays|traffic)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const key = ctx.match![1] as "expiryDays" | "traffic";
    ccWait.set(ctx.from!.id, { kind: "notif_thr", key });
    await ctx.reply(
      key === "expiryDays"
        ? "ساعت قبل از انقضا را بفرستید (مثلاً 24 یا 72):\nلغو: /cancel"
        : "آستانه مگابایت باقی‌مانده را بفرستید (مثلاً 200):\nلغو: /cancel",
    );
  });

  bot.callbackQuery("cc:rep:partner", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showReport(ctx, "partner");
  });

  bot.callbackQuery("cc:rep:wholesale", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showReport(ctx, "wholesale");
  });

  bot.callbackQuery("cc:demote", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showDemote(ctx);
  });

  bot.callbackQuery(/^cc:demote:do:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery({ text: "تنزل شد" });
    await demoteToUser(ctx.match![1]);
    await showDemote(ctx);
  });

  bot.callbackQuery("cc:card", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const number = await getSetting("card_number");
    const holder = await getSetting("card_holder");
    await ctx.editMessageText(`💳 کارت فعلی:\n\`${number}\`\n${holder}`, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✏️ ویرایش", "cc:card:edit")
        .primary()
        .row()
        .text("« کنترل سنتر", "cc:home"),
    });
  });

  bot.callbackQuery("cc:card:edit", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "card" });
    await ctx.reply("فرمت: `NUMBER|NAME`\nمثال: `6037...|Ali`\nلغو: /cancel", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("cc:inbounds", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const ids = await getConfiguredInboundIds();
    await ctx.editMessageText(`📡 Inbound IDs فعلی:\n${ids.join(", ") || "(empty)"}`, {
      reply_markup: new InlineKeyboard()
        .text("✏️ ویرایش", "cc:inbounds:edit")
        .primary()
        .row()
        .text("« کنترل سنتر", "cc:home"),
    });
  });

  bot.callbackQuery("cc:inbounds:edit", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "inbounds" });
    await ctx.reply("مثلاً `1-10` یا `1,2,3,5`\nلغو: /cancel", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("cc:pending", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const orders = await prisma.order.findMany({
      where: { status: OrderStatus.awaiting_review },
      include: { user: true },
      orderBy: { createdAt: "asc" },
      take: 15,
    });
    if (!orders.length) {
      await ctx.editMessageText("سفارش بازی نیست.", {
        reply_markup: new InlineKeyboard().text("« کنترل سنتر", "cc:home"),
      });
      return;
    }
    await ctx.editMessageText(`📋 ${orders.length} سفارش باز — جزئیات ارسال شد.`, {
      reply_markup: new InlineKeyboard().text("« کنترل سنتر", "cc:home"),
    });
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
}

/** Handle text replies for control-center wait states. Returns true if consumed. */
export async function handleControlCenterText(ctx: Context, text: string): Promise<boolean> {
  const tid = ctx.from?.id;
  if (!tid) return false;
  const wait = ccWait.get(tid);
  if (!wait) return false;
  if (!(await isControlAdmin(tid))) {
    ccWait.delete(tid);
    return false;
  }

  if (wait.kind === "welcome") {
    await setSetting("welcome_text", text);
    ccWait.delete(tid);
    await ctx.reply("متن خوش‌آمد ذخیره شد ✅", {
      reply_markup: new InlineKeyboard().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "channel_add") {
    const username = text.replace(/^@/, "").trim();
    if (!username) {
      await ctx.reply("یوزرنیم نامعتبر.");
      return true;
    }
    const channels = await getChannels();
    if (!channels.some((c) => c.username.toLowerCase() === username.toLowerCase())) {
      channels.push({ username, required: true } satisfies ChannelConfig);
      await saveChannels(channels);
    }
    ccWait.delete(tid);
    await ctx.reply(`کانال @${username} اضافه شد ✅`, {
      reply_markup: new InlineKeyboard().text("📢 کانال‌ها", "cc:channels").row().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "support") {
    if (text.startsWith("@") || /[a-zA-Z]/.test(text)) {
      await setSetting("support_username", text.replace(/^@/, ""));
      await setSetting("support_telegram_id", "");
    } else {
      await setSetting("support_telegram_id", text.replace(/\D/g, ""));
      await setSetting("support_username", "");
    }
    ccWait.delete(tid);
    await ctx.reply("پشتیبانی ذخیره شد ✅", {
      reply_markup: new InlineKeyboard().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "card") {
    if (!text.includes("|")) {
      await ctx.reply("فرمت: NUMBER|NAME");
      return true;
    }
    const [number, holder] = text.split("|").map((s) => s.trim());
    await setSetting("card_number", number!);
    await setSetting("card_holder", holder!);
    ccWait.delete(tid);
    await ctx.reply("کارت ذخیره شد ✅", {
      reply_markup: new InlineKeyboard().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "inbounds") {
    const ids = parseInboundIds(text);
    if (!ids.length) {
      await ctx.reply("شناسه معتبر نیست.");
      return true;
    }
    await setSetting("xui_inbound_ids", ids.join(","));
    ccWait.delete(tid);
    await ctx.reply(`Inbounds: ${ids.join(", ")} ✅`, {
      reply_markup: new InlineKeyboard().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "admin_add") {
    const id = text.replace(/\D/g, "");
    if (!id) {
      await ctx.reply("آی‌دی عددی نامعتبر.");
      return true;
    }
    await addExtraAdminId(BigInt(id));
    await prisma.user.updateMany({
      where: { telegramId: BigInt(id) },
      data: { role: UserRole.admin },
    });
    ccWait.delete(tid);
    await ctx.reply(`ادمین ${id} اضافه شد ✅`, {
      reply_markup: new InlineKeyboard().text("👑 ادمین‌ها", "cc:admins").row().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "price") {
    const parts = text.split("|").map((s) => s.trim());
    if (parts.length < 4) {
      await ctx.reply("فرمت: gb|months|user|partner|wholesale");
      return true;
    }
    const trafficGb = parts[0] === "u" ? null : Number(parts[0]);
    const months = Number(parts[1]);
    const priceUser = Number(parts[2]);
    const pricePartner = Number(parts[3]);
    const priceWholesale = parts[4] !== undefined ? Number(parts[4]) : pricePartner;
    if ([months, priceUser, pricePartner, priceWholesale].some((n) => Number.isNaN(n))) {
      await ctx.reply("اعداد نامعتبر.");
      return true;
    }
    await upsertPriceCell({
      trafficGb,
      months,
      priceUser,
      pricePartner,
      priceWholesale,
      category: trafficGb === null ? "unlimited" : wait.category,
    });
    ccWait.delete(tid);
    await ctx.reply("سلول قیمت ذخیره شد ✅", {
      reply_markup: new InlineKeyboard()
        .text("💰 قیمت‌گذاری", "cc:pricing")
        .row()
        .text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "notif_thr") {
    const n = Number(text.replace(/[^\d]/g, ""));
    if (!n || n < 1) {
      await ctx.reply("عدد نامعتبر.");
      return true;
    }
    const cfg = await getNotifConfig();
    if (wait.key === "expiryDays") cfg.expiryDays.hours = n;
    else cfg.traffic.megabytes = n;
    await saveNotifConfig(cfg);
    ccWait.delete(tid);
    await ctx.reply("آستانه ذخیره شد ✅", {
      reply_markup: new InlineKeyboard().text("🔔 اعلان‌ها", "cc:notifs").row().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  return false;
}
