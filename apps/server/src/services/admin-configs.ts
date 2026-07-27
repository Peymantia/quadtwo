import { UserRole, SubscriptionStatus, OrderStatus, OrderKind, type Subscription } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { resolvePanelForSubscription, listPanelServers, createXuiFromPanel, panelInboundIds } from "./panel-servers.js";
import { createXuiFromEnv, type XuiClient } from "../panel/xui-client.js";
import { env, adminIds } from "../config/env.js";
import { TELEGRAM_GROUP } from "./panel-groups.js";
import { formatXuiError } from "../panel/xui-errors.js";
import { gbToBytes, shortCode, randomSubId } from "../utils/format.js";
import { resolveSubUrl } from "./provision.js";
import { sanitizeSubBase } from "./sub-url.js";
import { getSetting, setSetting } from "./settings.js";
import {
  applyPanelExpiryToBotData,
  expiryFromPanel,
  expiryTimeForPanel,
  panelExpiryDiffersFromBot,
} from "./panel-expiry.js";
import { archiveAccountSnapshot, gatherAccountFullDetail } from "./account-archive.js";

export type ConfigGroup = {
  key: string;
  label: string;
  /** panel group name, or null for "all" */
  panelGroup: string | null;
  partnerUserId?: string;
};

export type ConfigListItem = {
  email: string;
  subId: string | null;
  code: string | null;
  ownerLabel: string;
  inDb: boolean;
  status: string | null;
  title?: string | null;
  note?: string | null;
  /** Extra searchable text (username, first/last name, telegram id, …) */
  searchText?: string | null;
  trafficGb?: number | null;
  expiresAt?: string | null;
  createdAt?: string | null;
};

function encodePanelGroupKey(name: string) {
  return `xg:${Buffer.from(name, "utf8").toString("base64url")}`;
}

function decodePanelGroupKey(key: string): string | null {
  if (!key.startsWith("xg:")) return null;
  try {
    return Buffer.from(key.slice(3), "base64url").toString("utf8").trim() || null;
  } catch {
    return null;
  }
}

async function activeXuiClients(): Promise<XuiClient[]> {
  const panels = await listPanelServers();
  if (panels.length) {
    return panels.filter((p) => p.active).map((p) => createXuiFromPanel(p));
  }
  if (env.XUI_BASE_URL && env.XUI_API_TOKEN) {
    return [createXuiFromEnv(env)];
  }
  return [];
}

/** Collect client emails from one panel (list API, then inbound fallback). */
async function emailsFromOnePanel(xui: XuiClient): Promise<string[]> {
  return (await clientsFromOnePanel(xui)).map((c) => c.email);
}

type RawPanelClient = {
  email: string;
  uuid?: string | null;
  id?: string | null;
  subId?: string | null;
  totalGB?: number;
  expiryTime?: number;
  enable?: boolean;
  limitIp?: number;
  comment?: string;
};

async function clientsFromOnePanel(xui: XuiClient): Promise<RawPanelClient[]> {
  const byEmail = new Map<string, RawPanelClient>();

  const add = (c: RawPanelClient) => {
    const e = c.email?.trim();
    if (!e) return;
    const k = e.toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, { ...c, email: e });
  };

  try {
    const res = await xui.listClients();
    const list = Array.isArray(res.obj) ? res.obj : [];
    for (const c of list) {
      if (typeof c?.email === "string" && c.email.trim()) {
        add({
          email: c.email,
          uuid: c.uuid ?? null,
          id: c.id != null ? String(c.id) : null,
          subId: c.subId ?? null,
          totalGB: c.totalGB,
          expiryTime: c.expiryTime,
          enable: c.enable,
          limitIp: c.limitIp,
          comment: typeof c.comment === "string" ? c.comment : undefined,
        });
      }
    }
  } catch {
    /* try inbounds below */
  }

  if (byEmail.size > 0) return [...byEmail.values()];

  try {
    const res = await xui.listInbounds();
    const inbounds = Array.isArray(res.obj) ? res.obj : [];
    for (const ib of inbounds as Array<{
      clientStats?: Array<{ email?: string; enable?: boolean; expiryTime?: number; total?: number }>;
      settings?: string | { clients?: Array<Record<string, unknown>> };
    }>) {
      if (Array.isArray(ib.clientStats)) {
        for (const s of ib.clientStats) {
          if (s?.email?.trim()) {
            add({
              email: s.email,
              enable: s.enable,
              expiryTime: s.expiryTime,
              totalGB: s.total,
            });
          }
        }
      }
      let clients: Array<Record<string, unknown>> | undefined;
      if (typeof ib.settings === "string") {
        try {
          const parsed = JSON.parse(ib.settings) as { clients?: Array<Record<string, unknown>> };
          clients = parsed.clients;
        } catch {
          clients = undefined;
        }
      } else if (ib.settings && typeof ib.settings === "object") {
        clients = ib.settings.clients;
      }
      if (Array.isArray(clients)) {
        for (const c of clients) {
          const email = typeof c.email === "string" ? c.email : "";
          if (!email.trim()) continue;
          add({
            email,
            uuid: c.id != null ? String(c.id) : c.uuid != null ? String(c.uuid) : null,
            id: c.id != null ? String(c.id) : null,
            subId: typeof c.subId === "string" ? c.subId : null,
            totalGB: typeof c.totalGB === "number" ? c.totalGB : undefined,
            expiryTime: typeof c.expiryTime === "number" ? c.expiryTime : undefined,
            enable: typeof c.enable === "boolean" ? c.enable : undefined,
            limitIp: typeof c.limitIp === "number" ? c.limitIp : undefined,
            comment: typeof c.comment === "string" ? c.comment : undefined,
          });
        }
      }
    }
  } catch {
    /* panel unreachable */
  }

  return [...byEmail.values()];
}

/** All client emails currently on connected 3x-ui panels. */
async function listAllPanelEmails(): Promise<string[]> {
  const emails = new Set<string>();
  for (const xui of await activeXuiClients()) {
    for (const e of await emailsFromOnePanel(xui)) emails.add(e);
  }
  return [...emails];
}

async function listPanelGroupNames(): Promise<string[]> {
  const names = new Set<string>();
  for (const xui of await activeXuiClients()) {
    try {
      const res = await xui.listGroups();
      const list = Array.isArray(res.obj) ? res.obj : [];
      for (const g of list) {
        const n = String(g?.name ?? "").trim();
        if (n) names.add(n);
      }
    } catch {
      /* panel unreachable */
    }
  }
  return [...names];
}

export async function listConfigGroups(): Promise<ConfigGroup[]> {
  const partners = await prisma.user.findMany({
    where: {
      role: { in: [UserRole.partner, UserRole.wholesale, UserRole.admin] },
      OR: [{ panelGroup: { not: null } }, { agentName: { not: null } }],
    },
    orderBy: [{ role: "asc" }, { agentName: "asc" }],
  });

  const seen = new Set<string>();
  const groups: ConfigGroup[] = [];

  for (const u of partners) {
    const g = (u.panelGroup || "").trim();
    if (!g || seen.has(g.toLowerCase())) continue;
    seen.add(g.toLowerCase());
    const roleTag = u.role === "wholesale" ? "عمده" : u.role === "admin" ? "ادمین" : "همکار";
    const name = u.agentName?.trim() || g;
    groups.push({
      key: `p${u.id}`,
      label: `${roleTag}: ${name}`,
      panelGroup: g,
      partnerUserId: u.id,
    });
  }

  groups.push({
    key: "tg",
    label: "Telegram (کاربران عادی)",
    panelGroup: TELEGRAM_GROUP,
  });
  seen.add(TELEGRAM_GROUP.toLowerCase());

  /** Groups that exist only on 3x-ui (no matching partner in bot DB). */
  for (const name of await listPanelGroupNames()) {
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    groups.push({
      key: encodePanelGroupKey(name),
      label: `پنل: ${name}`,
      panelGroup: name,
    });
  }

  groups.push({
    key: "all",
    label: "تمام کانفیگ‌ها",
    panelGroup: null,
  });

  return groups;
}

async function emailsInPanelGroup(groupName: string): Promise<string[]> {
  const emails = new Set<string>();
  for (const xui of await activeXuiClients()) {
    try {
      const res = await xui.groupEmails(groupName);
      const list = Array.isArray(res.obj) ? res.obj : [];
      for (const e of list) {
        if (e?.trim()) emails.add(e.trim());
      }
    } catch {
      /* panel unreachable or group missing */
    }
  }
  return [...emails];
}

function ownerFromUser(user: {
  username: string | null;
  firstName?: string | null;
  lastName?: string | null;
  agentName: string | null;
  telegramId: bigint;
}) {
  const handle = user.username ? `@${user.username}` : null;
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.agentName ||
    null;
  if (handle && name) return `${handle} · ${name}`;
  return handle || name || String(user.telegramId);
}

/** Fields used for partial search (email, note, name, …). */
function ownerSearchText(user: {
  username: string | null;
  firstName?: string | null;
  lastName?: string | null;
  agentName: string | null;
  telegramId: bigint;
}) {
  return [
    user.username,
    user.username ? `@${user.username}` : null,
    user.firstName,
    user.lastName,
    user.agentName,
    String(user.telegramId),
  ]
    .filter((x): x is string => Boolean(x && String(x).trim()))
    .join(" ");
}

function listItemFromSub(s: {
  id: string;
  email: string;
  code: string;
  status: string;
  title: string | null;
  note: string | null;
  trafficGb: number | null;
  expiresAt: Date;
  createdAt: Date;
  user: {
    username: string | null;
    firstName?: string | null;
    lastName?: string | null;
    agentName: string | null;
    telegramId: bigint;
  };
}): ConfigListItem {
  return {
    email: s.email,
    subId: s.id,
    code: s.code,
    ownerLabel: ownerFromUser(s.user),
    searchText: ownerSearchText(s.user),
    inDb: true,
    status: s.status,
    title: s.title,
    note: s.note,
    trafficGb: s.trafficGb,
    expiresAt: s.expiresAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
  };
}

