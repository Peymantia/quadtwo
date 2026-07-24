import { randomBytes } from "node:crypto";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { monthsToMs, randomSubId, shortCode } from "../utils/format.js";
import { isDemoMode } from "./license.js";

/** Marker in note so we only seed sample rows once per user. */
export const DEMO_SAMPLE_MARKER = "demo_sample:v1";

type SampleSpec = {
  emailSuffix: string;
  title: string;
  trafficGb: number | null;
  months?: number;
  days?: number;
  isTest?: boolean;
  startsOnConnect?: boolean;
  /** If set, expiry is this many days from now (overrides months). */
};

const SAMPLES: SampleSpec[] = [
  {
    emailSuffix: "30g1m",
    title: "۳۰ گیگ · ۱ ماه",
    trafficGb: 30,
    months: 1,
    startsOnConnect: true,
  },
  {
    emailSuffix: "50g1m",
    title: "۵۰ گیگ · ۱ ماه",
    trafficGb: 50,
    months: 1,
    startsOnConnect: true,
  },
  {
    emailSuffix: "100g3m",
    title: "۱۰۰ گیگ · ۳ ماه",
    trafficGb: 100,
    months: 3,
    startsOnConnect: false,
  },
  {
    emailSuffix: "unlim1m",
    title: "نامحدود · ۱ ماه",
    trafficGb: null,
    months: 1,
    startsOnConnect: true,
  },
  {
    emailSuffix: "test1d",
    title: "تست رایگان · ۱ روز",
    trafficGb: null,
    days: 1,
    isTest: true,
    startsOnConnect: true,
  },
];

function demoUuid() {
  return randomBytes(16)
    .toString("hex")
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

/**
 * Give each demo visitor a few local-only sample subscriptions so «سرویس‌های من»
 * looks populated. Never touches 3x-ui. Idempotent via DEMO_SAMPLE_MARKER.
 */
export async function ensureDemoSampleSubscriptions(userId: string): Promise<void> {
  if (!isDemoMode()) return;

  const already = await prisma.subscription.count({
    where: { userId, note: { contains: DEMO_SAMPLE_MARKER } },
  });
  if (already > 0) return;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, telegramId: true } });
  if (!user) return;

  const tgTail = String(user.telegramId).slice(-6);
  const now = Date.now();

  await prisma.$transaction(async (tx) => {
    for (const spec of SAMPLES) {
      const code = shortCode(spec.isTest ? "TST" : "DM");
      const email = `demo_${spec.emailSuffix}_${tgTail}`.toLowerCase();
      const subId = randomSubId();
      const expiresAt =
        spec.days != null
          ? new Date(now + spec.days * 24 * 60 * 60 * 1000)
          : new Date(now + monthsToMs(spec.months ?? 1));
      const subUrl = `https://demo.invalid/sub/${subId}`;

      await tx.subscription.create({
        data: {
          code,
          userId: user.id,
          panelServerId: null,
          title: `[نمونه] ${spec.title}`.slice(0, 80),
          email,
          clientUuid: demoUuid(),
          panelSubId: subId,
          trafficGb: spec.isTest ? null : spec.trafficGb,
          startsOnConnect: spec.startsOnConnect ?? true,
          activatedAt: spec.startsOnConnect === false ? new Date(now - 3 * 24 * 60 * 60 * 1000) : null,
          isTest: Boolean(spec.isTest),
          expiresAt,
          subUrl,
          note: `${DEMO_SAMPLE_MARKER} — اکانت نمونه نمایشی؛ اتصال واقعی ندارد.`,
          status: SubscriptionStatus.active,
        },
      });
    }

    // Sample includes a test account → mark test as claimed so UI stays consistent
    await tx.user.update({
      where: { id: user.id },
      data: { testClaimedAt: new Date() },
    });
  });
}
