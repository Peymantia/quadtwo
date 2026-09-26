import type { PanelServer } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { XuiClient, createXuiFromEnv, normalizePanelBaseUrl } from "../panel/xui-client.js";
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

export { normalizePanelBaseUrl } from "../panel/xui-client.js";

export function createXuiFromPanel(panel: Pick<PanelServer, "baseUrl" | "apiToken">) {
  assertNotDemoPanel();
  if (!panel.baseUrl?.trim() || !panel.apiToken?.trim()) {
    throw new Error(formatXuiError("آدرس یا توکن پنل ناقص است"));
  }
  return new XuiClient({
    baseUrl: normalizePanelBaseUrl(panel.baseUrl),
    apiToken: panel.apiToken.trim(),
  });
}

/**
 * Keep process.env / parsed env in sync with an active panel so legacy
 * createXuiFromEnv paths use the same host after a VPS move (no restart required).
 */
function syncRuntimePanelEnv(panel: Pick<PanelServer, "baseUrl" | "apiToken" | "active">) {
  if (!panel.active) return;
  const base = normalizePanelBaseUrl(panel.baseUrl);
  const token = panel.apiToken?.trim();
  if (!base || !token) return;
  process.env.XUI_BASE_URL = base;
  process.env.XUI_API_TOKEN = token;
  (env as { XUI_BASE_URL?: string }).XUI_BASE_URL = base;
  (env as { XUI_API_TOKEN?: string }).XUI_API_TOKEN = token;
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

  const normalizedBase = normalizePanelBaseUrl(snap.baseUrl).replace(/\/+$/, "");
  const existing = await prisma.panelServer.findFirst({
    where: {
      tenantId,
      OR: [
        { baseUrl: snap.baseUrl },
        { baseUrl: `${normalizedBase}/` },
        { baseUrl: normalizedBase },
        { baseUrl: normalizePanelBaseUrl(snap.baseUrl) },
      ],
    },
  });
  if (existing) {
    const data: {
      apiToken: string;
      inboundIds: string;
      active: boolean;
      sellEnabled: boolean;
      baseUrl?: string;
      subBase?: string | null;
    } = {
      apiToken: snap.apiToken,
      inboundIds: snap.inboundIds,
      active: true,
      sellEnabled: true,
      baseUrl: normalizePanelBaseUrl(snap.baseUrl),
    };
    if (snap.subBase != null) data.subBase = snap.subBase;
    else if (snap.subBaseWasContaminated) data.subBase = null;
    const updated = await prisma.panelServer.update({
      where: { id: existing.id },
      data,
    });
    syncRuntimePanelEnv(updated);
    return updated;
  }

  const created = await prisma.panelServer.create({
    data: {
      tenantId,
      name: snap.name,
      baseUrl: normalizePanelBaseUrl(snap.baseUrl),
      apiToken: snap.apiToken,
      inboundIds: snap.inboundIds,
      subBase: snap.subBase,
      categories: snap.categories,
      active: true,
      sellEnabled: true,
      weight: 100,
    },
  });
  syncRuntimePanelEnv(created);
  return created;
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
  const baseUrl = normalizePanelBaseUrl(input.baseUrl);
  if (!name) throw new Error("نام سرور الزامی است");
  if (!baseUrl) throw new Error("آدرس پنل الزامی است");
  if (!input.apiToken.trim()) throw new Error("API Token الزامی است");

  const created = await prisma.panelServer.create({
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
  syncRuntimePanelEnv(created);
  return created;
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
  if (input.baseUrl !== undefined) data.baseUrl = normalizePanelBaseUrl(input.baseUrl);
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
          "Sub base نامعتبر است. باید با http(s) و مسیر باشد، مثلاً:\nhttps://sub.example.com:2096/info/\n(دامنه Mini App مثل app.example.com قبول نمی‌شود)",
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
  const updated = await prisma.panelServer.update({ where: { id }, data });
  syncRuntimePanelEnv(updated);
  return updated;
}

export async function deletePanelServer(id: string, opts?: { reassignToId?: string }) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const existing = await prisma.panelServer.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error("سرور پنل یافت نشد");

  const total = await prisma.panelServer.count({ where: { tenantId } });
  if (total <= 1) {
    throw new Error("حداقل یک سرور باید در سیستم باقی بماند");
  }

  const used = await prisma.subscription.count({ where: { panelServerId: id } });
  if (used > 0) {
    if (!opts?.reassignToId) {
      throw new Error(
        `این سرور ${used} اشتراک دارد. ابتدا اشتراک‌ها را به سرور جدید منتقل کنید، یا هنگام حذف «انتقال به سرور دیگر» را بزنید.`,
      );
    }
    await reassignPanelSubscriptions(id, opts.reassignToId);
  }

  // Orders may still reference this panel (FK Restrict)
  await prisma.order.updateMany({
    where: { panelServerId: id },
    data: { panelServerId: opts?.reassignToId ?? null },
  });

  return prisma.panelServer.delete({ where: { id } });
}

/**
 * Move all subscriptions (and orders) from one PanelServer to another.
 * Use after VPS / 3x-ui migration when clients already live on the new panel.
 */
export async function reassignPanelSubscriptions(fromId: string, toId: string) {
  if (fromId === toId) throw new Error("سرور مبدأ و مقصد یکی هستند");
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const [from, to] = await Promise.all([
    prisma.panelServer.findFirst({ where: { id: fromId, tenantId } }),
    prisma.panelServer.findFirst({ where: { id: toId, tenantId } }),
  ]);
  if (!from) throw new Error("سرور مبدأ یافت نشد");
  if (!to) throw new Error("سرور مقصد یافت نشد");

  const [subs, orders] = await prisma.$transaction([
    prisma.subscription.updateMany({
      where: { panelServerId: fromId },
      data: { panelServerId: toId },
    }),
    prisma.order.updateMany({
      where: { panelServerId: fromId },
      data: { panelServerId: toId },
    }),
  ]);

  return {
    subscriptions: subs.count,
    orders: orders.count,
    fromName: from.name,
    toName: to.name,
  };
}

export async function testPanelConnection(panel: Pick<PanelServer, "baseUrl" | "apiToken">) {
  const xui = createXuiFromPanel(panel);
  const list = await xui.listInbounds();
  const count = Array.isArray(list.obj) ? list.obj.length : 0;
  let statusOk = false;
  let statusError: string | undefined;
  try {
    const st = await xui.getServerStatus();
    statusOk = Boolean(st.obj || st.success !== false);
  } catch (err) {
    statusError = String(err instanceof Error ? err.message : err);
  }
  return {
    ok: true as const,
    inboundCount: count,
    probedUrl: xui.panelBaseUrl,
    statusOk,
    statusError,
  };
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
