import { prisma } from "../db.js";
import { isDemoMode } from "./license.js";

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
  brand_name: "پیـنگ",
  channel_username: "",
  channel_required: "false",
  channels_json: "[]",
  card_number: "6037-0000-0000-0000",
  card_holder: "Card Holder",
  welcome_text: DEFAULT_WELCOME,
  support_username: "",
  support_telegram_id: "",
  miniapp_url: "",
  /** Pinned Mini App banner body (Premium emoji applied on send) */
  miniapp_pin_text: "",
  /** Auto-pin banner on /start and /update (1/0) */
  miniapp_pin_auto: "1",
  xui_inbound_ids: "1,2,3,4,5,6,7,8,9,10",
  guide_text: `📖 آموزش اتصال

۱) نرم‌افزار مناسب گوشی/کامپیوترتان را از دکمه‌های زیر دانلود کنید
۲) لینک اشتراک (Subscription) را از بخش «سرویس‌های من» کپی کنید
۳) در اپ، گزینه Import / افزودن از لینک ساب را بزنید و لینک را بچسبانید
۴) به یک سرور وصل شوید و از اینترنت لذت ببرید

اگر مشکل داشتید با پشتیبانی تماس بگیرید.`,
  guide_android_text: `📱 اندروید

۱) اپ v2rayNG را از لینک زیر نصب کنید
۲) لینک ساب را از «سرویس‌های من» کپی کنید
۳) در اپ + بزنید → Import config from clipboard
۴) سرور را انتخاب و Connect بزنید`,
  guide_ios_text: `📱 آیفون / iOS

۱) اپ Streisand یا V2Box را از App Store نصب کنید
۲) لینک ساب را از «سرویس‌های من» کپی کنید
۳) در اپ Add → Import from URL و لینک را بچسبانید
۴) سرور را انتخاب و وصل شوید`,
  guide_windows_text: `🖥 ویندوز

۱) v2rayN را از لینک زیر دانلود و اجرا کنید
۲) لینک ساب را از «سرویس‌های من» کپی کنید
۳) Subscription → Update subscription from clipboard
۴) راست‌کلیک روی سرور → Set as active → Enter`,
  guide_macos_text: `💻 مک

۱) V2Box را از App Store نصب کنید
۲) لینک ساب را از «سرویس‌های من» کپی کنید
۳) Add → Import from URL
۴) سرور را انتخاب و Connect بزنید`,
  guide_url: "",
  guide_ios_url: "https://apps.apple.com/app/streisand/id6450534064",
  guide_android_url: "https://github.com/2dust/v2rayNG/releases/latest",
  guide_windows_url: "https://github.com/2dust/v2rayN/releases/latest",
  guide_macos_url: "https://apps.apple.com/app/v2box/id6446814690",
  test_service_enabled: "true",
  /** Promo / discount codes at checkout (admin toggle) */
  discount_codes_enabled: "false",
  /** Max % for partner/wholesale when creating codes (admin always up to 100) */
  discount_max_percent: "30",
  /** Sell without 3x-ui — admin pastes sub URL after payment */
  serverless_enabled: "false",
  serverless_price_per_gb: "10000",
  serverless_price_per_month: "30000",
  serverless_weekly_min_gb: "1",
  serverless_weekly_max_gb: "10",
  serverless_monthly_min_gb: "10",
  serverless_monthly_max_gb: "100",
  serverless_weekly_enabled: "true",
  serverless_month1_enabled: "true",
  serverless_month2_enabled: "true",
  national_service_note: "این سرویس در شرایط اضطراری فعال می‌شود.",
  extra_admin_ids: "",
  /** Default IP/device limit for new configs (0 = unlimited) */
  default_limit_ip: "2",
  /** Legacy global mode — kept in sync with pricing_modes_json.user */
  pricing_mode: "matrix",
  /** Per-role: matrix = PriceCell plans | rate = per-GB + per-month formula */
  pricing_modes_json: JSON.stringify({
    user: "matrix",
    partner: "matrix",
    wholesale: "matrix",
  }),
  price_rates_json: JSON.stringify({
    user: { perGb: 15_000, perMonth: 30_000, unlimitedPerMonth: 1_500_000 },
    partner: { perGb: 12_000, perMonth: 25_000, unlimitedPerMonth: 1_200_000 },
    wholesale: { perGb: 10_000, perMonth: 20_000, unlimitedPerMonth: 1_000_000 },
    categories: {
      data: {
        user: { perGb: 15_000, perMonth: 30_000 },
        partner: { perGb: 12_000, perMonth: 25_000 },
        wholesale: { perGb: 10_000, perMonth: 20_000 },
      },
      national: {
        user: { perGb: 8_000, perMonth: 20_000 },
        partner: { perGb: 6_000, perMonth: 15_000 },
        wholesale: { perGb: 5_000, perMonth: 12_000 },
      },
    },
  }),
  backup_config: JSON.stringify({
    enabled: true,
    hour: 3,
    minute: 0,
    lastAt: "",
    lastStatus: "",
  }),
  payment_methods_json: JSON.stringify({
    card: { enabled: true },
    wallet: { enabled: true },
    online: { enabled: false, provider: null },
    crypto: { enabled: false, asset: "USDT", network: "TRC20", address: "", note: "" },
  }),
  notif_config: JSON.stringify(defaultNotifConfig()),
  /** Which plan categories customers can buy (admin toggles) */
  sales_categories_json: JSON.stringify({
    data: true,
    national: true,
    unlimited: true,
  }),
  /** Max months selectable in buy/renew wizard (1 = disable multi-month for now) */
  max_purchase_months: "1",
  /** Display labels for plan categories (web dashboard + bot) */
  category_labels_json: JSON.stringify({
    data: "بسته‌های VIP",
    national: "اینترنت ملی",
    unlimited: "نامحدود",
    offer: "پیشنهاد ویژه",
    wholesale: "پلن‌های عمده‌فروش",
  }),
  /** Display order for plan categories (web dashboard + bot) */
  category_order_json: JSON.stringify(["data", "national", "unlimited"]),
  /** Web dashboard session lifetime after login, in hours */
  web_session_hours: "168",
  /** Bot emoji display: universal (Unicode) | premium (custom emoji IDs) */
  emoji_style: "universal",

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

