import { Hono } from "hono";
import { OrderKind, UserRole } from "@prisma/client";
import { signSession } from "../auth/telegram.js";
import { isDemoMode } from "../services/license.js";
import { effectiveRole, demoRoleLabel, setDemoRole, parseDemoRole } from "../services/demo-role.js";
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
} from "../services/orders.js";
import { listPriceMatrix, normalizePurchaseTraffic, resolvePrice, upsertPriceCell, type PlanCategory } from "../services/pricing.js";
import { provisionOrder, rotateSubId, rotateUuid } from "../services/provision.js";
import {
  getAllSettings,
  getCategoryLabels,
  getChannels,
  getMaxPurchaseMonths,
  getPaymentCard,
  getPriceRates,
  getPricingModeForRole,
  getPricingModes,
  getSalesCategories,
  getSetting,
  getWebSessionHours,
  getDefaultLimitIp,
  canEditLimitIp,
  listEnabledSalesCategories,
  saveCategoryLabels,
  saveChannels,
  savePriceRates,
  savePricingModes,
  saveSalesCategories,
  sanitizeCategoryKey,
  BUILTIN_CATEGORY_KEYS,
  setSetting,
  type ChannelConfig,
  type PriceRates,
  type RolePricingModes,
} from "../services/settings.js";
import { getBackupConfig, saveBackupConfig, sendBackupToAdmins, type BackupConfig } from "../services/backup.js";
import { Bot } from "grammy";
import { adjustWallet, getWallet } from "../services/wallet.js";
import { claimTestService } from "../services/test-service.js";
import { approvePartner, demoteToUser, rejectPartner, submitPartnerRequest } from "../services/users.js";
import { formatTraffic, formatToman } from "../utils/format.js";
import { adminSalesReport, searchUsersAndOrders } from "../services/admin-reports.js";
import { listConfigGroups, listConfigsForGroup, deleteConfig, getConfigDetail, updateConfig, diffPanelVsBot, importPanelClientsToBot, reconcileSubscriptionsFromPanel, endingUrgencyDays } from "../services/admin-configs.js";
import {
  createPanelServer,
  getPanelServer,
  listPanelServers,
  parsePanelCategories,
  testPanelConnection,
  updatePanelServer,
} from "../services/panel-servers.js";
import { listRecentAudit, auditLog } from "../services/audit.js";
import { lookupConfigByLinkOrUuid } from "../services/config-lookup.js";
import { importWorkbook, readWorkbookFromBuffer, formatImportResult } from "../services/bulk-import.js";
import { getSubscriptionTrafficBytes } from "../services/live-status.js";
import { checkRenewEligibility, inferRenewCategory } from "../services/renew-eligibility.js";
import { dashBaseUrl, env } from "../config/env.js";
import { clearEmojiStyleCache, attachPremiumTextEntities, getEmojiStyle } from "../services/emoji-transform.js";

type Vars = { userId: string; role: string; telegramId: string };

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
    },
  };
}

