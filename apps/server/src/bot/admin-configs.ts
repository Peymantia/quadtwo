import { InlineKeyboard } from "grammy";
import type { Bot, Context } from "grammy";
import { isControlAdmin } from "./admin-center.js";
import {
  deleteConfig,
  listConfigGroups,
  listConfigsForGroup,
  type ConfigListItem,
} from "../services/admin-configs.js";
import { friendlyBotError } from "../panel/xui-errors.js";
import { auditLog } from "../services/audit.js";

const PAGE = 10;

function itemLabel(it: ConfigListItem) {
  const code = it.code ? `${it.code} · ` : "";
  const base = `${code}${it.email}`;
  return base.length > 28 ? `${base.slice(0, 27)}…` : base;
}

export async function showConfigGroups(ctx: Context, edit = false) {
  if (!(await isControlAdmin(ctx.from?.id))) {
    await ctx.reply("فقط ادمین.");
    return;
  }
  const groups = await listConfigGroups();
  const text = [
    "📋 نمایش کلیه کانفیگ‌ها",
    "",
    "یک گروه (همکار) را انتخاب کنید، یا همه کانفیگ‌ها را ببینید.",
  ].join("\n");

  const kb = new InlineKeyboard();
  for (const g of groups) {
    if (g.key === "all") {
      kb.text(`📦 ${g.label}`, `cfg:list:all:0`).success().row();
    } else if (g.key === "tg") {
      kb.text(`📱 ${g.label}`, `cfg:list:tg:0`).row();
    } else {
      kb.text(`🤝 ${g.label}`, `cfg:list:${g.key}:0`).row();
    }
  }
  kb.text("« بستن", "cfg:close");

  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

async function showConfigList(ctx: Context, groupKey: string, page: number) {
  const { title, total, items } = await listConfigsForGroup(groupKey, page, PAGE);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(Math.max(0, page), pages - 1);

  const text = [
    `📋 ${title}`,
    `تعداد: ${total}${pages > 1 ? ` · صفحه ${safePage + 1}/${pages}` : ""}`,
    "",
    items.length ? "یک کانفیگ را انتخاب کنید:" : "کانفیگی در این گروه نیست.",
  ].join("\n");

  const enc = groupKey;
  const kb = new InlineKeyboard();
  for (const it of items) {
    const id = it.subId ? it.subId : `e_${Buffer.from(it.email).toString("base64url")}`;
    kb.text(itemLabel(it), `cfg:view:${id}`).row();
  }
  if (pages > 1) {
    if (safePage > 0) kb.text("‹ قبلی", `cfg:list:${enc}:${safePage - 1}`);
    if (safePage < pages - 1) kb.text("بعدی ›", `cfg:list:${enc}:${safePage + 1}`);
    kb.row();
  }
  kb.text("« گروه‌ها", "cfg:home").row();

  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

async function resolveViewTarget(raw: string): Promise<{ email: string; subId: string | null }> {
  if (raw.startsWith("e_")) {
    const email = Buffer.from(raw.slice(2), "base64url").toString("utf8");
    return { email, subId: null };
  }
  const { prisma } = await import("../db.js");
  const sub = await prisma.subscription.findUnique({ where: { id: raw } });
  if (!sub) throw new Error("کانفیگ در دیتابیس پیدا نشد.");
  return { email: sub.email, subId: sub.id };
}

async function showConfigDetail(ctx: Context, rawId: string) {
  const { prisma } = await import("../db.js");
  const target = await resolveViewTarget(rawId);
  const sub = target.subId
    ? await prisma.subscription.findUnique({
        where: { id: target.subId },
        include: { user: true },
      })
    : await prisma.subscription.findFirst({
        where: { email: target.email },
        include: { user: true },
      });

  const lines = ["📄 جزئیات کانفیگ", ""];
  if (sub) {
    lines.push(
      `کد: ${sub.code}`,
      `اکانت: ${sub.email}`,
      `مالک: ${sub.user.username ? `@${sub.user.username}` : sub.user.telegramId}`,
      `وضعیت: ${sub.status}`,
      `حجم: ${sub.trafficGb === null ? "نامحدود" : `${sub.trafficGb} گیگ`}`,
      `انقضا: ${sub.expiresAt.toLocaleDateString("fa-IR")}`,
      sub.note?.trim() ? `📝 یادداشت:\n${sub.note.trim()}` : "📝 یادداشت: —",
      "",
      "در دیتابیس ربات: بله",
    );
  } else {
    lines.push(`اکانت: ${target.email}`, "", "فقط در پنل ثبت شده (بدون ردیف دیتابیس).");
  }

  const viewKey = rawId;
  const kb = new InlineKeyboard()
    .text("🗑 حذف کانفیگ", `cfg:delask:${viewKey}`)
    .danger()
    .row()
    .text("« گروه‌ها", "cfg:home");

  await ctx.editMessageText(lines.join("\n"), { reply_markup: kb });
}

export function registerAdminConfigs(bot: Bot) {
  bot.callbackQuery("cfg:home", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showConfigGroups(ctx, true);
  });

  bot.callbackQuery("cfg:close", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });

  bot.callbackQuery(/^cfg:list:([^:]+):(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const groupKey = ctx.match![1]!;
    const page = Number(ctx.match![2] || 0);
    await showConfigList(ctx, groupKey, page);
  });

  bot.callbackQuery(/^cfg:view:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    try {
      await showConfigDetail(ctx, ctx.match![1]!);
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });

  bot.callbackQuery(/^cfg:delask:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const raw = ctx.match![1]!;
    let email = raw;
    try {
      const t = await resolveViewTarget(raw);
      email = t.email;
    } catch {
      /* keep */
    }
    const kb = new InlineKeyboard()
      .text("✅ بله، حذف شود", `cfg:delok:${raw}`)
      .danger()
      .row()
      .text("« انصراف", `cfg:view:${raw}`);
    await ctx.editMessageText(
      [
        "⚠️ تأیید حذف کانفیگ",
        "",
        `اکانت: ${email}`,
        "",
        "اگر در پنل باشد → از پنل و دیتابیس ربات حذف می‌شود.",
        "اگر در پنل نباشد → فقط از دیتابیس ربات حذف می‌شود.",
        "",
        "این عمل برگشت‌پذیر نیست.",
      ].join("\n"),
      { reply_markup: kb },
    );
  });

  bot.callbackQuery(/^cfg:delok:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery({ text: "در حال حذف..." });
    try {
      const target = await resolveViewTarget(ctx.match![1]!);
      const result = await deleteConfig({ subId: target.subId, email: target.email });
      await auditLog({
        action: "admin_config_delete",
        actorTelegramId: ctx.from!.id,
        target: target.email,
        detail: `panel=${result.deletedPanel} db=${result.deletedDb}`,
      });
      await ctx.editMessageText(`✅ ${result.message}\n\nاکانت: ${result.email}`, {
        reply_markup: new InlineKeyboard().text("« گروه‌ها", "cfg:home"),
      });
    } catch (err) {
      await ctx.reply(friendlyBotError(err));
    }
  });
}
