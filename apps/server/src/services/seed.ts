import { prisma } from "../db.js";
import { ensureDefaultSettings } from "./settings.js";

const defaultPlans = [
  { title: "۱۰ گیگ", trafficGb: 10, durationDays: 30, priceUser: 150_000, pricePartner: 120_000, sortOrder: 10 },
  { title: "۱۵ گیگ", trafficGb: 15, durationDays: 30, priceUser: 220_000, pricePartner: 170_000, sortOrder: 20 },
  { title: "۲۵ گیگ", trafficGb: 25, durationDays: 30, priceUser: 330_000, pricePartner: 260_000, sortOrder: 30 },
  { title: "۳۵ گیگ", trafficGb: 35, durationDays: 30, priceUser: 450_000, pricePartner: 350_000, sortOrder: 40 },
  { title: "۵۰ گیگ", trafficGb: 50, durationDays: 30, priceUser: 650_000, pricePartner: 500_000, sortOrder: 50 },
  { title: "نامحدود", trafficGb: null, durationDays: 30, priceUser: 1_500_000, pricePartner: 1_200_000, sortOrder: 60 },
];

export async function seedIfNeeded() {
  await ensureDefaultSettings();

  const count = await prisma.plan.count();
  if (count === 0) {
    await prisma.plan.createMany({ data: defaultPlans });
    console.log(`seeded ${defaultPlans.length} plans`);
  }
}
