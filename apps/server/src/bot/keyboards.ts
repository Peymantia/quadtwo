import { InlineKeyboard, Keyboard } from "grammy";
import { matrixLine } from "../services/pricing.js";
import type { NotifConfig, SalesCategories } from "../services/settings.js";
import { formatLimitIp } from "../services/panel-groups.js";
import { formatCardNumberDisplay, formatToman, formatTraffic, ltrIsolate } from "../utils/format.js";
import type { PlanCategory } from "../services/pricing.js";

/** Reply-keyboard labels — must match bot.hears() exactly */
export const BTN = {
  buy: "🛒 خرید سرویس جدید",
  renew: "♻️ تمدید سرویس",
  myServices: "📦 سرویس‌های من",
  wallet: "💰 کیف پول من",
  account: "👤 حساب من",
  guide: "💡 آموزش استفاده",
  support: "🆘 پشتیبانی",
  test: "🧪 دریافت سرویس تست",
  dashboard: "🌐 داشبورد وب",
  dashOtp: "🔐 ورود به داشبورد وب اپ",
  configLookup: "🔎 مشخصات کانفیگ",
  partner: "🤝 درخواست نمایندگی",
  allConfigs: "📋 نمایش کلیه کانفیگ‌ها",
  /** @deprecated not on main menu */
  partnerPanel: "💼 پنل نماینده / عمده",
  agentPanel: "💼 مشخصات نماینده",
  controlCenter: "🎛 کنترل سنتر ادمین",
  /** @deprecated legacy */
  referral: "👥 معرفی به دوستان",
  national: "🇮🇷 کانفیگ نت ملی",
  admin: "👑 پنل ادمین",
} as const;

export type MainMenuOpts = {
  isAdmin: boolean;
  isPartner: boolean;
  isWholesale?: boolean;
  miniappUrl?: string;
};

/** Sticky reply keyboard at bottom (main menu) */
export function mainMenuReply(opts: MainMenuOpts) {
  const isAgent = opts.isPartner || opts.isWholesale || opts.isAdmin;
  const kb = new Keyboard()
    .text(BTN.buy)
    .success()
    .row()
    .text(BTN.myServices)
    .text(BTN.renew)
    .row()
    .text(BTN.account)
    .text(BTN.wallet)
    .row()
    .text(BTN.test)
    .text(BTN.guide)
    .row();

  if (opts.isAdmin) {
    kb.text(BTN.allConfigs).text(BTN.support).row();
  } else if (isAgent) {
    kb.text(BTN.support).row();
  } else {
    kb.text(BTN.partner).text(BTN.support).row();
  }

  if (isAgent) {
    kb.text(BTN.agentPanel).primary().text(BTN.configLookup).danger().row();
  } else {
    kb.text(BTN.configLookup).danger().row();
  }
  kb.text(BTN.dashOtp).row();

  if (opts.isAdmin) {
    kb.text(BTN.controlCenter).danger().row();
  }

  return kb.persistent().resized();
}

/** Inline category picker inside buy flow */
export function buyCategoryKeyboard(enabled: SalesCategories) {
  const kb = new InlineKeyboard();
  if (enabled.data) {
    kb.text("💎 سرویس VIP بین الملل", "buy:cat:data").success().row();
  }
  if (enabled.national) {
    kb.text("🇮🇷 کانفیگ نت ملی", "buy:cat:national").success().row();
  }
  if (enabled.unlimited) {
    kb.text("💎 سرویس نامحدود", "buy:cat:unlimited").primary().row();
  }
  kb.text("« انصراف", "buy:cat:cancel");
  return kb;
}

/** @deprecated inline main menu — use mainMenuReply */
export function mainMenuInline(opts: MainMenuOpts) {
  const kb = new InlineKeyboard()
    .text(BTN.buy, "m:buy")
    .success()
    .row()
    .text(BTN.myServices, "m:myservices")
    .text(BTN.renew, "m:renew")
    .row()
    .text(BTN.account, "m:account")
    .text(BTN.wallet, "m:wallet")
    .row()
    .text(BTN.test, "m:test")
    .text(BTN.guide, "m:guide")
    .row();

  if (opts.isAdmin) {
    kb.text(BTN.allConfigs, "m:configs").text(BTN.support, "m:support").row();
  } else {
    kb.text(BTN.partner, "m:partner").text(BTN.support, "m:support").row();
  }

  if (opts.isAdmin || opts.isPartner || opts.isWholesale) {
    kb.text(BTN.agentPanel, "m:partnerpanel").primary().text(BTN.configLookup, "m:cfglookup").danger().row();
  } else {
    kb.text(BTN.configLookup, "m:cfglookup").danger().row();
  }
  kb.text(BTN.dashOtp, "m:dashotp").row();

  if (opts.isAdmin) {
    kb.text(BTN.controlCenter, "cc:home").danger().row();
  }
  return kb;
}

