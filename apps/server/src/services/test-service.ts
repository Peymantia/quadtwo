import { randomBytes } from "node:crypto";
import { SubscriptionStatus, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import { stripAccountName } from "../utils/account-name.js";
import { randomSubId, shortCode } from "../utils/format.js";
import { resolvePanelForCategory } from "./panel-servers.js";
import { resolveSubUrl } from "./provision.js";
import { ensureClientsInGroup, TELEGRAM_GROUP, buildPanelClientComment } from "./panel-groups.js";
import { getDefaultLimitIp, getSetting } from "./settings.js";
import { isDemoMode } from "./license.js";

/** Legacy free user trial: 250 MB */
const USER_TEST_MB = 250;
/** Admin showcase / QA accounts */
const ADMIN_TEST_GB = 1;
const TEST_MS = 24 * 60 * 60 * 1000;
const TEST_SUFFIX = "_Test";

export type TestProvisionResult = {
  subscriptionId: string;
  code: string;
  email: string;
  subUrl: string;
  expiresHint: string;
  trafficGb: number;
};

export type ClaimTestOptions = {
  /** Optional base name (admin only). Always ends with `_Test`. */
  accountName?: string;
};

/** Ensure panel email ends with `_Test` (max 32 chars). */
export function withTestAccountSuffix(name: string): string {
  const cleaned = stripAccountName(name) || `t${randomBytes(3).toString("hex")}`;
  const without = cleaned.replace(/_Test$/i, "").replace(/_test$/i, "");
  const maxBase = Math.max(1, 32 - TEST_SUFFIX.length);
  return `${without.slice(0, maxBase)}${TEST_SUFFIX}`;
}

/**
 * Unique test email: first try `name_Test`; on collision `name_<rand>_Test`
 * (fits 32-char panel email limit).
 */
export async function allocateUniqueTestEmail(baseName: string): Promise<string> {
  const base = stripAccountName(baseName) || `t${randomBytes(3).toString("hex")}`;
  const first = withTestAccountSuffix(base);
  const taken = await prisma.subscription.findFirst({ where: { email: first }, select: { id: true } });
  if (!taken) return first;

  for (let i = 0; i < 12; i++) {
    const rand = String(Math.floor(100 + Math.random() * 900)); // 3-digit
    const room = Math.max(1, 32 - TEST_SUFFIX.length - 1 - rand.length);
    const stem = `${base.slice(0, room)}_${rand}`;
    const email = withTestAccountSuffix(stem);
    const hit = await prisma.subscription.findFirst({ where: { email }, select: { id: true } });
    if (!hit) return email;
  }
  const stamp = randomBytes(2).toString("hex");
  return withTestAccountSuffix(`${base.slice(0, 20)}_${stamp}`);
}

function userTestTotalBytes() {
  return USER_TEST_MB * 1024 * 1024;
}

function adminTestTotalBytes() {
  return ADMIN_TEST_GB * 1024 ** 3;
}

/**
 * One free test account per normal telegram user: 1 day / 250 MB.
 * Admins may create unlimited 1 day / 1 GB test accounts (names end with `_Test`).
 */
export async function claimTestService(
  userId: string,
  opts: ClaimTestOptions = {},
): Promise<TestProvisionResult> {
  const enabled = (await getSetting("test_service_enabled")) === "true";
  if (!enabled) throw new Error("سرویس تست فعلاً غیرفعال است");
  if ((await getSetting("serverless_enabled")) === "true") {
    throw new Error("در شرایط فعلی سرویس تست در دسترس نیست");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const isAdmin = user.role === UserRole.admin;

  if (!isAdmin) {
    const { assertPurchasesAllowed } = await import("./purchase-gate.js");
    await assertPurchasesAllowed(userId);
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
  }

  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = user.tenantId || (await resolveTenantIdOrPlatform());
  const code = shortCode("TST");
  const tgTail = String(user.telegramId).slice(-4);
  const codeTail = code.replace(/^TST-/i, "").slice(-2).toLowerCase();

  let emailBase: string;
  if (isAdmin && opts.accountName?.trim()) {
    emailBase = opts.accountName.trim();
  } else {
    emailBase = `t${tgTail}${codeTail}`;
  }
  const email = isAdmin
    ? await allocateUniqueTestEmail(emailBase)
    : withTestAccountSuffix(emailBase);

  const subId = randomSubId();
  const expiresAt = new Date(Date.now() + TEST_MS);
  const trafficGb = isAdmin ? ADMIN_TEST_GB : USER_TEST_MB / 1024;
  const totalBytes = isAdmin ? adminTestTotalBytes() : userTestTotalBytes();
  const expiresHint = isAdmin
    ? "۱ روز از اولین اتصال · ۱ گیگابایت"
    : "۱ روز از اولین اتصال · ۲۵۰ مگابایت";

  if (isDemoMode()) {
    const uuid = randomBytes(16)
      .toString("hex")
      .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
    const subUrl = `https://demo.invalid/sub/${subId}`;
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        code,
        userId: user.id,
        panelServerId: null,
        title: `[دمو] ${email}`.slice(0, 80),
        email,
        clientUuid: uuid,
        panelSubId: subId,
        trafficGb,
        startsOnConnect: true,
        activatedAt: null,
        isTest: true,
        expiresAt,
        subUrl,
        note: "⚠️ اکانت تست نمایشی — به پنل واقعی وصل نیست",
        status: SubscriptionStatus.active,
      },
    });
    if (!isAdmin) {
      await prisma.user.update({
        where: { id: user.id },
        data: { testClaimedAt: new Date() },
      });
    }
    return {
      subscriptionId: subscription.id,
      code,
      email,
      subUrl,
      expiresHint: `${expiresHint} (نمایشی)`,
      trafficGb,
    };
  }

  const resolved = await resolvePanelForCategory("data");
  if (!resolved.inboundIds.length) {
    throw new Error("هیچ inbound تنظیم نشده — در کنترل سنتر سرورهای پنل را پر کنید");
  }

  const panelExpiry = -TEST_MS;
  const limitIp = await getDefaultLimitIp();

  await resolved.xui.addClient({
    client: {
      id: await (async () => {
        try {
          const nu = await resolved.xui.getNewUUID();
          if (typeof nu.obj === "string" && nu.obj.trim()) return nu.obj.trim();
        } catch {
          /* fall through */
        }
        return randomBytes(16)
          .toString("hex")
          .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
      })(),
      email,
      enable: true,
      expiryTime: panelExpiry,
      totalGB: totalBytes,
      limitIp,
      tgId: Number(user.telegramId),
      subId,
      comment: buildPanelClientComment(user),
    },
    inboundIds: resolved.inboundIds,
  });

  await ensureClientsInGroup(resolved.xui, [email], TELEGRAM_GROUP);

  let clientUuid: string | null = null;
  let panelSubId = subId;
  try {
    const got = await resolved.xui.getClient(email);
    clientUuid = got.obj?.client?.uuid ?? got.obj?.client?.id ?? null;
    if (got.obj?.client?.subId) panelSubId = got.obj.client.subId;
  } catch {
    /* ignore */
  }

  const subUrl = await resolveSubUrl(panelSubId, resolved.xui, resolved.subBase);

  const subscription = await prisma.subscription.create({
    data: {
      tenantId,
      code,
      userId: user.id,
      panelServerId: resolved.panel?.id ?? null,
      title: email,
      email,
      clientUuid,
      panelSubId,
      trafficGb,
      startsOnConnect: true,
      activatedAt: null,
      isTest: true,
      expiresAt,
      subUrl,
      status: SubscriptionStatus.active,
    },
  });
  if (!isAdmin) {
    await prisma.user.update({
      where: { id: user.id },
      data: { testClaimedAt: new Date() },
    });
  }

  return {
    subscriptionId: subscription.id,
    code,
    email,
    subUrl,
    expiresHint,
    trafficGb,
  };
}
