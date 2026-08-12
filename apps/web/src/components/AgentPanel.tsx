"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashShell, LoadingScreen, Icon, type ShellTab } from "./DashShell";
import { Toast, ConfirmToast } from "./Toast";
import { PasswordSettings } from "./PasswordSettings";
import { PaymentCardBlock, TrafficProgress } from "./PaymentCard";
import { CardPayModal } from "./CardPayModal";
import { CryptoPayModal, type CryptoPayInfo } from "./CryptoPayModal";
import { SortSelect, endingUrgencyDays, sortByMode, type ListSort } from "./SortSelect";
import { api, formatToman, type Role } from "../lib/api";
import { formatExpiryDate, formatTrafficGb } from "../lib/format-ui";
import { useDashAuth } from "../lib/useDashAuth";
import { RateShop, type RateOrderPayload, type RateShopCatalog } from "./RateShop";
import { AccountCreatedModal, type CreatedAccount } from "./AccountCreatedModal";
import { SubQrModal } from "./SubQrModal";
import { DiscountCodesPanel } from "./DiscountCodesPanel";
import { SalesReportPanel } from "./SalesReportPanel";
import { ConfigCardActions } from "./ConfigCardActions";
import { RenewModal, type RenewInfo } from "./RenewModal";
import { QrCodeIcon } from "./QrCodeIcon";

type PayCard = { number: string; holder: string };
type PayModalState =
  | { kind: "card"; orderId: string; price: number; card: PayCard }
  | { kind: "crypto"; orderId: string; price: number; crypto: CryptoPayInfo }
  | null;

const CONFIG_PAGE_SIZES = [10, 20, 30, 50, 100] as const;

type ConfigItem = {
  email: string;
  code: string | null;
  subId: string | null;
  status: string | null;
  title?: string | null;
  note?: string | null;
  trafficGb?: number | null;
  expiresAt?: string | null;
  createdAt?: string | null;
  usedTrafficBytes?: number;
  subUrl?: string | null;
};

const TABS: ShellTab[] = [
  { key: "home", label: "داشبورد", icon: "home" },
  { key: "create", label: "ساخت کانفیگ", shortLabel: "فروش", icon: "shop" },
  { key: "wallet", label: "کیف پول", icon: "wallet" },
  { key: "configs", label: "کانفیگ‌ها", icon: "wifi" },
  { key: "reports", label: "گزارش", icon: "chart" },
  { key: "discounts", label: "تخفیف", icon: "tag" },
  { key: "settings", label: "تنظیمات", icon: "gear" },
];