export function partnerContactKeyboard() {
  return new Keyboard().requestContact("📱 ارسال شماره موبایل").resized().oneTime();
}

export function buyWizardKeyboard(opts: {
  trafficGb: number | null;
  months: number;
  unlimited: boolean;
  quantity: number;
  limitIp: number;
  price: number | null;
  category?: string;
  maxMonths?: number;
}) {
  const vol = opts.unlimited ? "نامحدود 💎" : formatTraffic(opts.trafficGb);
  const unit = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  const total =
    opts.price === null || opts.quantity <= 1
      ? ""
      : ` · جمع ${formatToman(opts.price * opts.quantity)}`;
  const cat =
    opts.category === "national" ? "🇮🇷 ملی" : opts.category === "unlimited" ? "💎 نامحدود" : "💎 VIP بین الملل";
  const maxMonths = opts.maxMonths ?? 1;
  const showMonthStepper = maxMonths > 1 && opts.category !== "national";

  const kb = new InlineKeyboard()
    .text("−", "wiz:vol:-")
    .text(`📦 ${vol}`, "wiz:noop")
    .text("+", "wiz:vol:+")
    .row();

  if (showMonthStepper) {
    kb.text("−", "wiz:mon:-")
      .text(`⏳ ${opts.months} ماه`, "wiz:noop")
      .text("+", "wiz:mon:+")
      .row();
  } else {
    kb.text(`⏳ ۱ ماهه`, "wiz:noop").row();
  }

  return kb
    .text("−", "wiz:qty:-")
    .text(`${opts.quantity} عدد`, "wiz:noop")
    .text("+", "wiz:qty:+")
    .row()
    .text("−", "wiz:ip:-")
    .text(`📱 ${formatLimitIp(opts.limitIp)}`, "wiz:noop")
    .text("+", "wiz:ip:+")
    .row()
    .text(`🏷 ${cat}`, "wiz:noop")
    .row()
    .text(`💰 ${unit}${total}`, "wiz:noop")
    .row()
    .text("🎲 نام رندوم", "wiz:name:random")
    .text("✍️ نام دلخواه", "wiz:name:custom")
    .row()
    .text("✅ ادامه خرید", "wiz:checkout")
    .success()
    .row()
    .text("« بازگشت", "buy:back:cat")
    .text("❌ انصراف", "buy:cat:cancel");
}

export function salesCategoriesAdminKeyboard(cats: SalesCategories) {
  const on = (v: boolean) => (v ? "🟢" : "🔴");
  return new InlineKeyboard()
    .text(`${on(cats.data)} VIP بین الملل`, "cc:sales:cat:tog:data")
    .row()
    .text(`${on(cats.national)} نت ملی`, "cc:sales:cat:tog:national")
    .row()
    .text(`${on(cats.unlimited)} نامحدود`, "cc:sales:cat:tog:unlimited")
    .row()
    .text("« کنترل سنتر", "cc:home");
}

export function salesCategoriesAdminText(cats: SalesCategories, maxMonths: number) {
  const on = (v: boolean) => (v ? "فعال 🟢" : "غیرفعال 🔴");
  return [
    "🏷 دسته‌های فروش",
    "",
    "دسته‌هایی که کاربر در «خرید سرویس» می‌بیند:",
    "",
    `💎 VIP بین الملل: ${on(cats.data)}`,
    `🇮🇷 نت ملی: ${on(cats.national)}`,
    `💎 نامحدود: ${on(cats.unlimited)}`,
    "",
    `⏳ حداکثر مدت خرید/تمدید: ${maxMonths} ماه`,
    "",
    "روی هر مورد بزنید تا روشن/خاموش شود.",
  ].join("\n");
}

export function payMethodKeyboard(orderId: string, walletBalance: number) {
  return new InlineKeyboard()
    .text("💳 کارت‌به‌کارت", `pay:card:${orderId}`)
    .primary()
    .row()
    .text(`👛 کیف پول (${walletBalance.toLocaleString("fa-IR")})`, `pay:wallet:${orderId}`)
    .success()
    .row()
    .text("« بازگشت", `pay:back:${orderId}`)
    .text("❌ انصراف", `cancel:${orderId}`)
    .danger();
}

