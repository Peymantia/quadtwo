import { prisma } from "../db.js";
import { createXuiFromEnv, type XuiClient } from "../panel/xui-client.js";
import { env } from "../config/env.js";
import { listPanelServers, createXuiFromPanel } from "./panel-servers.js";
import { formatExpiryLabel, formatTraffic } from "../utils/format.js";

const UUID_RE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

export type ConfigLookupResult = {
  found: boolean;
  message: string;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "۰";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} گیگ`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} مگ`;
  return `${Math.round(bytes / 1024)} کیلوبایت`;
}

/** Extract UUID from bare uuid, vless/trojan/vmess link, or similar. */
export function extractUuidFromInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // vmess:// base64 JSON with "id"
  if (/^vmess:\/\//i.test(text)) {
    try {
      const b64 = text.replace(/^vmess:\/\//i, "").split("#")[0]!;
      const json = Buffer.from(b64, "base64").toString("utf8");
      const obj = JSON.parse(json) as { id?: string };
      if (obj.id && UUID_RE.test(obj.id)) return obj.id.match(UUID_RE)![0]!;
    } catch {
      /* fall through */
    }
  }

  const m = text.match(UUID_RE);
  return m ? m[0]! : null;
}

/** Also accept subId-looking tokens from subscription URLs. */
export function extractSubIdFromInput(raw: string): string | null {
  const text = raw.trim();
  // .../info/SUBID or .../sub/SUBID
  const path = text.match(/\/(?:info|sub)\/([A-Za-z0-9_-]{6,64})\/?$/i);
  if (path?.[1] && !UUID_RE.test(path[1])) return path[1];
  // bare short token (not uuid)
  if (/^[A-Za-z0-9_-]{8,64}$/.test(text) && !UUID_RE.test(text)) return text;
  return null;
}

function panelClients(): XuiClient[] {
  // sync helper used after await list — caller builds list
  return [];
}

async function allXuiClients(): Promise<XuiClient[]> {
  const panels = await listPanelServers();
  const active = panels.filter((p) => p.active);
  if (active.length) return active.map((p) => createXuiFromPanel(p));
  if (env.XUI_BASE_URL && env.XUI_API_TOKEN) return [createXuiFromEnv(env)];
  return [];
}