function mergePanelOnly(
  byEmail: Map<string, ConfigListItem>,
  panelEmails: string[],
) {
  for (const e of panelEmails) {
    const k = e.toLowerCase();
    if (byEmail.has(k)) continue;
    byEmail.set(k, {
      email: e,
      subId: null,
      code: null,
      ownerLabel: "فقط پنل",
      inDb: false,
      status: null,
    });
  }
}

function configMatchesSearch(item: ConfigListItem, q: string): boolean {
  const hay = [
    item.email,
    item.code,
    item.ownerLabel,
    item.title,
    item.note,
    item.searchText,
  ]
    .filter((x): x is string => Boolean(x && String(x).trim()))
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

function filterConfigItems(items: ConfigListItem[], search: string): ConfigListItem[] {
  const q = search.trim().toLowerCase();
  if (!q) return items;
  return items.filter((x) => configMatchesSearch(x, q));
}

export type ConfigListSort = "newest" | "oldest" | "ending" | "ending_date" | "ending_traffic";

/** Days until done — lower = more urgent (expired ≤ 0). */
export function endingUrgencyDays(opts: {
  expiresAt?: string | null;
  usedBytes?: number;
  totalGb?: number | null;
}): number {
  const now = Date.now();
  const expMs = opts.expiresAt ? new Date(opts.expiresAt).getTime() : Number.NaN;
  const hasExp = Number.isFinite(expMs);
  const daysLeft = hasExp ? (expMs - now) / 864e5 : Number.POSITIVE_INFINITY;

  const totalBytes = opts.totalGb != null && opts.totalGb > 0 ? opts.totalGb * 1024 ** 3 : 0;
  const used = Math.max(0, opts.usedBytes ?? 0);
  let trafficDays = Number.POSITIVE_INFINITY;
  if (totalBytes > 0) {
    const leftFrac = Math.max(0, 1 - used / totalBytes);
    trafficDays = used >= totalBytes ? 0 : leftFrac * 90;
  }

  if (hasExp && daysLeft <= 0) return daysLeft;
  if (totalBytes > 0 && used >= totalBytes) return 0;

  return Math.min(
    Number.isFinite(daysLeft) ? Math.max(0, daysLeft) : Number.POSITIVE_INFINITY,
    trafficDays,
  );
}

function sortConfigItems(items: ConfigListItem[], sort: ConfigListSort): ConfigListItem[] {
  const copy = [...items];
  const created = (x: ConfigListItem) => (x.createdAt ? new Date(x.createdAt).getTime() : 0);
  const expires = (x: ConfigListItem) =>
    x.expiresAt ? new Date(x.expiresAt).getTime() : Number.POSITIVE_INFINITY;

  if (sort === "newest") {
    copy.sort((a, b) => {
      if (a.inDb !== b.inDb) return a.inDb ? -1 : 1;
      return created(b) - created(a) || a.email.localeCompare(b.email);
    });
  } else if (sort === "oldest") {
    copy.sort((a, b) => {
      if (a.inDb !== b.inDb) return a.inDb ? -1 : 1;
      return created(a) - created(b) || a.email.localeCompare(b.email);
    });
  } else if (sort === "ending_date") {
    copy.sort((a, b) => expires(a) - expires(b) || a.email.localeCompare(b.email));
  } else if (sort === "ending_traffic") {
    // Traffic applied after enrich in the route; here fall back to expiry-ish via totalGb only.
    copy.sort((a, b) => {
      const ua = endingUrgencyDays({ expiresAt: null, totalGb: a.trafficGb, usedBytes: 0 });
      const ub = endingUrgencyDays({ expiresAt: null, totalGb: b.trafficGb, usedBytes: 0 });
      if (ua !== ub) return ua - ub;
      return a.email.localeCompare(b.email);
    });
  } else {
    // Ending: by expiry urgency only here (traffic applied after enrich in the route).
    copy.sort((a, b) => {
      const ua = endingUrgencyDays({ expiresAt: a.expiresAt, totalGb: a.trafficGb, usedBytes: 0 });
      const ub = endingUrgencyDays({ expiresAt: b.expiresAt, totalGb: b.trafficGb, usedBytes: 0 });
      if (ua !== ub) return ua - ub;
      return expires(a) - expires(b) || a.email.localeCompare(b.email);
    });
  }
  return copy;
}

function paginateConfigs(
  items: ConfigListItem[],
  page: number,
  pageSize: number,
  search: string,
  sort: ConfigListSort,
) {
  const filtered = filterConfigItems(items, search);
  const sorted = sortConfigItems(filtered, sort);
  const total = sorted.length;
  // pageSize <= 0 → return all (used when enriching before ending sort)
  const size = pageSize <= 0 ? Math.max(1, total || 1) : Math.max(1, Math.min(100, Math.floor(pageSize) || 30));
  const p = Math.max(0, page);
  return {
    total,
    items: sorted.slice(p * size, p * size + size),
    pageSize: pageSize <= 0 ? total : size,
  };
}

/** List configs for a group key (`all` | `tg` | `p{userId}` | `xg:…`). */
export async function listConfigsForGroup(
  groupKey: string,
  page = 0,
  pageSize = 30,
  search = "",
  sort: ConfigListSort = "newest",
): Promise<{ items: ConfigListItem[]; total: number; title: string; pageSize: number }> {
  const groups = await listConfigGroups();
  const meta = groups.find((g) => g.key === groupKey);
  const title = meta?.label ?? "کانفیگ‌ها";

  if (groupKey === "all") {
    const [dbSubs, panelEmails] = await Promise.all([
      prisma.subscription.findMany({
        include: { user: true },
        orderBy: { createdAt: "desc" },
      }),
      listAllPanelEmails(),
    ]);

    const byEmail = new Map<string, ConfigListItem>();
    for (const s of dbSubs) {
      byEmail.set(s.email.toLowerCase(), listItemFromSub(s));
    }
    mergePanelOnly(byEmail, panelEmails);

    const paged = paginateConfigs([...byEmail.values()], page, pageSize, search, sort);
    return { title: "تمام کانفیگ‌ها", ...paged };
  }

  const panelGroup =
    meta?.panelGroup ?? decodePanelGroupKey(groupKey);
  if (!panelGroup) {
    return { title, total: 0, items: [], pageSize: pageSize <= 0 ? 0 : Math.max(1, Math.min(100, Math.floor(pageSize) || 30)) };
  }

  const panelEmails = await emailsInPanelGroup(panelGroup);
  const panelSet = new Set(panelEmails.map((e) => e.toLowerCase()));
  const partnerId = meta?.partnerUserId;

  const dbSubs = await prisma.subscription.findMany({
    where: partnerId
      ? { OR: [{ userId: partnerId }, ...(panelEmails.length ? [{ email: { in: panelEmails } }] : [])] }
      : groupKey === "tg"
        ? { user: { role: UserRole.user } }
        : panelEmails.length
          ? { email: { in: panelEmails } }
          : { id: { in: [] } },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });

  const byEmail = new Map<string, ConfigListItem>();
  for (const s of dbSubs) {
    if (groupKey === "tg" && s.user.role !== UserRole.user) continue;
    if (
      partnerId &&
      s.userId !== partnerId &&
      !panelSet.has(s.email.toLowerCase())
    ) {
      continue;
    }
    byEmail.set(s.email.toLowerCase(), listItemFromSub(s));
  }

  mergePanelOnly(byEmail, panelEmails);

  const paged = paginateConfigs([...byEmail.values()], page, pageSize, search, sort);
  return { title: meta?.label ?? panelGroup, ...paged };
}

export type DeleteConfigResult = {
  deletedPanel: boolean;
  deletedDb: boolean;
  email: string;
  message: string;
  archiveId: string | null;
};

/**
 * Delete config: from panel if present, always from bot DB when row exists.
 * Snapshots full account detail into AccountArchive first (for restore / reports).
 */
export async function deleteConfig(opts: {
  subId?: string | null;
  email: string;
  actorTelegramId?: number | bigint | null;
}): Promise<DeleteConfigResult> {
  const email = opts.email.trim();
  if (!email) throw new Error("ایمیل کانفیگ خالی است");

  let sub = opts.subId
    ? await prisma.subscription.findUnique({ where: { id: opts.subId } })
    : await prisma.subscription.findFirst({ where: { email } });

  if (!sub) {
    sub = await prisma.subscription.findFirst({
      where: { email: { equals: email } },
    });
  }

  let archiveId: string | null = null;
  try {
    const detail = await gatherAccountFullDetail({ email, subId: sub?.id ?? opts.subId });
    if (detail.panelFound || detail.inDb) {
      const archived = await archiveAccountSnapshot({
        detail,
        reason: "deleted",
        actorTelegramId: opts.actorTelegramId ?? null,
      });
      archiveId = archived.id;
    }
  } catch (err) {
    console.warn("account archive before delete failed", email, err);
  }

  let deletedPanel = false;
  const tried = new Set<string>();

  const tryDeleteXui = async (xui: {
    panelBaseUrl: string;
    deleteClient: (e: string) => Promise<unknown>;
    getClient: (e: string) => Promise<unknown>;
  }) => {
    const key = xui.panelBaseUrl;
    if (tried.has(key)) return;
    tried.add(key);
    try {
      await xui.deleteClient(email);
      deletedPanel = true;
      return;
    } catch (err) {
      const msg = String(err);
      if (/not found|404|وجود ندارد|no client|not exist/i.test(msg)) {
        return;
      }
      console.warn("panel delete failed", email, formatXuiError(err));
    }
  };

  if (sub) {
    try {
      const resolved = await resolvePanelForSubscription(sub);
      await tryDeleteXui(resolved.xui);
    } catch {
      /* ignore */
    }
  }

  if (!deletedPanel) {
    for (const xui of await activeXuiClients()) {
      if (deletedPanel) break;
      await tryDeleteXui(xui);
    }
  }

  let deletedDb = false;
  if (sub) {
    await prisma.notificationLog.deleteMany({ where: { subscriptionId: sub.id } });
    // Keep accountName filled so sales reports still show the email after delete
    if (sub.orderId) {
      await prisma.order.updateMany({
        where: { id: sub.orderId, OR: [{ accountName: null }, { accountName: "" }] },
        data: { accountName: email },
      });
    }
    await prisma.order.updateMany({
      where: { targetSubId: sub.id, OR: [{ accountName: null }, { accountName: "" }] },
      data: { accountName: email },
    });

    // Drop this account from sales totals — it was not a lasting sale
    const salesNote = "حذف اکانت توسط ادمین — از فروش کسر شد";
    if (sub.orderId) {
      const primary = await prisma.order.findUnique({ where: { id: sub.orderId } });
      if (primary && primary.status === OrderStatus.completed && !primary.excludedFromSales) {
        // Bulk orders stay counted unless every linked account is gone (only first sub has orderId)
        if ((primary.quantity ?? 1) <= 1) {
          await prisma.order.update({
            where: { id: primary.id },
            data: {
              excludedFromSales: true,
              adminNote: [primary.adminNote, salesNote].filter(Boolean).join("\n").slice(0, 500),
            },
          });
        }
      }
    }
    const renewals = await prisma.order.findMany({
      where: {
        targetSubId: sub.id,
        status: OrderStatus.completed,
        kind: { in: [OrderKind.new, OrderKind.renew] },
        excludedFromSales: false,
      },
      select: { id: true, adminNote: true },
    });
    for (const o of renewals) {
      await prisma.order.update({
        where: { id: o.id },
        data: {
          excludedFromSales: true,
          adminNote: [o.adminNote, salesNote].filter(Boolean).join("\n").slice(0, 500),
        },
      });
    }

    await prisma.order.updateMany({
      where: { targetSubId: sub.id },
      data: { targetSubId: null },
    });
    await prisma.subscription.delete({ where: { id: sub.id } });
    deletedDb = true;
  }

  const parts: string[] = [];
  if (deletedPanel && deletedDb) parts.push("از پنل و دیتابیس ربات حذف شد.");
  else if (deletedPanel) parts.push("از پنل حذف شد (در دیتابیس ربات نبود).");
  else if (deletedDb) parts.push("در پنل نبود؛ فقط از دیتابیس ربات حذف شد.");
  else parts.push("چیزی برای حذف پیدا نشد.");
  if (archiveId) parts.push("اسنپ‌شات برای بازگردانی ذخیره شد.");

  return {
    deletedPanel,
    deletedDb,
    email,
    archiveId,
    message: parts.join(" "),
  };
}

export type ConfigDetail = {
  email: string;
  subId: string | null;
  code: string | null;
  inDb: boolean;
  panelFound: boolean;
  title: string | null;
  note: string | null;
  comment: string | null;
  trafficGb: number | null;
  /** bytes used (up+down) from panel */
  usedTrafficBytes: number;
  expiresAt: string | null;
  limitIp: number;
  enable: boolean;
  status: string | null;
  ownerLabel: string;
};

async function findSubByEmailOrId(email: string, subId?: string | null) {
  let sub = subId
    ? await prisma.subscription.findUnique({ where: { id: subId }, include: { user: true } })
    : null;
  if (!sub) {
    sub = await prisma.subscription.findFirst({
      where: { email },
      include: { user: true },
    });
  }
  return sub;
}

export async function getConfigDetail(opts: {
  email: string;
  subId?: string | null;
}): Promise<ConfigDetail> {
  const email = opts.email.trim();
  if (!email) throw new Error("ایمیل کانفیگ خالی است");

  const sub = await findSubByEmailOrId(email, opts.subId);

  type PanelClientBits = {
    totalGB?: number;
    expiryTime?: number;
    enable?: boolean;
    limitIp?: number;
    comment?: string;
  };

  const found: Array<{ client: PanelClientBits; xui: XuiClient }> = [];

  const tryGet = async (xui: XuiClient) => {
    if (found.length) return;
    try {
      const got = await xui.getClient(email);
      if (got.obj?.client) {
        found.push({ client: got.obj.client, xui });
      }
    } catch {
      /* next */
    }
  };

  if (sub) {
    try {
      const resolved = await resolvePanelForSubscription(sub);
      await tryGet(resolved.xui);
    } catch {
      /* ignore */
    }
  }
  if (!found.length) {
    for (const xui of await activeXuiClients()) {
      await tryGet(xui);
      if (found.length) break;
    }
  }

  const hit = found[0] ?? null;
  const panelClient = hit?.client ?? null;
  const bytes = Number(panelClient?.totalGB ?? 0);
  let panelGb =
    !panelClient || bytes <= 0 ? null : Math.max(1, Math.round(bytes / 1024 ** 3));

  // Get used traffic (up+down bytes) and refine total from traffic API
  let usedTrafficBytes = 0;
  if (hit) {
    try {
      const t = await hit.xui.getClientTraffic(email);
      if (t) {
        usedTrafficBytes = t.used;
        if (t.total > 0) {
          panelGb = Math.max(1, Math.round(t.total / 1024 ** 3));
        }
      }
    } catch {
      /* ignore */
    }
  }

  const panelExpiry = Number(panelClient?.expiryTime ?? 0);
  let expiresAt: string | null = sub?.expiresAt?.toISOString() ?? null;
  if (panelExpiry > 0) expiresAt = new Date(panelExpiry).toISOString();
  else if (panelExpiry < 0 && !expiresAt) {
    expiresAt = new Date(Date.now() + Math.abs(panelExpiry)).toISOString();
  }

  return {
    email,
    subId: sub?.id ?? null,
    code: sub?.code ?? null,
    inDb: Boolean(sub),
    panelFound: Boolean(panelClient),
    title: sub?.title ?? null,
    note: sub?.note ?? null,
    comment: panelClient?.comment ?? null,
    trafficGb: sub?.trafficGb ?? panelGb,
    usedTrafficBytes,
    expiresAt,
    limitIp: Number(panelClient?.limitIp ?? 0),
    enable: panelClient?.enable !== false && sub?.status !== "disabled",
    status: sub?.status ?? (panelClient?.enable === false ? "disabled" : "active"),
    ownerLabel: sub ? ownerFromUser(sub.user) : "فقط پنل",
  };
}

/**
 * Update account fields on bot DB and/or 3x-ui panel.
 */
export async function updateConfig(opts: {
  email: string;
  subId?: string | null;
  title?: string | null;
  note?: string | null;
  trafficGb?: number | null;
  expiresAt?: string | null;
  limitIp?: number;
  enable?: boolean;
}): Promise<{ ok: true; message: string }> {
  const email = opts.email.trim();
  if (!email) throw new Error("ایمیل کانفیگ خالی است");

  const sub = await findSubByEmailOrId(email, opts.subId);

  let xui: Awaited<ReturnType<typeof resolvePanelForSubscription>>["xui"] | null = null;
  if (sub) {
    try {
      xui = (await resolvePanelForSubscription(sub)).xui;
    } catch {
      xui = null;
    }
  }
  if (!xui) {
    const clients = await activeXuiClients();
    xui = clients[0] ?? null;
  }

  let panelUpdated = false;
  if (xui) {
    try {
      const got = await xui.getClient(email);
      const client = got.obj?.client;
      if (client) {
        const patch: Record<string, unknown> = { ...client, email };
        if (opts.trafficGb !== undefined) {
          patch.totalGB =
            opts.trafficGb === null || opts.trafficGb <= 0 ? 0 : gbToBytes(opts.trafficGb);
        }
        if (opts.expiresAt !== undefined && opts.expiresAt) {
          const t = new Date(opts.expiresAt).getTime();
          if (!Number.isFinite(t)) throw new Error("تاریخ انقضا نامعتبر است");
          patch.expiryTime = t;
        }
        if (opts.limitIp !== undefined) {
          patch.limitIp = Math.max(0, Math.min(100, Math.floor(opts.limitIp)));
        }
        if (opts.enable !== undefined) patch.enable = opts.enable;
        if (opts.title !== undefined || opts.note !== undefined) {
          const title = opts.title !== undefined ? opts.title : sub?.title;
          const note = opts.note !== undefined ? opts.note : sub?.note;
          const parts = [title?.trim(), note?.trim()].filter(Boolean);
          patch.comment = parts.join(" | ").slice(0, 200);
        }
        await xui.updateClient(email, patch);
        panelUpdated = true;
      }
    } catch (err) {
      if (!sub) throw new Error(formatXuiError(err));
      console.warn("panel update failed", email, formatXuiError(err));
    }
  }

  if (sub) {
    const data: Record<string, unknown> = {};
    if (opts.title !== undefined) {
      data.title = opts.title?.trim() ? opts.title.trim().slice(0, 80) : null;
    }
    if (opts.note !== undefined) {
      data.note = opts.note?.trim() ? opts.note.trim().slice(0, 500) : null;
    }
    if (opts.trafficGb !== undefined) {
      data.trafficGb =
        opts.trafficGb === null || opts.trafficGb <= 0 ? null : Math.floor(opts.trafficGb);
    }
    if (opts.expiresAt !== undefined && opts.expiresAt) {
      const d = new Date(opts.expiresAt);
      if (!Number.isFinite(d.getTime())) throw new Error("تاریخ انقضا نامعتبر است");
      data.expiresAt = d;
      data.startsOnConnect = false;
      data.panelExpiryTime = BigInt(d.getTime());
      if (!sub.activatedAt) data.activatedAt = new Date();
    }
    if (opts.enable !== undefined) {
      data.status = opts.enable ? "active" : "disabled";
    }
    if (opts.limitIp !== undefined) {
      data.limitIp = Math.max(0, Math.min(100, Math.floor(opts.limitIp)));
    }
    if (Object.keys(data).length) {
      await prisma.subscription.update({ where: { id: sub.id }, data });
    }
  } else if (!panelUpdated) {
    throw new Error("اکانت در پنل و دیتابیس پیدا نشد");
  }

  const parts: string[] = [];
  if (panelUpdated) parts.push("پنل");
  if (sub) parts.push("دیتابیس ربات");
  return { ok: true, message: `ذخیره شد (${parts.join(" + ")})` };
}

export type SyncDiffItem = {
  email: string;
  panelName: string;
  panelServerId: string | null;
  trafficGb: number | null;
  expiresAt: string | null;
  enable: boolean;
  limitIp: number;
  panelSubId: string | null;
};

export type SyncFieldMismatch = {
  email: string;
  code: string;
  subId: string;
  fields: Array<"expiry" | "traffic" | "limitIp" | "enable">;
  panelExpiresAt: string | null;
  botExpiresAt: string;
  panelTrafficGb: number | null;
  botTrafficGb: number | null;
  panelLimitIp: number;
  botLimitIp: number;
  panelEnable: boolean;
  botEnable: boolean;
  panelStartsOnConnect: boolean;
  botStartsOnConnect: boolean;
};

export type SyncDiffResult = {
  panelOnly: SyncDiffItem[];
  botOnly: Array<{ email: string; code: string; subId: string; ownerLabel: string }>;
  mismatched: SyncFieldMismatch[];
  matched: number;
  panelTotal: number;
  botTotal: number;
};

type DetailedPanelClient = {
  email: string;
  panelServerId: string | null;
  panelName: string;
  xui: XuiClient;
  subBase: string | null;
  uuid: string | null;
  panelSubId: string | null;
  trafficGb: number | null;
  expiryTime: number;
  enable: boolean;
  limitIp: number;
  comment: string | null;
};

function bytesToGb(totalGB: number | undefined): number | null {
  const bytes = Number(totalGB ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.max(1, Math.round(bytes / 1024 ** 3));
}

/** Panel comment is stored as `title | note` (same as updateConfig). */
function parsePanelComment(comment: string | null | undefined): {
  title: string | null;
  note: string | null;
} {
  const raw = comment?.trim() || "";
  if (!raw) return { title: null, note: null };
  const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      title: parts[0]!.slice(0, 80),
      note: parts.slice(1).join(" | ").slice(0, 500),
    };
  }
  return { title: parts[0]!.slice(0, 80), note: null };
}

