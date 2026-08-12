import { InlineKeyboard, Keyboard } from "grammy";
import type { NotifConfig, SalesCategories } from "../services/settings.js";
import { formatLimitIp } from "../services/panel-groups.js";
import { formatCardNumberDisplay, formatToman, formatTraffic, ltrIsolate } from "../utils/format.js";
import type { PlanCategory } from "../services/pricing.js";
import { UNIVERSAL_BY_LENGTH } from "../services/emoji-pack.js";

/** Reply-keyboard labels — Universal glyph prefix (Premium strips via API transform). */
export const BTN = {
  buy: "🛒 خرید سرویس جدید",
  renew: "♻️ تمدید سرویس",
  myServices: "📦 سرویس‌های من",
  wallet: "💰 کیف پول",
  account: "👤 حساب کاربری",
  guide: "💡 آموزش استفاده",
  support: "🆘 پشتیبانی",
  test: "🧪 دریافت اکانت تست",
  dashboard: "🌐 داشبورد وب",
  /** Admin (prod): WebApp next to buy */
  miniApp: "🌐 ورود به وب پنل",
  /** User / partner / wholesale / admin-demo: Mini App entry */
  miniAppDirect: "📱 ورود به وب پنل",
  /** Browser login with temporary credentials */
  dashOtp: "🔐 رمز ورود به وب پنل",
  configLookup: "🔎 مشاهده سریع",
  partner: "🤝 درخواست نمایندگی",
  allConfigs: "👀 نمایش کلیه سرویس‌ها",
  /** @deprecated not on main menu */
  partnerPanel: "💼 پنل نماینده / عمده",
  agentPanel: "💼 مشخصات نماینده",
  controlCenter: "🎛 کنترل سنتر ادمین",
  /** Hide reply keyboard for a fuller chat view */
  hideKeyboard: "⬇️ نمایش تمام‌صفحه",
  /** @deprecated legacy */
  referral: "👥 معرفی به دوستان",
  national: "🇮🇷 کانفیگ نت ملی",
  admin: "👑 پنل ادمین",
  /** Demo role switcher (DEMO_MODE only) */
  demoRole: "🎭 تغییر نقش دمو",
} as const;

/** Match Universal labels, bare text, and legacy RLM/LRM prefixes from broken premium transforms. */
export function hearsBtn(label: string): string[] {
  let bare = label.replace(/^[\u200E\u200F\u2066\u2067\u2068\u2069]+/u, "");
  for (const row of UNIVERSAL_BY_LENGTH) {
    if (bare.startsWith(row.glyph)) {
      bare = bare.slice(row.glyph.length).replace(/^\s+/, "");
      break;
    }
  }
  bare = bare.replace(/^[\u200E\u200F\u2066\u2067\u2068\u2069]+/u, "").trim();
  const out = new Set<string>([label]);
  if (bare) {
    out.add(bare);
    out.add(`\u200F${bare}`);
    out.add(`\u200E${bare}`);
  }
  // Original with emoji + direction marks (stuck keyboards after last deploy)
  out.add(`\u200F${label}`);
  out.add(`\u200E${label}`);
  // Legacy browser-login label
  if (label.includes("رمز ورود به وب پنل") || label.includes("ورود به وب پنل")) {
    out.add("🔐 ورود به وب پنل (مرورگر)");
    out.add("ورود به وب پنل (مرورگر)");
    out.add("🔐 کد ورود مرورگر");
    out.add("کد ورود مرورگر");
    out.add("🔐 ورود مرورگر");
    out.add("ورود مرورگر");
  }
  return [...out];
}

export type MainMenuOpts = {
  isAdmin: boolean;
  isPartner: boolean;
  isWholesale?: boolean;
  isReseller?: boolean;
  demoMode?: boolean;
  /** HTTPS Mini App URL — when set, shows a WebApp keyboard button */
  miniAppUrl?: string | null;
  /** Serverless mode: hide partner application CTA */
  hidePartner?: boolean;
};

