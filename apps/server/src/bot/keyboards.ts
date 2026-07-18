import { InlineKeyboard, Keyboard } from "grammy";
import { matrixLine } from "../services/pricing.js";
import type { NotifConfig } from "../services/settings.js";
import { formatLimitIp } from "../services/panel-groups.js";
import { formatToman, formatTraffic } from "../utils/format.js";

/** Labels kept so old sticky reply-keyboard taps still work until removed */
export const BTN = {
  test: "🧪 سرویس تست",
  buy: "🛒 خرید سرویس جدید",
  renew: "♻️ تمدید سرویس",
  myServices: "📦 سرویس‌های من",
  wallet: "💳 کیف پول",
  account: "👤 حساب کاربری",
  national: "🇮🇷 کانفیگ نت ملی",
  support: "🆘 ارتباط با پشتیبانی",
  guide: "📖 آموزش اتصال",
  dashboard: "🚀 MiniApp Dashboard",
  partner: "🤝 درخواست نمایندگی فروش",
  admin: "👑 پنل ادمین",
  partnerPanel: "💼 پنل نماینده",
} as const;

/** Colored inline main menu (Bot API button styles) */
export function mainMenuInline(opts: {
  isAdmin: boolean;
  isPartner: boolean;
  isWholesale?: boolean;
  miniappUrl?: string;
}) {
  const kb = new InlineKeyboard()
    .text("🛒 خرید سرویس جدید", "m:buy")
    .success()
    .text("🇮🇷 کانفیگ نت ملی", "m:national")
    .success()
    .row()
    .text("♻️ تمدید سرویس", "m:renew")
    .text("📦 سرویس‌های من", "m:myservices")
    .row()
    .text("💰 اعتبار من", "m:wallet")
    .text("👤 حساب من", "m:account")
    .row()
    .text("💡 آموزش استفاده", "m:guide")
    .text("🆘 پشتیبانی", "m:support")
    .row()
    .text("🧪 سرویس تست", "m:test")
    .text("👥 معرفی به دوستان", "m:referral")
    .row();

  if (opts.miniappUrl) {
    kb.webApp("🚀 MiniApp Dashboard", opts.miniappUrl).primary().row();
  } else {
    kb.text("🚀 MiniApp Dashboard", "m:dashboard").primary().row();
  }

  // Only regular users can request agency (not partner / wholesale / admin)
  const canRequestAgency = !opts.isAdmin && !opts.isPartner && !opts.isWholesale;
  if (canRequestAgency) {
    kb.text("🤝 درخواست نمایندگی", "m:partner").danger().row();
  }

  if (opts.isPartner || opts.isWholesale) {
    kb.text("💼 پنل نماینده / عمده", "m:partnerpanel").primary().row();
  }
  if (opts.isAdmin) {
    kb.text("🎛 کنترل سنتر ادمین", "cc:home").danger().row();
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
}) {
  const vol = opts.unlimited ? "نامحدود 💎" : formatTraffic(opts.trafficGb);
  const unit = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  const total =
    opts.price === null || opts.quantity <= 1
      ? ""
      : ` · جمع ${formatToman(opts.price * opts.quantity)}`;
  const cat =
    opts.category === "national" ? "🇮🇷 ملی" : opts.category === "unlimited" ? "💎 نامحدود" : "📦 دیتا";

  const kb = new InlineKeyboard()
    .text("−", "wiz:vol:-")
    .text(`📦 ${vol}`, "wiz:noop")
    .text("+", "wiz:vol:+")
    .row();

  if (opts.category === "national") {
    kb.text(`⏳ ۱ ماهه`, "wiz:noop").row();
  } else {
    kb.text("−", "wiz:mon:-")
      .text(`⏳ ${opts.months} ماه`, "wiz:noop")
      .text("+", "wiz:mon:+")
      .row();
  }

  return kb
    .text("−", "wiz:qty:-")
    .text(`🔢 ${opts.quantity}${opts.quantity > 1 ? " عمده" : ""}`, "wiz:noop")
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
    .text("« بازگشت", "menu:home");
}

export function payMethodKeyboard(orderId: string, walletBalance: number) {
  return new InlineKeyboard()
    .text("💳 کارت‌به‌کارت", `pay:card:${orderId}`)
    .primary()
    .row()
    .text(`👛 کیف پول (${walletBalance.toLocaleString("fa-IR")})`, `pay:wallet:${orderId}`)
    .success()
    .row()
    .text("❌ انصراف", `cancel:${orderId}`)
    .danger();
}