function composePanelComment(
  title: string | null | undefined,
  note: string | null | undefined,
): string {
  return [title?.trim(), note?.trim()].filter(Boolean).join(" | ").slice(0, 200);
}

async function deleteSubscriptionDbOnly(subId: string): Promise<void> {
  await prisma.notificationLog.deleteMany({ where: { subscriptionId: subId } });
  await prisma.order.updateMany({
    where: { targetSubId: subId },
    data: { targetSubId: null },
  });
  await prisma.subscription.delete({ where: { id: subId } });
}

async function listDetailedPanelClients(): Promise<DetailedPanelClient[]> {
  const out: DetailedPanelClient[] = [];
  const seen = new Set<string>();

  const pushMany = (
    clients: RawPanelClient[],
    meta: { panelServerId: string | null; panelName: string; xui: XuiClient; subBase: string | null },
  ) => {
    for (const c of clients) {
      const k = c.email.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        email: c.email,
        panelServerId: meta.panelServerId,
        panelName: meta.panelName,
        xui: meta.xui,
        subBase: meta.subBase,
        uuid: c.uuid || (c.id != null ? String(c.id) : null),
        panelSubId: c.subId ?? null,
        trafficGb: bytesToGb(c.totalGB),
        expiryTime: Number(c.expiryTime ?? 0),
        enable: c.enable !== false,
        limitIp: Number(c.limitIp ?? 0),
        comment: c.comment?.trim() || null,
      });
    }
  };

  const panels = await listPanelServers();
  if (panels.length) {
    for (const p of panels.filter((x) => x.active)) {
      const xui = createXuiFromPanel(p);
      pushMany(await clientsFromOnePanel(xui), {
        panelServerId: p.id,
        panelName: p.name,
        xui,
        subBase: sanitizeSubBase(p.subBase),
      });
    }
  } else if (env.XUI_BASE_URL && env.XUI_API_TOKEN) {
    const xui = createXuiFromEnv(env);
    pushMany(await clientsFromOnePanel(xui), {
      panelServerId: null,
      panelName: "سرور پیش‌فرض (.env)",
      xui,
      subBase: sanitizeSubBase(env.XUI_SUB_BASE),
    });
  }

  return out;
}