/**
 * Sticky reply keyboard — order + colors (Telegram: success=green, primary=blue, danger=red).
 * RTL: first button in a row = visual right (pairs listed visual L | R → code R then L).
 *
 * Admin DEMO (visual):
 *   تغییر نقش دمو | خرید (آبی)
 *   سرویس‌های من | تمدید
 *   کلیه سرویس‌ها | مشاهده سریع
 *   تمام‌صفحه | کنترل سنتر
 *   ورود مرورگر | ورود مستقیم  (both green)
 *
 * Admin prod (visual):
 *   پنل وب‌اپ | خرید (both آبی)
 *   سرویس‌های من | تمدید
 *   کلیه سرویس‌ها | مشاهده سریع
 *   تمام‌صفحه | کنترل سنتر
 *   ورود مرورگر (full-width, red)
 *
 * User / partner / wholesale: columns mirrored vs previous; green web pair.
 */
export function mainMenuReply(opts: MainMenuOpts) {
  const mini = opts.miniAppUrl?.startsWith("https://") ? opts.miniAppUrl : null;

  if (opts.isAdmin) {
    const kb = new Keyboard();

    if (opts.demoMode) {
      kb.text(BTN.demoRole).text(BTN.buy).primary().row();
    } else if (mini) {
      kb.webApp(BTN.miniApp, mini).primary().text(BTN.buy).primary().row();
    } else {
      kb.text(BTN.buy).primary().row();
    }

    kb
      .text(BTN.myServices)
      .text(BTN.renew)
      .row()
      .text(BTN.allConfigs)
      .text(BTN.configLookup)
      .row()
      .text(BTN.hideKeyboard)
      .text(BTN.controlCenter)
      .row();

    if (opts.demoMode) {
      kb.text(BTN.dashOtp).success();
      if (mini) kb.webApp(BTN.miniAppDirect, mini).success();
      kb.row();
    } else {
      kb.text(BTN.dashOtp).danger().row();
    }

    return kb.persistent().resized();
  }

  const isAgent = opts.isPartner || opts.isWholesale || opts.isReseller;
  const kb = new Keyboard();
  if (opts.demoMode) {
    kb.text(BTN.demoRole).success().text(BTN.buy).success().row();
  } else {
    kb.text(BTN.buy).success().row();
  }
  kb
    .text(BTN.renew)
    .text(BTN.myServices)
    .row()
    .text(BTN.account)
    .text(BTN.wallet)
    .row()
    .text(BTN.hideKeyboard)
    .text(BTN.support)
    .row();

  if (!isAgent) {
    kb.text(BTN.test).success().text(BTN.guide).success().row();
  }

  if (isAgent) {
    kb.text(BTN.configLookup).primary().text(BTN.agentPanel).primary().row();
  } else if (!opts.hidePartner) {
    kb.text(BTN.configLookup).primary().text(BTN.partner).primary().row();
  } else {
    kb.text(BTN.configLookup).primary().row();
  }

  if (mini) {
    kb.text(BTN.dashOtp).success().webApp(BTN.miniAppDirect, mini).success().row();
  } else {
    kb.text(BTN.dashOtp).success().row();
  }

  return kb.persistent().resized();
}

/** Inline role picker for DEMO_MODE */
export function demoRoleInlineKeyboard(current?: string) {
  const mark = (role: string, label: string) => (current === role ? `✓ ${label}` : label);
  return new InlineKeyboard()
    .text(mark("admin", "ادمین"), "demo:role:admin")
    .text(mark("partner", "همکار"), "demo:role:partner")
    .row()
    .text(mark("wholesale", "عمده‌فروش"), "demo:role:wholesale")
    .text(mark("reseller", "همکار ویژه"), "demo:role:reseller")
    .row()
    .text(mark("user", "کاربر"), "demo:role:user");
}

/** Remove sticky reply keyboard so chat uses more vertical space. */
export function removeReplyKeyboard() {
  return { remove_keyboard: true as const };
}

/** Inline affordance to restore the main reply keyboard after hide. */
export function showMenuInlineKeyboard() {
  return new InlineKeyboard().text("📌 نمایش منوی اصلی", "menu:show").primary();
}

