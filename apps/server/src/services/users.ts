import type { User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { adminIds } from "../config/env.js";
import { createXuiFromEnv } from "../panel/xui-client.js";
import { env } from "../config/env.js";

export type TgUserLike = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export async function upsertUserFromTelegram(tg: TgUserLike): Promise<User> {
  const telegramId = BigInt(tg.id);
  const shouldAdmin = adminIds().includes(telegramId);

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

export async function submitPartnerRequest(userId: string, fullName: string, phone?: string, note?: string) {
  return prisma.partnerRequest.upsert({
    where: { userId },
    create: { userId, fullName, phone, note, status: "pending" },
    update: { fullName, phone, note, status: "pending" },
  });
}

export async function approvePartner(requestId: string) {
  const req = await prisma.partnerRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { user: true },
  });
  const group = `reseller_${req.user.telegramId}`;

  try {
    const xui = createXuiFromEnv(env);
    await xui.createGroup(group);
  } catch {
    /* exists */
  }

  await prisma.user.update({
    where: { id: req.userId },
    data: { role: UserRole.partner, panelGroup: group },
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
