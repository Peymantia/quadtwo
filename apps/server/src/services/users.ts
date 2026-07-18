import type { User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { adminIds } from "../config/env.js";

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

export function priceForUser(user: User, plan: { priceUser: number; pricePartner: number }) {
  if (user.role === UserRole.partner || user.role === UserRole.admin) {
    return plan.pricePartner;
  }
  return plan.priceUser;
}