/** Inline category picker inside buy flow — random Telegram button colors each open. */
export function buyCategoryKeyboard(cats: Array<{ key: string; label: string }>) {
  const kb = new InlineKeyboard();
  const styles = shuffledButtonStyles(cats.length);
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i]!;
    kb.text(c.label, `buy:cat:${c.key}`);
    applyInlineButtonStyle(kb, styles[i]!);
    kb.row();
  }
  kb.text("⏸ انصراف", "buy:cat:cancel");
  return kb;
}

/** Telegram Bot API styles only: primary=blue, success=green, danger=red, null=neutral. */
export type TgBtnStyle = "primary" | "success" | "danger" | null;

/** Random styles for plan buttons (reshuffled each time the keyboard is built). */
export function shuffledButtonStyles(n: number): TgBtnStyle[] {
  const palette: TgBtnStyle[] = ["primary", "success", "danger", null];
  const out: TgBtnStyle[] = [];
  for (let i = 0; i < n; i++) {
    const prev = out[i - 1];
    const choices = palette.filter((s) => s !== prev);
    const pool = choices.length ? choices : palette;
    out.push(pool[Math.floor(Math.random() * pool.length)]!);
  }
  return out;
}

export function applyInlineButtonStyle(kb: InlineKeyboard, style: TgBtnStyle) {
  if (style === "primary") kb.primary();
  else if (style === "success") kb.success();
  else if (style === "danger") kb.danger();
}

/** @deprecated inline main menu — use mainMenuReply */
export function mainMenuInline(opts: MainMenuOpts) {
  const mini = opts.miniAppUrl?.startsWith("https://") ? opts.miniAppUrl : null;

  if (opts.isAdmin) {
    const kb = new InlineKeyboard();
    if (opts.demoMode) {
      kb.text(BTN.demoRole, "m:demorole").text(BTN.buy, "m:buy").primary().row();
    } else if (mini) {
      kb.webApp(BTN.miniApp, mini).primary().text(BTN.buy, "m:buy").primary().row();
    } else {
      kb.text(BTN.buy, "m:buy").primary().row();
    }
    kb
      .text(BTN.myServices, "m:myservices")
      .text(BTN.renew, "m:renew")
      .row()
      .text(BTN.allConfigs, "m:configs")
      .text(BTN.configLookup, "m:cfglookup")
      .row()
      .text(BTN.hideKeyboard, "m:hidekb")
      .text(BTN.controlCenter, "cc:home")
      .row();
    if (opts.demoMode) {
      kb.text(BTN.dashOtp, "m:dashotp").success();
      if (mini) kb.webApp(BTN.miniAppDirect, mini).success();
      kb.row();
    } else {
      kb.text(BTN.dashOtp, "m:dashotp").danger().row();
    }
    return kb;
  }

  const isAgent = opts.isPartner || opts.isWholesale || opts.isReseller;
  const kb = new InlineKeyboard();
  if (opts.demoMode) {
    kb.text(BTN.demoRole, "m:demorole").success().text(BTN.buy, "m:buy").success().row();
  } else {
    kb.text(BTN.buy, "m:buy").success().row();
  }
  kb
    .text(BTN.renew, "m:renew")
    .text(BTN.myServices, "m:myservices")
    .row()
    .text(BTN.account, "m:account")
    .text(BTN.wallet, "m:wallet")
    .row()
    .text(BTN.hideKeyboard, "m:hidekb")
    .text(BTN.support, "m:support")
    .row();

  if (!isAgent) {
    kb.text(BTN.test, "m:test").success().text(BTN.guide, "m:guide").success().row();
  }

  if (isAgent) {
    kb.text(BTN.configLookup, "m:cfglookup").primary().text(BTN.agentPanel, "m:partnerpanel").primary().row();
  } else if (!opts.hidePartner) {
    kb.text(BTN.configLookup, "m:cfglookup").primary().text(BTN.partner, "m:partner").primary().row();
  } else {
    kb.text(BTN.configLookup, "m:cfglookup").primary().row();
  }

  if (mini) {
    kb.text(BTN.dashOtp, "m:dashotp").success().webApp(BTN.miniAppDirect, mini).success().row();
  } else {
    kb.text(BTN.dashOtp, "m:dashotp").success().row();
  }
  return kb;
}