export function payConfirmKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ پرداخت کردم — ارسال رسید", `paid:${orderId}`)
    .success()
    .row()
    .text("« بازگشت", `pay:method:${orderId}`)
    .text("❌ انصراف", `cancel:${orderId}`)
    .danger();
}

export function walletMenuKeyboard() {
  return new InlineKeyboard()
    .text("➕ شارژ کیف پول", "wallet:charge")
    .success()
    .row()
    .text("« انصراف", "buy:cat:cancel");
}

export function walletChargeAmountsKeyboard() {
  const kb = new InlineKeyboard();
  for (const amount of [100_000, 200_000, 500_000, 1_000_000]) {
    kb.text(`${amount.toLocaleString("fa-IR")}`, `wallet:amt:${amount}`).row();
  }
  kb.text("✍️ مبلغ دلخواه", "wallet:amt:custom").row();
  kb.text("« بازگشت", "wallet:back").text("❌ انصراف", "buy:cat:cancel");
  return kb;
}

export function adminOrderKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ تأیید و ساخت/اعمال", `adm:ok:${orderId}`)
    .success()
    .row()
    .text("❌ رد سفارش", `adm:no:${orderId}`)
    .danger();
}

export function partnerRequestKeyboard(requestId: string) {
  return new InlineKeyboard()
    .text("✅ همکار", `prt:ok:${requestId}`)
    .success()
    .text("📦 عمده‌فروش", `prt:wh:${requestId}`)
    .primary()
    .row()
    .text("❌ رد", `prt:no:${requestId}`)
    .danger();
}

export function subscriptionKeyboard(subId: string) {
  return subscriptionDetailKeyboard({ subId, canRenew: true });
}

export function myServicesListKeyboard(opts: {
  items: Array<{ id: string; label: string }>;
  page: number;
  pages: number;
  hasQuery: boolean;
}) {
  const kb = new InlineKeyboard();
  kb.text("🔍 جستجو", "mysvc:search").row();
  if (opts.hasQuery) {
    kb.text("✖️ پاک کردن فیلتر", "mysvc:clear").row();
  }
  for (let i = 0; i < opts.items.length; i += 2) {
    const a = opts.items[i]!;
    const b = opts.items[i + 1];
    if (b) {
      kb.text(a.label, `mysvc:open:${a.id}`).text(b.label, `mysvc:open:${b.id}`).row();
    } else {
      kb.text(a.label, `mysvc:open:${a.id}`).row();
    }
  }
  if (opts.pages > 1) {
    if (opts.page > 0) kb.text("◀️ قبلی", `mysvc:page:${opts.page - 1}`);
    kb.text(`${opts.page + 1}/${opts.pages}`, "wiz:noop");
    if (opts.page < opts.pages - 1) kb.text("بعدی ▶️", `mysvc:page:${opts.page + 1}`);
    kb.row();
  }
  kb.text("« بستن", "buy:cat:cancel");
  return kb;
}

export function subscriptionDetailKeyboard(opts: {
  subId: string;
  panelEnabled?: boolean | null;
  canRenew?: boolean;
}) {
  const kb = new InlineKeyboard()
    .text("🔗 لینک ساب", `sub:link:${opts.subId}`)
    .text("📱 QR Code", `sub:qr:${opts.subId}`)
    .row();

  if (opts.canRenew !== false) {
    kb.text("♻️ تمدید سرویس", `sub:renew:${opts.subId}`).success().row();
  }

  kb.text("🔄 تغییر لینک ساب", `sub:rotsub:${opts.subId}`)
    .text("🔑 تغییر لینک کانفیگ", `sub:rotuuid:${opts.subId}`)
    .row();

  if (opts.panelEnabled === false) {
    kb.text("فعال 🟢", `sub:toggle:${opts.subId}`).success().row();
  } else if (opts.panelEnabled === true) {
    kb.text("غیر فعال 🔴", `sub:toggle:${opts.subId}`).danger().row();
  } else {
    kb.text("فعال 🟢 / غیر فعال 🔴", `sub:toggle:${opts.subId}`).row();
  }

  kb.text("📝 یادداشت", `sub:note:${opts.subId}`).row();
  kb.text("« بازگشت به لیست", "mysvc:list");
  return kb;
}

