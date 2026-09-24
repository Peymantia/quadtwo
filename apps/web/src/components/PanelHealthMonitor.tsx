"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./DashShell";

export type PanelStatus = {
  panelId: string;
  name: string;
  baseUrl: string;
  ok: boolean;
  error?: string;
  fetchedAt: string;
  cpu: number | null;
  cpuCores: number | null;
  ramUsed: number | null;
  ramTotal: number | null;
  ramPct: number | null;
  swapPct: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  diskPct: number | null;
  loads: number[];
  uptimeSec: number | null;
  tcpCount: number | null;
  udpCount: number | null;
  xrayState: string | null;
  xrayVersion: string | null;
  panelVersion: string | null;
  netUp: number | null;
  netDown: number | null;
  netSent: number | null;
  netRecv: number | null;
  nicSent?: number | null;
  nicRecv?: number | null;
  publicIpv4: string | null;
  history: Array<{ t: number; cpu: number; ramPct: number }>;
};

type HistPt = { t: number; cpu: number; ramPct: number };

function formatBytes(n: number | null) {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n <= 0) return "0 B";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  const TB = GB * 1024;
  const PB = TB * 1024;
  if (n < KB) return `${n.toFixed(0)} B`;
  if (n < MB) return `${(n / KB).toFixed(2)} KB`;
  if (n < GB) return `${(n / MB).toFixed(2)} MB`;
  if (n < TB) return `${(n / GB).toFixed(2)} GB`;
  if (n < PB) return `${(n / TB).toFixed(2)} TB`;
  return `${(n / PB).toFixed(2)} PB`;
}

function formatUptime(sec: number | null) {
  if (sec == null || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d.toLocaleString("fa-IR")} روز · ${h.toLocaleString("fa-IR")} س`;
  const m = Math.floor((sec % 3600) / 60);
  return `${h.toLocaleString("fa-IR")} س · ${m.toLocaleString("fa-IR")} د`;
}

function formatRate(bps: number | null) {
  if (bps == null) return "—";
  return `${formatBytes(bps)}/s`;
}

/** green → yellow → orange → red */
function heat(pct: number | null): "green" | "yellow" | "orange" | "red" | "mute" {
  if (pct == null || !Number.isFinite(pct)) return "mute";
  if (pct >= 85) return "red";
  if (pct >= 70) return "orange";
  if (pct >= 50) return "yellow";
  return "green";
}

const HEAT_HEX: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  mute: "#8e96c9",
};

function LineChartCard({
  title,
  value,
  valueLabel,
  sub,
  series,
}: {
  title: string;
  value: number | null;
  valueLabel: string;
  sub?: string;
  series: number[];
}) {
  const w = 320;
  const h = 78;
  const padX = 4;
  const padY = 10;
  const heatClass = heat(value);
  const color = HEAT_HEX[heatClass];
  const gid = useId().replace(/:/g, "");

  const pts = useMemo(() => {
    const raw = series.length ? series : value != null ? [value] : [];
    if (!raw.length) return [] as Array<{ x: number; y: number }>;
    const vals = raw.length === 1 ? [raw[0]!, raw[0]!] : raw;
    return vals.map((v, i) => {
      const x = padX + (i / (vals.length - 1)) * (w - padX * 2);
      const y = padY + (1 - Math.min(100, Math.max(0, v)) / 100) * (h - padY * 2);
      return { x, y };
    });
  }, [series, value]);

  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area =
    pts.length >= 2
      ? `${pts[0]!.x},${h - padY} ${line} ${pts[pts.length - 1]!.x},${h - padY}`
      : "";

  return (
    <div className={`panel-health-line-card heat-${heatClass}`}>
      <div className="panel-health-line-head">
        <div>
          <div className="panel-health-line-title">{title}</div>
          {sub ? <div className="muted panel-health-line-sub">{sub}</div> : null}
        </div>
        <div className="panel-health-line-value num" style={{ color }}>
          {valueLabel}
        </div>
      </div>
      {pts.length >= 2 ? (
        <svg
          className="panel-spark"
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height={h}
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient id={`spark-fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#spark-fill-${gid})`} />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <div className="panel-spark muted">در حال نمونه‌برداری…</div>
      )}
    </div>
  );
}

const LOCAL_HIST_MAX = 40;

