import type { PanelServer } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { XuiClient, createXuiFromEnv } from "../panel/xui-client.js";
import { formatXuiError } from "../panel/xui-errors.js";
import { parseInboundIds } from "./inbounds.js";
import type { PlanCategory } from "./pricing.js";
import { isValidSubBase, normalizeSubBase, sanitizeSubBase, wasContaminatedSubBase } from "./sub-url.js";
import { isDemoMode } from "./license.js";

function assertNotDemoPanel() {
  if (isDemoMode()) {
    throw new Error("DEMO_MODE: ارتباط با پنل 3x-ui کاملاً قطع است");
  }
}

export type PanelCategories = PlanCategory[];

export function parsePanelCategories(raw: string): PanelCategories {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return ["data", "unlimited"];
    const out: PanelCategories = [];
    for (const c of arr) {
      if (typeof c === "string" && c.trim()) out.push(c.trim());
    }
    return out;
  } catch {
    return ["data", "unlimited"];
  }
}

export function stringifyPanelCategories(cats: PanelCategories) {
  return JSON.stringify([...new Set(cats)]);
}

export function panelInboundIds(panel: Pick<PanelServer, "inboundIds">): number[] {
  return parseInboundIds(panel.inboundIds || "1");
}

export function createXuiFromPanel(panel: Pick<PanelServer, "baseUrl" | "apiToken">) {
  assertNotDemoPanel();
  if (!panel.baseUrl?.trim() || !panel.apiToken?.trim()) {
    throw new Error(formatXuiError("آدرس یا توکن پنل ناقص است"));
  }
  return new XuiClient({
    baseUrl: panel.baseUrl.trim(),
    apiToken: panel.apiToken.trim(),
  });
}

/** Env-based fallback when no PanelServer rows exist (legacy install). */
export function envPanelSnapshot(): {
  name: string;
  baseUrl: string;
  apiToken: string;
  inboundIds: string;
  /** Sanitized base only (never a full client subscription URL). */
  subBase: string | null;
  /** True when XUI_SUB_BASE looked like a pasted full client link and was stripped. */
  subBaseWasContaminated: boolean;
  categories: string;
} | null {
  if (!env.XUI_BASE_URL?.trim() || !env.XUI_API_TOKEN?.trim()) return null;
  const inboundIds =
    env.XUI_INBOUND_IDS?.trim() ||
    (env.XUI_INBOUND_ID ? String(env.XUI_INBOUND_ID) : "1");
  const rawSub = env.XUI_SUB_BASE?.trim() || null;
  const contaminated = wasContaminatedSubBase(rawSub);
  return {
    name: "سرور اصلی",
    baseUrl: env.XUI_BASE_URL.trim(),
    apiToken: env.XUI_API_TOKEN.trim(),
    inboundIds,
    // Full client URLs in XUI_SUB_BASE break every new sub — leave empty and use 3x-ui subURI
    subBase: contaminated ? null : sanitizeSubBase(rawSub),
    subBaseWasContaminated: contaminated,
    categories: stringifyPanelCategories(["data", "national", "unlimited"]),
  };
}

/**
 * Strip pasted full-client sub URLs from PanelServer.subBase.
 * Contaminated values (…/info/<clientId>) are cleared so 3x-ui subURI is used.
 */
export async function repairPanelSubBases(): Promise<{ fixed: number }> {
  const panels = await prisma.panelServer.findMany({
    select: { id: true, subBase: true },
  });
  let fixed = 0;
  for (const p of panels) {
    const raw = p.subBase?.trim() || "";
    if (!raw) continue;
    if (wasContaminatedSubBase(raw) || !isValidSubBase(raw)) {
      await prisma.panelServer.update({
        where: { id: p.id },
        data: { subBase: null },
      });
      fixed += 1;
      continue;
    }
    const cleaned = sanitizeSubBase(raw);
    if (!cleaned || cleaned === normalizeSubBase(raw)) continue;
    await prisma.panelServer.update({
      where: { id: p.id },
      data: { subBase: cleaned },
    });
    fixed += 1;
  }
  return { fixed };
}

