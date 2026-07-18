import { prisma } from "../db.js";
import { ensureDefaultSettings } from "./settings.js";

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

export async function seedIfNeeded() {
  await ensureDefaultSettings();

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
}