export function PanelHealthMonitor() {
  const [panels, setPanels] = useState<PanelStatus[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [localHist, setLocalHist] = useState<Record<string, HistPt[]>>({});

  const load = useCallback(async () => {
    try {
      const r = await api<{ panels: PanelStatus[] }>("/admin/panels/status");
      setPanels(r.panels);
      setErr(null);
      setUpdatedAt(new Date().toLocaleTimeString("fa-IR"));
      setActiveId((prev) => {
        if (prev && r.panels.some((p) => p.panelId === prev)) return prev;
        return r.panels[0]?.panelId ?? null;
      });
      setLocalHist((prev) => {
        const next = { ...prev };
        for (const p of r.panels) {
          if (!p.ok) continue;
          const cpu = p.cpu ?? 0;
          const ramPct = p.ramPct ?? 0;
          const merged = [...(next[p.panelId] ?? [])];
          // Prefer server history if longer, else append latest sample
          if (p.history.length > merged.length) {
            next[p.panelId] = p.history.slice(-LOCAL_HIST_MAX);
            continue;
          }
          const last = merged[merged.length - 1];
          if (!last || last.cpu !== cpu || last.ramPct !== ramPct || Date.now() - last.t > 5_000) {
            merged.push({ t: Date.now(), cpu, ramPct });
            while (merged.length > LOCAL_HIST_MAX) merged.shift();
            next[p.panelId] = merged;
          }
        }
        return next;
      });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const active = panels.find((p) => p.panelId === activeId) ?? panels[0] ?? null;
  const hist = active ? localHist[active.panelId] ?? active.history ?? [] : [];

  async function restartXray() {
    if (!active) return;
    setRestartBusy(true);
    setFlash(null);
    setErr(null);
    try {
      const r = await api<{ ok?: boolean; message?: string }>(
        `/admin/panels/${encodeURIComponent(active.panelId)}/restart-xray`,
        { method: "POST" },
      );
      setFlash(r.message || "هسته Xray ری‌استارت شد");
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRestartBusy(false);
    }
  }

  if (loading && !panels.length) {
    return (
      <div className="panel panel-health panel-health--compact">
        <h2>وضعیت سرور</h2>
        <p className="muted" style={{ margin: 0 }}>
          در حال دریافت…
        </p>
      </div>
    );
  }

  if (!panels.length) {
    return (
      <div className="panel panel-health panel-health--compact">
        <h2>وضعیت سرور</h2>
        <p className="muted" style={{ margin: 0 }}>
          سرور پنلی ثبت نشده — از بخش «سرورها» یک پنل اضافه کنید.
        </p>
      </div>
    );
  }

  const totalUsage =
    active?.netSent != null || active?.netRecv != null
      ? (active.netSent ?? 0) + (active.netRecv ?? 0)
      : null;

  return (
    <div className="panel panel-health panel-health--compact">
      <div className="panel-health-head">
        <div>
          <h2>وضعیت سرور</h2>
          <p className="muted panel-health-sub">
            مصرف لحظه‌ای
            {updatedAt ? ` · ${updatedAt}` : ""}
          </p>
        </div>
        <button type="button" className="btn ghost sm" onClick={() => void load()} aria-label="بروزرسانی">
          <Icon name="sync" size={15} />
        </button>
      </div>

      {panels.length > 1 && (
        <div className="panel-health-tabs" role="tablist" aria-label="سرورها">
          {panels.map((p) => (
            <button
              key={p.panelId}
              type="button"
              role="tab"
              aria-selected={p.panelId === active?.panelId}
              className={`panel-health-tab${p.panelId === active?.panelId ? " on" : ""}${!p.ok ? " bad" : ""}`}
              onClick={() => setActiveId(p.panelId)}
            >
              <span className="panel-health-tab-dot" />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {err && <p className="err">{err}</p>}
      {flash && (
        <p className="muted" style={{ marginTop: 0, color: "var(--teal)" }}>
          {flash}
        </p>
      )}

      {active && (
        <>
          {!active.ok && (
            <p className="err" style={{ marginTop: 0 }}>
              {active.error || "خواندن وضعیت ناموفق بود"}
            </p>
          )}

          <div className="panel-health-gauges panel-health-gauges--lines">
            <LineChartCard
              title="CPU"
              value={active.cpu}
              valueLabel={active.cpu == null ? "—" : `${active.cpu.toFixed(0)}%`}
              sub={active.cpuCores != null ? `${active.cpuCores.toLocaleString("fa-IR")} هسته` : undefined}
              series={hist.map((h) => h.cpu)}
            />
            <LineChartCard
              title="RAM"
              value={active.ramPct}
              valueLabel={active.ramPct == null ? "—" : `${active.ramPct.toFixed(0)}%`}
              sub={`${formatBytes(active.ramUsed)} / ${formatBytes(active.ramTotal)}`}
              series={hist.map((h) => h.ramPct)}
            />
          </div>

          <div className="panel-health-xray-row">
            <div className="panel-health-xray-info">
              <span className="k">Xray</span>
              <span className={`v ${active.xrayState === "running" ? "heat-green-text" : "heat-red-text"}`}>
                {active.xrayState || "—"}
              </span>
              {active.xrayVersion ? (
                <span className="d muted num" dir="ltr">
                  {active.xrayVersion}
                </span>
              ) : null}
              <span className="d muted">آپ‌تایم: {formatUptime(active.uptimeSec)}</span>
            </div>
            <button
              type="button"
              className="btn ghost sm"
              disabled={restartBusy || !active.ok}
              onClick={() => void restartXray()}
            >
              <Icon name="sync" size={14} />
              {restartBusy ? "…" : "ری‌استارت Xray"}
            </button>
          </div>

          <details
            className="panel-health-accordion"
            open={detailsOpen}
            onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary>جزئیات بیشتر</summary>
            <div className="panel-health-meta">
              <div className="panel-health-chip">
                <span className="k">دیسک</span>
                <span className={`v num heat-${heat(active.diskPct)}-text`}>
                  {active.diskPct != null ? `${active.diskPct.toFixed(0)}%` : "—"}
                </span>
                <span className="d muted">
                  {formatBytes(active.diskUsed)} / {formatBytes(active.diskTotal)}
                </span>
              </div>
              <div className="panel-health-chip">
                <span className="k">Total Sent</span>
                <span className="v num" dir="ltr">
                  {formatBytes(active.netSent)}
                </span>
              </div>
              <div className="panel-health-chip">
                <span className="k">Total Received</span>
                <span className="v num" dir="ltr">
                  {formatBytes(active.netRecv)}
                </span>
              </div>
              <div className="panel-health-chip">
                <span className="k">Total Usage</span>
                <span className="v num" dir="ltr">
                  {formatBytes(totalUsage)}
                </span>
              </div>
              <div className="panel-health-chip">
                <span className="k">شبکه لحظه‌ای</span>
                <span className="v num" dir="ltr">
                  ↑ {formatRate(active.netUp)} · ↓ {formatRate(active.netDown)}
                </span>
              </div>
              {(active.nicSent != null || active.nicRecv != null) && (
                <div className="panel-health-chip">
                  <span className="k">NIC (از بوت)</span>
                  <span className="v num" dir="ltr">
                    ↑ {formatBytes(active.nicSent ?? null)} · ↓ {formatBytes(active.nicRecv ?? null)}
                  </span>
                </div>
              )}
              <div className="panel-health-chip">
                <span className="k">Load</span>
                <span className="v num" dir="ltr">
                  {active.loads.length ? active.loads.map((n) => n.toFixed(2)).join(" · ") : "—"}
                </span>
              </div>
              <div className="panel-health-chip">
                <span className="k">اتصالات</span>
                <span className="v num">
                  TCP {active.tcpCount?.toLocaleString("fa-IR") ?? "—"} · UDP{" "}
                  {active.udpCount?.toLocaleString("fa-IR") ?? "—"}
                </span>
              </div>
              {active.publicIpv4 ? (
                <div className="panel-health-chip">
                  <span className="k">IP</span>
                  <span className="v num" dir="ltr">
                    {active.publicIpv4}
                  </span>
                </div>
              ) : null}
              {active.swapPct != null && active.swapPct > 0 ? (
                <div className="panel-health-chip">
                  <span className="k">Swap</span>
                  <span className={`v num heat-${heat(active.swapPct)}-text`}>
                    {active.swapPct.toFixed(0)}%
                  </span>
                </div>
              ) : null}
              {active.panelVersion ? (
                <div className="panel-health-chip">
                  <span className="k">نسخه پنل</span>
                  <span className="v num" dir="ltr">
                    {active.panelVersion}
                  </span>
                </div>
              ) : null}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