/**
 * HTTPS URL for Telegram Mini App / WebApp buttons.
 * Prefers `miniapp_url` setting, then DASH_DOMAIN / PUBLIC_DOMAIN.
 */
export async function resolveMiniAppUrl(): Promise<string | null> {
  const { dashBaseUrl } = await import("../config/env.js");
  const stored = (await getSetting("miniapp_url")).trim().replace(/\/$/, "");
  if (stored.startsWith("https://")) return stored;
  const dash = dashBaseUrl();
  if (dash.startsWith("https://")) return dash;
  return null;
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
  // Rename legacy English brand to Persian display name
  const brand = await prisma.setting.findUnique({ where: { key: "brand_name" } });
  if (brand && /^piing$/i.test(brand.value.trim())) {
    await prisma.setting.update({ where: { key: "brand_name" }, data: { value: defaults.brand_name } });
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

/** Unlimited plans are always locked to 2 users/devices. */
export const UNLIMITED_LIMIT_IP = 2;

/** Admin / partner / همکار ویژه (reseller) may change IP limit; user + عمده‌فروش (wholesale) cannot. */
export function canEditLimitIp(role: string): boolean {
  return role === "admin" || role === "partner" || role === "reseller";
}

/** Effective IP limit for buy wizard / checkout (unset draft → admin default). */
export async function resolvePurchaseLimitIp(
  draft: {
    limitIp: number;
    limitIpTouched: boolean;
    category?: string;
    trafficGb?: number | null;
    unlimited?: boolean;
  },
  role?: string,
): Promise<number> {
  if (draft.category === "unlimited" || draft.unlimited === true) return UNLIMITED_LIMIT_IP;
  // Plan-locked or explicitly chosen IP (e.g. عمده‌فروش fixed plans) wins over role defaults.
  if (draft.limitIpTouched) {
    return Math.max(0, Math.min(10, Math.floor(draft.limitIp)));
  }
  const cat = (draft.category || "").toLowerCase();
  if ((cat === "wholesale" || cat === "reseller") && draft.limitIp > 0) {
    return Math.max(0, Math.min(10, Math.floor(draft.limitIp)));
  }
  if (role && !canEditLimitIp(role)) return getDefaultLimitIp();
  if (draft.limitIp > 0) return Math.max(0, Math.min(10, Math.floor(draft.limitIp)));
  return getDefaultLimitIp();
}

export type PricingMode = "matrix" | "rate";

export type RolePricingKey = "user" | "partner" | "wholesale";

export type RolePricingModes = Record<RolePricingKey, PricingMode>;

export type RoleRates = {
  perGb: number;
  perMonth: number;
  unlimitedPerMonth: number;
};

/** Fixed unit prices for a category (GB + month). Unlimited uses RoleRates.unlimitedPerMonth. */
export type CategoryUnitRates = {
  perGb: number;
  perMonth: number;
};

export type CategoryRoleRates = Partial<Record<RolePricingKey, Partial<CategoryUnitRates>>>;

export type PriceRates = {
  user: RoleRates;
  partner: RoleRates;
  wholesale: RoleRates;
  /** Per-category overrides: categories.data.user.perGb etc. */
  categories: Record<string, CategoryRoleRates>;
};

function asMode(v: unknown): PricingMode {
  return v === "rate" ? "rate" : "matrix";
}

export function defaultPricingModes(): RolePricingModes {
  return { user: "matrix", partner: "matrix", wholesale: "matrix" };
}

export function defaultPriceRates(): PriceRates {
  return {
    user: { perGb: 15_000, perMonth: 30_000, unlimitedPerMonth: 1_500_000 },
    partner: { perGb: 12_000, perMonth: 25_000, unlimitedPerMonth: 1_200_000 },
    wholesale: { perGb: 10_000, perMonth: 20_000, unlimitedPerMonth: 1_000_000 },
    categories: {
      data: {
        user: { perGb: 15_000, perMonth: 30_000 },
        partner: { perGb: 12_000, perMonth: 25_000 },
        wholesale: { perGb: 10_000, perMonth: 20_000 },
      },
      national: {
        user: { perGb: 8_000, perMonth: 20_000 },
        partner: { perGb: 6_000, perMonth: 15_000 },
        wholesale: { perGb: 5_000, perMonth: 12_000 },
      },
    },
  };
}

/** Legacy single mode (equals user mode). Prefer getPricingModeForRole. */
export async function getPricingMode(): Promise<PricingMode> {
  const modes = await getPricingModes();
  return modes.user;
}

export async function getPricingModes(): Promise<RolePricingModes> {
  const base = defaultPricingModes();
  try {
    const raw = JSON.parse(await getSetting("pricing_modes_json")) as Partial<RolePricingModes>;
    if (raw && typeof raw === "object") {
      return {
        user: asMode(raw.user ?? base.user),
        partner: asMode(raw.partner ?? base.partner),
        wholesale: asMode(raw.wholesale ?? base.wholesale),
      };
    }
  } catch {
    /* fall through to legacy */
  }
  const legacy = asMode(await getSetting("pricing_mode"));
  return { user: legacy, partner: legacy, wholesale: legacy };
}

export async function getPricingModeForRole(role: string): Promise<PricingMode> {
  // عمده‌فروش (wholesale): فقط پلن ثابت ماتریکس
  if (role === "wholesale") return "matrix";
  const modes = await getPricingModes();
  // همکار ویژه (reseller) + admin → نرخ/ماتریکس عمدهٔ سابق
  if (role === "reseller" || role === "admin") return modes.wholesale;
  if (role === "partner") return modes.partner;
  return modes.user;
}

/** Set the same mode for every role (legacy / bulk). */
export async function setPricingMode(mode: PricingMode) {
  await savePricingModes({ user: mode, partner: mode, wholesale: mode });
}

export async function savePricingModes(modes: RolePricingModes) {
  const next: RolePricingModes = {
    user: asMode(modes.user),
    partner: asMode(modes.partner),
    wholesale: asMode(modes.wholesale),
  };
  await setSetting("pricing_modes_json", JSON.stringify(next));
  await setSetting("pricing_mode", next.user);
}

function mergeRoleRates(base: RoleRates, patch?: Partial<RoleRates>): RoleRates {
  return {
    perGb: Number(patch?.perGb ?? base.perGb) || 0,
    perMonth: Number(patch?.perMonth ?? base.perMonth) || 0,
    unlimitedPerMonth: Number(patch?.unlimitedPerMonth ?? base.unlimitedPerMonth) || 0,
  };
}

export async function getPriceRates(): Promise<PriceRates> {
  const base = defaultPriceRates();
  try {
    const raw = JSON.parse(await getSetting("price_rates_json")) as Partial<PriceRates> & {
      categories?: Record<string, CategoryRoleRates>;
    };
    const categories: Record<string, CategoryRoleRates> = { ...base.categories };
    if (raw.categories && typeof raw.categories === "object") {
      for (const [cat, roles] of Object.entries(raw.categories)) {
        if (!cat.trim() || !roles || typeof roles !== "object") continue;
        categories[cat.trim()] = {
          ...(categories[cat.trim()] ?? {}),
          ...roles,
        };
      }
    }
    return {
      user: mergeRoleRates(base.user, raw.user),
      partner: mergeRoleRates(base.partner, raw.partner),
      wholesale: mergeRoleRates(base.wholesale, raw.wholesale),
      categories,
    };
  } catch {
    return base;
  }
}

export async function savePriceRates(rates: PriceRates) {
  await setSetting("price_rates_json", JSON.stringify(rates));
}

/** Effective unit rates for a role + category (falls back to role defaults). */
export function ratesForRoleCategory(
  role: string,
  category: string,
  rates: PriceRates,
): RoleRates {
  const roleKey: RolePricingKey =
    role === "reseller" || role === "admin"
      ? "wholesale"
      : role === "partner"
        ? "partner"
        : "user";
  const base = rates[roleKey];
  const cat = category === "unlimited" ? undefined : rates.categories?.[category]?.[roleKey];
  return {
    perGb: Number(cat?.perGb ?? base.perGb) || 0,
    perMonth: Number(cat?.perMonth ?? base.perMonth) || 0,
    unlimitedPerMonth: Number(base?.unlimitedPerMonth) || 0,
  };
}

/** Builtin + custom category keys → sales enabled flag */
export type SalesCategories = Record<string, boolean>;

export const BUILTIN_CATEGORY_KEYS = ["data", "national", "unlimited"] as const;

export function defaultSalesCategories(): SalesCategories {
  return { data: true, national: true, unlimited: true, wholesale: true };
}

export async function getSalesCategories(): Promise<SalesCategories> {
  const base = defaultSalesCategories();
  try {
    const raw = JSON.parse(await getSetting("sales_categories_json")) as Record<string, unknown>;
    const out: SalesCategories = { ...base };
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "boolean" && k.trim()) out[k.trim()] = v;
    }
    // Merge legacy reseller flag into wholesale; never expose reseller separately
    if (out.reseller === true) out.wholesale = true;
    delete out.reseller;
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
  return {
    data: "بسته‌های VIP",
    national: "اینترنت ملی",
    unlimited: "نامحدود",
    offer: "پیشنهاد ویژه",
    wholesale: "پلن‌های عمده‌فروش",
  };
}

export async function getCategoryLabels(): Promise<CategoryLabels> {
  const base = defaultCategoryLabels();
  try {
    const raw = JSON.parse(await getSetting("category_labels_json")) as Record<string, unknown>;
    const out: CategoryLabels = { ...base };
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && k.trim() && v.trim()) out[k.trim()] = v.trim();
    }
    // Legacy alias — never show as a separate category in UI
    if (out.reseller && !out.wholesale) out.wholesale = out.reseller;
    delete out.reseller;
    return out;
  } catch {
    return base;
  }
}

