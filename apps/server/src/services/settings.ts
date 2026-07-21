import { prisma } from "../db.js";

const DEFAULT_WELCOME = `سلام به ربات پینگ خوش اومدی 🌸
ما اینجاییم تا شما را بدون هیچ محدویتی به شبکه جهانی متصل کنیم ❤️

✅ کیفیت بالا در انواع کانکشن ها
📡 برقرای امنیت در ارتباط
🇮🇷 سرویس ویژه اینترنت ملی
☎️ پشتیبانی تا لحظه آخر`;

export type NotifConfig = {
  expiryDays: { enabled: boolean; hours: number };
  traffic: { enabled: boolean; megabytes: number };
  preDelete: { enabled: boolean; hours: number };
  deleted: { enabled: boolean };
};

export const defaultNotifConfig = (): NotifConfig => ({
  expiryDays: { enabled: true, hours: 24 },
  traffic: { enabled: true, megabytes: 200 },
  preDelete: { enabled: true, hours: 24 },
  deleted: { enabled: true },
});

export type ChannelConfig = { username: string; required: boolean };

const defaults: Record<string, string> = {
  brand_name: "Piing",
  channel_username: "",
  channel_required: "false",
  channels_json: "[]",
  card_number: "6037-0000-0000-0000",
  card_holder: "Card Holder",
  welcome_text: DEFAULT_WELCOME,
  support_username: "",
  support_telegram_id: "",
  miniapp_url: "",
  xui_inbound_ids: "1,2,3,4,5,6,7,8,9,10",
  guide_text: `📖 آموزش اتصال

۱) نرم‌افزار مناسب گوشی/کامپیوترتان را از دکمه‌های زیر دانلود کنید
۲) لینک اشتراک (Subscription) را از بخش «سرویس‌های من» کپی کنید
۳) در اپ، گزینه Import / افزودن از لینک ساب را بزنید و لینک را بچسبانید
۴) به یک سرور وصل شوید و از اینترنت لذت ببرید

اگر مشکل داشتید با پشتیبانی تماس بگیرید.`,
  guide_url: "",
  guide_ios_url: "https://apps.apple.com/app/streisand/id6450534064",
  guide_android_url: "https://github.com/2dust/v2rayNG/releases/latest",
  guide_windows_url: "https://github.com/2dust/v2rayN/releases/latest",
  guide_macos_url: "https://apps.apple.com/app/v2box/id6446814690",
  test_service_enabled: "true",
  national_service_note: "سرویس ویژه اینترنت ملی را از منوی خرید انتخاب کنید.",
  extra_admin_ids: "",
  /** Default IP/device limit for new configs (0 = unlimited) */
  default_limit_ip: "2",
  /** matrix = discrete PriceCell plans | rate = per-GB + per-month formula */
  pricing_mode: "matrix",
  price_rates_json: JSON.stringify({
    user: { perGb: 15_000, perMonth: 30_000, unlimitedPerMonth: 1_500_000 },
    partner: { perGb: 12_000, perMonth: 25_000, unlimitedPerMonth: 1_200_000 },
    wholesale: { perGb: 10_000, perMonth: 20_000, unlimitedPerMonth: 1_000_000 },
  }),
  backup_config: JSON.stringify({
    enabled: true,
    hour: 3,
    minute: 0,
    lastAt: "",
    lastStatus: "",
  }),
  notif_config: JSON.stringify(defaultNotifConfig()),
  /** Which plan categories customers can buy (admin toggles) */
  sales_categories_json: JSON.stringify({
    data: true,
    national: true,
    unlimited: false,
  }),
  /** Max months selectable in buy/renew wizard (1 = disable multi-month for now) */
  max_purchase_months: "1",
  /** Display labels for plan categories (web dashboard + bot) */
  category_labels_json: JSON.stringify({
    data: "بسته‌های VIP",
    national: "اینترنت ملی",
    unlimited: "نامحدود",
  }),
  /** Web dashboard session lifetime after login, in hours */
  web_session_hours: "168",
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) return row.value;
  return defaults[key] ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getAllSettings() {
  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = { ...defaults };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function getPaymentCard() {
  return {
    number: await getSetting("card_number"),
    holder: await getSetting("card_holder"),
  };
}

export async function ensureDefaultSettings() {
  for (const [key, value] of Object.entries(defaults)) {
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (!existing) {
      await prisma.setting.create({ data: { key, value } });
    }
  }
}

export async function getChannels(): Promise<ChannelConfig[]> {
  try {
    const raw = await getSetting("channels_json");
    const parsed = JSON.parse(raw || "[]") as ChannelConfig[];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* fallthrough */
  }
  const legacy = await getSetting("channel_username");
  const required = (await getSetting("channel_required")) === "true";
  if (legacy) return [{ username: legacy.replace(/^@/, ""), required }];
  return [];
}

export async function saveChannels(channels: ChannelConfig[]) {
  await setSetting("channels_json", JSON.stringify(channels));
  const firstRequired = channels.find((c) => c.required) ?? channels[0];
  await setSetting("channel_username", firstRequired?.username ?? "");
  await setSetting("channel_required", channels.some((c) => c.required) ? "true" : "false");
}

export async function getNotifConfig(): Promise<NotifConfig> {
  try {
    return { ...defaultNotifConfig(), ...(JSON.parse(await getSetting("notif_config")) as NotifConfig) };
  } catch {
    return defaultNotifConfig();
  }
}

export async function saveNotifConfig(cfg: NotifConfig) {
  await setSetting("notif_config", JSON.stringify(cfg));
}

export async function getExtraAdminIds(): Promise<bigint[]> {
  const raw = await getSetting("extra_admin_ids");
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => BigInt(s));
}

