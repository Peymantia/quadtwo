"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashShell, LoadingScreen, type ShellTab } from "../../components/DashShell";
import { Toast, ConfirmToast } from "../../components/Toast";
import { PasswordSettings } from "../../components/PasswordSettings";
import { CardPayModal } from "../../components/CardPayModal";
import { CryptoPayModal, type CryptoPayInfo } from "../../components/CryptoPayModal";
import { PaymentCardBlock, TrafficProgress } from "../../components/PaymentCard";
import { SortSelect, endingUrgencyDays, sortByMode, type ListSort } from "../../components/SortSelect";
import { api, formatToman } from "../../lib/api";
import { formatTrafficGb } from "../../lib/format-ui";
import { useDashAuth } from "../../lib/useDashAuth";
import { RateShop, type RateOrderPayload, type RateShopCatalog } from "../../components/RateShop";
import {
  ServerlessShop,
  type ServerlessCatalog,
  type ServerlessOrderPayload,
} from "../../components/ServerlessShop";
import { RenewModal, type RenewInfo } from "../../components/RenewModal";
import { AccountCreatedModal, type CreatedAccount } from "../../components/AccountCreatedModal";
import { ConfigCardActions } from "../../components/ConfigCardActions";

type Sub = {
  id: string;
  code: string;
  email: string;
  title: string | null;
  note: string | null;
  trafficLabel: string;
  trafficGb: number | null;
  usedTrafficBytes?: number;
  expiresAt: string;
  createdAt?: string;
  subUrl: string | null;
  status: string;
  isTest?: boolean;
};

type Cell = {
  id: string;
  category: string;
  trafficGb: number | null;
  months: number;
  title: string | null;
  isGolden?: boolean;
  price: number;
};

type OrderRow = {
  id: string;
  kind: string;
  status: string;
  price: number;
  createdAt: string;
};

type PayCard = { number: string; holder: string };

type PayModalState =
  | { kind: "card"; orderId: string; price: number; card: PayCard }
  | { kind: "crypto"; orderId: string; price: number; crypto: CryptoPayInfo }
  | null;

const TABS: ShellTab[] = [
  { key: "shop", label: "خرید", icon: "shop" },
  { key: "subs", label: "اشتراک‌ها", icon: "wifi" },
  { key: "wallet", label: "کیف پول", icon: "wallet" },
  { key: "support", label: "پشتیبانی", icon: "chat" },
  { key: "settings", label: "تنظیمات", icon: "gear" },
];

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "در انتظار پرداخت", cls: "warn" },
  awaiting_review: { label: "در انتظار تأیید", cls: "warn" },
  paid: { label: "پرداخت شده", cls: "info" },
  provisioning: { label: "در حال ساخت", cls: "info" },
  completed: { label: "تکمیل شده", cls: "ok" },
  rejected: { label: "رد شده", cls: "bad" },
  cancelled: { label: "لغو شده", cls: "bad" },
};

