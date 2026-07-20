import type { User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { adminIds } from "../config/env.js";
import { createXuiFromEnv, type XuiClient } from "../panel/xui-client.js";
import { env } from "../config/env.js";
import { getExtraAdminIds } from "./settings.js";
import { partnerPanelGroupName, buildPanelGroupFromAgentName, sanitizePanelGroupSlug } from "./panel-groups.js";
import { createXuiFromPanel, listPanelServers, resolvePanelForCategory } from "./panel-servers.js";

async function xuiForAgentGroups() {
  try {
    return (await resolvePanelForCategory("data")).xui;
  } catch {
    if (env.XUI_BASE_URL && env.XUI_API_TOKEN) return createXuiFromEnv(env);
    throw new Error("هیچ پنل فعالی برای ساخت گروه پیدا نشد");
  }
}

async function allPanelXuIs(): Promise<XuiClient[]> {
  const panels = await listPanelServers();
  const list = panels.filter((p) => p.active && p.apiToken).map((p) => createXuiFromPanel(p));
  if (list.length) return list;
  if (env.XUI_BASE_URL && env.XUI_API_TOKEN) return [createXuiFromEnv(env)];
  return [];
}

/** Rename group on every reachable panel; create new group if rename fails. */
export async function renamePanelGroupEverywhere(oldName: string, newName: string) {
  if (!oldName || !newName || oldName === newName) return;
  const clients = await allPanelXuIs();
  for (const xui of clients) {
    try {
      await xui.renameGroup(oldName, newName);
    } catch {
      try {
        await xui.createGroup(newName);
        const emails = await xui.groupEmails(oldName);
        const list = Array.isArray(emails.obj) ? emails.obj : [];
        if (list.length) await xui.bulkAddToGroup(list, newName);
      } catch (err) {
        console.warn("renamePanelGroupEverywhere failed", oldName, "→", newName, err);
      }
    }
  }
}

export type TgUserLike = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export async function upsertUserFromTelegram(tg: TgUserLike): Promise<User> {
  const telegramId = BigInt(tg.id);
  const envAdmins = adminIds();
  const extra = await getExtraAdminIds();
  const shouldAdmin = envAdmins.includes(telegramId) || extra.includes(telegramId);

  const user = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      lastName: tg.last_name ?? null,
      role: shouldAdmin ? UserRole.admin : UserRole.user,
      wallet: { create: {} },
    },
    update: {
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      lastName: tg.last_name ?? null,
      ...(shouldAdmin ? { role: UserRole.admin } : {}),
    },
  });

  await prisma.wallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  return user;
}

/** All telegram IDs that should receive admin alerts */
export async function listNotifyAdminTelegramIds(): Promise<number[]> {
  const fromDb = await prisma.user.findMany({
    where: { role: UserRole.admin },
    select: { telegramId: true },
  });
  const set = new Set<string>();
  for (const id of adminIds()) set.add(String(id));
  for (const id of await getExtraAdminIds()) set.add(String(id));
  for (const u of fromDb) set.add(String(u.telegramId));
  return [...set].map((s) => Number(s));
}

export async function submitPartnerRequest(userId: string, fullName: string, phone?: string, note?: string) {
  return prisma.partnerRequest.upsert({
    where: { userId },
    create: { userId, fullName, phone, note, status: "pending" },
    update: { fullName, phone, note, status: "pending" },
  });
}

export async function approvePartner(requestId: string, asRole: "partner" | "wholesale" = "partner") {
  const req = await prisma.partnerRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { user: true },
  });

  const agentName = req.fullName.trim();
  if (!agentName) {
    throw new Error("نام نماینده در درخواست خالی است.");
  }
  if (!sanitizePanelGroupSlug(agentName) && !sanitizePanelGroupSlug(req.user.username ?? "")) {
    throw new Error(
      "نام نماینده باید حداقل یک حرف/عدد انگلیسی داشته باشد تا گروه پنل ساخته شود.\nمثال: AliShop",
    );
  }
  const group = sanitizePanelGroupSlug(agentName)
    ? buildPanelGroupFromAgentName(agentName, req.user.telegramId)
    : partnerPanelGroupName({ ...req.user, agentName }, asRole);

  try {
    const xui = await xuiForAgentGroups();
    await xui.createGroup(group);
    await xui.createGroup("Telegram").catch(() => undefined);
  } catch {
    /* exists */
  }

  await prisma.user.update({
    where: { id: req.userId },
    data: {
      role: asRole === "wholesale" ? UserRole.wholesale : UserRole.partner,
      agentName,
      panelGroup: group,
    },
  });

  return prisma.partnerRequest.update({
    where: { id: requestId },
    data: { status: "approved" },
    include: { user: true },
  });
}

