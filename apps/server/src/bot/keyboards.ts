import { InlineKeyboard, Keyboard } from "grammy";
import { matrixLine } from "../services/pricing.js";
import { formatToman, formatTraffic } from "../utils/format.js";

export function mainMenuKeyboard(isAdmin: boolean, isPartner: boolean) {
  const rows = [
    ["🛒 خرید اشتراک", "📦 سرویس‌های من"],
    ["🤝 همکاری", "☎️ پشتیبانی"],
  ];
  if (isPartner) rows.push(["💼 پنل همکار"]);
  if (isAdmin) rows.push(["👑 پنل ادمین"]);
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

export function payConfirmKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ پرداخت کردم — ارسال رسید", `paid:${orderId}`)
    .row()
    .text("❌ انصراف", `cancel:${orderId}`);
}

export function adminOrderKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ تأیید و ساخت/اعمال", `adm:ok:${orderId}`)
    .row()
    .text("❌ رد سفارش", `adm:no:${orderId}`);
}

export function partnerRequestKeyboard(requestId: string) {
  return new InlineKeyboard()
    .text("✅ تأیید همکار", `prt:ok:${requestId}`)
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

export function buyDraftText(opts: {
  trafficGb: number | null;
  months: number;
  price: number | null;
  accountMode: string;
  accountName?: string | null;
}) {
  return [
    "🛒 خرید اشتراک",
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
