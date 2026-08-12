export type PriceRow = {
  id: string;
  title: string | null;
  category: string;
  trafficGb: number | null;
  months: number;
  priceUser: number;
  pricePartner: number;
  priceWholesale: number;
  priceReseller?: number;
  limitIp?: number;
  isGolden: boolean;
  active: boolean;
};

export type RoleRates = {
  perGb: number;
  perMonth: number;
  unlimitedPerMonth: number;
};

export type PriceRatesState = {
  user: RoleRates;
  partner: RoleRates;
  /** همکار ویژه (legacy key name) */
  wholesale: RoleRates;
  /** عمده‌فروش — جدا از همکار ویژه */
  wholesaleRole?: RoleRates;
  categories: Record<
    string,
    {
      user?: { perGb?: number; perMonth?: number };
      partner?: { perGb?: number; perMonth?: number };
      wholesale?: { perGb?: number; perMonth?: number };
    }
  >;
};

export type PricingModesState = {
  user: string;
  partner: string;
  reseller: string;
  wholesale: string;
};

export const FALLBACK_CATEGORIES = [
  { key: "data", label: "حجمی" },
  { key: "national", label: "ملی" },
  { key: "unlimited", label: "نامحدود" },
  { key: "offer", label: "پیشنهاد ویژه" },
  { key: "wholesale", label: "پلن‌های عمده‌فروش" },
];

export const SPECIAL_CATS = new Set(["unlimited", "national", "offer", "wholesale", "reseller"]);

export function catLabel(key: string, cats?: Array<{ key: string; label: string }>) {
  return cats?.find((c) => c.key === key)?.label || FALLBACK_CATEGORIES.find((c) => c.key === key)?.label || key;
}

export function formatPriceInput(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : parsePriceInput(String(n));
  if (!Number.isFinite(num)) return "";
  return Math.trunc(num).toLocaleString("en-US");
}

export function parsePriceInput(raw: string): number {
  const cleaned = String(raw).replace(/[^\d]/g, "");
  if (!cleaned) return 0;
  return Number(cleaned);
}

export function errText(e: unknown) {
  return String(e instanceof Error ? e.message : e);
}

export function isWholesaleCategory(cat: string) {
  return cat === "wholesale" || cat === "reseller";
}

export function volumeCats(categories: Array<{ key: string; label: string }>) {
  return categories.filter((c) => !SPECIAL_CATS.has(c.key) || c.key === "data");
}

export type PricesFlash = (ok: string | null, bad?: string | null) => void;
export type PricesAskConfirm = (message: string) => Promise<boolean>;
