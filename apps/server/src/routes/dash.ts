import { Hono } from "hono";
import { OrderKind, UserRole } from "@prisma/client";
import { signSession } from "../auth/telegram.js";
import { isDemoMode } from "../services/license.js";
import { effectiveRole, demoRoleLabel, setDemoRole, parseDemoRole, withEffectiveRole } from "../services/demo-role.js";
import { prisma } from "../db.js";
import {
  issueOtpForUser,
  loginWithPassword,
  requestLoginOtp,
  setUserPassword,
  verifyLoginOtp,
  verifyPassword,
} from "../services/web-auth.js";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  deleteUserPasskey,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listUserPasskeys,
  originFromRequestHeaders,
  userPasskeyCount,
} from "../services/webauthn.js";
import {
  createMatrixOrder,
  createWalletChargeOrder,
  getOrderForAdmin,
  markPaid,
  orderSummaryText,
  payOrderWithWallet,
  provisionAdminComplimentary,
  rejectOrder,
  setOrderPaymentMethod,
} from "../services/orders.js";
import { listPriceMatrix, normalizePurchaseTraffic, resolvePrice, upsertPriceCell, isOfferCategory, isFixedSingleServiceCategory, priceForMatrixCell, type PlanCategory } from "../services/pricing.js";
import { provisionOrder, rotateSubId, serializeProvisionForApi, type ProvisionResult } from "../services/provision.js";
import { fulfillAfterPaid, isServerlessEnabled, isServerlessPending } from "../services/serverless.js";
import {
  createDiscountCode,
  deleteDiscountCode,
  getDiscountMaxPercentForUser,
  getDefaultAgentDiscountMaxPercent,
  isDiscountCodesEnabled,
  listDiscountCodesForUser,
  previewDiscount,
  updateDiscountCode,
  canManageDiscountCodes,
  canUserManageDiscountCodes,
} from "../services/discount-codes.js";
import {
  getAllSettings,
  getCategoryLabels,
  getChannels,
  getMaxPurchaseMonths,
  getPaymentCard,
  getPublicPaymentMethods,
  getPaymentMethodsConfig,
  savePaymentMethodsConfig,
  assertCheckoutPaymentMethod,
  defaultPaymentMethodsConfig,
  type PaymentMethodsConfig,
  getPriceRates,
  getPricingModeForRole,
  getPricingModes,
  getSalesCategories,
  getSetting,
  getWebSessionHours,
  getDefaultLimitIp,
  canEditLimitIp,
  getNotifConfig,
  saveNotifConfig,
  defaultNotifConfig,
  listEnabledSalesCategories,
  listEnabledSalesCategoriesForRole,
  saveCategoryLabels,
  saveCategoryOrder,
  getCategoryOrder,
  sortKeysByCategoryOrder,
  ensureCategoryInOrder,
  removeCategoryFromOrder,
  saveChannels,
  savePriceRates,
  savePricingModes,
  saveSalesCategories,
  sanitizeCategoryKey,
  BUILTIN_CATEGORY_KEYS,
  setSetting,
  type ChannelConfig,
  type NotifConfig,
  type PriceRates,
  type RolePricingModes,
} from "../services/settings.js";
import { getBackupConfig, saveBackupConfig, sendBackupToAdmins, restoreDatabaseFromBackupBuffer, inspectBackupBuffer, listBackupFiles, type BackupConfig } from "../services/backup.js";
import { adjustWallet, getWallet } from "../services/wallet.js";
import { claimTestService } from "../services/test-service.js";
import { approvePartner, demoteToUser, listPendingPartnerRequests, rejectPartner, submitPartnerRequest } from "../services/users.js";
import { formatTraffic, formatToman, persianMonthName } from "../utils/format.js";
import { adminSalesReport, searchUsersAndOrders, buildSalesStats, parseSalesPeriod, agentsSalesLeaderboard } from "../services/admin-reports.js";
import { listConfigGroups, listConfigsForGroup, deleteConfig, getConfigDetail, updateConfig, diffPanelVsBot, importPanelClientsToBot, reconcileSubscriptionsFromPanel, refreshSubscriptionFromPanel, selectiveSync, undoLastSync, getSyncUndoStatus, endingUrgencyDays, type ConfigListSort } from "../services/admin-configs.js";
import {
  bulkAdjustAllPanelClients,
  parseBulkInboundIds,
  previewBulkAdjust,
  type BulkAdjustInput,
} from "../services/bulk-adjust.js";
import {
  createPanelServer,
  deletePanelServer,
  envPanelSnapshot,
  repairPanelSubBases,
  getPanelServer,
  importPanelFromEnv,
  listPanelServers,
  parsePanelCategories,
  testPanelConnection,
  updatePanelServer,
} from "../services/panel-servers.js";
import { sanitizeSubBase } from "../services/sub-url.js";
import { listRecentAudit, auditLog } from "../services/audit.js";
import {
  listAccountArchives,
  getAccountArchive,
  restoreAccountFromArchive,
  resolveAccountDetailForReport,
} from "../services/account-archive.js";
import { lookupConfigByLinkOrUuid } from "../services/config-lookup.js";
import {
  exportWorkbookBuffer,
  formatImportResult,
  importWorkbook,
  inspectWorkbook,
  readWorkbookFromBuffer,
} from "../services/bulk-import.js";
import { getSubscriptionTrafficBytes } from "../services/live-status.js";
import { checkRenewEligibility, inferRenewCategory } from "../services/renew-eligibility.js";
import { dashBaseUrl, env } from "../config/env.js";
import { clearEmojiStyleCache, attachPremiumTextEntities, getEmojiStyle } from "../services/emoji-transform.js";
import { createTelegramBot } from "../bot/telegram.js";

type Vars = { userId: string; role: string; telegramId: string; tenantId: string };

function isWalletCreditResult(
  r: ProvisionResult | { kind: "wallet_credit"; balance: number } | { kind: "serverless_pending" },
): r is { kind: "wallet_credit"; balance: number } {
  return "kind" in r && r.kind === "wallet_credit";
}

function isServerlessPendingResult(
  r: ProvisionResult | { kind: "wallet_credit"; balance: number } | { kind: "serverless_pending" },
): r is { kind: "serverless_pending" } {
  return "kind" in r && r.kind === "serverless_pending";
}

async function provisionedJson(
  result: ProvisionResult | { kind: "wallet_credit"; balance: number } | { kind: "serverless_pending" },
) {
  if (isWalletCreditResult(result) || isServerlessPendingResult(result)) return result;
  return serializeProvisionForApi(result);
}

/** Fire-and-forget Telegram notification (plain text). */
async function notifyTelegram(chatId: bigint, text: string) {
  try {
    const style = await getEmojiStyle();
    const body: Record<string, unknown> = { chat_id: String(chatId), text };
    if (style === "premium") {
      const entities = attachPremiumTextEntities(text);
      if (entities.length) body.entities = entities;
    }
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* best-effort */
  }
}

async function sessionForUser(userId: string) {
  const { ensureDemoSampleSubscriptions } = await import("../services/demo-samples.js");
  await ensureDemoSampleSubscriptions(userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const role = effectiveRole(user.telegramId, user.role);
  const sessionHours = await getWebSessionHours();
  const token = await signSession(
    {
      userId: user.id,
      telegramId: String(user.telegramId),
      role,
    },
    `${sessionHours}h`,
  );
  return {
    token,
    demoMode: isDemoMode(),
    user: {
      id: user.id,
      role,
      firstName: user.firstName,
      username: user.username,
      telegramId: String(user.telegramId),
      panelGroup: user.panelGroup,
      agentName: user.agentName,
      hasPassword: Boolean(user.passwordHash),
      isSuperAdmin: Boolean(user.isSuperAdmin),
    },
  };
}

export function registerDashAuthRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/auth/meta", async (c) => {
    const brand = await getSetting("brand_name");
    const uiSkin = await getSetting("ui_skin");
    const uiColorMode = await getSetting("ui_color_mode");
    const { resolveTenantIdOrPlatform, tenantDashUrl } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return c.json({
      brand: tenant?.brandName || brand || "پیـنگ",
      logoUrl: tenant?.logoUrl ?? null,
      slug: tenant?.slug ?? "platform",
      isPlatform: Boolean(tenant?.isPlatform),
      dashUrl: tenant ? tenantDashUrl(tenant.slug) : dashBaseUrl(),
      authModes: ["password", "otp", "passkey"],
      passkeyHint: "ورود با Face ID / اثرانگشت (Passkey)",
      demoMode: isDemoMode(),
      uiSkin: uiSkin === "studio" ? "studio" : "classic",
      uiColorMode:
        uiColorMode === "light" ||
        uiColorMode === "dark" ||
        uiColorMode === "system" ||
        uiColorMode === "telegram"
          ? uiColorMode
          : "system",
    });
  });

  api.post("/auth/password/login", async (c) => {
    const body = await c.req.json<{ login?: string; password?: string }>();
    if (!body.login || !body.password) return c.json({ error: "login و password لازم است" }, 400);
    const result = await loginWithPassword(body.login, body.password);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return c.json(await sessionForUser(result.userId));
  });

  api.post("/auth/otp/request", async (c) => {
    const body = await c.req.json<{ login?: string }>();
    if (!body.login) return c.json({ error: "login لازم است" }, 400);
    const result = await requestLoginOtp(body.login);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, hint: result.hint });
  });

  api.post("/auth/otp/verify", async (c) => {
    const body = await c.req.json<{ login?: string; code?: string }>();
    if (!body.login || !body.code) return c.json({ error: "login و code لازم است" }, 400);
    const result = await verifyLoginOtp(body.login, body.code);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return c.json(await sessionForUser(result.userId));
  });

  /** Passkey / WebAuthn authentication (Face ID, fingerprint, Windows Hello). */
  api.post("/auth/passkey/options", async (c) => {
    const body = await c.req.json<{ login?: string }>().catch(() => ({ login: undefined as string | undefined }));
    const reqOrigin = originFromRequestHeaders({
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
    });
    try {
      const { options, challengeId } = await beginPasskeyAuthentication(body.login, reqOrigin);
      return c.json({ options, challengeId });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/auth/passkey/verify", async (c) => {
    const body = await c.req.json<{ response?: unknown; challengeId?: string }>();
    if (!body.response) return c.json({ error: "response لازم است" }, 400);
    const reqOrigin = originFromRequestHeaders({
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
    });
    try {
      const { userId } = await finishPasskeyAuthentication(
        body.response as Parameters<typeof finishPasskeyAuthentication>[0],
        body.challengeId,
        reqOrigin,
      );
      return c.json(await sessionForUser(userId));
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 401);
    }
  });
}

