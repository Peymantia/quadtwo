import { prisma } from "../db.js";
import { clampMonths, nextVolume, resolvePrice } from "../services/pricing.js";
import type { User } from "@prisma/client";

export async function getOrCreateDraft(telegramId: bigint) {
  return prisma.buyDraft.upsert({
    where: { telegramId },
    create: { telegramId, trafficGb: 10, months: 1, unlimited: false, accountMode: "random" },
    update: {},
  });
}

export async function adjustDraftVolume(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  const next = nextVolume(draft.trafficGb, draft.unlimited, dir);
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      trafficGb: next.trafficGb,
      unlimited: next.unlimited,
    },
  });
}

export async function adjustDraftMonths(telegramId: bigint, dir: 1 | -1) {
  const draft = await getOrCreateDraft(telegramId);
  return prisma.buyDraft.update({
    where: { telegramId },
    data: { months: clampMonths(draft.months + dir) },
  });
}

export async function setDraftNameMode(telegramId: bigint, mode: "random" | "custom", name?: string) {
  return prisma.buyDraft.update({
    where: { telegramId },
    data: {
      accountMode: mode,
      accountName: mode === "custom" ? name ?? null : null,
    },
  });
}

export async function draftPrice(user: User, draft: { trafficGb: number | null; months: number; unlimited: boolean }) {
  const gb = draft.unlimited ? null : draft.trafficGb;
  return resolvePrice(user, gb, draft.months);
}