export async function saveCategoryLabels(labels: CategoryLabels) {
  await setSetting("category_labels_json", JSON.stringify(labels));
}

/** Display order for category keys (first = top row / first chip). */
export function defaultCategoryOrder(): string[] {
  return [...BUILTIN_CATEGORY_KEYS];
}

export async function getCategoryOrder(): Promise<string[]> {
  try {
    const raw = JSON.parse(await getSetting("category_order_json")) as unknown;
    if (!Array.isArray(raw)) return defaultCategoryOrder();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const key = item.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out.length ? out : defaultCategoryOrder();
  } catch {
    return defaultCategoryOrder();
  }
}

export async function saveCategoryOrder(order: string[]) {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const item of order) {
    const key = typeof item === "string" ? item.trim() : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clean.push(key);
  }
  await setSetting("category_order_json", JSON.stringify(clean.length ? clean : defaultCategoryOrder()));
}

/** Sort keys by admin display order; unknown keys follow in locale order. */
export function sortKeysByCategoryOrder(keys: string[], order: string[]): string[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...keys].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a)! : 10_000;
    const rb = rank.has(b) ? rank.get(b)! : 10_000;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

/** Ensure every known key appears in order (append missing); drop unknown optionally kept. */
export async function ensureCategoryInOrder(key: string) {
  const order = await getCategoryOrder();
  if (order.includes(key)) return;
  order.push(key);
  await saveCategoryOrder(order);
}

