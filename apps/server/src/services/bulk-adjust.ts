/**
 * Admin Bulk Adjust — mutate fields across all (or one panel's) 3x-ui clients.
 */
import { SubscriptionStatus, type Subscription } from "@prisma/client";
import { prisma } from "../db.js";
import type { XuiClient } from "../panel/xui-client.js";
import { gbToBytes } from "../utils/format.js";
import { parseInboundIds } from "./inbounds.js";
import { expiryFromPanel } from "./panel-expiry.js";
import { listDetailedPanelClients, syncClientInbounds } from "./admin-configs.js";
import { listPanelServers } from "./panel-servers.js";

export const BULK_ADD_DAYS_MAX = 3650;
export const BULK_ADD_GB_MAX = 10_000;

export type BulkAdjustInput = {
  panelServerId?: string | null;
  /** Replace all client inbound IDs with these */
  inbounds?: { ids: number[] };
  /** Set limitIp to this value (0 = unlimited devices) */
  limitIp?: { value: number };
  addGb?: number;
  addDays?: number;
  clearExpiry?: boolean;
};

export type BulkAdjustResult = {
  updated: number;
  skipped: number;
  errors: number;
  clientCount: number;
  failed: Array<{ email: string; error: string }>;
  skipReasons: Array<{ email: string; reason: string }>;
};

export type BulkAdjustPreview = {
  clientCount: number;
  panelName: string | null;
  panels: Array<{ id: string; name: string; clientCount: number }>;
};

function clampLimitIp(n: number): number {
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function normalizeIds(ids: number[]): number[] {
  return [
    ...new Set(
      ids
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n)),
    ),
  ].sort((a, b) => a - b);
}

/** Parse inbound id string from UI ("1,2,3-5"). */
export function parseBulkInboundIds(raw: string): number[] {
  return normalizeIds(parseInboundIds(raw || ""));
}

function validateInput(input: BulkAdjustInput): void {
  const has =
    Boolean(input.inbounds?.ids?.length) ||
    input.limitIp != null ||
    (input.addGb != null && input.addGb !== 0) ||
    (input.addDays != null && input.addDays !== 0) ||
    Boolean(input.clearExpiry);
  if (!has) throw new Error("حداقل یک عملیات را انتخاب کنید");

  if (input.inbounds) {
    const ids = normalizeIds(input.inbounds.ids ?? []);
    if (!ids.length) throw new Error("شناسه اینباند را وارد کنید");
    input.inbounds.ids = ids;
  }

  if (input.limitIp) {
    if (!Number.isFinite(input.limitIp.value)) throw new Error("مقدار محدودیت کاربر نامعتبر است");
    input.limitIp.value = clampLimitIp(input.limitIp.value);
  }

  if (input.addGb != null) {
    const g = Math.trunc(Number(input.addGb));
    if (!Number.isFinite(g) || g === 0) throw new Error("مقدار حجم نمی‌تواند صفر باشد");
    if (Math.abs(g) > BULK_ADD_GB_MAX) throw new Error(`حداکثر تغییر حجم ${BULK_ADD_GB_MAX} گیگ است`);
    input.addGb = g;
  }

  if (input.addDays != null) {
    const d = Math.trunc(Number(input.addDays));
    if (!Number.isFinite(d) || d === 0) throw new Error("مقدار روز نمی‌تواند صفر باشد");
    if (Math.abs(d) > BULK_ADD_DAYS_MAX) throw new Error(`حداکثر تغییر روز ${BULK_ADD_DAYS_MAX} است`);
    input.addDays = d;
  }
}

export async function previewBulkAdjust(panelServerId?: string | null): Promise<BulkAdjustPreview> {
  const clients = await listDetailedPanelClients();
  const filtered = panelServerId
    ? clients.filter((c) => c.panelServerId === panelServerId)
    : clients;

  const byPanel = new Map<string, { id: string; name: string; clientCount: number }>();
  for (const c of filtered) {
    const id = c.panelServerId ?? "__env__";
    const prev = byPanel.get(id);
    if (prev) prev.clientCount += 1;
    else byPanel.set(id, { id: c.panelServerId ?? "", name: c.panelName, clientCount: 1 });
  }

  let panelName: string | null = null;
  if (panelServerId) {
    const p = await listPanelServers().then((list) => list.find((x) => x.id === panelServerId));
    panelName = p?.name ?? filtered[0]?.panelName ?? null;
  }

  return {
    clientCount: filtered.length,
    panelName,
    panels: [...byPanel.values()],
  };
}

function extendPanelExpiry(expiryTime: number, days: number): number | null {
  const addMs = days * 86_400_000;
  if (expiryTime === 0) return null; // unlimited — skip
  if (expiryTime < 0) {
    const next = Math.abs(expiryTime) + addMs;
    if (next <= 0) return Date.now() - 1; // expired
    return -next;
  }
  const base = days >= 0 ? Math.max(Date.now(), expiryTime) : expiryTime;
  return base + addMs;
}

function extendBotExpiry(sub: Subscription, days: number) {
  const addMs = days * 86_400_000;
  if (sub.startsOnConnect && !sub.activatedAt) {
    const remaining = Math.max(0, sub.expiresAt.getTime() - Date.now());
    const newRemaining = remaining + addMs;
    if (newRemaining <= 0) {
      const expiresAt = new Date(Date.now() - 1);
      return {
        expiresAt,
        panelExpiryTime: expiresAt.getTime(),
        startsOnConnect: false as const,
        activatedAt: sub.activatedAt ?? new Date(),
      };
    }
    return {
      expiresAt: new Date(Date.now() + newRemaining),
      panelExpiryTime: -newRemaining,
      startsOnConnect: true as const,
      activatedAt: null as Date | null,
    };
  }
  const base = days >= 0 ? Math.max(Date.now(), sub.expiresAt.getTime()) : sub.expiresAt.getTime();
  const expiresAt = new Date(base + addMs);
  return {
    expiresAt,
    panelExpiryTime: expiresAt.getTime(),
    startsOnConnect: false as const,
    activatedAt: sub.activatedAt ?? new Date(),
  };
}

