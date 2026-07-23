"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashShell, LoadingScreen, type ShellTab } from "../../components/DashShell";
import { Toast, ConfirmToast } from "../../components/Toast";
import { PasswordSettings } from "../../components/PasswordSettings";
import { CardPayModal } from "../../components/CardPayModal";
import { PaymentCardBlock, TrafficProgress } from "../../components/PaymentCard";
import { SortSelect, endingUrgencyDays, sortByMode, type ListSort } from "../../components/SortSelect";
import { api, formatToman } from "../../lib/api";
import { useDashAuth } from "../../lib/useDashAuth";
import { RateShop, type RateOrderPayload, type RateShopCatalog } from "../../components/RateShop";
import { RenewModal, type RenewInfo } from "../../components/RenewModal";

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

type PayModalState = {
  orderId: string;
  price: number;
  card: PayCard;
} | null;

const TABS: ShellTab[] = [
  { key: "shop", label: "فروشگاه", icon: "shop" },
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
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState<Record<string, string>>({});
  const [guidePlatform, setGuidePlatform] = useState<"android" | "ios" | "windows" | "macos">("android");
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [payCard, setPayCard] = useState<PayCard | null>(null);
  const [payModal, setPayModal] = useState<PayModalState>(null);
  const [subSort, setSubSort] = useState<ListSort>("newest");
  const [renewInfo, setRenewInfo] = useState<RenewInfo | null>(null);
  const [confirmRotateId, setConfirmRotateId] = useState<string | null>(null);

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
        volumeRules?: RateShopCatalog["volumeRules"];
      }>("/me/catalog").then((r) => {
        setRateCatalog({
          categories: r.categories ?? [],
          categoryLabels: r.categoryLabels ?? {},
          maxMonths: r.maxMonths ?? 1,
          pricingMode: r.pricingMode === "rate" ? "rate" : "matrix",
          defaultLimitIp: r.defaultLimitIp,
          canEditLimitIp: r.canEditLimitIp,
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

  async function buyRate(payload: RateOrderPayload) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api<{
        order?: { id: string; price: number };
        card?: PayCard;
        provisioned?: unknown;
      }>("/me/orders", {
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
      if (r.provisioned) {
        setMsg("سرویس با موفقیت ساخته شد ✅ از تب «اشتراک‌ها» ببینید.");
        await reload();
      } else if (r.order && r.card) {
        setPayCard(r.card);
        setPayModal({ orderId: r.order.id, price: r.order.price, card: r.card });
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

  async function submitRenew(payload: {
    trafficGb: number | null;
    months: number;
    category: string;
    payWithWallet: boolean;
  }) {
    if (!renewInfo) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api<{
        order?: { id: string; price: number };
        card?: PayCard;
        provisioned?: unknown;
      }>("/me/orders", {
        body: {
          kind: "renew",
          targetSubId: renewInfo.subscription.id,
          trafficGb: payload.trafficGb,
          months: payload.months,
          category: payload.category,
          accountName: renewInfo.subscription.email,
          payWithWallet: payload.payWithWallet,
        },
      });
      setRenewInfo(null);
      if (r.provisioned) {
        setMsg("سرویس با موفقیت تمدید شد ✅");
        await reload();
        await loadSubs();
      } else if (r.order && r.card) {
        setPayCard(r.card);
        setPayModal({ orderId: r.order.id, price: r.order.price, card: r.card });
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
          ? "فروشگاه"
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
    >
      <Toast msg={msg} err={err} onClear={clearFlash} />
      {confirmRotateId && (
        <ConfirmToast
          message="با تغییر لینک ساب، اتصال فعلی قطع می‌شود. ادامه می‌دهید؟"
          onYes={() => {
            const id = confirmRotateId;
            setConfirmRotateId(null);
            void (async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await api<{ subUrl?: string | null }>(`/me/subscriptions/${id}/rotate-sub`, {
                  method: "POST",
                });
                if (r.subUrl) {
                  await navigator.clipboard.writeText(r.subUrl);
                  setMsg("لینک ساب جدید ساخته و کپی شد");
                } else {
                  setMsg("لینک اشتراک جدید ساخته شد");
                }
                await loadSubs();
              } catch (e) {
                setErr(String(e instanceof Error ? e.message : e));
              } finally {
                setBusy(false);
              }
            })();
          }}
          onNo={() => setConfirmRotateId(null)}
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

          {rateCatalog && rateCatalog.categories.length > 0 ? (
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
            }).map((s) => {
              const expired = new Date(s.expiresAt) < new Date();
              const totalGb = s.isTest ? 0.25 : s.trafficGb;
              const remain = Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 86400000);
              const used = s.usedTrafficBytes ?? 0;
              const usedLabel =
                used <= 0 ? "۰" : used >= 1024 ** 3 ? `${(used / 1024 ** 3).toFixed(2)} GB` : `${Math.round(used / 1024 ** 2)} MB`;
              return (
                <div key={s.id} className="row-card" style={{ alignItems: "flex-start", flexDirection: "column" }}>
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
                        {totalGb == null || totalGb <= 0 ? "نامحدود" : `${totalGb} GB`}
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
                    <div className="note-row">
                      <div className="field">
                        <label>یادداشت شخصی</label>
                        <input
                          value={noteEdits[s.id] ?? s.note ?? ""}
                          onChange={(e) => setNoteEdits((m) => ({ ...m, [s.id]: e.target.value }))}
                          placeholder="یادداشت…"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={async () => {
                          await api(`/me/subscriptions/${s.id}/note`, {
                            method: "PATCH",
                            body: { note: noteEdits[s.id] ?? s.note },
                          });
                          setMsg("یادداشت ذخیره شد");
                        }}
                      >
                        ذخیره
                      </button>
                    </div>
                  </div>
                  <div className="config-card-actions" style={{ width: "100%", marginTop: 10 }}>
                    {!s.isTest && (
                      <div className="config-card-actions-row">
                        <button
                          type="button"
                          className="btn success sm"
                          disabled={busy}
                          onClick={() => void openRenew(s.id)}
                        >
                          تمدید
                        </button>
                      </div>
                    )}
                    <div className="config-card-actions-row">
                      {s.subUrl && (
                        <button
                          type="button"
                          className="btn primary sm"
                          onClick={() => {
                            void navigator.clipboard.writeText(s.subUrl!);
                            setMsg("لینک اشتراک کپی شد");
                          }}
                        >
                          کپی لینک اشتراک
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={() => setConfirmRotateId(s.id)}
                      >
                        تغییر لینک ساب
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!subs.length && <p className="muted">هنوز سرویسی ندارید — از فروشگاه شروع کنید.</p>}
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

      {payModal && (
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
    </DashShell>
  );
}
