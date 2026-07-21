"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashShell, LoadingScreen, type ShellTab } from "../../components/DashShell";
import { Toast } from "../../components/Toast";
import { PasswordSettings } from "../../components/PasswordSettings";
import { api, formatToman } from "../../lib/api";
import { useDashAuth } from "../../lib/useDashAuth";

type Sub = {
  id: string;
  code: string;
  email: string;
  title: string | null;
  note: string | null;
  trafficLabel: string;
  expiresAt: string;
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
  const [cells, setCells] = useState<Cell[]>([]);
  const [catLabels, setCatLabels] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState<Record<string, string>>({});
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [card, setCard] = useState<{ number: string; holder: string } | null>(null);

  const loadSubs = useCallback(
    () => api<{ subscriptions: Sub[] }>("/me/subscriptions").then((r) => setSubs(r.subscriptions)),
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
    if (tab === "shop") {
      void api<{ cells: Cell[]; categoryLabels: Record<string, string> }>("/me/catalog").then((r) => {
        setCells(r.cells);
        setCatLabels(r.categoryLabels ?? {});
      });
    }
    if (tab === "subs") void loadSubs();
    if (tab === "wallet") {
      void api<{ orders: OrderRow[] }>("/me/orders").then((r) => setOrders(r.orders));
    }
    if (tab === "support") {
      void api<{ guide: Record<string, string> }>("/me/guide").then((r) => setGuide(r.guide));
    }
  }, [home, tab, loadSubs]);

  const userLabel = useMemo(() => {
    if (!home) return "";
    return home.user.username ? `@${home.user.username}` : home.user.firstName || home.user.telegramId || "";
  }, [home]);

  if (loading || !home) return <LoadingScreen />;

  async function buy(cell: Cell, payWithWallet: boolean) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api<{
        order?: { id: string; price: number };
        card?: { number: string; holder: string };
        provisioned?: unknown;
      }>("/me/orders", {
        body: { trafficGb: cell.trafficGb, months: cell.months, payWithWallet },
      });
      if (r.provisioned) {
        setMsg("سرویس با موفقیت ساخته شد ✅ از تب «اشتراک‌ها» ببینید.");
        await reload();
      } else {
        setCard(r.card ?? null);
        setMsg(
          `سفارش ثبت شد (${formatToman(r.order!.price)}). مبلغ را کارت‌به‌کارت کنید و رسید را در ربات بفرستید؛ یا موجودی کیف پول را شارژ و از آن پرداخت کنید.`,
        );
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
      const r = await api<{ order: { id: string; price: number }; card: { number: string; holder: string } }>(
        "/me/wallet/charge",
        { body: { amount, note: chargeNote || undefined } },
      );
      setCard(r.card);
      setMsg(
        `درخواست شارژ ${formatToman(r.order.price)} ثبت شد. مبلغ را به کارت زیر واریز کنید؛ پس از تأیید ادمین موجودی اضافه می‌شود.`,
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

  const cellsByCat = cells.reduce<Record<string, Cell[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

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

          {Object.entries(cellsByCat).map(([cat, list]) => (
            <div className="panel" key={cat}>
              <h2>{catLabels[cat] || cat}</h2>
              <div className="plan-grid">
                {list.map((c) => (
                  <div key={c.id} className={`plan-card${c.isGolden ? " golden" : ""}`}>
                    <div className="plan-name">
                      {c.title || (c.trafficGb === null ? "نامحدود" : `${c.trafficGb} گیگ`)}
                      {c.isGolden && " ⭐"}
                    </div>
                    <div className="plan-meta">
                      <span>مدت</span>
                      <span className="num">{c.months} ماه</span>
                    </div>
                    <div className="plan-meta">
                      <span>حجم</span>
                      <span className="num">{c.trafficGb === null ? "∞" : `${c.trafficGb} GB`}</span>
                    </div>
                    <div className="plan-price num">{formatToman(c.price)}</div>
                    <div className="actions">
                      <button type="button" className="btn light" style={{ flex: 1 }} disabled={busy} onClick={() => buy(c, true)}>
                        خرید با کیف پول
                      </button>
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => buy(c, false)}>
                        کارت به کارت
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!cells.length && (
            <div className="panel">
              <p className="muted" style={{ margin: 0 }}>
                هنوز پلنی برای فروش تنظیم نشده است.
              </p>
            </div>
          )}
          {card && (
            <div className="panel">
              <h2>اطلاعات واریز</h2>
              <p className="muted">
                شماره کارت: <strong className="num">{card.number}</strong> — {card.holder}
              </p>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  void navigator.clipboard.writeText(card.number.replace(/[^\d]/g, ""));
                  setMsg("شماره کارت کپی شد");
                }}
              >
                کپی شماره کارت
              </button>
            </div>
          )}
        </>
      )}

      {tab === "subs" && (
        <div className="panel">
          <h2>سرویس‌های من</h2>
          <div className="list">
            {subs.map((s) => {
              const expired = new Date(s.expiresAt) < new Date();
              return (
                <div key={s.id} className="row-card" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <strong className="num">{s.code}</strong>{" "}
                    <span className={`badge ${expired || s.status !== "active" ? "bad" : "ok"}`}>
                      {expired ? "منقضی" : s.status === "active" ? "فعال" : s.status}
                    </span>
                    {s.isTest && <span className="badge info">تست</span>}
                    <div className="muted" style={{ marginTop: 5 }}>
                      {s.trafficLabel} · انقضا {new Date(s.expiresAt).toLocaleDateString("fa-IR")}
                    </div>
                    <div className="field" style={{ marginTop: 9, marginBottom: 0 }}>
                      <label>یادداشت شخصی</label>
                      <input
                        value={noteEdits[s.id] ?? s.note ?? ""}
                        onChange={(e) => setNoteEdits((m) => ({ ...m, [s.id]: e.target.value }))}
                        placeholder="مثلاً: گوشی مامان"
                      />
                    </div>
                  </div>
                  <div className="actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
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
                      onClick={async () => {
                        await api(`/me/subscriptions/${s.id}/note`, {
                          method: "PATCH",
                          body: { note: noteEdits[s.id] ?? s.note },
                        });
                        setMsg("یادداشت ذخیره شد");
                      }}
                    >
                      ذخیره یادداشت
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={async () => {
                        try {
                          await api(`/me/subscriptions/${s.id}/rotate-sub`);
                          setMsg("لینک اشتراک جدید ساخته شد");
                          await loadSubs();
                        } catch (e) {
                          setErr(String(e instanceof Error ? e.message : e));
                        }
                      }}
                    >
                      تعویض لینک
                    </button>
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
              مبلغ را وارد و درخواست ثبت کنید؛ سپس به کارت اعلام‌شده واریز کنید. پس از تأیید ادمین موجودی اضافه می‌شود.
            </p>
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
            {card && (
              <p className="muted" style={{ marginTop: 12 }}>
                کارت مقصد: <strong className="num">{card.number}</strong> — {card.holder}
              </p>
            )}
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
                className="btn primary"
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
            <pre className="muted" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "0 0 12px" }}>
              {guide.guide_text || "متن راهنما هنوز تنظیم نشده."}
            </pre>
            <div className="actions">
              {guide.guide_android && (
                <a className="btn ghost sm" href={guide.guide_android} target="_blank" rel="noreferrer">
                  اندروید
                </a>
              )}
              {guide.guide_ios && (
                <a className="btn ghost sm" href={guide.guide_ios} target="_blank" rel="noreferrer">
                  iOS
                </a>
              )}
              {guide.guide_windows && (
                <a className="btn ghost sm" href={guide.guide_windows} target="_blank" rel="noreferrer">
                  ویندوز
                </a>
              )}
              {guide.guide_mac && (
                <a className="btn ghost sm" href={guide.guide_mac} target="_blank" rel="noreferrer">
                  مک
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
    </DashShell>
  );
}