export function partnerContactKeyboard() {
  return new Keyboard().requestContact("📱 ارسال شماره موبایل").resized().oneTime();
}

export function serverlessDurationKeyboard(
  options: Array<{ id: string; label: string; months: number }>,
) {
  const kb = new InlineKeyboard();
  for (const o of options) {
    kb.text(o.label, `sl:dur:${o.months}`).row();
  }
  kb.text("❌ انصراف", "buy:cat:cancel");
  return kb;
}

export function serverlessWizardKeyboard(opts: {
  trafficGb: number | null;
  months: number;
  price: number | null;
  discountsEnabled?: boolean;
  discountCode?: string | null;
}) {
  const vol = formatTraffic(opts.trafficGb);
  const dur =
    opts.months <= 0 ? "هفتگی" : opts.months === 1 ? "یک‌ماهه" : opts.months === 2 ? "دوماهه" : `${opts.months} ماه`;
  const unit = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  const kb = new InlineKeyboard();
  kb.text(`⏳ ${dur}`, "wiz:noop").row();
  kb.text("−", "wiz:vol:-")
    .text(`📏 ${vol}`, "wiz:noop")
    .text("+", "wiz:vol:+")
    .row();
  kb.text(`💰 ${unit}`, "wiz:noop").row();
  if (opts.discountsEnabled) {
    if (opts.discountCode) {
      kb.text(`🎟 ${opts.discountCode}`, "wiz:discount:set")
        .row()
        .text("✖ حذف کد", "wiz:discount:clear")
        .row();
    } else {
      kb.text("🎟 کد تخفیف", "wiz:discount:set").row();
    }
  }
  return kb
    .text("🎲 نام رندوم", "wiz:name:random")
    .text("✍️ نام دلخواه", "wiz:name:custom")
    .row()
    .text("✅ ادامه خرید", "wiz:checkout")
    .success()
    .row()
    .text("◀️ بازگشت", "sl:back:dur")
    .text("❌ انصراف", "buy:cat:cancel");
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
  /** Admin / partner / wholesale: quantity controls */
  canEditAgentOptions?: boolean;
  /** Whether IP limit is editable in this draft */
  canEditIp?: boolean;
  discountsEnabled?: boolean;
  discountCode?: string | null;
  /** Offer title when category is offer */
  offerTitle?: string | null;
}) {
  const cat = (opts.category || "").toLowerCase();
  if (cat === "serverless") {
    return serverlessWizardKeyboard(opts);
  }
  const isOffer = cat === "offer";
  const isWholesale = cat === "wholesale" || cat === "reseller";
  const isFixed = isOffer || isWholesale || cat === "unlimited" || cat === "national";
  const vol = opts.unlimited || opts.trafficGb == null ? "نامحدود 💎" : formatTraffic(opts.trafficGb);
  const unit = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  const total =
    opts.price === null || opts.quantity <= 1
      ? ""
      : ` · جمع ${formatToman(opts.price * opts.quantity)}`;
  const maxMonths = opts.maxMonths ?? 1;
  const showMonthStepper = !isFixed && maxMonths > 1;
  const isAgent = opts.canEditAgentOptions === true;
  const canEditIp = opts.canEditIp === true;
  const allowDiscount = opts.discountsEnabled === true && !isOffer && !isWholesale;

  const kb = new InlineKeyboard();

  if (isFixed) {
    if (isOffer && opts.offerTitle?.trim()) {
      kb.text(`⭐ ${opts.offerTitle.trim().slice(0, 40)}`, "wiz:noop").row();
    }
    kb.text(`📏 ${vol}`, "wiz:noop").row();
    kb.text(`⏳ ${opts.months} ماه`, "wiz:noop").row();
    if (isWholesale && opts.limitIp > 0) {
      kb.text(`📱 ${formatLimitIp(opts.limitIp)}`, "wiz:noop").row();
    }
    kb.text(`💰 ${unit}${total}`, "wiz:noop").row();

    if (allowDiscount) {
      if (opts.discountCode) {
        kb.text(`🎟 ${opts.discountCode}`, "wiz:discount:set")
          .row()
          .text("✖ حذف کد", "wiz:discount:clear")
          .row();
      } else {
        kb.text("🎟 کد تخفیف", "wiz:discount:set").row();
      }
    }
  } else {
    kb.text("−", "wiz:vol:-")
      .text(`📏 ${vol}`, "wiz:noop")
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

    if (isAgent) {
      kb.text("−", "wiz:qty:-")
        .text(`${opts.quantity} عدد`, "wiz:noop")
        .text("+", "wiz:qty:+")
        .row()
        .text(canEditIp ? "−" : "🔒", canEditIp ? "wiz:ip:-" : "wiz:noop")
        .text(`📱 ${formatLimitIp(opts.limitIp)}`, "wiz:noop")
        .text(canEditIp ? "+" : "🔒", canEditIp ? "wiz:ip:+" : "wiz:noop")
        .row();
    }

    kb.text(`💰 ${unit}${total}`, "wiz:noop").row();

    if (allowDiscount) {
      if (opts.discountCode) {
        kb.text(`🎟 ${opts.discountCode}`, "wiz:discount:set")
          .row()
          .text("✖ حذف کد", "wiz:discount:clear")
          .row();
      } else {
        kb.text("🎟 کد تخفیف", "wiz:discount:set").row();
      }
    }
  }

  return kb
    .text("🎲 نام رندوم", "wiz:name:random")
    .text("✍️ نام دلخواه", "wiz:name:custom")
    .row()
    .text("✅ ادامه خرید", "wiz:checkout")
    .success()
    .row()
    .text("◀️ بازگشت", "buy:back:cat")
    .text("❌ انصراف", "buy:cat:cancel");
}