/** Owner for accounts created directly on the panel: first admin user. */
export async function resolvePanelImportOwner() {
  const admin = await prisma.user.findFirst({
    where: { role: UserRole.admin },
    orderBy: { createdAt: "asc" },
  });
  if (admin) return admin;

  for (const tid of adminIds()) {
    const u = await prisma.user.findUnique({ where: { telegramId: tid } });
    if (u) return u;
  }

  throw new Error(
    "هیچ کاربر ادمینی در دیتابیس ربات نیست. ابتدا با اکانت ادمین وارد ربات یا داشبورد شوید.",
  );
}

async function uniqueSubCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = shortCode("QT");
    const exists = await prisma.subscription.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
  }
  return shortCode("QT") + shortCode("").slice(-4);
}

/** Compare live 3x-ui clients with bot Subscription rows. */
export async function diffPanelVsBot(): Promise<SyncDiffResult> {
  const [panelClients, botSubs] = await Promise.all([
    listDetailedPanelClients(),
    prisma.subscription.findMany({
      include: { user: { select: { username: true, agentName: true, telegramId: true } } },
    }),
  ]);

  const botByEmail = new Map(botSubs.map((s) => [s.email.toLowerCase(), s]));
  const panelEmails = new Set(panelClients.map((c) => c.email.toLowerCase()));

  const panelOnly: SyncDiffItem[] = [];
  for (const c of panelClients) {
    if (botByEmail.has(c.email.toLowerCase())) continue;
    const exp = expiryFromPanel(c.expiryTime);
    panelOnly.push({
      email: c.email,
      panelName: c.panelName,
      panelServerId: c.panelServerId,
      trafficGb: c.trafficGb,
      expiresAt: exp.expiresAt.toISOString(),
      enable: c.enable,
      limitIp: c.limitIp,
      panelSubId: c.panelSubId,
    });
  }

  const botOnly = botSubs
    .filter((s) => !panelEmails.has(s.email.toLowerCase()))
    .map((s) => ({
      email: s.email,
      code: s.code,
      subId: s.id,
      ownerLabel: ownerFromUser(s.user),
    }));

  const mismatched: SyncFieldMismatch[] = [];
  for (const c of panelClients) {
    const sub = botByEmail.get(c.email.toLowerCase());
    if (!sub) continue;
    const fields: SyncFieldMismatch["fields"] = [];
    if (panelExpiryDiffersFromBot(c.expiryTime, sub)) fields.push("expiry");
    if (c.trafficGb !== sub.trafficGb) fields.push("traffic");
    if (c.limitIp !== (sub.limitIp ?? 0)) fields.push("limitIp");
    const botEnable = sub.status === SubscriptionStatus.active;
    if (c.enable !== botEnable) fields.push("enable");
    if (!fields.length) continue;
    const panelExp = expiryFromPanel(c.expiryTime);
    mismatched.push({
      email: c.email,
      code: sub.code,
      subId: sub.id,
      fields,
      panelExpiresAt: panelExp.expiresAt.toISOString(),
      botExpiresAt: sub.expiresAt.toISOString(),
      panelTrafficGb: c.trafficGb,
      botTrafficGb: sub.trafficGb,
      panelLimitIp: c.limitIp,
      botLimitIp: sub.limitIp ?? 0,
      panelEnable: c.enable,
      botEnable,
      panelStartsOnConnect: panelExp.startsOnConnect,
      botStartsOnConnect: sub.startsOnConnect,
    });
  }

  return {
    panelOnly,
    botOnly,
    mismatched,
    matched: botSubs.length - botOnly.length,
    panelTotal: panelClients.length,
    botTotal: botSubs.length,
  };
}

export type ImportPanelResult = {
  imported: number;
  skipped: number;
  failed: Array<{ email: string; error: string }>;
  ownerLabel: string;
};

/**
 * Import panel-only clients into bot DB under the admin user.
 * If `emails` is empty/omitted, imports all missing accounts.
 */
export async function importPanelClientsToBot(emails?: string[]): Promise<ImportPanelResult> {
  const owner = await resolvePanelImportOwner();
  const ownerLabel = owner.username
    ? `@${owner.username}`
    : owner.agentName || String(owner.telegramId);

  const wanted = emails?.length
    ? new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    : null;

  const panelClients = await listDetailedPanelClients();
  const existing = await prisma.subscription.findMany({ select: { email: true } });
  const inDb = new Set(existing.map((s) => s.email.toLowerCase()));

  let imported = 0;
  let skipped = 0;
  const failed: Array<{ email: string; error: string }> = [];

  for (const c of panelClients) {
    const key = c.email.toLowerCase();
    if (wanted && !wanted.has(key)) continue;
    if (inDb.has(key)) {
      skipped++;
      continue;
    }

    try {
      // Prefer fresh getClient for subId/uuid when available
      let uuid = c.uuid;
      let panelSubId = c.panelSubId;
      let trafficGb = c.trafficGb;
      let expiryTime = c.expiryTime;
      let enable = c.enable;
      let limitIp = c.limitIp;
      let comment = c.comment;
      try {
        const got = await c.xui.getClient(c.email);
        const client = got.obj?.client;
        if (client) {
          uuid =
            client.uuid != null
              ? String(client.uuid)
              : client.id != null
                ? String(client.id)
                : uuid;
          if (client.subId) panelSubId = client.subId;
          trafficGb = bytesToGb(client.totalGB) ?? trafficGb;
          expiryTime = Number(client.expiryTime ?? expiryTime);
          enable = client.enable !== false;
          limitIp = Number(client.limitIp ?? limitIp);
          if (typeof client.comment === "string" && client.comment.trim()) {
            comment = client.comment.trim();
          }
        }
      } catch {
        /* use list data */
      }

      const exp = expiryFromPanel(expiryTime);
      let subUrl: string | null = null;
      if (panelSubId) {
        try {
          subUrl = await resolveSubUrl(panelSubId, c.xui, c.subBase);
        } catch {
          subUrl = null;
        }
      }

      const parsed = parsePanelComment(comment);
      const code = await uniqueSubCode();
      await prisma.subscription.create({
        data: {
          code,
          userId: owner.id,
          orderId: null,
          panelServerId: c.panelServerId,
          title: parsed.title || c.email,
          email: c.email,
          clientUuid: uuid,
          panelSubId,
          trafficGb,
          startsOnConnect: exp.startsOnConnect,
          activatedAt: exp.activatedAt,
          expiresAt: exp.expiresAt,
          panelExpiryTime: BigInt(Math.trunc(expiryTime)),
          subUrl,
          note: parsed.note || "Imported from 3X-UI",
          limitIp: Math.max(0, Math.min(100, Math.floor(limitIp || 0))),
          status: enable ? SubscriptionStatus.active : SubscriptionStatus.disabled,
          isTest: false,
        },
      });
      inDb.add(key);
      imported++;
    } catch (err) {
      failed.push({
        email: c.email,
        error: String(err instanceof Error ? err.message : err).slice(0, 200),
      });
    }
  }

  if (wanted && imported === 0 && skipped === 0 && failed.length === 0) {
    throw new Error("اکانتی برای وارد کردن پیدا نشد (شاید قبلاً وارد شده یا در پنل نیست).");
  }

  return { imported, skipped, failed, ownerLabel };
}