export async function saveExtraAdminIds(ids: bigint[]) {
  const unique = [...new Set(ids.map((id) => String(id)))];
  await setSetting("extra_admin_ids", unique.join(","));
}

export async function addExtraAdminId(id: bigint) {
  const ids = await getExtraAdminIds();
  if (!ids.includes(id)) ids.push(id);
  await saveExtraAdminIds(ids);
}

export async function removeExtraAdminId(id: bigint) {
  const ids = (await getExtraAdminIds()).filter((x) => x !== id);
  await saveExtraAdminIds(ids);
}

export async function getDefaultLimitIp(): Promise<number> {
  const raw = Number(await getSetting("default_limit_ip"));
  if (Number.isNaN(raw) || raw < 0) return 2;
  return Math.min(10, Math.floor(raw));
}

/** Effective IP limit for buy wizard / checkout (unset draft → admin default). */
export async function resolvePurchaseLimitIp(draft: {
  limitIp: number;
  limitIpTouched: boolean;
}): Promise<number> {
  if (draft.limitIpTouched) return draft.limitIp;
  if (draft.limitIp > 0) return draft.limitIp;
  return getDefaultLimitIp();
}

export type PricingMode = "matrix" | "rate";

export type RoleRates = {
  perGb: number;
  perMonth: number;
  unlimitedPerMonth: number;
};

export type PriceRates = {
  user: RoleRates;
  partner: RoleRates;
  wholesale: RoleRates;
};

export function defaultPriceRates(): PriceRates {
  return {
    user: { perGb: 15_000, perMonth: 30_000, unlimitedPerMonth: 1_500_000 },
    partner: { perGb: 12_000, perMonth: 25_000, unlimitedPerMonth: 1_200_000 },
    wholesale: { perGb: 10_000, perMonth: 20_000, unlimitedPerMonth: 1_000_000 },
  };
}

export async function getPricingMode(): Promise<PricingMode> {
  const m = await getSetting("pricing_mode");
  return m === "rate" ? "rate" : "matrix";
}

export async function setPricingMode(mode: PricingMode) {
  await setSetting("pricing_mode", mode);
}

export async function getPriceRates(): Promise<PriceRates> {
  const base = defaultPriceRates();
  try {
    const raw = JSON.parse(await getSetting("price_rates_json")) as Partial<PriceRates>;
    return {
      user: { ...base.user, ...(raw.user ?? {}) },
      partner: { ...base.partner, ...(raw.partner ?? {}) },
      wholesale: { ...base.wholesale, ...(raw.wholesale ?? {}) },
    };
  } catch {
    return base;
  }
}

export async function savePriceRates(rates: PriceRates) {
  await setSetting("price_rates_json", JSON.stringify(rates));
}

/** Builtin + custom category keys → sales enabled flag */
export type SalesCategories = Record<string, boolean>;

export const BUILTIN_CATEGORY_KEYS = ["data", "national", "unlimited"] as const;

export function defaultSalesCategories(): SalesCategories {
  return { data: true, national: true, unlimited: false };
}

export async function getSalesCategories(): Promise<SalesCategories> {
  const base = defaultSalesCategories();
  try {
    const raw = JSON.parse(await getSetting("sales_categories_json")) as Record<string, unknown>;
    const out: SalesCategories = { ...base };
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "boolean" && k.trim()) out[k.trim()] = v;
    }
    return out;
  } catch {
    return base;
  }
}

export async function saveSalesCategories(cats: SalesCategories) {
  await setSetting("sales_categories_json", JSON.stringify(cats));
}

export async function isSalesCategoryEnabled(category: string) {
  const cats = await getSalesCategories();
  return Boolean(cats[category]);
}

/** Builtin + custom category keys → display label */
export type CategoryLabels = Record<string, string>;

export function defaultCategoryLabels(): CategoryLabels {
  return { data: "بسته‌های VIP", national: "اینترنت ملی", unlimited: "نامحدود" };
}

export async function getCategoryLabels(): Promise<CategoryLabels> {
  const base = defaultCategoryLabels();
  try {
    const raw = JSON.parse(await getSetting("category_labels_json")) as Record<string, unknown>;
    const out: CategoryLabels = { ...base };
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && k.trim() && v.trim()) out[k.trim()] = v.trim();
    }
    return out;
  } catch {
    return base;
  }
}

export async function saveCategoryLabels(labels: CategoryLabels) {
  await setSetting("category_labels_json", JSON.stringify(labels));
}

/** Sanitize a new category key: lowercase latin slug. */
export function sanitizeCategoryKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}

/** Web dashboard session lifetime in hours (1..720, default 168 = 7 days). */
export async function getWebSessionHours(): Promise<number> {
  const n = Number(await getSetting("web_session_hours"));
  if (!Number.isFinite(n) || n < 1) return 168;
  return Math.min(720, Math.floor(n));
}

export async function getMaxPurchaseMonths(): Promise<number> {
  const n = Number(await getSetting("max_purchase_months"));
  if (!n || n < 1) return 1;
  return Math.min(12, Math.floor(n));
}

export async function listEnabledSalesCategories(): Promise<string[]> {
  const cats = await getSalesCategories();
  const labels = await getCategoryLabels();
  const keys = new Set([...Object.keys(cats), ...Object.keys(labels), ...BUILTIN_CATEGORY_KEYS]);
  return [...keys].filter((k) => cats[k] === true);
}
