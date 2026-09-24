import { isDemoMode } from "./license.js";
import { createXuiFromPanel, envPanelSnapshot, listPanelServers } from "./panel-servers.js";
import type { XuiClient, XuiServerStatus } from "../panel/xui-client.js";
import { getSetting } from "./settings.js";

export type PanelStatusSnapshot = {
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
  swapUsed: number | null;
  swapTotal: number | null;
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
  /** Xray inbound totals (same as 3x-ui «Total Sent / Received / Usage»). */
  netSent: number | null;
  netRecv: number | null;
  /** Host NIC counters since boot (optional / secondary). */
  nicSent: number | null;
  nicRecv: number | null;
  publicIpv4: string | null;
  history: Array<{ t: number; cpu: number; ramPct: number }>;
};

type HistPoint = { t: number; cpu: number; ramPct: number };
const HISTORY_MAX = 36;
const historyByPanel = new Map<string, HistPoint[]>();

/** Cooldown key → last alert ms */
const alertCooldown = new Map<string, number>();
const ALERT_COOLDOWN_MS = 45 * 60 * 1000;

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Match 3x-ui SizeFormatter.sizeFormat (binary units, 2 decimals). */
export function formatTrafficBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "0 B";
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

function pct(used: number | null | undefined, total: number | null | undefined): number | null {
  if (used == null || total == null || total <= 0) return null;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function pushHistory(panelId: string, cpu: number | null, ramPct: number | null) {
  if (cpu == null && ramPct == null) return;
  const list = historyByPanel.get(panelId) ?? [];
  list.push({
    t: Date.now(),
    cpu: cpu ?? list[list.length - 1]?.cpu ?? 0,
    ramPct: ramPct ?? list[list.length - 1]?.ramPct ?? 0,
  });
  while (list.length > HISTORY_MAX) list.shift();
  historyByPanel.set(panelId, list);
}

function normalizeStatus(
  panelId: string,
  name: string,
  baseUrl: string,
  raw: XuiServerStatus | null,
  opts?: {
    error?: string;
    /** Sum of inbound.up (Total Sent) */
    trafficSent?: number | null;
    /** Sum of inbound.down (Total Received) */
    trafficRecv?: number | null;
  },
): PanelStatusSnapshot {
  const cpu = raw?.cpu != null && Number.isFinite(raw.cpu) ? Number(raw.cpu) : null;
  const ramUsed = numOrNull(raw?.mem?.current);
  const ramTotal = numOrNull(raw?.mem?.total);
  const ramPct = pct(ramUsed, ramTotal);
  const swapUsed = numOrNull(raw?.swap?.current);
  const swapTotal = numOrNull(raw?.swap?.total);
  const diskUsed = numOrNull(raw?.disk?.current);
  const diskTotal = numOrNull(raw?.disk?.total);

  if (!opts?.error) pushHistory(panelId, cpu, ramPct);

  const nicSent = numOrNull(raw?.netTraffic?.sent);
  const nicRecv = numOrNull(raw?.netTraffic?.recv);
  const trafficSent = opts?.trafficSent != null ? opts.trafficSent : null;
  const trafficRecv = opts?.trafficRecv != null ? opts.trafficRecv : null;

  return {
    panelId,
    name,
    baseUrl,
    ok: !opts?.error && raw != null,
    error: opts?.error,
    fetchedAt: new Date().toISOString(),
    cpu,
    cpuCores: raw?.cpuCores ?? raw?.logicalPro ?? null,
    ramUsed,
    ramTotal,
    ramPct,
    swapUsed,
    swapTotal,
    swapPct: pct(swapUsed, swapTotal),
    diskUsed,
    diskTotal,
    diskPct: pct(diskUsed, diskTotal),
    loads: Array.isArray(raw?.loads) ? raw!.loads!.map(Number).filter((n) => Number.isFinite(n)) : [],
    uptimeSec: raw?.uptime != null ? Number(raw.uptime) : null,
    tcpCount: raw?.tcpCount ?? null,
    udpCount: raw?.udpCount ?? null,
    xrayState: raw?.xray?.state ?? null,
    xrayVersion: raw?.xray?.version ?? null,
    panelVersion: raw?.panelVersion ?? null,
    netUp: numOrNull(raw?.netIO?.up),
    netDown: numOrNull(raw?.netIO?.down),
    netSent: trafficSent,
    netRecv: trafficRecv,
    nicSent,
    nicRecv,
    publicIpv4: raw?.publicIP?.ipv4 ?? null,
    history: [...(historyByPanel.get(panelId) ?? [])],
  };
}

function demoStatus(panelId: string, name: string, baseUrl: string): PanelStatusSnapshot {
  const t = Date.now() / 1000;
  const cpu = 28 + Math.sin(t / 17) * 12 + Math.random() * 8;
  const ramPct = 52 + Math.cos(t / 23) * 10 + Math.random() * 5;
  const ramTotal = 8 * 1024 ** 3;
  const ramUsed = (ramPct / 100) * ramTotal;
  const diskTotal = 100 * 1024 ** 3;
  const diskUsed = 0.41 * diskTotal;
  const raw: XuiServerStatus = {
    cpu,
    cpuCores: 4,
    logicalPro: 8,
    mem: { current: ramUsed, total: ramTotal },
    swap: { current: 0, total: 2 * 1024 ** 3 },
    disk: { current: diskUsed, total: diskTotal },
    loads: [0.8, 0.9, 1.1],
    uptime: 86400 * 12 + 3600 * 5,
    tcpCount: 420,
    udpCount: 88,
    xray: { state: "running", version: "1.8.x" },
    panelVersion: "demo",
    netIO: { up: 1.2e6, down: 3.4e6 },
    netTraffic: { sent: 120e9, recv: 340e9 },
    publicIP: { ipv4: "203.0.113.10" },
  };
  // Demo Xray traffic ≈ slightly below NIC totals (same idea as real panels)
  return normalizeStatus(panelId, name, baseUrl, raw, {
    trafficSent: 95e9,
    trafficRecv: 280e9,
  });
}

async function sumInboundTraffic(xui: XuiClient): Promise<{
  sent: number;
  recv: number;
}> {
  const res = await xui.listInbounds();
  const list = Array.isArray(res.obj) ? res.obj : [];
  let sent = 0;
  let recv = 0;
  for (const ib of list) {
    sent += numOrNull(ib.up) ?? 0;
    recv += numOrNull(ib.down) ?? 0;
  }
  return { sent, recv };
}

async function fetchOnePanel(opts: {
  id: string;
  name: string;
  baseUrl: string;
  apiToken: string;
}): Promise<PanelStatusSnapshot> {
  if (isDemoMode()) {
    return demoStatus(opts.id, opts.name, opts.baseUrl);
  }
  try {
    const xui = createXuiFromPanel(opts);
    const res = await xui.getServerStatus();
    let trafficSent: number | null = null;
    let trafficRecv: number | null = null;
    try {
      const t = await sumInboundTraffic(xui);
      trafficSent = t.sent;
      trafficRecv = t.recv;
    } catch {
      /* status still useful without inbound totals */
    }
    return normalizeStatus(opts.id, opts.name, opts.baseUrl, res.obj ?? null, {
      trafficSent,
      trafficRecv,
    });
  } catch (err) {
    return normalizeStatus(opts.id, opts.name, opts.baseUrl, null, {
      error: String(err instanceof Error ? err.message : err),
    });
  }
}

/** All panels for current tenant (DB rows, or env fallback). */
export async function listPanelStatusTargets(): Promise<
  Array<{ id: string; name: string; baseUrl: string; apiToken: string }>
> {
  const panels = await listPanelServers();
  const active = panels.filter((p) => p.active && p.baseUrl && p.apiToken);
  if (active.length) {
    return active.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiToken: p.apiToken,
    }));
  }
  const env = envPanelSnapshot();
  if (env) {
    return [
      {
        id: "env",
        name: env.name,
        baseUrl: env.baseUrl,
        apiToken: env.apiToken,
      },
    ];
  }
  return [];
}

