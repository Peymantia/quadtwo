"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatToman } from "../lib/api";

export type SalesPeriod = "today" | "week" | "month" | "jalali_month" | "all";

type SalesStats = {
  period: SalesPeriod;
  periodLabel: string;
  total: number;
  count: number;
  newCount: number;
  renewCount: number;
  avgOrder: number;
  walletChargeTotal?: number;
  walletChargeCount?: number;
  activeSubs: number;
  recent: Array<{
    id: string;
    kind: string;
    price: number;
    at: string;
    who: string | null;
    accountName: string | null;
  }>;
};

type AgentRow = {
  id: string;
  telegramId: string;
  username: string | null;
  agentName: string | null;
  orders: number;
  sales: number;
  newCount: number;
  renewCount: number;
  activeSubs: number;
};

const PERIODS: Array<[SalesPeriod, string]> = [
  ["today", "امروز"],
  ["week", "هفته"],
  ["jalali_month", "ماه جاری"],
  ["month", "۳۰ روز"],
  ["all", "کل"],
];

export function SalesReportPanel({
  endpoint,
  defaultPeriod = "jalali_month",
  showWallet = false,
  title = "گزارش فروش",
}: {
  endpoint: string;
  defaultPeriod?: SalesPeriod;
  showWallet?: boolean;
  title?: string;
}) {
  const [period, setPeriod] = useState<SalesPeriod>(defaultPeriod);
  const [stats, setStats] = useState<SalesStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api<SalesStats>(`${endpoint}?period=${period}`);
      setStats(r);
    } catch (e) {
      setStats(null);
      setErr(String(e instanceof Error ? e.message : e));
    }
  }, [endpoint, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="chip-row" style={{ marginBottom: 13 }}>
        {PERIODS.map(([k, l]) => (
          <button key={k} type="button" className={`chip${period === k ? " on" : ""}`} onClick={() => setPeriod(k)}>
            {l}
          </button>
        ))}
      </div>
      {err && (
        <p className="muted" style={{ color: "var(--pink)" }}>
          {err}
        </p>
      )}
      <div className="grid stats-row-4" style={{ marginBottom: 12 }}>
        <div className="stat accent">
          <div className="label">جمع فروش</div>
          <div className="value num" style={{ fontSize: "1.05rem" }}>
            {stats ? formatToman(stats.total) : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="label">تعداد سفارش</div>
          <div className="value num">{stats?.count ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">خرید / تمدید</div>
          <div className="value num" style={{ fontSize: "1rem" }}>
            {stats ? `${stats.newCount} / ${stats.renewCount}` : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="label">سرویس فعال</div>
          <div className="value num">{stats?.activeSubs ?? "—"}</div>
        </div>
      </div>
      {stats && (
        <p className="muted" style={{ marginTop: 0 }}>
          بازه: {stats.periodLabel}
          {stats.count > 0 ? ` · میانگین سفارش: ${formatToman(stats.avgOrder)}` : ""}
          {showWallet && stats.walletChargeCount != null
            ? ` · شارژ کیف پول: ${stats.walletChargeCount.toLocaleString("fa-IR")} · ${formatToman(stats.walletChargeTotal ?? 0)}`
            : ""}
        </p>
      )}
      {stats?.recent?.length ? (
        <div className="list" style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 650 }}>آخرین سفارش‌ها</p>
          {stats.recent.map((o) => (
            <div key={o.id} className="row-card">
              <div>
                <strong>{o.kind === "renew" ? "تمدید" : "خرید"}</strong>
                <div className="muted">
                  {o.who || o.accountName || "—"} · {new Date(o.at).toLocaleString("fa-IR")}
                </div>
              </div>
              <span className="num">{formatToman(o.price)}</span>
            </div>
          ))}
        </div>
      ) : (
        stats && <p className="muted">سفارشی در این بازه نیست.</p>
      )}
    </div>
  );
}

export function AgentsLeaderboardPanel() {
  const [role, setRole] = useState<"partner" | "wholesale">("partner");
  const [period, setPeriod] = useState<SalesPeriod>("jalali_month");
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [label, setLabel] = useState("");

  useEffect(() => {
    void api<{ rows: AgentRow[]; periodLabel: string }>(
      `/admin/reports/agents?role=${role}&period=${period}`,
    ).then((r) => {
      setRows(r.rows ?? []);
      setLabel(r.periodLabel);
    });
  }, [role, period]);

  return (
    <div className="panel">
      <h2>رتبه‌بندی همکاران / عمده</h2>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        <button type="button" className={`chip${role === "partner" ? " on" : ""}`} onClick={() => setRole("partner")}>
          همکار
        </button>
        <button
          type="button"
          className={`chip${role === "wholesale" ? " on" : ""}`}
          onClick={() => setRole("wholesale")}
        >
          عمده‌فروش
        </button>
      </div>
      <div className="chip-row" style={{ marginBottom: 13 }}>
        {PERIODS.map(([k, l]) => (
          <button key={k} type="button" className={`chip${period === k ? " on" : ""}`} onClick={() => setPeriod(k)}>
            {l}
          </button>
        ))}
      </div>
      {label && <p className="muted" style={{ marginTop: 0 }}>بازه: {label}</p>}
      <div className="list">
        {rows.map((r) => (
          <div key={r.id} className="row-card">
            <div>
              <strong>{r.username ? `@${r.username}` : r.agentName || r.telegramId}</strong>
              <div className="muted">
                {r.orders.toLocaleString("fa-IR")} سفارش (جدید {r.newCount} / تمدید {r.renewCount}) · فعال{" "}
                {r.activeSubs.toLocaleString("fa-IR")}
              </div>
            </div>
            <span className="num">{formatToman(r.sales)}</span>
          </div>
        ))}
        {!rows.length && <p className="muted">موردی نیست.</p>}
      </div>
    </div>
  );
}