export function salesCategoriesAdminKeyboard(cats: SalesCategories) {
  const on = (v: boolean | undefined) => (v ? "🟢" : "🔴");
  const kb = new InlineKeyboard();
  const keys = Object.keys(cats).length ? Object.keys(cats) : ["data", "national", "unlimited"];
  for (const key of keys) {
    const label =
      key === "data" ? "VIP بین الملل" : key === "national" ? "نت ملی" : key === "unlimited" ? "نامحدود" : key;
    kb.text(`${on(cats[key])} ${label}`, `cc:sales:cat:tog:${key}`).row();
  }
  kb.text("« کنترل سنتر", "cc:home");
  return kb;
}

export function salesCategoriesAdminText(cats: SalesCategories, maxMonths: number) {
  const on = (v: boolean | undefined) => (v ? "فعال 🟢" : "غیرفعال 🔴");
  const lines = [
    "🏷 دسته‌های فروش",
    "",
    "دسته‌هایی که کاربر در «خرید سرویس» می‌بیند:",
    "",
  ];
  for (const [key, enabled] of Object.entries(cats)) {
    const label =
      key === "data" ? "VIP بین الملل" : key === "national" ? "نت ملی" : key === "unlimited" ? "نامحدود" : key;
    lines.push(`${label}: ${on(enabled)}`);
  }
  lines.push("", `⏳ حداکثر مدت خرید/تمدید: ${maxMonths} ماه`, "", "روی هر مورد بزنید تا روشن/خاموش شود.");
  return lines.join("\n");
}

export function payMethodKeyboard(
  orderId: string,
  walletBalance: number,
  opts?: {
    card?: boolean;
    wallet?: boolean;
    crypto?: boolean;
    online?: boolean;
  },
) {
  const card = opts?.card !== false;
  const wallet = opts?.wallet !== false;
  const crypto = Boolean(opts?.crypto);
  const online = Boolean(opts?.online);
  const kb = new InlineKeyboard();
  if (card) {
    kb.text("💳 کارت‌به‌کارت", `pay:card:${orderId}`).primary().row();
  }
  if (wallet) {
    kb.text(`💰 کیف پول (${walletBalance.toLocaleString("fa-IR")})`, `pay:wallet:${orderId}`).success().row();
  }
  if (crypto) {
    kb.text("🪙 کریپتو", `pay:crypto:${orderId}`).row();
  }
  if (online) {
    kb.text("🌐 آنلاین — به‌زودی", `pay:online:${orderId}`).row();
  }
  kb.text("« بازگشت", `pay:back:${orderId}`).text("❌ انصراف", `cancel:${orderId}`).danger();
  return kb;
}

