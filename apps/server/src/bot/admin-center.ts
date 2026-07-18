import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { OrderStatus, UserRole } from "@prisma/client";
import { isAdminTelegramId } from "../config/env.js";
import { prisma } from "../db.js";
import { getConfiguredInboundIds, parseInboundIds } from "../services/inbounds.js";
import { orderSummaryText } from "../services/orders.js";
import {
  deactivateCell,
  listDataMonths,
  listDataPlansForMonth,
  listPriceMatrix,
  nextNationalVolume,
  setCellGolden,
  upsertPriceCell,
  DATA_VOLUME_PRESETS,
  NATIONAL_MAX_GB,
  type PlanCategory,
} from "../services/pricing.js";
import {
  addExtraAdminId,
  getChannels,
  getExtraAdminIds,
  getNotifConfig,
  getPriceRates,
  getPricingMode,
  getSetting,
  removeExtraAdminId,
  saveChannels,
  saveNotifConfig,
  savePriceRates,
  setPricingMode,
  setSetting,
  type ChannelConfig,
  type NotifConfig,
  type PriceRates,
} from "../services/settings.js";
import { demoteToUser, listNotifyAdminTelegramIds, partnerSalesReport } from "../services/users.js";
import { formatToman } from "../utils/format.js";
import { getBackupConfig, saveBackupConfig, sendBackupToAdmins } from "../services/backup.js";
import {
  adminSalesReport,
  formatSearchResults,
  searchUsersAndOrders,
  type SalesPeriod,
} from "../services/admin-reports.js";
import { auditLog, listRecentAudit } from "../services/audit.js";
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
  | {
      kind: "price_ask";
      field: "user" | "partner" | "wholesale";
      category: PlanCategory;
      trafficGb: number | null;
      months: number;
      priceUser?: number;
      pricePartner?: number;
      cellId?: string;
    }
  | { kind: "notif_thr"; key: "expiryDays" | "traffic" }
  | { kind: "guide_text" }
  | { kind: "guide_url"; platform: "ios" | "android" | "windows" | "macos" | "extra" }
  | { kind: "iplimit" }
  | { kind: "backup_time" }
  | { kind: "search" }
  | {
      kind: "rate_ask";
      role: "user" | "partner" | "wholesale";
      field: "perGb" | "perMonth" | "unlimitedPerMonth";
      partial: PriceRates;
    }
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
  if (c === "national") return "اینترنت ملی";
  if (c === "unlimited") return "نامحدود";
  if (c === "golden") return "پیشنهاد ویژه";
  return "حجمی (دیتا)";
}

function catEmoji(c: string) {
  if (c === "national") return "🇮🇷";
  if (c === "unlimited") return "💎";
  if (c === "golden") return "⭐";
  return "📦";
}

function planTitle(trafficGb: number | null, months: number) {
  const vol = trafficGb === null ? "نامحدود" : `${trafficGb} گیگ`;
  const dur = months === 1 ? "۱ ماه" : `${months} ماه`;
  return `${vol} · ${dur}`;
}

function parsePriceNumber(text: string): number | null {
  const n = Number(text.replace(/[^\d]/g, ""));
  if (!n || n < 1000) return null;
  return n;
}

async function countByCategory() {
  const [data, national, unlimited, golden] = await Promise.all([
    prisma.priceCell.count({ where: { active: true, category: "data" } }),
    prisma.priceCell.count({ where: { active: true, category: "national" } }),
    prisma.priceCell.count({ where: { active: true, category: "unlimited" } }),
    prisma.priceCell.count({ where: { active: true, isGolden: true } }),
  ]);
  return { data, national, unlimited, golden };
}