/**
 * Set / update نماینده name.
 * - First-time (no agentName) or admin: apply immediately (+ create group)
 * - Change by partner/wholesale: pending AgentRenameRequest until admin approves
 */
export async function setAgentName(
  userId: string,
  rawName: string,
): Promise<
  | { kind: "applied"; user: User }
  | { kind: "pending"; requestId: string; newName: string; newGroup: string }
> {
  const agentName = rawName.trim();
  if (agentName.length < 2) {
    throw new Error("نام نماینده خیلی کوتاه است.");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const panelGroup = buildPanelGroupFromAgentName(agentName, user.telegramId);
  const oldName = user.agentName?.trim() ?? "";
  const oldGroup = user.panelGroup?.trim() ?? "";

  const isFirstSet = !oldName;
  const isAdmin = user.role === UserRole.admin;
  const unchanged = oldName === agentName && oldGroup === panelGroup;
  if (unchanged) {
    return { kind: "applied", user };
  }

  // Partner/wholesale renaming existing name → admin approval
  if (!isFirstSet && !isAdmin) {
    await prisma.agentRenameRequest.updateMany({
      where: { userId: user.id, status: "pending" },
      data: { status: "rejected" },
    });
    const req = await prisma.agentRenameRequest.create({
      data: {
        userId: user.id,
        oldName,
        oldGroup: oldGroup || oldName,
        newName: agentName,
        newGroup: panelGroup,
      },
    });
    return { kind: "pending", requestId: req.id, newName: agentName, newGroup: panelGroup };
  }

  if (oldGroup && oldGroup !== panelGroup) {
    await renamePanelGroupEverywhere(oldGroup, panelGroup);
  } else {
    try {
      const xui = await xuiForAgentGroups();
      await xui.createGroup(panelGroup);
    } catch {
      /* exists or offline */
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { agentName, panelGroup },
  });
  return { kind: "applied", user: updated };
}

export async function approveAgentRename(requestId: string) {
  const req = await prisma.agentRenameRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { user: true },
  });
  if (req.status !== "pending") throw new Error("این درخواست دیگر در انتظار نیست");

  await renamePanelGroupEverywhere(req.oldGroup, req.newGroup);

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { agentName: req.newName, panelGroup: req.newGroup },
  });
  await prisma.agentRenameRequest.update({
    where: { id: requestId },
    data: { status: "approved" },
  });
  return { user, request: req };
}

export async function rejectAgentRename(requestId: string) {
  const req = await prisma.agentRenameRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { user: true },
  });
  if (req.status !== "pending") throw new Error("این درخواست دیگر در انتظار نیست");
  await prisma.agentRenameRequest.update({
    where: { id: requestId },
    data: { status: "rejected" },
  });
  return req;
}

export async function rejectPartner(requestId: string) {
  return prisma.partnerRequest.update({
    where: { id: requestId },
    data: { status: "rejected" },
    include: { user: true },
  });
}

export async function demoteToUser(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { role: UserRole.user, panelGroup: null, agentName: null },
  });
}

export async function partnerSalesReport(role: "partner" | "wholesale") {
  const users = await prisma.user.findMany({
    where: { role: role === "wholesale" ? UserRole.wholesale : UserRole.partner },
    include: {
      orders: {
        where: { status: "completed", kind: { in: ["new", "renew"] } },
      },
      subscriptions: true,
    },
  });
  return users.map((u) => {
    const sales = u.orders.reduce((s, o) => s + o.price, 0);
    return {
      id: u.id,
      telegramId: String(u.telegramId),
      username: u.username,
      name: u.firstName,
      group: u.panelGroup,
      orders: u.orders.length,
      sales,
      subs: u.subscriptions.length,
    };
  });
}