export type ReconcileResult = {
  checked: number;
  updated: number;
  disabledFromPanel: number;
  removedFromPanel: number;
  reactivated: number;
  errors: number;
};

/**
 * Apply panel → bot changes for existing subscriptions:
 * - deleted in panel → status disabled
 * - disabled in panel → status disabled
 * - re-enabled in panel → status active (if not past expiry)
 * - traffic / expiry / uuid / panelSubId / panelServerId synced when changed
 *
 * Does not auto-import panel-only clients (use importPanelClientsToBot).
 */
export async function reconcileSubscriptionsFromPanel(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    checked: 0,
    updated: 0,
    disabledFromPanel: 0,
    removedFromPanel: 0,
    reactivated: 0,
    errors: 0,
  };

  let panelClients: DetailedPanelClient[] = [];
  try {
    panelClients = await listDetailedPanelClients();
  } catch (err) {
    console.error("reconcile: list panel clients failed", err);
    result.errors++;
    return result;
  }

  // If every panel is unreachable we get [] — do not mass-disable all bot rows.
  if (!panelClients.length) {
    const panels = await listPanelServers();
    const hasConfigured =
      panels.some((p) => p.active) || Boolean(env.XUI_BASE_URL && env.XUI_API_TOKEN);
    if (hasConfigured) {
      console.warn("reconcile: no panel clients returned — skip botOnly disable this tick");
      return result;
    }
  }

  const panelByEmail = new Map(panelClients.map((c) => [c.email.toLowerCase(), c]));
  const subs = await prisma.subscription.findMany({
    where: {
      status: { in: [SubscriptionStatus.active, SubscriptionStatus.disabled] },
    },
  });

  const now = Date.now();

  for (const sub of subs) {
    result.checked++;
    const key = sub.email.toLowerCase();
    const panel = panelByEmail.get(key);

    try {
      if (!panel) {
        // Confirm missing on the subscription's own panel (avoid false disable if another panel was unreachable).
        try {
          const resolved = await resolvePanelForSubscription(sub);
          const got = await resolved.xui.getClient(sub.email);
          if (got.obj?.client) {
            // Present on home panel but missing from aggregate list — sync from getClient
            const client = got.obj.client;
            const data: {
              status?: SubscriptionStatus;
              trafficGb?: number | null;
              expiresAt?: Date;
              activatedAt?: Date | null;
              startsOnConnect?: boolean;
              panelExpiryTime?: bigint;
              clientUuid?: string | null;
              panelSubId?: string | null;
            } = {};
            if (client.enable === false && sub.status === SubscriptionStatus.active) {
              data.status = SubscriptionStatus.disabled;
              result.disabledFromPanel++;
            } else if (client.enable !== false && sub.status === SubscriptionStatus.disabled && sub.expiresAt.getTime() > now) {
              data.status = SubscriptionStatus.active;
              result.reactivated++;
            }
            const gb = bytesToGb(client.totalGB);
            if (gb !== sub.trafficGb) data.trafficGb = gb;
            const expMs = Number(client.expiryTime ?? 0);
            if (panelExpiryDiffersFromBot(expMs, sub)) {
              const next = applyPanelExpiryToBotData(expMs, sub);
              data.expiresAt = next.expiresAt;
              data.startsOnConnect = next.startsOnConnect;
              data.activatedAt = next.activatedAt;
              data.panelExpiryTime = next.panelExpiryTime;
            }
            if (client.uuid != null || client.id != null) {
              const uuid = String(client.uuid ?? client.id);
              if (uuid !== sub.clientUuid) data.clientUuid = uuid;
            }
            if (client.subId && client.subId !== sub.panelSubId) data.panelSubId = client.subId;
            if (Object.keys(data).length) {
              await prisma.subscription.update({ where: { id: sub.id }, data });
              result.updated++;
            }
            continue;
          }
        } catch {
          // Panel unreachable for this sub — leave row unchanged
          continue;
        }

        if (sub.status === SubscriptionStatus.active) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: SubscriptionStatus.disabled },
          });
          result.removedFromPanel++;
          result.updated++;
        }
        continue;
      }

      const data: {
        status?: SubscriptionStatus;
        trafficGb?: number | null;
        expiresAt?: Date;
        activatedAt?: Date | null;
        startsOnConnect?: boolean;
        panelExpiryTime?: bigint;
        clientUuid?: string | null;
        panelSubId?: string | null;
        panelServerId?: string | null;
        title?: string | null;
        note?: string | null;
      } = {};

      if (!panel.enable) {
        if (sub.status === SubscriptionStatus.active) {
          data.status = SubscriptionStatus.disabled;
          result.disabledFromPanel++;
        }
      }

      if (panel.trafficGb !== sub.trafficGb) {
        // null = unlimited on both sides
        data.trafficGb = panel.trafficGb;
      }

      if (panelExpiryDiffersFromBot(panel.expiryTime, sub)) {
        const next = applyPanelExpiryToBotData(panel.expiryTime, sub);
        data.expiresAt = next.expiresAt;
        data.startsOnConnect = next.startsOnConnect;
        data.activatedAt = next.activatedAt;
        data.panelExpiryTime = next.panelExpiryTime;
      }

      if (panel.enable && sub.status === SubscriptionStatus.disabled) {
        const stillValid = (data.expiresAt ?? sub.expiresAt).getTime() > now;
        if (stillValid) {
          data.status = SubscriptionStatus.active;
          result.reactivated++;
        }
      }

      if (panel.uuid && panel.uuid !== sub.clientUuid) data.clientUuid = panel.uuid;
      if (panel.panelSubId && panel.panelSubId !== sub.panelSubId) data.panelSubId = panel.panelSubId;
      if (panel.panelServerId && panel.panelServerId !== sub.panelServerId) {
        data.panelServerId = panel.panelServerId;
      }
      if (panel.comment) {
        const parsed = parsePanelComment(panel.comment);
        const botComment = composePanelComment(sub.title, sub.note);
        const panelComment = panel.comment.trim();
        if (panelComment !== botComment) {
          if (parsed.title && parsed.title !== sub.title) data.title = parsed.title;
          if (parsed.note !== undefined && parsed.note !== sub.note) {
            // Only overwrite note when panel comment encodes a note, or title-only comment clears a stale import note
            if (parsed.note != null) data.note = parsed.note;
            else if (
              !sub.note ||
              sub.note === "Imported from 3X-UI" ||
              sub.note === "وارد شده از پنل 3x-ui"
            ) {
              data.note = null;
            }
          }
          if (!sub.title && parsed.title) data.title = parsed.title;
        }
      }

      // Past absolute expiry while still "active" after merges
      const nextStatus = data.status ?? sub.status;
      const nextExpiry = data.expiresAt ?? sub.expiresAt;
      if (nextStatus === SubscriptionStatus.active && nextExpiry.getTime() <= now) {
        data.status = SubscriptionStatus.expired;
      }

      if (Object.keys(data).length) {
        await prisma.subscription.update({ where: { id: sub.id }, data });
        result.updated++;
      }
    } catch (err) {
      result.errors++;
      console.warn("reconcile sub failed", sub.email, err);
    }
  }

  return result;
}

export type SyncDirection = "panel_to_bot" | "bot_to_panel";

export type SyncOption =
  | "newAccounts"
  | "deletedAccounts"
  | "name"
  | "traffic"
  | "expiry"
  | "inbounds"
  | "limitIp"
  | "comment"
  | "note";

export const ALL_SYNC_OPTIONS: SyncOption[] = [
  "newAccounts",
  "deletedAccounts",
  "name",
  "traffic",
  "expiry",
  "inbounds",
  "limitIp",
  "comment",
  "note",
];

export type SyncApplyInput = {
  direction: SyncDirection;
  options: SyncOption[];
};

export type SelectiveSyncResult = {
  direction: SyncDirection;
  options: SyncOption[];
  created: number;
  deleted: number;
  updated: number;
  skippedUnreachable: number;
  errors: number;
  failed: Array<{ email: string; error: string }>;
  undoAvailable: boolean;
};

const SYNC_UNDO_KEY = "panel_sync_undo";

type BotSnap = {
  id: string;
  code: string;
  userId: string;
  orderId: string | null;
  panelServerId: string | null;
  title: string | null;
  email: string;
  clientUuid: string | null;
  panelSubId: string | null;
  trafficGb: number | null;
  startsOnConnect: boolean;
  activatedAt: string | null;
  panelExpiryTime: string | null;
  isTest: boolean;
  expiresAt: string;
  subUrl: string | null;
  note: string | null;
  limitIp: number;
  status: SubscriptionStatus;
};

type PanelSnap = {
  totalGB?: number;
  expiryTime?: number;
  enable?: boolean;
  limitIp?: number;
  comment?: string | null;
  uuid?: string | null;
  subId?: string | null;
};