export function AgentPanel(props: { title: string; allowed: Role[] }) {
  const { home, loading, reload } = useDashAuth(props.allowed);
  const [tab, setTab] = useState("home");
  const [report, setReport] = useState<{
    orders: number;
    salesLabel: string;
    monthName?: string;
    activeSubs?: number;
    panelGroup?: string | null;
  } | null>(null);
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [catLabels, setCatLabels] = useState<Record<string, string>>({});
  const [rateCatalog, setRateCatalog] = useState<RateShopCatalog | null>(null);
  const [filter, setFilter] = useState("");
  const [configSort, setConfigSort] = useState<ListSort>("newest");
  const [configPage, setConfigPage] = useState(0);
  const [configPageSize, setConfigPageSize] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreatedAccount | null>(null);
  const [chargeAmount, setChargeAmount] = useState("");
  const [payCard, setPayCard] = useState<PayCard | null>(null);
  const [txs, setTxs] = useState<Array<{ id: string; type: string; amount: number; createdAt: string; note?: string | null }>>([]);
  const [confirmRotate, setConfirmRotate] = useState<ConfigItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfigItem | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ item: ConfigItem; enable: boolean } | null>(null);
  const [renewInfo, setRenewInfo] = useState<RenewInfo | null>(null);
  const [payModal, setPayModal] = useState<PayModalState>(null);
  const [qrSub, setQrSub] = useState<{ url: string; title: string } | null>(null);

  const loadConfigs = useCallback(
    () => api<{ items: ConfigItem[] }>("/partner/configs").then((r) => setConfigs(r.items ?? [])),
    [],
  );

  const clearFlash = useCallback(() => {
    setMsg(null);
    setErr(null);
  }, []);

  useEffect(() => {
    if (!home) return;
    setMsg(null);
    setErr(null);
    if (tab === "home") {
      void api<{
        report: { orders: number; salesLabel: string; monthName?: string; activeSubs?: number };
        panelGroup: string | null;
      }>("/partner/home").then((r) => setReport({ ...r.report, panelGroup: r.panelGroup }));
    }
    if (tab === "create") {
      void api<{
        cells?: RateShopCatalog["cells"];
        categoryLabels: Record<string, string>;
        categories?: string[];
        maxMonths?: number;
        pricingMode?: "matrix" | "rate";
        defaultLimitIp?: number;
        canEditLimitIp?: boolean;
        discountsEnabled?: boolean;
        volumeRules?: RateShopCatalog["volumeRules"];
        serverless?: boolean;
      }>("/me/catalog").then((r) => {
        if (r.serverless) {
          setRateCatalog({
            categories: [],
            categoryLabels: {},
            maxMonths: 1,
            pricingMode: "rate",
            cells: [],
          });
          return;
        }
        setCatLabels(r.categoryLabels ?? {});
        setRateCatalog({
          categories: r.categories ?? [],
          categoryLabels: r.categoryLabels ?? {},
          maxMonths: r.maxMonths ?? 1,
          pricingMode: r.pricingMode === "rate" ? "rate" : "matrix",
          defaultLimitIp: r.defaultLimitIp,
          canEditLimitIp: true,
          discountsEnabled: Boolean(r.discountsEnabled),
          volumeRules: r.volumeRules,
          cells: r.cells,
        });
      });
    }
    if (tab === "configs") void loadConfigs();
    if (tab === "wallet") {
      void api<{ txs: typeof txs }>("/me/wallet").then((r) => setTxs(r.txs));
      void api<{ card: { number: string; holder: string } }>("/me/payment-card")
        .then((r) => setPayCard(r.card))
        .catch(() => undefined);
    }
  }, [home, tab, loadConfigs]);

  const filteredSorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = q
      ? configs.filter((c) => {
          const hay = [c.code, c.email, c.title, c.note]
            .filter(Boolean)
            .join("\n")
            .toLowerCase();
          return hay.includes(q);
        })
      : configs;
    return sortByMode(base, configSort, {
      createdAt: (c) => (c.createdAt ? new Date(c.createdAt).getTime() : 0),
      expiresAt: (c) => (c.expiresAt ? new Date(c.expiresAt).getTime() : Number.POSITIVE_INFINITY),
      remainingRatio: () => 1,
      endingUrgencyDays: (c) =>
        endingUrgencyDays({
          expiresAt: c.expiresAt,
          usedBytes: c.usedTrafficBytes ?? 0,
          totalGb: c.trafficGb,
        }),
      endingTrafficDays: (c) =>
        endingUrgencyDays({
          expiresAt: null,
          usedBytes: c.usedTrafficBytes ?? 0,
          totalGb: c.trafficGb,
        }),
    });
  }, [configs, filter, configSort]);

  const pagedConfigs = useMemo(() => {
    const start = configPage * configPageSize;
    return filteredSorted.slice(start, start + configPageSize);
  }, [filteredSorted, configPage, configPageSize]);

  useEffect(() => {
    setConfigPage(0);
  }, [filter, configSort, configPageSize]);

  const discountAllowed = home?.user.discountCodesAllowed !== false;
  const tabs = useMemo(
    () => (discountAllowed ? TABS : TABS.filter((t) => t.key !== "discounts")),
    [discountAllowed],
  );

  if (loading || !home) return <LoadingScreen />;

  async function createRate(payload: RateOrderPayload) {
    setErr(null);
    setMsg(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await api<{
        provisioned?: CreatedAccount;
        order?: { id: string; price: number };
        card?: PayCard;
        crypto?: CryptoPayInfo;
        error?: string;
      }>("/partner/create", {
        body: {
          trafficGb: payload.trafficGb,
          months: payload.months,
          category: payload.category,
          accountName: payload.accountName,
          limitIp: payload.limitIp,
          note: payload.note,
          payWithWallet: payload.payWithWallet,
          paymentMethod: payload.paymentMethod,
          discountCode: payload.discountCode,
          quantity: payload.quantity,
          priceCellId: payload.priceCellId,
        },
      });
      if (r.provisioned?.code) {
        setResult({
          ...r.provisioned,
          categoryLabel: catLabels[payload.category] || payload.category,
          months: payload.months,
          trafficGb: r.provisioned.trafficGb ?? payload.trafficGb,
          note: r.provisioned.note ?? payload.note,
        });
        await reload();
      } else if (r.order && r.crypto?.address) {
        setPayModal({ kind: "crypto", orderId: r.order.id, price: r.order.price, crypto: r.crypto });
      } else if (r.order && r.card) {
        setPayCard(r.card);
        setPayModal({ kind: "card", orderId: r.order.id, price: r.order.price, card: r.card });
      } else {
        setMsg(`سفارش ${formatToman(r.order!.price)} ثبت شد`);
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function markOrderPaid() {
    if (!payModal) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/me/orders/${payModal.orderId}/receipt`, {
        body: { receiptText: "پرداخت کارت‌به‌کارت از داشبورد (همکار)" },
      });
      setMsg("رسید ثبت شد و برای تأیید ادمین ارسال شد ✅");
      setPayModal(null);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function submitOrderReceipt(receiptText: string) {
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

  async function requestCharge() {
    const amount = Number(chargeAmount.replace(/[^\d]/g, ""));
    if (!amount) {
      setErr("مبلغ را وارد کنید");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ order: { price: number }; card: { number: string; holder: string } }>("/me/wallet/charge", {
        body: { amount },
      });
      setPayCard(r.card);
      setMsg(`درخواست شارژ ${formatToman(r.order.price)} ثبت شد — پس از واریز و تأیید ادمین اعمال می‌شود.`);
      setChargeAmount("");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function copySubLink(c: ConfigItem) {
    if (!c.subUrl) {
      setErr("لینک اشتراک برای این کانفیگ موجود نیست");
      return;
    }
    await navigator.clipboard.writeText(c.subUrl);
    setMsg("لینک اشتراک کپی شد");
  }

  async function rotateSubLink(c: ConfigItem) {
    if (!c.subId && !c.email) {
      setErr("این کانفیگ در دیتابیس ربات نیست");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ subUrl?: string | null }>("/partner/configs/rotate-sub", {
        method: "POST",
        body: { email: c.email, subId: c.subId },
      });
      if (r.subUrl) {
        await navigator.clipboard.writeText(r.subUrl);
        setMsg("لینک ساب جدید ساخته و کپی شد");
      } else {
        setMsg("لینک ساب جدید ساخته شد");
      }
      await loadConfigs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshConfig(c: ConfigItem) {
    if (!c.subId) {
      setErr("این کانفیگ در دیتابیس ربات نیست");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ changed: string[] }>("/partner/configs/refresh-from-panel", {
        method: "POST",
        body: { email: c.email, subId: c.subId },
      });
      setMsg(r.changed.length ? `بروزرسانی شد: ${r.changed.join("، ")}` : "اطلاعات با پنل یکسان بود");
      await loadConfigs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnable(c: ConfigItem, enable: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ message?: string }>("/partner/configs/update", {
        method: "PUT",
        body: { email: c.email, subId: c.subId, enable },
      });
      setMsg(r.message || (enable ? "اکانت فعال شد" : "اکانت غیرفعال شد"));
      await loadConfigs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteConfigItem(c: ConfigItem) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ message?: string }>("/partner/configs/delete", {
        method: "POST",
        body: { email: c.email, subId: c.subId },
      });
      setMsg(r.message || "اکانت حذف شد");
      await loadConfigs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(c: ConfigItem, patch: { title: string | null; note: string | null }) {
    setBusy(true);
    setErr(null);
    try {
      await api("/partner/configs/update", {
        method: "PUT",
        body: { email: c.email, subId: c.subId, title: patch.title, note: patch.note },
      });
      await loadConfigs();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function openRenew(c: ConfigItem) {
    if (!c.subId) {
      setErr("این کانفیگ در دیتابیس ربات نیست");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const info = await api<RenewInfo>(`/me/subscriptions/${c.subId}/renew`);
      setRenewInfo(info);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
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
    setBusy(true);
    setErr(null);
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
        setResult(r.provisioned);
        await reload();
        await loadConfigs();
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

  const userLabel = home.user.agentName || (home.user.username ? `@${home.user.username}` : "");

  return (
    <DashShell
      brand={home.brand}
      title={props.title}
      role={home.user.role}
      userLabel={userLabel}
      walletLabel={formatToman(home.wallet.balance)}
      tabs={tabs}
      active={tab}
      onTab={setTab}
      demoMode={Boolean(home.demoMode)}
    >
      <Toast msg={msg} err={err} onClear={clearFlash} />
      {confirmRotate && (
        <ConfirmToast
          message="با تغییر لینک ساب، اتصال فعلی قطع می‌شود. ادامه می‌دهید؟"
          onYes={() => {
            const c = confirmRotate;
            setConfirmRotate(null);
            void rotateSubLink(c);
          }}
          onNo={() => setConfirmRotate(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmToast
          message={`اکانت ${confirmDelete.email} حذف شود؟`}
          onYes={() => {
            const c = confirmDelete;
            setConfirmDelete(null);
            void deleteConfigItem(c);
          }}
          onNo={() => setConfirmDelete(null)}
        />
      )}
      {confirmToggle && (
        <ConfirmToast
          message={`اکانت ${confirmToggle.item.email} ${confirmToggle.enable ? "فعال" : "غیرفعال"} شود؟`}
          onYes={() => {
            const t = confirmToggle;
            setConfirmToggle(null);
            void toggleEnable(t.item, t.enable);
          }}
          onNo={() => setConfirmToggle(null)}
        />
      )}
      {renewInfo && (
        <RenewModal
          open
          info={renewInfo}
          busy={busy}
          onClose={() => setRenewInfo(null)}
          onSubmit={submitRenew}
        />
      )}

      {tab === "home" && (
        <>
          <div className="grid">
            <div className="stat accent">
              <div className="label">موجودی کیف پول</div>
              <div className="value num">{formatToman(home.wallet.balance)}</div>
            </div>
            <div className="stat">
              <div className="label">
                فروش ماه جاری{report?.monthName ? ` (${report.monthName})` : ""}
              </div>
              <div className="value num">{report?.salesLabel ?? "—"}</div>
            </div>
            <div className="stat">
              <div className="label">سفارش‌های تکمیل‌شده</div>
              <div className="value num">{report?.orders ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">سرویس فعال</div>
              <div className="value num">{report?.activeSubs ?? 0}</div>
            </div>
          </div>
          <div className="panel">
            <h2>دسترسی سریع</h2>
            <div className="quick-actions">
              <div className="qa-row qa-row--1">
                <button type="button" className="btn quick-action-btn" onClick={() => setTab("create")}>
                  <Icon name="shop" size={18} />
                  ساخت کانفیگ جدید
                </button>
                <button type="button" className="btn quick-action-btn" onClick={() => setTab("configs")}>
                  <Icon name="wifi" size={18} />
                  مشاهده کانفیگ‌ها
                </button>
              </div>
              <div className="qa-row qa-row--2">
                <button type="button" className="btn quick-action-btn" onClick={() => setTab("wallet")}>
                  <Icon name="wallet" size={18} />
                  شارژ کیف پول
                </button>
                <button type="button" className="btn quick-action-btn" onClick={() => setTab("reports")}>
                  <Icon name="chart" size={18} />
                  گزارش فروش
                </button>
              </div>
              <div className="qa-row qa-row--3">
                {discountAllowed && (
                  <button type="button" className="btn quick-action-btn" onClick={() => setTab("discounts")}>
                    <Icon name="tag" size={15} />
                    کد تخفیف
                  </button>
                )}
                <button
                  type="button"
                  className={`btn quick-action-btn${!discountAllowed ? " quick-action-btn--full" : ""}`}
                  onClick={() => setTab("settings")}
                >
                  <Icon name="gear" size={15} />
                  تنظیمات
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "create" && (
        <>
          <div className="panel">
            <h2>ساخت کانفیگ برای مشتری</h2>
            {rateCatalog && rateCatalog.categories.length > 0 ? (
              <RateShop catalog={rateCatalog} busy={busy} variant="agent" onSubmit={createRate} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                در شرایط فعلی ساخت کانفیگ از پنل همکار فعال نیست یا پلنی تنظیم نشده است.
              </p>
            )}
          </div>
          {result?.code && (
            <AccountCreatedModal
              open
              account={result}
              onClose={() => setResult(null)}
              onCopied={() => setMsg("لینک اشتراک کپی شد")}
              walletBalance={home.wallet.balance}
              onRefresh={() => void loadConfigs()}
            />
          )}
        </>
      )}

      {tab === "configs" && (
        <div className="panel">
          <h2>کانفیگ‌های گروه شما</h2>
          <div className="field">
            <label>جستجو</label>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="کد، ایمیل، عنوان یا نوت" />
          </div>
          <SortSelect id="partner-config-sort" value={configSort} onChange={setConfigSort} />
          <div className="list">
            {pagedConfigs.map((c) => {
              const expired = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
              const active = c.status === "active" && !expired;
              const remain = c.expiresAt
                ? Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / 86400000)
                : null;
              const usedLabel =
                (c.usedTrafficBytes ?? 0) <= 0
                  ? "۰"
                  : (c.usedTrafficBytes ?? 0) >= 1024 ** 3
                    ? `${((c.usedTrafficBytes ?? 0) / 1024 ** 3).toFixed(2)} GB`
                    : `${Math.round((c.usedTrafficBytes ?? 0) / 1024 ** 2)} MB`;
              return (
                <div key={c.email} className="row-card row-card--stack">
                  <div>
                    <div className="config-card-head">
                      <div className="config-card-head__meta">
                        <div className="config-card-title-row">
                          <strong className="num" dir="ltr">
                            {c.email}
                          </strong>
                          {expired && <span className="badge warn">منقضی</span>}
                        </div>
                        {c.title && c.title !== c.email && <div className="muted">{c.title}</div>}
                        {c.note && <div className="muted config-card-note">نوت: {c.note}</div>}
                        {c.code && (
                          <div className="muted config-card-code">
                            کد: <span className="num">{c.code}</span>
                          </div>
                        )}
                      </div>
                      <div className="config-card-head__tools">
                        {!expired && (
                          <label
                            className="switch switch-sm"
                            title={active ? "فعال" : "غیرفعال"}
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              disabled={busy || !c.subId}
                              aria-label={active ? "غیرفعال کردن اکانت" : "فعال کردن اکانت"}
                              onChange={() => setConfirmToggle({ item: c, enable: !active })}
                            />
                            <span className="track" />
                          </label>
                        )}
                        {c.subUrl && (
                          <button
                            type="button"
                            className="btn sm config-qr-btn"
                            disabled={busy}
                            title="QR Code"
                            aria-label="QR Code"
                            onClick={() => setQrSub({ url: c.subUrl!, title: c.email })}
                          >
                            <QrCodeIcon />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      حجم کل:{" "}
                      <strong className="num">
                        {formatTrafficGb(c.trafficGb)}
                      </strong>
                      {" · "}
                      مصرف‌شده: <strong className="num">{usedLabel}</strong>
                      {" · "}
                      انقضا:{" "}
                      <strong className="num">
                        {formatExpiryDate(c.expiresAt)}
                      </strong>
                      {" · "}
                      باقی‌مانده:{" "}
                      <strong className={remain != null && remain < 0 ? "bad" : undefined}>
                        {remain == null
                          ? "—"
                          : remain < 0
                            ? `${Math.abs(remain)} روز گذشته`
                            : remain === 0
                              ? "کمتر از یک روز"
                              : `${remain} روز`}
                      </strong>
                    </div>
                  </div>
                  <TrafficProgress usedBytes={c.usedTrafficBytes ?? 0} totalGb={c.trafficGb ?? null} />
                  <ConfigCardActions
                    item={c}
                    busy={busy}
                    onBusy={setBusy}
                    onMsg={setMsg}
                    onErr={setErr}
                    onReload={loadConfigs}
                    onRenew={() => void openRenew(c)}
                    onCopy={() => void copySubLink(c)}
                    onRotate={() => setConfirmRotate(c)}
                    onRefresh={() => void refreshConfig(c)}
                    onDelete={() => setConfirmDelete(c)}
                    onSaveEdit={(patch) => saveEdit(c, patch)}
                  />
                </div>
              );
            })}
            {!pagedConfigs.length && <p className="muted">کانفیگی یافت نشد.</p>}
          </div>
          {filteredSorted.length > 0 && (
            <div className="config-pager">
              <div className="actions config-pager-nav">
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={configPage === 0}
                  onClick={() => setConfigPage((p) => p - 1)}
                >
                  <Icon name="arrowRight" size={15} />
                  قبلی
                </button>
                <span className="muted" style={{ alignSelf: "center" }}>
                  صفحه {configPage + 1} از {Math.max(1, Math.ceil(filteredSorted.length / configPageSize))}
                </span>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={(configPage + 1) * configPageSize >= filteredSorted.length}
                  onClick={() => setConfigPage((p) => p + 1)}
                >
                  <Icon name="arrowLeft" size={15} />
                  بعدی
                </button>
              </div>
              <div className="sort-bar config-page-size">
                <label htmlFor="partner-config-page-size">تعداد نمایش اکانت در هر صفحه</label>
                <select
                  id="partner-config-page-size"
                  value={configPageSize}
                  onChange={(e) => setConfigPageSize(Number(e.target.value))}
                >
                  {CONFIG_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "wallet" && (
        <>
          <div className="grid">
            <div className="stat accent">
              <div className="label">موجودی</div>
              <div className="value num">{formatToman(home.wallet.balance)}</div>
            </div>
          </div>
          <div className="panel">
            <h2>شارژ کیف پول</h2>
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
                placeholder="مثلاً 500000"
              />
            </div>
            <button type="button" className="btn success wide" disabled={busy} onClick={requestCharge}>
              <Icon name="wallet" size={16} />
              ثبت درخواست شارژ
            </button>
          </div>
          <div className="panel">
            <h2>تراکنش‌ها</h2>
            <div className="list">
              {txs.map((t) => (
                <div key={t.id} className="row-card">
                  <div>
                    <strong className="num">{formatToman(t.amount)}</strong>
                    <div className="muted">
                      {t.type === "charge" ? "شارژ" : t.type === "purchase" ? "خرید" : t.type === "refund" ? "بازگشت" : "تنظیم دستی"}
                      {t.note ? ` · ${t.note}` : ""}
                    </div>
                  </div>
                  <span className="muted">{new Date(t.createdAt).toLocaleDateString("fa-IR")}</span>
                </div>
              ))}
              {!txs.length && <p className="muted">تراکنشی ثبت نشده.</p>}
            </div>
          </div>
        </>
      )}

      {tab === "reports" && (
        <SalesReportPanel endpoint="/me/reports/sales" defaultPeriod="jalali_month" title="گزارش فروش شما" />
      )}

      {tab === "discounts" && (
        <DiscountCodesPanel
          flash={(ok, err) => {
            setMsg(ok);
            setErr(err ?? null);
          }}
          askConfirm={async (msg) => window.confirm(msg)}
        />
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

      {payModal?.kind === "card" && (
        <CardPayModal
          open
          amount={payModal.price}
          card={payModal.card}
          busy={busy}
          onPaid={markOrderPaid}
          onSendReceipt={submitOrderReceipt}
          onCancel={() => setPayModal(null)}
          onCopied={() => setMsg("شماره کارت کپی شد")}
        />
      )}
      {payModal?.kind === "crypto" && (
        <CryptoPayModal
          open
          amount={payModal.price}
          crypto={payModal.crypto}
          busy={busy}
          onPaid={() => void submitOrderReceipt("پرداخت کریپتو — اعلام از داشبورد")}
          onSendReceipt={submitOrderReceipt}
          onCancel={() => setPayModal(null)}
          onCopied={() => setMsg("آدرس کیف پول کپی شد")}
        />
      )}

      <SubQrModal
        open={Boolean(qrSub)}
        title={qrSub ? `QR — ${qrSub.title}` : "QR اشتراک"}
        subUrl={qrSub?.url}
        onClose={() => setQrSub(null)}
      />
    </DashShell>
  );
}