export function renewPickKeyboard(subs: Array<{ id: string; code: string; email?: string }>) {
  const kb = new InlineKeyboard();
  for (const s of subs.slice(0, 12)) {
    const label = (s.email || s.code).slice(0, 28);
    kb.text(`♻️ ${label}`, `sub:renew:${s.id}`).row();
  }
  kb.text("« انصراف", "buy:cat:cancel");
  return kb;
}

export function renewWizardKeyboard(opts: {
  subId: string;
  months: number;
  trafficGb: number | null;
  unlimited: boolean;
  price: number | null;
  maxMonths?: number;
  category?: string;
}) {
  const priceLabel = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  const maxMonths = opts.maxMonths ?? 1;
  const vol = opts.unlimited ? "نامحدود 💎" : formatTraffic(opts.trafficGb);
  const showMonthStepper = maxMonths > 1 && opts.category !== "national";

  const kb = new InlineKeyboard();

  if (opts.category === "unlimited") {
    kb.text(`📦 ${vol}`, "wiz:noop").row();
  } else {
    kb.text("−", `renew:vol:${opts.subId}:-`)
      .text(`📦 ${vol}`, "wiz:noop")
      .text("+", `renew:vol:${opts.subId}:+`)
      .row();
  }

  if (showMonthStepper) {
    kb.text("−", `renew:mon:${opts.subId}:-`)
      .text(`⏳ ${opts.months} ماه`, "wiz:noop")
      .text("+", `renew:mon:${opts.subId}:+`)
      .row();
  } else {
    kb.text(`⏳ ۱ ماهه`, "wiz:noop").row();
  }

  return kb
    .text(`💰 ${priceLabel}`, "wiz:noop")
    .row()
    .text("✅ تأیید و پرداخت تمدید", `renew:checkout:${opts.subId}`)
    .success()
    .row()
    .text("« بازگشت", "renew:back")
    .text("❌ انصراف", "buy:cat:cancel");
}

export function guideKeyboard(urls: {
  ios?: string;
  android?: string;
  windows?: string;
  macos?: string;
  extra?: string;
}) {
  const kb = new InlineKeyboard();
  if (urls.ios) kb.url("🍎 آیفون (iOS)", urls.ios);
  if (urls.android) kb.url("🤖 اندروید", urls.android);
  if (urls.ios || urls.android) kb.row();
  if (urls.windows) kb.url("🪟 ویندوز", urls.windows);
  if (urls.macos) kb.url("💻 مک", urls.macos);
  if (urls.windows || urls.macos) kb.row();
  if (urls.extra) kb.url("📎 لینک آموزش بیشتر", urls.extra).row();
  kb.text("« انصراف", "buy:cat:cancel");
  return kb;
}

