import { prisma } from "../db.js";

export const PURCHASES_DISABLED_MSG =
  "ربات موقتا از دسترس خارج شده لطفا بعدا اقدام به خرید کنید";

export async function assertPurchasesAllowed(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { purchasesDisabled: true, role: true },
  });
  if (!user) throw new Error("کاربر پیدا نشد");
  if (user.purchasesDisabled) throw new Error(PURCHASES_DISABLED_MSG);
}
