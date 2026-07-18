import { InlineKeyboard, Keyboard } from "grammy";
import { matrixLine } from "../services/pricing.js";
import { formatToman, formatTraffic } from "../utils/format.js";

/** Reply keyboard labels (Telegram has no button colors — emojis provide visual identity) */
export const BTN = {
  test: "🧪 سرویس تست",
  buy: "🛒 خرید سرویس جدید",
  renew: "♻️ تمدید سرویس",
  myServices: "📦 سرویس‌های من",
  wallet: "💳 کیف پول",
  account: "👤 حساب کاربری",
  national: "🇮🇷 سرویس ویژه اینترنت ملی",
  support: "🆘 ارتباط با پشتیبانی",
  guide: "📖 آموزش اتصال",
  dashboard: "🚀 ورود به داشبورد",
  partner: "🤝 درخواست نمایندگی فروش",
  admin: "👑 پنل ادمین",
  partnerPanel: "💼 پنل نماینده",
} as const;

export function mainMenuKeyboard(isAdmin: boolean, isPartner: boolean) {
  const rows: string[][] = [
    [BTN.test, BTN.buy],
    [BTN.renew, BTN.myServices],
    [BTN.wallet, BTN.account],
    [BTN.national],
    [BTN.support, BTN.guide],
    [BTN.dashboard],
    [BTN.partner],
  ];
  if (isPartner) rows.push([BTN.partnerPanel]);
  if (isAdmin) rows.push([BTN.admin]);
  return Keyboard.from(rows).resized().persistent();
}

export function buyWizardKeyboard(opts: {
  trafficGb: number | null;
  months: number;
  unlimited: boolean;
  price: number | null;
}) {
  const vol = opts.unlimited ? "نامحدود 💎" : formatTraffic(opts.trafficGb);
  const priceLabel = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  return new InlineKeyboard()
    .text("➖", "wiz:vol:-")
    .text(`📦 ${vol}`, "wiz:noop")
    .text("➕", "wiz:vol:+")
    .row()
    .text("➖", "wiz:mon:-")
    .text(`⏳ ${opts.months} ماه`, "wiz:noop")
    .text("➕", "wiz:mon:+")
    .row()
    .text(`💰 ${priceLabel}`, "wiz:noop")
    .row()
    .text("🎲 نام رندوم", "wiz:name:random")
    .text("✍️ نام دلخواه", "wiz:name:custom")
    .row()
    .text("✅ ادامه خرید", "wiz:checkout")
    .row()
    .text("« بازگشت", "menu:home");
}

export function payMethodKeyboard(orderId: string, walletBalance: number) {
  return new InlineKeyboard()
    .text("💳 کارت‌به‌کارت", `pay:card:${orderId}`)
    .row()
    .text(`👛 کیف پول (${walletBalance.toLocaleString("fa-IR")})`, `pay:wallet:${orderId}`)
    .row()
    .text("❌ انصراف", `cancel:${orderId}`);
}

export function payConfirmKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ پرداخت کردم — ارسال رسید", `paid:${orderId}`)
    .row()
    .text("❌ انصراف", `cancel:${orderId}`);
}

export function walletMenuKeyboard() {
  return new InlineKeyboard()
    .text("➕ شارژ کیف پول", "wallet:charge")
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
    .row()
    .text("❌ رد سفارش", `adm:no:${orderId}`);
}

export function partnerRequestKeyboard(requestId: string) {
  return new InlineKeyboard()
    .text("✅ تأیید نماینده", `prt:ok:${requestId}`)
    .text("❌ رد", `prt:no:${requestId}`);
}

export function subscriptionKeyboard(subId: string) {
  return new InlineKeyboard()
    .text("🔗 لینک ساب", `sub:link:${subId}`)
    .text("📱 QR", `sub:qr:${subId}`)
    .row()
    .text("♻️ تمدید", `sub:renew:${subId}`)
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

export function buyDraftText(opts: {
  trafficGb: number | null;
  months: number;
  price: number | null;
  accountMode: string;
  accountName?: string | null;
}) {
  return [
    "🛒 خرید سرویس جدید",
    "",
    matrixLine(opts.trafficGb, opts.months, opts.price),
    "",
    `نام اکانت: ${opts.accountMode === "custom" && opts.accountName ? opts.accountName : "رندوم (بعد از تأیید)"}`,
    "",
    "حجم و مدت را تنظیم کنید، سپس ادامه خرید را بزنید.",
  ].join("\n");
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