type SyncUndoSnapshot = {
  direction: SyncDirection;
  options: SyncOption[];
  createdAt: string;
  /** Bot rows created by this sync — delete on undo */
  createdSubIds: string[];
  /** Bot rows deleted — recreate on undo */
  deletedSubs: BotSnap[];
  /** Panel clients created (bot→panel new) — delete from panel on undo */
  createdPanelEmails: string[];
  /** Panel clients deleted (bot→panel deletedAccounts) — best-effort recreate */
  deletedPanel: Array<{
    email: string;
    panelServerId: string | null;
    before: PanelSnap & { inboundIds?: number[] };
  }>;
  /** Bot field updates — restore before */
  botUpdates: Array<{ id: string; before: Partial<BotSnap> }>;
  /** Panel field updates — restore before */
  panelUpdates: Array<{
    email: string;
    panelServerId: string | null;
    before: PanelSnap;
  }>;
};

function hasOpt(opts: Set<SyncOption>, o: SyncOption) {
  return opts.has(o);
}

function subToSnap(sub: Subscription): BotSnap {
  return {
    id: sub.id,
    code: sub.code,
    userId: sub.userId,
    orderId: sub.orderId,
    panelServerId: sub.panelServerId,
    title: sub.title,
    email: sub.email,
    clientUuid: sub.clientUuid,
    panelSubId: sub.panelSubId,
    trafficGb: sub.trafficGb,
    startsOnConnect: sub.startsOnConnect,
    activatedAt: sub.activatedAt?.toISOString() ?? null,
    panelExpiryTime: sub.panelExpiryTime != null ? String(sub.panelExpiryTime) : null,
    isTest: sub.isTest,
    expiresAt: sub.expiresAt.toISOString(),
    subUrl: sub.subUrl,
    note: sub.note,
    limitIp: sub.limitIp ?? 0,
    status: sub.status,
  };
}

function panelClientToSnap(c: {
  totalGB?: number;
  expiryTime?: number;
  enable?: boolean;
  limitIp?: number;
  comment?: string | null;
  uuid?: string | null;
  id?: string | null;
  subId?: string | null;
}): PanelSnap {
  return {
    totalGB: Number(c.totalGB ?? 0),
    expiryTime: Number(c.expiryTime ?? 0),
    enable: c.enable !== false,
    limitIp: Number(c.limitIp ?? 0),
    comment: typeof c.comment === "string" ? c.comment : c.comment ?? null,
    uuid: c.uuid != null ? String(c.uuid) : c.id != null ? String(c.id) : null,
    subId: c.subId ?? null,
  };
}

async function saveUndoSnapshot(snap: SyncUndoSnapshot) {
  await setSetting(SYNC_UNDO_KEY, JSON.stringify(snap));
}

export async function getSyncUndoStatus(): Promise<{ available: boolean; createdAt: string | null }> {
  try {
    const raw = await getSetting(SYNC_UNDO_KEY);
    if (!raw?.trim()) return { available: false, createdAt: null };
    const parsed = JSON.parse(raw) as SyncUndoSnapshot;
    return { available: true, createdAt: parsed.createdAt ?? null };
  } catch {
    return { available: false, createdAt: null };
  }
}

async function assertPanelReachable(panelClients: DetailedPanelClient[]) {
  const panels = await listPanelServers();
  const hasConfigured =
    panels.some((p) => p.active) || Boolean(env.XUI_BASE_URL && env.XUI_API_TOKEN);
  if (!panelClients.length && hasConfigured) {
    throw new Error(
      "هیچ اکانتی از پنل برنگشت. برای جلوگیری از پاک شدن اشتباه، همگام‌سازی متوقف شد. اتصال پنل را بررسی کنید.",
    );
  }
}

async function defaultPanelForCreate(): Promise<{
  xui: XuiClient;
  inboundIds: number[];
  subBase: string | null;
  panelServerId: string | null;
  panelName: string;
}> {
  const panels = await listPanelServers();
  const active = panels.filter((p) => p.active);
  if (active[0]) {
    const p = active[0];
    return {
      xui: createXuiFromPanel(p),
      inboundIds: panelInboundIds(p),
      subBase: sanitizeSubBase(p.subBase),
      panelServerId: p.id,
      panelName: p.name,
    };
  }
  if (env.XUI_BASE_URL && env.XUI_API_TOKEN) {
    const xui = createXuiFromEnv(env);
    return {
      xui,
      inboundIds: await xui.listEnabledInboundIds(),
      subBase: sanitizeSubBase(env.XUI_SUB_BASE),
      panelServerId: null,
      panelName: "سرور پیش‌فرض (.env)",
    };
  }
  throw new Error("هیچ پنل فعالی برای ساخت اکانت تنظیم نشده است.");
}

/**
 * Selective one-way sync with undo snapshot.
 */
export async function selectiveSync(input: SyncApplyInput): Promise<SelectiveSyncResult> {
  const direction = input.direction;
  if (direction !== "panel_to_bot" && direction !== "bot_to_panel") {
    throw new Error("جهت همگام‌سازی نامعتبر است");
  }
  const optSet = new Set(
    (input.options ?? []).filter((o): o is SyncOption =>
      (ALL_SYNC_OPTIONS as string[]).includes(o),
    ),
  );
  if (!optSet.size) throw new Error("حداقل یک گزینه همگام‌سازی را انتخاب کنید");

  const result: SelectiveSyncResult = {
    direction,
    options: [...optSet],
    created: 0,
    deleted: 0,
    updated: 0,
    skippedUnreachable: 0,
    errors: 0,
    failed: [],
    undoAvailable: false,
  };

  let panelClients = await listDetailedPanelClients();
  await assertPanelReachable(panelClients);

  const undo: SyncUndoSnapshot = {
    direction,
    options: [...optSet],
    createdAt: new Date().toISOString(),
    createdSubIds: [],
    deletedSubs: [],
    createdPanelEmails: [],
    deletedPanel: [],
    botUpdates: [],
    panelUpdates: [],
  };

  const panelByEmail = new Map(panelClients.map((c) => [c.email.toLowerCase(), c]));
  const subs = await prisma.subscription.findMany();
  const botByEmail = new Map(subs.map((s) => [s.email.toLowerCase(), s]));

  // ——— Structural: new accounts ———
  if (hasOpt(optSet, "newAccounts")) {
    if (direction === "panel_to_bot") {
      for (const c of panelClients) {
        const key = c.email.toLowerCase();
        if (botByEmail.has(key)) continue;
        try {
          const beforeCount = undo.createdSubIds.length;
          const created = await importOnePanelClient(c);
          if (created) {
            undo.createdSubIds.push(created.id);
            botByEmail.set(key, created as Subscription);
            result.created++;
          } else if (undo.createdSubIds.length === beforeCount) {
            /* skipped */
          }
        } catch (err) {
          result.errors++;
          result.failed.push({
            email: c.email,
            error: String(err instanceof Error ? err.message : err).slice(0, 200),
          });
        }
      }
    } else {
      // bot → panel: create missing panel clients
      for (const sub of subs) {
        const key = sub.email.toLowerCase();
        if (panelByEmail.has(key)) continue;
        try {
          // Confirm truly missing
          let exists = false;
          try {
            const resolved = await resolvePanelForSubscription(sub);
            const got = await resolved.xui.getClient(sub.email);
            if (got.obj?.client) exists = true;
          } catch (err) {
            const msg = String(err instanceof Error ? err.message : err);
            if (!/not found|404|وجود ندارد|no client|not exist/i.test(msg)) {
              result.skippedUnreachable++;
              continue;
            }
          }
          if (exists) continue;

          const target = sub.panelServerId
            ? await resolvePanelForSubscription(sub)
            : await defaultPanelForCreate();
          const inboundIds =
            hasOpt(optSet, "inbounds") && "inboundIds" in target && target.inboundIds?.length
              ? target.inboundIds
              : (await defaultPanelForCreate()).inboundIds;
          const xui = "xui" in target ? target.xui : (await defaultPanelForCreate()).xui;
          const panelServerId =
            "panel" in target && target.panel
              ? target.panel.id
              : "panelServerId" in target
                ? (target as { panelServerId: string | null }).panelServerId
                : sub.panelServerId;

          const uuid = sub.clientUuid || randomUUID();
          const panelSubId = sub.panelSubId || randomSubId();
          const comment = composePanelComment(sub.title, sub.note) || sub.email;
          const expiryTime = expiryTimeForPanel(sub);

          await xui.addClient({
            client: {
              id: uuid,
              email: sub.email,
              enable: sub.status === SubscriptionStatus.active,
              expiryTime,
              totalGB: sub.trafficGb != null && sub.trafficGb > 0 ? gbToBytes(sub.trafficGb) : 0,
              limitIp: sub.limitIp ?? 0,
              subId: panelSubId,
              comment,
            },
            inboundIds: inboundIds.length ? inboundIds : [1],
          });

          undo.createdPanelEmails.push(sub.email);
          const data: { clientUuid?: string; panelSubId?: string; panelServerId?: string | null } =
            {};
          if (!sub.clientUuid) data.clientUuid = uuid;
          if (!sub.panelSubId) data.panelSubId = panelSubId;
          if (panelServerId && panelServerId !== sub.panelServerId) data.panelServerId = panelServerId;
          if (Object.keys(data).length) {
            await prisma.subscription.update({ where: { id: sub.id }, data });
          }
          panelByEmail.set(key, {
            email: sub.email,
            panelServerId: panelServerId ?? null,
            panelName: "created",
            xui,
            subBase: null,
            uuid,
            panelSubId,
            trafficGb: sub.trafficGb,
            expiryTime,
            enable: sub.status === SubscriptionStatus.active,
            limitIp: sub.limitIp ?? 0,
            comment,
          });
          result.created++;
        } catch (err) {
          result.errors++;
          result.failed.push({
            email: sub.email,
            error: String(err instanceof Error ? err.message : err).slice(0, 200),
          });
        }
      }
    }
  }

  // Refresh maps after creates
  panelClients = await listDetailedPanelClients();
  await assertPanelReachable(panelClients);
  panelByEmail.clear();
  for (const c of panelClients) panelByEmail.set(c.email.toLowerCase(), c);
  const subsFresh = await prisma.subscription.findMany();
  botByEmail.clear();
  for (const s of subsFresh) botByEmail.set(s.email.toLowerCase(), s);

  // ——— Structural: deleted accounts ———
  if (hasOpt(optSet, "deletedAccounts")) {
    if (direction === "panel_to_bot") {
      for (const sub of [...botByEmail.values()]) {
        const key = sub.email.toLowerCase();
        if (panelByEmail.has(key)) continue;
        try {
          try {
            const resolved = await resolvePanelForSubscription(sub);
            const got = await resolved.xui.getClient(sub.email);
            if (got.obj?.client) continue;
          } catch (err) {
            const msg = String(err instanceof Error ? err.message : err);
            if (!/not found|404|وجود ندارد|no client|not exist/i.test(msg)) {
              result.skippedUnreachable++;
              continue;
            }
          }
          undo.deletedSubs.push(subToSnap(sub));
          await deleteSubscriptionDbOnly(sub.id);
          botByEmail.delete(key);
          result.deleted++;
        } catch (err) {
          result.errors++;
          result.failed.push({
            email: sub.email,
            error: String(err instanceof Error ? err.message : err).slice(0, 200),
          });
        }
      }
    } else {
      // bot → panel: delete panel-only clients
      for (const c of panelClients) {
        const key = c.email.toLowerCase();
        if (botByEmail.has(key)) continue;
        try {
          undo.deletedPanel.push({
            email: c.email,
            panelServerId: c.panelServerId,
            before: {
              ...panelClientToSnap({
                totalGB: c.trafficGb != null ? gbToBytes(c.trafficGb) : 0,
                expiryTime: c.expiryTime,
                enable: c.enable,
                limitIp: c.limitIp,
                comment: c.comment,
                uuid: c.uuid,
                subId: c.panelSubId,
              }),
              inboundIds: hasOpt(optSet, "inbounds")
                ? await c.xui.listEnabledInboundIds().catch(() => [1])
                : undefined,
            },
          });
          await c.xui.deleteClient(c.email);
          panelByEmail.delete(key);
          result.deleted++;
        } catch (err) {
          result.errors++;
          result.failed.push({
            email: c.email,
            error: String(err instanceof Error ? err.message : err).slice(0, 200),
          });
        }
      }
    }
  }

  // ——— Field sync for matched ———
  const fieldOpts: SyncOption[] = ["name", "traffic", "expiry", "limitIp", "comment", "note"];
  const anyField = fieldOpts.some((o) => hasOpt(optSet, o));
  // inbounds only affects create path in v1

  if (anyField) {
    const now = Date.now();
    for (const sub of botByEmail.values()) {
      const panel = panelByEmail.get(sub.email.toLowerCase());
      if (!panel) continue;
      try {
        if (direction === "panel_to_bot") {
          const changed = await applyPanelFieldsToBot(sub, panel, optSet, now, undo);
          if (changed) result.updated++;
        } else {
          const changed = await applyBotFieldsToPanel(sub, panel, optSet, undo);
          if (changed) result.updated++;
        }
      } catch (err) {
        result.errors++;
        result.failed.push({
          email: sub.email,
          error: String(err instanceof Error ? err.message : err).slice(0, 200),
        });
      }
    }
  }

  const hasChanges =
    undo.createdSubIds.length +
      undo.deletedSubs.length +
      undo.createdPanelEmails.length +
      undo.deletedPanel.length +
      undo.botUpdates.length +
      undo.panelUpdates.length >
    0;

  if (hasChanges) {
    await saveUndoSnapshot(undo);
    result.undoAvailable = true;
  }

  return result;
}

