import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import { isDemoMode } from "./license.js";
import { PLATFORM_TENANT_SLUG } from "./tenant-context.js";
import { isEmojiStyle, type EmojiStyle } from "./emoji-pack.js";
import { normalizeUiSkin } from "./settings.js";

export type DemoAppearance = {
  emoji_style: EmojiStyle;
  ui_skin: "classic" | "studio" | "deur";
  ui_color_mode: "system" | "dark" | "light" | "telegram";
};

const KEYS = ["emoji_style", "ui_skin", "ui_color_mode"] as const;

const DEFAULTS: DemoAppearance = {
  emoji_style: "premium",
  ui_skin: "studio",
  ui_color_mode: "system",
};

/** Absolute path to demo.db when this process is the production shop (not the sidecar). */
export function resolveDemoDatabaseUrl(): string | null {
  if (isDemoMode()) return null;

  const fromEnv = (process.env.DEMO_DATABASE_URL || "").trim();
  if (fromEnv) {
    return fromEnv.startsWith("file:") ? fromEnv : `file:${path.resolve(fromEnv)}`;
  }

  const candidates: string[] = [];
  const main = env.DATABASE_URL || "";
  if (main.startsWith("file:")) {
    let p = main.slice("file:".length);
    if (p.startsWith("./") || !path.isAbsolute(p)) p = path.resolve(process.cwd(), p);
    candidates.push(path.join(path.dirname(p), "demo.db"));
  }
  candidates.push(
    path.resolve(process.cwd(), "data", "demo.db"),
    path.resolve(process.cwd(), "apps", "server", "data", "demo.db"),
    path.resolve(process.cwd(), "apps", "server", "prisma", "demo.db"),
  );

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return `file:${file}`;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function openDemoClient(url: string) {
  return new PrismaClient({ datasources: { db: { url } } });
}

async function platformTenantId(client: PrismaClient): Promise<string | null> {
  const t =
    (await client.tenant.findFirst({
      where: { OR: [{ isPlatform: true }, { slug: PLATFORM_TENANT_SLUG }] },
    })) ?? (await client.tenant.findFirst({ orderBy: { createdAt: "asc" } }));
  return t?.id ?? null;
}

function parseAppearance(map: Record<string, string>): DemoAppearance {
  const style = map.emoji_style;
  const skin = map.ui_skin;
  const mode = map.ui_color_mode;
  return {
    emoji_style: isEmojiStyle(style) ? style : DEFAULTS.emoji_style,
    ui_skin: normalizeUiSkin(skin),
    ui_color_mode:
      mode === "light" || mode === "dark" || mode === "system" || mode === "telegram"
        ? mode
        : DEFAULTS.ui_color_mode,
  };
}

/** Read emoji/theme settings from the demo sidecar DB (production admin only). */
export async function getDemoAppearance(): Promise<
  { available: false } | ({ available: true } & DemoAppearance)
> {
  const url = resolveDemoDatabaseUrl();
  if (!url) return { available: false };

  const client = openDemoClient(url);
  try {
    const tenantId = await platformTenantId(client);
    if (!tenantId) return { available: true, ...DEFAULTS };

    const rows = await client.setting.findMany({
      where: { tenantId, key: { in: [...KEYS] } },
    });
    const map: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) map[r.key] = r.value;
    return { available: true, ...parseAppearance(map) };
  } catch (err) {
    console.warn("[demo-appearance] read failed:", err);
    return { available: false };
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

/** Write emoji/theme settings into the demo sidecar DB (production admin only). */
export async function setDemoAppearance(
  patch: Partial<DemoAppearance>,
): Promise<{ available: false } | ({ available: true } & DemoAppearance)> {
  const url = resolveDemoDatabaseUrl();
  if (!url) return { available: false };

  const client = openDemoClient(url);
  try {
    let tenantId = await platformTenantId(client);
    if (!tenantId) {
      throw new Error("tenant پلتفرم در دیتابیس دمو پیدا نشد — یک‌بار q2 demo restart بزنید");
    }

    const rows = await client.setting.findMany({
      where: { tenantId, key: { in: [...KEYS] } },
    });
    const map: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) map[r.key] = r.value;
    const current = parseAppearance(map);
    const merged: DemoAppearance = {
      emoji_style: patch.emoji_style ?? current.emoji_style,
      ui_skin: patch.ui_skin ?? current.ui_skin,
      ui_color_mode: patch.ui_color_mode ?? current.ui_color_mode,
    };

    for (const key of KEYS) {
      const value = merged[key];
      await client.setting.upsert({
        where: { tenantId_key: { tenantId, key } },
        create: { tenantId, key, value },
        update: { value },
      });
    }
    // Let demo admins change later without our first-run seed re-forcing
    await client.setting.upsert({
      where: { tenantId_key: { tenantId, key: "demo_appearance_seeded" } },
      create: { tenantId, key: "demo_appearance_seeded", value: "1" },
      update: { value: "1" },
    });
    return { available: true, ...merged };
  } catch (err) {
    console.warn("[demo-appearance] write failed:", err);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

/**
 * On the demo process itself: ensure showcase defaults once
 * (premium emoji + studio skin) without overwriting admin choices later.
 */
export async function ensureDemoShowcaseAppearanceDefaults() {
  if (!isDemoMode()) return;
  const { getSetting, setSetting } = await import("./settings.js");
  const { setEmojiStyle, clearEmojiStyleCache } = await import("./emoji-transform.js");

  const marked = await getSetting("demo_appearance_seeded");
  if (marked === "1") return;

  const styleRow = await getSetting("emoji_style");
  // defaults helper returns "universal" even when unset — only seed if never written
  // or still on factory universal; marker prevents re-forcing after admin picks universal
  if (styleRow === "universal" || !styleRow) {
    await setEmojiStyle("premium");
  }
  const skin = await getSetting("ui_skin");
  if (!skin || skin === "classic") {
    await setSetting("ui_skin", "studio");
  }
  const mode = await getSetting("ui_color_mode");
  if (!mode) {
    await setSetting("ui_color_mode", "system");
  }
  await setSetting("demo_appearance_seeded", "1");
  clearEmojiStyleCache();
  console.log("[demo] showcase appearance defaults applied (premium + studio)");
}
