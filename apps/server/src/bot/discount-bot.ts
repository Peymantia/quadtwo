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

type CreateWait = { step: "code" | "percent"; code?: string };

const waitingCreate = new Map<number, CreateWait>();

export function clearDiscountBotWaits(tid: number) {
  waitingCreate.delete(tid);
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
    "هر کد فقط روی خریدهای خودتان اعمال می‌شود.",
    "",
    items.length ? "کدهای شما:" : "هنوز کدی نساخته‌اید.",
  ];
  for (const it of items.slice(0, 12)) {
    lines.push(
      `• ${it.active ? "🟢" : "🔴"} ${it.code} — ${it.percentOff}٪ (${it.usedCount}${it.maxUses != null ? `/${it.maxUses}` : ""})`,
    );
  }
  const kb = new InlineKeyboard().text("➕ ساخت کد جدید", "disc:new").success().row();
  if (access.role === "admin" || (await isControlAdmin(ctx.from?.id))) {
    kb.text(enabled ? "خاموش کردن سیستم" : "روشن کردن سیستم", "disc:toggle").row();
  }
  for (const it of items.slice(0, 8)) {
    kb.text(`${it.active ? "⏸" : "▶️"} ${it.code}`, `disc:tog:${it.id}`)
      .text(`🗑`, `disc:del:${it.id}`)
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
  if (wait.step === "code") {
    waitingCreate.set(tid, { step: "percent", code: text });
    const max = await getDiscountMaxPercentForRole(access.role);
    await ctx.reply(`درصد تخفیف را بفرستید (۱ تا ${max}):`);
    return true;
  }
  if (wait.step === "percent" && wait.code) {
    waitingCreate.delete(tid);
    const percentOff = Number(text.replace(/[^\d]/g, ""));
    try {
      const item = await createDiscountCode({
        actor: access.user,
        code: wait.code,
        percentOff,
      });
      await ctx.reply(`✅ کد ${item.code} با ${item.percentOff}٪ ساخته شد.`, {
        reply_markup: new InlineKeyboard().text("🎟 مدیریت کدها", "disc:home"),
      });
    } catch (err) {
      await ctx.reply(`❌ ${String(err instanceof Error ? err.message : err)}`);
    }
    return true;
  }
  return false;
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
    await ctx.reply("کد را بفرستید (انگلیسی/عدد، ۳ تا ۳۲ کاراکتر). لغو: /cancel");
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
        actor: access.user,
        id,
        active: !row.active,
      });
      await showDiscountHome(ctx, true);
    } catch (err) {
      await ctx.reply(String(err instanceof Error ? err.message : err));
    }
  });

  bot.callbackQuery(/^disc:del:(.+)$/, async (ctx) => {
    const access = await assertDiscountAccess(ctx);
    if (!access) return ctx.answerCallbackQuery({ text: "دسترسی ندارید", show_alert: true });
    await ctx.answerCallbackQuery();
    try {
      await deleteDiscountCode({ actor: access.user, id: ctx.match![1]! });
      await showDiscountHome(ctx, true);
    } catch (err) {
      await ctx.reply(String(err instanceof Error ? err.message : err));
    }
  });
}
