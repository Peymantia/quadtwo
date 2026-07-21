import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { prisma } from "../db.js";
import {
  createPanelServer,
  listPanelServers,
  updatePanelServer,
  type PanelCategories,
} from "./panel-servers.js";
import {
  getPriceRates,
  getSalesCategories,
  saveChannels,
  savePriceRates,
  saveSalesCategories,
  setPricingMode,
  setSetting,
  type ChannelConfig,
} from "./settings.js";
import type { PlanCategory } from "./pricing.js";

export type ImportResult = {
  settings: number;
  channels: number;
  prices: number;
  pricesCleared: boolean;
  rates: boolean;
  salesCategories: boolean;
  promos: number;
  guides: number;
  panels: number;
  warnings: string[];
};

function sheetRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function cellStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
      return String(row[k]).trim();
    }
  }
  return "";
}

/** Explicit clear markers in Excel (empty cell = skip / keep existing). */
function isClearMarker(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "-" || v === "—" || v === "clear" || v === "پاک" || v === "حذف";
}

function cellBool(row: Record<string, unknown>, key: string, def = false): boolean {
  const v = row[key];
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "بله";
}

function cellNum(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const SETTING_KEYS = new Set([
  "brand_name",
  "welcome_text",
  "card_number",
  "card_holder",
  "support_username",
  "support_telegram_id",
  "miniapp_url",
  "default_limit_ip",
  "pricing_mode",
  "max_purchase_months",
  "test_service_enabled",
  "xui_inbound_ids",
  "national_service_note",
]);

const GUIDE_KEYS = new Set([
  "guide_text",
  "guide_url",
  "guide_ios_url",
  "guide_android_url",
  "guide_windows_url",
  "guide_macos_url",
]);

export function readWorkbookFromBuffer(buf: Buffer): XLSX.WorkBook {
  return XLSX.read(buf, { type: "buffer" });
}

export function readWorkbookFromPath(path: string): XLSX.WorkBook {
  return XLSX.read(readFileSync(path), { type: "buffer" });
}

export async function importWorkbook(wb: XLSX.WorkBook): Promise<ImportResult> {
  const result: ImportResult = {
    settings: 0,
    channels: 0,
    prices: 0,
    pricesCleared: false,
    rates: false,
    salesCategories: false,
    promos: 0,
    guides: 0,
    panels: 0,
    warnings: [],
  };

  let replacePrices = true;

  // ── Settings ──
  // Empty value → skip (keep existing). "-" / CLEAR / پاک → wipe setting.
  for (const row of sheetRows(wb, "تنظیمات")) {
    const key = cellStr(row, "key", "کلید");
    if (!key) continue;
    if (key === "replace_prices") {
      const raw = cellStr(row, "value", "مقدار").toLowerCase();
      // empty → keep default true; explicit false/خیر → merge prices
      if (!raw) continue;
      replacePrices = !["false", "0", "no", "خیر"].includes(raw);
      continue;
    }
    const value = cellStr(row, "value", "مقدار");
    if (!value) continue; // empty cell → do not overwrite
    const store = isClearMarker(value) ? "" : value;
    if (SETTING_KEYS.has(key)) {
      if (key === "pricing_mode") {
        if (store) await setPricingMode(store === "rate" ? "rate" : "matrix");
      } else {
        await setSetting(key, store);
      }
      result.settings++;
    } else if (GUIDE_KEYS.has(key)) {
      await setSetting(key, store);
      result.guides++;
    } else if (key.startsWith("promo_")) {
      await setSetting(key, store);
      result.promos++;
    } else {
      await setSetting(key, store);
      result.settings++;
    }
  }

  // ── Guide sheet ──
  for (const row of sheetRows(wb, "لینک‌های آموزش")) {
    const key = cellStr(row, "key", "کلید");
    if (!key) continue;
    const value = cellStr(row, "value", "مقدار");
    if (!value) continue;
    await setSetting(key, isClearMarker(value) ? "" : value);
    result.guides++;
  }

  // ── Promo sheet ──
  for (const row of sheetRows(wb, "پیام‌های تبلیغ")) {
    const key = cellStr(row, "key", "کلید");
    if (!key) continue;
    const title = cellStr(row, "title", "عنوان");
    const text = cellStr(row, "text", "متن");
    if (!title && !text) continue; // empty promo → skip
    if (isClearMarker(text) || isClearMarker(title)) {
      await setSetting(key.startsWith("promo_") ? key : `promo_${key}`, "");
      result.promos++;
      continue;
    }
    const payload = JSON.stringify({ title, text });
    await setSetting(key.startsWith("promo_") ? key : `promo_${key}`, payload);
    result.promos++;
  }

  // ── Channels ──
  // Sheet missing or only empty rows → keep existing channels.
  // Any real username row → REPLACE the whole channel list with rows present.
  const channelRows = sheetRows(wb, "کانال‌ها");
  if (channelRows.length) {
    const channels: ChannelConfig[] = [];
    for (const row of channelRows) {
      const username = cellStr(row, "username", "یوزرنیم").replace(/^@/, "");
      if (!username) continue;
      if (isClearMarker(username)) continue;
      channels.push({ username, required: cellBool(row, "required", true) });
    }
    if (channels.length) {
      await saveChannels(channels);
      result.channels = channels.length;
    }
  }

  // ── Sales categories ──
  // Sheet with rows → update only listed categories; unlisted keep previous defaults merge
  const catRows = sheetRows(wb, "دسته‌های فروش");
  if (catRows.length) {
    const cats = await getSalesCategories();
    let touched = false;
    for (const row of catRows) {
      const c = cellStr(row, "category", "دسته").toLowerCase();
      if (c !== "data" && c !== "national" && c !== "unlimited") continue;
      const enabledRaw = row["enabled"] ?? row["فعال"];
      if (enabledRaw === undefined || enabledRaw === null || String(enabledRaw).trim() === "") {
        continue; // empty enabled → don't change this category
      }
      cats[c] = cellBool(row, "enabled", true);
      touched = true;
    }
    if (touched) {
      await saveSalesCategories(cats);
      result.salesCategories = true;
    }
  }

  // ── Rates ──
  const rateRows = sheetRows(wb, "نرخ‌ها");
  if (rateRows.length) {
    const rates = await getPriceRates();
    let touched = false;
    for (const row of rateRows) {
      const role = cellStr(row, "role", "نقش").toLowerCase();
      if (role !== "user" && role !== "partner" && role !== "wholesale") continue;
      const category = cellStr(row, "category", "دسته").toLowerCase();
      const perGb = cellNum(row, "perGb");
      const perMonth = cellNum(row, "perMonth");
      const unlimitedPerMonth = cellNum(row, "unlimitedPerMonth");
      if (perGb === null && perMonth === null && unlimitedPerMonth === null) continue;

      if (category && category !== "unlimited") {
        if (!rates.categories[category]) rates.categories[category] = {};
        rates.categories[category][role] = {
          ...(rates.categories[category][role] ?? {}),
          ...(perGb != null ? { perGb } : {}),
          ...(perMonth != null ? { perMonth } : {}),
        };
      }
      rates[role] = {
        perGb: perGb ?? rates[role].perGb,
        perMonth: perMonth ?? rates[role].perMonth,
        unlimitedPerMonth: unlimitedPerMonth ?? rates[role].unlimitedPerMonth,
      };
      touched = true;
    }
    if (touched) {
      await savePriceRates(rates);
      result.rates = true;
    }
  }

  // ── Prices ──
  const priceRows = sheetRows(wb, "قیمت‌ها");
  if (priceRows.length) {
    if (replacePrices) {
      await prisma.priceCell.deleteMany({});
      result.pricesCleared = true;
    }
    for (const row of priceRows) {
      const categoryRaw = cellStr(row, "category", "دسته").toLowerCase() || "data";
      const category: PlanCategory =
        categoryRaw === "national" || categoryRaw === "unlimited" ? categoryRaw : "data";
      let trafficGb = cellNum(row, "trafficGb");
      if (category === "unlimited") trafficGb = null;
      const months = cellNum(row, "months") ?? 1;
      const priceUser = cellNum(row, "priceUser");
      const pricePartner = cellNum(row, "pricePartner");
      const priceWholesale = cellNum(row, "priceWholesale") ?? 0;
      if (priceUser === null || pricePartner === null) {
        result.warnings.push(`ردیف قیمت ناقص: ${category}/${trafficGb}/${months}`);
        continue;
      }
      await prisma.priceCell.create({
        data: {
          category,
          trafficGb,
          months: Math.max(1, Math.min(12, Math.floor(months))),
          priceUser: Math.floor(priceUser),
          pricePartner: Math.floor(pricePartner),
          priceWholesale: Math.floor(priceWholesale),
          isGolden: cellBool(row, "isGolden", false),
          title: cellStr(row, "title", "عنوان") || null,
          active: cellBool(row, "active", true),
          sortOrder: (trafficGb ?? 999) * 10 + months,
        },
      });
      result.prices++;
    }
  }

  // ── Panels ──
  const panelRows = sheetRows(wb, "سرورهای پنل");
  for (const row of panelRows) {
    const name = cellStr(row, "name", "نام");
    const baseUrl = cellStr(row, "baseUrl", "url");
    if (!name || !baseUrl) continue;
    const apiToken = cellStr(row, "apiToken", "token");
    const inboundIds = cellStr(row, "inboundIds", "inbounds") || "1";
    const subBase = cellStr(row, "subBase") || null;
    const catsRaw = cellStr(row, "categories", "دسته‌ها");
    const categories: PanelCategories = catsRaw
      ? (catsRaw
          .split(/[,،\s]+/)
          .map((c) => c.trim())
          .filter((c) => c === "data" || c === "national" || c === "unlimited") as PanelCategories)
      : ["data", "unlimited"];
    const weight = cellNum(row, "weight") ?? 100;
    const active = cellBool(row, "active", true);
    const sellEnabled = cellBool(row, "sellEnabled", true);

    const existing = (await listPanelServers()).find(
      (p) => p.name === name || p.baseUrl.replace(/\/$/, "") === baseUrl.replace(/\/$/, ""),
    );

    if (existing) {
      await updatePanelServer(existing.id, {
        name,
        baseUrl,
        ...(apiToken ? { apiToken } : {}),
        inboundIds,
        subBase,
        categories,
        weight,
        active,
        sellEnabled,
      });
      if (!apiToken && !existing.apiToken) {
        result.warnings.push(`سرور «${name}»: توکن خالی است — در ربات پر کنید`);
      }
    } else {
      const token = apiToken || "CHANGE_ME";
      if (!apiToken) {
        result.warnings.push(`سرور «${name}»: با توکن موقت ساخته شد — حتماً Token را در کنترل سنتر عوض کنید`);
      }
      await createPanelServer({
        name,
        baseUrl,
        apiToken: token,
        inboundIds,
        subBase,
        categories,
        weight,
        active,
        sellEnabled,
      });
    }
    result.panels++;
  }

  return result;
}

export function formatImportResult(r: ImportResult): string {
  return [
    "✅ ورود از اکسل انجام شد",
    "",
    `⚙️ تنظیمات: ${r.settings}`,
    `📢 کانال‌ها: ${r.channels}`,
    `💰 قیمت‌ها: ${r.prices}${r.pricesCleared ? " (قبلی‌ها پاک شد)" : ""}`,
    `📐 نرخ‌ها: ${r.rates ? "به‌روز شد" : "—"}`,
    `🏷 دسته‌های فروش: ${r.salesCategories ? "به‌روز شد" : "—"}`,
    `📣 پیام‌های تبلیغ: ${r.promos}`,
    `📖 آموزش: ${r.guides}`,
    `🖥 سرورهای پنل: ${r.panels}`,
    r.warnings.length ? `\n⚠️ هشدارها:\n${r.warnings.map((w) => `• ${w}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