export function buyDraftText(opts: {
  trafficGb: number | null;
  months: number;
  price: number | null;
  quantity: number;
  limitIp: number;
  accountMode: string;
  accountName?: string | null;
  category?: string;
}) {
  const qty = opts.quantity ?? 1;
  const catLabel =
    opts.category === "national"
      ? "🇮🇷 کانفیگ نت ملی"
      : opts.category === "unlimited"
        ? "💎 نامحدود"
        : "💎 VIP بین الملل";
  return [
    qty > 1 ? "🛒 خرید عمده (Bulk)" : "🛒 خرید سرویس",
    catLabel,
    opts.category === "national" ? "فقط ۱ ماهه · حجم از ۱ گیگ" : "مدت: ۱ ماهه",
    "",
    matrixLine(opts.trafficGb, opts.months, opts.price, qty),
    `📱 محدودیت کاربر: ${formatLimitIp(opts.limitIp)}`,
    "",
    `نام پایه اکانت: ${opts.accountMode === "custom" && opts.accountName ? opts.accountName : "رندوم (بعد از تأیید)"}`,
    qty > 1 ? `⚠️ تعداد ${qty} اکانت در پنل سنایی ساخته می‌شود.` : "",
    "",
    "حجم و تنظیمات را انتخاب کنید، سپس «ادامه خرید» را بزنید.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function orderPayText(summary: string, card: { number: string; holder: string }, orderId: string) {
  return [
    "✅ سفارش ثبت شد",
    "",
    summary,
    "",
    "💳 کارت‌به‌کارت",
    `شماره کارت: ${formatCardNumberDisplay(card.number)}`,
    `به نام: ${card.holder}`,
    "",
    "پس از واریز، روی دکمه زیر بزنید و عکس رسید را بفرستید.",
    `کد سفارش: ${ltrIsolate(orderId.slice(-8))}`,
  ].join("\n");
}

export function notifSettingsText(cfg: NotifConfig) {
  const on = (v: boolean) => (v ? "🟢 روشن" : "🔴 خاموش");
  return [
    "🔔 تنظیمات اعلان‌ها",
    "",
    "هر کدوم از این چهار نوع اعلان رو می‌تونی جداگانه روشن/خاموش کنی. برای دو مورد اول می‌تونی آستانه‌ی هشدار رو هم تغییر بدی (مثلاً ۷۲ ساعت قبل از اتمام به جای ۲۴ ساعت).",
    "",
    "📅 اتمام روز",
    `  • وضعیت: ${on(cfg.expiryDays.enabled)}`,
    `  • هشدار: پیش‌فرض (${cfg.expiryDays.hours} ساعت) قبل از انقضا`,
    "",
    "📦 اتمام حجم",
    `  • وضعیت: ${on(cfg.traffic.enabled)}`,
    `  • هشدار: پیش‌فرض (${cfg.traffic.megabytes} مگابایت) باقی‌مانده`,
    "",
    "⚠️ هشدار قبل از حذف",
    `  • وضعیت: ${on(cfg.preDelete.enabled)}`,
    `  • ~${cfg.preDelete.hours} ساعت قبل از حذف خودکار سرویس از پنل`,
    "",
    "🗑 حذف نهایی سرویس",
    `  • وضعیت: ${on(cfg.deleted.enabled)}`,
    "  • اعلان وقتی سرویس واقعاً از پنل پاک شد",
  ].join("\n");
}

export function notifSettingsKeyboard(cfg: NotifConfig) {
  const d = (v: boolean) => (v ? "🟢" : "🔴");
  return new InlineKeyboard()
    .text(`📅 اتمام روز: ${d(cfg.expiryDays.enabled)}`, "cc:notif:tog:expiryDays")
    .text("⏰ آستانه", "cc:notif:thr:expiryDays")
    .row()
    .text(`📦 اتمام حجم: ${d(cfg.traffic.enabled)}`, "cc:notif:tog:traffic")
    .text("📏 آستانه", "cc:notif:thr:traffic")
    .row()
    .text(`⚠️ هشدار قبل از حذف: ${d(cfg.preDelete.enabled)}`, "cc:notif:tog:preDelete")
    .row()
    .text(`🗑 حذف نهایی: ${d(cfg.deleted.enabled)}`, "cc:notif:tog:deleted")
    .row()
    .text("« کنترل سنتر", "cc:home");
}

export function controlCenterKeyboard() {
  return new InlineKeyboard()
    .text("📝 متن خوش‌آمد", "cc:welcome")
    .primary()
    .row()
    .text("📢 کانال‌های اجباری", "cc:channels")
    .row()
    .text("💰 قیمت‌گذاری اشتراک‌ها", "cc:pricing")
    .success()
    .row()
    .text("🏷 دسته‌های فروش", "cc:sales:cat")
    .primary()
    .row()
    .text("📖 آموزش و دانلود اپ", "cc:guide")
    .row()
    .text("🧪 دریافت سرویس تست", "cc:test")
    .text("📱 محدودیت کاربر", "cc:iplimit")
    .row()
    .text("👑 ادمین‌ها", "cc:admins")
    .text("🏷 نام نماینده من", "agent:set")
    .row()
    .text("🆘 پشتیبانی", "cc:support")
    .text("🔔 اعلان‌ها", "cc:notifs")
    .row()
    .text("📊 گزارش فروش", "cc:sales")
    .success()
    .row()
    .text("📊 گزارش همکاران", "cc:rep:partner")
    .text("📊 گزارش عمده", "cc:rep:wholesale")
    .row()
    .text("🔍 جستجو کاربر/سفارش", "cc:search")
    .primary()
    .row()
    .text("📜 لاگ عملیات", "cc:audit")
    .row()
    .text("⬇️ تنزل به کاربر عادی", "cc:demote")
    .danger()
    .row()
    .text("💳 کارت بانکی", "cc:card")
    .text("📡 Inbounds", "cc:inbounds")
    .row()
    .text("🖥 سرورهای پنل", "cc:panels")
    .primary()
    .row()
    .text("📥 ورود از اکسل", "cc:import")
    .success()
    .row()
    .text("📋 سفارش‌های باز", "cc:pending")
    .primary()
    .row()
    .text("💾 پشتیبان دیتابیس", "cc:backup")
    .success()
    .row()
    .text("« منوی اصلی", "menu:home");
}