export async function listPanelServers() {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  return prisma.panelServer.findMany({
    where: { tenantId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function getPanelServer(id: string) {
  return prisma.panelServer.findUnique({ where: { id } });
}

export async function importPanelFromEnv() {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const snap = envPanelSnapshot();
  if (!snap) throw new Error("در .env مقدار XUI_BASE_URL و XUI_API_TOKEN یافت نشد");

  // Always heal any contaminated sub bases first
  await repairPanelSubBases();

  const normalizedBase = snap.baseUrl.replace(/\/+$/, "");
  const existing = await prisma.panelServer.findFirst({
    where: {
      tenantId,
      OR: [{ baseUrl: snap.baseUrl }, { baseUrl: `${normalizedBase}/` }, { baseUrl: normalizedBase }],
    },
  });
  if (existing) {
    const data: {
      apiToken: string;
      inboundIds: string;
      active: boolean;
      sellEnabled: boolean;
      subBase?: string | null;
    } = {
      apiToken: snap.apiToken,
      inboundIds: snap.inboundIds,
      active: true,
      sellEnabled: true,
    };
    if (snap.subBase != null) data.subBase = snap.subBase;
    else if (snap.subBaseWasContaminated) data.subBase = null;
    return prisma.panelServer.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.panelServer.create({
    data: {
      tenantId,
      name: snap.name,
      baseUrl: snap.baseUrl.replace(/\/?$/, "/"),
      apiToken: snap.apiToken,
      inboundIds: snap.inboundIds,
      subBase: snap.subBase,
      categories: snap.categories,
      active: true,
      sellEnabled: true,
      weight: 100,
    },
  });
}

export async function createPanelServer(input: {
  name: string;
  baseUrl: string;
  apiToken: string;
  inboundIds?: string;
  subBase?: string | null;
  categories?: PanelCategories;
  weight?: number;
  active?: boolean;
  sellEnabled?: boolean;
}) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const name = input.name.trim();
  const baseUrl = input.baseUrl.trim().replace(/\/?$/, "/");
  if (!name) throw new Error("نام سرور الزامی است");
  if (!baseUrl) throw new Error("آدرس پنل الزامی است");
  if (!input.apiToken.trim()) throw new Error("API Token الزامی است");

  return prisma.panelServer.create({
    data: {
      tenantId,
      name,
      baseUrl,
      apiToken: input.apiToken.trim(),
      inboundIds: input.inboundIds?.trim() || "1",
      subBase: sanitizeSubBase(input.subBase) ?? null,
      categories: stringifyPanelCategories(input.categories ?? ["data", "unlimited"]),
      weight: Math.max(1, Math.min(1000, input.weight ?? 100)),
      active: input.active ?? true,
      sellEnabled: input.sellEnabled ?? true,
    },
  });
}

export async function updatePanelServer(
  id: string,
  input: Partial<{
    name: string;
    baseUrl: string;
    apiToken: string;
    inboundIds: string;
    subBase: string | null;
    categories: PanelCategories;
    weight: number;
    active: boolean;
    sellEnabled: boolean;
  }>,
) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl.trim().replace(/\/?$/, "/");
  if (input.apiToken !== undefined && input.apiToken.trim()) data.apiToken = input.apiToken.trim();
  if (input.inboundIds !== undefined) data.inboundIds = input.inboundIds.trim() || "1";
  if (input.subBase !== undefined) {
    const raw = input.subBase?.trim() || "";
    if (!raw || raw === "-") {
      data.subBase = null;
    } else {
      const clean = sanitizeSubBase(raw);
      if (!clean) {
        throw new Error(
          "Sub base نامعتبر است. باید با http(s) و مسیر باشد، مثلاً:\nhttps://claude.anthropics.ir:65535/info/\n(دامنه Mini App مثل app.piing.ir قبول نمی‌شود)",
        );
      }
      data.subBase = clean;
    }
  }
  if (input.categories !== undefined) data.categories = stringifyPanelCategories(input.categories);
  if (input.weight !== undefined) data.weight = Math.max(1, Math.min(1000, input.weight));
  if (input.active !== undefined) data.active = input.active;
  if (input.sellEnabled !== undefined) data.sellEnabled = input.sellEnabled;

  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const existing = await prisma.panelServer.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error("سرور پنل یافت نشد");
  return prisma.panelServer.update({ where: { id }, data });
}

export async function deletePanelServer(id: string) {
  const total = await prisma.panelServer.count();
  if (total <= 1) {
    throw new Error("حداقل یک سرور باید در سیستم باقی بماند");
  }
  const used = await prisma.subscription.count({ where: { panelServerId: id } });
  if (used > 0) {
    throw new Error(`این سرور ${used} اشتراک دارد. ابتدا اشتراک‌ها را منتقل یا غیرفعال کنید.`);
  }
  return prisma.panelServer.delete({ where: { id } });
}

export async function testPanelConnection(panel: Pick<PanelServer, "baseUrl" | "apiToken">) {
  const xui = createXuiFromPanel(panel);
  const list = await xui.listInbounds();
  const count = Array.isArray(list.obj) ? list.obj.length : 0;
  return { ok: true as const, inboundCount: count };
}

function pickWeighted(panels: PanelServer[]): PanelServer {
  if (panels.length === 1) return panels[0]!;
  const total = panels.reduce((s, p) => s + Math.max(1, p.weight), 0);
  let r = Math.random() * total;
  for (const p of panels) {
    r -= Math.max(1, p.weight);
    if (r <= 0) return p;
  }
  return panels[panels.length - 1]!;
}

/**
 * Resolve which panel to use for a sales category.
 * Prefers DB PanelServer rows; falls back to env singleton.
 */
export async function resolvePanelForCategory(category: PlanCategory): Promise<{
  panel: PanelServer | null;
  xui: XuiClient;
  inboundIds: number[];
  subBase: string | null;
  name: string;
}> {
  assertNotDemoPanel();
  const all = await prisma.panelServer.findMany({
    where: { active: true, sellEnabled: true },
  });

  const matching = all.filter((p) => parsePanelCategories(p.categories).includes(category));

  if (matching.length) {
    const panel = pickWeighted(matching);
    return {
      panel,
      xui: createXuiFromPanel(panel),
      inboundIds: panelInboundIds(panel),
      subBase: sanitizeSubBase(panel.subBase),
      name: panel.name,
    };
  }

  // No DB panels for this category — use env if available
  if (all.length === 0) {
    const snap = envPanelSnapshot();
    if (snap) {
      return {
        panel: null,
        xui: createXuiFromEnv(env),
        inboundIds: parseInboundIds(snap.inboundIds),
        subBase: sanitizeSubBase(snap.subBase),
        name: snap.name,
      };
    }
  }

  throw new Error(
    `هیچ پنل فعالی برای دسته «${category}» تعریف نشده. در کنترل سنتر → سرورهای پنل یک سرور با این دسته اضافه کنید.`,
  );
}

/** Client for an existing subscription (renew / live / toggle). */
export async function resolvePanelForSubscription(sub: {
  panelServerId: string | null;
}): Promise<{
  panel: PanelServer | null;
  xui: XuiClient;
  inboundIds: number[];
  subBase: string | null;
  name: string;
}> {
  assertNotDemoPanel();
  if (sub.panelServerId) {
    const panel = await prisma.panelServer.findUnique({ where: { id: sub.panelServerId } });
    if (panel) {
      return {
        panel,
        xui: createXuiFromPanel(panel),
        inboundIds: panelInboundIds(panel),
        subBase: sanitizeSubBase(panel.subBase),
        name: panel.name,
      };
    }
  }

  // Legacy subs without panelServerId → env / first active panel
  const first = await prisma.panelServer.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  if (first) {
    return {
      panel: first,
      xui: createXuiFromPanel(first),
      inboundIds: panelInboundIds(first),
      subBase: sanitizeSubBase(first.subBase),
      name: first.name,
    };
  }

  const snap = envPanelSnapshot();
  if (!snap) {
    throw new Error(formatXuiError("XUI_BASE_URL and XUI_API_TOKEN are not set"));
  }
  return {
    panel: null,
    xui: createXuiFromEnv(env),
    inboundIds: parseInboundIds(snap.inboundIds),
    subBase: sanitizeSubBase(snap.subBase),
    name: snap.name,
  };
}

export function categoryLabelFa(c: PlanCategory) {
  if (c === "national") return "نت ملی";
  if (c === "unlimited") return "نامحدود";
  if (c === "data") return "VIP بین الملل";
  return c;
}

export function formatPanelSummary(p: PanelServer) {
  const cats = parsePanelCategories(p.categories)
    .map(categoryLabelFa)
    .join(" · ");
  const flags = [
    p.active ? "فعال" : "خاموش",
    p.sellEnabled ? "فروش روشن" : "فروش خاموش",
  ].join(" · ");
  return `${p.name}\n${flags}\nدسته‌ها: ${cats}\nوزن: ${p.weight}\nInbounds: ${p.inboundIds}`;
}
