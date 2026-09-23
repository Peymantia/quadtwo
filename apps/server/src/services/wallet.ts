import { WalletTxType } from "@prisma/client";
import { prisma } from "../db.js";

export async function getWallet(userId: string) {
  return prisma.wallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function creditWallet(userId: string, amount: number, note?: string) {
  if (amount <= 0) throw new Error("مبلغ نامعتبر");
  const after = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    const before = wallet.balance;
    const next = before + amount;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: next } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.charge,
        amount,
        balanceBefore: before,
        balanceAfter: next,
        note: note ?? null,
      },
    });
    return next;
  });
  if (after >= 0) {
    const { clearUnsettledAfterSettlement } = await import("./negative-credit.js");
    await clearUnsettledAfterSettlement(userId, after).catch(() => undefined);
  }
  return after;
}

/** Admin manual adjustment. Positive = credit, negative = debit (respects negative credit limit). */
export async function adjustWallet(userId: string, amount: number, note?: string) {
  if (!amount) throw new Error("مبلغ نامعتبر");
  const { getUserNegativeCreditLimit } = await import("./negative-credit.js");
  const creditLimit = amount < 0 ? await getUserNegativeCreditLimit(userId) : 0;
  const after = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    const before = wallet.balance;
    const next = before + amount;
    if (next < -creditLimit) {
      throw new Error(
        creditLimit > 0
          ? `موجودی نمی‌تواند از −${creditLimit.toLocaleString("fa-IR")} کمتر شود`
          : "موجودی نمی‌تواند منفی شود",
      );
    }
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: next } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.adjust,
        amount,
        balanceBefore: before,
        balanceAfter: next,
        note: note ?? "تنظیم دستی توسط ادمین",
      },
    });
    return next;
  });
  if (after >= 0) {
    const { clearUnsettledAfterSettlement } = await import("./negative-credit.js");
    await clearUnsettledAfterSettlement(userId, after).catch(() => undefined);
  }
  return after;
}

export async function debitWallet(userId: string, amount: number, note?: string) {
  if (amount <= 0) throw new Error("مبلغ نامعتبر");
  const { getUserNegativeCreditLimit } = await import("./negative-credit.js");
  const creditLimit = await getUserNegativeCreditLimit(userId);
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    const before = wallet.balance;
    const next = before - amount;
    if (next < -creditLimit) {
      throw new Error(
        creditLimit > 0
          ? `موجودی کیف پول کافی نیست (سقف اعتبار منفی: ${creditLimit.toLocaleString("fa-IR")} تومان)`
          : "موجودی کیف پول کافی نیست",
      );
    }
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: next } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.purchase,
        amount,
        balanceBefore: before,
        balanceAfter: next,
        note: note ?? null,
      },
    });
    return next;
  });
}