export async function removeCategoryFromOrder(key: string) {
  const order = await getCategoryOrder();
  const next = order.filter((k) => k !== key);
  if (next.length !== order.length) await saveCategoryOrder(next);
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
  // Demo showcase: allow full multi-month experience without admin toggle
  if (isDemoMode()) return 12;
  const n = Number(await getSetting("max_purchase_months"));
  if (!n || n < 1) return 1;
  return Math.min(12, Math.floor(n));
}

export async function listEnabledSalesCategories(): Promise<string[]> {
  const cats = await getSalesCategories();
  const labels = await getCategoryLabels();
  const order = await getCategoryOrder();
  const keys = new Set([...Object.keys(cats), ...Object.keys(labels), ...BUILTIN_CATEGORY_KEYS, "wholesale"]);
  keys.delete("reseller");
  return sortKeysByCategoryOrder([...keys].filter((k) => cats[k] === true), order);
}

/**
 * Role-aware sales categories:
 * - serverless mode → dedicated serverless catalog (handled by buy flow / catalog API)
 * - wholesale (عمده‌فروش) → only fixed wholesale plans
 * - everyone else → enabled cats except wholesale fixed category
 */
export async function listEnabledSalesCategoriesForRole(role: string): Promise<string[]> {
  if ((await getSetting("serverless_enabled")) === "true") {
    return ["serverless"];
  }
  const all = await listEnabledSalesCategories();
  if (role === "wholesale") {
    return all.includes("wholesale") ? ["wholesale"] : [];
  }
  return all.filter((k) => k !== "wholesale" && k !== "reseller");
}