export function payConfirmKeyboard(
  orderId: string,
  opts?: { cardNumber?: string; priceToman?: number },
) {
  const kb = new InlineKeyboard();
  const digits = (opts?.cardNumber ?? "").replace(/\D/g, "");
  const rial =
    opts?.priceToman != null && Number.isFinite(opts.priceToman)
      ? String(Math.max(0, Math.floor(Number(opts.priceToman))) * 10)
      : "";

  if (digits) {
    kb.copyText("📋 کپی شماره کارت", digits.slice(0, 256));
  }
  if (rial) {
    kb.copyText("💰 کپی مبلغ (ریال)", rial.slice(0, 256));
  }
  if (digits || rial) kb.row();

  return kb
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
    .text("⭐ همکار ویژه", `prt:rs:${requestId}`)
    .primary()
    .row()
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
  kb.text("❌ بستن", "buy:cat:cancel");
  return kb;
}

export function subscriptionDetailKeyboard(opts: {
  subId: string;
  panelEnabled?: boolean | null;
  canRenew?: boolean;
  canAddDays?: boolean;
  canAddGb?: boolean;
  isAdmin?: boolean;
}) {
  return userServiceActionsKeyboard(opts.subId, { isAdmin: opts.isAdmin });
}

/**
 * Service actions (after buy / my-services detail).
 *
 * Admin:
 * لینک اشتراک | لینک Base64 کانفیگ
 * افزایش روز | افزایش حجم
 * بروزرسانی | تغییر لینک ساب
 * تغییر نام دلخواه | نمایش QR Code
 * یادداشت | بازگشت
 *
 * Other roles:
 * لینک اشتراک | لینک Base64 کانفیگ
 * افزایش روز | افزایش حجم
 * تغییر لینک ساب | تغییر نام دلخواه
 * نمایش QR Code | یادداشت
 * بازگشت
 */
export function userServiceActionsKeyboard(
  subId: string,
  opts?: { isAdmin?: boolean },
) {
  const kb = new InlineKeyboard()
    .text("🔗 لینک اشتراک", `sub:link:${subId}`)
    .text("📦 لینک Base64 کانفیگ", `sub:b64:${subId}`)
    .row()
    .text("📅 افزایش روز", `sub:adddays:${subId}`)
    .text("📏 افزایش حجم", `sub:addgb:${subId}`)
    .row();

  if (opts?.isAdmin) {
    kb.text("🔄 بروزرسانی", `sub:refresh:${subId}`)
      .text("🔀 تغییر لینک ساب", `sub:rotsub:${subId}`)
      .row()
      .text("✍️ تغییر نام دلخواه", `sub:rename:${subId}`)
      .text("📱 نمایش QR Code", `sub:qr:${subId}`)
      .row()
      .text("📝 یادداشت", `sub:note:${subId}`)
      .text("« بازگشت", "mysvc:list");
  } else {
    kb.text("🔀 تغییر لینک ساب", `sub:rotsub:${subId}`)
      .text("✍️ تغییر نام دلخواه", `sub:rename:${subId}`)
      .row()
      .text("📱 نمایش QR Code", `sub:qr:${subId}`)
      .text("📝 یادداشت", `sub:note:${subId}`)
      .row()
      .text("« بازگشت", "mysvc:list");
  }

  return kb;
}

/** After create / renew / rotate — same actions as my-services detail. */
export function provisionReadyKeyboard(subId: string, opts?: { isAdmin?: boolean }) {
  return userServiceActionsKeyboard(subId, opts);
}

