import { randomUUID } from "node:crypto";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { createXuiFromEnv, type XuiClient } from "../panel/xui-client.js";
import { formatXuiError } from "../panel/xui-errors.js";
import { env } from "../config/env.js";
import { gbToBytes, bytesToGb, shortCode } from "../utils/format.js";
import {
  createXuiFromPanel,
  listPanelServers,
  panelInboundIds,
  resolvePanelForSubscription,
} from "./panel-servers.js";
import { sanitizeSubBase } from "./sub-url.js";
import { resolveSubUrl } from "./provision.js";

export type AccountFullDetail = {
  email: string;
  uuid: string | null;
  password: string | null;
  /** 3x-ui subscription id (subId) */
  panelSubId: string | null;
  hysteriaAuth: string | null;
  trafficGb: number | null;
  usedTrafficBytes: number;
  remainTrafficBytes: number | null;
  remainTrafficLabel: string;
  limitIp: number;
  expiryTime: number;
  expiresAt: string | null;
  remainDays: number | null;
  comment: string | null;
  inboundIds: number[];
  notes: string | null;
  title: string | null;
  code: string | null;
  /** Bot subscription row id */
  botSubId: string | null;
  subUrl: string | null;
  enable: boolean;
  status: string | null;
  ownerLabel: string | null;
  panelServerId: string | null;
  panelFound: boolean;
  inDb: boolean;
  /** Raw panel client extras for restore */
  panelClient: Record<string, unknown> | null;
};

function formatBytesFa(bytes: number): string {
  if (bytes <= 0) return "۰";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} گیگ`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Math.round(mb)} مگ`;
  return `${Math.round(bytes / 1024)} کیلوبایت`;
}

