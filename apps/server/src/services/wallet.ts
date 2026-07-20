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
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    const before = wallet.balance;
    const after = before + amount;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.charge,
        amount,
        balanceBefore: before,
        balanceAfter: after,
        note: note ?? null,
      },
    });
    return after;
  });
}

/** Admin manual adjustment. Positive = credit, negative = debit (can go below only to 0). */
export async function adjustWallet(userId: string, amount: number, note?: string) {
  if (!amount) throw new Error("مبلغ نامعتبر");
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    const before = wallet.balance;
    const after = before + amount;
    if (after < 0) throw new Error("موجودی نمی‌تواند منفی شود");
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.adjust,
        amount,
        balanceBefore: before,
        balanceAfter: after,
        note: note ?? "تنظیم دستی توسط ادمین",
      },
    });
    return after;
  });
}

export async function debitWallet(userId: string, amount: number, note?: string) {
  if (amount <= 0) throw new Error("مبلغ نامعتبر");
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    if (wallet.balance < amount) {
      throw new Error("موجودی کیف پول کافی نیست");
    }
    const before = wallet.balance;
    const after = before - amount;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.purchase,
        amount,
        balanceBefore: before,
        balanceAfter: after,
        note: note ?? null,
      },
    });
    return after;
  });
}
