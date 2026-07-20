"use client";

import { useCallback, useEffect, useState } from "react";
import { DashShell, LoadingScreen, type ShellTab } from "./DashShell";
import { api, formatToman, type Role } from "../lib/api";
import { useDashAuth } from "../lib/useDashAuth";

type Cell = {
  id: string;
  trafficGb: number | null;
  months: number;
  title: string | null;
  price: number;
  category: string;
  isGolden?: boolean;
};

type ConfigItem = { email: string; code: string | null; subId: string | null; status: string | null };

const TABS: ShellTab[] = [
  { key: "home", label: "داشبورد", icon: "home" },
  { key: "create", label: "ساخت کانفیگ", icon: "shop" },
  { key: "configs", label: "کانفیگ‌ها", icon: "wifi" },
  { key: "wallet", label: "کیف پول", icon: "wallet" },
];

export function AgentPanel(props: { title: string; allowed: Role[] }) {
  const { home, loading, reload } = useDashAuth(props.allowed);
  const [tab, setTab] = useState("home");
  const [report, setReport] = useState<{ orders: number; salesLabel: string; panelGroup?: string | null } | null>(null);
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [catLabels, setCatLabels] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Cell | null>(null);
  const [accountName, setAccountName] = useState("");
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code?: string; subUrl?: string | null } | null>(null);
  const [chargeAmount, setChargeAmount] = useState("");
  const [card, setCard] = useState<{ number: string; holder: string } | null>(null);
  const [txs, setTxs] = useState<Array<{ id: string; type: string; amount: number; createdAt: string; note?: string | null }>>([]);

  const loadConfigs = useCallback(
    () => api<{ items: ConfigItem[] }>("/partner/configs").then((r) => setConfigs(r.items ?? [])),
    [],
  );

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
      void api<{ cells: Cell[]; categoryLabels: Record<string, string> }>("/me/catalog").then((r) => {
        setCells(r.cells);
        setCatLabels(r.categoryLabels ?? {});
      });
    }
    if (tab === "configs") void loadConfigs();
    if (tab === "wallet") {
      void api<{ txs: typeof txs }>("/me/wallet").then((r) => setTxs(r.txs));
    }
  }, [home, tab, loadConfigs]);

  if (loading || !home) return <LoadingScreen />;

  async function create() {
    if (!selected) return;
    setErr(null);
    setMsg(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await api<{
        provisioned?: { code?: string; subUrl?: string | null };
        order?: { price: number };
        error?: string;
      }>("/partner/create", {
        body: {
          trafficGb: selected.trafficGb,
          months: selected.months,
          accountName: accountName.trim() || undefined,
          payWithWallet: true,
        },
      });
      if (r.provisioned) {
        setResult(r.provisioned);
        setMsg("کانفیگ با موفقیت ساخته شد ✅");
        setAccountName("");
        await reload();
      } else {
        setMsg(`سفارش ${formatToman(r.order!.price)} ثبت شد`);
      }
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
      setCard(r.card);
      setMsg(`درخواست شارژ ${formatToman(r.order.price)} ثبت شد — پس از واریز و تأیید ادمین اعمال می‌شود.`);
      setChargeAmount("");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const filtered = filter.trim()
    ? configs.filter((c) => (c.code || "").includes(filter) || c.email.includes(filter))
    : configs;

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
    >
      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert err">{err}</div>}

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
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => setTab("create")}>
                ساخت کانفیگ جدید
              </button>
              <button type="button" className="btn ghost" onClick={() => setTab("configs")}>
                مشاهده کانفیگ‌ها
              </button>
              <button type="button" className="btn ghost" onClick={() => setTab("wallet")}>
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
            <div className="field">
              <label>نام اکانت (اختیاری — روی کانفیگ نمایش داده می‌شود)</label>
              <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="مثلاً ali-mobile" />
            </div>
            <div className="plan-grid">
              {cells.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`plan-card${selected?.id === c.id ? "" : ""}`}
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
            <button
              type="button"
              className="btn success wide"
              style={{ marginTop: 14 }}
              disabled={!selected || busy}
              onClick={create}
            >
              ساخت و پرداخت از کیف پول
            </button>
          </div>
          {result?.code && (
            <div className="panel">
              <h2>کانفیگ ساخته شد</h2>
              <p className="muted">
                کد: <strong className="num">{result.code}</strong>
              </p>
              {result.subUrl && (
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.subUrl!);
                    setMsg("لینک اشتراک کپی شد");
                  }}
                >
                  کپی لینک اشتراک
                </button>
              )}
            </div>
          )}
        </>
      )}

      {tab === "configs" && (
        <div className="panel">
          <h2>کانفیگ‌های گروه شما</h2>
          <div className="field">
            <label>جستجو</label>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="کد یا ایمیل کانفیگ" />
          </div>
          <div className="list">
            {filtered.map((c) => (
              <div key={c.email} className="row-card">
                <div>
                  <strong className="num">{c.code || c.email}</strong>
                  <div className="muted num">{c.email}</div>
                </div>
                <span className={`badge ${c.status === "active" ? "ok" : c.status ? "bad" : "info"}`}>
                  {c.status === "active" ? "فعال" : c.status || "پنل"}
                </span>
              </div>
            ))}
            {!filtered.length && <p className="muted">کانفیگی یافت نشد.</p>}
          </div>
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
            <button type="button" className="btn success" disabled={busy} onClick={requestCharge}>
              ثبت درخواست شارژ
            </button>
            {card && (
              <p className="muted" style={{ marginTop: 12 }}>
                کارت مقصد: <strong className="num">{card.number}</strong> — {card.holder}
              </p>
            )}
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
    </DashShell>
  );
}