async function showPricingHome(ctx: Context) {
  const counts = await countByCategory();
  const mode = await getPricingMode();
  const rates = await getPriceRates();
  const modeLabel =
    mode === "rate"
      ? "نرخ هر گیگ + هر ماه"
      : "قیمت‌گذاری اشتراک‌ها (پلن‌های ثابت)";
  const text = [
    "💰 قیمت‌گذاری اشتراک‌ها",
    "",
    `📐 نوع محاسبه: ${modeLabel}`,
    mode === "rate"
      ? [
          "",
          "فرمول: (گیگ × نرخ گیگ) + (ماه × نرخ ماه)",
          `👤 نمونه مشتری: هر گیگ ${formatToman(rates.user.perGb)} · هر ماه ${formatToman(rates.user.perMonth)}`,
          `مثال ۵۰ گیگ ۲ ماهه: ${formatToman(50 * rates.user.perGb + 2 * rates.user.perMonth)}`,
        ].join("\n")
      : "",
    "",
    "یکی از دسته‌ها را انتخاب کنید تا پلن‌ها را ببینید یا پلن جدید بسازید.",
    "",
    "هر پلن سه قیمت دارد:",
    "👤 مشتری عادی",
    "🤝 همکار (نماینده)",
    "📦 عمده‌فروش",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const kb = new InlineKeyboard()
    .text(
      mode === "matrix" ? "✓ بر اساس پلن‌های ثابت" : "بر اساس پلن‌های ثابت",
      "cc:pricing:mode:matrix",
    )
    .row()
    .text(
      mode === "rate" ? "✓ بر اساس نرخ گیگ/ماه" : "بر اساس نرخ گیگ/ماه",
      "cc:pricing:mode:rate",
    )
    .row()
    .text("✏️ تنظیم نرخ‌ها", "cc:pricing:rates")
    .primary()
    .row()
    .text(`${catEmoji("data")} حجمی — ${counts.data} پلن`, "cc:pricing:data")
    .row()
    .text(`${catEmoji("national")} اینترنت ملی — ${counts.national} پلن`, "cc:pricing:national")
    .row()
    .text(`${catEmoji("unlimited")} نامحدود — ${counts.unlimited} پلن`, "cc:pricing:unlimited")
    .row()
    .text(`${catEmoji("golden")} پیشنهاد ویژه — ${counts.golden} پلن`, "cc:pricing:golden")
    .success()
    .row()
    .text("« کنترل سنتر", "cc:home");

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showPriceRates(ctx: Context) {
  const rates = await getPriceRates();
  const mode = await getPricingMode();
  const line = (label: string, r: PriceRates["user"]) =>
    [
      label,
      `  هر گیگ: ${formatToman(r.perGb)}`,
      `  هر ماه: ${formatToman(r.perMonth)}`,
      `  نامحدود/ماه: ${formatToman(r.unlimitedPerMonth)}`,
    ].join("\n");

  const text = [
    "✏️ نرخ محاسبه قیمت",
    "",
    `حالت فعال: ${mode === "rate" ? "نرخ گیگ/ماه" : "پلن‌های ثابت (این نرخ‌ها فقط در حالت نرخ استفاده می‌شوند)"}`,
    "",
    line("👤 مشتری عادی", rates.user),
    "",
    line("🤝 همکار", rates.partner),
    "",
    line("📦 عمده‌فروش", rates.wholesale),
    "",
    "مثال مشتری ۵۰ گیگ ۲ ماهه:",
    formatToman(50 * rates.user.perGb + 2 * rates.user.perMonth),
  ].join("\n");

  await ctx.editMessageText(text, {
    reply_markup: new InlineKeyboard()
      .text("✏️ مشتری", "cc:pricing:rates:edit:user")
      .text("✏️ همکار", "cc:pricing:rates:edit:partner")
      .row()
      .text("✏️ عمده", "cc:pricing:rates:edit:wholesale")
      .row()
      .text("« قیمت‌گذاری", "cc:pricing"),
  });
}

async function askRateStep(
  ctx: Context,
  opts: {
    role: "user" | "partner" | "wholesale";
    field: "perGb" | "perMonth" | "unlimitedPerMonth";
    partial: PriceRates;
  },
) {
  const roleLabel =
    opts.role === "user" ? "مشتری عادی" : opts.role === "partner" ? "همکار" : "عمده‌فروش";
  const fieldLabel =
    opts.field === "perGb" ? "هر گیگ" : opts.field === "perMonth" ? "هر ماه" : "نامحدود (هر ماه)";
  ccWait.set(ctx.from!.id, {
    kind: "rate_ask",
    role: opts.role,
    field: opts.field,
    partial: opts.partial,
  });
  await ctx.reply(
    [
      `نرخ ${fieldLabel} — ${roleLabel}`,
      "",
      "فقط عدد تومان بفرستید.",
      "مثال: 15000",
      "لغو: /cancel",
    ].join("\n"),
  );
}

async function showPricingDataMonths(ctx: Context) {
  const months = await listDataMonths();
  const text = [
    "📦 حجمی (دیتا)",
    "",
    "اول دستهٔ ماهانه را انتخاب کنید؛",
    "سپس پلن‌های حجمی همان مدت را ببینید یا بسازید.",
  ].join("\n");

  const kb = new InlineKeyboard();
  for (const m of months) {
    const label = m.months === 1 ? "۱ ماهه" : `${m.months} ماهه`;
    kb.text(`${label} — ${m.count} حجم`, `cc:pricing:data:m:${m.months}`).row();
  }
  kb.text("➕ ماه جدید (۴–۱۲)", "cc:price:new:data").success().row();
  kb.text("« دسته‌ها", "cc:pricing").text("« کنترل سنتر", "cc:home");
  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showPricingDataMonth(ctx: Context, months: number, page = 0) {
  const cells = await listDataPlansForMonth(months);
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(cells.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = cells.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const dur = months === 1 ? "۱ ماهه" : `${months} ماهه`;

  const text = [
    `📦 حجمی · ${dur}`,
    "",
    cells.length
      ? "روی هر حجم بزنید تا قیمت را ببینید یا ویرایش کنید."
      : "هنوز حجمی برای این مدت نیست. با دکمه زیر بسازید.",
  ].join("\n");

  const kb = new InlineKeyboard();
  for (const c of slice) {
    const star = c.isGolden ? "⭐ " : "";
    const vol = c.trafficGb === null ? "نامحدود" : `${c.trafficGb} گیگ`;
    kb.text(`${star}${vol}`, `cc:price:view:${c.id}`).row();
  }
  if (totalPages > 1) {
    if (safePage > 0) kb.text("‹ قبلی", `cc:pricing:data:m:${months}:${safePage - 1}`);
    if (safePage < totalPages - 1) kb.text("بعدی ›", `cc:pricing:data:m:${months}:${safePage + 1}`);
    kb.row();
  }
  kb.text("➕ ساخت حجم جدید", `cc:price:newm:data:${months}`).success().row();
  kb.text("« ماه‌ها", "cc:pricing:data").text("« کنترل سنتر", "cc:home");
  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showPricingCategory(ctx: Context, category: PlanCategory | "golden", page = 0) {
  const cells =
    category === "golden"
      ? await prisma.priceCell.findMany({ where: { active: true, isGolden: true }, orderBy: [{ months: "asc" }, { sortOrder: "asc" }] })
      : await listPriceMatrix(category);

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(cells.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = cells.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const text = [
    `${catEmoji(category)} ${catLabel(category)}`,
    "",
    cells.length
      ? "روی هر پلن بزنید تا قیمت‌ها را ببینید یا ویرایش کنید."
      : "هنوز پلنی در این دسته نیست. با دکمه زیر یک پلن بسازید.",
    cells.length ? `\n📄 صفحه ${safePage + 1} از ${totalPages}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const kb = new InlineKeyboard();
  for (const c of slice) {
    const star = c.isGolden ? "⭐ " : "";
    kb.text(`${star}${planTitle(c.trafficGb, c.months)}`, `cc:price:view:${c.id}`).row();
  }

  if (totalPages > 1) {
    if (safePage > 0) kb.text("‹ قبلی", `cc:pricing:${category}:${safePage - 1}`);
    if (safePage < totalPages - 1) kb.text("بعدی ›", `cc:pricing:${category}:${safePage + 1}`);
    kb.row();
  }

  const addCat = category === "golden" ? "data" : category;
  kb.text("➕ ساخت پلن جدید", `cc:price:new:${addCat}`).success().row();
  kb.text("« دسته‌ها", "cc:pricing").text("« کنترل سنتر", "cc:home");

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showPriceDetail(ctx: Context, cellId: string) {
  const cell = await prisma.priceCell.findUnique({ where: { id: cellId } });
  if (!cell || !cell.active) {
    await ctx.answerCallbackQuery({ text: "پلن پیدا نشد", show_alert: true }).catch(() => undefined);
    await showPricingHome(ctx);
    return;
  }

  const text = [
    `${catEmoji(cell.category)} جزئیات پلن`,
    "",
    `📌 ${planTitle(cell.trafficGb, cell.months)}`,
    cell.isGolden ? "⭐ این پلن پیشنهاد ویژه است" : "○ پیشنهاد ویژه نیست",
    ...(cell.title ? [`عنوان: ${cell.title}`] : []),
    "",
    "━━━━━━━━━━━━",
    "👤 مشتری عادی",
    `   ${formatToman(cell.priceUser)}`,
    "",
    "🤝 همکار",
    `   ${formatToman(cell.pricePartner)}`,
    "",
    "📦 عمده‌فروش",
    `   ${formatToman(cell.priceWholesale)}`,
    "━━━━━━━━━━━━",
    "",
    "برای تغییر، روی دکمه قیمت موردنظر بزنید.",
  ].join("\n");

  const kb = new InlineKeyboard()
    .text("✏️ قیمت مشتری", `cc:price:edit:${cell.id}:user`)
    .row()
    .text("✏️ قیمت همکار", `cc:price:edit:${cell.id}:partner`)
    .row()
    .text("✏️ قیمت عمده", `cc:price:edit:${cell.id}:wholesale`)
    .row()
    .text(cell.isGolden ? "⭐ برداشتن از ویژه" : "⭐ کردن پیشنهاد ویژه", `cc:price:gold:${cell.id}`)
    .primary()
    .row()
    .text("🗑 حذف پلن", `cc:price:delask:${cell.id}`)
    .danger()
    .row()
    .text("« بازگشت", cell.category === "data" ? `cc:pricing:data:m:${cell.months}` : `cc:pricing:${cell.isGolden ? "golden" : cell.category}`);

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showNewPlanVolume(ctx: Context, category: PlanCategory, months?: number) {
  if (category === "national") {
    await showNewNationalVolume(ctx, 1);
    return;
  }

  if (category === "data" && months === undefined) {
    await showNewDataMonthPick(ctx);
    return;
  }

  const dur =
    months === undefined ? "" : months === 1 ? " · ۱ ماهه" : ` · ${months} ماهه`;
  const text = [
    `➕ ساخت پلن جدید — ${catLabel(category)}${dur}`,
    "",
    months !== undefined ? "حجم را انتخاب کنید:" : "مرحله ۱: حجم را انتخاب کنید",
  ].join("\n");

  const kb = new InlineKeyboard();
  if (category === "unlimited") {
    kb.text("💎 نامحدود", "cc:price:nv:unlimited:u").success().row();
  } else {
    const vols = [...DATA_VOLUME_PRESETS];
    for (let i = 0; i < vols.length; i++) {
      const cb =
        months !== undefined
          ? `cc:price:newv:data:${months}:${vols[i]}`
          : `cc:price:nv:${category}:${vols[i]}`;
      kb.text(`${vols[i]} گیگ`, cb);
      if ((i + 1) % 3 === 0) kb.row();
    }
    if (vols.length % 3 !== 0) kb.row();
  }
  const back =
    category === "data" && months !== undefined
      ? `cc:pricing:data:m:${months}`
      : `cc:pricing:${category}`;
  kb.text("« انصراف", back).danger();

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showNewDataMonthPick(ctx: Context) {
  const text = [
    "➕ ساخت پلن حجمی",
    "",
    "اول مدت (دسته ماهانه) را انتخاب کنید:",
  ].join("\n");
  const kb = new InlineKeyboard();
  for (const m of [1, 2, 3, 4, 5, 6]) {
    kb.text(m === 1 ? "۱ ماهه" : `${m} ماهه`, `cc:price:newm:data:${m}`);
    if (m % 3 === 0) kb.row();
  }
  kb.row();
  for (const m of [7, 8, 9, 10, 11, 12]) {
    kb.text(`${m} ماهه`, `cc:price:newm:data:${m}`);
    if (m % 3 === 0) kb.row();
  }
  kb.row().text("« انصراف", "cc:pricing:data").danger();
  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showNewNationalVolume(ctx: Context, gb: number) {
  const safe = Math.max(1, Math.min(NATIONAL_MAX_GB, gb));
  const text = [
    "➕ ساخت پلن جدید — اینترنت ملی",
    "",
    "حجم را با + و − تنظیم کنید (از ۱ گیگ).",
    "مدت: فقط ۱ ماهه",
  ].join("\n");

  const kb = new InlineKeyboard()
    .text("−", `cc:price:nat:${safe}:-`)
    .text(`📦 ${safe} گیگ`, "wiz:noop")
    .text("+", `cc:price:nat:${safe}:+`)
    .row()
    .text("⏳ فقط ۱ ماهه", "wiz:noop")
    .row()
    .text("✅ ادامه و تعیین قیمت", `cc:price:natok:${safe}`)
    .success()
    .row()
    .text("« انصراف", "cc:pricing:national")
    .danger();

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function showNewPlanMonths(ctx: Context, category: PlanCategory, trafficGb: number | null) {
  if (category === "national") {
    await askPriceStep(ctx, { field: "user", category, trafficGb, months: 1 });
    return;
  }

  const volLabel = trafficGb === null ? "نامحدود" : `${trafficGb} گیگ`;
  const text = [
    `➕ ساخت پلن جدید — ${catLabel(category)}`,
    `حجم: ${volLabel}`,
    "",
    "مدت را انتخاب کنید",
  ].join("\n");

  const gbKey = trafficGb === null ? "u" : String(trafficGb);
  const kb = new InlineKeyboard()
    .text("۱ ماه", `cc:price:nm:${category}:${gbKey}:1`)
    .text("۲ ماه", `cc:price:nm:${category}:${gbKey}:2`)
    .text("۳ ماه", `cc:price:nm:${category}:${gbKey}:3`)
    .row()
    .text("« بازگشت", `cc:price:new:${category}`);

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function askPriceStep(
  ctx: Context,
  opts: {
    field: "user" | "partner" | "wholesale";
    category: PlanCategory;
    trafficGb: number | null;
    months: number;
    priceUser?: number;
    pricePartner?: number;
    cellId?: string;
  },
) {
  const labels = {
    user: { title: "👤 قیمت مشتری عادی", hint: "مثلاً 330000" },
    partner: { title: "🤝 قیمت همکار", hint: "مثلاً 260000" },
    wholesale: { title: "📦 قیمت عمده‌فروش", hint: "مثلاً 210000" },
  } as const;
  const L = labels[opts.field];
  ccWait.set(ctx.from!.id, {
    kind: "price_ask",
    field: opts.field,
    category: opts.category,
    trafficGb: opts.trafficGb,
    months: opts.months,
    priceUser: opts.priceUser,
    pricePartner: opts.pricePartner,
    cellId: opts.cellId,
  });

  const header = opts.cellId
    ? `ویرایش ${L.title}\nپلن: ${planTitle(opts.trafficGb, opts.months)}`
    : [
        `➕ ساخت پلن — ${catLabel(opts.category)}`,
        `📌 ${planTitle(opts.trafficGb, opts.months)}`,
        "",
        `مرحله ۳: ${L.title}`,
      ].join("\n");

  await ctx.reply(
    [
      header,
      "",
      "فقط عدد قیمت به تومان را بفرستید.",
      L.hint,
      "",
      "لغو: /cancel",
    ].join("\n"),
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

async function showSales(ctx: Context, period: SalesPeriod = "today") {
  const report = await adminSalesReport(period);
  await ctx.editMessageText(report.text, {
    reply_markup: new InlineKeyboard()
      .text(period === "today" ? "• امروز" : "امروز", "cc:sales:today")
      .text(period === "week" ? "• هفته" : "هفته", "cc:sales:week")
      .text(period === "month" ? "• ماه" : "ماه", "cc:sales:month")
      .row()
      .text("« کنترل سنتر", "cc:home"),
  });
}

async function showAudit(ctx: Context) {
  const rows = await listRecentAudit(25);
  const labels: Record<string, string> = {
    order_created: "سفارش",
    receipt_uploaded: "رسید",
    order_approved: "تأیید",
    order_rejected: "رد",
    provision_ok: "ساخت OK",
    provision_fail: "ساخت FAIL",
    partner_request: "درخواست همکار",
    partner_approved: "تأیید همکار",
    partner_rejected: "رد همکار",
    test_claimed: "تست",
    backup_sent: "بکاپ",
    admin_search: "جستجو",
    setting_changed: "تنظیمات",
  };
  const lines = rows.length
    ? rows.map((r) => {
        const t = r.createdAt.toLocaleString("fa-IR", { hour12: false });
        const act = labels[r.action] ?? r.action;
        const who = r.actorTelegramId != null ? ` · ${r.actorTelegramId}` : "";
        const tgt = r.target ? ` · ${r.target}` : "";
        const det = r.detail ? `\n  ${r.detail}` : "";
        return `• ${t} — ${act}${who}${tgt}${det}`;
      })
    : ["لاگی ثبت نشده."];
  await ctx.editMessageText(`📜 لاگ عملیات (۲۵ مورد اخیر)\n\n${lines.join("\n")}`.slice(0, 3900), {
    reply_markup: new InlineKeyboard()
      .text("🔄 تازه‌سازی", "cc:audit")
      .row()
      .text("« کنترل سنتر", "cc:home"),
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
    await showPricingHome(ctx);
  });

  bot.callbackQuery(/^cc:pricing:mode:(matrix|rate)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const mode = ctx.match![1] as "matrix" | "rate";
    await setPricingMode(mode);
    await ctx.answerCallbackQuery({
      text: mode === "rate" ? "محاسبه بر اساس نرخ گیگ/ماه" : "محاسبه بر اساس پلن‌های ثابت",
    });
    await showPricingHome(ctx);
  });

  bot.callbackQuery("cc:pricing:rates", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showPriceRates(ctx);
  });

  bot.callbackQuery(/^cc:pricing:rates:edit:(user|partner|wholesale)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const role = ctx.match![1] as "user" | "partner" | "wholesale";
    const partial = await getPriceRates();
    await askRateStep(ctx, { role, field: "perGb", partial });
  });

  bot.callbackQuery(/^cc:pricing:data:m:(\d+)(?::(\d+))?$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const months = Number(ctx.match![1]);
    const page = ctx.match![2] ? Number(ctx.match![2]) : 0;
    await showPricingDataMonth(ctx, months, page);
  });

  bot.callbackQuery("cc:pricing:data", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showPricingDataMonths(ctx);
  });

  bot.callbackQuery(/^cc:pricing:(national|unlimited|golden)(?::(\d+))?$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const category = ctx.match![1] as PlanCategory | "golden";
    const page = ctx.match![2] ? Number(ctx.match![2]) : 0;
    await showPricingCategory(ctx, category, page);
  });

  bot.callbackQuery(/^cc:price:view:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showPriceDetail(ctx, ctx.match![1]);
  });

  bot.callbackQuery(/^cc:price:new:(data|national|unlimited)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showNewPlanVolume(ctx, ctx.match![1] as PlanCategory);
  });

  bot.callbackQuery(/^cc:price:newm:data:(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showNewPlanVolume(ctx, "data", Number(ctx.match![1]));
  });

  bot.callbackQuery(/^cc:price:newv:data:(\d+):(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const months = Number(ctx.match![1]);
    const trafficGb = Number(ctx.match![2]);
    await askPriceStep(ctx, { field: "user", category: "data", trafficGb, months });
  });

  bot.callbackQuery(/^cc:price:nat:(\d+):([+-])$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const cur = Number(ctx.match![1]);
    const dir = ctx.match![2] === "+" ? 1 : -1;
    await showNewNationalVolume(ctx, nextNationalVolume(cur, dir));
  });

  bot.callbackQuery(/^cc:price:natok:(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const trafficGb = Number(ctx.match![1]);
    await askPriceStep(ctx, { field: "user", category: "national", trafficGb, months: 1 });
  });

  bot.callbackQuery(/^cc:price:nv:(data|national|unlimited):(u|\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const category = ctx.match![1] as PlanCategory;
    const trafficGb = ctx.match![2] === "u" ? null : Number(ctx.match![2]);
    if (category === "national") {
      await askPriceStep(ctx, { field: "user", category, trafficGb, months: 1 });
      return;
    }
    await showNewPlanMonths(ctx, category, trafficGb);
  });

  bot.callbackQuery(/^cc:price:nm:(data|national|unlimited):(u|\d+):(\d+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const category = ctx.match![1] as PlanCategory;
    const trafficGb = ctx.match![2] === "u" ? null : Number(ctx.match![2]);
    const months = category === "national" ? 1 : Number(ctx.match![3]);
    await askPriceStep(ctx, { field: "user", category, trafficGb, months });
  });

  bot.callbackQuery(/^cc:price:edit:([^:]+):(user|partner|wholesale)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const cell = await prisma.priceCell.findUnique({ where: { id: ctx.match![1] } });
    if (!cell) return;
    const field = ctx.match![2] as "user" | "partner" | "wholesale";
    await askPriceStep(ctx, {
      field,
      category: (cell.category as PlanCategory) || "data",
      trafficGb: cell.trafficGb,
      months: cell.months,
      cellId: cell.id,
      priceUser: cell.priceUser,
      pricePartner: cell.pricePartner,
    });
  });

  bot.callbackQuery(/^cc:price:gold:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const cell = await prisma.priceCell.findUnique({ where: { id: ctx.match![1] } });
    if (!cell) {
      await ctx.answerCallbackQuery({ text: "پیدا نشد", show_alert: true });
      return;
    }
    await setCellGolden(cell.id, !cell.isGolden);
    await ctx.answerCallbackQuery({ text: !cell.isGolden ? "⭐ پیشنهاد ویژه شد" : "از ویژه برداشته شد" });
    await showPriceDetail(ctx, cell.id);
  });

  bot.callbackQuery(/^cc:price:delask:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const id = ctx.match![1];
    await ctx.editMessageText("این پلن حذف شود؟", {
      reply_markup: new InlineKeyboard()
        .text("بله، حذف شود", `cc:price:del:${id}`)
        .danger()
        .row()
        .text("خیر، بازگشت", `cc:price:view:${id}`),
    });
  });

  bot.callbackQuery(/^cc:price:del:(.+)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery({ text: "حذف شد" });
    const cell = await prisma.priceCell.findUnique({ where: { id: ctx.match![1] } });
    await deactivateCell(ctx.match![1]);
    const cat = (cell?.isGolden ? "golden" : cell?.category || "data") as PlanCategory | "golden";
    await showPricingCategory(ctx, cat);
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

  bot.callbackQuery("cc:sales", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showSales(ctx, "today");
  });

  bot.callbackQuery(/^cc:sales:(today|week|month)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showSales(ctx, ctx.match![1] as SalesPeriod);
  });

  bot.callbackQuery("cc:search", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "search" });
    await ctx.reply(
      "🔍 جستجو کاربر / سفارش\n\nآی‌دی تلگرام، یوزرنیم (@user)، نام، یا بخشی از شناسه سفارش را بفرستید.\nلغو: /cancel",
    );
  });

  bot.callbackQuery("cc:audit", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    await showAudit(ctx);
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

  bot.callbackQuery("cc:guide", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const text = await getSetting("guide_text");
    const ios = await getSetting("guide_ios_url");
    const android = await getSetting("guide_android_url");
    const windows = await getSetting("guide_windows_url");
    const macos = await getSetting("guide_macos_url");
    const extra = await getSetting("guide_url");
    await ctx.editMessageText(
      [
        "📖 آموزش و لینک دانلود اپ‌ها",
        "",
        text.slice(0, 800),
        "",
        `🍎 iOS: ${ios || "—"}`,
        `🤖 Android: ${android || "—"}`,
        `🪟 Windows: ${windows || "—"}`,
        `💻 Mac: ${macos || "—"}`,
        extra ? `📎 بیشتر: ${extra}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text("✏️ ویرایش متن آموزش", "cc:guide:text")
          .primary()
          .row()
          .text("🍎 لینک آیفون", "cc:guide:url:ios")
          .text("🤖 اندروید", "cc:guide:url:android")
          .row()
          .text("🪟 ویندوز", "cc:guide:url:windows")
          .text("💻 مک", "cc:guide:url:macos")
          .row()
          .text("📎 لینک اضافه", "cc:guide:url:extra")
          .row()
          .text("« کنترل سنتر", "cc:home"),
      },
    );
  });

  bot.callbackQuery("cc:guide:text", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "guide_text" });
    await ctx.reply("متن کامل آموزش را بفرستید:\nلغو: /cancel");
  });

  bot.callbackQuery(/^cc:guide:url:(ios|android|windows|macos|extra)$/, async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const platform = ctx.match![1] as "ios" | "android" | "windows" | "macos" | "extra";
    ccWait.set(ctx.from!.id, { kind: "guide_url", platform });
    await ctx.reply(`لینک ${platform} را بفرستید (با https://):\nلغو: /cancel`);
  });

  bot.callbackQuery("cc:test", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const on = (await getSetting("test_service_enabled")) === "true";
    await ctx.editMessageText(
      [
        "🧪 سرویس تست",
        "",
        "هر کاربر تلگرام فقط یک‌بار می‌تواند اکانت تست بگیرد:",
        "• مدت: ۱ روز (از اولین اتصال)",
        "• حجم: ۲۵۰ مگابایت",
        "",
        `وضعیت فعلی: ${on ? "🟢 روشن" : "🔴 خاموش"}`,
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text(on ? "خاموش کردن" : "روشن کردن", "cc:test:tog")
          .row()
          .text("« کنترل سنتر", "cc:home"),
      },
    );
  });

  bot.callbackQuery("cc:test:tog", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const on = (await getSetting("test_service_enabled")) === "true";
    await setSetting("test_service_enabled", on ? "false" : "true");
    await ctx.answerCallbackQuery({ text: on ? "خاموش شد" : "روشن شد" });
    await ctx.editMessageText(
      `🧪 سرویس تست الان ${on ? "🔴 خاموش" : "🟢 روشن"} است.`,
      {
        reply_markup: new InlineKeyboard()
          .text(on ? "روشن کردن" : "خاموش کردن", "cc:test:tog")
          .row()
          .text("« کنترل سنتر", "cc:home"),
      },
    );
  });

  bot.callbackQuery("cc:iplimit", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const cur = await getSetting("default_limit_ip");
    await ctx.editMessageText(
      [
        "📱 محدودیت IP / تعداد دستگاه",
        "",
        "این مقدار پیش‌فرض برای کانفیگ‌های جدید است.",
        "۰ = نامحدود | مثلاً ۲ یعنی حداکثر ۲ دستگاه همزمان",
        "",
        `پیش‌فرض فعلی: ${cur === "0" ? "نامحدود" : `${cur} دستگاه`}`,
        "",
        "کاربر هنگام خرید می‌تواند با دکمه +/- تغییر دهد.",
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text("✏️ تغییر پیش‌فرض", "cc:iplimit:edit")
          .primary()
          .row()
          .text("« کنترل سنتر", "cc:home"),
      },
    );
  });

  bot.callbackQuery("cc:iplimit:edit", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "iplimit" });
    await ctx.reply("عدد محدودیت را بفرستید (۰ تا ۱۰):\n۰ = نامحدود\nلغو: /cancel");
  });

  bot.callbackQuery("cc:backup", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    const cfg = await getBackupConfig();
    const hh = String(cfg.hour).padStart(2, "0");
    const mm = String(cfg.minute).padStart(2, "0");
    const last = cfg.lastAt
      ? new Date(cfg.lastAt).toLocaleString("fa-IR")
      : "هنوز انجام نشده";
    await ctx.editMessageText(
      [
        "💾 پشتیبان دیتابیس",
        "",
        "فایل SQLite برای همه ادمین‌ها ارسال می‌شود.",
        "",
        `خودکار: ${cfg.enabled ? "🟢 روشن" : "🔴 خاموش"}`,
        `ساعت پشتیبان: ${hh}:${mm} (زمان سرور)`,
        `آخرین پشتیبان: ${last}`,
        cfg.lastStatus ? `وضعیت: ${cfg.lastStatus}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text("📤 دریافت الان", "cc:backup:now")
          .success()
          .row()
          .text(cfg.enabled ? "⏸ خاموش کردن خودکار" : "▶️ روشن کردن خودکار", "cc:backup:tog")
          .row()
          .text("⏰ تنظیم ساعت", "cc:backup:time")
          .primary()
          .row()
          .text("« کنترل سنتر", "cc:home"),
      },
    );
  });

  bot.callbackQuery("cc:backup:now", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery({ text: "در حال ساخت پشتیبان…" });
    await ctx.reply("⏳ در حال ساخت و ارسال فایل پشتیبان…");
    const r = await sendBackupToAdmins(ctx.api, {
      reason: "درخواست دستی از کنترل سنتر",
    });
    if (r.ok) {
      await auditLog({
        action: "backup_sent",
        actorTelegramId: ctx.from?.id,
        target: r.name,
        detail: `sent=${r.sent}`,
      });
      await ctx.reply(`✅ پشتیبان برای ${r.sent} ادمین ارسال شد\n${r.name}`);
    } else {
      await ctx.reply(`❌ خطا در پشتیبان:\n${r.error ?? "ارسال ناموفق"}`);
    }
  });

  bot.callbackQuery("cc:backup:tog", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    const cfg = await getBackupConfig();
    cfg.enabled = !cfg.enabled;
    await saveBackupConfig(cfg);
    await ctx.answerCallbackQuery({ text: cfg.enabled ? "خودکار روشن شد" : "خودکار خاموش شد" });
    // refresh panel
    const hh = String(cfg.hour).padStart(2, "0");
    const mm = String(cfg.minute).padStart(2, "0");
    await ctx.editMessageText(
      [
        "💾 پشتیبان دیتابیس",
        "",
        `خودکار: ${cfg.enabled ? "🟢 روشن" : "🔴 خاموش"}`,
        `ساعت پشتیبان: ${hh}:${mm} (زمان سرور)`,
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text("📤 دریافت الان", "cc:backup:now")
          .success()
          .row()
          .text(cfg.enabled ? "⏸ خاموش کردن خودکار" : "▶️ روشن کردن خودکار", "cc:backup:tog")
          .row()
          .text("⏰ تنظیم ساعت", "cc:backup:time")
          .primary()
          .row()
          .text("« کنترل سنتر", "cc:home"),
      },
    );
  });

  bot.callbackQuery("cc:backup:time", async (ctx) => {
    if (!(await isControlAdmin(ctx.from?.id))) return;
    await ctx.answerCallbackQuery();
    ccWait.set(ctx.from!.id, { kind: "backup_time" });
    await ctx.reply(
      "ساعت پشتیبان روزانه را بفرستید:\nفرمت: `HH:MM`\nمثال: `03:00` یا `23:30`\n(زمان محلی سرور)\nلغو: /cancel",
      { parse_mode: "Markdown" },
    );
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

  if (wait.kind === "search") {
    const result = await searchUsersAndOrders(text);
    await auditLog({
      action: "admin_search",
      actorTelegramId: tid,
      detail: text.slice(0, 80),
    });
    ccWait.delete(tid);
    await ctx.reply(formatSearchResults(result), {
      reply_markup: new InlineKeyboard()
        .text("🔍 جستجوی دیگر", "cc:search")
        .row()
        .text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "welcome") {
    await setSetting("welcome_text", text);
    ccWait.delete(tid);
    await ctx.reply("متن خوش‌آمد ذخیره شد ✅", {
      reply_markup: new InlineKeyboard().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "guide_text") {
    await setSetting("guide_text", text);
    ccWait.delete(tid);
    await ctx.reply("متن آموزش ذخیره شد ✅", {
      reply_markup: new InlineKeyboard().text("📖 آموزش", "cc:guide").row().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "guide_url") {
    if (!text.startsWith("http")) {
      await ctx.reply("لینک باید با http شروع شود.");
      return true;
    }
    const key =
      wait.platform === "extra"
        ? "guide_url"
        : wait.platform === "ios"
          ? "guide_ios_url"
          : wait.platform === "android"
            ? "guide_android_url"
            : wait.platform === "windows"
              ? "guide_windows_url"
              : "guide_macos_url";
    await setSetting(key, text.trim());
    ccWait.delete(tid);
    await ctx.reply("لینک ذخیره شد ✅", {
      reply_markup: new InlineKeyboard().text("📖 آموزش", "cc:guide").row().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "iplimit") {
    const n = Number(text.replace(/[^\d]/g, ""));
    if (Number.isNaN(n) || n < 0 || n > 10) {
      await ctx.reply("عدد بین ۰ تا ۱۰ بفرستید.");
      return true;
    }
    await setSetting("default_limit_ip", String(n));
    ccWait.delete(tid);
    await ctx.reply(`پیش‌فرض IP Limit: ${n === 0 ? "نامحدود" : `${n} دستگاه`} ✅`, {
      reply_markup: new InlineKeyboard().text("📱 IP Limit", "cc:iplimit").row().text("🎛 کنترل سنتر", "cc:home"),
    });
    return true;
  }

  if (wait.kind === "backup_time") {
    const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
      await ctx.reply("فرمت اشتباه. مثال: 03:00");
      return true;
    }
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) {
      await ctx.reply("ساعت نامعتبر (۰۰:۰۰ تا ۲۳:۵۹).");
      return true;
    }
    const cfg = await getBackupConfig();
    cfg.hour = hour;
    cfg.minute = minute;
    await saveBackupConfig(cfg);
    ccWait.delete(tid);
    await ctx.reply(
      `✅ ساعت پشتیبان ذخیره شد: ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      {
        reply_markup: new InlineKeyboard().text("💾 پشتیبان", "cc:backup").row().text("🎛 کنترل سنتر", "cc:home"),
      },
    );
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

  if (wait.kind === "rate_ask") {
    const amount = Number(text.replace(/[^\d]/g, ""));
    if (!amount || amount < 100) {
      await ctx.reply("مبلغ نامعتبر. حداقل ۱۰۰ تومان.\nمثال: 15000");
      return true;
    }
    const partial = structuredClone(wait.partial);
    partial[wait.role][wait.field] = amount;

    if (wait.field === "perGb") {
      ccWait.set(tid, { kind: "rate_ask", role: wait.role, field: "perMonth", partial });
      await ctx.reply(`✅ هر گیگ: ${formatToman(amount)}\n\nحالا نرخ هر ماه را بفرستید.\nمثال: 30000`);
      return true;
    }
    if (wait.field === "perMonth") {
      ccWait.set(tid, { kind: "rate_ask", role: wait.role, field: "unlimitedPerMonth", partial });
      await ctx.reply(
        `✅ هر ماه: ${formatToman(amount)}\n\nحالا قیمت نامحدود به‌ازای هر ماه را بفرستید.\nمثال: 1500000`,
      );
      return true;
    }

    await savePriceRates(partial);
    ccWait.delete(tid);
    const roleLabel =
      wait.role === "user" ? "مشتری" : wait.role === "partner" ? "همکار" : "عمده";
    await ctx.reply(`✅ نرخ‌های ${roleLabel} ذخیره شد.`, {
      reply_markup: new InlineKeyboard()
        .text("✏️ نرخ‌ها", "cc:pricing:rates")
        .row()
        .text("💰 قیمت‌گذاری", "cc:pricing"),
    });
    return true;
  }

  if (wait.kind === "price_ask") {
    const amount = parsePriceNumber(text);
    if (!amount) {
      await ctx.reply("قیمت نامعتبر است. فقط عدد تومان بفرستید (حداقل ۱۰۰۰).\nمثال: 330000");
      return true;
    }

    // Editing a single field on existing plan
    if (wait.cellId) {
      const cell = await prisma.priceCell.findUnique({ where: { id: wait.cellId } });
      if (!cell) {
        ccWait.delete(tid);
        await ctx.reply("پلن پیدا نشد.");
        return true;
      }
      const data =
        wait.field === "user"
          ? { priceUser: amount }
          : wait.field === "partner"
            ? { pricePartner: amount }
            : { priceWholesale: amount };
      await prisma.priceCell.update({ where: { id: cell.id }, data });
      ccWait.delete(tid);
      await ctx.reply(`✅ ذخیره شد: ${formatToman(amount)}`, {
        reply_markup: new InlineKeyboard()
          .text("👁 مشاهده پلن", `cc:price:view:${cell.id}`)
          .row()
          .text("💰 قیمت‌گذاری", "cc:pricing"),
      });
      return true;
    }

    // Creating new plan — collect 3 prices in sequence
    if (wait.field === "user") {
      ccWait.set(tid, { ...wait, field: "partner", priceUser: amount });
      await ctx.reply(
        [
          `✅ قیمت مشتری: ${formatToman(amount)}`,
          "",
          "حالا قیمت همکار را بفرستید (فقط عدد).",
          "مثال: 260000",
        ].join("\n"),
      );
      return true;
    }

    if (wait.field === "partner") {
      ccWait.set(tid, { ...wait, field: "wholesale", pricePartner: amount });
      await ctx.reply(
        [
          `✅ قیمت همکار: ${formatToman(amount)}`,
          "",
          "حالا قیمت عمده‌فروش را بفرستید (فقط عدد).",
          "مثال: 210000",
        ].join("\n"),
      );
      return true;
    }

    // wholesale — finalize
    const priceUser = wait.priceUser!;
    const pricePartner = wait.pricePartner!;
    const cell = await upsertPriceCell({
      trafficGb: wait.trafficGb,
      months: wait.months,
      priceUser,
      pricePartner,
      priceWholesale: amount,
      category: wait.trafficGb === null ? "unlimited" : wait.category,
    });
    ccWait.delete(tid);
    const againCb =
      wait.category === "data"
        ? `cc:price:newm:data:${wait.months}`
        : wait.category === "national"
          ? "cc:price:new:national"
          : `cc:price:new:${wait.category}`;
    const backCb =
      wait.category === "data" ? `cc:pricing:data:m:${wait.months}` : `cc:pricing:${wait.category}`;
    await ctx.reply(
      [
        "✅ پلن ذخیره شد",
        "",
        `📌 ${planTitle(cell.trafficGb, cell.months)}`,
        `👤 مشتری: ${formatToman(cell.priceUser)}`,
        `🤝 همکار: ${formatToman(cell.pricePartner)}`,
        `📦 عمده: ${formatToman(cell.priceWholesale)}`,
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text("👁 مشاهده پلن", `cc:price:view:${cell.id}`)
          .row()
          .text("➕ پلن دیگر", againCb)
          .success()
          .row()
          .text("« بازگشت", backCb)
          .row()
          .text("💰 قیمت‌گذاری", "cc:pricing"),
      },
    );
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