export function payConfirmKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ پرداخت کردم — ارسال رسید", `paid:${orderId}`)
    .success()
    .row()
    .text("❌ انصراف", `cancel:${orderId}`)
    .danger();
}

export function walletMenuKeyboard() {
  return new InlineKeyboard()
    .text("➕ شارژ کیف پول", "wallet:charge")
    .success()
    .row()
    .text("« بازگشت", "menu:home");
}

export function walletChargeAmountsKeyboard() {
  const kb = new InlineKeyboard();
  for (const amount of [100_000, 200_000, 500_000, 1_000_000]) {
    kb.text(`${amount.toLocaleString("fa-IR")}`, `wallet:amt:${amount}`).row();
  }
  kb.text("✍️ مبلغ دلخواه", "wallet:amt:custom").row();
  kb.text("« بازگشت", "menu:home");
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
  return new InlineKeyboard()
    .text("🔗 لینک ساب", `sub:link:${subId}`)
    .text("📱 QR", `sub:qr:${subId}`)
    .row()
    .text("♻️ تمدید", `sub:renew:${subId}`)
    .success()
    .row()
    .text("🔄 تغییر ساب", `sub:rotsub:${subId}`)
    .text("🔑 تغییر کانفیگ", `sub:rotuuid:${subId}`);
}

export function renewPickKeyboard(subs: Array<{ id: string; code: string }>) {
  const kb = new InlineKeyboard();
  for (const s of subs.slice(0, 12)) {
    kb.text(`♻️ ${s.code}`, `sub:renew:${s.id}`).row();
  }
  kb.text("« بازگشت", "menu:home");
  return kb;
}

export function renewWizardKeyboard(opts: {
  subId: string;
  months: number;
  price: number | null;
}) {
  const priceLabel = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  return new InlineKeyboard()
    .text("−", `renew:mon:${opts.subId}:-`)
    .text(`⏳ ${opts.months} ماه`, "wiz:noop")
    .text("+", `renew:mon:${opts.subId}:+`)
    .row()
    .text(`💰 ${priceLabel}`, "wiz:noop")
    .row()
    .text("✅ تأیید و پرداخت تمدید", `renew:checkout:${opts.subId}`)
    .success()
    .row()
    .text("« بازگشت", "menu:home");
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
  kb.text("« بازگشت", "menu:home");
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
  return [
    qty > 1 ? "🛒 خرید عمده (Bulk)" : "🛒 خرید سرویس جدید",
    opts.category === "national" ? "🇮🇷 کانفیگ نت ملی — فقط ۱ ماهه · حجم از ۱ گیگ" : "",
    "",
    matrixLine(opts.trafficGb, opts.months, opts.price, qty),
    `📱 محدودیت دستگاه: ${formatLimitIp(opts.limitIp)}`,
    "",
    `نام پایه اکانت: ${opts.accountMode === "custom" && opts.accountName ? opts.accountName : "رندوم (بعد از تأیید)"}`,
    qty > 1 ? `⚠️ تعداد ${qty} اکانت در پنل سنایی ساخته می‌شود.` : "",
    "",
    opts.category === "national"
      ? "حجم را با +/− تنظیم کنید، سپس ادامه خرید را بزنید."
      : "حجم، مدت، تعداد و IP Limit را تنظیم کنید، سپس ادامه خرید را بزنید.",
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
    `شماره کارت: \`${card.number}\``,
    `به نام: ${card.holder}`,
    "",
    "پس از واریز، روی دکمه زیر بزنید و عکس رسید را بفرستید.",
    `کد سفارش: \`${orderId.slice(-8)}\``,
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
    .text("📖 آموزش و دانلود اپ", "cc:guide")
    .row()
    .text("🧪 سرویس تست", "cc:test")
    .text("📱 IP Limit", "cc:iplimit")
    .row()
    .text("👑 ادمین‌ها", "cc:admins")
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
    .text("📋 سفارش‌های باز", "cc:pending")
    .primary()
    .row()
    .text("💾 پشتیبان دیتابیس", "cc:backup")
    .success()
    .row()
    .text("« منوی اصلی", "menu:home");
}
