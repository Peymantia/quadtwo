"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashShell, LoadingScreen, type ShellTab } from "./DashShell";
import { Toast, ConfirmToast } from "./Toast";
import { PasswordSettings } from "./PasswordSettings";
import { PaymentCardBlock, TrafficProgress } from "./PaymentCard";
import { CardPayModal } from "./CardPayModal";
import { Modal } from "./Modal";
import { SortSelect, endingUrgencyDays, sortByMode, type ListSort } from "./SortSelect";
import { api, formatToman, type Role } from "../lib/api";
import { useDashAuth } from "../lib/useDashAuth";
import { RateShop, type RateOrderPayload, type RateShopCatalog } from "./RateShop";
import { AccountCreatedModal, type CreatedAccount } from "./AccountCreatedModal";
import { SubQrModal } from "./SubQrModal";

type PayCard = { number: string; holder: string };
type PayModalState = { orderId: string; price: number; card: PayCard } | null;

const CONFIG_PAGE_SIZES = [10, 20, 30, 50, 100] as const;
type Cell = {
  id: string;
  trafficGb: number | null;
  months: number;
  title: string | null;
  price: number;
  category: string;
  isGolden?: boolean;
};

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
  { key: "settings", label: "تنظیمات", icon: "gear" },
];

export function AgentPanel(props: { title: string; allowed: Role[] }) {
  const { home, loading, reload } = useDashAuth(props.allowed);
  const [tab, setTab] = useState("home");
  const [report, setReport] = useState<{ orders: number; salesLabel: string; panelGroup?: string | null } | null>(null);
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [catLabels, setCatLabels] = useState<Record<string, string>>({});
  const [pricingMode, setPricingMode] = useState<"matrix" | "rate">("matrix");
  const [rateCatalog, setRateCatalog] = useState<RateShopCatalog | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [accountName, setAccountName] = useState("");
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
  const [matrixConfirmOpen, setMatrixConfirmOpen] = useState(false);
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
      void api<{ report: { orders: number; salesLabel: string }; panelGroup: string | null }>("/partner/home").then(
        (r) => setReport({ ...r.report, panelGroup: r.panelGroup }),
      );
    }
    if (tab === "create") {
      void api<{
        cells: Cell[];
        categoryLabels: Record<string, string>;
        categories?: string[];
        maxMonths?: number;
        pricingMode?: "matrix" | "rate";
        defaultLimitIp?: number;
        canEditLimitIp?: boolean;
        volumeRules?: RateShopCatalog["volumeRules"];
      }>("/me/catalog").then((r) => {
        setCells(r.cells);
        setCatLabels(r.categoryLabels ?? {});
        setPricingMode(r.pricingMode === "rate" ? "rate" : "matrix");
        setRateCatalog({
          categories: r.categories ?? [],
          categoryLabels: r.categoryLabels ?? {},
          maxMonths: r.maxMonths ?? 1,
          pricingMode: r.pricingMode === "rate" ? "rate" : "matrix",
          defaultLimitIp: r.defaultLimitIp,
          canEditLimitIp: true,
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
    const base = filter.trim()
      ? configs.filter((c) => (c.code || "").includes(filter) || c.email.includes(filter) || (c.title || "").includes(filter))
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
    });
  }, [configs, filter, configSort]);

  const pagedConfigs = useMemo(() => {
    const start = configPage * configPageSize;
    return filteredSorted.slice(start, start + configPageSize);
  }, [filteredSorted, configPage, configPageSize]);

  useEffect(() => {
    setConfigPage(0);
  }, [filter, configSort, configPageSize]);

  if (loading || !home) return <LoadingScreen />;

  async function create(payWithWallet: boolean) {
    if (!selected) return;
    setMatrixConfirmOpen(false);
    setErr(null);
    setMsg(null);
    setResult(null);
    setBusy(true);
    try {
      const name = accountName.trim() || `p${Date.now().toString(36)}`;
      const r = await api<{
        provisioned?: CreatedAccount;
        order?: { id: string; price: number };
        card?: PayCard;
        error?: string;
      }>("/partner/create", {
        body: {
          trafficGb: selected.trafficGb,
          months: selected.months,
          category: selected.category,
          accountName: name,
          payWithWallet,
        },
      });
      if (r.provisioned?.code) {
        setResult({
          ...r.provisioned,
          categoryLabel: catLabels[selected.category] || selected.category,
          months: selected.months,
          trafficGb: r.provisioned.trafficGb ?? selected.trafficGb,
        });
        setAccountName("");
        await reload();
      } else if (r.order && r.card) {
        setPayCard(r.card);
        setPayModal({ orderId: r.order.id, price: r.order.price, card: r.card });
      } else {
        setMsg(`سفارش ${formatToman(r.order!.price)} ثبت شد`);
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

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
      } else if (r.order && r.card) {
        setPayCard(r.card);
        setPayModal({ orderId: r.order.id, price: r.order.price, card: r.card });
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

  const userLabel = home.user.agentName || (home.user.username ? `@${home.user.username}` : "");

  return (
    <DashShell
      brand={home.brand}
      title={props.title}
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
            const c = confirmRotate;
            setConfirmRotate(null);
            void rotateSubLink(c);
          }}
          onNo={() => setConfirmRotate(null)}
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
              <div className="label">فروش ۳۰ روز اخیر</div>
              <div className="value num">{report?.salesLabel ?? "—"}</div>
            </div>
            <div className="stat">
              <div className="label">سفارش‌های تکمیل‌شده</div>
              <div className="value num">{report?.orders ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">گروه پنل</div>
              <div className="value" style={{ fontSize: "1rem" }}>
                {report?.panelGroup || "—"}
              </div>
            </div>
          </div>
          <div className="panel">
            <h2>دسترسی سریع</h2>
            <div className="quick-actions">
              <button type="button" className="btn primary wide" onClick={() => setTab("create")}>
                ساخت کانفیگ جدید
              </button>
              <button type="button" className="btn light wide" onClick={() => setTab("configs")}>
                مشاهده کانفیگ‌ها
              </button>
              <button type="button" className="btn ghost wide" onClick={() => setTab("wallet")}>
                شارژ کیف پول
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "create" && (
        <>
          <div className="panel">
            <h2>ساخت کانفیگ برای مشتری</h2>
            {pricingMode === "rate" && rateCatalog ? (
              <RateShop catalog={rateCatalog} busy={busy} variant="agent" onSubmit={createRate} />
            ) : (
              <>
                <div className="field">
                  <label>نام اکانت (اختیاری — روی کانفیگ نمایش داده می‌شود)</label>
                  <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="مثلاً ali-mobile" />
                </div>
                <div className="plan-grid">
                  {cells.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="plan-card"
                      style={{
                        cursor: "pointer",
                        textAlign: "right",
                        color: "inherit",
                        borderColor: selected?.id === c.id ? "rgba(56,189,248,0.7)" : undefined,
                        background: selected?.id === c.id ? "rgba(56,189,248,0.09)" : undefined,
                      }}
                      onClick={() => setSelected(c)}
                    >
                      <div className="plan-name">
                        {c.title || (c.trafficGb === null ? "نامحدود" : `${c.trafficGb} گیگ`)}
                      </div>
                      <div className="plan-meta">
                        <span>{catLabels[c.category] || c.category}</span>
                        <span className="num">{c.months} ماه</span>
                      </div>
                      <div className="plan-price num">{formatToman(c.price)}</div>
                    </button>
                  ))}
                </div>
                {!cells.length && <p className="muted">هنوز پلنی برای فروش تنظیم نشده است.</p>}
                <button
                  type="button"
                  className="btn success wide"
                  style={{ marginTop: 14 }}
                  disabled={!selected || busy}
                  onClick={() => setMatrixConfirmOpen(true)}
                >
                  بررسی و پرداخت
                </button>
              </>
            )}
          </div>
          {result?.code && (
            <AccountCreatedModal
              open
              account={result}
              onClose={() => setResult(null)}
              onCopied={() => setMsg("لینک اشتراک کپی شد")}
            />
          )}
        </>
      )}

      {tab === "configs" && (
        <div className="panel">
          <h2>کانفیگ‌های گروه شما</h2>
          <div className="field">
            <label>جستجو</label>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="کد، ایمیل یا عنوان" />
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
                    <strong className="num">{c.email}</strong>{" "}
                    <span className={`badge ${active ? "ok" : "bad"}`}>
                      {expired ? "منقضی" : c.status === "active" ? "فعال" : c.status === "disabled" ? "غیرفعال" : c.status || "—"}
                    </span>
                    {c.title && c.title !== c.email && <div className="muted">{c.title}</div>}
                    {c.code && (
                      <div className="muted num" style={{ marginTop: 4 }}>
                        کد: {c.code}
                      </div>
                    )}
                    <div className="muted" style={{ marginTop: 8 }}>
                      حجم کل:{" "}
                      <strong className="num">
                        {c.trafficGb == null || c.trafficGb <= 0 ? "نامحدود" : `${c.trafficGb} GB`}
                      </strong>
                      {" · "}
                      مصرف‌شده: <strong className="num">{usedLabel}</strong>
                      {" · "}
                      انقضا:{" "}
                      <strong className="num">
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("fa-IR") : "—"}
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
                  {c.note && <div className="muted" style={{ marginTop: 6 }}>نوت: {c.note}</div>}
                  <TrafficProgress usedBytes={c.usedTrafficBytes ?? 0} totalGb={c.trafficGb ?? null} />
                  <div className="config-card-actions">
                    <div className="config-card-actions-row sub-links">
                      <button type="button" className="btn primary sm" disabled={busy || !c.subUrl} onClick={() => void copySubLink(c)}>
                        کپی لینک
                      </button>
                      <button type="button" className="btn ghost sm" disabled={busy || !c.subId} onClick={() => setConfirmRotate(c)}>
                        لینک جدید
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm btn-icon"
                        disabled={busy || !c.subUrl}
                        title="نمایش QR"
                        aria-label="نمایش QR"
                        onClick={() => c.subUrl && setQrSub({ url: c.subUrl, title: c.email })}
                      >
                        📷
                      </button>
                    </div>
                  </div>
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

      {selected && (
        <Modal open={matrixConfirmOpen} title="تأیید ساخت اکانت" onClose={() => setMatrixConfirmOpen(false)}>
          <p className="order-confirm-summary">
            {[
              `اکانت «${accountName.trim() || "رندوم"}»`,
              `نوع: ${catLabels[selected.category] || selected.category}`,
              `حجم: ${selected.trafficGb == null ? "نامحدود" : `${selected.trafficGb.toLocaleString("fa-IR")} گیگابایت`}`,
              `مدت: ${selected.months.toLocaleString("fa-IR")} ماه`,
              `مبلغ: ${formatToman(selected.price)}`,
            ].join("\n")}
          </p>
          <div className="actions order-confirm-actions">
            <button type="button" className="btn seek-pay-wallet" disabled={busy} onClick={() => void create(true)}>
              تأیید و پرداخت از کیف پول
            </button>
            <button type="button" className="btn seek-pay-card" disabled={busy} onClick={() => void create(false)}>
              تأیید و پرداخت کارت به کارت
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setMatrixConfirmOpen(false)}>
              انصراف
            </button>
          </div>
        </Modal>
      )}

      {payModal && (
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

      <SubQrModal
        open={Boolean(qrSub)}
        title={qrSub ? `QR — ${qrSub.title}` : "QR اشتراک"}
        subUrl={qrSub?.url}
        onClose={() => setQrSub(null)}
      />
    </DashShell>
  );
}
