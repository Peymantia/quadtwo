import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Subscription } from "@prisma/client";
import { prisma } from "../db.js";
import { getLiveSubscriptionStatus, liveStatusText, type LiveSubStatus } from "../services/live-status.js";
import { toggleSubscriptionEnabled } from "../services/provision.js";
import { checkRenewEligibility } from "../services/renew-eligibility.js";
import { upsertUserFromTelegram } from "../services/users.js";
import { friendlyBotError } from "../panel/xui-errors.js";
import { myServicesListKeyboard, subscriptionDetailKeyboard, BTN } from "./keyboards.js";

const PAGE_SIZE = 20;
const NOTE_MAX = 500;

export const myServicesQuery = new Map<number, string>();
export const waitingMyServicesSearch = new Set<number>();
/** telegramId → subscriptionId waiting for note text */
export const waitingServiceNote = new Map<number, string>();

/** Button label: Sanaei panel name only (email/title), no QT-code prefix. */
function subLabel(sub: Pick<Subscription, "email" | "code" | "title" | "isTest" | "note">) {
  const name = (sub.email || sub.title || "").trim() || (sub.code || "").trim() || "سرویس";
  // Always lead with note glyph so Premium/Universal icon shows (imported accounts may have empty note).
  let label = `📝 ${name}`;
  if (sub.isTest) label = `🧪 ${label}`;
  return label.length > 30 ? `${label.slice(0, 29)}…` : label;
}

function filterSubs(subs: Subscription[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return subs;
  return subs.filter(
    (s) =>
      s.email.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.title?.toLowerCase().includes(q) ?? false) ||
      (s.note?.toLowerCase().includes(q) ?? false),
  );
}

function listHeader(total: number, query: string, page: number, pages: number) {
  const lines = ["📦 سرویس‌های من", ""];
  if (query) lines.push(`🔍 جستجو: ${query}`);
  lines.push(`تعداد: ${total}${pages > 1 ? ` · صفحه ${page + 1}/${pages}` : ""}`);
  lines.push("", "یک سرویس را انتخاب کنید:");
  return lines.join("\n");
}

