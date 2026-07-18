import { InlineKeyboard, Keyboard } from "grammy";
import type { Plan, User } from "@prisma/client";
import { priceForUser } from "../services/users.js";
import { formatDuration, formatToman, formatTraffic } from "../utils/format.js";

export function mainMenuKeyboard(isAdmin: boolean) {
  const rows = [
    ["🛒 خرید اشتراک", "📄 اشتراک‌های من"],
    ["💳 کیف پول", "☎️ پشتیبانی"],
  ];
  if (isAdmin) rows.push(["👑 پنل ادمین"]);
  return Keyboard.from(rows).resized().persistent();
}

export function plansKeyboard(plans: Plan[], user: User) {
  const kb = new InlineKeyboard();
  for (const plan of plans) {
    const price = priceForUser(user, plan);
    kb.text(
      `${plan.title} · ${formatTraffic(plan.trafficGb)} · ${formatToman(price)}`,
      `buy:${plan.id}`,
    ).row();
  }
  kb.text("« بازگشت", "menu:home");
  return kb;
}

export function payConfirmKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ پرداخت کردم — ارسال رسید", `paid:${orderId}`)
    .row()
    .text("❌ انصراف", `cancel:${orderId}`);
}

export function adminOrderKeyboard(orderId: string) {
  return new InlineKeyboard()
    .text("✅ تأیید و ساخت اکانت", `adm:ok:${orderId}`)
    .row()
    .text("❌ رد سفارش", `adm:no:${orderId}`);
}

export function planSummary(plan: Plan, price: number) {
  return [
    `📦 ${plan.title}`,
    `حجم: ${formatTraffic(plan.trafficGb)}`,
    `مدت: ${formatDuration(plan.durationDays)}`,
    `مبلغ: ${formatToman(price)}`,
  ].join("\n");
}