export async function fetchAllPanelStatuses(): Promise<PanelStatusSnapshot[]> {
  const targets = await listPanelStatusTargets();
  const out: PanelStatusSnapshot[] = [];
  for (const t of targets) {
    out.push(await fetchOnePanel(t));
  }
  return out;
}

export async function fetchPanelStatusById(panelId: string): Promise<PanelStatusSnapshot | null> {
  const targets = await listPanelStatusTargets();
  const t = targets.find((x) => x.id === panelId);
  if (!t) return null;
  return fetchOnePanel(t);
}

async function alertThresholds() {
  const enabled = (await getSetting("panel_alert_enabled")) !== "false";
  const cpu = Math.max(50, Math.min(99, Number(await getSetting("panel_cpu_alert_pct")) || 85));
  const ram = Math.max(50, Math.min(99, Number(await getSetting("panel_ram_alert_pct")) || 90));
  const disk = Math.max(50, Math.min(99, Number(await getSetting("panel_disk_alert_pct")) || 92));
  return { enabled, cpu, ram, disk };
}

function formatBytes(n: number | null) {
  return formatTrafficBytes(n);
}

function formatUptime(sec: number | null) {
  if (sec == null || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d} روز و ${h} ساعت`;
  const m = Math.floor((sec % 3600) / 60);
  return `${h} ساعت و ${m} دقیقه`;
}

export function formatPanelStatusSummary(s: PanelStatusSnapshot) {
  const lines = [
    `🖥 ${s.name}`,
    s.ok
      ? [
          `CPU: ${s.cpu != null ? `${s.cpu.toFixed(1)}%` : "—"}`,
          `RAM: ${s.ramPct != null ? `${s.ramPct.toFixed(1)}%` : "—"} (${formatBytes(s.ramUsed)} / ${formatBytes(s.ramTotal)})`,
          s.diskPct != null ? `دیسک: ${s.diskPct.toFixed(1)}%` : null,
          s.xrayState ? `Xray: ${s.xrayState}` : null,
          `آپ‌تایم: ${formatUptime(s.uptimeSec)}`,
        ]
          .filter(Boolean)
          .join("\n")
      : `⚠️ خطا: ${s.error || "خواندن وضعیت ناموفق"}`,
  ];
  return lines.join("\n");
}

/**
 * Check thresholds and notify tenant admins (with cooldown).
 * Call inside forEachActiveTenant / tenant context.
 */
export async function checkPanelStatusAlerts(send: (telegramId: number, text: string) => Promise<void>) {
  const thr = await alertThresholds();
  if (!thr.enabled) return { checked: 0, alerted: 0 };

  const { listNotifyAdminTelegramIds } = await import("./users.js");
  const admins = await listNotifyAdminTelegramIds();
  if (!admins.length) return { checked: 0, alerted: 0 };

  const { resolveTenantIdOrPlatform } = await import("./tenants.js");
  const tenantId = await resolveTenantIdOrPlatform();

  const statuses = await fetchAllPanelStatuses();
  let alerted = 0;
  const now = Date.now();

  for (const s of statuses) {
    if (!s.ok) {
      const key = `${tenantId}:${s.panelId}:down`;
      const last = alertCooldown.get(key) ?? 0;
      if (now - last >= ALERT_COOLDOWN_MS) {
        alertCooldown.set(key, now);
        const text = `🚨 هشدار سرور پنل\n\n${formatPanelStatusSummary(s)}`;
        for (const id of admins) {
          try {
            await send(id, text);
          } catch {
            /* ignore */
          }
        }
        alerted += 1;
      }
      continue;
    }

    const breaches: string[] = [];
    if (s.cpu != null && s.cpu >= thr.cpu) breaches.push(`CPU ${s.cpu.toFixed(0)}٪ (آستانه ${thr.cpu}٪)`);
    if (s.ramPct != null && s.ramPct >= thr.ram)
      breaches.push(`RAM ${s.ramPct.toFixed(0)}٪ (آستانه ${thr.ram}٪)`);
    if (s.diskPct != null && s.diskPct >= thr.disk)
      breaches.push(`دیسک ${s.diskPct.toFixed(0)}٪ (آستانه ${thr.disk}٪)`);
    if (s.xrayState && s.xrayState !== "running") breaches.push(`Xray: ${s.xrayState}`);

    if (!breaches.length) continue;

    const key = `${tenantId}:${s.panelId}:load`;
    const last = alertCooldown.get(key) ?? 0;
    if (now - last < ALERT_COOLDOWN_MS) continue;
    alertCooldown.set(key, now);

    const text = [
      `⚠️ مصرف بالای سرور پنل`,
      ``,
      `🖥 ${s.name}`,
      ...breaches.map((b) => `• ${b}`),
      ``,
      `RAM: ${formatBytes(s.ramUsed)} / ${formatBytes(s.ramTotal)}`,
      `آپ‌تایم: ${formatUptime(s.uptimeSec)}`,
    ].join("\n");

    for (const id of admins) {
      try {
        await send(id, text);
      } catch {
        /* ignore */
      }
    }
    alerted += 1;
  }

  return { checked: statuses.length, alerted };
}

export function startPanelStatusAlertCron(
  getApiForTenant: (tenantId: string) => { sendMessage: (chatId: number, text: string) => Promise<unknown> } | undefined,
  intervalMs = 3 * 60 * 1000,
) {
  const tick = async () => {
    try {
      const { forEachActiveTenant } = await import("./tenants.js");
      await forEachActiveTenant(async (t) => {
        const api = getApiForTenant(t.id);
        if (!api) return;
        const r = await checkPanelStatusAlerts(async (telegramId, text) => {
          await api.sendMessage(telegramId, text);
        });
        if (r.alerted > 0) {
          console.log(`panel status alerts [${t.slug}]: checked=${r.checked} alerted=${r.alerted}`);
        }
      });
    } catch (err) {
      console.error("panel status alert cron error", err);
    }
  };
  setTimeout(tick, 120_000);
  return setInterval(tick, intervalMs);
}