function remainDaysFromExpiry(expiresAt: Date | null, expiryTime: number): number | null {
  if (expiryTime < 0) {
    return Math.max(0, Math.round(Math.abs(expiryTime) / 86_400_000));
  }
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function pickHysteriaAuth(client: Record<string, unknown>): string | null {
  for (const key of ["password", "passwd", "auth", "hyAuth", "hysteriaAuth"]) {
    const v = client[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function activeXuiClients(): Promise<XuiClient[]> {
  const panels = await listPanelServers();
  const active = panels.filter((p) => p.active).map((p) => createXuiFromPanel(p));
  if (active.length) return active;
  if (env.XUI_BASE_URL && env.XUI_API_TOKEN) return [createXuiFromEnv(env)];
  return [];
}

/**
 * Gather full account detail from bot DB + live 3x-ui (when reachable).
 */
export async function gatherAccountFullDetail(opts: {
  email: string;
  subId?: string | null;
}): Promise<AccountFullDetail> {
  const email = opts.email.trim();
  if (!email) throw new Error("ایمیل کانفیگ خالی است");

  let sub = opts.subId
    ? await prisma.subscription.findUnique({
        where: { id: opts.subId },
        include: { user: true },
      })
    : null;
  if (!sub) {
    sub = await prisma.subscription.findFirst({
      where: { email },
      include: { user: true },
    });
  }

  const state: {
    panelClient: Record<string, unknown> | null;
    inboundIds: number[];
    panelServerId: string | null;
    xui: XuiClient | null;
  } = {
    panelClient: null,
    inboundIds: [],
    panelServerId: sub?.panelServerId ?? null,
    xui: null,
  };

  const tryGet = async (xui: XuiClient, serverId?: string | null) => {
    if (state.panelClient) return;
    try {
      const got = await xui.getClient(email);
      const client = got.obj?.client as Record<string, unknown> | undefined;
      if (!client) return;
      state.panelClient = { ...client };
      state.inboundIds = Array.isArray(got.obj?.inboundIds)
        ? (got.obj!.inboundIds as number[]).map(Number).filter((n) => Number.isFinite(n))
        : [];
      state.xui = xui;
      if (serverId) state.panelServerId = serverId;
    } catch {
      /* next */
    }
  };

  if (sub) {
    try {
      const resolved = await resolvePanelForSubscription(sub);
      await tryGet(resolved.xui, resolved.panel?.id ?? sub.panelServerId);
    } catch {
      /* ignore */
    }
  }
  if (!state.panelClient) {
    const panels = await listPanelServers();
    for (const p of panels.filter((x) => x.active)) {
      await tryGet(createXuiFromPanel(p), p.id);
      if (state.panelClient) break;
    }
  }
  if (!state.panelClient) {
    for (const xui of await activeXuiClients()) {
      await tryGet(xui, null);
      if (state.panelClient) break;
    }
  }

  const panelClient = state.panelClient;
  const inboundIds = state.inboundIds;
  const panelServerId = state.panelServerId;

  let usedTrafficBytes = 0;
  let totalBytes = 0;
  if (state.xui) {
    try {
      const t = await state.xui.getClientTraffic(email);
      if (t) {
        usedTrafficBytes = t.used;
        totalBytes = t.total > 0 ? t.total : Number(panelClient?.totalGB ?? 0);
      }
    } catch {
      totalBytes = Number(panelClient?.totalGB ?? 0);
    }
  } else {
    totalBytes = Number(panelClient?.totalGB ?? 0);
  }

  const trafficGb =
    sub?.trafficGb ??
    bytesToGb(totalBytes) ??
    (sub?.trafficGb === null ? null : null);

  const remainTrafficBytes =
    totalBytes > 0 ? Math.max(0, totalBytes - usedTrafficBytes) : null;

  const expiryTime = Number(panelClient?.expiryTime ?? 0);
  let expiresAt: Date | null = sub?.expiresAt ?? null;
  if (expiryTime > 0) expiresAt = new Date(expiryTime);
  else if (expiryTime < 0 && !expiresAt) {
    expiresAt = new Date(Date.now() + Math.abs(expiryTime));
  }

  const uuid =
    panelClient?.uuid != null
      ? String(panelClient.uuid)
      : panelClient?.id != null
        ? String(panelClient.id)
        : sub?.clientUuid ?? null;

  const password =
    typeof panelClient?.password === "string" && panelClient.password.trim()
      ? panelClient.password.trim()
      : null;

  const panelSubId =
    (typeof panelClient?.subId === "string" && panelClient.subId) ||
    sub?.panelSubId ||
    null;

  const hysteriaAuth = panelClient ? pickHysteriaAuth(panelClient) : password;

  const comment =
    typeof panelClient?.comment === "string" ? panelClient.comment : null;

  const limitIp = Number(panelClient?.limitIp ?? sub?.limitIp ?? 0);
  const enable = panelClient
    ? panelClient.enable !== false
    : sub?.status === SubscriptionStatus.active;

  return {
    email,
    uuid,
    password,
    panelSubId,
    hysteriaAuth,
    trafficGb: trafficGb === undefined ? sub?.trafficGb ?? null : trafficGb,
    usedTrafficBytes,
    remainTrafficBytes,
    remainTrafficLabel:
      remainTrafficBytes == null
        ? totalBytes <= 0
          ? "نامحدود"
          : "—"
        : formatBytesFa(remainTrafficBytes),
    limitIp: Math.max(0, Math.floor(limitIp || 0)),
    expiryTime,
    expiresAt: expiresAt?.toISOString() ?? null,
    remainDays: remainDaysFromExpiry(expiresAt, expiryTime),
    comment,
    inboundIds,
    notes: sub?.note ?? null,
    title: sub?.title ?? null,
    code: sub?.code ?? null,
    botSubId: sub?.id ?? null,
    subUrl: sub?.subUrl ?? null,
    enable,
    status: sub?.status ?? (enable ? "active" : "disabled"),
    ownerLabel: sub
      ? sub.user.username
        ? `@${sub.user.username}`
        : sub.user.agentName || String(sub.user.telegramId)
      : null,
    panelServerId,
    panelFound: Boolean(panelClient),
    inDb: Boolean(sub),
    panelClient,
  };
}

export function formatAccountFullDetailText(d: AccountFullDetail): string {
  const lines = [
    `📧 Email: ${d.email}`,
    `UUID: ${d.uuid ?? "—"}`,
    `Password: ${d.password ?? "—"}`,
    `Subscription ID: ${d.panelSubId ?? "—"}`,
    `Hysteria Auth: ${d.hysteriaAuth ?? "—"}`,
    `Traffic Limit (GB): ${d.trafficGb == null ? "∞" : d.trafficGb}`,
    `Remain traffic: ${d.remainTrafficLabel}`,
    `IP Limit: ${d.limitIp <= 0 ? "نامحدود" : d.limitIp}`,
    `Expiry: ${d.expiresAt ? new Date(d.expiresAt).toLocaleString("fa-IR") : "—"}`,
    `Remain days: ${d.remainDays == null ? "—" : d.remainDays.toLocaleString("fa-IR")}`,
    `Comment: ${d.comment ?? "—"}`,
    `Attached inbounds: ${d.inboundIds.length ? d.inboundIds.join(", ") : "—"}`,
    `Notes: ${d.notes ?? "—"}`,
  ];
  if (d.code) lines.push(`کد ربات: ${d.code}`);
  if (d.title) lines.push(`عنوان: ${d.title}`);
  if (d.subUrl) lines.push(`Sub URL: ${d.subUrl}`);
  if (d.ownerLabel) lines.push(`مالک: ${d.ownerLabel}`);
  return lines.join("\n");
}

export async function archiveAccountSnapshot(opts: {
  detail: AccountFullDetail;
  reason?: string;
  actorTelegramId?: number | bigint | null;
}): Promise<{ id: string }> {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const row = await prisma.accountArchive.create({
    data: {
      tenantId,
      email: opts.detail.email,
      payload: JSON.stringify(opts.detail),
      reason: opts.reason ?? "deleted",
      actorTelegramId:
        opts.actorTelegramId != null ? BigInt(opts.actorTelegramId) : null,
      panelServerId: opts.detail.panelServerId,
    },
  });
  return { id: row.id };
}

export async function listAccountArchives(opts?: { limit?: number; reason?: string }) {
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const rows = await prisma.accountArchive.findMany({
    where: { tenantId, ...(opts?.reason ? { reason: opts.reason } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
  });
  return rows.map((r) => {
    let detail: AccountFullDetail | null = null;
    try {
      detail = JSON.parse(r.payload) as AccountFullDetail;
    } catch {
      detail = null;
    }
    return {
      id: r.id,
      email: r.email,
      reason: r.reason,
      actorTelegramId: r.actorTelegramId != null ? String(r.actorTelegramId) : null,
      panelServerId: r.panelServerId,
      restoredAt: r.restoredAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      detail,
      summary: detail
        ? `${detail.email} · ${detail.uuid?.slice(0, 8) ?? "—"} · ${detail.trafficGb == null ? "∞" : detail.trafficGb + "G"}`
        : r.email,
    };
  });
}

export async function getAccountArchive(id: string) {
  const row = await prisma.accountArchive.findUnique({ where: { id } });
  if (!row) throw new Error("آرشیو پیدا نشد");
  let detail: AccountFullDetail;
  try {
    detail = JSON.parse(row.payload) as AccountFullDetail;
  } catch {
    throw new Error("اسنپ‌شات آرشیو نامعتبر است");
  }
  return {
    id: row.id,
    email: row.email,
    reason: row.reason,
    restoredAt: row.restoredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    detail,
    text: formatAccountFullDetailText(detail),
  };
}

/** Live detail if account exists; otherwise latest deletion archive for that email. */
export async function resolveAccountDetailForReport(opts: {
  email?: string | null;
  subId?: string | null;
  archiveId?: string | null;
}): Promise<{
  source: "live" | "archive";
  archiveId: string | null;
  detail: AccountFullDetail;
  text: string;
  restoredAt: string | null;
}> {
  if (opts.archiveId) {
    const archived = await getAccountArchive(opts.archiveId);
    return {
      source: "archive",
      archiveId: archived.id,
      detail: archived.detail,
      text: archived.text,
      restoredAt: archived.restoredAt,
    };
  }

  let email = (opts.email || "").trim();
  if (!email && opts.subId) {
    const sub = await prisma.subscription.findUnique({ where: { id: opts.subId } });
    email = sub?.email ?? "";
  }
  if (!email) throw new Error("ایمیل یا شناسه اکانت لازم است");

  try {
    const detail = await gatherAccountFullDetail({ email, subId: opts.subId });
    if (detail.inDb || detail.panelFound) {
      return {
        source: "live",
        archiveId: null,
        detail,
        text: formatAccountFullDetailText(detail),
        restoredAt: null,
      };
    }
  } catch {
    /* fall through to archive */
  }

  const row = await prisma.accountArchive.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });
  if (row) {
    const archived = await getAccountArchive(row.id);
    return {
      source: "archive",
      archiveId: archived.id,
      detail: archived.detail,
      text: archived.text,
      restoredAt: archived.restoredAt,
    };
  }

  throw new Error("اطلاعات اکانت پیدا نشد (نه زنده، نه آرشیو)");
}

/**
 * Restore archived account into bot DB and best-effort recreate on panel.
 */
export async function restoreAccountFromArchive(opts: {
  archiveId: string;
  ownerUserId?: string | null;
}): Promise<{ ok: true; message: string; email: string; botSubId: string }> {
  const archived = await getAccountArchive(opts.archiveId);
  if (archived.restoredAt) throw new Error("این اکانت قبلاً بازگردانی شده است");
  const d = archived.detail;

  const existing = await prisma.subscription.findFirst({ where: { email: d.email } });
  if (existing) throw new Error("این ایمیل الان در دیتابیس ربات هست — بازگردانی لازم نیست");

  let ownerId = opts.ownerUserId ?? null;
  if (!ownerId) {
    const { resolveTenantIdOrPlatform } = await import("./tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const admin = await prisma.user.findFirst({
      where: { tenantId, role: "admin" },
      orderBy: { createdAt: "asc" },
    });
    if (!admin) throw new Error("کاربر ادمین برای مالکیت اکانت پیدا نشد");
    ownerId = admin.id;
  }

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { tenantId: true },
  });
  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = owner?.tenantId || (await resolveTenantIdOrPlatform());

  const uuid = d.uuid || randomUUID();
  const panelSubId = d.panelSubId || shortCode("sub").toLowerCase();
  const expiresAt = d.expiresAt
    ? new Date(d.expiresAt)
    : new Date(Date.now() + 30 * 86_400_000);

  let panelOk = false;
  let panelErr = "";
  try {
    let xui: XuiClient | null = null;
    let inboundIds = d.inboundIds?.length ? d.inboundIds : [];
    let subBase: string | null = null;
    let panelServerId = d.panelServerId;

    if (d.panelServerId) {
      const panels = await listPanelServers();
      const p = panels.find((x) => x.id === d.panelServerId);
      if (p) {
        xui = createXuiFromPanel(p);
        if (!inboundIds.length) inboundIds = panelInboundIds(p);
        subBase = sanitizeSubBase(p.subBase);
      }
    }
    if (!xui) {
      const panels = await listPanelServers();
      const p = panels.find((x) => x.active);
      if (p) {
        xui = createXuiFromPanel(p);
        if (!inboundIds.length) inboundIds = panelInboundIds(p);
        subBase = sanitizeSubBase(p.subBase);
        panelServerId = p.id;
      } else if (env.XUI_BASE_URL && env.XUI_API_TOKEN) {
        xui = createXuiFromEnv(env);
        if (!inboundIds.length) inboundIds = await xui.listEnabledInboundIds();
        subBase = sanitizeSubBase(env.XUI_SUB_BASE);
      }
    }

    if (xui) {
      const client = {
        ...(d.panelClient || {}),
        id: uuid,
        uuid,
        email: d.email,
        enable: d.enable !== false,
        expiryTime: d.expiryTime || expiresAt.getTime(),
        totalGB:
          d.trafficGb != null && d.trafficGb > 0
            ? gbToBytes(d.trafficGb)
            : Number(d.panelClient?.totalGB ?? 0),
        limitIp: d.limitIp ?? 0,
        subId: panelSubId,
        comment: d.comment || d.email,
        ...(d.password ? { password: d.password } : {}),
      };
      await xui.addClient({
        client,
        inboundIds: inboundIds.length ? inboundIds : [1],
      });
      panelOk = true;

      let subUrl: string | null = d.subUrl;
      try {
        subUrl = await resolveSubUrl(panelSubId, xui, subBase);
      } catch {
        /* keep */
      }

      const code = d.code || shortCode("QT");
      const created = await prisma.subscription.create({
        data: {
          tenantId,
          code,
          userId: ownerId,
          panelServerId,
          title: d.title || d.email,
          email: d.email,
          clientUuid: uuid,
          panelSubId,
          trafficGb: d.trafficGb,
          startsOnConnect: d.expiryTime < 0,
          activatedAt: d.expiryTime < 0 ? null : new Date(),
          expiresAt,
          panelExpiryTime: d.expiryTime ? BigInt(Math.trunc(d.expiryTime)) : null,
          subUrl,
          note: d.notes,
          limitIp: d.limitIp ?? 0,
          status: d.enable === false ? SubscriptionStatus.disabled : SubscriptionStatus.active,
        },
      });

      await prisma.accountArchive.update({
        where: { id: opts.archiveId },
        data: { restoredAt: new Date() },
      });

      return {
        ok: true,
        email: d.email,
        botSubId: created.id,
        message: panelOk
          ? "اکانت در پنل و دیتابیس ربات بازگردانی شد."
          : "فقط در دیتابیس ربات بازگردانی شد.",
      };
    }
  } catch (err) {
    panelErr = formatXuiError(err);
  }

  // Panel failed or missing — still restore bot DB so data is not lost
  const code = d.code || shortCode("QT");
  const created = await prisma.subscription.create({
    data: {
      tenantId,
      code,
      userId: ownerId,
      panelServerId: d.panelServerId,
      title: d.title || d.email,
      email: d.email,
      clientUuid: uuid,
      panelSubId,
      trafficGb: d.trafficGb,
      startsOnConnect: d.expiryTime < 0,
      activatedAt: d.expiryTime < 0 ? null : new Date(),
      expiresAt,
      panelExpiryTime: d.expiryTime ? BigInt(Math.trunc(d.expiryTime)) : null,
      subUrl: d.subUrl,
      note: d.notes,
      limitIp: d.limitIp ?? 0,
      status: SubscriptionStatus.disabled,
    },
  });
  await prisma.accountArchive.update({
    where: { id: opts.archiveId },
    data: { restoredAt: new Date() },
  });

  return {
    ok: true,
    email: d.email,
    botSubId: created.id,
    message: panelErr
      ? `در دیتابیس ربات بازگردانی شد؛ پنل خطا داد: ${panelErr}`
      : "در دیتابیس ربات بازگردانی شد (پنل در دسترس نبود).",
  };
}