export function registerDashAuthRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/auth/meta", async (c) => {
    const brand = await getSetting("brand_name");
    return c.json({
      brand: brand || "پیـنگ",
      dashUrl: dashBaseUrl(),
      authModes: ["password", "otp", "passkey"],
      passkeyHint: "ورود با Face ID / اثرانگشت (Passkey)",
      demoMode: isDemoMode(),
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
    try {
      const { options, challengeId } = await beginPasskeyAuthentication(body.login);
      return c.json({ options, challengeId });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/auth/passkey/verify", async (c) => {
    const body = await c.req.json<{ response?: unknown; challengeId?: string }>();
    if (!body.response) return c.json({ error: "response لازم است" }, 400);
    try {
      const { userId } = await finishPasskeyAuthentication(
        body.response as Parameters<typeof finishPasskeyAuthentication>[0],
        body.challengeId,
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
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const wallet = await getWallet(userId);
    const subs = await prisma.subscription.count({ where: { userId } });
    const active = await prisma.subscription.count({ where: { userId, status: "active" } });
    const brand = await getSetting("brand_name");
    const support = await getSetting("support_username");
    const passkeyCount = await userPasskeyCount(userId);
    const role = c.get("role") || effectiveRole(user.telegramId, user.role);
    return c.json({
      brand: brand || "پیـنگ",
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
      },
      wallet: { balance: wallet.balance },
      stats: { subscriptions: subs, active },
    });
  });

  api.post("/me/demo-role", async (c) => {
    if (!isDemoMode()) return c.json({ error: "Demo mode is off" }, 400);
    const body = await c.req.json<{ role?: string }>();
    const role = parseDemoRole(body.role);
    if (!role) return c.json({ error: "role must be user|partner|wholesale|admin" }, 400);
    setDemoRole(c.get("telegramId"), role);
    return c.json({ ok: true, role, label: demoRoleLabel(role) });
  });

  api.get("/me/passkeys", async (c) => {
    return c.json({ passkeys: await listUserPasskeys(c.get("userId")) });
  });

  api.post("/me/passkeys/register/options", async (c) => {
    try {
      const options = await beginPasskeyRegistration(c.get("userId"));
      return c.json({ options });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.post("/me/passkeys/register/verify", async (c) => {
    const body = await c.req.json<{ response?: unknown; label?: string }>();
    if (!body.response) return c.json({ error: "response لازم است" }, 400);
    try {
      await finishPasskeyRegistration(
        c.get("userId"),
        body.response as Parameters<typeof finishPasskeyRegistration>[1],
        body.label,
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

  api.get("/me/subscriptions", async (c) => {
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

  api.post("/me/subscriptions/:id/rotate-uuid", async (c) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), userId: c.get("userId") },
    });
    if (!sub) return c.json({ error: "Not found" }, 404);
    const result = await rotateUuid(sub.id);
    return c.json({ code: result.code, subUrl: result.subUrl, expiresAt: result.expiresAt.toISOString() });
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
    const cats = await listEnabledSalesCategories();
    const labels = await getCategoryLabels();
    const maxMonths = await getMaxPurchaseMonths();
    const cells = await listPriceMatrix();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const pricingMode = await getPricingModeForRole(user.role);
    const defaultLimitIp = await getDefaultLimitIp();
    const priced = await Promise.all(
      cells
        .filter((cell) => cell.active && cell.months <= maxMonths)
        .filter((cell) => cats.includes(cell.category))
        .map(async (cell) => {
          const resolved = await resolvePrice(user, cell.trafficGb, cell.months, cell.category);
          return {
            id: cell.id,
            category: cell.category,
            trafficGb: cell.trafficGb,
            months: cell.months,
            title: cell.title,
            isGolden: cell.isGolden,
            price: resolved?.price ?? null,
          };
        }),
    );

    if (cats.includes("unlimited")) {
      const haveMonths = new Set(
        priced.filter((p) => p.category === "unlimited" && p.price != null).map((p) => p.months),
      );
      for (let months = 1; months <= maxMonths; months++) {
        if (haveMonths.has(months)) continue;
        const resolved = await resolvePrice(user, null, months, "unlimited");
        if (!resolved) continue;
        priced.push({
          id: `rate-unlimited-${months}`,
          category: "unlimited",
          trafficGb: null,
          months,
          title: null,
          isGolden: false,
          price: resolved.price,
        });
      }
    }

    return c.json({
      pricingMode,
      categories: cats,
      categoryLabels: labels,
      maxMonths,
      defaultLimitIp,
      canEditLimitIp: canEditLimitIp(user.role),
      volumeRules: {
        data: { min: 10, max: 50, step: 5 },
        national: { min: 1, max: 20, step: 1 },
        unlimited: null,
      },
      cells: priced.filter((cell) => cell.price != null),
    });
  });

  api.post("/me/quote", async (c) => {
    const body = await c.req.json<{ trafficGb?: number | null; months?: number; category?: string }>();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const category = body.category || "data";
    const trafficGb = normalizePurchaseTraffic(category, body.trafficGb ?? null);
    const priced = await resolvePrice(
      user,
      trafficGb,
      Math.max(1, Number(body.months) || 1),
      category,
    );
    if (!priced) return c.json({ error: "این ترکیب قیمت‌گذاری نشده است" }, 400);
    return c.json({ price: priced.price, mode: priced.mode, trafficGb });
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

  api.post("/me/wallet/charge", async (c) => {
    const body = await c.req.json<{ amount?: number; note?: string }>();
    const amount = Math.floor(Number(body.amount ?? 0));
    if (!amount || amount < 10_000) return c.json({ error: "حداقل شارژ ۱۰٬۰۰۰ تومان است" }, 400);
    try {
      const order = await createWalletChargeOrder(c.get("userId"), amount);
      // Dashboard flow: receipt info is text-only; goes straight to admin review
      await prisma.order.update({
        where: { id: order.id },
        data: {
          receiptText: body.note?.trim() ? body.note.trim().slice(0, 500) : "درخواست شارژ از داشبورد وب",
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
      limitIp?: number;
      note?: string | null;
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
      });
      if (c.get("role") === "admin") {
        try {
          const result = await provisionAdminComplimentary(order.id, c.get("userId"));
          return c.json({ order: { id: order.id, price: order.price }, provisioned: result });
        } catch (err) {
          return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
        }
      }
      if (body.payWithWallet) {
        try {
          const result = await payOrderWithWallet(order.id, c.get("userId"));
          return c.json({ order: { id: order.id, price: order.price }, provisioned: result });
        } catch (err) {
          return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
        }
      }
      const card = await getPaymentCard();
      return c.json({
        order: {
          id: order.id,
          price: order.price,
          summary: orderSummaryText(order),
          trafficGb: order.trafficGb,
          months: order.months,
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
    if (role !== "partner" && role !== "wholesale" && role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });

  api.get("/partner/home", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const orders = await prisma.order.findMany({
      where: {
        userId: user.id,
        status: "completed",
        kind: { in: ["new", "renew"] },
        updatedAt: { gte: since },
      },
    });
    const sales = orders.reduce((s, o) => s + o.price, 0);
    return c.json({
      agentName: user.agentName,
      panelGroup: user.panelGroup,
      role: user.role,
      report: {
        period: "30d",
        orders: orders.length,
        sales,
        salesLabel: formatToman(sales),
      },
    });
  });

  api.get("/partner/configs", async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get("userId") } });
    if (!user.panelGroup) return c.json({ items: [], total: 0, title: "بدون گروه" });
    const groups = await listConfigGroups();
    const mine = groups.find((g) => g.panelGroup === user.panelGroup);
    if (!mine) return c.json({ items: [], total: 0, title: user.panelGroup });
    const result = await listConfigsForGroup(mine.key, 0, 0);
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

  api.post("/partner/create", async (c) => {
    const body = await c.req.json<{
      trafficGb: number | null;
      months: number;
      category?: string;
      accountName?: string;
      payWithWallet?: boolean;
      limitIp?: number;
      note?: string | null;
    }>();
    const order = await createMatrixOrder({
      userId: c.get("userId"),
      trafficGb: body.trafficGb,
      months: body.months ?? 1,
      category: body.category,
      accountName: body.accountName?.trim() || `p${Date.now().toString(36)}`,
      kind: OrderKind.new,
      limitIp: body.limitIp,
      note: body.note,
    });
    if (c.get("role") === "admin") {
      try {
        const result = await provisionAdminComplimentary(order.id, c.get("userId"));
        return c.json({ order: { id: order.id, price: order.price }, provisioned: result });
      } catch (err) {
        return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
      }
    }
    if (body.payWithWallet) {
      try {
        const result = await payOrderWithWallet(order.id, c.get("userId"));
        return c.json({ order: { id: order.id, price: order.price }, provisioned: result });
      } catch (err) {
        return c.json({ error: String(err instanceof Error ? err.message : err), orderId: order.id }, 400);
      }
    }
    const card = await getPaymentCard();
    return c.json({
      order: { id: order.id, price: order.price, summary: orderSummaryText(order) },
      card,
    });
  });
}

export function registerDashAdminRoutes(api: Hono<{ Variables: Vars }>) {
  api.get("/admin/home", async (c) => {
    const pending = await prisma.order.count({ where: { status: "awaiting_review" } });
    const users = await prisma.user.count();
    const activeSubs = await prisma.subscription.count({ where: { status: "active" } });
    const sales = await adminSalesReport("today");
    return c.json({
      pendingOrders: pending,
      users,
      activeSubs,
      salesToday: { total: sales.total, count: sales.count, label: formatToman(sales.total) },
    });
  });

  api.get("/admin/reports/sales", async (c) => {
    const period = (c.req.query("period") as "today" | "week" | "month") || "week";
    return c.json(await adminSalesReport(period));
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

  api.get("/admin/orders/pending", async (c) => {
    const orders = await prisma.order.findMany({
      where: { status: { in: ["awaiting_review", "pending_payment"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: true },
    });
    return c.json({
      orders: orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        price: o.price,
        summary: orderSummaryText(o),
        receiptText: o.receiptText,
        createdAt: o.createdAt.toISOString(),
        user: {
          username: o.user.username,
          telegramId: String(o.user.telegramId),
          firstName: o.user.firstName,
        },
      })),
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
      const result = await provisionOrder(orderId);
      if ("kind" in result && result.kind === "wallet_credit") {
        await notifyTelegram(
          order.user.telegramId,
          `✅ کیف پول شارژ شد\nموجودی: ${formatToman(result.balance)}`,
        );
        return c.json({ ok: true, walletBalance: result.balance });
      }
      const prov = result as { code: string; subUrl: string | null };
      await notifyTelegram(
        order.user.telegramId,
        `✅ سفارش شما تأیید شد\nکد: ${prov.code}${prov.subUrl ? `\nلینک اشتراک:\n${prov.subUrl}` : ""}`,
      );
      return c.json({ ok: true, code: prov.code, subUrl: prov.subUrl });
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
    return c.json({ ok: true });
  });

  api.get("/admin/prices", async (c) => {
    const cells = await prisma.priceCell.findMany({
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
    const modes: RolePricingModes = {
      user: body.user === "rate" || body.user === "matrix" ? body.user : current.user,
      partner: body.partner === "rate" || body.partner === "matrix" ? body.partner : current.partner,
      wholesale:
        body.wholesale === "rate" || body.wholesale === "matrix" ? body.wholesale : current.wholesale,
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
    for (const k of ["title", "priceUser", "pricePartner", "priceWholesale", "isGolden", "trafficGb", "months", "category", "active"]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    // ∞GB only belongs in unlimited category
    if (data.trafficGb === null || data.category === "unlimited") {
      data.trafficGb = null;
      data.category = "unlimited";
    }
    await prisma.priceCell.update({ where: { id: c.req.param("id") }, data });
    return c.json({ ok: true });
  });

  api.delete("/admin/prices/:id", async (c) => {
    await prisma.priceCell.delete({ where: { id: c.req.param("id") } });
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
    const fields = body.fields?.length ? body.fields : (["priceUser", "pricePartner", "priceWholesale"] as const);
    const value = Number(body.value);
    if (!Number.isFinite(value) || value === 0) return c.json({ error: "مقدار نامعتبر" }, 400);
    const roundTo = Math.max(1, Math.floor(body.roundTo ?? 1000));
    const cells = await prisma.priceCell.findMany({
      where: { active: true, ...(body.category ? { category: body.category } : {}) },
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
    const counts = await prisma.priceCell.groupBy({
      by: ["category"],
      where: { active: true },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((x) => [x.category, x._count._all]));
    const keys = new Set<string>([
      ...BUILTIN_CATEGORY_KEYS,
      ...Object.keys(enabled),
      ...Object.keys(labels),
      ...counts.map((x) => x.category),
    ]);
    return c.json({
      categories: [...keys].map((key) => ({
        key,
        label: labels[key] || key,
        enabled: enabled[key] === true,
        cellCount: countMap.get(key) ?? 0,
        builtin: (BUILTIN_CATEGORY_KEYS as readonly string[]).includes(key),
      })),
    });
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
    }
    const res = await prisma.priceCell.updateMany({
      where: { category: key, active: true },
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
      return c.json({ ok: true, order: { id: order.id, price: order.price }, provisioned: result });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  });

  api.get("/admin/configs/:groupKey", async (c) => {
    const page = Math.max(0, Number(c.req.query("page") ?? 0) || 0);
    const pageSize = Math.max(1, Math.min(100, Number(c.req.query("pageSize") ?? 30) || 30));
    const q = String(c.req.query("q") ?? "");
    const sortRaw = String(c.req.query("sort") ?? "newest");
    const sort =
      sortRaw === "oldest" || sortRaw === "ending" || sortRaw === "newest" ? sortRaw : "newest";

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

    if (sort === "ending") {
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
    const result = await deleteConfig({ email: body.email, subId: body.subId });
    await auditLog({
      action: "admin_config_delete",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: body.email,
    });
    return c.json(result);
  });

  api.get("/admin/panels", async (c) => {
    const panels = await listPanelServers();
    return c.json({
      panels: panels.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        hasToken: Boolean(p.apiToken),
        inboundIds: p.inboundIds,
        subBase: p.subBase,
        categories: parsePanelCategories(p.categories),
        weight: p.weight,
        active: p.active,
        sellEnabled: p.sellEnabled,
      })),
    });
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

  api.get("/admin/users", async (c) => {
    const role = c.req.query("role");
    const users = await prisma.user.findMany({
      where: role ? { role: role as UserRole } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { wallet: true },
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
      })),
    });
  });

  api.get("/admin/users/:id", async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.req.param("id") },
      include: {
        wallet: { include: { txs: { orderBy: { createdAt: "desc" }, take: 20 } } },
        subscriptions: { orderBy: { createdAt: "desc" }, take: 20 },
        orders: { orderBy: { createdAt: "desc" }, take: 20 },
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
        createdAt: user.createdAt.toISOString(),
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

  api.post("/admin/users/:id/role", async (c) => {
    const body = await c.req.json<{ role: UserRole }>();
    if (!["user", "partner", "wholesale", "admin"].includes(body.role)) {
      return c.json({ error: "نقش نامعتبر" }, 400);
    }
    const target = await prisma.user.findUnique({ where: { id: c.req.param("id") } });
    if (!target) return c.json({ error: "کاربر پیدا نشد" }, 404);

    if (
      body.role === "user" &&
      (target.role === UserRole.partner || target.role === UserRole.wholesale)
    ) {
      await demoteToUser(target.id);
    } else {
      await prisma.user.update({ where: { id: target.id }, data: { role: body.role } });
    }

    await auditLog({
      action: "web_role_change",
      actorTelegramId: BigInt(c.get("telegramId")),
      target: target.id,
      detail: `${target.role} -> ${body.role}`,
    });

    if (
      body.role === "user" &&
      (target.role === UserRole.partner || target.role === UserRole.wholesale)
    ) {
      await notifyTelegram(
        target.telegramId,
        "اطلاع: همکاری شما پایان یافت و حساب به مشتری عادی تبدیل شد.",
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
      await notifyTelegram(
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
    return c.json({ config });
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
    return c.json({ config: next });
  });

  api.post("/admin/backup/send", async (c) => {
    const bot = new Bot(env.BOT_TOKEN);
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
          await savePricingModes({
            user: parsed.user === "rate" ? "rate" : "matrix",
            partner: parsed.partner === "rate" ? "rate" : "matrix",
            wholesale: parsed.wholesale === "rate" ? "rate" : "matrix",
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
          wholesale: v === "rate" ? "rate" : "matrix",
        });
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
      await setSetting(k, String(v));
    }
    return c.json({ ok: true, settings: await getAllSettings() });
  });

  api.post("/admin/partners/:id/approve", async (c) => {
    const req = await approvePartner(c.req.param("id"));
    return c.json({ ok: true, group: req.user.panelGroup });
  });

  api.post("/admin/partners/:id/reject", async (c) => {
    await rejectPartner(c.req.param("id"));
    return c.json({ ok: true });
  });
}

export async function mintOtpPayloadForTelegramUser(telegramId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) throw new Error("کاربر یافت نشد — /start بزنید");
  const code = await issueOtpForUser(user.id);
  return { code, login: user.username ? `@${user.username}` : String(user.telegramId) };
}