async function findSubByEmail(email: string): Promise<Subscription | null> {
  return prisma.subscription.findFirst({
    where: { email: { equals: email } },
  });
}

async function adjustOne(
  email: string,
  xui: XuiClient,
  input: BulkAdjustInput,
): Promise<"updated" | "skipped"> {
  const got = await xui.getClient(email);
  const client = got.obj?.client;
  if (!client) throw new Error("کلاینت در پنل پیدا نشد");

  const currentInboundIds = Array.isArray(got.obj?.inboundIds)
    ? normalizeIds(got.obj!.inboundIds as number[])
    : [];

  const patch: Record<string, unknown> = { ...client, email };
  let changed = false;
  const skipNotes: string[] = [];
  const sub = await findSubByEmail(email);
  const dbData: Record<string, unknown> = {};

  // ——— Inbounds (always replace) ———
  if (input.inbounds?.ids?.length) {
    const target = normalizeIds(input.inbounds.ids);
    const did = await syncClientInbounds(xui, email, currentInboundIds, target);
    if (did) changed = true;
  }

  // ——— limitIp (always set) ———
  if (input.limitIp) {
    const cur = Number(client.limitIp ?? 0);
    const next = clampLimitIp(input.limitIp.value);
    if (next !== cur) {
      patch.limitIp = next;
      changed = true;
      if (sub) dbData.limitIp = next;
    }
  }

  // ——— adjust GB (positive = increase, negative = decrease) ———
  if (input.addGb != null && input.addGb !== 0) {
    const curBytes = Number(client.totalGB ?? 0);
    if (!Number.isFinite(curBytes) || curBytes <= 0) {
      skipNotes.push("حجم نامحدود");
    } else {
      const curGb = Math.max(1, Math.round(curBytes / 1024 ** 3));
      const newGb = curGb + input.addGb;
      if (newGb < 1) {
        skipNotes.push("حجم کمتر از ۱ گیگ نمی‌شود");
      } else if (newGb !== curGb) {
        patch.totalGB = gbToBytes(newGb);
        changed = true;
        if (sub) dbData.trafficGb = newGb;
      }
    }
  }

  // ——— clear expiry ———
  if (input.clearExpiry) {
    const curExp = Number(client.expiryTime ?? 0);
    if (curExp !== 0) {
      patch.expiryTime = 0;
      changed = true;
      if (sub) {
        const exp = expiryFromPanel(0);
        dbData.expiresAt = exp.expiresAt;
        dbData.startsOnConnect = false;
        dbData.activatedAt = sub.activatedAt ?? new Date();
        dbData.panelExpiryTime = BigInt(0);
        dbData.status = SubscriptionStatus.active;
      }
    }
  } else if (input.addDays != null && input.addDays !== 0) {
    // ——— adjust days (skipped if clearExpiry also set — clear wins) ———
    const curExp = Number(client.expiryTime ?? 0);
    const nextExp = extendPanelExpiry(curExp, input.addDays);
    if (nextExp == null) {
      skipNotes.push("بدون انقضا (نامحدود)");
    } else {
      patch.expiryTime = nextExp;
      changed = true;
      if (sub) {
        const next = extendBotExpiry(sub, input.addDays);
        dbData.expiresAt = next.expiresAt;
        dbData.startsOnConnect = next.startsOnConnect;
        dbData.activatedAt = next.activatedAt;
        dbData.panelExpiryTime = BigInt(Math.trunc(next.panelExpiryTime));
        dbData.status = SubscriptionStatus.active;
      }
    }
  }

  if (changed && (patch.totalGB !== undefined || patch.limitIp !== undefined || patch.expiryTime !== undefined)) {
    await xui.updateClient(email, patch);
  }

  if (sub && Object.keys(dbData).length) {
    await prisma.subscription.update({ where: { id: sub.id }, data: dbData });
  }

  if (!changed) {
    if (skipNotes.length) {
      const err = new Error(skipNotes.join("؛ "));
      (err as Error & { skip?: boolean }).skip = true;
      throw err;
    }
    return "skipped";
  }
  return "updated";
}

export async function bulkAdjustAllPanelClients(input: BulkAdjustInput): Promise<BulkAdjustResult> {
  validateInput(input);

  const all = await listDetailedPanelClients();
  const clients = input.panelServerId
    ? all.filter((c) => c.panelServerId === input.panelServerId)
    : all;

  if (!clients.length) {
    throw new Error("هیچ اکانتی روی پنل پیدا نشد");
  }

  const result: BulkAdjustResult = {
    updated: 0,
    skipped: 0,
    errors: 0,
    clientCount: clients.length,
    failed: [],
    skipReasons: [],
  };

  for (const c of clients) {
    try {
      const status = await adjustOne(c.email, c.xui, input);
      if (status === "updated") result.updated += 1;
      else result.skipped += 1;
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 200);
      if (err && typeof err === "object" && (err as { skip?: boolean }).skip) {
        result.skipped += 1;
        result.skipReasons.push({ email: c.email, reason: msg });
      } else {
        result.errors += 1;
        result.failed.push({ email: c.email, error: msg });
      }
    }
  }

  return result;
}
