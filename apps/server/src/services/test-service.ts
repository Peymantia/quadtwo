import QRCode from "qrcode";
import { SubscriptionStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { createXuiFromEnv } from "../panel/xui-client.js";
import { randomSubId, shortCode } from "../utils/format.js";
import { getConfiguredInboundIds } from "./inbounds.js";
import { buildSubUrl } from "./provision.js";
import { getSetting } from "./settings.js";

const TEST_MB = 250;
const TEST_MS = 24 * 60 * 60 * 1000;

export type TestProvisionResult = {
  code: string;
  email: string;
  subUrl: string;
  expiresHint: string;
  qrPng: Buffer;
};

/**
 * One free test account per telegram user: 1 day / 250 MB, starts on first connect.
 */
export async function claimTestService(userId: string): Promise<TestProvisionResult> {
  const enabled = (await getSetting("test_service_enabled")) === "true";
  if (!enabled) throw new Error("سرویس تست فعلاً غیرفعال است");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.testClaimedAt) {
    throw new Error("شما قبلاً سرویس تست را دریافت کرده‌اید. هر کاربر فقط یک‌بار می‌تواند بگیرد.");
  }

  const existing = await prisma.subscription.findFirst({
    where: { userId, isTest: true },
  });
  if (existing) {
    await prisma.user.update({
      where: { id: userId },
      data: { testClaimedAt: existing.createdAt },
    });
    throw new Error("شما قبلاً سرویس تست را دریافت کرده‌اید.");
  }

  const xui = createXuiFromEnv(env);
  const code = shortCode("TST");
  const email = `test${String(user.telegramId).slice(-8)}${code.slice(-4)}`.toLowerCase();
  const subId = randomSubId();
  const inboundIds = await getConfiguredInboundIds();
  if (!inboundIds.length) throw new Error("هیچ inbound تنظیم نشده");

  const totalGB = TEST_MB * 1024 * 1024;
  const panelExpiry = -TEST_MS;

  await xui.addClient({
    client: {
      email,
      enable: true,
      expiryTime: panelExpiry,
      totalGB,
      limitIp: 0,
      tgId: Number(user.telegramId),
      subId,
      comment: `test:${user.telegramId}`,
    },
    inboundIds,
  });

  let settings: Record<string, unknown> | undefined;
  try {
    const s = await xui.getSettings();
    settings = s.obj;
  } catch {
    /* ignore */
  }

  let clientUuid: string | null = null;
  let panelSubId = subId;
  try {
    const got = await xui.getClient(email);
    clientUuid = got.obj?.client?.uuid ?? got.obj?.client?.id ?? null;
    if (got.obj?.client?.subId) panelSubId = got.obj.client.subId;
  } catch {
    /* ignore */
  }

  const subUrl = buildSubUrl(panelSubId, settings);
  const qrPng = await QRCode.toBuffer(subUrl, { type: "png", width: 512, margin: 2 });
  const expiresAt = new Date(Date.now() + TEST_MS);

  await prisma.$transaction([
    prisma.subscription.create({
      data: {
        code,
        userId: user.id,
        title: email,
        email,
        clientUuid,
        panelSubId,
        trafficGb: null,
        startsOnConnect: true,
        activatedAt: null,
        isTest: true,
        expiresAt,
        subUrl,
        status: SubscriptionStatus.active,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { testClaimedAt: new Date() },
    }),
  ]);

  return {
    code,
    email,
    subUrl,
    expiresHint: "۱ روز از اولین اتصال · ۲۵۰ مگابایت",
    qrPng,
  };
}
