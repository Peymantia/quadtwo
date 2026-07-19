"use client";

import { useEffect, useState } from "react";
import { DashShell } from "../../components/DashShell";
import { api, formatToman } from "../../lib/api";
import { useDashAuth } from "../../lib/useDashAuth";

type Cell = { id: string; trafficGb: number | null; months: number; title: string | null; price: number };

export default function ResellerPage() {
  const { home, loading, reload } = useDashAuth(["wholesale", "admin"]);
  const [report, setReport] = useState<{ orders: number; salesLabel: string; panelGroup?: string | null } | null>(null);
  const [configs, setConfigs] = useState<Array<{ email: string; code: string | null; status: string | null }>>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [accountName, setAccountName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!home) return;
    void api<{ report: { orders: number; salesLabel: string }; panelGroup: string | null }>("/partner/home").then((r) =>
      setReport({ ...r.report, panelGroup: r.panelGroup }),
    );
    void api<{ items: typeof configs }>("/partner/configs").then((r) => setConfigs(r.items ?? []));
    void api<{ cells: Cell[] }>("/me/catalog").then((r) => setCells(r.cells));
  }, [home]);

  if (loading || !home) {
    return (
      <div className="login-page">
        <p className="muted">در حال بارگذاری…</p>
      </div>
    );
  }

  async function create() {
    if (!selected) return;
    setErr(null);
    try {
      const r = await api<{ provisioned?: unknown; order?: { price: number } }>("/partner/create", {
        body: {
          trafficGb: selected.trafficGb,
          months: selected.months,
          accountName: accountName || undefined,
          payWithWallet: true,
        },
      });
      setMsg(r.provisioned ? "کانفیگ ساخته شد" : `سفارش ${formatToman(r.order!.price)} ثبت شد`);
      await reload();
      const cfg = await api<{ items: typeof configs }>("/partner/configs");
      setConfigs(cfg.items ?? []);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <DashShell
      title="پنل ریسلر"
      role={home.user.role}
      userLabel={home.user.agentName || home.user.username || ""}
      nav={[
        { href: "/reseller", label: "ریسلر" },
        { href: "/app", label: "حساب من" },
      ]}
    >
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}
      <div className="grid">
        <div className="stat">
          <div className="label">فروش ۳۰ روز</div>
          <div className="value">{report?.salesLabel ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">گروه پنل</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {report?.panelGroup || "—"}
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>ساخت کانفیگ (قیمت عمده)</h2>
        <div className="field">
          <label>نام اکانت</label>
          <input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </div>
        <div className="list">
          {cells.map((c) => (
            <button
              key={c.id}
              type="button"
              className="row-card"
              style={{ width: "100%", textAlign: "right", borderColor: selected?.id === c.id ? "var(--signal)" : undefined }}
              onClick={() => setSelected(c)}
            >
              <span>{c.title || `${c.trafficGb ?? "∞"}GB / ${c.months}م`}</span>
              <strong>{formatToman(c.price)}</strong>
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" style={{ width: "auto", marginTop: 12 }} disabled={!selected} onClick={create}>
          ساخت با کیف پول
        </button>
      </div>
      <div className="panel">
        <h2>کانفیگ‌ها</h2>
        <div className="list">
          {configs.map((c) => (
            <div key={c.email} className="row-card">
              <div>
                <strong>{c.code || c.email}</strong>
                <div className="muted">{c.email}</div>
              </div>
              <span className="muted">{c.status || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </DashShell>
  );
}
