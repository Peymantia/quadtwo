"use client";

import { useEffect, useMemo, useState } from "react";
import { DashShell } from "../../components/DashShell";
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
};

type Cell = {
  id: string;
  category: string;
  trafficGb: number | null;
  months: number;
  title: string | null;
  price: number;
};

type Tab = "home" | "services" | "buy" | "wallet" | "guide" | "settings";

const NAV = [
  { href: "/app", label: "خانه" },
  { href: "/app?tab=services", label: "سرویس‌ها" },
  { href: "/app?tab=buy", label: "خرید" },
  { href: "/app?tab=wallet", label: "کیف پول" },
  { href: "/app?tab=guide", label: "آموزش" },
  { href: "/app?tab=settings", label: "تنظیمات" },
];

export default function UserAppPage() {
  const { home, loading, reload } = useDashAuth(["user", "partner", "wholesale", "admin"]);
  const [tab, setTab] = useState<Tab>("home");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [guide, setGuide] = useState<Record<string, string>>({});
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (q) setTab(q);
  }, []);

  useEffect(() => {
    if (!home) return;
    if (tab === "services" || tab === "home") {
      void api<{ subscriptions: Sub[] }>("/me/subscriptions").then((r) => setSubs(r.subscriptions));
    }
    if (tab === "buy") {
      void api<{ cells: Cell[] }>("/me/catalog").then((r) => setCells(r.cells));
    }
    if (tab === "guide") {
      void api<{ guide: Record<string, string> }>("/me/guide").then((r) => setGuide(r.guide));
    }
  }, [home, tab]);

  const userLabel = useMemo(() => {
    if (!home) return "";
    return home.user.username ? `@${home.user.username}` : home.user.firstName || home.user.telegramId || "";
  }, [home]);

  if (loading || !home) {
    return (
      <div className="login-page">
        <p className="muted">در حال بارگذاری…</p>
      </div>
    );
  }

  async function buy(payWithWallet: boolean) {
    if (!selected) return;
    setErr(null);
    setMsg(null);
    try {
      const r = await api<{
        order?: { id: string; price: number; summary?: string };
        card?: { number: string; holder: string };
        provisioned?: unknown;
        error?: string;
      }>("/me/orders", {
        body: {
          trafficGb: selected.trafficGb,
          months: selected.months,
          payWithWallet,
        },
      });
      if (r.provisioned) {
        setMsg("سرویس با موفقیت ساخته شد");
        await reload();
        setTab("services");
      } else {
        setMsg(
          `سفارش ثبت شد (${formatToman(r.order!.price)}). کارت: ${r.card?.number ?? "—"} — ${r.card?.holder ?? ""}. پس از واریز رسید را در ربات بفرستید یا از کیف پول پرداخت کنید.`,
        );
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  async function claimTest() {
    setErr(null);
    try {
      const r = await api<{ subscription: { subUrl: string; code: string } }>("/me/test");
      setMsg(`تست فعال شد: ${r.subscription.code}`);
      await reload();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  async function savePassword() {
    setErr(null);
    try {
      await api("/me/password", { body: { password, currentPassword: currentPassword || undefined } });
      setMsg("رمز ذخیره شد");
      setPassword("");
      setCurrentPassword("");
      await reload();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <DashShell
      title={home.brand}
      role={home.user.role}
      userLabel={userLabel}
      nav={NAV.map((n) => ({
        ...n,
        href: n.href,
      }))}
    >
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {(
          [
            ["home", "خانه"],
            ["services", "سرویس‌ها"],
            ["buy", "خرید"],
            ["wallet", "کیف پول"],
            ["guide", "آموزش"],
            ["settings", "تنظیمات"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={`chip${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}

      {tab === "home" && (
        <>
          <div className="grid">
            <div className="stat">
              <div className="label">موجودی</div>
              <div className="value">{formatToman(home.wallet.balance)}</div>
            </div>
            <div className="stat">
              <div className="label">سرویس فعال</div>
              <div className="value">{home.stats.active}</div>
            </div>
            <div className="stat">
              <div className="label">کل سرویس‌ها</div>
              <div className="value">{home.stats.subscriptions}</div>
            </div>
          </div>
          <div className="panel">
            <h2>اقدام سریع</h2>
            <div className="actions">
              <button type="button" className="btn primary" style={{ width: "auto" }} onClick={() => setTab("buy")}>
                خرید سرویس
              </button>
              <button type="button" className="btn ghost" onClick={() => setTab("services")}>
                سرویس‌های من
              </button>
              {!home.user.testClaimed && (
                <button type="button" className="btn ghost" onClick={claimTest}>
                  دریافت تست
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "services" && (
        <div className="panel">
          <h2>سرویس‌های من</h2>
          <div className="list">
            {subs.map((s) => (
              <div key={s.id} className="row-card">
                <div>
                  <strong>{s.code}</strong>
                  <div className="muted">
                    {s.trafficLabel} · تا {new Date(s.expiresAt).toLocaleDateString("fa-IR")} · {s.status}
                  </div>
                  {s.subUrl && (
                    <a className="muted" href={s.subUrl} target="_blank" rel="noreferrer">
                      لینک ساب
                    </a>
                  )}
                  <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                    <label>یادداشت</label>
                    <input
                      value={noteEdits[s.id] ?? s.note ?? ""}
                      onChange={(e) => setNoteEdits((m) => ({ ...m, [s.id]: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn ghost"
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
                    className="btn ghost"
                    onClick={async () => {
                      await api(`/me/subscriptions/${s.id}/rotate-sub`);
                      setMsg("لینک ساب چرخانده شد");
                      const r = await api<{ subscriptions: Sub[] }>("/me/subscriptions");
                      setSubs(r.subscriptions);
                    }}
                  >
                    چرخش لینک
                  </button>
                </div>
              </div>
            ))}
            {!subs.length && <p className="muted">سرویسی ندارید.</p>}
          </div>
        </div>
      )}

      {tab === "buy" && (
        <div className="panel">
          <h2>خرید سرویس</h2>
          <div className="list">
            {cells.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`row-card${selected?.id === c.id ? " on" : ""}`}
                onClick={() => setSelected(c)}
                style={{ cursor: "pointer", textAlign: "right", width: "100%" }}
              >
                <div>
                  <strong>
                    {c.title || `${c.trafficGb ?? "∞"}GB / ${c.months} ماه`}
                  </strong>
                  <div className="muted">{c.category}</div>
                </div>
                <strong>{formatToman(c.price)}</strong>
              </button>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn primary" style={{ width: "auto" }} disabled={!selected} onClick={() => buy(true)}>
              پرداخت از کیف پول
            </button>
            <button type="button" className="btn ghost" disabled={!selected} onClick={() => buy(false)}>
              کارت به کارت
            </button>
          </div>
        </div>
      )}

      {tab === "wallet" && (
        <WalletPanel balance={home.wallet.balance} />
      )}

      {tab === "guide" && (
        <div className="panel">
          <h2>آموزش و پشتیبانی</h2>
          <p className="muted">پشتیبانی: {guide.support_username ? `@${guide.support_username}` : home.support || "—"}</p>
          <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>
            {guide.guide_text || "متن راهنما هنوز تنظیم نشده."}
          </pre>
          <div className="actions">
            {guide.guide_android && (
              <a className="btn ghost" href={guide.guide_android} target="_blank" rel="noreferrer">
                اندروید
              </a>
            )}
            {guide.guide_ios && (
              <a className="btn ghost" href={guide.guide_ios} target="_blank" rel="noreferrer">
                iOS
              </a>
            )}
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className="panel">
          <h2>رمز ورود وب</h2>
          {home.user.hasPassword && (
            <div className="field">
              <label>رمز فعلی</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label>رمز جدید (حداقل ۸ کاراکتر)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="button" className="btn primary" style={{ width: "auto" }} onClick={savePassword}>
            ذخیره رمز
          </button>
        </div>
      )}
    </DashShell>
  );
}

function WalletPanel({ balance }: { balance: number }) {
  const [txs, setTxs] = useState<Array<{ id: string; type: string; amount: number; createdAt: string }>>([]);
  useEffect(() => {
    void api<{ balance: number; txs: typeof txs }>("/me/wallet").then((r) => setTxs(r.txs));
  }, []);
  return (
    <div className="panel">
      <h2>کیف پول</h2>
      <p className="value" style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem" }}>
        {formatToman(balance)}
      </p>
      <div className="list" style={{ marginTop: 12 }}>
        {txs.map((t) => (
          <div key={t.id} className="row-card">
            <span>{t.type}</span>
            <span>{formatToman(t.amount)}</span>
          </div>
        ))}
        {!txs.length && <p className="muted">تراکنشی نیست.</p>}
      </div>
    </div>
  );
}
