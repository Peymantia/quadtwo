import { InlineKeyboard, type Bot, type Context } from "grammy";
import { upsertUserFromTelegram } from "../services/users.js";
import { isControlAdmin } from "./admin-center.js";
import { effectiveRole } from "../services/demo-role.js";
import {
  canManageDiscountCodes,
  createDiscountCode,
  isDiscountCodesEnabled,
  listDiscountCodesForUser,
  getDiscountMaxPercentForRole,
  updateDiscountCode,
  deleteDiscountCode,
  setDiscountCodesEnabled,
} from "../services/discount-codes.js";
import type { User } from "@prisma/client";

type CreateWait =
  | { step: "code" }
  | { step: "percent"; code: string }
  | { step: "maxUses"; code: string; percentOff: number }
  | { step: "shareable"; code: string; percentOff: number; maxUses: number | null };

const waitingCreate = new Map<number, CreateWait>();

export function clearDiscountBotWaits(tid: number) {
  waitingCreate.delete(tid);
}

function actorFromAccess(access: { user: User; role: string }): Pick<User, "id" | "role"> {
  return { id: access.user.id, role: access.role as User["role"] };
}

async function assertDiscountAccess(ctx: Context): Promise<{
  user: Awaited<ReturnType<typeof upsertUserFromTelegram>>;
  role: string;
} | null> {
  if (!ctx.from) return null;
  const user = await upsertUserFromTelegram(ctx.from);
  const role = effectiveRole(ctx.from.id, user.role);
  const adminOk = await isControlAdmin(ctx.from.id);
  if (!canManageDiscountCodes(role) && !adminOk) return null;
  return { user, role: adminOk ? (role === "admin" ? "admin" : role) : role };
}

