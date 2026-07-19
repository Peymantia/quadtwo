import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { resolvePanelForSubscription, listPanelServers, createXuiFromPanel } from "./panel-servers.js";
import { createXuiFromEnv } from "../panel/xui-client.js";
import { env } from "../config/env.js";
import { TELEGRAM_GROUP } from "./panel-groups.js";
import { formatXuiError } from "../panel/xui-errors.js";

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

  groups.push({
    key: "all",
    label: "تمام کانفیگ‌ها",
    panelGroup: null,
  });

  return groups;
}

async function emailsInPanelGroup(groupName: string): Promise<string[]> {
  const emails = new Set<string>();
  const panels = await listPanelServers();
  const clients = panels.length
    ? panels.filter((p) => p.active).map((p) => createXuiFromPanel(p))
    : env.XUI_BASE_URL && env.XUI_API_TOKEN
      ? [createXuiFromEnv(env)]
      : [];

  for (const xui of clients) {
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

/** List configs for a group key (`all` | `tg` | `p{userId}`). */
export async function listConfigsForGroup(
  groupKey: string,
  page = 0,
  pageSize = 12,
): Promise<{ items: ConfigListItem[]; total: number; title: string }> {
  const groups = await listConfigGroups();
  const meta = groups.find((g) => g.key === groupKey);
  const title = meta?.label ?? "کانفیگ‌ها";

  if (groupKey === "all") {
    const total = await prisma.subscription.count();
    const rows = await prisma.subscription.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: page * pageSize,
      take: pageSize,
    });
    return {
      title: "تمام کانفیگ‌ها",
      total,
      items: rows.map((s) => ({
        email: s.email,
        subId: s.id,
        code: s.code,
        ownerLabel: s.user.username
          ? `@${s.user.username}`
          : s.user.agentName || String(s.user.telegramId),
        inDb: true,
        status: s.status,
      })),
    };
  }

  if (!meta?.panelGroup) {
    return { title, total: 0, items: [] };
  }

  const panelEmails = await emailsInPanelGroup(meta.panelGroup);
  const panelSet = new Set(panelEmails.map((e) => e.toLowerCase()));
  const partnerId = meta.partnerUserId;

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
      ownerLabel: s.user.username
        ? `@${s.user.username}`
        : s.user.agentName || String(s.user.telegramId),
      inDb: true,
      status: s.status,
    });
  }

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

  const all = [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
  const total = all.length;
  const items = all.slice(page * pageSize, page * pageSize + pageSize);
  return { title, total, items };
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

  const tryDeleteXui = async (xui: { panelBaseUrl: string; deleteClient: (e: string) => Promise<unknown>; getClient: (e: string) => Promise<unknown> }) => {
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
    const panels = await listPanelServers();
    for (const p of panels.filter((x) => x.active)) {
      if (deletedPanel) break;
      await tryDeleteXui(createXuiFromPanel(p));
    }
    if (!deletedPanel && env.XUI_BASE_URL && env.XUI_API_TOKEN) {
      await tryDeleteXui(createXuiFromEnv(env));
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