export function addDaysWizardKeyboard(opts: { subId: string; days: number; price: number }) {
  const kb = new InlineKeyboard()
    .text("−", `adddays:n:${opts.subId}:-`)
    .text(`📅 ${opts.days} روز`, "wiz:noop")
    .text("+", `adddays:n:${opts.subId}:+`)
    .row()
    .text(`💳 پرداخت · ${formatToman(opts.price)}`, `adddays:pay:${opts.subId}`)
    .success()
    .row()
    .text("« بازگشت", `mysvc:open:${opts.subId}`);
  return kb;
}

export function addGbWizardKeyboard(opts: {
  subId: string;
  gb: number;
  price: number;
  perGb: number;
}) {
  const kb = new InlineKeyboard()
    .text("−", `addgb:n:${opts.subId}:-`)
    .text(`📏 ${opts.gb} گیگ`, "wiz:noop")
    .text("+", `addgb:n:${opts.subId}:+`)
    .row()
    .text(`هر گیگ: ${formatToman(opts.perGb)}`, "wiz:noop")
    .row()
    .text(`💳 پرداخت · ${formatToman(opts.price)}`, `addgb:pay:${opts.subId}`)
    .success()
    .row()
    .text("« بازگشت", `mysvc:open:${opts.subId}`);
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
  discountsEnabled?: boolean;
  discountCode?: string | null;
}) {
  const priceLabel = opts.price === null ? "❌ بدون قیمت" : formatToman(opts.price);
  const maxMonths = opts.maxMonths ?? 1;
  const vol = opts.unlimited ? "نامحدود 💎" : formatTraffic(opts.trafficGb);
  const showMonthStepper = maxMonths > 1 && opts.category !== "national";

  const kb = new InlineKeyboard();

  if (opts.category === "unlimited" || opts.category === "national") {
    kb.text(`💎 ${vol}`, "wiz:noop").row();
  } else {
    kb.text("−", `renew:vol:${opts.subId}:-`)
      .text(`📏 ${vol}`, "wiz:noop")
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

  kb.text(`💰 ${priceLabel}`, "wiz:noop").row();

  if (opts.discountsEnabled) {
    if (opts.discountCode) {
      kb.text(`🎟 ${opts.discountCode}`, "renew:discount:set")
        .row()
        .text("✖ حذف کد", "renew:discount:clear")
        .row();
    } else {
      kb.text("🎟 کد تخفیف", "renew:discount:set").row();
    }
  }

  return kb
    .text("✅ تأیید و پرداخت تمدید", `renew:checkout:${opts.subId}`)
    .success()
    .row()
    .text("« بازگشت", "renew:back")
    .text("❌ انصراف", "buy:cat:cancel");
}

export type GuidePlatform = "android" | "ios" | "windows" | "macos";

/** Step 1: pick OS — then show that platform’s guide text + download button. */
export function guidePlatformPickerKeyboard() {
  return new InlineKeyboard()
    .text("🤖 اندروید", "guide:plat:android")
    .text("📱 آیفون", "guide:plat:ios")
    .row()
    .text("🪟 ویندوز", "guide:plat:windows")
    .text("💻 مک", "guide:plat:macos")
    .row()
    .text("« انصراف", "buy:cat:cancel");
}

/** Step 2: show download for the chosen platform (+ back to picker). */
export function guideDownloadKeyboard(downloadUrl?: string) {
  const kb = new InlineKeyboard();
  if (downloadUrl) kb.url("⬇️ دانلود نرم‌افزار پیشنهادی", downloadUrl).row();
  kb.text("« انتخاب پلتفرم دیگر", "guide:back").row();
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
  discountCode?: string | null;
  discountAmount?: number | null;
  priceAfterDiscount?: number | null;
  /** Admin only: show catalog price but payable is complimentary (like web panel). */
  adminComplimentary?: boolean;
}) {
  const qty = Math.max(1, opts.quantity ?? 1);
  const vol =
    opts.trafficGb === null || opts.category === "unlimited" ? "نامحدود" : formatTraffic(opts.trafficGb);
  const dur =
    opts.months <= 0
      ? "هفتگی"
      : opts.months === 1
        ? "۱ ماهه"
        : opts.months === 2
          ? "۲ ماهه"
          : `${opts.months} ماهه`;
  const unitPrice = opts.price;
  const totalPrice = unitPrice === null ? null : unitPrice * qty;
  const finalPrice =
    opts.priceAfterDiscount != null && opts.priceAfterDiscount >= 0
      ? opts.priceAfterDiscount
      : totalPrice;
  const priceLabel = finalPrice === null ? "قیمت‌گذاری نشده" : formatToman(finalPrice);
  const name =
    opts.accountMode === "custom" && opts.accountName?.trim()
      ? opts.accountName.trim()
      : "رندوم (بعد از تأیید)";

  const discountLine =
    opts.adminComplimentary
      ? ""
      : opts.discountCode && opts.discountAmount && opts.discountAmount > 0
        ? `🎟 تخفیف ${opts.discountCode}: −${formatToman(opts.discountAmount)}`
        : opts.discountCode
          ? `🎟 کد: ${opts.discountCode}`
          : "";

  const priceLines = opts.adminComplimentary
    ? [`💰 مبلغ سرویس: ${priceLabel}`, "💳 مبلغ قابل پرداخت: صفر"]
    : [`💰 قیمت: ${priceLabel}`];

  return [
    qty > 1 ? "🛒 خرید عمده:" : "🛒 خرید سرویس:",
    `💎 ${vol} ⏳ ${dur}`,
    `📱 محدودیت: ${formatLimitIp(opts.limitIp)}`,
    ...priceLines,
    discountLine,
    qty > 1 ? `📦 تعداد: ${qty} عدد` : "",
    `👤 نام اکانت: ${name}`,
    "",
    "⚙️ سایر تنظیمات را انتخاب کنید، سپس «ادامه خرید» را بزنید.",
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

export function orderCryptoPayText(
  summary: string,
  crypto: { asset: string; network: string; address: string; note: string },
  orderId: string,
) {
  const lines = [
    "✅ سفارش ثبت شد",
    "",
    summary,
    "",
    `🪙 پرداخت ${crypto.asset} (${crypto.network})`,
    "آدرس:",
    crypto.address,
  ];
  if (crypto.note) lines.push("", crypto.note);
  lines.push(
    "",
    "پس از واریز، روی دکمه زیر بزنید و عکس رسید یا هش تراکنش را بفرستید.",
    `کد سفارش: ${ltrIsolate(orderId.slice(-8))}`,
  );
  return lines.join("\n");
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

export function controlCenterKeyboard(opts?: { pendingPartners?: number }) {
  const partnerLabel =
    opts?.pendingPartners && opts.pendingPartners > 0
      ? `🤝 درخواست همکار (${opts.pendingPartners})`
      : "🤝 درخواست همکار";
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
    .text("🎟 کد تخفیف", "cc:discounts")
    .success()
    .row()
    .text("📖 آموزش و دانلود اپ", "cc:guide")
    .row()
    .text("🧪 دریافت اکانت تست", "cc:test")
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
    .text("📊 گزارش همکار ویژه", "cc:rep:reseller")
    .row()
    .text("📊 گزارش عمده‌فروش", "cc:rep:wholesale")
    .row()
    .text("🔍 جستجو کاربر/سفارش", "cc:search")
    .primary()
    .row()
    .text("📜 لاگ عملیات", "cc:audit")
    .row()
    .text(partnerLabel, "cc:partners")
    .primary()
    .row()
    .text("✖️ حذف همکار / همکار ویژه / عمده‌فروش", "cc:demote")
    .danger()
    .row()
    .text("💳 کارت بانکی", "cc:card")
    .text("📡 Inbounds", "cc:inbounds")
    .row()
    .text("🖥 سرورها", "cc:panels")
    .primary()
    .row()
    .text("📥 ورود از اکسل", "cc:import")
    .success()
    .row()
    .text("📋 سفارش‌های باز", "cc:pending")
    .primary()
    .row()
    .text("📣 پیام همگانی", "cc:broadcast")
    .primary()
    .row()
    .text("📌 پیام پین وب پنل", "cc:minipin")
    .success()
    .row()
    .text("💾 پشتیبان دیتابیس", "cc:backup")
    .success()
    .row()
    .text("« منوی اصلی", "menu:home");
}
