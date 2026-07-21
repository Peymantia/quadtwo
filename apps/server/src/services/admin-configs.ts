import { UserRole, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { resolvePanelForSubscription, listPanelServers, createXuiFromPanel } from "./panel-servers.js";
import { createXuiFromEnv, type XuiClient } from "../panel/xui-client.js";
import { env, adminIds } from "../config/env.js";
import { TELEGRAM_GROUP } from "./panel-groups.js";
import { formatXuiError } from "../panel/xui-errors.js";
import { gbToBytes, shortCode } from "../utils/format.js";
import { resolveSubUrl } from "./provision.js";
import { sanitizeSubBase } from "./sub-url.js";

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
  agentName: string | null;
  telegramId: bigint;
}) {
  return user.username
    ? `@${user.username}`
    : user.agentName || String(user.telegramId);
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

/** List configs for a group key (`all` | `tg` | `p{userId}` | `xg:…`). */
export async function listConfigsForGroup(
  groupKey: string,
  page = 0,
  pageSize = 12,
): Promise<{ items: ConfigListItem[]; total: number; title: string }> {
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
      byEmail.set(s.email.toLowerCase(), {
        email: s.email,
        subId: s.id,
        code: s.code,
        ownerLabel: ownerFromUser(s.user),
        inDb: true,
        status: s.status,
      });
    }
    mergePanelOnly(byEmail, panelEmails);

    const all = [...byEmail.values()].sort((a, b) => {
      if (a.inDb !== b.inDb) return a.inDb ? -1 : 1;
      return a.email.localeCompare(b.email);
    });
    const total = all.length;
    const items = all.slice(page * pageSize, page * pageSize + pageSize);
    return { title: "تمام کانفیگ‌ها", total, items };
  }

  const panelGroup =
    meta?.panelGroup ?? decodePanelGroupKey(groupKey);
  if (!panelGroup) {
    return { title, total: 0, items: [] };
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
    byEmail.set(s.email.toLowerCase(), {
      email: s.email,
      subId: s.id,
      code: s.code,
      ownerLabel: ownerFromUser(s.user),
      inDb: true,
      status: s.status,
    });
  }

  mergePanelOnly(byEmail, panelEmails);

  const all = [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
  const total = all.length;
  const items = all.slice(page * pageSize, page * pageSize + pageSize);
  return { title: meta?.label ?? panelGroup, total, items };
}

export type DeleteConfigResult = {
  deletedPanel: boolean;
  deletedDb: boolean;
  email: string;
  message: string;
};

/**
 * Delete config: from panel if present, always from bot DB when row exists.
 */
export async function deleteConfig(opts: {
  subId?: string | null;
  email: string;
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

  return {
    deletedPanel,
    deletedDb,
    email,
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
  trafficGb: number | null;
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

  const found: PanelClientBits[] = [];

  const tryGet = async (xui: {
    getClient: (e: string) => Promise<{ obj?: { client?: PanelClientBits } }>;
  }) => {
    if (found.length) return;
    try {
      const got = await xui.getClient(email);
      if (got.obj?.client) found.push(got.obj.client);
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

  const panelClient = found[0] ?? null;
  const bytes = Number(panelClient?.totalGB ?? 0);
  const panelGb =
    !panelClient || bytes <= 0 ? null : Math.max(1, Math.round(bytes / 1024 ** 3));

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
    trafficGb: sub?.trafficGb ?? panelGb,
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
      if (!sub.activatedAt) data.activatedAt = new Date();
    }
    if (opts.enable !== undefined) {
      data.status = opts.enable ? "active" : "disabled";
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

export type SyncDiffResult = {
  panelOnly: SyncDiffItem[];
  botOnly: Array<{ email: string; code: string; subId: string; ownerLabel: string }>;
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

function expiryFromPanel(expiryTime: number): {
  expiresAt: Date;
  startsOnConnect: boolean;
  activatedAt: Date | null;
} {
  if (expiryTime < 0) {
    return {
      expiresAt: new Date(Date.now() + Math.abs(expiryTime)),
      startsOnConnect: true,
      activatedAt: null,
    };
  }
  if (expiryTime > 0) {
    return {
      expiresAt: new Date(expiryTime),
      startsOnConnect: false,
      activatedAt: new Date(),
    };
  }
  return {
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    startsOnConnect: false,
    activatedAt: new Date(),
  };
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

  return {
    panelOnly,
    botOnly,
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

      const code = await uniqueSubCode();
      await prisma.subscription.create({
        data: {
          code,
          userId: owner.id,
          orderId: null,
          panelServerId: c.panelServerId,
          title: comment || c.email,
          email: c.email,
          clientUuid: uuid,
          panelSubId,
          trafficGb,
          startsOnConnect: exp.startsOnConnect,
          activatedAt: exp.activatedAt,
          expiresAt: exp.expiresAt,
          subUrl,
          note: "وارد شده از پنل 3x-ui",
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
