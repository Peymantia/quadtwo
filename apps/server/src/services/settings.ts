import { prisma } from "../db.js";

const defaults: Record<string, string> = {
  brand_name: "Piing",
  channel_username: "",
  channel_required: "false",
  card_number: "6037-0000-0000-0000",
  card_holder: "Card Holder",
  welcome_text: "به فروشگاه اشتراک خوش آمدید.",
  support_username: "",
  support_telegram_id: "",
  miniapp_url: "",
  xui_inbound_ids: "1,2,3,4,5,6,7,8,9,10",
  guide_text: "آموزش اتصال به‌زودی اینجا قرار می‌گیرد.\nمی‌توانید از پشتیبانی لینک آموزش را بگیرید.",
  guide_url: "",
  test_service_enabled: "false",
  national_service_note: "سرویس ویژه اینترنت ملی به‌زودی فعال می‌شود.",
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