export async function lookupConfigByLinkOrUuid(raw: string): Promise<ConfigLookupResult> {
  const uuid = extractUuidFromInput(raw);
  const subIdHint = extractSubIdFromInput(raw);
  const emailHint = raw.trim().includes("@")
    ? raw.trim().split(/[\s?#]/)[0]!
    : /^[A-Za-z0-9._-]{3,64}$/.test(raw.trim()) && !uuid
      ? raw.trim()
      : null;

  if (!uuid && !subIdHint && !emailHint) {
    return {
      found: false,
      message: "❌ لینک یا UUID معتبر پیدا نشد.\nمثال: vless://uuid@host:port?... یا خود UUID",
    };
  }

  // 1) DB first
  let sub =
    (uuid
      ? await prisma.subscription.findFirst({
          where: { clientUuid: uuid },
          include: { user: true, panelServer: true },
        })
      : null) ||
    (subIdHint
      ? await prisma.subscription.findFirst({
          where: { panelSubId: subIdHint },
          include: { user: true, panelServer: true },
        })
      : null) ||
    (emailHint
      ? await prisma.subscription.findFirst({
          where: { email: emailHint },
          include: { user: true, panelServer: true },
        })
      : null);

  // 2) Panel search by UUID / list
  let panelEmail: string | null = sub?.email ?? null;
  let panelEnable: boolean | null = null;
  let panelExpiry = 0;
  let used = 0;
  let total = 0;
  let panelUuid = uuid ?? sub?.clientUuid ?? null;
  let panelSubId = sub?.panelSubId ?? subIdHint;
  let panelName: string | null = sub?.panelServer?.name ?? null;

  const xuis = await allXuiClients();

  if (uuid) {
    for (const xui of xuis) {
      try {
        const traf = await xui.getClientTrafficById(uuid);
        const row = Array.isArray(traf.obj) ? traf.obj[0] : null;
        if (row?.email) {
          panelEmail = row.email;
          used = Number(row.up ?? 0) + Number(row.down ?? 0);
          total = Number(row.total ?? 0);
          panelExpiry = Number(row.expiryTime ?? 0);
          if (row.enable !== undefined) panelEnable = row.enable;
          break;
        }
      } catch {
        /* try list */
      }
      try {
        const list = await xui.listClients();
        const hit = (list.obj ?? []).find(
          (c) => (c.uuid || c.id || "").toLowerCase() === uuid.toLowerCase(),
        );
        if (hit?.email) {
          panelEmail = hit.email;
          panelUuid = hit.uuid || hit.id || uuid;
          panelSubId = hit.subId ?? panelSubId;
          total = Number(hit.totalGB ?? 0);
          panelExpiry = Number(hit.expiryTime ?? 0);
          if (hit.enable !== undefined) panelEnable = hit.enable;
          const t = await xui.getClientTraffic(hit.email);
          if (t) {
            used = t.used;
            if (t.total > 0) total = t.total;
            if (t.enable !== undefined) panelEnable = t.enable;
          }
          break;
        }
      } catch {
        /* next panel */
      }
    }
  }

  if (!panelEmail && subIdHint) {
    for (const xui of xuis) {
      try {
        const list = await xui.listClients();
        const hit = (list.obj ?? []).find((c) => c.subId === subIdHint);
        if (hit?.email) {
          panelEmail = hit.email;
          panelUuid = hit.uuid || hit.id || null;
          panelSubId = hit.subId ?? panelSubId ?? null;
          total = Number(hit.totalGB ?? 0);
          panelExpiry = Number(hit.expiryTime ?? 0);
          if (hit.enable !== undefined) panelEnable = hit.enable;
          const t = await xui.getClientTraffic(hit.email);
          if (t) {
            used = t.used;
            if (t.total > 0) total = t.total;
          }
          break;
        }
      } catch {
        /* next */
      }
    }
  }

  if (!panelEmail && emailHint) {
    for (const xui of xuis) {
      try {
        const got = await xui.getClient(emailHint);
        const c = got.obj?.client;
        if (c?.email) {
          panelEmail = c.email;
          panelUuid = c.uuid || c.id || null;
          panelSubId = c.subId ?? panelSubId;
          total = Number(c.totalGB ?? 0);
          panelExpiry = Number(c.expiryTime ?? 0);
          if (c.enable !== undefined) panelEnable = c.enable;
          const t = await xui.getClientTraffic(c.email);
          if (t) {
            used = t.used;
            if (t.total > 0) total = t.total;
          }
          break;
        }
      } catch {
        /* next */
      }
    }
  }

  if (!sub && panelEmail) {
    sub = await prisma.subscription.findFirst({
      where: { email: panelEmail },
      include: { user: true, panelServer: true },
    });
    if (sub?.panelServer) panelName = sub.panelServer.name;
  }

  if (!panelEmail && !sub) {
    return {
      found: false,
      message: "❌ کانفیگ پیدا نشد.\nلینک/UUID را بررسی کنید یا مطمئن شوید روی پنل متصل به ربات است.",
    };
  }

  const email = panelEmail || sub!.email;
  const remaining = total > 0 ? Math.max(0, total - used) : null;
  const expiryLabel = sub
    ? formatExpiryLabel({
        expiresAt: panelExpiry > 0 ? new Date(panelExpiry) : sub.expiresAt,
        startsOnConnect: sub.startsOnConnect,
        activatedAt: sub.activatedAt,
        createdAt: sub.createdAt,
      })
    : panelExpiry > 0
      ? new Date(panelExpiry).toLocaleString("fa-IR")
      : panelExpiry < 0
        ? "از اولین اتصال"
        : "—";

  const lines = [
    "✅ مشخصات کانفیگ",
    "",
    sub ? `🆔 کد ربات: ${sub.code}` : null,
    `اکانت: ${email}`,
    panelUuid ? `UUID: \`${panelUuid}\`` : null,
    panelSubId ? `Sub ID: \`${panelSubId}\`` : null,
    panelName ? `🖥 سرور: ${panelName}` : null,
    sub ? `حجم پلن: ${sub.isTest ? "۲۵۰ مگ" : formatTraffic(sub.trafficGb)}` : null,
    total > 0 ? `حجم کل پنل: ${formatBytes(total)}` : null,
    `مصرف: ${formatBytes(used)}`,
    remaining !== null ? `باقی‌مانده: ${formatBytes(remaining)}` : null,
    `انقضا: ${expiryLabel}`,
    panelEnable === null ? null : panelEnable ? "وضعیت پنل: 🟢 فعال" : "وضعیت پنل: 🔴 غیرفعال",
    sub?.note?.trim() ? `📝 یادداشت: ${sub.note.trim()}` : null,
    sub ? `مالک تلگرام: ${sub.user.username ? `@${sub.user.username}` : sub.user.telegramId}` : null,
  ].filter(Boolean) as string[];

  return { found: true, message: lines.join("\n") };
}

// silence unused
void panelClients;