async function importOnePanelClient(c: DetailedPanelClient): Promise<Subscription | null> {
  const owner = await resolvePanelImportOwner();
  const existing = await prisma.subscription.findFirst({
    where: { email: { equals: c.email } },
  });
  if (existing) return null;

  let uuid = c.uuid;
  let panelSubId = c.panelSubId;
  let trafficGb = c.trafficGb;
  let expiryTime = c.expiryTime;
  let enable = c.enable;
  let limitIp = c.limitIp;
  let comment = c.comment;
  try {
    const got = await c.xui.getClient(c.email);
    const client = got.obj?.client;
    if (client) {
      uuid =
        client.uuid != null ? String(client.uuid) : client.id != null ? String(client.id) : uuid;
      if (client.subId) panelSubId = client.subId;
      trafficGb = bytesToGb(client.totalGB) ?? trafficGb;
      expiryTime = Number(client.expiryTime ?? expiryTime);
      enable = client.enable !== false;
      limitIp = Number(client.limitIp ?? limitIp);
      if (typeof client.comment === "string" && client.comment.trim()) {
        comment = client.comment.trim();
      }
    }
  } catch {
    /* list data */
  }

  const exp = expiryFromPanel(expiryTime);
  let subUrl: string | null = null;
  if (panelSubId) {
    try {
      subUrl = await resolveSubUrl(panelSubId, c.xui, c.subBase);
    } catch {
      subUrl = null;
    }
  }
  const parsed = parsePanelComment(comment);
  const code = await uniqueSubCode();
  return prisma.subscription.create({
    data: {
      code,
      userId: owner.id,
      orderId: null,
      panelServerId: c.panelServerId,
      title: parsed.title || c.email,
      email: c.email,
      clientUuid: uuid,
      panelSubId,
      trafficGb,
      startsOnConnect: exp.startsOnConnect,
      activatedAt: exp.activatedAt,
      expiresAt: exp.expiresAt,
      panelExpiryTime: BigInt(Math.trunc(expiryTime)),
      subUrl,
      note: parsed.note || "Imported from 3X-UI",
      limitIp: Math.max(0, Math.min(100, Math.floor(limitIp || 0))),
      status: enable ? SubscriptionStatus.active : SubscriptionStatus.disabled,
      isTest: false,
    },
  });
}

async function applyPanelFieldsToBot(
  sub: Subscription,
  panel: DetailedPanelClient,
  optSet: Set<SyncOption>,
  _now: number,
  undo: SyncUndoSnapshot,
): Promise<boolean> {
  const data: Record<string, unknown> = {};
  const before: Partial<BotSnap> = {};

  // List APIs often omit comment / stale fields — refresh when text/limit sync is requested.
  let trafficGb = panel.trafficGb;
  let expiryTime = panel.expiryTime;
  let limitIp = panel.limitIp;
  let panelComment = (panel.comment || "").trim();
  const needsFresh =
    hasOpt(optSet, "comment") ||
    hasOpt(optSet, "note") ||
    hasOpt(optSet, "name") ||
    hasOpt(optSet, "limitIp") ||
    hasOpt(optSet, "traffic") ||
    hasOpt(optSet, "expiry");

  if (needsFresh) {
    try {
      const got = await panel.xui.getClient(sub.email);
      const client = got.obj?.client;
      if (client) {
        trafficGb = bytesToGb(client.totalGB) ?? trafficGb;
        expiryTime = Number(client.expiryTime ?? expiryTime);
        limitIp = Number(client.limitIp ?? limitIp);
        if (typeof client.comment === "string") {
          panelComment = client.comment.trim();
        }
      }
    } catch {
      /* use list snapshot */
    }
  }

  if (hasOpt(optSet, "traffic") && trafficGb !== sub.trafficGb) {
    before.trafficGb = sub.trafficGb;
    data.trafficGb = trafficGb;
  }

  if (hasOpt(optSet, "expiry") && panelExpiryDiffersFromBot(expiryTime, sub)) {
    const next = applyPanelExpiryToBotData(expiryTime, sub);
    before.expiresAt = sub.expiresAt.toISOString();
    before.startsOnConnect = sub.startsOnConnect;
    before.activatedAt = sub.activatedAt?.toISOString() ?? null;
    before.panelExpiryTime =
      sub.panelExpiryTime != null ? String(sub.panelExpiryTime) : null;
    data.expiresAt = next.expiresAt;
    data.startsOnConnect = next.startsOnConnect;
    data.activatedAt = next.activatedAt;
    data.panelExpiryTime = next.panelExpiryTime;
  }

  if (hasOpt(optSet, "limitIp") && limitIp !== (sub.limitIp ?? 0)) {
    before.limitIp = sub.limitIp ?? 0;
    data.limitIp = limitIp;
  }

  const parsed = parsePanelComment(panelComment);
  const composed = composePanelComment(sub.title, sub.note);

  if (hasOpt(optSet, "comment") && panelComment && panelComment !== composed) {
    // `title | note` → split; otherwise treat whole panel comment as bot note (visible memo).
    if (panelComment.includes("|")) {
      if (parsed.title !== sub.title) {
        before.title = sub.title;
        data.title = parsed.title;
      }
      if (parsed.note !== sub.note) {
        before.note = sub.note;
        data.note = parsed.note;
      }
    } else if (panelComment !== (sub.note ?? "").trim()) {
      before.note = sub.note;
      data.note = panelComment.slice(0, 500);
    }
  }

  if (!hasOpt(optSet, "comment")) {
    if (hasOpt(optSet, "name") && parsed.title && parsed.title !== sub.title) {
      before.title = sub.title;
      data.title = parsed.title;
    }
    if (hasOpt(optSet, "note") && panelComment) {
      const noteVal = hasOpt(optSet, "name")
        ? parsed.note
        : (parsed.note ?? (panelComment.includes("|") ? null : panelComment));
      if (noteVal != null && noteVal !== sub.note) {
        before.note = sub.note;
        data.note = noteVal;
      }
    }
  } else {
    // comment already applied; still allow explicit name override from first segment
    if (hasOpt(optSet, "name") && parsed.title && parsed.title !== (data.title ?? sub.title)) {
      if (!("title" in before)) before.title = sub.title;
      data.title = parsed.title;
    }
  }

  // Always keep uuid/subId/server in sync lightly when any field sync runs
  if (panel.uuid && panel.uuid !== sub.clientUuid) {
    before.clientUuid = sub.clientUuid;
    data.clientUuid = panel.uuid;
  }
  if (panel.panelSubId && panel.panelSubId !== sub.panelSubId) {
    before.panelSubId = sub.panelSubId;
    data.panelSubId = panel.panelSubId;
  }
  if (panel.panelServerId && panel.panelServerId !== sub.panelServerId) {
    before.panelServerId = sub.panelServerId;
    data.panelServerId = panel.panelServerId;
  }

  if (!Object.keys(data).length) return false;
  undo.botUpdates.push({ id: sub.id, before });
  await prisma.subscription.update({ where: { id: sub.id }, data });
  return true;
}

