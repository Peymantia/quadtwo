"use client";

import { useCallback, useEffect, useState } from "react";
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
  publicIpv4: string | null;
  history: Array<{ t: number; cpu: number; ramPct: number }>;
};

function formatBytes(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
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

function tone(pct: number | null, warn = 70, danger = 85): "ok" | "warn" | "bad" | "mute" {
  if (pct == null) return "mute";
  if (pct >= danger) return "bad";
  if (pct >= warn) return "warn";
  return "ok";
}

function LineChartCard({
  title,
  valueLabel,
  sub,
  points,
  pick,
  toneClass,
}: {
  title: string;
  valueLabel: string;
  sub?: string;
  points: Array<{ t: number; cpu: number; ramPct: number }>;
  pick: "cpu" | "ramPct";
  toneClass: string;
}) {
  const w = 320;
  const h = 72;
  const padX = 6;
  const padY = 8;
  const vals = points.map((p) => (pick === "cpu" ? p.cpu : p.ramPct));
  const hasSeries = vals.length >= 2;
  const coords = hasSeries
    ? vals
        .map((v, i) => {
          const x = padX + (i / (vals.length - 1)) * (w - padX * 2);
          const y = padY + (1 - Math.min(100, Math.max(0, v)) / 100) * (h - padY * 2);
          return `${x},${y}`;
        })
        .join(" ")
    : "";
  const area = hasSeries ? `${padX},${h - padY} ${coords} ${w - padX},${h - padY}` : "";

  return (
    <div className={`panel-health-line-card ${toneClass}`}>
      <div className="panel-health-line-head">
        <div>
          <div className="panel-health-line-title">{title}</div>
          {sub ? <div className="muted panel-health-line-sub">{sub}</div> : null}
        </div>
        <div className="panel-health-line-value num">{valueLabel}</div>
      </div>
      {hasSeries ? (
        <svg className="panel-spark" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
          <polygon className="panel-spark-fill" points={area} />
          <polyline className="panel-spark-line" points={coords} fill="none" />
        </svg>
      ) : (
        <div className="panel-spark muted">نمودار بعد از چند نمونه</div>
      )}
    </div>
  );
}

export function PanelHealthMonitor() {
  const [panels, setPanels] = useState<PanelStatus[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

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
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const active = panels.find((p) => p.panelId === activeId) ?? panels[0] ?? null;

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
              valueLabel={active.cpu == null ? "—" : `${active.cpu.toFixed(0)}%`}
              sub={active.cpuCores != null ? `${active.cpuCores.toLocaleString("fa-IR")} هسته` : undefined}
              points={active.history}
              pick="cpu"
              toneClass={`tone-${tone(active.cpu)}`}
            />
            <LineChartCard
              title="RAM"
              valueLabel={active.ramPct == null ? "—" : `${active.ramPct.toFixed(0)}%`}
              sub={`${formatBytes(active.ramUsed)} / ${formatBytes(active.ramTotal)}`}
              points={active.history}
              pick="ramPct"
              toneClass={`tone-${tone(active.ramPct)}`}
            />
          </div>

          <div className="panel-health-xray-row">
            <div className="panel-health-xray-info">
              <span className="k">Xray</span>
              <span className={`v ${active.xrayState === "running" ? "tone-ok" : "tone-bad"}`}>
                {active.xrayState || "—"}
              </span>
              {active.xrayVersion ? (
                <span className="d muted num" dir="ltr">
                  {active.xrayVersion}
                </span>
              ) : null}
              <span className="d muted">آپ‌تایم سرور: {formatUptime(active.uptimeSec)}</span>
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
                <span className={`v num tone-${tone(active.diskPct, 75, 90)}`}>
                  {active.diskPct != null ? `${active.diskPct.toFixed(0)}%` : "—"}
                </span>
                <span className="d muted">
                  {formatBytes(active.diskUsed)} / {formatBytes(active.diskTotal)}
                </span>
              </div>
              <div className="panel-health-chip">
                <span className="k">Load</span>
                <span className="v num" dir="ltr">
                  {active.loads.length ? active.loads.map((n) => n.toFixed(2)).join(" · ") : "—"}
                </span>
              </div>
              <div className="panel-health-chip">
                <span className="k">شبکه</span>
                <span className="v num" dir="ltr">
                  ↑ {formatRate(active.netUp)} · ↓ {formatRate(active.netDown)}
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
                  <span className={`v num tone-${tone(active.swapPct)}`}>{active.swapPct.toFixed(0)}%</span>
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
