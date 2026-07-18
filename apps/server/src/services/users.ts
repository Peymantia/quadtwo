import type { User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { adminIds } from "../config/env.js";
import { createXuiFromEnv } from "../panel/xui-client.js";
import { env } from "../config/env.js";
import { getExtraAdminIds } from "./settings.js";
import { partnerPanelGroupName } from "./panel-groups.js";

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
  const group = partnerPanelGroupName(req.user, asRole);

  try {
    const xui = createXuiFromEnv(env);
    await xui.createGroup(group);
    await xui.createGroup("Telegram").catch(() => undefined);
  } catch {
    /* exists */
  }

  await prisma.user.update({
    where: { id: req.userId },
    data: {
      role: asRole === "wholesale" ? UserRole.wholesale : UserRole.partner,
      panelGroup: group,
    },
  });

  return prisma.partnerRequest.update({
    where: { id: requestId },
    data: { status: "approved" },
    include: { user: true },
  });
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
    data: { role: UserRole.user, panelGroup: null },
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
