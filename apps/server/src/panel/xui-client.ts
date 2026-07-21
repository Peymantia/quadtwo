import { formatXuiError } from "./xui-errors.js";

/**
 * MHSanaei 3x-ui panel API client (Bearer token).
 * @see https://github.com/MHSanaei/3x-ui/wiki
 */
export type XuiClientOptions = {
  baseUrl: string;
  apiToken: string;
};

type ApiResult<T = unknown> = {
  success: boolean;
  msg?: string;
  obj?: T;
};

export type XuiInbound = {
  id: number;
  enable?: boolean;
  remark?: string;
};

/**
 * 3x-ui Go model expects Client.id (UUID) as string.
 * Spreading getClient() can leave numeric id and break update/add.
 */
export function sanitizeClientPayload(client: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...client };
  if (out.id != null && out.id !== "") out.id = String(out.id);
  if (out.uuid != null && out.uuid !== "") out.uuid = String(out.uuid);
  if (typeof out.tgId === "string") {
    const n = Number(out.tgId.replace(/\D/g, ""));
    if (Number.isFinite(n) && n > 0) out.tgId = n;
    else delete out.tgId;
  }
  if (typeof out.allowedIPs === "string") {
    const raw = out.allowedIPs.trim();
    if (!raw) {
      out.allowedIPs = [];
    } else if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        out.allowedIPs = Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
      } catch {
        out.allowedIPs = raw
          .split(/[,\r\n]+/)
          .map((x) => x.trim())
          .filter(Boolean);
      }
    } else {
      out.allowedIPs = raw
        .split(/[,\r\n]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  // Panel getClient may attach fields that confuse update body
  delete out.inboundIds;
  delete out.usedTraffic;
  return out;
}

export class XuiClient {
  private readonly baseUrl: string;

  constructor(private readonly opts: XuiClientOptions) {
    this.baseUrl = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
  }

  /** Panel root URL (with trailing slash). */
  get panelBaseUrl() {
    return this.baseUrl;
  }

  private url(path: string) {
    const clean = path.replace(/^\//, "");
    return new URL(clean, this.baseUrl).toString();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        ...init,
        headers: {
          Authorization: `Bearer ${this.opts.apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      throw new Error(formatXuiError(err));
    }

    const text = await res.text();
    let json: ApiResult<T>;
    try {
      json = JSON.parse(text) as ApiResult<T>;
    } catch {
      throw new Error(formatXuiError(`3x-ui ${res.status}: ${text.slice(0, 400)}`));
    }

    if (!res.ok || json.success === false) {
      throw new Error(
        formatXuiError(`3x-ui ${res.status}: ${json.msg ?? text.slice(0, 400)}`),
      );
    }

    return json;
  }

  listInbounds() {
    return this.request<XuiInbound[]>("panel/api/inbounds/list");
  }

  async listEnabledInboundIds(): Promise<number[]> {
    const res = await this.listInbounds();
    const list = Array.isArray(res.obj) ? res.obj : [];
    const ids = list.filter((i) => i.enable !== false).map((i) => i.id);
    return ids.length ? ids : list.map((i) => i.id);
  }

  addClient(body: {
    client: Record<string, unknown>;
    inboundIds: number[];
  }) {
    return this.request("panel/api/clients/add", {
      method: "POST",
      body: JSON.stringify({
        client: sanitizeClientPayload(body.client),
        inboundIds: body.inboundIds,
      }),
    });
  }

  updateClient(email: string, body: Record<string, unknown>) {
    return this.request(`panel/api/clients/update/${encodeURIComponent(email)}`, {
      method: "POST",
      body: JSON.stringify(sanitizeClientPayload(body)),
    });
  }

  getClient(email: string) {
    return this.request<{
      client: {
        email: string;
        subId?: string;
        uuid?: string;
        id?: string;
        totalGB?: number;
        expiryTime?: number;
        enable?: boolean;
        limitIp?: number;
        tgId?: number;
        comment?: string;
        flow?: string;
        password?: string;
      };
      inboundIds?: number[];
      usedTraffic?: number;
    }>(`panel/api/clients/get/${encodeURIComponent(email)}`);
  }

  /** Bytes used (up+down). Tries traffic endpoints, falls back to getClient.usedTraffic. */
  async getClientTraffic(email: string): Promise<{
    up: number;
    down: number;
    total: number;
    used: number;
    enable?: boolean;
    expiryTime?: number;
  } | null> {
    const paths = [
      `panel/api/clients/traffic/${encodeURIComponent(email)}`,
      `panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`,
    ];
    for (const path of paths) {
      try {
        const res = await this.request<{
          up?: number;
          down?: number;
          total?: number;
          enable?: boolean;
          expiryTime?: number;
        }>(path);
        const up = Number(res.obj?.up ?? 0);
        const down = Number(res.obj?.down ?? 0);
        return {
          up,
          down,
          total: Number(res.obj?.total ?? 0),
          used: up + down,
          enable: res.obj?.enable,
          expiryTime: res.obj?.expiryTime,
        };
      } catch {
        /* try next */
      }
    }
    try {
      const got = await this.getClient(email);
      const client = got.obj?.client;
      if (!client) return null;
      const used = Number(got.obj?.usedTraffic ?? 0);
      return {
        up: 0,
        down: used,
        total: Number(client.totalGB ?? 0),
        used,
        enable: client.enable,
        expiryTime: client.expiryTime,
      };
    } catch {
      return null;
    }
  }

  clientLinks(email: string) {
    return this.request<string[]>(`panel/api/clients/links/${encodeURIComponent(email)}`);
  }

  getSettings() {
    return this.request<Record<string, unknown>>("panel/api/setting/all", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  /** Computed subscription URLs (subURI, subJsonURI, …) — same as panel UI. */
  getDefaultSettings() {
    return this.request<Record<string, unknown>>("panel/api/setting/defaultSettings", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  subLinks(subId: string) {
    return this.request<string[]>(`panel/api/clients/subLinks/${encodeURIComponent(subId)}`);
  }

  listGroups() {
    return this.request<Array<{ name: string; clientCount?: number }>>("panel/api/clients/groups");
  }

  groupEmails(name: string) {
    return this.request<string[]>(`panel/api/clients/groups/${encodeURIComponent(name)}/emails`);
  }

  /** Delete client by email across inbounds. */
  deleteClient(email: string) {
    return this.request(`panel/api/clients/del/${encodeURIComponent(email)}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  createGroup(name: string) {
    return this.request("panel/api/clients/groups/create", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  renameGroup(oldName: string, newName: string) {
    return this.request("panel/api/clients/groups/rename", {
      method: "POST",
      body: JSON.stringify({ oldName, newName }),
    });
  }

  bulkAddToGroup(emails: string[], group: string) {
    return this.request("panel/api/clients/groups/bulkAdd", {
      method: "POST",
      body: JSON.stringify({ emails, group }),
    });
  }

  getNewUUID() {
    return this.request<string>("panel/api/server/getNewUUID");
  }

  listClients() {
    return this.request<
      Array<{
        email?: string;
        subId?: string;
        uuid?: string;
        id?: string;
        totalGB?: number;
        expiryTime?: number;
        enable?: boolean;
        limitIp?: number;
        inboundIds?: number[];
      }>
    >("panel/api/clients/list");
  }

  /** Traffic / identity by client UUID (id). */
  getClientTrafficById(uuid: string) {
    return this.request<
      Array<{
        email?: string;
        up?: number;
        down?: number;
        total?: number;
        expiryTime?: number;
        enable?: boolean;
      }>
    >(`panel/api/inbounds/getClientTrafficsById/${encodeURIComponent(uuid)}`);
  }
}

export function createXuiFromEnv(env: {
  XUI_BASE_URL?: string;
  XUI_API_TOKEN?: string;
}) {
  if (!env.XUI_BASE_URL || !env.XUI_API_TOKEN) {
    throw new Error(
      formatXuiError("XUI_BASE_URL and XUI_API_TOKEN are not set"),
    );
  }
  return new XuiClient({
    baseUrl: env.XUI_BASE_URL,
    apiToken: env.XUI_API_TOKEN,
  });
}
