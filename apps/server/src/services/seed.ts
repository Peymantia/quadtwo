import { prisma } from "../db.js";
import { isDemoMode } from "./license.js";
import { upsertPriceCell } from "./pricing.js";
import { WHOLESALE_FIXED_CATEGORY } from "./roles.js";
import {
  ensureDefaultSettings,
  getCategoryLabels,
  getCategoryOrder,
  getChannels,
  getPriceRates,
  getSalesCategories,
  saveCategoryLabels,
  saveCategoryOrder,
  saveChannels,
  saveSalesCategories,
  setSetting,
} from "./settings.js";

const month1: Array<{
  trafficGb: number | null;
  priceUser: number;
  pricePartner: number;
  priceWholesale: number;
  category: string;
}> = [
  { trafficGb: 10, priceUser: 150_000, pricePartner: 120_000, priceWholesale: 100_000, category: "data" },
  { trafficGb: 15, priceUser: 220_000, pricePartner: 170_000, priceWholesale: 140_000, category: "data" },
  { trafficGb: 20, priceUser: 280_000, pricePartner: 220_000, priceWholesale: 180_000, category: "data" },
  { trafficGb: 25, priceUser: 330_000, pricePartner: 260_000, priceWholesale: 210_000, category: "data" },
  { trafficGb: 30, priceUser: 390_000, pricePartner: 310_000, priceWholesale: 250_000, category: "data" },
  { trafficGb: 35, priceUser: 450_000, pricePartner: 350_000, priceWholesale: 280_000, category: "data" },
  { trafficGb: 40, priceUser: 510_000, pricePartner: 400_000, priceWholesale: 320_000, category: "data" },
  { trafficGb: 45, priceUser: 580_000, pricePartner: 450_000, priceWholesale: 360_000, category: "data" },
  { trafficGb: 50, priceUser: 650_000, pricePartner: 500_000, priceWholesale: 400_000, category: "data" },
  { trafficGb: null, priceUser: 1_500_000, pricePartner: 1_200_000, priceWholesale: 1_000_000, category: "unlimited" },
  { trafficGb: 30, priceUser: 200_000, pricePartner: 160_000, priceWholesale: 130_000, category: "national" },
  { trafficGb: 50, priceUser: 300_000, pricePartner: 240_000, priceWholesale: 200_000, category: "national" },
];

function scale(base: number, months: number) {
  if (months === 1) return base;
  if (months === 2) return Math.round(base * 1.85);
  return Math.round(base * 2.55);
}

/** ∞GB belongs under unlimited or fixed offer — strip bad VIP/national rows. */
export async function cleanupInvalidUnlimitedCells() {
  const result = await prisma.priceCell.deleteMany({
    where: { trafficGb: null, NOT: { category: { in: ["unlimited", "offer"] } } },
  });
  if (result.count > 0) {
    console.log(`removed ${result.count} invalid ∞GB price cell(s) outside unlimited/offer`);
  }
}

/** Turn on unlimited sales when rates or matrix unlimited plans already exist. */
export async function ensureUnlimitedSalesEnabled() {
  const cats = await getSalesCategories();
  if (cats.unlimited) return;
  const rates = await getPriceRates();
  const hasRate =
    rates.user.unlimitedPerMonth > 0 ||
    rates.partner.unlimitedPerMonth > 0 ||
    rates.wholesale.unlimitedPerMonth > 0;
  const matrixCount = await prisma.priceCell.count({
    where: { category: "unlimited", active: true },
  });
  if (!hasRate && matrixCount === 0) return;
  await saveSalesCategories({ ...cats, unlimited: true });
  console.log("enabled unlimited in sales_categories (pricing already configured)");
}

/** Demo showcase must stay open to any Telegram visitor — never force channel join. */
async function disableForcedChannelsInDemo() {
  if (!isDemoMode()) return;
  await setSetting("channel_required", "false");
  try {
    const channels = await getChannels();
    if (channels.some((c) => c.required)) {
      await saveChannels(channels.map((c) => ({ ...c, required: false })));
      console.log("[demo] cleared forced channel join (showcase must stay open)");
    }
  } catch (err) {
    console.warn("[demo] could not clear channel force flags:", err);
  }
}

