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

export class XuiClient {
  private readonly baseUrl: string;

  constructor(private readonly opts: XuiClientOptions) {
    this.baseUrl = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
  }

  private url(path: string) {
    const clean = path.replace(/^\//, "");
    return new URL(clean, this.baseUrl).toString();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.opts.apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const text = await res.text();
    let json: ApiResult<T>;
    try {
      json = JSON.parse(text) as ApiResult<T>;
    } catch {
      throw new Error(`3x-ui ${res.status}: ${text.slice(0, 400)}`);
    }

    if (!res.ok || json.success === false) {
      throw new Error(`3x-ui error: ${json.msg ?? text.slice(0, 400)}`);
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
      body: JSON.stringify(body),
    });
  }

  updateClient(email: string, body: Record<string, unknown>) {
    return this.request(`panel/api/clients/update/${encodeURIComponent(email)}`, {
      method: "POST",
      body: JSON.stringify(body),
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
    }>(`panel/api/clients/get/${encodeURIComponent(email)}`);
  }

  clientLinks(email: string) {
    return this.request<string[]>(`panel/api/clients/links/${encodeURIComponent(email)}`);
  }

  getSettings() {
    return this.request<Record<string, unknown>>("panel/api/setting/all");
  }

  createGroup(name: string) {
    return this.request("panel/api/clients/groups/create", {
      method: "POST",
      body: JSON.stringify({ name }),
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
}

export function createXuiFromEnv(env: {
  XUI_BASE_URL?: string;
  XUI_API_TOKEN?: string;
}) {
  if (!env.XUI_BASE_URL || !env.XUI_API_TOKEN) {
    throw new Error("XUI_BASE_URL and XUI_API_TOKEN are not set");
  }
  return new XuiClient({
    baseUrl: env.XUI_BASE_URL,
    apiToken: env.XUI_API_TOKEN,
  });
}
