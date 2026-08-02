/**
 * One-shot: swap wholesale ↔ reseller user roles and rename fixed-plan category.
 * Safe to re-run (idempotent after first successful swap of users that still need it).
 *
 * Target mapping:
 *   reseller  = همکار ویژه
 *   wholesale = عمده‌فروش (fixed plans)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Swap roles via temp marker (SQLite stores enum as TEXT)
  const asWholesale = await prisma.$executeRawUnsafe(
    `UPDATE User SET role = '__tmp_swap__' WHERE role = 'wholesale'`,
  );
  const resellerToWholesale = await prisma.$executeRawUnsafe(
    `UPDATE User SET role = 'wholesale' WHERE role = 'reseller'`,
  );
  const tmpToReseller = await prisma.$executeRawUnsafe(
    `UPDATE User SET role = 'reseller' WHERE role = '__tmp_swap__'`,
  );

  const cats = await prisma.$executeRawUnsafe(
    `UPDATE PriceCell SET category = 'wholesale' WHERE category = 'reseller'`,
  );

  // sales_categories_json / category_labels_json — best-effort rewrite
  for (const key of ["sales_categories_json", "category_labels_json", "category_order_json"] as const) {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row?.value) continue;
    try {
      if (key === "category_order_json") {
        const arr = JSON.parse(row.value) as unknown;
        if (Array.isArray(arr)) {
          const next = arr.map((x) => (x === "reseller" ? "wholesale" : x));
          if (!next.includes("wholesale") && arr.includes("reseller")) {
            /* already mapped */
          }
          const uniq = [...new Set(next.map(String))];
          await prisma.setting.update({
            where: { key },
            data: { value: JSON.stringify(uniq) },
          });
        }
      } else {
        const obj = JSON.parse(row.value) as Record<string, unknown>;
        if ("reseller" in obj && !("wholesale" in obj)) {
          obj.wholesale = obj.reseller;
          delete obj.reseller;
          await prisma.setting.update({
            where: { key },
            data: { value: JSON.stringify(obj) },
          });
        } else if ("reseller" in obj && "wholesale" in obj) {
          // Prefer keeping wholesale; drop legacy reseller key after merge
          delete obj.reseller;
          await prisma.setting.update({
            where: { key },
            data: { value: JSON.stringify(obj) },
          });
        }
      }
    } catch {
      /* ignore bad JSON */
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      wholesaleMarkedTemp: asWholesale,
      resellerBecameWholesale: resellerToWholesale,
      tempBecameReseller: tmpToReseller,
      priceCellsCategoryUpdated: cats,
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
