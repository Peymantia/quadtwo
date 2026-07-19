"use client";

import { useEffect, useState } from "react";
import { DashShell } from "../../components/DashShell";
import { api, formatToman } from "../../lib/api";
import { useDashAuth } from "../../lib/useDashAuth";

type Tab = "home" | "orders" | "pricing" | "configs" | "panels" | "users" | "settings" | "reports" | "import";

export default function AdminPage() {
  const { home, loading } = useDashAuth(["admin"]);
  const [tab, setTab] = useState<Tab>("home");
  const [stats, setStats] = useState<{
    pendingOrders: number;
    users: number;
    activeSubs: number;
    salesToday: { label: string; count: number };
  } | null>(null);
  const [orders, setOrders] = useState<Array<{ id: string; summary: string; price: number; user: { username: string | null; telegramId: string } }>>([]);
  const [matrix, setMatrix] = useState<Array<{ id?: string; trafficGb: number | null; months: number; priceUser: number; pricePartner: number; priceWholesale?: number }>>([]);
  const [groups, setGroups] = useState<Array<{ key: string; label: string }>>([]);
  const [configs, setConfigs] = useState<Array<{ email: string; code: string | null; subId: string | null; status: string | null }>>([]);
  const [groupKey, setGroupKey] = useState("all");
  const [panels, setPanels] = useState<Array<{ id: string; name: string; baseUrl: string; active: boolean; hasToken: boolean }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; username: string | null; telegramId: string; role: string; balance: number }>>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [reportText, setReportText] = useState("");
  const [audit, setAudit] = useState<Array<{ action: string; detail: string | null; createdAt: string }>>([]);
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cats, setCats] = useState<{ data: boolean; national: boolean; unlimited: boolean } | null>(null);

  useEffect(() => {
    if (!home) return;
    void api<NonNullable<typeof stats>>("/admin/home").then(setStats);
  }, [home]);

  useEffect(() => {
    if (!home) return;
    setMsg(null);
    setErr(null);
    if (tab === "orders") void api<{ orders: typeof orders }>("/admin/orders/pending").then((r) => setOrders(r.orders));
    if (tab === "pricing") {
      void api<{ cells: typeof matrix }>("/admin/matrix").then((r) => setMatrix(r.cells));
      void api<{ categories: typeof cats }>("/admin/sales-categories").then((r) => setCats(r.categories));
    }
    if (tab === "configs") {
      void api<{ groups: typeof groups }>("/admin/configs/groups").then((r) => setGroups(r.groups));
      void api<{ items: typeof configs }>(`/admin/configs/${groupKey}`).then((r) => setConfigs(r.items));
    }
    if (tab === "panels") void api<{ panels: typeof panels }>("/admin/panels").then((r) => setPanels(r.panels));
    if (tab === "users") void api<{ users: typeof users }>("/admin/users").then((r) => setUsers(r.users));
    if (tab === "settings") void api<{ settings: Record<string, string> }>("/admin/settings").then((r) => setSettings(r.settings));
    if (tab === "reports") {
      void api<{ text: string }>("/admin/reports/sales?period=week").then((r) => setReportText(r.text));
      void api<{ logs: typeof audit }>("/admin/audit").then((r) => setAudit(r.logs));
    }
  }, [home, tab, groupKey]);

  if (loading || !home) {
    return (
      <div className="login-page">
        <p className="muted">در حال بارگذاری…</p>
      </div>
    );
  }

  const tabs: Array<[Tab, string]> = [
    ["home", "خانه"],
    ["orders", "سفارش‌ها"],
    ["pricing", "قیمت"],
    ["configs", "کانفیگ‌ها"],
    ["panels", "پنل‌ها"],
    ["users", "کاربران"],
    ["settings", "تنظیمات"],
    ["reports", "گزارش"],
    ["import", "اکسل"],
  ];

  return (
    <DashShell
      title="کنترل سنتر"
      role={home.user.role}
      userLabel={home.user.username ? `@${home.user.username}` : home.user.firstName || ""}
      nav={[
        { href: "/admin", label: "ادمین" },
        { href: "/app", label: "حساب من" },
      ]}
    >
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" className={`chip${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}

      {tab === "home" && stats && (
        <div className="grid">
          <div className="stat">
            <div className="label">سفارش باز</div>
            <div className="value">{stats.pendingOrders}</div>
          </div>
          <div className="stat">
            <div className="label">کاربران</div>
            <div className="value">{stats.users}</div>
          </div>
          <div className="stat">
            <div className="label">سرویس فعال</div>
            <div className="value">{stats.activeSubs}</div>
          </div>
          <div className="stat">
            <div className="label">فروش امروز</div>
            <div className="value" style={{ fontSize: "1.1rem" }}>
              {stats.salesToday.label}
            </div>
          </div>
        </div>
      )}

      {tab === "orders" && (
        <div className="panel">
          <h2>سفارش‌های در انتظار</h2>
          <div className="list">
            {orders.map((o) => (
              <div key={o.id} className="row-card">
                <div>
                  <strong>{formatToman(o.price)}</strong>
                  <div className="muted">{o.summary}</div>
                  <div className="muted">
                    {o.user.username ? `@${o.user.username}` : o.user.telegramId}
                  </div>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn primary"
                    style={{ width: "auto" }}
                    onClick={async () => {
                      await api(`/admin/orders/${o.id}/approve`);
                      setMsg("تأیید شد");
                      const r = await api<{ orders: typeof orders }>("/admin/orders/pending");
                      setOrders(r.orders);
                    }}
                  >
                    تأیید
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={async () => {
                      await api(`/admin/orders/${o.id}/reject`);
                      setMsg("رد شد");
                      const r = await api<{ orders: typeof orders }>("/admin/orders/pending");
                      setOrders(r.orders);
                    }}
                  >
                    رد
                  </button>
                </div>
              </div>
            ))}
            {!orders.length && <p className="muted">سفارش بازی نیست.</p>}
          </div>
        </div>
      )}

      {tab === "pricing" && (
        <>
          {cats && (
            <div className="panel">
              <h2>دسته‌های فروش</h2>
              <div className="actions">
                {(["data", "national", "unlimited"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`chip${cats[k] ? " on" : ""}`}
                    onClick={async () => {
                      const next = { ...cats, [k]: !cats[k] };
                      await api("/admin/sales-categories", { method: "PUT", body: next });
                      setCats(next);
                    }}
                  >
                    {k === "data" ? "VIP" : k === "national" ? "ملی" : "نامحدود"} {cats[k] ? "🟢" : "🔴"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="panel">
            <h2>ماتریکس قیمت</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>حجم</th>
                  <th>ماه</th>
                  <th>کاربر</th>
                  <th>همکار</th>
                  <th>عمده</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((c, i) => (
                  <tr key={i}>
                    <td>{c.trafficGb ?? "∞"}</td>
                    <td>{c.months}</td>
                    <td>{c.priceUser.toLocaleString("fa-IR")}</td>
                    <td>{c.pricePartner.toLocaleString("fa-IR")}</td>
                    <td>{(c.priceWholesale ?? 0).toLocaleString("fa-IR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">ویرایش دقیق قیمت از ربات یا ورود اکسل.</p>
          </div>
        </>
      )}

      {tab === "configs" && (
        <div className="panel">
          <h2>کانفیگ‌ها</h2>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            {groups.map((g) => (
              <button key={g.key} type="button" className={`chip${groupKey === g.key ? " on" : ""}`} onClick={() => setGroupKey(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="list">
            {configs.map((c) => (
              <div key={c.email} className="row-card">
                <div>
                  <strong>{c.code || c.email}</strong>
                  <div className="muted">{c.email} · {c.status || "—"}</div>
                </div>
                <button
                  type="button"
                  className="btn danger"
                  onClick={async () => {
                    if (!confirm(`حذف ${c.email}؟`)) return;
                    const r = await api<{ message: string }>("/admin/configs/delete", {
                      body: { email: c.email, subId: c.subId },
                    });
                    setMsg(r.message);
                    const list = await api<{ items: typeof configs }>(`/admin/configs/${groupKey}`);
                    setConfigs(list.items);
                  }}
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "panels" && (
        <div className="panel">
          <h2>سرورهای پنل</h2>
          <div className="list">
            {panels.map((p) => (
              <div key={p.id} className="row-card">
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted">
                    {p.baseUrl} · {p.active ? "فعال" : "خاموش"} · توکن {p.hasToken ? "✓" : "✗"}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    try {
                      const r = await api<{ ok: boolean; inboundCount?: number; error?: string }>(`/admin/panels/${p.id}/test`);
                      setMsg(r.ok ? `اتصال OK — ${r.inboundCount} inbound` : r.error || "خطا");
                    } catch (e) {
                      setErr(String(e instanceof Error ? e.message : e));
                    }
                  }}
                >
                  تست
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="panel">
          <h2>کاربران</h2>
          <div className="field">
            <label>جستجو</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  const r = await api<{ users: Array<{ username: string | null; telegramId: string; role: string }>; orders: unknown[] }>(
                    `/admin/search?q=${encodeURIComponent(search)}`,
                  );
                  setSearchResult(`${r.users.length} کاربر · ${r.orders.length} سفارش`);
                }
              }}
            />
          </div>
          {searchResult && <p className="hint">{searchResult}</p>}
          <table className="table">
            <thead>
              <tr>
                <th>کاربر</th>
                <th>نقش</th>
                <th>کیف</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.slice(0, 40).map((u) => (
                <tr key={u.id}>
                  <td>{u.username ? `@${u.username}` : u.telegramId}</td>
                  <td>{u.role}</td>
                  <td>{formatToman(u.balance)}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={async (e) => {
                        await api(`/admin/users/${u.id}/role`, { body: { role: e.target.value } });
                        const r = await api<{ users: typeof users }>("/admin/users");
                        setUsers(r.users);
                      }}
                    >
                      <option value="user">user</option>
                      <option value="partner">partner</option>
                      <option value="wholesale">wholesale</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "settings" && (
        <div className="panel">
          <h2>تنظیمات</h2>
          {["brand_name", "welcome_text", "card_number", "card_holder", "support_username", "miniapp_url", "default_limit_ip"].map((k) => (
            <div className="field" key={k}>
              <label>{k}</label>
              <input
                value={settings[k] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [k]: e.target.value }))}
              />
            </div>
          ))}
          <button
            type="button"
            className="btn primary"
            style={{ width: "auto" }}
            onClick={async () => {
              await api("/admin/settings", { method: "PUT", body: settings });
              setMsg("ذخیره شد");
            }}
          >
            ذخیره
          </button>
        </div>
      )}

      {tab === "reports" && (
        <>
          <div className="panel">
            <h2>گزارش فروش</h2>
            <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {reportText}
            </pre>
          </div>
          <div className="panel">
            <h2>لاگ عملیات</h2>
            <div className="list">
              {audit.map((a, i) => (
                <div key={i} className="row-card">
                  <div>
                    <strong>{a.action}</strong>
                    <div className="muted">{a.detail}</div>
                  </div>
                  <span className="muted">{new Date(a.createdAt).toLocaleString("fa-IR")}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "import" && (
        <div className="panel">
          <h2>ورود از اکسل</h2>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const buf = await file.arrayBuffer();
                const r = await api<{ text: string }>("/admin/import", {
                  rawBody: buf,
                  headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
                });
                setMsg(r.text);
              } catch (ex) {
                setErr(String(ex instanceof Error ? ex.message : ex));
              }
            }}
          />
        </div>
      )}
    </DashShell>
  );
}