export async function showMyServicesList(
  ctx: Context,
  opts: { edit?: boolean; page?: number; query?: string | null } = {},
) {
  const tid = ctx.from!.id;
  const user = await upsertUserFromTelegram(ctx.from!);
  const query =
    opts.query !== undefined && opts.query !== null ? opts.query : (myServicesQuery.get(tid) ?? "");
  myServicesQuery.set(tid, query);

  const all = await prisma.subscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const filtered = filterSubs(all, query);
  if (!filtered.length) {
    const text = query
      ? `📦 سرویس‌های من\n\nچیزی برای «${query}» پیدا نشد.`
      : "📦 سرویس‌های من\n\nسرویسی ندارید.\nاکانت‌ها با شناسه تلگرام شما ذخیره می‌شوند.";
    const kb = myServicesListKeyboard({ items: [], page: 0, pages: 0, hasQuery: Boolean(query) });
    if (opts.edit && ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, { reply_markup: kb });
    } else {
      await ctx.reply(text, { reply_markup: kb });
    }
    return;
  }

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, opts.page ?? 0));
  const slice = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const items = slice.map((s) => ({ id: s.id, label: subLabel(s) }));
  const text = listHeader(filtered.length, query, page, pages);
  const kb = myServicesListKeyboard({ items, page, pages, hasQuery: Boolean(query) });

  if (opts.edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

function detailText(live: LiveSubStatus, createdAt: Date, note?: string | null) {
  const created = createdAt.toLocaleDateString("fa-IR");
  const noteLine = note?.trim()
    ? `\n📝 یادداشت:\n${note.trim()}`
    : "\n📝 یادداشت: —";
  return [
    ...liveStatusText(live).split("\n"),
    `📅 تاریخ ساخت: ${created}`,
    noteLine,
    live.subUrl ? `\n🔗 لینک ساب در دکمه‌های زیر` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function showSubscriptionDetail(ctx: Context, subId: string, edit = false) {
  const user = await upsertUserFromTelegram(ctx.from!);
  const sub = await prisma.subscription.findFirst({
    where: { id: subId, userId: user.id },
  });
  if (!sub) {
    const msg = "سرویس پیدا نشد.";
    if (edit && ctx.callbackQuery?.message) await ctx.editMessageText(msg);
    else await ctx.reply(msg);
    return;
  }

  const live = await getLiveSubscriptionStatus(sub.id);
  const text = live
    ? detailText(live, sub.createdAt, sub.note)
    : [
        `🆔 ${sub.code}`,
        `📛 نام: ${sub.email}`,
        `حجم: ${sub.isTest ? "۲۵۰ مگابایت" : `${sub.trafficGb ?? "—"} GB`}`,
        `📅 تاریخ ساخت: ${sub.createdAt.toLocaleDateString("fa-IR")}`,
        sub.note?.trim() ? `📝 یادداشت:\n${sub.note.trim()}` : "📝 یادداشت: —",
      ].join("\n");

  const panelEnabled = live?.panelEnabled;
  const renew = sub.isTest ? { ok: false } : await checkRenewEligibility(sub.id);
  const kb = subscriptionDetailKeyboard({
    subId: sub.id,
    panelEnabled,
    canRenew: renew.ok,
  });

  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

export function registerMyServicesHandlers(bot: Bot) {
  bot.callbackQuery("mysvc:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    myServicesQuery.delete(ctx.from!.id);
    await showMyServicesList(ctx, { edit: true, page: 0, query: "" });
  });

  bot.callbackQuery(/^mysvc:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = Number(ctx.match![1]);
    await showMyServicesList(ctx, { edit: true, page });
  });

  bot.callbackQuery("mysvc:search", async (ctx) => {
    await ctx.answerCallbackQuery();
    waitingMyServicesSearch.add(ctx.from!.id);
    await ctx.reply("🔍 جستجوی سریع\n\nنام اکانت، کد سرویس یا بخشی از آن را بفرستید.\nلغو: انصراف");
  });

  bot.callbackQuery("mysvc:clear", async (ctx) => {
    await ctx.answerCallbackQuery();
    myServicesQuery.delete(ctx.from!.id);
    await showMyServicesList(ctx, { edit: true, page: 0, query: "" });
  });

  bot.callbackQuery(/^mysvc:open:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال بارگذاری…" });
    await showSubscriptionDetail(ctx, ctx.match![1]!, true);
  });

  bot.callbackQuery(/^sub:note:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsertUserFromTelegram(ctx.from!);
    const subId = ctx.match![1]!;
    const sub = await prisma.subscription.findFirst({
      where: { id: subId, userId: user.id },
    });
    if (!sub) {
      await ctx.reply("سرویس پیدا نشد.");
      return;
    }
    waitingServiceNote.set(ctx.from!.id, sub.id);
    const current = sub.note?.trim();
    await ctx.reply(
      [
        "📝 ثبت / ویرایش یادداشت",
        "",
        `سرویس: ${sub.code} · ${sub.email}`,
        current ? `یادداشت فعلی:\n${current}` : "هنوز یادداشتی ثبت نشده.",
        "",
        "متن یادداشت را بفرستید (حداکثر ۵۰۰ کاراکتر).",
        "برای پاک کردن یادداشت: -",
        "لغو: انصراف",
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard().text("« بازگشت", `mysvc:open:${sub.id}`),
      },
    );
  });

  bot.callbackQuery(/^sub:toggle:(.+)$/, async (ctx) => {
    try {
      const user = await upsertUserFromTelegram(ctx.from!);
      const enabled = await toggleSubscriptionEnabled(ctx.match![1]!, user.id);
      await ctx.answerCallbackQuery({
        text: enabled ? "فعال 🟢" : "غیر فعال 🔴",
        show_alert: true,
      });
      await showSubscriptionDetail(ctx, ctx.match![1]!, true);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: "خطا", show_alert: true }).catch(() => undefined);
      await ctx.reply(friendlyBotError(err));
    }
  });
}

export async function handleMyServicesSearch(ctx: Context, text: string): Promise<boolean> {
  const tid = ctx.from!.id;
  if (!waitingMyServicesSearch.has(tid)) return false;
  waitingMyServicesSearch.delete(tid);
  myServicesQuery.set(tid, text.trim());
  await showMyServicesList(ctx, { page: 0, query: text.trim() });
  return true;
}

/** Handle note text while waiting. Returns true if consumed. */
export async function handleServiceNoteText(ctx: Context, text: string): Promise<boolean> {
  const tid = ctx.from?.id;
  if (!tid) return false;
  const subId = waitingServiceNote.get(tid);
  if (!subId) return false;

  // Don't capture main-menu taps as note content
  if ((Object.values(BTN) as string[]).includes(text.trim())) {
    waitingServiceNote.delete(tid);
    return false;
  }

  const user = await upsertUserFromTelegram(ctx.from!);
  const sub = await prisma.subscription.findFirst({
    where: { id: subId, userId: user.id },
  });
  waitingServiceNote.delete(tid);
  if (!sub) {
    await ctx.reply("سرویس پیدا نشد.");
    return true;
  }

  const raw = text.trim();
  const note = raw === "-" || raw === "—" || raw === "پاک" ? null : raw.slice(0, NOTE_MAX);
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { note },
  });

  await ctx.reply(note ? "یادداشت ذخیره شد ✅" : "یادداشت پاک شد ✅");
  await showSubscriptionDetail(ctx, sub.id, false);
  return true;
}

export function clearMyServicesWaits(tid: number) {
  waitingMyServicesSearch.delete(tid);
  waitingServiceNote.delete(tid);
  myServicesQuery.delete(tid);
}