async function showDiscountHome(ctx: Context, edit = true) {
  const access = await assertDiscountAccess(ctx);
  if (!access) {
    await ctx.reply("دسترسی ندارید.");
    return;
  }
  const enabled = await isDiscountCodesEnabled();
  const maxPercent = await getDiscountMaxPercentForRole(access.role);
  const items = await listDiscountCodesForUser(access.user.id, access.role);
  const lines = [
    "🎟 کدهای تخفیف",
    "",
    `وضعیت سیستم: ${enabled ? "فعال 🟢" : "خاموش 🔴"}`,
    `سقف درصد شما: ${maxPercent}٪`,
    "هر کد فقط روی خریدهای خودتان اعمال می‌شود — مگر «قابل‌اشتراک» باشد.",
    "کد ادمین برای همه خریداران معتبر است.",
    "",
    items.length ? "کدهای شما:" : "هنوز کدی نساخته‌اید.",
  ];
  for (const it of items.slice(0, 12)) {
    lines.push(
      `• ${it.active ? "🟢" : "🔴"} ${it.code} — ${it.percentOff}٪ (${it.usedCount}${it.maxUses != null ? `/${it.maxUses}` : ""})${it.shareable ? " · اشتراک" : ""}`,
    );
  }
  const kb = new InlineKeyboard().text("➕ ساخت کد جدید", "disc:new").success().row();
  if (access.role === "admin" || (await isControlAdmin(ctx.from?.id))) {
    kb.text(enabled ? "خاموش کردن سیستم" : "روشن کردن سیستم", "disc:toggle").row();
  }
  for (const it of items.slice(0, 8)) {
    kb.text(`${it.active ? "⏸" : "▶️"} ${it.code}`, `disc:tog:${it.id}`)
      .text(it.shareable ? "🔓" : "🔒", `disc:share:${it.id}`)
      .text("🗑", `disc:delask:${it.id}`)
      .row();
  }
  if (await isControlAdmin(ctx.from?.id)) kb.text("« کنترل سنتر", "cc:home");
  else kb.text("« بازگشت", "menu:home");

  const text = lines.join("\n");
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

/** Returns true if the message was consumed as discount-code creation input. */
export async function handleDiscountCreateText(ctx: Context, text: string): Promise<boolean> {
  const tid = ctx.from?.id;
  if (!tid) return false;
  const wait = waitingCreate.get(tid);
  if (!wait) return false;
  if (text === "/cancel" || text === "انصراف") {
    waitingCreate.delete(tid);
    await ctx.reply("لغو شد.");
    return true;
  }
  const access = await assertDiscountAccess(ctx);
  if (!access) {
    waitingCreate.delete(tid);
    return false;
  }
  const actor = actorFromAccess(access);

  if (wait.step === "code") {
    waitingCreate.set(tid, { step: "percent", code: text });
    const max = await getDiscountMaxPercentForRole(access.role);
    await ctx.reply(`درصد تخفیف را بفرستید (۱ تا ${max}):`);
    return true;
  }

  if (wait.step === "percent") {
    const percentOff = Number(text.replace(/[^\d]/g, ""));
    if (!Number.isFinite(percentOff) || percentOff < 1) {
      await ctx.reply("درصد نامعتبر است. دوباره بفرستید یا /cancel");
      return true;
    }
    waitingCreate.set(tid, { step: "maxUses", code: wait.code, percentOff });
    await ctx.reply(
      "حداکثر تعداد استفاده را بفرستید:\n`0` یا `نامحدود` = بدون سقف\n`1` = یک‌بارمصرف\nلغو: /cancel",
      { parse_mode: "Markdown" },
    );
    return true;
  }

  if (wait.step === "maxUses") {
    const raw = text.trim().toLowerCase();
    let maxUses: number | null = null;
    if (raw === "0" || raw === "نامحدود" || raw === "u" || raw === "unlimited") {
      maxUses = null;
    } else {
      const n = Number(raw.replace(/[^\d]/g, ""));
      if (!Number.isFinite(n) || n < 1) {
        await ctx.reply("عدد نامعتبر است. مثلاً ۱ یا ۰ برای نامحدود. /cancel");
        return true;
      }
      maxUses = Math.floor(n);
    }
    waitingCreate.set(tid, {
      step: "shareable",
      code: wait.code,
      percentOff: wait.percentOff,
      maxUses,
    });
    const kb = new InlineKeyboard()
      .text("🔒 فقط خودم", "disc:new:share:0")
      .text("🔓 قابل‌اشتراک", "disc:new:share:1")
      .row()
      .text("انصراف", "disc:new:cancel");
    await ctx.reply("این کد برای مشتری‌ها هم قابل استفاده باشد؟", { reply_markup: kb });
    return true;
  }

  return false;
}

async function finishCreate(
  ctx: Context,
  access: { user: User; role: string },
  wait: Extract<CreateWait, { step: "shareable" }>,
  shareable: boolean,
) {
  waitingCreate.delete(ctx.from!.id);
  try {
    const item = await createDiscountCode({
      actor: actorFromAccess(access),
      code: wait.code,
      percentOff: wait.percentOff,
      maxUses: wait.maxUses,
      shareable,
    });
    await ctx.reply(
      [
        `✅ کد ${item.code} با ${item.percentOff}٪ ساخته شد`,
        item.maxUses == null ? "سقف استفاده: نامحدود" : `سقف استفاده: ${item.maxUses}`,
        item.shareable ? "وضعیت: قابل‌اشتراک با مشتری" : "وضعیت: فقط سازنده",
      ].join("\n"),
      { reply_markup: new InlineKeyboard().text("🎟 مدیریت کدها", "disc:home") },
    );
  } catch (err) {
    await ctx.reply(`❌ ${String(err instanceof Error ? err.message : err)}`);
  }
}

export function registerDiscountBotHandlers(bot: Bot) {
  bot.callbackQuery("cc:discounts", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) {
      return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    }
    await ctx.answerCallbackQuery();
    await showDiscountHome(ctx, true);
  });

  bot.callbackQuery("disc:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showDiscountHome(ctx, true);
  });

  bot.callbackQuery("disc:toggle", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const on = !(await isDiscountCodesEnabled());
    await setDiscountCodesEnabled(on);
    await showDiscountHome(ctx, true);
  });

  bot.callbackQuery("disc:new", async (ctx) => {
    const access = await assertDiscountAccess(ctx);
    if (!access) {
      return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    }
    await ctx.answerCallbackQuery();
    waitingCreate.set(ctx.from!.id, { step: "code" });
    await ctx.reply(
      "کد را بفرستید (انگلیسی/عدد، ۳ تا ۳۲ کاراکتر).\nبعداً درصد، سقف استفاده و اشتراک پرسیده می‌شود.\nلغو: /cancel",
    );
  });

  bot.callbackQuery("disc:new:cancel", async (ctx) => {
    waitingCreate.delete(ctx.from!.id);
    await ctx.answerCallbackQuery({ text: "لغو شد" });
    await showDiscountHome(ctx, true);
  });

  bot.callbackQuery(/^disc:new:share:([01])$/, async (ctx) => {
    const access = await assertDiscountAccess(ctx);
    if (!access) return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    const wait = waitingCreate.get(ctx.from!.id);
    if (!wait || wait.step !== "shareable") {
      await ctx.answerCallbackQuery({ text: "منقضی شد", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await finishCreate(ctx, access, wait, ctx.match![1] === "1");
  });

  bot.callbackQuery(/^disc:tog:(.+)$/, async (ctx) => {
    const access = await assertDiscountAccess(ctx);
    if (!access) return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    await ctx.answerCallbackQuery();
    const id = ctx.match![1]!;
    const items = await listDiscountCodesForUser(access.user.id, access.role);
    const row = items.find((i) => i.id === id);
    if (!row) {
      await ctx.reply("کد پیدا نشد.");
      return;
    }
    try {
      await updateDiscountCode({
        actor: actorFromAccess(access),
        id,
        active: !row.active,
      });
      await showDiscountHome(ctx, true);
    } catch (err) {
      await ctx.reply(String(err instanceof Error ? err.message : err));
    }
  });

  bot.callbackQuery(/^disc:share:(.+)$/, async (ctx) => {
    const access = await assertDiscountAccess(ctx);
    if (!access) return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    await ctx.answerCallbackQuery();
    const id = ctx.match![1]!;
    const items = await listDiscountCodesForUser(access.user.id, access.role);
    const row = items.find((i) => i.id === id);
    if (!row) {
      await ctx.reply("کد پیدا نشد.");
      return;
    }
    try {
      await updateDiscountCode({
        actor: actorFromAccess(access),
        id,
        shareable: !row.shareable,
      });
      await showDiscountHome(ctx, true);
    } catch (err) {
      await ctx.reply(String(err instanceof Error ? err.message : err));
    }
  });

  bot.callbackQuery(/^disc:delask:(.+)$/, async (ctx) => {
    const access = await assertDiscountAccess(ctx);
    if (!access) return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    await ctx.answerCallbackQuery();
    const id = ctx.match![1]!;
    const kb = new InlineKeyboard()
      .text("✅ بله، حذف شود", `disc:delyes:${id}`)
      .danger()
      .text("انصراف", "disc:home")
      .row();
    await ctx.reply("این کد تخفیف حذف شود؟", { reply_markup: kb });
  });

  bot.callbackQuery(/^disc:delyes:(.+)$/, async (ctx) => {
    const access = await assertDiscountAccess(ctx);
    if (!access) return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    await ctx.answerCallbackQuery();
    try {
      await deleteDiscountCode({ actor: actorFromAccess(access), id: ctx.match![1]! });
      await showDiscountHome(ctx, true);
    } catch (err) {
      await ctx.reply(String(err instanceof Error ? err.message : err));
    }
  });
}
