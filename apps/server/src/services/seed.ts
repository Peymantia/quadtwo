import { prisma } from "../db.js";
import { ensureDefaultSettings } from "./settings.js";

/** 1-month base prices; 2/3 month get volume discounts */
const month1: Array<{ trafficGb: number | null; priceUser: number; pricePartner: number }> = [
  { trafficGb: 10, priceUser: 150_000, pricePartner: 120_000 },
  { trafficGb: 15, priceUser: 220_000, pricePartner: 170_000 },
  { trafficGb: 20, priceUser: 280_000, pricePartner: 220_000 },
  { trafficGb: 25, priceUser: 330_000, pricePartner: 260_000 },
  { trafficGb: 30, priceUser: 390_000, pricePartner: 310_000 },
  { trafficGb: 35, priceUser: 450_000, pricePartner: 350_000 },
  { trafficGb: 40, priceUser: 510_000, pricePartner: 400_000 },
  { trafficGb: 45, priceUser: 580_000, pricePartner: 450_000 },
  { trafficGb: 50, priceUser: 650_000, pricePartner: 500_000 },
  { trafficGb: null, priceUser: 1_500_000, pricePartner: 1_200_000 },
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
          priceUser: scale(row.priceUser, m),
          pricePartner: scale(row.pricePartner, m),
          sortOrder: (row.trafficGb ?? 999) * 10 + m,
          active: true,
        });
      }
    }
    await prisma.priceCell.createMany({ data: rows });
    console.log(`seeded ${rows.length} price matrix cells`);
  }
}