export function registerDashMeRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/me/home", async (c) => {
    const userId = c.get("userId");
    const { ensureDemoSampleSubscriptions } = await import("../services/demo-samples.js");
    await ensureDemoSampleSubscriptions(userId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const wallet = await getWallet(userId);
    const subs = await prisma.subscription.count({ where: { userId } });
    const active = await prisma.subscription.count({ where: { userId, status: "active" } });
    const brand = await getSetting("brand_name");
    const support = await getSetting("support_username");
    const passkeyCount = await userPasskeyCount(userId);
    const role = c.get("role") || effectiveRole(user.telegramId, user.role);
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenant = await prisma.tenant.findUnique({
      where: { id: await resolveTenantIdOrPlatform() },
      select: { brandName: true, logoUrl: true, slug: true },
    });
    return c.json({
      brand: tenant?.brandName || brand || "پیـنگ",
      logoUrl: tenant?.logoUrl ?? null,
      tenantSlug: tenant?.slug ?? null,
      support,
      demoMode: isDemoMode(),
      demoRole: isDemoMode() ? role : null,
      demoRoleLabel: isDemoMode() ? demoRoleLabel(role) : null,
      user: {
        id: user.id,
        role,
        dbRole: user.role,
        firstName: user.firstName,
        username: user.username,
        telegramId: String(user.telegramId),
        panelGroup: user.panelGroup,
        agentName: user.agentName,
        hasPassword: Boolean(user.passwordHash),
        hasPasskey: passkeyCount > 0,
        passkeyCount,
        testClaimed: Boolean(user.testClaimedAt),
        isSuperAdmin: Boolean(user.isSuperAdmin),
        discountCodesAllowed: canUserManageDiscountCodes({
          id: user.id,
          role: role as typeof user.role,
          discountCodesAllowed: user.discountCodesAllowed,
          discountMaxPercent: user.discountMaxPercent,
        }),
        discountMaxPercent: user.discountMaxPercent,
      },
      wallet: { balance: wallet.balance },
      stats: { subscriptions: subs, active },
    });
  });

  api.post("/me/demo-role", async (c) => {
    if (!isDemoMode()) return c.json({ error: "Demo mode is off" }, 400);
    const body = await c.req.json<{ role?: string }>();
    const role = parseDemoRole(body.role);
    if (!role) return c.json({ error: "role must be user|partner|wholesale|reseller|admin" }, 400);
    setDemoRole(c.get("telegramId"), role);
    return c.json({ ok: true, role, label: demoRoleLabel(role) });
  });

  api.get("/me/passkeys", async (c) => {
    return c.json({ passkeys: await listUserPasskeys(c.get("userId")) });
  });

  api.post("/me/passkeys/register/options", async (c) => {
    const reqOrigin = originFromRequestHeaders({
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
    });
    try {
      const options = await beginPasskeyRegistration(c.get("userId"), reqOrigin);
      return c.json({ options });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/passkeys/register/verify", async (c) => {
    const body = await c.req.json<{ response?: unknown; label?: string }>();
    if (!body.response) return c.json({ error: "response لازم است" }, 400);
    const reqOrigin = originFromRequestHeaders({
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
    });
    try {
      await finishPasskeyRegistration(
        c.get("userId"),
        body.response as Parameters<typeof finishPasskeyRegistration>[1],
        body.label,
        reqOrigin,
      );
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.delete("/me/passkeys/:id", async (c) => {
    try {
      await deleteUserPasskey(c.get("userId"), c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/password", async (c) => {
    const body = await c.req.json<{ password?: string; currentPassword?: string }>();
    if (!body.password) return c.json({ error: "password لازم است" }, 400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    if (user.passwordHash) {
      if (!body.currentPassword || !verifyPassword(body.currentPassword, user.passwordHash)) {
        return c.json({ error: "رمز فعلی نادرست است" }, 400);
      }
    }
    try {
      await setUserPassword(user.id, body.password);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
    await auditLog({
      action: "web_password_set",
      actorTelegramId: user.telegramId,
      target: user.id,
    });
    return c.json({ ok: true });
  });

  api.get("/me/wallet", async (c) => {
    const wallet = await getWallet(c.get("userId"));
    const txs = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return c.json({ balance: wallet.balance, txs });
  });

  api.get("/me/payment-card", async (c) => {
    return c.json({ card: await getPaymentCard() });
  });

  api.get("/me/payment-methods", async (c) => {
    return c.json({ methods: await getPublicPaymentMethods() });
  });

  api.get("/me/subscriptions", async (c) => {
    const { ensureDemoSampleSubscriptions } = await import("../services/demo-samples.js");
    await ensureDemoSampleSubscriptions(c.get("userId"));
    const subs = await prisma.subscription.findMany({
      where: { userId: c.get("userId") },
      orderBy: { createdAt: "desc" },
    });
    const enriched = await Promise.all(
      subs.map(async (s) => {
        const traf = await getSubscriptionTrafficBytes(s.id).catch(() => ({
          usedBytes: 0,
          totalBytes: 0,
          totalGb: s.trafficGb,
        }));
        return {
          id: s.id,
          code: s.code,
          email: s.email,
          title: s.title,
          note: s.note,
          trafficLabel: formatTraffic(s.trafficGb),
          trafficGb: traf.totalGb ?? s.trafficGb,
          usedTrafficBytes: traf.usedBytes,
          expiresAt: s.expiresAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
          subUrl: s.subUrl,
          status: s.status,
          isTest: s.isTest,
        };
      }),
    );
    return c.json({ subscriptions: enriched });
  });

  api.patch("/me/subscriptions/:id/note", async (c) => {
    const body = await c.req.json<{ note?: string | null }>();
    const note = body.note?.trim() ? body.note.trim().slice(0, 500) : null;
    const updated = await prisma.subscription.updateMany({
      where: { id: c.req.param("id"), userId: c.get("userId") },
      data: { note },
    });
    if (!updated.count) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true, note });
  });

  api.post("/me/subscriptions/:id/rotate-sub", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const result = await rotateSubId(sub.id);
    return c.json({ code: result.code, subUrl: result.subUrl, expiresAt: result.expiresAt.toISOString() });
  });

  api.post("/me/subscriptions/:id/refresh-from-panel", async (c) => {
    const role = c.get("role");
    const sub = await prisma.subscription.findFirst({
      where:
        role === "admin"
          ? { id: c.req.param("id") }
          : { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    try {
      const result = await refreshSubscriptionFromPanel(sub.id);
      await auditLog({
        action: "config_refresh",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: result.email,
        detail: result.changed.length ? result.changed.join(",") : "no_change",
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.put("/me/subscriptions/:id/enable", async (c) => {
    const body = await c.req.json<{ enable?: boolean }>();
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    try {
      const result = await updateConfig({
        email: sub.email,
        subId: sub.id,
        enable: body.enable !== false,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/subscriptions/:id/delete", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    try {
      const result = await deleteConfig({
        email: sub.email,
        subId: sub.id,
        actorTelegramId: BigInt(c.get("telegramId")),
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.patch("/me/subscriptions/:id", async (c) => {
    const body = await c.req.json<{ title?: string | null; note?: string | null }>();
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    try {
      const result = await updateConfig({
        email: sub.email,
        subId: sub.id,
        title: body.title,
        note: body.note,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/me/subscriptions/:id/addons", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const { ADD_DAY_MAX, ADD_DAY_PRICE_TOMAN, ADD_GB_MAX, quoteAddGb } = await import("../services/sub-addons.js");
    let addGb: { perGb: number; maxGb: number; allowed: boolean; reason?: string } = {
      perGb: 0,
      maxGb: ADD_GB_MAX,
      allowed: false,
      reason: "سرویس نامحدود است",
    };
    if (!sub.isTest && sub.trafficGb != null && sub.trafficGb > 0) {
      try {
        const q = await quoteAddGb(user, sub.id, 1);
        addGb = { perGb: q.perGb, maxGb: ADD_GB_MAX, allowed: true };
      } catch (err) {
        addGb = {
          perGb: 0,
          maxGb: ADD_GB_MAX,
          allowed: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    } else if (sub.isTest) {
      addGb = { perGb: 0, maxGb: ADD_GB_MAX, allowed: false, reason: "سرویس تست" };
    }
    return c.json({
      subscription: {
        id: sub.id,
        email: sub.email,
        trafficGb: sub.trafficGb,
        expiresAt: sub.expiresAt.toISOString(),
        isTest: sub.isTest,
      },
      addDays: {
        allowed: !sub.isTest,
        maxDays: ADD_DAY_MAX,
        perDay: ADD_DAY_PRICE_TOMAN,
        reason: sub.isTest ? "سرویس تست" : undefined,
      },
      addGb,
      rename: { allowed: true },
      secureBase64: { allowed: true },
    });
  });

  api.post("/me/subscriptions/:id/add-days", async (c) => {
    const body = await c.req.json<{
      days?: number;
      paymentMethod?: "wallet" | "card_to_card" | "crypto";
      payWithWallet?: boolean;
    }>();
    try {
      const { createAddDaysOrder } = await import("../services/sub-addons.js");
      const order = await createAddDaysOrder({
        userId: c.get("userId"),
        subId: c.req.param("id"),
        days: Number(body.days),
      });
      if (c.get("role") === "admin" || order.price <= 0) {
        const result =
          c.get("role") === "admin"
            ? await provisionAdminComplimentary(order.id, c.get("userId"))
            : await payOrderWithWallet(order.id, c.get("userId"));
        return c.json({
          order: { id: order.id, price: order.price, months: order.months, kind: order.kind },
          provisioned: await provisionedJson(result),
        });
      }
      const method =
        body.paymentMethod === "crypto"
          ? "crypto"
          : body.paymentMethod === "wallet" || body.payWithWallet
            ? "wallet"
            : "card_to_card";
      await assertCheckoutPaymentMethod(method);
      if (method === "wallet") {
        const result = await payOrderWithWallet(order.id, c.get("userId"));
        return c.json({
          order: { id: order.id, price: order.price, months: order.months, kind: order.kind },
          provisioned: await provisionedJson(result),
        });
      }
      if (method === "crypto") {
        await setOrderPaymentMethod(order.id, c.get("userId"), "crypto");
        const methods = await getPublicPaymentMethods();
        return c.json({
          order: { id: order.id, price: order.price, summary: orderSummaryText(order), kind: order.kind },
          crypto: methods.crypto,
        });
      }
      await setOrderPaymentMethod(order.id, c.get("userId"), "card_to_card");
      const card = await getPaymentCard();
      return c.json({
        order: { id: order.id, price: order.price, summary: orderSummaryText(order), kind: order.kind },
        card,
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/subscriptions/:id/add-gb", async (c) => {
    const body = await c.req.json<{
      gb?: number;
      paymentMethod?: "wallet" | "card_to_card" | "crypto";
      payWithWallet?: boolean;
    }>();
    try {
      const { createAddGbOrder } = await import("../services/sub-addons.js");
      const order = await createAddGbOrder({
        userId: c.get("userId"),
        subId: c.req.param("id"),
        gb: Number(body.gb),
      });
      if (c.get("role") === "admin" || order.price <= 0) {
        const result =
          c.get("role") === "admin"
            ? await provisionAdminComplimentary(order.id, c.get("userId"))
            : await payOrderWithWallet(order.id, c.get("userId"));
        return c.json({
          order: { id: order.id, price: order.price, trafficGb: order.trafficGb, kind: order.kind },
          provisioned: await provisionedJson(result),
        });
      }
      const method =
        body.paymentMethod === "crypto"
          ? "crypto"
          : body.paymentMethod === "wallet" || body.payWithWallet
            ? "wallet"
            : "card_to_card";
      await assertCheckoutPaymentMethod(method);
      if (method === "wallet") {
        const result = await payOrderWithWallet(order.id, c.get("userId"));
        return c.json({
          order: { id: order.id, price: order.price, trafficGb: order.trafficGb, kind: order.kind },
          provisioned: await provisionedJson(result),
        });
      }
      if (method === "crypto") {
        await setOrderPaymentMethod(order.id, c.get("userId"), "crypto");
        const methods = await getPublicPaymentMethods();
        return c.json({
          order: { id: order.id, price: order.price, summary: orderSummaryText(order), kind: order.kind },
          crypto: methods.crypto,
        });
      }
      await setOrderPaymentMethod(order.id, c.get("userId"), "card_to_card");
      const card = await getPaymentCard();
      return c.json({
        order: { id: order.id, price: order.price, summary: orderSummaryText(order), kind: order.kind },
        card,
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/subscriptions/:id/rename", async (c) => {
    const body = await c.req.json<{ name?: string }>();
    try {
      const { renameSubscriptionEmail } = await import("../services/sub-addons.js");
      const result = await renameSubscriptionEmail(c.get("userId"), c.req.param("id"), String(body.name ?? ""));
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/me/subscriptions/:id/secure-base64", async (c) => {
    try {
      const { getSecureConfigBase64 } = await import("../services/sub-addons.js");
      const result = await getSecureConfigBase64(c.get("userId"), c.req.param("id"));
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/me/subscriptions/:id/renew", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const eligibility = await checkRenewEligibility(sub.id);
    if (!eligibility.ok) {
      return c.json({ ok: false, message: eligibility.message }, 400);
    }
    const category = await inferRenewCategory(sub);
    const labels = await getCategoryLabels();
    const maxMonths = await getMaxPurchaseMonths();
    return c.json({
      ok: true,
      message: eligibility.message,
      reason: eligibility.reason,
      subscription: {
        id: sub.id,
        code: sub.code,
        email: sub.email,
        trafficGb: sub.trafficGb,
        trafficLabel: formatTraffic(sub.trafficGb),
        expiresAt: sub.expiresAt.toISOString(),
      },
      category,
      categoryLabel: labels[category] || category,
      maxMonths,
      discountsEnabled: await isDiscountCodesEnabled(),
      volumeRules: {
        data: { min: 10, max: 50, step: 5 },
        national: { min: 1, max: 20, step: 1 },
        unlimited: null,
      },
    });
  });

  api.post("/me/orders/:id/pay-wallet", async (c) => {
    try {
      const result = await payOrderWithWallet(c.req.param("id"), c.get("userId"));
      return c.json({ ok: true, result });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/test", async (c) => {
    try {
      const sub = await claimTestService(c.get("userId"));
      return c.json({
        ok: true,
        subscription: {
          code: sub.code,
          email: sub.email,
          subUrl: sub.subUrl,
          expiresHint: sub.expiresHint,
        },
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/me/catalog", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const pricedUser = withEffectiveRole(user, c.get("telegramId"));

    if (await isServerlessEnabled()) {
      const {
        getServerlessPricingConfig,
        listServerlessDurations,
        calcServerlessPrice,
      } = await import("../services/serverless.js");
      const cfg = await getServerlessPricingConfig();
      const durations = listServerlessDurations(cfg);
      const defaultLimitIp = await getDefaultLimitIp();
      return c.json({
        serverless: true,
        pricingMode: "rate",
        categories: ["serverless"],
        categoryLabels: { serverless: "خرید سرویس" },
        maxMonths: 2,
        defaultLimitIp,
        canEditLimitIp: canEditLimitIp(pricedUser.role),
        discountsEnabled: await isDiscountCodesEnabled(),
        serverlessPricing: {
          pricePerGb: cfg.pricePerGb,
          pricePerMonth: cfg.pricePerMonth,
          durations: durations.map((d) => ({
            id: d.id,
            months: d.months,
            label: d.label,
            minGb: d.minGb,
            maxGb: d.maxGb,
            step: d.step,
          })),
        },
        volumeRules: {
          data: { min: cfg.monthlyMinGb, max: cfg.monthlyMaxGb, step: 1 },
          national: { min: cfg.weeklyMinGb, max: cfg.weeklyMaxGb, step: 1 },
          unlimited: null,
        },
        cells: [],
        // sample quote helper for UI
        quoteExample: durations[0]
          ? {
              months: durations[0].months,
              trafficGb: durations[0].minGb,
              price:
                pricedUser.role === "admin"
                  ? 0
                  : calcServerlessPrice(durations[0].minGb, durations[0].months, cfg),
            }
          : null,
      });
    }

    const cats = await listEnabledSalesCategoriesForRole(pricedUser.role);
    const labels = await getCategoryLabels();
    const maxMonths = await getMaxPurchaseMonths();
    const cells = await listPriceMatrix();
    const pricingMode = await getPricingModeForRole(pricedUser.role);
    const defaultLimitIp = await getDefaultLimitIp();
    const priced = await Promise.all(
      cells
        .filter((cell) => cell.active && cell.months <= maxMonths)
        .filter((cell) => {
          if (pricedUser.role === "wholesale") {
            return cell.category === "wholesale" || cell.category === "reseller";
          }
          return cats.includes(cell.category);
        })
        .map(async (cell) => {
          // Admin UI shows همکار ویژه prices; checkout remains complimentary (price 0).
          // Fixed plan cards must use THAT cell's matrix price — resolvePrice(unlimited) prefers
          // rate formulas and can disagree with the selected card (e.g. 2M on card vs 2.8M quote).
          const displayRole = pricedUser.role === "admin" ? "reseller" : undefined;
          let price: number | null = null;
          if (isFixedSingleServiceCategory(cell.category)) {
            price = await priceForMatrixCell(pricedUser, cell, displayRole);
          } else {
            const resolved = await resolvePrice(
              pricedUser,
              cell.trafficGb,
              cell.months,
              cell.category,
              displayRole,
            );
            price = resolved?.price ?? null;
          }
          return {
            id: cell.id,
            category:
              pricedUser.role === "wholesale" && (cell.category === "reseller" || cell.category === "wholesale")
                ? "wholesale"
                : cell.category,
            trafficGb: cell.trafficGb,
            months: cell.months,
            title: cell.title,
            isGolden: cell.isGolden,
            price,
            limitIp: cell.limitIp ?? 0,
          };
        }),
    );

    // Rate-mode only: fill missing unlimited months. Never invent fake cell ids when matrix unlimited plans exist
    // (inactive matrix rows must not reappear as selectable rate-unlimited-* stubs).
    if (cats.includes("unlimited") && pricedUser.role !== "wholesale" && pricingMode === "rate") {
      const haveMonths = new Set(
        priced.filter((p) => p.category === "unlimited" && p.price != null).map((p) => p.months),
      );
      for (let months = 1; months <= maxMonths; months++) {
        if (haveMonths.has(months)) continue;
        const resolved = await resolvePrice(
          pricedUser,
          null,
          months,
          "unlimited",
          pricedUser.role === "admin" ? "reseller" : undefined,
        );
        if (!resolved) continue;
        priced.push({
          id: `rate-unlimited-${months}`,
          category: "unlimited",
          trafficGb: null,
          months,
          title: null,
          isGolden: false,
          price: resolved.price,
          limitIp: 0,
        });
      }
    }

    return c.json({
      pricingMode,
      categories: cats,
      categoryLabels: labels,
      maxMonths,
      defaultLimitIp,
      canEditLimitIp: canEditLimitIp(pricedUser.role),
      discountsEnabled:
        pricedUser.role !== "wholesale" && (await isDiscountCodesEnabled()),
      volumeRules: {
        data: { min: 10, max: 50, step: 5 },
        national: { min: 1, max: 20, step: 1 },
        unlimited: null,
      },
      cells: priced.filter((cell) => cell.price != null),
      adminComplimentary: pricedUser.role === "admin",
    });
  });

  api.post("/me/quote", async (c) => {
    const body = await c.req.json<{
      trafficGb?: number | null;
      months?: number;
      category?: string;
      quantity?: number;
      discountCode?: string | null;
      priceCellId?: string | null;
    }>();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const pricedUser = withEffectiveRole(user, c.get("telegramId"));

    if (await isServerlessEnabled()) {
      const {
        getServerlessPricingConfig,
        snapServerlessGb,
        assertServerlessPlanAllowed,
        resolveServerlessPrice,
      } = await import("../services/serverless.js");
      const cfg = await getServerlessPricingConfig();
      const monthsRaw = Number(body.months);
      const months = monthsRaw <= 0 ? 0 : Math.min(2, Math.max(1, Math.floor(monthsRaw || 1)));
      if (body.trafficGb == null) return c.json({ error: "حجم سرویس مشخص نشده است" }, 400);
      const trafficGb = snapServerlessGb(body.trafficGb, months, cfg);
      try {
        assertServerlessPlanAllowed(trafficGb, months, cfg);
      } catch (err) {
        return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
      }
      const priced = await resolveServerlessPrice(pricedUser, trafficGb, months);
      if (!priced) return c.json({ error: "این ترکیب قیمت‌گذاری نشده است" }, 400);
      const priceBefore = priced.price;
      let discountAmount = 0;
      let price = priceBefore;
      let discountCode: string | null = null;
      let percentOff: number | null = null;
      if (body.discountCode?.trim()) {
        const prev = await previewDiscount({
          buyer: pricedUser,
          code: body.discountCode,
          price: priceBefore,
        });
        if (!("error" in prev)) {
          discountAmount = prev.discountAmount;
          price = prev.priceAfter;
          discountCode = prev.code;
          percentOff = prev.percentOff;
        }
      }
      return c.json({
        trafficGb,
        months,
        category: "serverless",
        quantity: 1,
        priceBefore,
        discountAmount,
        price,
        discountCode,
        percentOff,
      });
    }

    let category = body.category || "data";
    let trafficGb = normalizePurchaseTraffic(category, body.trafficGb ?? null);
    let months = Math.max(1, Number(body.months) || 1);
    const qty = Math.max(1, Math.min(50, Number(body.quantity) || 1));
    const priceCellId = body.priceCellId?.trim() || "";
    let resolvedCell: Awaited<ReturnType<typeof prisma.priceCell.findFirst>> = null;
    if (priceCellId) {
      const rateUnlimited = /^rate-unlimited-(\d+)$/.exec(priceCellId);
      if (rateUnlimited) {
        months = Math.max(1, Number(rateUnlimited[1]) || 1);
        trafficGb = null;
        category = "unlimited";
      } else {
        const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
        const tenantId = await resolveTenantIdOrPlatform();
        resolvedCell = await prisma.priceCell.findFirst({
          where: { id: priceCellId, tenantId, active: true },
        });
        if (!resolvedCell) return c.json({ error: "پلن انتخاب‌شده پیدا نشد" }, 400);
        trafficGb = resolvedCell.trafficGb;
        months = resolvedCell.months;
        category = resolvedCell.category;
      }
    }

    const offerLocked = isOfferCategory(category);
    const fixedSingle = isFixedSingleServiceCategory(category);
    let priced = await resolvePrice(pricedUser, trafficGb, months, category);
    if (fixedSingle && resolvedCell) {
      if (pricedUser.role === "admin") {
        priced = { cell: resolvedCell, price: 0, mode: "matrix" as const };
      } else {
        const cellPrice = await priceForMatrixCell(pricedUser, resolvedCell);
        priced = cellPrice != null ? { cell: resolvedCell, price: cellPrice, mode: "matrix" as const } : null;
      }
    }
    if (!priced) return c.json({ error: "این ترکیب قیمت‌گذاری نشده است" }, 400);

    // Admin: show همکار ویژه service amount while payable stays 0 — must match catalog card price
    let servicePrice = priced.price;
    if (pricedUser.role === "admin") {
      if (resolvedCell) {
        servicePrice = (await priceForMatrixCell(pricedUser, resolvedCell, "reseller")) ?? 0;
      } else {
        const shown = await resolvePrice(pricedUser, trafficGb, months, category, "reseller");
        servicePrice = shown?.price ?? 0;
      }
    }

    const priceBefore = priced.price * (fixedSingle ? 1 : qty);
    let discountAmount = 0;
    let price = priceBefore;
    let discountCode: string | null = null;
    let percentOff: number | null = null;
    let discountError: string | null = null;
    if (!offerLocked && body.discountCode?.trim()) {
      if (pricedUser.role === "wholesale" || category === "wholesale" || category === "reseller") {
        discountError = "کد تخفیف برای عمده‌فروش فعال نیست";
      } else {
        const prev = await previewDiscount({
          buyer: pricedUser,
          code: body.discountCode,
          price: priceBefore,
        });
        if ("error" in prev) {
          discountError = prev.error;
        } else {
          discountAmount = prev.discountAmount;
          price = prev.priceAfter;
          discountCode = prev.code;
          percentOff = prev.percentOff;
        }
      }
    } else if (offerLocked && body.discountCode?.trim()) {
      discountError = "کد تخفیف برای پیشنهاد ویژه فعال نیست";
    }
    return c.json({
      price,
      servicePrice: pricedUser.role === "admin" ? servicePrice * (fixedSingle ? 1 : qty) : price,
      priceBefore,
      discountAmount,
      discountCode,
      percentOff,
      discountError,
      mode: priced.mode,
      trafficGb,
      months,
      category,
      quantity: fixedSingle ? 1 : qty,
      priceCellId: body.priceCellId?.trim() || null,
    });
  });

  api.get("/me/orders", async (c) => {
    const orders = await prisma.order.findMany({
      where: { userId: c.get("userId") },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return c.json({
      orders: orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        price: o.price,
        trafficGb: o.trafficGb,
        months: o.months,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  });

  api.get("/me/reports/sales", async (c) => {
    const role = c.get("role");
    if (role !== "admin" && role !== "partner" && role !== "wholesale" && role !== "reseller") {
      return c.json({ error: "Forbidden" }, 403);
    }
    const period = parseSalesPeriod(c.req.query("period") || "jalali_month");
    const stats = await buildSalesStats({
      userId: role === "admin" ? null : c.get("userId"),
      period,
      includeWallet: role === "admin",
      title: role === "admin" ? "گزارش فروش" : "گزارش فروش شما",
    });
    return c.json(stats);
  });

  api.post("/me/wallet/charge", async (c) => {
    const body = await c.req.json<{ amount?: number; note?: string }>();
    const amount = Math.floor(Number(body.amount ?? 0));
    if (!amount || amount < 10_000) return c.json({ error: "حداقل شارژ ۱۰٬۰۰۰ تومان است" }, 400);
    try {
      await assertCheckoutPaymentMethod("card_to_card");
      const order = await createWalletChargeOrder(c.get("userId"), amount);
      // Dashboard flow: receipt info is text-only; goes straight to admin review
      await prisma.order.update({
        where: { id: order.id },
        data: {
          receiptText: body.note?.trim() ? body.note.trim().slice(0, 500) : "درخواست شارژ از داشبورد وب",
          receiptFileId: "dashboard",
          status: "awaiting_review",
        },
      });
      const card = await getPaymentCard();
      await auditLog({
        action: "web_wallet_charge_request",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: order.id,
        detail: String(amount),
      });
      const { notifyAdminsOrderAwaitingReview } = await import("../services/order-notify.js");
      void notifyAdminsOrderAwaitingReview(order.id);
      return c.json({ order: { id: order.id, price: order.price }, card });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/orders", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      category?: string;
      accountName?: string;
      kind?: OrderKind;
      targetSubId?: string;
      payWithWallet?: boolean;
      paymentMethod?: "wallet" | "card_to_card" | "crypto";
      limitIp?: number;
      note?: string | null;
      discountCode?: string | null;
      quantity?: number;
      priceCellId?: string | null;
    }>();
    try {
      const accountName = body.accountName?.trim() || `u${Date.now().toString(36)}`;
      const order = await createMatrixOrder({
        userId: c.get("userId"),
        trafficGb: body.trafficGb,
        months: body.months,
        category: body.category,
        accountName,
        kind: body.kind,
        targetSubId: body.targetSubId,
        limitIp: body.limitIp,
        note: body.note,
        discountCode: body.discountCode,
        quantity: body.quantity,
        priceCellId: body.priceCellId,
      });
      if (c.get("role") === "admin") {
        try {
          const result = await provisionAdminComplimentary(order.id, c.get("userId"));
          return c.json({
            order: { id: order.id, price: order.price },
            provisioned: await provisionedJson(result),
          });
        } catch (err) {
          return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
        }
      }
      const method =
        body.paymentMethod === "crypto"
          ? "crypto"
          : body.paymentMethod === "wallet" || body.payWithWallet
            ? "wallet"
            : "card_to_card";
      await assertCheckoutPaymentMethod(method);
      if (method === "wallet") {
        try {
          const result = await payOrderWithWallet(order.id, c.get("userId"));
          return c.json({
            order: { id: order.id, price: order.price },
            provisioned: await provisionedJson(result),
          });
        } catch (err) {
          return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
        }
      }
      if (method === "crypto") {
        await setOrderPaymentMethod(order.id, c.get("userId"), "crypto");
        const methods = await getPublicPaymentMethods();
        return c.json({
          order: {
            id: order.id,
            price: order.price,
            summary: orderSummaryText(order),
            trafficGb: order.trafficGb,
            months: order.months,
            paymentMethod: "crypto",
          },
          crypto: methods.crypto,
        });
      }
      await setOrderPaymentMethod(order.id, c.get("userId"), "card_to_card");
      const card = await getPaymentCard();
      return c.json({
        order: {
          id: order.id,
          price: order.price,
          summary: orderSummaryText(order),
          trafficGb: order.trafficGb,
          months: order.months,
          paymentMethod: "card_to_card",
        },
        card,
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/partner-request", async (c) => {
    const body = await c.req.json<{ fullName: string; phone?: string; note?: string }>();
    const req = await submitPartnerRequest(c.get("userId"), body.fullName, body.phone, body.note);
    return c.json({ id: req.id, status: req.status });
  });

  api.get("/me/guide", async (c) => {
    const [
      guide_text,
      guide_android,
      guide_ios,
      guide_windows,
      guide_mac,
      guide_android_text,
      guide_ios_text,
      guide_windows_text,
      guide_macos_text,
      support_username,
    ] = await Promise.all([
      getSetting("guide_text"),
      getSetting("guide_android_url"),
      getSetting("guide_ios_url"),
      getSetting("guide_windows_url"),
      getSetting("guide_macos_url"),
      getSetting("guide_android_text"),
      getSetting("guide_ios_text"),
      getSetting("guide_windows_text"),
      getSetting("guide_macos_text"),
      getSetting("support_username"),
    ]);
    return c.json({
      guide: {
        guide_text,
        guide_android,
        guide_ios,
        guide_windows,
        guide_mac,
        guide_android_text,
        guide_ios_text,
        guide_windows_text,
        guide_macos_text,
        support_username,
      },
    });
  });

  api.post("/me/lookup", async (c) => {
    const body = await c.req.json<{ input?: string }>();
    if (!body.input) return c.json({ error: "input لازم است" }, 400);
    return c.json(await lookupConfigByLinkOrUuid(body.input));
  });
}

export function registerDashPartnerRoutes(api: Hono<{ Variables: Vars }>) {
  api.use("/partner/*", async (c, next) => {
    const role = c.get("role");
    if (role !== "partner" && role !== "wholesale" && role !== "reseller" && role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });

  api.get("/partner/home", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const stats = await buildSalesStats({
      userId: user.id,
      period: "jalali_month",
      includeWallet: false,
      recentLimit: 0,
      title: "فروش ماه جاری",
    });
    return c.json({
      agentName: user.agentName,
      panelGroup: user.panelGroup,
      role: user.role,
      report: {
        period: "jalali_month",
        monthName: persianMonthName(),
        orders: stats.count,
        sales: stats.total,
        salesLabel: formatToman(stats.total),
        activeSubs: stats.activeSubs,
        newCount: stats.newCount,
        renewCount: stats.renewCount,
      },
    });
  });

  api.get("/partner/configs", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const role = c.get("role");
    let groupKey: string | null = null;
    if (user.panelGroup) {
      const groups = await listConfigGroups();
      const mine = groups.find((g) => g.panelGroup === user.panelGroup);
      if (!mine) return c.json({ items: [], total: 0, title: user.panelGroup });
      groupKey = mine.key;
    } else if (role === "admin") {
      // Admin panel preview without a personal panelGroup: show all configs
      groupKey = "all";
    } else {
      return c.json({ items: [], total: 0, title: "بدون گروه" });
    }
    const result = await listConfigsForGroup(groupKey, 0, 0);
    const items = await Promise.all(
      result.items.map(async (item) => {
        if (!item.subId) return { ...item, usedTrafficBytes: 0, subUrl: null as string | null };
        const [traf, sub] = await Promise.all([
          getSubscriptionTrafficBytes(item.subId).catch(() => ({
            usedBytes: 0,
            totalBytes: 0,
            totalGb: item.trafficGb ?? null,
          })),
          prisma.subscription.findUnique({
            where: { id: item.subId },
            select: { subUrl: true },
          }),
        ]);
        return {
          ...item,
          trafficGb: traf.totalGb ?? item.trafficGb ?? null,
          usedTrafficBytes: traf.usedBytes,
          subUrl: sub?.subUrl ?? null,
        };
      }),
    );
    return c.json({ ...result, items });
  });

  /** Resolve a config the partner may touch; never trust client subId alone when email differs. */
  async function resolvePartnerConfigAccess(
    userId: string,
    role: string,
    email?: string | null,
    subId?: string | null,
  ): Promise<{ email: string; subId: string | null }> {
    const emailNorm = (email ?? "").trim().toLowerCase();
    if (role === "admin") {
      if (subId) {
        const sub = await prisma.subscription.findUnique({ where: { id: subId }, select: { id: true, email: true } });
        if (sub) return { email: sub.email, subId: sub.id };
      }
      if (emailNorm) {
        const sub = await prisma.subscription.findFirst({
          where: { email: email!.trim() },
          select: { id: true, email: true },
        });
        return { email: sub?.email ?? email!.trim(), subId: sub?.id ?? null };
      }
      throw new Error("ایمیل یا شناسه اکانت لازم است");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.panelGroup) throw new Error("گروه پنل ندارید");
    const groups = await listConfigGroups();
    const mine = groups.find((g) => g.panelGroup === user.panelGroup);
    if (!mine) throw new Error("گروه پنل پیدا نشد");
    const list = await listConfigsForGroup(mine.key, 0, 0);

    let match =
      (emailNorm ? list.items.find((i) => i.email.toLowerCase() === emailNorm) : undefined) ??
      (subId ? list.items.find((i) => i.subId === subId) : undefined);

    if (!match) throw new Error("دسترسی به این کانفیگ ندارید");

    if (emailNorm && match.email.toLowerCase() !== emailNorm) {
      throw new Error("دسترسی به این کانفیگ ندارید");
    }
    if (subId && match.subId && match.subId !== subId) {
      throw new Error("دسترسی به این کانفیگ ندارید");
    }

    return { email: match.email, subId: match.subId };
  }

  api.get("/partner/configs/detail", async (c) => {
    const email = c.req.query("email") || "";
    const subId = c.req.query("subId") || null;
    try {
      const access = await resolvePartnerConfigAccess(c.get("userId"), c.get("role"), email, subId);
      return c.json(await getConfigDetail({ email: access.email, subId: access.subId }));
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.put("/partner/configs/update", async (c) => {
    const body = await c.req.json<{
      email: string;
      subId?: string | null;
      title?: string | null;
      note?: string | null;
      enable?: boolean;
    }>();
    try {
      const access = await resolvePartnerConfigAccess(c.get("userId"), c.get("role"), body.email, body.subId);
      const result = await updateConfig({
        email: access.email,
        subId: access.subId,
        title: body.title,
        note: body.note,
        enable: body.enable,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/partner/configs/rotate-sub", async (c) => {
    const body = await c.req.json<{ email?: string; subId?: string | null }>();
    try {
      const access = await resolvePartnerConfigAccess(c.get("userId"), c.get("role"), body.email, body.subId);
      if (!access.subId) return c.json({ error: "اکانت در دیتابیس ربات نیست" }, 404);
      const result = await rotateSubId(access.subId);
      return c.json({ code: result.code, subUrl: result.subUrl });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/partner/configs/refresh-from-panel", async (c) => {
    const body = await c.req.json<{ email?: string; subId?: string | null }>();
    try {
      const access = await resolvePartnerConfigAccess(c.get("userId"), c.get("role"), body.email, body.subId);
      if (!access.subId) return c.json({ error: "اکانت در دیتابیس ربات نیست" }, 404);
      const result = await refreshSubscriptionFromPanel(access.subId);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/partner/configs/delete", async (c) => {
    const body = await c.req.json<{ email?: string; subId?: string | null }>();
    try {
      const access = await resolvePartnerConfigAccess(c.get("userId"), c.get("role"), body.email, body.subId);
      const result = await deleteConfig({
        email: access.email,
        subId: access.subId,
        actorTelegramId: BigInt(c.get("telegramId")),
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/partner/create", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      category?: string;
      accountName?: string;
      payWithWallet?: boolean;
      paymentMethod?: "wallet" | "card_to_card" | "crypto";
      limitIp?: number;
      note?: string | null;
      discountCode?: string | null;
      quantity?: number;
      priceCellId?: string | null;
    }>();
    try {
      const order = await createMatrixOrder({
        userId: c.get("userId"),
        trafficGb: body.trafficGb,
        months: body.months ?? 1,
        category: body.category,
        accountName: body.accountName?.trim() || `p${Date.now().toString(36)}`,
        kind: OrderKind.new,
        limitIp: body.limitIp,
        note: body.note,
        discountCode: body.discountCode,
        quantity: body.quantity,
        priceCellId: body.priceCellId,
      });
      if (c.get("role") === "admin") {
        try {
          const result = await provisionAdminComplimentary(order.id, c.get("userId"));
          return c.json({
            order: { id: order.id, price: order.price },
            provisioned: await provisionedJson(result),
          });
        } catch (err) {
          return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
        }
      }
      const method =
        body.paymentMethod === "crypto"
          ? "crypto"
          : body.paymentMethod === "wallet" || body.payWithWallet
            ? "wallet"
            : "card_to_card";
      await assertCheckoutPaymentMethod(method);
      if (method === "wallet") {
        try {
          const result = await payOrderWithWallet(order.id, c.get("userId"));
          return c.json({
            order: { id: order.id, price: order.price },
            provisioned: await provisionedJson(result),
          });
        } catch (err) {
          return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
        }
      }
      if (method === "crypto") {
        await setOrderPaymentMethod(order.id, c.get("userId"), "crypto");
        const methods = await getPublicPaymentMethods();
        return c.json({
          order: { id: order.id, price: order.price, summary: orderSummaryText(order), paymentMethod: "crypto" },
          crypto: methods.crypto,
        });
      }
      await setOrderPaymentMethod(order.id, c.get("userId"), "card_to_card");
      const card = await getPaymentCard();
      return c.json({
        order: { id: order.id, price: order.price, summary: orderSummaryText(order), paymentMethod: "card_to_card" },
        card,
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/me/discounts", async (c) => {
    const role = c.get("role");
    if (!canManageDiscountCodes(role)) return c.json({ error: "Forbidden" }, 403);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const actor = { ...user, role: role as typeof user.role };
    const enabled = await isDiscountCodesEnabled();
    const allowed = canUserManageDiscountCodes(actor);
    const maxPercent = allowed ? await getDiscountMaxPercentForUser(actor) : 0;
    const items = allowed ? await listDiscountCodesForUser(c.get("userId"), role) : [];
    return c.json({
      enabled,
      allowed,
      maxPercent,
      discountCodesAllowed: user.discountCodesAllowed,
      discountMaxPercent: user.discountMaxPercent,
      items,
    });
  });

  api.post("/me/discounts", async (c) => {
    const role = c.get("role");
    if (!canManageDiscountCodes(role)) return c.json({ error: "Forbidden" }, 403);
    const body = await c.req.json<{
      code?: string;
      percentOff?: number;
      maxUses?: number | null;
      expiresAt?: string | null;
      note?: string | null;
      shareable?: boolean;
      ownerUserId?: string | null;
    }>();
    try {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
      const actor = { ...user, role: role as typeof user.role };
      const item = await createDiscountCode({
        actor,
        code: body.code || "",
        percentOff: Number(body.percentOff),
        maxUses: body.maxUses,
        expiresAt: body.expiresAt,
        note: body.note,
        shareable: body.shareable,
        ownerUserId: role === "admin" ? body.ownerUserId : null,
      });
      return c.json({ ok: true, item });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.patch("/me/discounts/:id", async (c) => {
    const role = c.get("role");
    if (!canManageDiscountCodes(role)) return c.json({ error: "Forbidden" }, 403);
    const body = await c.req.json<{
      active?: boolean;
      percentOff?: number;
      maxUses?: number | null;
      expiresAt?: string | null;
      note?: string | null;
      shareable?: boolean;
    }>();
    try {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
      const actor = { ...user, role: role as typeof user.role };
      const item = await updateDiscountCode({
        actor,
        id: c.req.param("id"),
        active: body.active,
        percentOff: body.percentOff,
        maxUses: body.maxUses,
        expiresAt: body.expiresAt,
        note: body.note,
        shareable: body.shareable,
      });
      return c.json({ ok: true, item });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.delete("/me/discounts/:id", async (c) => {
    const role = c.get("role");
    if (!canManageDiscountCodes(role)) return c.json({ error: "Forbidden" }, 403);
    try {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
      await deleteDiscountCode({ actor: user, id: c.req.param("id") });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });
}

export function registerDashAdminRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/admin/home", async (c) => {
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const pending = await prisma.order.count({ where: { tenantId, status: "awaiting_review" } });
    const users = await prisma.user.count({ where: { tenantId } });
    const activeSubs = await prisma.subscription.count({ where: { tenantId, status: "active" } });
    const sales = await adminSalesReport("today");
    return c.json({
      pendingOrders: pending,
      users,
      activeSubs,
      salesToday: { total: sales.total, count: sales.count, label: formatToman(sales.total) },
    });
  });

  api.get("/admin/reports/sales", async (c) => {
    const period = parseSalesPeriod(c.req.query("period"));
    return c.json(await buildSalesStats({ userId: null, period, includeWallet: true }));
  });

  api.get("/admin/reports/agents", async (c) => {
    const q = c.req.query("role");
    const role = q === "wholesale" || q === "reseller" ? q : "partner";
    const period = parseSalesPeriod(c.req.query("period") || "jalali_month");
    return c.json(await agentsSalesLeaderboard({ role, period }));
  });

  api.get("/admin/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const result = await searchUsersAndOrders(q);
    await auditLog({
      action: "admin_search",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: q.slice(0, 80),
    });
    return c.json({
      users: result.users.map((u) => ({
        id: u.id,
        telegramId: String(u.telegramId),
        username: u.username,
        role: u.role,
        balance: u.wallet?.balance ?? 0,
        orders: u._count.orders,
        subscriptions: u._count.subscriptions,
      })),
      orders: result.orders.map((o) => ({
        id: o.id,
        status: o.status,
        kind: o.kind,
        price: o.price,
        accountName: o.accountName,
        user: o.user.username ? `@${o.user.username}` : String(o.user.telegramId),
      })),
    });
  });

  api.get("/admin/audit", async (c) => {
    const rows = await listRecentAudit(50);
    return c.json({
      logs: rows.map((r) => ({
        id: r.id,
        action: r.action,
        target: r.target,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
        actorTelegramId: r.actorTelegramId != null ? String(r.actorTelegramId) : null,
      })),
    });
  });

  api.get("/admin/accounts/full", async (c) => {
    const email = c.req.query("email") || "";
    const subId = c.req.query("subId") || null;
    const archiveId = c.req.query("archiveId") || null;
    try {
      const result = await resolveAccountDetailForReport({ email, subId, archiveId });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/archives", async (c) => {
    const reason = c.req.query("reason") || undefined;
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 50)));
    const rows = await listAccountArchives({ limit, reason });
    return c.json({ archives: rows });
  });

  api.get("/admin/archives/:id", async (c) => {
    try {
      return c.json(await getAccountArchive(c.req.param("id")));
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 404);
    }
  });

  api.post("/admin/archives/:id/restore", async (c) => {
    try {
      const result = await restoreAccountFromArchive({ archiveId: c.req.param("id") });
      await auditLog({
        action: "admin_account_restore",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: result.email,
        detail: `archive=${c.req.param("id")} sub=${result.botSubId}`,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/orders/pending", async (c) => {
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        OR: [
          { status: "awaiting_review" },
          { status: "awaiting_delivery" },
          // Stuck after a failed provision attempt — still needs admin action
          { status: "paid", subscription: null, kind: { not: "wallet_charge" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: true },
    });
    const { isTelegramReceiptFileId } = await import("../services/order-notify.js");
    return c.json({
      orders: orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        status:
          o.status === "paid"
            ? "awaiting_review"
            : o.status === "awaiting_delivery"
              ? "awaiting_delivery"
              : o.status,
        price: o.price,
        paymentMethod: o.paymentMethod,
        summary: orderSummaryText(o),
        receiptText: o.receiptText,
        hasReceiptImage: isTelegramReceiptFileId(o.receiptFileId),
        createdAt: o.createdAt.toISOString(),
        user: {
          username: o.user.username,
          telegramId: String(o.user.telegramId),
          firstName: o.user.firstName,
        },
        provisionError: o.status === "paid" ? o.adminNote : null,
      })),
    });
  });

  api.get("/admin/orders/:id/receipt-file", async (c) => {
    const order = await prisma.order.findUnique({ where: { id: c.req.param("id") } });
    if (!order) return c.json({ error: "Not found" }, 404);
    const { fetchTelegramFileById, isTelegramReceiptFileId } = await import("../services/order-notify.js");
    if (!isTelegramReceiptFileId(order.receiptFileId)) {
      return c.json({ error: "عکس رسید موجود نیست" }, 404);
    }
    const file = await fetchTelegramFileById(order.receiptFileId!);
    if (!file) return c.json({ error: "دریافت فایل از تلگرام ناموفق بود" }, 502);
    return new Response(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  api.post("/admin/orders/:id/approve", async (c) => {
    const orderId = c.req.param("id");
    const order = await getOrderForAdmin(orderId);
    if (!order) return c.json({ error: "سفارش پیدا نشد" }, 404);
    if (order.status === "completed") return c.json({ error: "قبلاً تکمیل شده" }, 400);
    try {
      await markPaid(orderId);
      await auditLog({
        action: "order_approved",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: orderId,
      });
      const result = await fulfillAfterPaid(orderId);
      if (isWalletCreditResult(result)) {
        await notifyTelegram(
          order.user.telegramId,
          `✅ کیف پول شارژ شد\nموجودی: ${formatToman(result.balance)}`,
        );
        const { finalizeOrderAdminMessages, orderApprovedAdminStatus } = await import(
          "../services/order-notify.js"
        );
        void finalizeOrderAdminMessages(
          orderId,
          orderApprovedAdminStatus({ kind: order.kind, price: order.price, wallet: true }),
        );
        return c.json({ ok: true, walletBalance: result.balance });
      }
      if (isServerlessPending(result)) {
        return c.json({ ok: true, serverlessPending: true });
      }
      const { deliverProvisionToUser } = await import("../services/provision-notify.js");
      const mode =
        order.kind === "add_days" || order.kind === "add_gb"
          ? "addon"
          : order.kind === "renew"
            ? "renew"
            : "new";
      try {
        await deliverProvisionToUser(order.user.telegramId, result, order.trafficGb, mode);
      } catch (err) {
        console.error("deliverProvisionToUser after web approve", err);
        await notifyTelegram(
          order.user.telegramId,
          `✅ سفارش شما تأیید شد\nکد: ${result.code}${result.subUrl ? `\nلینک اشتراک:\n${result.subUrl}` : ""}`,
        );
      }
      const { finalizeOrderAdminMessages, orderApprovedAdminStatus } = await import(
        "../services/order-notify.js"
      );
      void finalizeOrderAdminMessages(
        orderId,
        orderApprovedAdminStatus({
          kind: order.kind,
          price: order.price,
          code: result.code,
          quantity: order.quantity,
        }),
      );
      return c.json({
        ok: true,
        code: result.code,
        subUrl: result.subUrl,
        subscriptionId: result.subscriptionId,
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/orders/:id/reject", async (c) => {
    const body = await c.req.json<{ note?: string }>().catch(() => ({ note: undefined }));
    const order = await rejectOrder(c.req.param("id"), body.note?.trim() || "رد شده توسط ادمین");
    await auditLog({
      action: "order_rejected",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: order.id,
    });
    await notifyTelegram(order.user.telegramId, `❌ سفارش شما رد شد.\n${body.note?.trim() || ""}`.trim());
    const { finalizeOrderAdminMessages } = await import("../services/order-notify.js");
    void finalizeOrderAdminMessages(order.id, "❌ رد شد");
    return c.json({ ok: true });
  });

  api.get("/admin/prices", async (c) => {
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const cells = await prisma.priceCell.findMany({
      where: { tenantId },
      orderBy: [{ category: "asc" }, { months: "asc" }, { trafficGb: "asc" }],
    });
    return c.json({
      cells: cells.map((x) => ({
        id: x.id,
        title: x.title,
        category: x.category,
        trafficGb: x.trafficGb,
        months: x.months,
        priceUser: x.priceUser,
        pricePartner: x.pricePartner,
        priceWholesale: x.priceWholesale,
        priceReseller: x.priceReseller,
        limitIp: x.limitIp,
        isGolden: x.isGolden,
        active: x.active,
      })),
      modes: await getPricingModes(),
      rates: await getPriceRates(),
    });
  });

  api.get("/admin/pricing-modes", async (c) => c.json({ modes: await getPricingModes() }));

  api.put("/admin/pricing-modes", async (c) => {
    const body = await c.req.json<Partial<RolePricingModes>>();
    const current = await getPricingModes();
    const pick = (k: keyof RolePricingModes) =>
      body[k] === "rate" || body[k] === "matrix" ? body[k]! : current[k];
    const modes: RolePricingModes = {
      user: pick("user"),
      partner: pick("partner"),
      reseller: pick("reseller"),
      wholesale: pick("wholesale"),
    };
    await savePricingModes(modes);
    await auditLog({
      action: "pricing_modes",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: JSON.stringify(modes),
    });
    return c.json({ modes });
  });

  api.get("/admin/price-rates", async (c) => c.json({ rates: await getPriceRates() }));

  api.put("/admin/price-rates", async (c) => {
    const body = await c.req.json<Partial<PriceRates>>();
    const current = await getPriceRates();
    const rates: PriceRates = {
      user: { ...current.user, ...(body.user ?? {}) },
      partner: { ...current.partner, ...(body.partner ?? {}) },
      wholesale: { ...current.wholesale, ...(body.wholesale ?? {}) },
      categories: body.categories ?? current.categories,
    };
    await savePriceRates(rates);
    await auditLog({
      action: "price_rates",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: "updated",
    });
    return c.json({ rates });
  });

  api.post("/admin/prices", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      priceUser: number;
      pricePartner: number;
      priceWholesale?: number;
      priceReseller?: number;
      limitIp?: number;
      category?: PlanCategory;
      isGolden?: boolean;
      title?: string;
    }>();
    if (!Number.isFinite(body.months) || body.months < 1) return c.json({ error: "ماه نامعتبر" }, 400);
    const cell = await upsertPriceCell(body);
    await auditLog({
      action: "web_price_upsert",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: cell.id,
    });
    return c.json({ ok: true, id: cell.id });
  });

  api.put("/admin/prices/:id", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const data: Record<string, unknown> = {};
    for (const k of ["title", "priceUser", "pricePartner", "priceWholesale", "priceReseller", "limitIp", "isGolden", "trafficGb", "months", "category", "active"]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    // ∞GB only in unlimited — offer may also be ∞ while staying category=offer
    if (data.category === "unlimited") {
      data.trafficGb = null;
    } else if (data.trafficGb === null && typeof data.category === "string" && data.category !== "offer") {
      data.category = "unlimited";
    }
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const result = await prisma.priceCell.updateMany({
      where: { id: c.req.param("id"), tenantId },
      data,
    });
    if (!result.count) return c.json({ error: "پیدا نشد" }, 404);
    return c.json({ ok: true });
  });

  api.delete("/admin/prices/:id", async (c) => {
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const result = await prisma.priceCell.deleteMany({
      where: { id: c.req.param("id"), tenantId },
    });
    if (!result.count) return c.json({ error: "پیدا نشد" }, 404);
    await auditLog({
      action: "web_price_delete",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: c.req.param("id"),
    });
    return c.json({ ok: true });
  });

  /** Bulk price edit: percent or fixed amount, per role columns, optional category filter. */
  api.post("/admin/prices/bulk", async (c) => {
    const body = await c.req.json<{
      category?: string;
      mode: "percent" | "amount";
      value: number;
      fields?: Array<"priceUser" | "pricePartner" | "priceWholesale">;
      roundTo?: number;
    }>();
    const fields = body.fields?.length ? body.fields : (["priceUser", "pricePartner", "priceWholesale", "priceReseller"] as const);
    const value = Number(body.value);
    if (!Number.isFinite(value) || value === 0) return c.json({ error: "مقدار نامعتبر" }, 400);
    const roundTo = Math.max(1, Math.floor(body.roundTo ?? 1000));
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const cells = await prisma.priceCell.findMany({
      where: { tenantId, active: true, ...(body.category ? { category: body.category } : {}) },
    });
    let updated = 0;
    for (const cell of cells) {
      const data: Record<string, number> = {};
      for (const f of fields) {
        const cur = cell[f];
        const next =
          body.mode === "percent" ? cur + (cur * value) / 100 : cur + value;
        data[f] = Math.max(0, Math.round(next / roundTo) * roundTo);
      }
      await prisma.priceCell.update({ where: { id: cell.id }, data });
      updated++;
    }
    await auditLog({
      action: "web_price_bulk",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: `${body.mode}:${value} cat:${body.category ?? "all"} n:${updated}`,
    });
    return c.json({ ok: true, updated });
  });

  api.get("/admin/categories", async (c) => {
    const enabled = await getSalesCategories();
    const labels = await getCategoryLabels();
    const order = await getCategoryOrder();
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const counts = await prisma.priceCell.groupBy({
      by: ["category"],
      where: { tenantId, active: true },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((x) => [x.category, x._count._all]));
    // Fold legacy reseller cells into wholesale count
    const resellerCount = countMap.get("reseller") ?? 0;
    if (resellerCount) {
      countMap.set("wholesale", (countMap.get("wholesale") ?? 0) + resellerCount);
      countMap.delete("reseller");
    }
    const keys = new Set<string>([
      ...BUILTIN_CATEGORY_KEYS,
      ...Object.keys(enabled),
      ...Object.keys(labels),
      ...[...countMap.keys()],
    ]);
    keys.delete("reseller");
    const sorted = sortKeysByCategoryOrder([...keys], order);
    return c.json({
      categories: sorted.map((key) => ({
        key,
        label: labels[key] || key,
        enabled: enabled[key] === true,
        cellCount: countMap.get(key) ?? 0,
        builtin: (BUILTIN_CATEGORY_KEYS as readonly string[]).includes(key),
      })),
    });
  });

  api.put("/admin/categories/order", async (c) => {
    const body = await c.req.json<{ order?: string[] }>();
    if (!Array.isArray(body.order) || !body.order.length) {
      return c.json({ error: "ترتیب نامعتبر است" }, 400);
    }
    const enabled = await getSalesCategories();
    const labels = await getCategoryLabels();
    const known = new Set<string>([
      ...BUILTIN_CATEGORY_KEYS,
      ...Object.keys(enabled),
      ...Object.keys(labels),
    ]);
    const order = body.order
      .map((k) => sanitizeCategoryKey(String(k)))
      .filter((k) => k && known.has(k));
    const seen = new Set(order);
    for (const k of known) {
      if (!seen.has(k)) order.push(k);
    }
    await saveCategoryOrder(order);
    await auditLog({
      action: "web_category_reorder",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: order.join(","),
    });
    return c.json({ ok: true, order });
  });

  api.post("/admin/categories", async (c) => {
    const body = await c.req.json<{ key?: string; label?: string }>();
    const key = sanitizeCategoryKey(body.key || body.label || "");
    if (!key || key.length < 2) {
      return c.json({ error: "کلید دسته باید حداقل ۲ حرف انگلیسی/عدد باشد (مثلاً vip2)" }, 400);
    }
    if (key === "cancel") return c.json({ error: "این کلید مجاز نیست" }, 400);
    const labels = await getCategoryLabels();
    if (labels[key] || (await getSalesCategories())[key] !== undefined) {
      // allow re-enable of existing
    }
    const label = (body.label?.trim() || key).slice(0, 40);
    labels[key] = label;
    await saveCategoryLabels(labels);
    const cats = await getSalesCategories();
    cats[key] = true;
    await saveSalesCategories(cats);
    await ensureCategoryInOrder(key);
    await auditLog({
      action: "web_category_create",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: key,
    });
    return c.json({ ok: true, key, label });
  });

  api.put("/admin/categories/:key", async (c) => {
    const key = sanitizeCategoryKey(c.req.param("key"));
    if (!key) return c.json({ error: "دسته نامعتبر" }, 400);
    const body = await c.req.json<{ label?: string; enabled?: boolean }>();
    if (body.label?.trim()) {
      const labels = await getCategoryLabels();
      labels[key] = body.label.trim().slice(0, 40);
      await saveCategoryLabels(labels);
    }
    if (typeof body.enabled === "boolean") {
      const cats = await getSalesCategories();
      cats[key] = body.enabled;
      await saveSalesCategories(cats);
    }
    return c.json({ ok: true });
  });

  /** Disable sales + deactivate price cells; remove custom key from settings. */
  api.delete("/admin/categories/:key", async (c) => {
    const key = sanitizeCategoryKey(c.req.param("key"));
    if (!key) return c.json({ error: "دسته نامعتبر" }, 400);
    const cats = await getSalesCategories();
    cats[key] = false;
    if (!(BUILTIN_CATEGORY_KEYS as readonly string[]).includes(key)) {
      delete cats[key];
    }
    await saveSalesCategories(cats);
    if (!(BUILTIN_CATEGORY_KEYS as readonly string[]).includes(key)) {
      const labels = await getCategoryLabels();
      delete labels[key];
      await saveCategoryLabels(labels);
      await removeCategoryFromOrder(key);
    }
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const res = await prisma.priceCell.updateMany({
      where: { tenantId, category: key, active: true },
      data: { active: false },
    });
    await auditLog({
      action: "web_category_delete",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: key,
      detail: `deactivated:${res.count}`,
    });
    return c.json({ ok: true, deactivated: res.count });
  });

  api.get("/admin/sales-categories", async (c) => c.json({ categories: await getSalesCategories() }));

  api.put("/admin/sales-categories", async (c) => {
    const body = await c.req.json<Record<string, boolean>>();
    const cats = await getSalesCategories();
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "boolean" && sanitizeCategoryKey(k) === k) cats[k] = v;
    }
    await saveSalesCategories(cats);
    return c.json({ categories: cats });
  });

  api.get("/admin/configs/groups", async (c) => c.json({ groups: await listConfigGroups() }));

  api.get("/admin/configs/sync-diff", async (c) => {
    try {
      return c.json(await diffPanelVsBot());
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/reconcile", async (c) => {
    try {
      const result = await reconcileSubscriptionsFromPanel();
      await auditLog({
        action: "admin_panel_reconcile",
        actorTelegramId: BigInt(c.get("telegramId")),
        detail: `updated:${result.updated} disabled:${result.disabledFromPanel} removed:${result.removedFromPanel} reactivated:${result.reactivated}`,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/full-sync", async (c) => {
    try {
      const result = await selectiveSync({
        direction: "panel_to_bot",
        options: [
          "newAccounts",
          "deletedAccounts",
          "name",
          "traffic",
          "expiry",
          "limitIp",
          "comment",
          "note",
        ],
      });
      await auditLog({
        action: "admin_panel_full_sync",
        actorTelegramId: BigInt(c.get("telegramId")),
        detail: `created:${result.created} deleted:${result.deleted} updated:${result.updated} errors:${result.errors}`,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/sync/apply", async (c) => {
    const body = await c.req
      .json<{ direction?: string; options?: string[] }>()
      .catch(() => ({} as { direction?: string; options?: string[] }));
    try {
      const result = await selectiveSync({
        direction: body.direction === "bot_to_panel" ? "bot_to_panel" : "panel_to_bot",
        options: (body.options ?? []) as Parameters<typeof selectiveSync>[0]["options"],
      });
      await auditLog({
        action: "admin_panel_sync_apply",
        actorTelegramId: BigInt(c.get("telegramId")),
        detail: `${result.direction} created:${result.created} deleted:${result.deleted} updated:${result.updated}`,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/configs/sync/undo-status", async (c) => {
    try {
      return c.json(await getSyncUndoStatus());
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/sync/undo", async (c) => {
    try {
      const result = await undoLastSync();
      await auditLog({
        action: "admin_panel_sync_undo",
        actorTelegramId: BigInt(c.get("telegramId")),
        detail: result.message,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/configs/bulk-adjust/preview", async (c) => {
    try {
      const panelServerId = c.req.query("panelServerId")?.trim() || null;
      const panelGroup = c.req.query("panelGroup")?.trim() || null;
      return c.json(await previewBulkAdjust({ panelServerId, panelGroup }));
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/bulk-adjust", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        panelServerId?: string | null;
        panelGroup?: string | null;
        inbounds?: { ids?: number[]; idsRaw?: string };
        limitIp?: { value?: number };
        addGb?: number;
        addDays?: number;
        clearExpiry?: boolean;
      };

      const input: BulkAdjustInput = {
        panelServerId: body.panelServerId?.trim() || null,
        panelGroup: body.panelGroup?.trim() || null,
        clearExpiry: Boolean(body.clearExpiry),
      };

      if (body.inbounds) {
        const ids =
          Array.isArray(body.inbounds.ids) && body.inbounds.ids.length
            ? body.inbounds.ids
            : parseBulkInboundIds(String(body.inbounds.idsRaw ?? ""));
        input.inbounds = { ids };
      }
      if (body.limitIp && body.limitIp.value != null) {
        input.limitIp = { value: Number(body.limitIp.value) };
      }
      if (body.addGb != null && Number(body.addGb) !== 0) input.addGb = Number(body.addGb);
      if (body.addDays != null && Number(body.addDays) !== 0) input.addDays = Number(body.addDays);

      const result = await bulkAdjustAllPanelClients(input);
      await auditLog({
        action: "admin_bulk_adjust",
        actorTelegramId: BigInt(c.get("telegramId")),
        detail: `updated:${result.updated} skipped:${result.skipped} errors:${result.errors} total:${result.clientCount}${input.panelGroup ? ` group:${input.panelGroup}` : ""}`,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/import", async (c) => {
    const body = await c.req.json<{ emails?: string[] }>().catch(() => ({ emails: undefined as string[] | undefined }));
    try {
      const result = await importPanelClientsToBot(body.emails);
      await auditLog({
        action: "admin_config_import",
        actorTelegramId: BigInt(c.get("telegramId")),
        detail: `imported:${result.imported} skipped:${result.skipped} failed:${result.failed.length}`,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/configs/detail", async (c) => {
    const email = c.req.query("email") || "";
    const subId = c.req.query("subId") || null;
    try {
      return c.json(await getConfigDetail({ email, subId }));
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.put("/admin/configs/update", async (c) => {
    const body = await c.req.json<{
      email: string;
      subId?: string | null;
      title?: string | null;
      note?: string | null;
      trafficGb?: number | null;
      expiresAt?: string | null;
      limitIp?: number;
      enable?: boolean;
    }>();
    try {
      const result = await updateConfig(body);
      await auditLog({
        action: "admin_config_update",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: body.email,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/rotate-sub", async (c) => {
    const body = await c.req.json<{ email?: string; subId?: string | null }>();
    const sub =
      (body.subId
        ? await prisma.subscription.findUnique({ where: { id: body.subId } })
        : null) ||
      (body.email
        ? await prisma.subscription.findFirst({ where: { email: body.email.trim() } })
        : null);
    if (!sub) return c.json({ error: "اکانت در دیتابیس ربات پیدا نشد" }, 404);
    try {
      const result = await rotateSubId(sub.id);
      await auditLog({
        action: "admin_rotate_sub",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: sub.email,
      });
      return c.json({ code: result.code, subUrl: result.subUrl, expiresAt: result.expiresAt.toISOString() });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/configs/refresh-from-panel", async (c) => {
    const body = await c.req.json<{ email?: string; subId?: string | null }>();
    const sub =
      (body.subId
        ? await prisma.subscription.findUnique({ where: { id: body.subId } })
        : null) ||
      (body.email
        ? await prisma.subscription.findFirst({ where: { email: body.email.trim() } })
        : null);
    if (!sub) return c.json({ error: "اکانت در دیتابیس ربات پیدا نشد" }, 404);
    try {
      const result = await refreshSubscriptionFromPanel(sub.id);
      await auditLog({
        action: "admin_config_refresh",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: result.email,
        detail: result.changed.length ? result.changed.join(",") : "no_change",
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/configs/renew", async (c) => {
    const subId = c.req.query("subId") || "";
    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    if (!sub) return c.json({ error: "سرویس پیدا نشد" }, 404);
    if (sub.isTest) return c.json({ error: "سرویس تست قابل تمدید نیست" }, 400);
    const category = await inferRenewCategory(sub);
    const labels = await getCategoryLabels();
    const maxMonths = await getMaxPurchaseMonths();
    return c.json({
      ok: true,
      message: "تمدید ادمین (بدون محدودیت اتمام)",
      subscription: {
        id: sub.id,
        code: sub.code,
        email: sub.email,
        trafficGb: sub.trafficGb,
        trafficLabel: formatTraffic(sub.trafficGb),
        expiresAt: sub.expiresAt.toISOString(),
      },
      category,
      categoryLabel: labels[category] || category,
      maxMonths,
      volumeRules: {
        data: { min: 10, max: 50, step: 5 },
        national: { min: 1, max: 20, step: 1 },
        unlimited: null,
      },
    });
  });

  api.post("/admin/configs/renew", async (c) => {
    const body = await c.req.json<{
      subId?: string;
      trafficGb?: number | null;
      months?: number;
      category?: string;
    }>();
    if (!body.subId) return c.json({ error: "subId لازم است" }, 400);
    try {
      const order = await createMatrixOrder({
        userId: c.get("userId"),
        trafficGb: body.trafficGb ?? null,
        months: Math.max(1, Number(body.months) || 1),
        category: body.category,
        accountName: "renew",
        kind: OrderKind.renew,
        targetSubId: body.subId,
        forceRenew: true,
      });
      const result = await provisionAdminComplimentary(order.id, c.get("userId"));
      await auditLog({
        action: "admin_renew",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: body.subId,
      });
      return c.json({
        ok: true,
        order: { id: order.id, price: order.price },
        provisioned: await provisionedJson(result),
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/configs/:groupKey", async (c) => {
    const page = Math.max(0, Number(c.req.query("page") ?? 0) || 0);
    const pageSize = Math.max(1, Math.min(100, Number(c.req.query("pageSize") ?? 30) || 30));
    const q = String(c.req.query("q") ?? "");
    const sortRaw = String(c.req.query("sort") ?? "newest");
    const sort: ConfigListSort =
      sortRaw === "oldest" ||
      sortRaw === "ending" ||
      sortRaw === "ending_date" ||
      sortRaw === "ending_traffic" ||
      sortRaw === "newest"
        ? sortRaw
        : "newest";

    async function enrich(item: Awaited<ReturnType<typeof listConfigsForGroup>>["items"][number]) {
      let usedTrafficBytes = 0;
      let trafficGb = item.trafficGb ?? null;
      let subUrl: string | null = null;
      if (item.subId) {
        const [traf, sub] = await Promise.all([
          getSubscriptionTrafficBytes(item.subId).catch(() => ({
            usedBytes: 0,
            totalBytes: 0,
            totalGb: item.trafficGb ?? null,
          })),
          prisma.subscription.findUnique({
            where: { id: item.subId },
            select: { subUrl: true },
          }),
        ]);
        usedTrafficBytes = traf.usedBytes;
        trafficGb = traf.totalGb ?? trafficGb;
        subUrl = sub?.subUrl ?? null;
      }
      return { ...item, usedTrafficBytes, trafficGb, subUrl };
    }

    if (sort === "ending" || sort === "ending_traffic") {
      // Need traffic on every row before sorting, then paginate
      const all = await listConfigsForGroup(c.req.param("groupKey"), 0, 0, q, "newest");
      const enriched: Awaited<ReturnType<typeof enrich>>[] = new Array(all.items.length);
      const concurrency = 8;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(concurrency, all.items.length || 1) }, async () => {
          for (;;) {
            const i = next++;
            if (i >= all.items.length) return;
            enriched[i] = await enrich(all.items[i]!);
          }
        }),
      );
      enriched.sort((a, b) => {
        if (sort === "ending_traffic") {
          const ua = endingUrgencyDays({
            expiresAt: null,
            usedBytes: a.usedTrafficBytes,
            totalGb: a.trafficGb,
          });
          const ub = endingUrgencyDays({
            expiresAt: null,
            usedBytes: b.usedTrafficBytes,
            totalGb: b.trafficGb,
          });
          if (ua !== ub) return ua - ub;
          return a.email.localeCompare(b.email);
        }
        const ua = endingUrgencyDays({
          expiresAt: a.expiresAt,
          usedBytes: a.usedTrafficBytes,
          totalGb: a.trafficGb,
        });
        const ub = endingUrgencyDays({
          expiresAt: b.expiresAt,
          usedBytes: b.usedTrafficBytes,
          totalGb: b.trafficGb,
        });
        if (ua !== ub) return ua - ub;
        const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        return ea - eb || a.email.localeCompare(b.email);
      });
      const total = enriched.length;
      const items = enriched.slice(page * pageSize, page * pageSize + pageSize);
      return c.json({ title: all.title, total, items, pageSize });
    }

    const result = await listConfigsForGroup(c.req.param("groupKey"), page, pageSize, q, sort);
    const items = await Promise.all(result.items.map((item) => enrich(item)));
    return c.json({ ...result, items });
  });

  api.post("/admin/configs/delete", async (c) => {
    const body = await c.req.json<{ email: string; subId?: string | null }>();
    const result = await deleteConfig({
      email: body.email,
      subId: body.subId,
      actorTelegramId: BigInt(c.get("telegramId")),
    });
    await auditLog({
      action: "admin_config_delete",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: body.email,
      detail: `panel=${result.deletedPanel} db=${result.deletedDb}${result.archiveId ? ` archive=${result.archiveId}` : ""}`,
    });
    return c.json(result);
  });

  api.get("/admin/panels", async (c) => {
    const repaired = await repairPanelSubBases();
    const panels = await listPanelServers();
    const envSnap = envPanelSnapshot();
    return c.json({
      panels: panels.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        hasToken: Boolean(p.apiToken),
        inboundIds: p.inboundIds,
        subBase: sanitizeSubBase(p.subBase),
        categories: parsePanelCategories(p.categories),
        weight: p.weight,
        active: p.active,
        sellEnabled: p.sellEnabled,
      })),
      envPanel: envSnap
        ? {
            name: envSnap.name,
            baseUrl: envSnap.baseUrl,
            hasToken: Boolean(envSnap.apiToken),
            inboundIds: envSnap.inboundIds,
            subBase: envSnap.subBase,
            subBaseWasContaminated: envSnap.subBaseWasContaminated,
          }
        : null,
      subBaseRepaired: repaired.fixed,
    });
  });

  api.post("/admin/panels/import-env", async (c) => {
    try {
      const p = await importPanelFromEnv();
      return c.json({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/panels", async (c) => {
    const body = await c.req.json<{
      name: string;
      baseUrl: string;
      apiToken: string;
      inboundIds?: string;
      subBase?: string | null;
      categories?: string[];
      weight?: number;
    }>();
    const p = await createPanelServer(body);
    return c.json({ id: p.id });
  });

  api.put("/admin/panels/:id", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Parameters<typeof updatePanelServer>[1] = {};
    for (const k of ["name", "baseUrl", "apiToken", "inboundIds", "subBase", "weight", "active", "sellEnabled"] as const) {
      if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
    }
    if (body.categories) patch.categories = body.categories as string[];
    await updatePanelServer(c.req.param("id"), patch);
    return c.json({ ok: true });
  });

  api.delete("/admin/panels/:id", async (c) => {
    try {
      await deletePanelServer(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/panels/:id/test", async (c) => {
    const panel = await getPanelServer(c.req.param("id"));
    if (!panel) return c.json({ error: "Not found" }, 404);
    try {
      return c.json(await testPanelConnection(panel));
    } catch (err) {
      return c.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/admin/import", async (c) => {
    const buf = Buffer.from(await c.req.arrayBuffer());
    const result = await importWorkbook(readWorkbookFromBuffer(buf));
    return c.json({ result, text: formatImportResult(result) });
  });

  api.post("/admin/import/inspect", async (c) => {
    const buf = Buffer.from(await c.req.arrayBuffer());
    const inspect = inspectWorkbook(readWorkbookFromBuffer(buf));
    return c.json({ inspect });
  });

  api.get("/admin/export.xlsx", async (c) => {
    const buf = await exportWorkbookBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    c.header("Content-Disposition", `attachment; filename="quadtwo-export-${stamp}.xlsx"`);
    return c.body(new Uint8Array(buf));
  });

  api.get("/admin/users", async (c) => {
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const role = c.req.query("role");
    const users = await prisma.user.findMany({
      where: { tenantId, ...(role ? { role: role as UserRole } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { wallet: true, priceOverride: true },
    });
    return c.json({
      users: users.map((u) => ({
        id: u.id,
        telegramId: String(u.telegramId),
        username: u.username,
        firstName: u.firstName,
        role: u.role,
        agentName: u.agentName,
        panelGroup: u.panelGroup,
        balance: u.wallet?.balance ?? 0,
        hasPassword: Boolean(u.passwordHash),
        discountCodesAllowed: u.discountCodesAllowed,
        discountMaxPercent: u.discountMaxPercent,
        priceOverride: u.priceOverride
          ? {
              category: u.priceOverride.category,
              perGb: u.priceOverride.perGb,
              perMonth: u.priceOverride.perMonth,
              unlimitedPerMonth: u.priceOverride.unlimitedPerMonth,
              partnerPricePercent: u.priceOverride.partnerPricePercent,
              note: u.priceOverride.note,
            }
          : null,
      })),
    });
  });

  api.get("/admin/users/:id", async (c) => {
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const user = await prisma.user.findFirst({
      where: { id: c.req.param("id"), tenantId },
      include: {
        wallet: { include: { txs: { orderBy: { createdAt: "desc" }, take: 20 } } },
        subscriptions: { orderBy: { createdAt: "desc" }, take: 20 },
        orders: { orderBy: { createdAt: "desc" }, take: 20 },
        priceOverride: true,
      },
    });
    if (!user) return c.json({ error: "کاربر پیدا نشد" }, 404);
    return c.json({
      user: {
        id: user.id,
        telegramId: String(user.telegramId),
        username: user.username,
        firstName: user.firstName,
        role: user.role,
        agentName: user.agentName,
        panelGroup: user.panelGroup,
        balance: user.wallet?.balance ?? 0,
        discountCodesAllowed: user.discountCodesAllowed,
        discountMaxPercent: user.discountMaxPercent,
        createdAt: user.createdAt.toISOString(),
        priceOverride: user.priceOverride
          ? {
              category: user.priceOverride.category,
              perGb: user.priceOverride.perGb,
              perMonth: user.priceOverride.perMonth,
              unlimitedPerMonth: user.priceOverride.unlimitedPerMonth,
              partnerPricePercent: user.priceOverride.partnerPricePercent,
              note: user.priceOverride.note,
            }
          : null,
      },
      txs: (user.wallet?.txs ?? []).map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
      subscriptions: user.subscriptions.map((s) => ({
        id: s.id,
        code: s.code,
        email: s.email,
        status: s.status,
        trafficGb: s.trafficGb,
        expiresAt: s.expiresAt.toISOString(),
      })),
      orders: user.orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        price: o.price,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  });

  /** Per-agent discount: allow codes + max percent (partner / reseller / wholesale). */
  api.patch("/admin/users/:id/discount", async (c) => {
    const body = await c.req.json<{
      discountCodesAllowed?: boolean;
      discountMaxPercent?: number;
    }>();
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const target = await prisma.user.findFirst({ where: { id: c.req.param("id"), tenantId } });
    if (!target) return c.json({ error: "کاربر پیدا نشد" }, 404);
    const isAgent =
      target.role === UserRole.partner ||
      target.role === UserRole.wholesale ||
      target.role === UserRole.reseller;
    if (!isAgent) {
      return c.json({ error: "تنظیم کد تخفیف فقط برای نمایندگان است" }, 400);
    }

    const data: { discountCodesAllowed?: boolean; discountMaxPercent?: number } = {};
    if (typeof body.discountCodesAllowed === "boolean") {
      data.discountCodesAllowed = body.discountCodesAllowed;
    }
    if (body.discountMaxPercent !== undefined) {
      const n = Math.floor(Number(body.discountMaxPercent));
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        return c.json({ error: "درصد باید بین ۱ تا ۱۰۰ باشد" }, 400);
      }
      data.discountMaxPercent = n;
    }
    if (!Object.keys(data).length) {
      return c.json({ error: "هیچ تغییری ارسال نشد" }, 400);
    }

    const updated = await prisma.user.update({ where: { id: target.id }, data });
    await auditLog({
      action: "web_user_discount",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: target.id,
      detail: JSON.stringify(data),
    });
    return c.json({
      ok: true,
      user: {
        id: updated.id,
        discountCodesAllowed: updated.discountCodesAllowed,
        discountMaxPercent: updated.discountMaxPercent,
      },
    });
  });

  /** Per-agent custom rates / matrix percent override. */
  api.put("/admin/users/:id/price-override", async (c) => {
    const body = await c.req.json<{
      category?: string;
      perGb?: number | null;
      perMonth?: number | null;
      unlimitedPerMonth?: number | null;
      partnerPricePercent?: number | null;
      note?: string | null;
      clear?: boolean;
    }>();
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const target = await prisma.user.findFirst({ where: { id: c.req.param("id"), tenantId } });
    if (!target) return c.json({ error: "کاربر پیدا نشد" }, 404);
    const isAgent =
      target.role === UserRole.partner ||
      target.role === UserRole.wholesale ||
      target.role === UserRole.reseller;
    if (!isAgent) {
      return c.json({ error: "قیمت اختصاصی فقط برای نمایندگان است" }, 400);
    }

    if (body.clear) {
      await prisma.agentPriceOverride.deleteMany({ where: { userId: target.id } });
      await auditLog({
        action: "agent_price_override_clear",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: target.id,
      });
      return c.json({ ok: true, priceOverride: null });
    }

    const percent =
      body.partnerPricePercent == null
        ? 100
        : Math.max(1, Math.min(200, Math.floor(Number(body.partnerPricePercent))));
    const numOrNull = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const row = await prisma.agentPriceOverride.upsert({
      where: { userId: target.id },
      create: {
        tenantId,
        userId: target.id,
        category: (body.category || "").trim().toLowerCase(),
        perGb: numOrNull(body.perGb),
        perMonth: numOrNull(body.perMonth),
        unlimitedPerMonth: numOrNull(body.unlimitedPerMonth),
        partnerPricePercent: percent,
        note: body.note?.trim() || null,
      },
      update: {
        category: body.category !== undefined ? (body.category || "").trim().toLowerCase() : undefined,
        perGb: body.perGb !== undefined ? numOrNull(body.perGb) : undefined,
        perMonth: body.perMonth !== undefined ? numOrNull(body.perMonth) : undefined,
        unlimitedPerMonth:
          body.unlimitedPerMonth !== undefined ? numOrNull(body.unlimitedPerMonth) : undefined,
        partnerPricePercent: body.partnerPricePercent !== undefined ? percent : undefined,
        note: body.note !== undefined ? body.note?.trim() || null : undefined,
      },
    });
    await auditLog({
      action: "agent_price_override",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: target.id,
      detail: JSON.stringify({
        perGb: row.perGb,
        perMonth: row.perMonth,
        unlimitedPerMonth: row.unlimitedPerMonth,
        partnerPricePercent: row.partnerPricePercent,
      }),
    });
    return c.json({
      ok: true,
      priceOverride: {
        category: row.category,
        perGb: row.perGb,
        perMonth: row.perMonth,
        unlimitedPerMonth: row.unlimitedPerMonth,
        partnerPricePercent: row.partnerPricePercent,
        note: row.note,
      },
    });
  });

  api.post("/admin/users/:id/role", async (c) => {
    const body = await c.req.json<{ role: UserRole }>();
    if (!["user", "partner", "wholesale", "reseller", "admin"].includes(body.role)) {
      return c.json({ error: "نقش نامعتبر" }, 400);
    }
    const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
    const tenantId = await resolveTenantIdOrPlatform();
    const target = await prisma.user.findFirst({ where: { id: c.req.param("id"), tenantId } });
    if (!target) return c.json({ error: "کاربر پیدا نشد" }, 404);

    const wasSeller =
      target.role === UserRole.partner ||
      target.role === UserRole.wholesale ||
      target.role === UserRole.reseller;
    const becomingSeller =
      body.role === "partner" || body.role === "wholesale" || body.role === "reseller";

    if (body.role === "user" && wasSeller) {
      await demoteToUser(target.id);
    } else if (becomingSeller && !wasSeller) {
      const defaultPct = await getDefaultAgentDiscountMaxPercent();
      await prisma.user.update({
        where: { id: target.id },
        data: {
          role: body.role,
          discountCodesAllowed: true,
          discountMaxPercent: defaultPct,
        },
      });
    } else {
      await prisma.user.update({ where: { id: target.id }, data: { role: body.role } });
    }

    await auditLog({
      action: "web_role_change",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: target.id,
      detail: `${target.role} -> ${body.role}`,
    });

    if (body.role === "user" && wasSeller) {
      const { notifyTelegramWithMainMenu } = await import("../services/push-main-menu.js");
      void notifyTelegramWithMainMenu(
        target.telegramId,
        "اطلاع: همکاری شما پایان یافت و حساب به مشتری عادی تبدیل شد.",
      );
    } else if (becomingSeller) {
      const { notifyTelegramWithMainMenu } = await import("../services/push-main-menu.js");
      const label =
        body.role === "wholesale" ? "عمده‌فروش" : body.role === "reseller" ? "همکار ویژه" : "همکار";
      void notifyTelegramWithMainMenu(
        target.telegramId,
        `اطلاع: نقش شما به «${label}» تغییر کرد.\nمنوی پایین به‌روز شد.`,
      );
    }

    return c.json({ ok: true });
  });

  /** Explicit demote partner/wholesale → regular user (clears agent name + panel group). */
  api.post("/admin/users/:id/demote", async (c) => {
    try {
      const updated = await demoteToUser(c.req.param("id"));
      await auditLog({
        action: "web_partner_demote",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: updated.id,
        detail: "partner/wholesale -> user",
      });
      const { notifyTelegramWithMainMenu } = await import("../services/push-main-menu.js");
      void notifyTelegramWithMainMenu(
        updated.telegramId,
        "اطلاع: همکاری شما پایان یافت و حساب به مشتری عادی تبدیل شد.",
      );
      return c.json({
        ok: true,
        user: {
          id: updated.id,
          role: updated.role,
          agentName: updated.agentName,
          panelGroup: updated.panelGroup,
        },
      });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  /** Manual wallet adjustment: positive = credit, negative = debit. */
  api.post("/admin/users/:id/wallet", async (c) => {
    const body = await c.req.json<{ amount?: number; note?: string }>();
    const amount = Math.trunc(Number(body.amount ?? 0));
    if (!amount) return c.json({ error: "مبلغ نامعتبر" }, 400);
    try {
      const balance = await adjustWallet(c.req.param("id"), amount, body.note?.trim() || undefined);
      await auditLog({
        action: "web_wallet_adjust",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: c.req.param("id"),
        detail: String(amount),
      });
      const target = await prisma.user.findUnique({ where: { id: c.req.param("id") } });
      if (target) {
        await notifyTelegram(
          target.telegramId,
          amount > 0
            ? `💳 کیف پول شما ${formatToman(amount)} شارژ شد.\nموجودی: ${formatToman(balance)}`
            : `💳 ${formatToman(-amount)} از کیف پول شما کسر شد.\nموجودی: ${formatToman(balance)}`,
        );
      }
      return c.json({ ok: true, balance });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/settings", async (c) => c.json({ settings: await getAllSettings() }));

  api.get("/admin/notifications", async (c) => {
    const cfg = await getNotifConfig();
    const base = defaultNotifConfig();
    return c.json({
      config: {
        expiryDays: { ...base.expiryDays, ...cfg.expiryDays },
        traffic: { ...base.traffic, ...cfg.traffic },
        preDelete: { ...base.preDelete, ...cfg.preDelete },
        deleted: { ...base.deleted, ...cfg.deleted },
      } satisfies NotifConfig,
    });
  });

  api.put("/admin/notifications", async (c) => {
    const body = await c.req.json<Partial<NotifConfig>>();
    const base = defaultNotifConfig();
    const cur = await getNotifConfig();
    const next: NotifConfig = {
      expiryDays: {
        enabled: typeof body.expiryDays?.enabled === "boolean" ? body.expiryDays.enabled : (cur.expiryDays?.enabled ?? base.expiryDays.enabled),
        hours: Math.max(1, Math.min(720, Number(body.expiryDays?.hours ?? cur.expiryDays?.hours ?? base.expiryDays.hours) || base.expiryDays.hours)),
      },
      traffic: {
        enabled: typeof body.traffic?.enabled === "boolean" ? body.traffic.enabled : (cur.traffic?.enabled ?? base.traffic.enabled),
        megabytes: Math.max(1, Math.min(50_000, Number(body.traffic?.megabytes ?? cur.traffic?.megabytes ?? base.traffic.megabytes) || base.traffic.megabytes)),
      },
      preDelete: {
        enabled: typeof body.preDelete?.enabled === "boolean" ? body.preDelete.enabled : (cur.preDelete?.enabled ?? base.preDelete.enabled),
        hours: Math.max(1, Math.min(720, Number(body.preDelete?.hours ?? cur.preDelete?.hours ?? base.preDelete.hours) || base.preDelete.hours)),
      },
      deleted: {
        enabled: typeof body.deleted?.enabled === "boolean" ? body.deleted.enabled : (cur.deleted?.enabled ?? base.deleted.enabled),
      },
    };
    await saveNotifConfig(next);
    await auditLog({
      action: "setting_changed",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: "notif_config",
    });
    return c.json({ ok: true, config: next });
  });

  api.get("/admin/channels", async (c) => {
    const channels = await getChannels();
    return c.json({
      channels,
      forceMembership: channels.length
        ? channels.some((x) => x.required)
        : (await getSetting("channel_required")) === "true",
    });
  });

  api.put("/admin/channels", async (c) => {
    const body = await c.req.json<{
      channels?: ChannelConfig[];
      forceMembership?: boolean;
    }>();
    let channels = Array.isArray(body.channels) ? body.channels : await getChannels();
    channels = channels
      .map((ch) => ({
        username: String(ch.username || "")
          .replace(/^@/, "")
          .trim(),
        required: Boolean(ch.required),
      }))
      .filter((ch) => ch.username.length > 0);

    if (typeof body.forceMembership === "boolean") {
      if (channels.length) {
        channels = channels.map((ch) => ({ ...ch, required: body.forceMembership! }));
      } else {
        await setSetting("channel_required", body.forceMembership ? "true" : "false");
      }
    }

    await saveChannels(channels);
    const saved = await getChannels();
    await auditLog({
      action: "setting_changed",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: `channels n=${saved.length}`,
    });
    return c.json({
      channels: saved,
      forceMembership: saved.length
        ? saved.some((x) => x.required)
        : (await getSetting("channel_required")) === "true",
    });
  });

  api.get("/admin/backup", async (c) => {
    const config = await getBackupConfig();
    const files = await listBackupFiles(12);
    return c.json({ config, files });
  });

  api.put("/admin/backup", async (c) => {
    const body = await c.req.json<Partial<BackupConfig>>();
    const current = await getBackupConfig();
    const next: BackupConfig = {
      ...current,
      enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
      hour: Number.isFinite(Number(body.hour)) ? Math.min(23, Math.max(0, Math.floor(Number(body.hour)))) : current.hour,
      minute: Number.isFinite(Number(body.minute))
        ? Math.min(59, Math.max(0, Math.floor(Number(body.minute))))
        : current.minute,
    };
    await saveBackupConfig(next);
    await auditLog({
      action: "setting_changed",
      actorTelegramId: BigInt(c.get("telegramId")),
      detail: `backup enabled=${next.enabled} at ${next.hour}:${next.minute}`,
    });
    const files = await listBackupFiles(12);
    return c.json({ config: next, files });
  });

  api.post("/admin/backup/send", async (c) => {
    const bot = createTelegramBot(env.BOT_TOKEN);
    const r = await sendBackupToAdmins(bot.api, { reason: "درخواست دستی از پنل وب" });
    if (r.ok) {
      await auditLog({
        action: "backup_sent",
        actorTelegramId: BigInt(c.get("telegramId")),
        target: r.name,
        detail: `sent=${r.sent} web`,
      });
    }
    return c.json(r);
  });

  api.post("/admin/backup/inspect", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "فایل پشتیبان را انتخاب کنید" }, 400);
    }
    const name = (file.name || "").toLowerCase();
    if (name && !name.endsWith(".db") && !name.endsWith(".sqlite") && !name.endsWith(".sqlite3")) {
      return c.json({ error: "فرمت باید .db باشد" }, 400);
    }
    if (file.size > 80 * 1024 * 1024) {
      return c.json({ error: "حجم فایل بیش از حد مجاز است" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await inspectBackupBuffer(buf);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result);
  });

  api.post("/admin/backup/restore", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "فایل پشتیبان را انتخاب کنید" }, 400);
    }
    const name = (file.name || "").toLowerCase();
    if (name && !name.endsWith(".db") && !name.endsWith(".sqlite") && !name.endsWith(".sqlite3")) {
      return c.json({ error: "فرمت باید .db باشد" }, 400);
    }
    if (file.size > 80 * 1024 * 1024) {
      return c.json({ error: "حجم فایل بیش از حد مجاز است" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await restoreDatabaseFromBackupBuffer(buf);
    if (!result.ok) return c.json({ error: result.error }, 400);
    await auditLog({
      action: "backup_restored",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: file.name || "backup.db",
      detail: `safety=${result.safetyName} web`,
    });
    // Restart so Prisma reconnects to the swapped SQLite file
    setTimeout(() => process.exit(0), 1200);
    return c.json({
      ok: true,
      safetyName: result.safetyName,
      size: result.size,
      message: "بازیابی انجام شد. سرور در حال ری‌استارت است.",
    });
  });

  api.put("/admin/settings", async (c) => {
    const body = await c.req.json<Record<string, string>>();
    for (const [k, v] of Object.entries(body)) {
      if (k === "emoji_style") {
        const style = v === "premium" ? "premium" : "universal";
        await setSetting("emoji_style", style);
        clearEmojiStyleCache();
        continue;
      }
      if (k === "pricing_modes_json") {
        try {
          const parsed = JSON.parse(String(v)) as Partial<RolePricingModes>;
          const current = await getPricingModes();
          await savePricingModes({
            user: parsed.user === "rate" || parsed.user === "matrix" ? parsed.user : current.user,
            partner:
              parsed.partner === "rate" || parsed.partner === "matrix" ? parsed.partner : current.partner,
            reseller:
              parsed.reseller === "rate" || parsed.reseller === "matrix"
                ? parsed.reseller
                : parsed.wholesale === "rate" || parsed.wholesale === "matrix"
                  ? parsed.wholesale
                  : current.reseller,
            wholesale:
              parsed.reseller != null
                ? parsed.wholesale === "rate" || parsed.wholesale === "matrix"
                  ? parsed.wholesale
                  : current.wholesale
                : current.wholesale,
          });
        } catch {
          /* ignore bad json */
        }
        continue;
      }
      if (k === "pricing_mode") {
        await savePricingModes({
          user: v === "rate" ? "rate" : "matrix",
          partner: v === "rate" ? "rate" : "matrix",
          reseller: v === "rate" ? "rate" : "matrix",
          wholesale: v === "rate" ? "rate" : "matrix",
        });
        continue;
      }
      if (k === "payment_methods_json") {
        try {
          const parsed = JSON.parse(String(v)) as PaymentMethodsConfig;
          await savePaymentMethodsConfig({
            ...defaultPaymentMethodsConfig(),
            ...parsed,
            card: { enabled: parsed.card?.enabled !== false },
            wallet: { enabled: parsed.wallet?.enabled !== false },
            online: {
              enabled: Boolean(parsed.online?.enabled),
              provider: parsed.online?.provider ?? null,
            },
            crypto: {
              enabled: Boolean(parsed.crypto?.enabled),
              asset: parsed.crypto?.asset || "USDT",
              network: parsed.crypto?.network || "TRC20",
              address: parsed.crypto?.address || "",
              note: parsed.crypto?.note || "",
            },
          });
        } catch {
          /* ignore bad json */
        }
        continue;
      }
      if (k === "price_rates_json") {
        try {
          const parsed = JSON.parse(String(v)) as PriceRates;
          await savePriceRates(parsed);
        } catch {
          /* ignore */
        }
        continue;
      }
      if (k === "ui_skin") {
        await setSetting("ui_skin", v === "studio" ? "studio" : "classic");
        continue;
      }
      if (k === "ui_color_mode") {
        const mode =
          v === "light" || v === "dark" || v === "system" || v === "telegram" ? v : "system";
        await setSetting("ui_color_mode", mode);
        continue;
      }
      await setSetting(k, String(v));
    }
    return c.json({ ok: true, settings: await getAllSettings() });
  });

  api.get("/admin/partners/pending", async (c) => {
    const rows = await listPendingPartnerRequests();
    return c.json({
      requests: rows.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        phone: r.phone,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        user: {
          id: r.user.id,
          telegramId: String(r.user.telegramId),
          username: r.user.username,
          firstName: r.user.firstName,
          role: r.user.role,
        },
      })),
    });
  });

  api.post("/admin/partners/:id/approve", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { asRole?: string };
    const asRole =
      body.asRole === "reseller"
        ? "reseller"
        : body.asRole === "wholesale"
          ? "wholesale"
          : "partner";
    const req = await approvePartner(c.req.param("id"), asRole);
    await auditLog({
      action: "partner_approved",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: req.id,
      detail: asRole,
    });
    const status =
      asRole === "reseller"
        ? `همکار ویژه تأیید شد — گروه پنل: ${req.user.panelGroup ?? "reseller_…"}`
        : asRole === "wholesale"
          ? `عمده‌فروش تأیید شد — گروه پنل: ${req.user.panelGroup ?? "wholesale_…"}`
          : `همکار تأیید شد — گروه پنل: ${req.user.panelGroup ?? "partner_…"}`;
    const { notifyTelegramWithMainMenu } = await import("../services/push-main-menu.js");
    void notifyTelegramWithMainMenu(
      req.user.telegramId,
      asRole === "reseller"
        ? "✅ به‌عنوان همکار ویژه تأیید شدید.\nمنوی پایین به‌روز شد."
        : asRole === "wholesale"
          ? "✅ به‌عنوان عمده‌فروش تأیید شدید.\nمنوی پایین به‌روز شد — از «خرید سرویس جدید» پلن‌های عمده را ببینید."
          : "✅ درخواست همکاری شما تأیید شد (همکار).\nمنوی پایین به‌روز شد.",
    );
    const { finalizeAdminReviewMessages } = await import("../services/admin-review-sync.js");
    void finalizeAdminReviewMessages("partner", req.id, status);
    return c.json({ ok: true, group: req.user.panelGroup, role: asRole });
  });

  api.post("/admin/partners/:id/reject", async (c) => {
    const id = c.req.param("id");
    const req = await rejectPartner(id);
    await auditLog({
      action: "partner_rejected",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: req.id,
    });
    const { notifyTelegramWithMainMenu } = await import("../services/push-main-menu.js");
    void notifyTelegramWithMainMenu(req.user.telegramId, "❌ درخواست همکاری رد شد.");
    const { finalizeAdminReviewMessages } = await import("../services/admin-review-sync.js");
    void finalizeAdminReviewMessages("partner", id, "درخواست رد شد.");
    return c.json({ ok: true });
  });
}

export async function mintOtpPayloadForTelegramUser(telegramId: number) {
  const { resolveTenantIdOrPlatform } = await import("../services/tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();
  const user = await prisma.user.findUnique({
    where: { tenantId_telegramId: { tenantId, telegramId: BigInt(telegramId) } },
  });
  if (!user) throw new Error("کاربر یافت نشد — /start بزنید");
  const code = await issueOtpForUser(user.id);
  return { code, login: user.username ? `@${user.username}` : String(user.telegramId) };
}
