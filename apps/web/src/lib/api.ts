export function apiBase(): string {
  // Browser: same-origin so one Next build works for prod + demo hosts
  // (nginx routes /api to the correct backend by Host).
  if (typeof window !== "undefined") return "";
  return process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
}

/** @deprecated use apiBase() — kept for any external imports */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

export type Role = "user" | "partner" | "wholesale" | "reseller" | "admin";

export type SessionUser = {
  id: string;
  role: Role;
  firstName: string | null;
  username: string | null;
  telegramId?: string;
  panelGroup: string | null;
  agentName?: string | null;
  hasPassword?: boolean;
  hasPasskey?: boolean;
  passkeyCount?: number;
  isSuperAdmin?: boolean;
};

const TOKEN_KEY = "piing_dash_token";
const DEMO_ROLE_KEY = "piing_demo_role";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getDemoRole(): Role | null {
  if (typeof window === "undefined") return null;
  const r = localStorage.getItem(DEMO_ROLE_KEY);
  if (r === "user" || r === "partner" || r === "wholesale" || r === "reseller" || r === "admin") return r;
  return null;
}

export function setDemoRoleLocal(role: Role | null) {
  if (typeof window === "undefined") return;
  if (!role) localStorage.removeItem(DEMO_ROLE_KEY);
  else localStorage.setItem(DEMO_ROLE_KEY, role);
}

export async function api<T>(
  path: string,
  opts?: { method?: string; body?: unknown; token?: string | null; rawBody?: BodyInit; headers?: Record<string, string> },
): Promise<T> {
  const token = opts?.token === undefined ? getToken() : opts.token;
  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const demoRole = getDemoRole();
  if (demoRole) headers["X-Demo-Role"] = demoRole;
  // Dev / path-based tenancy: ?tenant=slug on the page URL
  if (typeof window !== "undefined") {
    const slug = new URLSearchParams(window.location.search).get("tenant");
    if (slug) headers["X-Tenant-Slug"] = slug;
  }
  if (opts?.body !== undefined && !opts.rawBody) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${apiBase()}/api${path}`, {
    method: opts?.method ?? (opts?.body || opts?.rawBody ? "POST" : "GET"),
    headers,
    body: opts?.rawBody ?? (opts?.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const obj = data as { error?: string; message?: string } | null;
    const err =
      (typeof obj?.error === "string" && obj.error) ||
      (typeof obj?.message === "string" && obj.message) ||
      (typeof text === "string" && text && !text.startsWith("{") ? text : null) ||
      res.statusText ||
      "خطا";
    throw new Error(err);
  }
  return data as T;
}

export function homePathForRole(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "reseller") return "/reseller";
  if (role === "wholesale") return "/wholesaler";
  if (role === "partner") return "/partner";
  return "/app";
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "admin":
      return "ادمین";
    case "partner":
      return "همکار";
    case "reseller":
      return "همکار ویژه";
    case "wholesale":
      return "عمده‌فروش";
    default:
      return "کاربر";
  }
}

export function formatToman(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fa-IR")} تومان`;
}