export async function isServerlessEnabled(): Promise<boolean> {
  return (await getSetting("serverless_enabled")) === "true";
}

export type PaymentMethodsConfig = {
  card: { enabled: boolean };
  wallet: { enabled: boolean };
  online: { enabled: boolean; provider: string | null };
  crypto: {
    enabled: boolean;
    asset: string;
    network: string;
    address: string;
    note: string;
  };
};

export function defaultPaymentMethodsConfig(): PaymentMethodsConfig {
  return {
    card: { enabled: true },
    wallet: { enabled: true },
    online: { enabled: false, provider: null },
    crypto: { enabled: false, asset: "USDT", network: "TRC20", address: "", note: "" },
  };
}

export async function getPaymentMethodsConfig(): Promise<PaymentMethodsConfig> {
  const base = defaultPaymentMethodsConfig();
  try {
    const raw = JSON.parse(await getSetting("payment_methods_json")) as Partial<PaymentMethodsConfig>;
    return {
      card: { enabled: raw.card?.enabled !== false },
      wallet: { enabled: raw.wallet?.enabled !== false },
      online: {
        enabled: Boolean(raw.online?.enabled),
        provider: raw.online?.provider ?? null,
      },
      crypto: {
        enabled: Boolean(raw.crypto?.enabled),
        asset: (raw.crypto?.asset || "USDT").trim() || "USDT",
        network: (raw.crypto?.network || "TRC20").trim() || "TRC20",
        address: (raw.crypto?.address || "").trim(),
        note: (raw.crypto?.note || "").trim(),
      },
    };
  } catch {
    return base;
  }
}