async function applyBotFieldsToPanel(
  sub: Subscription,
  panel: DetailedPanelClient,
  optSet: Set<SyncOption>,
  undo: SyncUndoSnapshot,
): Promise<boolean> {
  const got = await panel.xui.getClient(sub.email);
  const client = got.obj?.client;
  if (!client) return false;

  const before = panelClientToSnap(client);
  const patch: Record<string, unknown> = { ...client, email: sub.email };
  let changed = false;

  if (hasOpt(optSet, "traffic")) {
    const want = sub.trafficGb != null && sub.trafficGb > 0 ? gbToBytes(sub.trafficGb) : 0;
    if (Number(client.totalGB ?? 0) !== want) {
      patch.totalGB = want;
      changed = true;
    }
  }

  if (hasOpt(optSet, "expiry")) {
    const want = expiryTimeForPanel(sub);
    if (Math.abs(Number(client.expiryTime ?? 0) - want) > 60_000) {
      patch.expiryTime = want;
      changed = true;
    }
  }

  if (hasOpt(optSet, "limitIp") && Number(client.limitIp ?? 0) !== (sub.limitIp ?? 0)) {
    patch.limitIp = sub.limitIp ?? 0;
    changed = true;
  }

  if (hasOpt(optSet, "comment")) {
    const want = composePanelComment(sub.title, sub.note);
    const cur = typeof client.comment === "string" ? client.comment.trim() : "";
    if (want !== cur) {
      patch.comment = want;
      changed = true;
    }
  } else {
    const cur = typeof client.comment === "string" ? client.comment.trim() : "";
    const parsed = parsePanelComment(cur);
    let title = parsed.title;
    let note = parsed.note;
    if (hasOpt(optSet, "name")) title = sub.title;
    if (hasOpt(optSet, "note")) note = sub.note;
    if (hasOpt(optSet, "name") || hasOpt(optSet, "note")) {
      const want = composePanelComment(title, note);
      if (want !== cur) {
        patch.comment = want;
        changed = true;
      }
    }
  }

  if (!changed) return false;
  undo.panelUpdates.push({
    email: sub.email,
    panelServerId: panel.panelServerId,
    before,
  });
  await panel.xui.updateClient(sub.email, patch);
  if (hasOpt(optSet, "expiry") && typeof patch.expiryTime === "number") {
    const want = Number(patch.expiryTime);
    if (
      sub.panelExpiryTime == null ||
      Math.abs(Number(sub.panelExpiryTime) - want) > 60_000
    ) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { panelExpiryTime: BigInt(Math.trunc(want)) },
      });
    }
  }
  return true;
}

/** @deprecated use selectiveSync — kept for older callers */
export async function fullSyncPanelAndBot(): Promise<SelectiveSyncResult> {
  return selectiveSync({
    direction: "panel_to_bot",
    options: ALL_SYNC_OPTIONS.filter((o) => o !== "inbounds"),
  });
}

export async function undoLastSync(): Promise<{
  ok: true;
  message: string;
  restored: number;
}> {
  const raw = await getSetting(SYNC_UNDO_KEY);
  if (!raw?.trim()) throw new Error("تغییر قابل برگشتی وجود ندارد");

  let snap: SyncUndoSnapshot;
  try {
    snap = JSON.parse(raw) as SyncUndoSnapshot;
  } catch {
    await setSetting(SYNC_UNDO_KEY, "");
    throw new Error("اسنپ‌شات Undo نامعتبر بود و پاک شد");
  }

  let restored = 0;

  // Reverse created bot rows
  for (const id of snap.createdSubIds ?? []) {
    try {
      await deleteSubscriptionDbOnly(id);
      restored++;
    } catch (err) {
      console.warn("undo delete created sub", id, err);
    }
  }

  // Reverse created panel clients
  for (const email of snap.createdPanelEmails ?? []) {
    try {
      const clients = await activeXuiClients();
      for (const xui of clients) {
        try {
          await xui.deleteClient(email);
          restored++;
          break;
        } catch {
          /* try next */
        }
      }
    } catch (err) {
      console.warn("undo delete panel client", email, err);
    }
  }

  // Restore deleted bot rows
  for (const s of snap.deletedSubs ?? []) {
    try {
      await prisma.subscription.create({
        data: {
          id: s.id,
          code: s.code,
          userId: s.userId,
          orderId: s.orderId,
          panelServerId: s.panelServerId,
          title: s.title,
          email: s.email,
          clientUuid: s.clientUuid,
          panelSubId: s.panelSubId,
          trafficGb: s.trafficGb,
          startsOnConnect: s.startsOnConnect,
          activatedAt: s.activatedAt ? new Date(s.activatedAt) : null,
          panelExpiryTime:
            s.panelExpiryTime != null && s.panelExpiryTime !== ""
              ? BigInt(s.panelExpiryTime)
              : null,
          isTest: s.isTest,
          expiresAt: new Date(s.expiresAt),
          subUrl: s.subUrl,
          note: s.note,
          limitIp: s.limitIp ?? 0,
          status: s.status,
        },
      });
      restored++;
    } catch (err) {
      console.warn("undo recreate sub", s.email, err);
    }
  }

  // Best-effort recreate deleted panel clients
  for (const d of snap.deletedPanel ?? []) {
    try {
      const target = d.panelServerId
        ? await resolvePanelForSubscription({ panelServerId: d.panelServerId })
        : await defaultPanelForCreate();
      const xui = target.xui;
      const inboundIds =
        d.before.inboundIds?.length
          ? d.before.inboundIds
          : "inboundIds" in target
            ? target.inboundIds
            : await xui.listEnabledInboundIds();
      await xui.addClient({
        client: {
          id: d.before.uuid || randomUUID(),
          email: d.email,
          enable: d.before.enable !== false,
          expiryTime: d.before.expiryTime ?? 0,
          totalGB: d.before.totalGB ?? 0,
          limitIp: d.before.limitIp ?? 0,
          subId: d.before.subId || randomSubId(),
          comment: d.before.comment || d.email,
        },
        inboundIds: inboundIds.length ? inboundIds : [1],
      });
      restored++;
    } catch (err) {
      console.warn("undo recreate panel", d.email, err);
    }
  }

  // Restore bot field updates
  for (const u of snap.botUpdates ?? []) {
    try {
      const data: Record<string, unknown> = {};
      const b = u.before;
      if ("title" in b) data.title = b.title;
      if ("note" in b) data.note = b.note;
      if ("trafficGb" in b) data.trafficGb = b.trafficGb;
      if ("expiresAt" in b && b.expiresAt) data.expiresAt = new Date(b.expiresAt);
      if ("startsOnConnect" in b) data.startsOnConnect = b.startsOnConnect;
      if ("activatedAt" in b) data.activatedAt = b.activatedAt ? new Date(b.activatedAt) : null;
      if ("panelExpiryTime" in b) {
        data.panelExpiryTime =
          b.panelExpiryTime != null && b.panelExpiryTime !== ""
            ? BigInt(b.panelExpiryTime)
            : null;
      }
      if ("limitIp" in b) data.limitIp = b.limitIp;
      if ("status" in b) data.status = b.status;
      if ("clientUuid" in b) data.clientUuid = b.clientUuid;
      if ("panelSubId" in b) data.panelSubId = b.panelSubId;
      if ("panelServerId" in b) data.panelServerId = b.panelServerId;
      if (Object.keys(data).length) {
        await prisma.subscription.update({ where: { id: u.id }, data });
        restored++;
      }
    } catch (err) {
      console.warn("undo bot update", u.id, err);
    }
  }

  // Restore panel field updates
  for (const u of snap.panelUpdates ?? []) {
    try {
      const resolved = u.panelServerId
        ? await resolvePanelForSubscription({ panelServerId: u.panelServerId })
        : null;
      const xui = resolved?.xui ?? (await activeXuiClients())[0];
      if (!xui) continue;
      const got = await xui.getClient(u.email);
      const client = got.obj?.client;
      if (!client) continue;
      const patch: Record<string, unknown> = { ...client, email: u.email };
      if (u.before.totalGB !== undefined) patch.totalGB = u.before.totalGB;
      if (u.before.expiryTime !== undefined) patch.expiryTime = u.before.expiryTime;
      if (u.before.enable !== undefined) patch.enable = u.before.enable;
      if (u.before.limitIp !== undefined) patch.limitIp = u.before.limitIp;
      if (u.before.comment !== undefined) patch.comment = u.before.comment;
      await xui.updateClient(u.email, patch);
      restored++;
    } catch (err) {
      console.warn("undo panel update", u.email, err);
    }
  }

  await setSetting(SYNC_UNDO_KEY, "");
  return {
    ok: true,
    message: `آخرین همگام‌سازی برگردانده شد (${restored} مورد).`,
    restored,
  };
}

export function startPanelReconcileCron(intervalMs = 10 * 60 * 1000) {
  const tick = async () => {
    try {
      const r = await reconcileSubscriptionsFromPanel();
      if (r.updated > 0 || r.errors > 0) {
        console.log(
          `panel reconcile: checked=${r.checked} updated=${r.updated} disabled=${r.disabledFromPanel} removed=${r.removedFromPanel} reactivated=${r.reactivated} errors=${r.errors}`,
        );
      }
    } catch (err) {
      console.error("panel reconcile error", err);
    }
  };
  setTimeout(tick, 90_000);
  return setInterval(tick, intervalMs);
}
