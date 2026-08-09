"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatToman } from "../lib/api";
import { formatTrafficGbFa } from "../lib/format-ui";
import { Modal } from "./Modal";

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
  discountTotal?: number;
  discountOrderCount?: number;
  topDiscountCodes?: Array<{ code: string; uses: number; saved: number }>;
  recent: Array<{
    id: string;
    kind: string;
    price: number;
    at: string;
    who: string | null;
    accountName: string | null;
    email: string | null;
    botSubId: string | null;
    trafficGb: number | null;
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

export type AccountFullPayload = {
  source: "live" | "archive";
  archiveId: string | null;
  restoredAt: string | null;
  text: string;
  detail: {
    email: string;
    uuid: string | null;
    password: string | null;
    panelSubId: string | null;
    hysteriaAuth: string | null;
    trafficGb: number | null;
    remainTrafficLabel: string;
    limitIp: number;
    expiresAt: string | null;
    remainDays: number | null;
    comment: string | null;
    inboundIds: number[];
    notes: string | null;
    title: string | null;
    code: string | null;
    botSubId: string | null;
    subUrl: string | null;
    ownerLabel: string | null;
  };
};

const PERIODS: Array<[SalesPeriod, string]> = [
  ["today", "امروز"],
  ["week", "هفته"],
  ["jalali_month", "ماه جاری"],
  ["month", "۳۰ روز"],
  ["all", "کل"],
];

export function AccountDetailModal({
  open,
  onClose,
  email,
  subId,
  archiveId,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  email?: string | null;
  subId?: string | null;
  archiveId?: string | null;
  onRestored?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AccountFullPayload | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr(null);
    setData(null);
    const q = new URLSearchParams();
    if (email) q.set("email", email);
    if (subId) q.set("subId", subId);
    if (archiveId) q.set("archiveId", archiveId);
    void api<AccountFullPayload>(`/admin/accounts/full?${q}`)
      .then(setData)
      .catch((e) => setErr(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open, email, subId, archiveId]);

  async function restore() {
    const id = data?.archiveId || archiveId;
    if (!id) return;
    setRestoring(true);
    try {
      const r = await api<{ message: string }>(`/admin/archives/${id}/restore`, { method: "POST", body: {} });
      onRestored?.();
      onClose();
      alert(r.message);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRestoring(false);
    }
  }

  const d = data?.detail;
  const title = d ? `جزئیات اکانت — ${d.email}` : "جزئیات اکانت";

  return (
    <Modal open={open} title={title} onClose={onClose} wide>
      {loading && <p className="muted">در حال بارگذاری…</p>}
      {err && (
        <p className="muted" style={{ color: "var(--pink)" }}>
          {err}
        </p>
      )}
      {d && (
        <>
          {data?.source === "archive" && (
            <p className="muted" style={{ marginTop: 0 }}>
              از آرشیو حذف{data.restoredAt ? " (قبلاً بازگردانی شده)" : ""}
            </p>
          )}
          <pre className="acct-detail-pre">{data?.text}</pre>
          {data?.source === "archive" && data.archiveId && !data.restoredAt && (
            <button type="button" className="btn success" disabled={restoring} onClick={() => void restore()}>
              {restoring ? "در حال بازگردانی…" : "بازگردانی به دیتابیس / پنل"}
            </button>
          )}
        </>
      )}
    </Modal>
  );
}

export function SalesReportPanel({
  endpoint,
  defaultPeriod = "jalali_month",
  showWallet = false,
  title = "گزارش فروش",
  showAccountDetail,
}: {
  endpoint: string;
  defaultPeriod?: SalesPeriod;
  showWallet?: boolean;
  title?: string;
  /** Admin-only full account snapshot modal */
  showAccountDetail?: boolean;
}) {
  const allowDetail = showAccountDetail ?? endpoint.includes("/admin/");
  const [period, setPeriod] = useState<SalesPeriod>(defaultPeriod);
  const [stats, setStats] = useState<SalesStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{
    email?: string | null;
    subId?: string | null;
  }>({});

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

  function openDetail(o: SalesStats["recent"][number]) {
    if (!allowDetail || (!o.email && !o.botSubId)) return;
    setDetailTarget({ email: o.email, subId: o.botSubId });
    setDetailOpen(true);
  }

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
          {stats.discountOrderCount
            ? ` · تخفیف: ${stats.discountOrderCount.toLocaleString("fa-IR")} سفارش · ${formatToman(stats.discountTotal ?? 0)}`
            : ""}
        </p>
      )}
      {stats?.topDiscountCodes && stats.topDiscountCodes.length > 0 && (
        <div className="discount-top-codes" aria-label="پرکاربردترین کدهای تخفیف">
          {stats.topDiscountCodes.map((c) => (
            <span key={c.code} className="chip on">
              <strong className="num">{c.code}</strong>
              <span className="muted">
                {c.uses.toLocaleString("fa-IR")}× · −{formatToman(c.saved)}
              </span>
            </span>
          ))}
        </div>
      )}
      {stats?.recent?.length ? (
        <div className="list" style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 650 }}>آخرین سفارش‌ها</p>
          {stats.recent.map((o) => {
            const acct = o.email || o.accountName;
            const canDetail = allowDetail && Boolean(o.email || o.botSubId);
            return (
              <div key={o.id} className="row-card" style={{ alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {o.kind === "renew" ? "تمدید" : "خرید"}
                    {acct ? `: ${acct}` : ""}
                  </strong>
                  <div className="muted">
                    {o.who ? `${o.who} · ` : ""}
                    {o.trafficGb === undefined
                      ? ""
                      : o.trafficGb == null || o.trafficGb <= 0
                        ? "∞ · "
                        : `${formatTrafficGbFa(o.trafficGb)} · `}
                    {new Date(o.at).toLocaleString("fa-IR")}
                  </div>
                  {canDetail && (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginTop: 8, padding: "4px 10px", fontSize: "0.82rem" }}
                      onClick={() => openDetail(o)}
                    >
                      مشاهده جزئیات
                    </button>
                  )}
                </div>
                <span className="num">{formatToman(o.price)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        stats && <p className="muted">سفارشی در این بازه نیست.</p>
      )}
      {allowDetail && (
        <AccountDetailModal
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          email={detailTarget.email}
          subId={detailTarget.subId}
        />
      )}
    </div>
  );
}

export function AgentsLeaderboardPanel() {
  const [role, setRole] = useState<"partner" | "wholesale" | "reseller">("partner");
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
      <h2>رتبه‌بندی همکاران / همکار ویژه / عمده‌فروش</h2>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        <button type="button" className={`chip${role === "partner" ? " on" : ""}`} onClick={() => setRole("partner")}>
          همکار
        </button>
        <button
          type="button"
          className={`chip${role === "reseller" ? " on" : ""}`}
          onClick={() => setRole("reseller")}
        >
          همکار ویژه
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
      {label && (
        <p className="muted" style={{ marginTop: 0 }}>
          بازه: {label}
        </p>
      )}
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