export async function savePaymentMethodsConfig(cfg: PaymentMethodsConfig) {
  const normalized: PaymentMethodsConfig = {
    card: { enabled: Boolean(cfg.card?.enabled) },
    wallet: { enabled: Boolean(cfg.wallet?.enabled) },
    online: {
      enabled: Boolean(cfg.online?.enabled),
      provider: cfg.online?.provider?.trim() || null,
    },
    crypto: {
      enabled: Boolean(cfg.crypto?.enabled),
      asset: (cfg.crypto?.asset || "USDT").trim() || "USDT",
      network: (cfg.crypto?.network || "TRC20").trim() || "TRC20",
      address: (cfg.crypto?.address || "").trim(),
      note: (cfg.crypto?.note || "").trim().slice(0, 500),
    },
  };
  await setSetting("payment_methods_json", JSON.stringify(normalized));
  return normalized;
}

/** Public checkout payload — no gateway secrets. */
export async function getPublicPaymentMethods() {
  const cfg = await getPaymentMethodsConfig();
  const card = await getPaymentCard();
  return {
    card: {
      enabled: cfg.card.enabled,
      number: card.number,
      holder: card.holder,
    },
    wallet: { enabled: cfg.wallet.enabled },
    online: {
      enabled: cfg.online.enabled,
      ready: Boolean(cfg.online.provider),
      label: "به‌زودی",
    },
    crypto: {
      enabled: cfg.crypto.enabled && Boolean(cfg.crypto.address),
      configured: Boolean(cfg.crypto.address),
      asset: cfg.crypto.asset,
      network: cfg.crypto.network,
      address: cfg.crypto.address,
      note: cfg.crypto.note,
    },
  };
}

export async function assertCheckoutPaymentMethod(
  method: "wallet" | "card_to_card" | "crypto" | "online",
): Promise<void> {
  const cfg = await getPaymentMethodsConfig();
  if (method === "wallet") {
    if (!cfg.wallet.enabled) throw new Error("پرداخت از کیف پول غیرفعال است");
    return;
  }
  if (method === "card_to_card") {
    if (!cfg.card.enabled) throw new Error("پرداخت کارت‌به‌کارت غیرفعال است");
    return;
  }
  if (method === "crypto") {
    if (!cfg.crypto.enabled) throw new Error("پرداخت کریپتو غیرفعال است");
    if (!cfg.crypto.address.trim()) throw new Error("آدرس کیف پول کریپتو تنظیم نشده است");
    return;
  }
  if (method === "online") {
    throw new Error("پرداخت آنلاین هنوز فعال نشده است");
  }
}