/** Fold legacy `reseller` category into `wholesale` and keep sales settings clean. */
export async function ensureWholesaleCategoryCanonical() {
  const renamed = await prisma.priceCell.updateMany({
    where: { category: "reseller" },
    data: { category: WHOLESALE_FIXED_CATEGORY },
  });
  if (renamed.count > 0) {
    console.log(`renamed ${renamed.count} price cell(s) reseller → wholesale`);
  }

  const cats = await getSalesCategories();
  {
    const next = { ...cats, wholesale: true as boolean };
    delete (next as Record<string, unknown>).reseller;
    await saveSalesCategories(next);
  }

  const labels = await getCategoryLabels();
  {
    const next = { ...labels, wholesale: labels.wholesale || "پلن‌های عمده‌فروش" };
    delete (next as Record<string, unknown>).reseller;
    await saveCategoryLabels(next);
  }

  const order = await getCategoryOrder();
  {
    const next = order.map((k) => (k === "reseller" ? "wholesale" : k));
    if (!next.includes("wholesale")) next.push("wholesale");
    await saveCategoryOrder([...new Set(next)]);
  }
}

/** Admin-defined fixed plans for عمده‌فروش (upsert by GB/months). */
export async function ensureWholesaleDefaultPlans() {
  const plans: Array<{
    trafficGb: number;
    months: number;
    limitIp: number;
    priceReseller: number;
    title: string;
  }> = [
    { trafficGb: 100, months: 1, limitIp: 1, priceReseller: 150_000, title: "۱۰۰ گیگ · تک‌کاربره" },
    { trafficGb: 200, months: 1, limitIp: 2, priceReseller: 250_000, title: "۲۰۰ گیگ · دوکاربره" },
    { trafficGb: 300, months: 1, limitIp: 2, priceReseller: 400_000, title: "۳۰۰ گیگ · دوکاربره" },
  ];

  for (const p of plans) {
    await upsertPriceCell({
      trafficGb: p.trafficGb,
      months: p.months,
      category: WHOLESALE_FIXED_CATEGORY,
      title: p.title,
      limitIp: p.limitIp,
      priceUser: p.priceReseller,
      pricePartner: p.priceReseller,
      priceWholesale: p.priceReseller,
      priceReseller: p.priceReseller,
    });
  }
  console.log(`ensured ${plans.length} wholesale fixed plans`);
}

export async function seedIfNeeded() {
  await ensureDefaultSettings();
  await disableForcedChannelsInDemo();
  await cleanupInvalidUnlimitedCells();
  await ensureUnlimitedSalesEnabled();

  const count = await prisma.priceCell.count();
  if (count === 0) {
    const rows = [];
    for (const m of [1, 2, 3]) {
      for (const row of month1) {
        rows.push({
          trafficGb: row.trafficGb,
          months: m,
          category: row.category,
          priceUser: scale(row.priceUser, m),
          pricePartner: scale(row.pricePartner, m),
          priceWholesale: scale(row.priceWholesale, m),
          sortOrder: (row.trafficGb ?? 999) * 10 + m,
          active: true,
          isGolden: false,
        });
      }
    }
    // mark one golden
    rows.push({
      trafficGb: 50,
      months: 1,
      category: "data",
      priceUser: 550_000,
      pricePartner: 450_000,
      priceWholesale: 380_000,
      sortOrder: 1,
      active: true,
      isGolden: true,
      title: "پیشنهاد ویژه ۵۰ گیگ",
    });
    await prisma.priceCell.createMany({ data: rows });
    console.log(`seeded ${rows.length} price matrix cells`);
  }

  await ensureWholesaleCategoryCanonical();
  await ensureWholesaleDefaultPlans();
}
