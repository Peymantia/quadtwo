import type { Bot, Context } from "grammy";
import type { Subscription } from "@prisma/client";
import { prisma } from "../db.js";
import { getLiveSubscriptionStatus, liveStatusText, type LiveSubStatus } from "../services/live-status.js";
import { toggleSubscriptionEnabled } from "../services/provision.js";
import { upsertUserFromTelegram } from "../services/users.js";
import { friendlyBotError } from "../panel/xui-errors.js";
import { myServicesListKeyboard, subscriptionDetailKeyboard } from "./keyboards.js";

const PAGE_SIZE = 20;

export const myServicesQuery = new Map<number, string>();
export const waitingMyServicesSearch = new Set<number>();

function subLabel(sub: Pick<Subscription, "email" | "code" | "title">) {
  const raw = (sub.title?.trim() || sub.email || sub.code).trim();
  return raw.length > 20 ? `${raw.slice(0, 19)}…` : raw;
}

function filterSubs(subs: Subscription[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return subs;
  return subs.filter(
    (s) =>
      s.email.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.title?.toLowerCase().includes(q) ?? false),
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

function detailText(live: LiveSubStatus, createdAt: Date) {
  const created = createdAt.toLocaleDateString("fa-IR");
  return [
    ...liveStatusText(live).split("\n"),
    `📅 تاریخ ساخت: ${created}`,
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
    ? detailText(live, sub.createdAt)
    : [
        `🆔 ${sub.code}`,
        `📛 نام: ${sub.email}`,
        `حجم: ${sub.isTest ? "۲۵۰ مگابایت" : `${sub.trafficGb ?? "—"} GB`}`,
        `📅 تاریخ ساخت: ${sub.createdAt.toLocaleDateString("fa-IR")}`,
      ].join("\n");

  const panelEnabled = live?.panelEnabled;
  const kb = subscriptionDetailKeyboard({
    subId: sub.id,
    panelEnabled,
    canRenew: !sub.isTest,
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

  bot.callbackQuery(/^sub:toggle:(.+)$/, async (ctx) => {
    try {
      const user = await upsertUserFromTelegram(ctx.from!);
      const enabled = await toggleSubscriptionEnabled(ctx.match![1]!, user.id);
      await ctx.answerCallbackQuery({
        text: enabled ? "🟢 فعال شد" : "🔴 غیرفعال شد",
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

export function clearMyServicesWaits(tid: number) {
  waitingMyServicesSearch.delete(tid);
  myServicesQuery.delete(tid);
}