export default function UserAppPage() {
  const { home, loading, reload } = useDashAuth(["user", "partner", "wholesale", "admin"]);
  const [tab, setTab] = useState("shop");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [rateCatalog, setRateCatalog] = useState<RateShopCatalog | null>(null);
  const [serverlessCatalog, setServerlessCatalog] = useState<ServerlessCatalog | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState<Record<string, string>>({});
  const [guidePlatform, setGuidePlatform] = useState<"android" | "ios" | "windows" | "macos">("android");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [payCard, setPayCard] = useState<PayCard | null>(null);
  const [payModal, setPayModal] = useState<PayModalState>(null);
  const [subSort, setSubSort] = useState<ListSort>("newest");
  const [renewInfo, setRenewInfo] = useState<RenewInfo | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<Sub | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Sub | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ sub: Sub; enable: boolean } | null>(null);

  const loadSubs = useCallback(
    () => api<{ subscriptions: Sub[] }>("/me/subscriptions").then((r) => setSubs(r.subscriptions)),
    [],
  );

  const clearFlash = useCallback(() => {
    setMsg(null);
    setErr(null);
  }, []);

  const loadPayCard = useCallback(() => {
    void api<{ card: PayCard }>("/me/payment-card")
      .then((r) => setPayCard(r.card))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!home) return;
    setMsg(null);
    setErr(null);
    if (tab === "shop") {
      void api<{
        cells: Cell[];
        categoryLabels: Record<string, string>;
        categories?: string[];
        maxMonths?: number;
        pricingMode?: "matrix" | "rate";
        defaultLimitIp?: number;
        canEditLimitIp?: boolean;
        discountsEnabled?: boolean;
        volumeRules?: RateShopCatalog["volumeRules"];
        serverless?: boolean;
        serverlessPricing?: ServerlessCatalog["serverlessPricing"];
      }>("/me/catalog").then((r) => {
        if (r.serverless && r.serverlessPricing) {
          setServerlessCatalog({
            serverless: true,
            discountsEnabled: Boolean(r.discountsEnabled),
            serverlessPricing: r.serverlessPricing,
          });
          setRateCatalog(null);
          return;
        }
        setServerlessCatalog(null);
        setRateCatalog({
          categories: r.categories ?? [],
          categoryLabels: r.categoryLabels ?? {},
          maxMonths: r.maxMonths ?? 1,
          pricingMode: r.pricingMode === "rate" ? "rate" : "matrix",
          defaultLimitIp: r.defaultLimitIp,
          canEditLimitIp: r.canEditLimitIp,
          discountsEnabled: Boolean(r.discountsEnabled),
          volumeRules: r.volumeRules,
          cells: r.cells,
        });
      });
    }
    if (tab === "subs") void loadSubs();
    if (tab === "wallet") {
      void api<{ orders: OrderRow[] }>("/me/orders").then((r) => setOrders(r.orders));
      loadPayCard();
    }
    if (tab === "support") {
      void api<{ guide: Record<string, string> }>("/me/guide").then((r) => setGuide(r.guide));
    }
  }, [home, tab, loadSubs, loadPayCard]);

  const userLabel = useMemo(() => {
    if (!home) return "";
    return home.user.username ? `@${home.user.username}` : home.user.firstName || home.user.telegramId || "";
  }, [home]);

  if (loading || !home) return <LoadingScreen />;

  async function buyRate(payload: RateOrderPayload | ServerlessOrderPayload) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api<{
        order?: { id: string; price: number };
        card?: PayCard;
        crypto?: CryptoPayInfo;
        provisioned?: CreatedAccount;
        serverlessPending?: boolean;
      }>("/me/orders", {
        body: {
          trafficGb: payload.trafficGb,
          months: payload.months,
          category: payload.category,
          accountName: "accountName" in payload ? payload.accountName : undefined,
          limitIp: "limitIp" in payload ? payload.limitIp : undefined,
          note: "note" in payload ? payload.note : undefined,
          payWithWallet: "payWithWallet" in payload ? payload.payWithWallet : undefined,
          paymentMethod: "paymentMethod" in payload ? payload.paymentMethod : undefined,
          discountCode: payload.discountCode,
          quantity: payload.quantity ?? 1,
          priceCellId: "priceCellId" in payload ? payload.priceCellId : undefined,
        },
      });
      if (r.serverlessPending) {
        setMsg("در شرایط فعلی سفارش شما در حال پردازش و آماده‌سازی است و به‌زودی ارسال می‌شود.");
        await reload();
        return;
      }
      if (r.provisioned?.code) {
        setCreated({
          ...r.provisioned,
          categoryLabel: rateCatalog?.categoryLabels?.[payload.category] || payload.category,
          months: payload.months,
          trafficGb: r.provisioned.trafficGb ?? payload.trafficGb,
          note: r.provisioned.note ?? ("note" in payload ? payload.note : null),
        });
        await reload();
        await loadSubs();
      } else if (r.order && r.crypto?.address) {
        setPayModal({ kind: "crypto", orderId: r.order.id, price: r.order.price, crypto: r.crypto });
      } else if (r.order && r.card) {
        setPayCard(r.card);
        setPayModal({ kind: "card", orderId: r.order.id, price: r.order.price, card: r.card });
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function openRenew(subId: string) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const info = await api<RenewInfo>(`/me/subscriptions/${subId}/renew`);
      setRenewInfo(info);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function copySubLink(s: Sub) {
    if (!s.subUrl) {
      setErr("لینک اشتراک موجود نیست");
      return;
    }
    await navigator.clipboard.writeText(s.subUrl);
    setMsg("لینک اشتراک کپی شد");
  }

  async function rotateSubLink(s: Sub) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ subUrl?: string | null }>(`/me/subscriptions/${s.id}/rotate-sub`, { method: "POST" });
      if (r.subUrl) {
        await navigator.clipboard.writeText(r.subUrl);
        setMsg("لینک ساب جدید ساخته و کپی شد");
      } else {
        setMsg("لینک ساب جدید ساخته شد");
      }
      await loadSubs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSub(s: Sub) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ changed: string[] }>(`/me/subscriptions/${s.id}/refresh-from-panel`, { method: "POST" });
      setMsg(r.changed.length ? `بروزرسانی شد: ${r.changed.join("، ")}` : "اطلاعات با پنل یکسان بود");
      await loadSubs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSub(s: Sub, enable: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ message?: string }>(`/me/subscriptions/${s.id}/enable`, {
        method: "PUT",
        body: { enable },
      });
      setMsg(r.message || (enable ? "اکانت فعال شد" : "اکانت غیرفعال شد"));
      await loadSubs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSub(s: Sub) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ message?: string }>(`/me/subscriptions/${s.id}/delete`, { method: "POST" });
      setMsg(r.message || "اکانت حذف شد");
      await loadSubs();
      await reload();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSubEdit(s: Sub, patch: { title: string | null; note: string | null }) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/me/subscriptions/${s.id}`, {
        method: "PATCH",
        body: patch,
      });
      await loadSubs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function submitRenew(payload: {
    trafficGb: number | null;
    months: number;
    category: string;
    payWithWallet: boolean;
    paymentMethod?: "wallet" | "card_to_card" | "crypto";
    discountCode?: string | null;
  }) {
    if (!renewInfo) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api<{
        order?: { id: string; price: number };
        card?: PayCard;
        crypto?: CryptoPayInfo;
        provisioned?: CreatedAccount;
      }>("/me/orders", {
        body: {
          kind: "renew",
          targetSubId: renewInfo.subscription.id,
          trafficGb: payload.trafficGb,
          months: payload.months,
          category: payload.category,
          accountName: renewInfo.subscription.email,
          payWithWallet: payload.payWithWallet,
          paymentMethod: payload.paymentMethod,
          discountCode: payload.discountCode,
        },
      });
      setRenewInfo(null);
      if (r.provisioned?.code) {
        setCreated({
          ...r.provisioned,
          categoryLabel: rateCatalog?.categoryLabels?.[payload.category] || payload.category,
          months: payload.months,
          trafficGb: r.provisioned.trafficGb ?? payload.trafficGb,
        });
        await reload();
        await loadSubs();
      } else if (r.order && r.crypto?.address) {
        setPayModal({ kind: "crypto", orderId: r.order.id, price: r.order.price, crypto: r.crypto });
      } else if (r.order && r.card) {
        setPayCard(r.card);
        setPayModal({ kind: "card", orderId: r.order.id, price: r.order.price, card: r.card });
      } else if (r.order) {
        setMsg(`سفارش تمدید ${formatToman(r.order.price)} ثبت شد`);
        await reload();
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function claimTest() {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ subscription: { code: string } }>("/me/test");
      setMsg(`اکانت تست فعال شد: ${r.subscription.code}`);
      await reload();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function requestCharge() {
    setErr(null);
    setMsg(null);
    const amount = Number(chargeAmount.replace(/[^\d]/g, ""));
    if (!amount) {
      setErr("مبلغ را وارد کنید");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ order: { id: string; price: number }; card: PayCard }>("/me/wallet/charge", {
        body: { amount, note: chargeNote || undefined },
      });
      setPayCard(r.card);
      setMsg(
        `درخواست شارژ ${formatToman(r.order.price)} ثبت شد. مبلغ را به کارت اعلام‌شده واریز کنید؛ پس از تأیید ادمین موجودی اضافه می‌شود.`,
      );
      setChargeAmount("");
      setChargeNote("");
      const o = await api<{ orders: OrderRow[] }>("/me/orders");
      setOrders(o.orders);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function submitBuyReceipt(receiptText: string) {
    if (!payModal) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/me/orders/${payModal.orderId}/receipt`, { body: { receiptText } });
      setMsg("رسید ثبت شد و برای تأیید ادمین ارسال شد ✅");
      setPayModal(null);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashShell
      brand={home.brand}
      title={
        tab === "shop"
          ? "خرید"
          : tab === "subs"
            ? "اشتراک‌های من"
            : tab === "wallet"
              ? "کیف پول"
              : tab === "support"
                ? "پشتیبانی و آموزش"
                : "تنظیمات"
      }
      role={home.user.role}
      userLabel={userLabel}
      walletLabel={formatToman(home.wallet.balance)}
      tabs={TABS}
      active={tab}
      onTab={setTab}
      demoMode={Boolean(home.demoMode)}
    >
      <Toast msg={msg} err={err} onClear={clearFlash} />
      {confirmRotate && (
        <ConfirmToast
          message="با تغییر لینک ساب، اتصال فعلی قطع می‌شود. ادامه می‌دهید؟"
          onYes={() => {
            const s = confirmRotate;
            setConfirmRotate(null);
            void rotateSubLink(s);
          }}
          onNo={() => setConfirmRotate(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmToast
          message={`اکانت ${confirmDelete.email} حذف شود؟`}
          onYes={() => {
            const s = confirmDelete;
            setConfirmDelete(null);
            void deleteSub(s);
          }}
          onNo={() => setConfirmDelete(null)}
        />
      )}
      {confirmToggle && (
        <ConfirmToast
          message={`اکانت ${confirmToggle.sub.email} ${confirmToggle.enable ? "فعال" : "غیرفعال"} شود؟`}
          onYes={() => {
            const t = confirmToggle;
            setConfirmToggle(null);
            void toggleSub(t.sub, t.enable);
          }}
          onNo={() => setConfirmToggle(null)}
        />
      )}

      {tab === "shop" && (
        <>
          {!home.user.testClaimed && (
            <div className="panel">
              <h2>اکانت تست رایگان</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                قبل از خرید، سرویس را امتحان کنید. رایگان است و از سقف جداگانه‌ای کم می‌شود.
              </p>
              <button type="button" className="btn light wide" disabled={busy} onClick={claimTest}>
                دریافت اکانت تست
              </button>
            </div>
          )}

          {serverlessCatalog ? (
            <div className="panel">
              <h2>خرید اشتراک</h2>
              <ServerlessShop catalog={serverlessCatalog} busy={busy} onSubmit={buyRate} />
            </div>
          ) : rateCatalog && rateCatalog.categories.length > 0 ? (
            <div className="panel">
              <h2>خرید اشتراک</h2>
              <RateShop catalog={rateCatalog} busy={busy} variant="user" onSubmit={buyRate} />
            </div>
          ) : (
            <div className="panel">
              <p className="muted" style={{ margin: 0 }}>
                هنوز پلنی برای فروش تنظیم نشده است.
              </p>
            </div>
          )}
        </>
      )}

      {tab === "subs" && (
        <div className="panel">
          <h2>سرویس‌های من</h2>
          <SortSelect value={subSort} onChange={setSubSort} />
          <div className="list">
            {sortByMode(subs, subSort, {
              createdAt: (s) => (s.createdAt ? new Date(s.createdAt).getTime() : 0),
              expiresAt: (s) => new Date(s.expiresAt).getTime(),
              remainingRatio: () => 1,
              endingUrgencyDays: (s) =>
                endingUrgencyDays({
                  expiresAt: s.expiresAt,
                  usedBytes: s.usedTrafficBytes ?? 0,
                  totalGb: s.isTest ? 0.25 : s.trafficGb,
                }),
              endingTrafficDays: (s) =>
                endingUrgencyDays({
                  expiresAt: null,
                  usedBytes: s.usedTrafficBytes ?? 0,
                  totalGb: s.isTest ? 0.25 : s.trafficGb,
                }),
            }).map((s) => {
              const expired = new Date(s.expiresAt) < new Date();
              const totalGb = s.isTest ? 0.25 : s.trafficGb;
              const remain = Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 86400000);
              const used = s.usedTrafficBytes ?? 0;
              const usedLabel =
                used <= 0 ? "۰" : used >= 1024 ** 3 ? `${(used / 1024 ** 3).toFixed(2)} GB` : `${Math.round(used / 1024 ** 2)} MB`;
              return (
                <div key={s.id} className="row-card row-card--stack">
                  <div style={{ width: "100%" }}>
                    <strong className="num">{s.email}</strong>{" "}
                    <span className={`badge ${expired || s.status !== "active" ? "bad" : "ok"}`}>
                      {expired
                        ? "منقضی"
                        : s.status === "active"
                          ? "فعال"
                          : s.status === "disabled"
                            ? "غیرفعال"
                            : s.status === "expired"
                              ? "منقضی"
                              : s.status}
                    </span>
                    {s.isTest && <span className="badge info">تست</span>}
                    {s.code && (
                      <div className="muted num" style={{ marginTop: 4 }}>
                        کد: {s.code}
                      </div>
                    )}
                    <div className="muted" style={{ marginTop: 8 }}>
                      حجم کل:{" "}
                      <strong className="num">
                        {formatTrafficGb(totalGb)}
                      </strong>
                      {" · "}
                      مصرف‌شده: <strong className="num">{usedLabel}</strong>
                      {" · "}
                      انقضا: <strong className="num">{new Date(s.expiresAt).toLocaleDateString("fa-IR")}</strong>
                      {" · "}
                      باقی‌مانده:{" "}
                      <strong className={remain < 0 ? "bad" : undefined}>
                        {remain < 0
                          ? `${Math.abs(remain)} روز گذشته`
                          : remain === 0
                            ? "کمتر از یک روز"
                            : `${remain} روز`}
                      </strong>
                    </div>
                    <TrafficProgress usedBytes={used} totalGb={totalGb} />
                  </div>
                  <ConfigCardActions
                      item={{
                        email: s.email,
                        subId: s.id,
                        subUrl: s.subUrl,
                        status: s.status,
                        title: s.title,
                        note: s.note,
                        expiresAt: s.expiresAt,
                      }}
                      busy={busy}
                      onBusy={setBusy}
                      onMsg={setMsg}
                      onErr={setErr}
                      onReload={loadSubs}
                      onRenew={() => void openRenew(s.id)}
                      onCopy={() => void copySubLink(s)}
                      onRotate={() => setConfirmRotate(s)}
                      onRefresh={() => void refreshSub(s)}
                      onToggleEnable={(enable) => setConfirmToggle({ sub: s, enable })}
                      onDelete={() => setConfirmDelete(s)}
                      onSaveEdit={(patch) => saveSubEdit(s, patch)}
                    />
                </div>
              );
            })}
            {!subs.length && <p className="muted">هنوز سرویسی ندارید — از «خرید» شروع کنید.</p>}
          </div>
        </div>
      )}

      {tab === "wallet" && (
        <>
          <div className="grid">
            <div className="stat accent">
              <div className="label">موجودی کیف پول</div>
              <div className="value num">{formatToman(home.wallet.balance)}</div>
            </div>
            <div className="stat">
              <div className="label">سرویس فعال</div>
              <div className="value num">{home.stats.active}</div>
            </div>
          </div>

          <div className="panel">
            <h2>شارژ با کارت به کارت</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              مبلغ را به کارت زیر واریز کنید، سپس درخواست شارژ را ثبت کنید. پس از تأیید ادمین موجودی اضافه می‌شود.
            </p>
            {payCard && (
              <PaymentCardBlock
                number={payCard.number}
                holder={payCard.holder}
                onCopied={() => setMsg("شماره کارت کپی شد")}
              />
            )}
            <div className="field">
              <label>مبلغ (تومان)</label>
              <input
                className="num"
                inputMode="numeric"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                placeholder="مثلاً 100000"
                aria-label="مبلغ شارژ به تومان"
              />
            </div>
            <div className="field">
              <label>توضیح / شماره پیگیری واریز (اختیاری)</label>
              <input value={chargeNote} onChange={(e) => setChargeNote(e.target.value)} />
            </div>
            <button type="button" className="btn success wide" disabled={busy} onClick={requestCharge}>
              ارسال درخواست شارژ
            </button>
          </div>

          <div className="panel">
            <h2>سفارش‌های اخیر</h2>
            <div className="list">
              {orders.map((o) => {
                const st = ORDER_STATUS[o.status] ?? { label: o.status, cls: "info" };
                return (
                  <div key={o.id} className="row-card">
                    <div>
                      <strong className="num">{formatToman(o.price)}</strong>
                      <div className="muted">
                        {o.kind === "wallet_charge" ? "شارژ کیف پول" : o.kind === "renew" ? "تمدید" : "خرید سرویس"} ·{" "}
                        {new Date(o.createdAt).toLocaleDateString("fa-IR")}
                      </div>
                    </div>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </div>
                );
              })}
              {!orders.length && <p className="muted">سفارشی ثبت نشده است.</p>}
            </div>
          </div>
        </>
      )}

      {tab === "support" && (
        <>
          <div className="panel">
            <h2>پشتیبانی</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              اگر مشکلی وجود داشت حتماً به پشتیبانی پیام بدهید.
            </p>
            {(guide.support_username || home.support) && (
              <a
                className="btn primary wide"
                href={`https://t.me/${(guide.support_username || home.support).replace(/^@/, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                گفتگو با پشتیبانی در تلگرام
              </a>
            )}
          </div>
          <div className="panel">
            <h2>آموزش اتصال</h2>
            <div className="chip-row full" style={{ marginBottom: 12 }}>
              {(
                [
                  ["android", "اندروید"],
                  ["ios", "آیفون"],
                  ["windows", "ویندوز"],
                  ["macos", "مک"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`chip${guidePlatform === key ? " on" : ""}`}
                  onClick={() => setGuidePlatform(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <pre className="muted" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "0 0 12px" }}>
              {guidePlatform === "android"
                ? guide.guide_android_text || guide.guide_text || "متن راهنمای اندروید هنوز تنظیم نشده."
                : guidePlatform === "ios"
                  ? guide.guide_ios_text || guide.guide_text || "متن راهنمای آیفون هنوز تنظیم نشده."
                  : guidePlatform === "windows"
                    ? guide.guide_windows_text || guide.guide_text || "متن راهنمای ویندوز هنوز تنظیم نشده."
                    : guide.guide_macos_text || guide.guide_text || "متن راهنمای مک هنوز تنظیم نشده."}
            </pre>
            <div className="guide-download-wrap">
              {guidePlatform === "android" && guide.guide_android && (
                <a className="btn primary" href={guide.guide_android} target="_blank" rel="noreferrer">
                  دانلود اپ اندروید
                </a>
              )}
              {guidePlatform === "ios" && guide.guide_ios && (
                <a className="btn primary" href={guide.guide_ios} target="_blank" rel="noreferrer">
                  دانلود اپ آیفون
                </a>
              )}
              {guidePlatform === "windows" && guide.guide_windows && (
                <a className="btn primary" href={guide.guide_windows} target="_blank" rel="noreferrer">
                  دانلود اپ ویندوز
                </a>
              )}
              {guidePlatform === "macos" && guide.guide_mac && (
                <a className="btn primary" href={guide.guide_mac} target="_blank" rel="noreferrer">
                  دانلود اپ مک
                </a>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "settings" && (
        <PasswordSettings
          hasPassword={Boolean(home.user.hasPassword)}
          onFlash={(ok, bad) => {
            setMsg(ok);
            setErr(bad ?? null);
          }}
          onSaved={() => void reload()}
        />
      )}

      <RenewModal
        open={Boolean(renewInfo)}
        info={renewInfo}
        busy={busy}
        onClose={() => setRenewInfo(null)}
        onSubmit={submitRenew}
      />

      <AccountCreatedModal
        open={!!created}
        account={created}
        onClose={() => setCreated(null)}
        onCopied={() => setMsg("لینک اشتراک کپی شد")}
        walletBalance={home.wallet.balance}
        onPayCard={(orderId, price, card) => {
          setPayCard(card);
          setPayModal({ kind: "card", orderId, price, card });
          setCreated(null);
        }}
        onPayCrypto={(orderId, price, crypto) => {
          setPayModal({ kind: "crypto", orderId, price, crypto });
          setCreated(null);
        }}
        onRefresh={() => {
          void reload();
          void loadSubs();
        }}
      />

      {payModal?.kind === "card" && (
        <CardPayModal
          open
          title="پرداخت سفارش"
          amount={payModal.price}
          card={payModal.card}
          busy={busy}
          onCopied={() => setMsg("شماره کارت کپی شد")}
          onPaid={() => void submitBuyReceipt("پرداخت شد — اعلام از داشبورد")}
          onSendReceipt={(note) => void submitBuyReceipt(note)}
          onCancel={() => setPayModal(null)}
        />
      )}
      {payModal?.kind === "crypto" && (
        <CryptoPayModal
          open
          title="پرداخت کریپتو"
          amount={payModal.price}
          crypto={payModal.crypto}
          busy={busy}
          onCopied={() => setMsg("آدرس کیف پول کپی شد")}
          onPaid={() => void submitBuyReceipt("پرداخت کریپتو — اعلام از داشبورد")}
          onSendReceipt={(note) => void submitBuyReceipt(note)}
          onCancel={() => setPayModal(null)}
        />
      )}
    </DashShell>
  );
}
