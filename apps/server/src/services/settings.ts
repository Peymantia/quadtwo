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
  backup_config: JSON.stringify({
    enabled: true,
    hour: 3,
    minute: 0,
    lastAt: "",
    lastStatus: "",
  }),
  notif_config: JSON.stringify(defaultNotifConfig()),
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
