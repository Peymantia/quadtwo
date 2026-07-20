"use client";

import { useCallback, useEffect, useState } from "react";
import { DashShell, LoadingScreen, type ShellTab } from "../../components/DashShell";
import { api, formatToman } from "../../lib/api";
import { useDashAuth } from "../../lib/useDashAuth";

const TABS: ShellTab[] = [
  { key: "home", label: "داشبورد", icon: "home" },
  { key: "orders", label: "سفارش‌ها", icon: "orders" },
  { key: "users", label: "کاربران", icon: "users" },
  { key: "prices", label: "قیمت‌ها", icon: "tag" },
  { key: "categories", label: "دسته‌ها", icon: "layers" },
  { key: "configs", label: "اکانت‌ها", icon: "wifi" },
  { key: "panels", label: "پنل‌ها", icon: "server" },
  { key: "settings", label: "تنظیمات", icon: "gear" },
  { key: "reports", label: "گزارش", icon: "chart" },
  { key: "import", label: "اکسل", icon: "file" },
];

type PendingOrder = {
  id: string;
  kind: string;
  status: string;
  price: number;
  summary: string;
  receiptText: string | null;
  createdAt: string;
  user: { username: string | null; telegramId: string; firstName: string | null };
};

type AdminUser = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  role: string;
  agentName: string | null;
  panelGroup: string | null;
  balance: number;
};

type PriceRow = {
  id: string;
  title: string | null;
  category: string;
  trafficGb: number | null;
  months: number;
  priceUser: number;
  pricePartner: number;
  priceWholesale: number;
  isGolden: boolean;
};

type CategoryRow = { key: string; label: string; enabled: boolean; cellCount: number };

type PanelRow = {
  id: string;
  name: string;
  baseUrl: string;
  active: boolean;
  sellEnabled: boolean;
  hasToken: boolean;
  inboundIds: string;
};

const ROLE_FA: Record<string, string> = {
  user: "کاربر",
  partner: "همکار",
  wholesale: "عمده‌فروش",
  admin: "ادمین",
};

export default function AdminPage() {
  const { home, loading } = useDashAuth(["admin"]);
  const [tab, setTab] = useState("home");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const flash = useCallback((ok: string | null, bad: string | null = null) => {
    setMsg(ok);
    setErr(bad);
  }, []);

  if (loading || !home) return <LoadingScreen />;

  const userLabel = home.user.username ? `@${home.user.username}` : home.user.firstName || "";

  return (
    <DashShell
      brand={home.brand}
      title="کنترل سنتر"
      role={home.user.role}
      userLabel={userLabel}
      walletLabel={formatToman(home.wallet.balance)}
      tabs={TABS}
      active={tab}
      onTab={(k) => {
        setTab(k);
        flash(null, null);
      }}
    >
      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert err">{err}</div>}

      {tab === "home" && <HomeTab onGo={setTab} />}
      {tab === "orders" && <OrdersTab flash={flash} />}
      {tab === "users" && <UsersTab flash={flash} />}
      {tab === "prices" && <PricesTab flash={flash} />}
      {tab === "categories" && <CategoriesTab flash={flash} />}
      {tab === "configs" && <ConfigsTab flash={flash} />}
      {tab === "panels" && <PanelsTab flash={flash} />}
      {tab === "settings" && <SettingsTab flash={flash} />}
      {tab === "reports" && <ReportsTab />}
      {tab === "import" && <ImportTab flash={flash} />}
    </DashShell>
  );
}

type Flash = (ok: string | null, bad?: string | null) => void;

function errText(e: unknown) {
  return String(e instanceof Error ? e.message : e);
}

/* ---------------- Home ---------------- */

function HomeTab({ onGo }: { onGo: (t: string) => void }) {
  const [stats, setStats] = useState<{
    pendingOrders: number;
    users: number;
    activeSubs: number;
    salesToday: { label: string; count: number };
  } | null>(null);

  useEffect(() => {
    void api<NonNullable<typeof stats>>("/admin/home").then(setStats);
  }, []);

  return (
    <>
      <div className="grid">
        <div className="stat accent">
          <div className="label">فروش امروز</div>
          <div className="value num">{stats?.salesToday.label ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">سفارش در انتظار</div>
          <div className="value num">{stats?.pendingOrders ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">کاربران</div>
          <div className="value num">{stats?.users ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">سرویس فعال</div>
          <div className="value num">{stats?.activeSubs ?? "—"}</div>
        </div>
      </div>
      <div className="panel">
        <h2>دسترسی سریع</h2>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onGo("orders")}>
            بررسی سفارش‌ها
          </button>
          <button type="button" className="btn ghost" onClick={() => onGo("users")}>
            مدیریت کاربران
          </button>
          <button type="button" className="btn ghost" onClick={() => onGo("prices")}>
            قیمت‌گذاری
          </button>
          <button type="button" className="btn ghost" onClick={() => onGo("settings")}>
            تنظیمات
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Orders ---------------- */

function OrdersTab({ flash }: { flash: Flash }) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () => api<{ orders: PendingOrder[] }>("/admin/orders/pending").then((r) => setOrders(r.orders)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      if (action === "reject") {
        const note = prompt("دلیل رد (اختیاری):") ?? "";
        await api(`/admin/orders/${id}/reject`, { body: { note } });
        flash("سفارش رد شد");
      } else {
        const r = await api<{ code?: string; walletBalance?: number }>(`/admin/orders/${id}/approve`, { body: {} });
        flash(r.walletBalance !== undefined ? "کیف پول کاربر شارژ شد ✅" : `تأیید شد ✅ ${r.code ?? ""}`);
      }
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel">
      <h2>سفارش‌های در انتظار بررسی</h2>
      <div className="list">
        {orders.map((o) => (
          <div key={o.id} className="row-card" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong className="num">{formatToman(o.price)}</strong>{" "}
              <span className={`badge ${o.status === "awaiting_review" ? "warn" : "info"}`}>
                {o.status === "awaiting_review" ? "منتظر تأیید" : "منتظر پرداخت"}
              </span>
              <pre className="muted" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "7px 0 0" }}>
                {o.summary}
              </pre>
              {o.receiptText && <div className="muted">رسید: {o.receiptText}</div>}
              <div className="muted" style={{ marginTop: 4 }}>
                {o.user.username ? `@${o.user.username}` : o.user.firstName || o.user.telegramId} ·{" "}
                {new Date(o.createdAt).toLocaleString("fa-IR")}
              </div>
            </div>
            <div className="actions" style={{ flexDirection: "column" }}>
              <button type="button" className="btn success sm" disabled={busy === o.id} onClick={() => act(o.id, "approve")}>
                تأیید و ساخت
              </button>
              <button type="button" className="btn danger sm" disabled={busy === o.id} onClick={() => act(o.id, "reject")}>
                رد
              </button>
            </div>
          </div>
        ))}
        {!orders.length && <p className="muted">سفارش باز وجود ندارد.</p>}
      </div>
    </div>
  );
}

/* ---------------- Users ---------------- */

function UsersTab({ flash }: { flash: Flash }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [detail, setDetail] = useState<{
    txs: Array<{ id: string; amount: number; type: string; note: string | null; createdAt: string }>;
    subscriptions: Array<{ id: string; code: string; status: string; expiresAt: string }>;
  } | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ users: AdminUser[] }>(`/admin/users${roleFilter ? `?role=${roleFilter}` : ""}`);
    setUsers(r.users);
  }, [roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void api<NonNullable<typeof detail> & { user: AdminUser }>(`/admin/users/${selected.id}`).then((r) =>
      setDetail({ txs: r.txs, subscriptions: r.subscriptions }),
    );
  }, [selected]);

  const shown = q.trim()
    ? users.filter(
        (u) =>
          (u.username || "").toLowerCase().includes(q.toLowerCase()) ||
          u.telegramId.includes(q) ||
          (u.firstName || "").includes(q) ||
          (u.agentName || "").includes(q),
      )
    : users;

  async function changeRole(u: AdminUser, role: string) {
    if (!confirm(`نقش ${u.username ? "@" + u.username : u.telegramId} به «${ROLE_FA[role]}» تغییر کند؟`)) return;
    try {
      await api(`/admin/users/${u.id}/role`, { body: { role } });
      flash("نقش تغییر کرد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function adjustWallet(sign: 1 | -1) {
    if (!selected) return;
    const amount = Number(walletAmount.replace(/[^\d]/g, "")) * sign;
    if (!amount) {
      flash(null, "مبلغ را وارد کنید");
      return;
    }
    try {
      const r = await api<{ balance: number }>(`/admin/users/${selected.id}/wallet`, {
        body: { amount, note: walletNote || undefined },
      });
      flash(`انجام شد — موجودی جدید: ${formatToman(r.balance)}`);
      setWalletAmount("");
      setWalletNote("");
      await load();
      setSelected((s) => (s ? { ...s, balance: r.balance } : s));
    } catch (e) {
      flash(null, errText(e));
    }
  }

  return (
    <>
      <div className="panel">
        <h2>کاربران</h2>
        <div className="actions" style={{ marginBottom: 12 }}>
          {["", "user", "partner", "wholesale", "admin"].map((r) => (
            <button
              key={r || "all"}
              type="button"
              className={`chip${roleFilter === r ? " on" : ""}`}
              onClick={() => setRoleFilter(r)}
            >
              {r ? ROLE_FA[r] : "همه"}
            </button>
          ))}
        </div>
        <div className="field">
          <label>جستجو (یوزرنیم، آی‌دی، نام)</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>کاربر</th>
                <th>نقش</th>
                <th>کیف پول</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 60).map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username ? `@${u.username}` : u.firstName || u.telegramId}</strong>
                    {u.agentName && <div className="muted">{u.agentName}</div>}
                    <div className="muted num">{u.telegramId}</div>
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                      {Object.entries(ROLE_FA).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{formatToman(u.balance)}</td>
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => setSelected(u)}>
                      جزئیات / شارژ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && <p className="muted">کاربری یافت نشد.</p>}
      </div>

      {selected && (
        <div className="panel">
          <h2>
            {selected.username ? `@${selected.username}` : selected.firstName || selected.telegramId} —{" "}
            {ROLE_FA[selected.role]}
          </h2>
          <div className="grid">
            <div className="stat accent">
              <div className="label">موجودی</div>
              <div className="value num">{formatToman(selected.balance)}</div>
            </div>
            {selected.panelGroup && (
              <div className="stat">
                <div className="label">گروه پنل</div>
                <div className="value" style={{ fontSize: "0.95rem" }}>
                  {selected.panelGroup}
                </div>
              </div>
            )}
          </div>

          <h2 style={{ marginTop: 4 }}>تغییر دستی شارژ حساب</h2>
          <div className="field">
            <label>مبلغ (تومان)</label>
            <input
              className="num"
              inputMode="numeric"
              value={walletAmount}
              onChange={(e) => setWalletAmount(e.target.value)}
              placeholder="مثلاً 50000"
            />
          </div>
          <div className="field">
            <label>توضیح (اختیاری)</label>
            <input value={walletNote} onChange={(e) => setWalletNote(e.target.value)} />
          </div>
          <div className="actions">
            <button type="button" className="btn success" onClick={() => adjustWallet(1)}>
              افزایش موجودی
            </button>
            <button type="button" className="btn danger" onClick={() => adjustWallet(-1)}>
              کسر از موجودی
            </button>
            <button type="button" className="btn ghost" onClick={() => setSelected(null)}>
              بستن
            </button>
          </div>

          {detail && (
            <>
              <h2 style={{ marginTop: 18 }}>سرویس‌ها</h2>
              <div className="list">
                {detail.subscriptions.map((s) => (
                  <div key={s.id} className="row-card">
                    <strong className="num">{s.code}</strong>
                    <span className={`badge ${s.status === "active" ? "ok" : "bad"}`}>
                      {s.status === "active" ? "فعال" : s.status} · {new Date(s.expiresAt).toLocaleDateString("fa-IR")}
                    </span>
                  </div>
                ))}
                {!detail.subscriptions.length && <p className="muted">سرویسی ندارد.</p>}
              </div>
              <h2 style={{ marginTop: 18 }}>تراکنش‌های کیف پول</h2>
              <div className="list">
                {detail.txs.map((t) => (
                  <div key={t.id} className="row-card">
                    <div>
                      <strong className="num">{formatToman(t.amount)}</strong>
                      <div className="muted">{t.note || t.type}</div>
                    </div>
                    <span className="muted">{new Date(t.createdAt).toLocaleDateString("fa-IR")}</span>
                  </div>
                ))}
                {!detail.txs.length && <p className="muted">تراکنشی ندارد.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/* ---------------- Prices ---------------- */

function PricesTab({ flash }: { flash: Flash }) {
  const [cells, setCells] = useState<PriceRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<PriceRow>>>({});
  const [catFilter, setCatFilter] = useState("");
  const [bulkMode, setBulkMode] = useState<"percent" | "amount">("percent");
  const [bulkValue, setBulkValue] = useState("");
  const [newCell, setNewCell] = useState({
    category: "data",
    trafficGb: "",
    months: "1",
    priceUser: "",
    pricePartner: "",
    priceWholesale: "",
    title: "",
  });

  const load = useCallback(() => api<{ cells: PriceRow[] }>("/admin/prices").then((r) => setCells(r.cells)), []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = catFilter ? cells.filter((c) => c.category === catFilter) : cells;

  async function saveRow(c: PriceRow) {
    const e = edits[c.id];
    if (!e) return;
    try {
      await api(`/admin/prices/${c.id}`, {
        method: "PUT",
        body: {
          priceUser: Number(e.priceUser ?? c.priceUser),
          pricePartner: Number(e.pricePartner ?? c.pricePartner),
          priceWholesale: Number(e.priceWholesale ?? c.priceWholesale),
          title: e.title ?? c.title,
        },
      });
      flash("قیمت ذخیره شد");
      setEdits((m) => {
        const n = { ...m };
        delete n[c.id];
        return n;
      });
      await load();
    } catch (er) {
      flash(null, errText(er));
    }
  }

  async function deleteRow(c: PriceRow) {
    if (!confirm(`پلن ${c.trafficGb ?? "∞"}GB / ${c.months} ماه حذف شود؟`)) return;
    try {
      await api(`/admin/prices/${c.id}`, { method: "DELETE" });
      flash("پلن حذف شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function addCell() {
    try {
      await api("/admin/prices", {
        body: {
          category: newCell.category,
          trafficGb: newCell.trafficGb === "" ? null : Number(newCell.trafficGb),
          months: Number(newCell.months),
          priceUser: Number(newCell.priceUser),
          pricePartner: Number(newCell.pricePartner),
          priceWholesale: newCell.priceWholesale ? Number(newCell.priceWholesale) : undefined,
          title: newCell.title || undefined,
        },
      });
      flash("پلن جدید اضافه شد");
      setNewCell({ category: "data", trafficGb: "", months: "1", priceUser: "", pricePartner: "", priceWholesale: "", title: "" });
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function bulk() {
    const value = Number(bulkValue);
    if (!value) {
      flash(null, "مقدار را وارد کنید (مثلاً 10 یا -5)");
      return;
    }
    const label =
      bulkMode === "percent"
        ? `${value}% ${value > 0 ? "افزایش" : "کاهش"}`
        : `${formatToman(Math.abs(value))} ${value > 0 ? "افزایش" : "کاهش"}`;
    if (!confirm(`قیمت ${catFilter ? "دستهٔ انتخابی" : "همهٔ پلن‌ها"} ${label} یابد؟`)) return;
    try {
      const r = await api<{ updated: number }>("/admin/prices/bulk", {
        body: { category: catFilter || undefined, mode: bulkMode, value, roundTo: 1000 },
      });
      flash(`${r.updated} پلن به‌روزرسانی شد`);
      setBulkValue("");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  return (
    <>
      <div className="panel">
        <h2>ویرایش گروهی قیمت‌ها</h2>
        <div className="actions" style={{ marginBottom: 12 }}>
          {["", "data", "national", "unlimited"].map((c) => (
            <button key={c || "all"} type="button" className={`chip${catFilter === c ? " on" : ""}`} onClick={() => setCatFilter(c)}>
              {c === "" ? "همه" : c === "data" ? "حجمی" : c === "national" ? "ملی" : "نامحدود"}
            </button>
          ))}
        </div>
        <div className="actions" style={{ alignItems: "center" }}>
          <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "percent" | "amount")} className="chip on" style={{ cursor: "pointer" }}>
            <option value="percent">درصدی</option>
            <option value="amount">مبلغ ثابت</option>
          </select>
          <input
            className="num"
            style={{
              border: "1px solid var(--line)",
              background: "rgba(10,13,35,.6)",
              color: "var(--text)",
              borderRadius: 11,
              padding: "9px 12px",
              width: 130,
            }}
            inputMode="numeric"
            placeholder={bulkMode === "percent" ? "مثلاً 10 یا -5" : "مثلاً 5000"}
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
          />
          <button type="button" className="btn primary sm" onClick={bulk}>
            اعمال روی {catFilter ? "این دسته" : "همه"}
          </button>
        </div>
        <p className="hint">مقدار منفی = کاهش قیمت. نتیجه به نزدیک‌ترین ۱٬۰۰۰ تومان گرد می‌شود و روی هر سه ستون قیمت اعمال می‌شود.</p>
      </div>

      <div className="panel">
        <h2>پلن‌ها و قیمت‌ها</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>پلن</th>
                <th>کاربر</th>
                <th>همکار</th>
                <th>عمده</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const e = edits[c.id] ?? {};
                return (
                  <tr key={c.id}>
                    <td>
                      <strong className="num">{c.trafficGb ?? "∞"}GB · {c.months}ماه</strong>
                      {c.isGolden && " ⭐"}
                      <div className="muted">{c.category === "data" ? "حجمی" : c.category === "national" ? "ملی" : "نامحدود"}</div>
                    </td>
                    <td>
                      <input
                        className="num"
                        inputMode="numeric"
                        value={String(e.priceUser ?? c.priceUser)}
                        onChange={(ev) => setEdits((m) => ({ ...m, [c.id]: { ...m[c.id], priceUser: Number(ev.target.value) || 0 } }))}
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        inputMode="numeric"
                        value={String(e.pricePartner ?? c.pricePartner)}
                        onChange={(ev) => setEdits((m) => ({ ...m, [c.id]: { ...m[c.id], pricePartner: Number(ev.target.value) || 0 } }))}
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        inputMode="numeric"
                        value={String(e.priceWholesale ?? c.priceWholesale)}
                        onChange={(ev) => setEdits((m) => ({ ...m, [c.id]: { ...m[c.id], priceWholesale: Number(ev.target.value) || 0 } }))}
                      />
                    </td>
                    <td>
                      <div className="actions">
                        <button type="button" className="btn primary sm" disabled={!edits[c.id]} onClick={() => saveRow(c)}>
                          ذخیره
                        </button>
                        <button type="button" className="btn danger sm" onClick={() => deleteRow(c)}>
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!shown.length && <p className="muted">پلنی در این دسته نیست.</p>}
      </div>

      <div className="panel">
        <h2>افزودن پلن جدید</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <div className="field">
            <label>دسته</label>
            <select value={newCell.category} onChange={(e) => setNewCell((s) => ({ ...s, category: e.target.value }))}>
              <option value="data">حجمی</option>
              <option value="national">ملی</option>
              <option value="unlimited">نامحدود</option>
            </select>
          </div>
          <div className="field">
            <label>حجم GB (خالی = نامحدود)</label>
            <input className="num" inputMode="numeric" value={newCell.trafficGb} onChange={(e) => setNewCell((s) => ({ ...s, trafficGb: e.target.value }))} />
          </div>
          <div className="field">
            <label>مدت (ماه)</label>
            <input className="num" inputMode="numeric" value={newCell.months} onChange={(e) => setNewCell((s) => ({ ...s, months: e.target.value }))} />
          </div>
          <div className="field">
            <label>قیمت کاربر</label>
            <input className="num" inputMode="numeric" value={newCell.priceUser} onChange={(e) => setNewCell((s) => ({ ...s, priceUser: e.target.value }))} />
          </div>
          <div className="field">
            <label>قیمت همکار</label>
            <input className="num" inputMode="numeric" value={newCell.pricePartner} onChange={(e) => setNewCell((s) => ({ ...s, pricePartner: e.target.value }))} />
          </div>
          <div className="field">
            <label>قیمت عمده</label>
            <input className="num" inputMode="numeric" value={newCell.priceWholesale} onChange={(e) => setNewCell((s) => ({ ...s, priceWholesale: e.target.value }))} />
          </div>
          <div className="field">
            <label>عنوان (اختیاری)</label>
            <input value={newCell.title} onChange={(e) => setNewCell((s) => ({ ...s, title: e.target.value }))} />
          </div>
        </div>
        <button
          type="button"
          className="btn success"
          disabled={!newCell.months || !newCell.priceUser || !newCell.pricePartner}
          onClick={addCell}
        >
          افزودن پلن
        </button>
      </div>
    </>
  );
}

/* ---------------- Categories ---------------- */

function CategoriesTab({ flash }: { flash: Flash }) {
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});

  const load = useCallback(() => api<{ categories: CategoryRow[] }>("/admin/categories").then((r) => setCats(r.categories)), []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(c: CategoryRow, patch: { label?: string; enabled?: boolean }) {
    try {
      await api(`/admin/categories/${c.key}`, { method: "PUT", body: patch });
      flash("ذخیره شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function remove(c: CategoryRow) {
    if (!confirm(`دستهٔ «${c.label}» حذف شود؟ فروش غیرفعال و ${c.cellCount} پلن آن حذف می‌شود.`)) return;
    try {
      const r = await api<{ deactivated: number }>(`/admin/categories/${c.key}`, { method: "DELETE" });
      flash(`دسته حذف شد (${r.deactivated} پلن غیرفعال شد)`);
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  return (
    <div className="panel">
      <h2>مدیریت دسته‌بندی‌ها</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        نام نمایشی هر دسته را ویرایش کنید، فروش آن را فعال/غیرفعال کنید یا کل دسته را همراه پلن‌هایش حذف کنید.
      </p>
      <div className="list">
        {cats.map((c) => (
          <div key={c.key} className="row-card" style={{ alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>
                  نام دسته ({c.key}) — {c.cellCount} پلن
                </label>
                <input
                  value={labelEdits[c.key] ?? c.label}
                  onChange={(e) => setLabelEdits((m) => ({ ...m, [c.key]: e.target.value }))}
                />
              </div>
            </div>
            <div className="actions" style={{ alignItems: "center" }}>
              <label className="switch" title="فعال/غیرفعال کردن فروش">
                <input type="checkbox" checked={c.enabled} onChange={(e) => save(c, { enabled: e.target.checked })} />
                <span className="track" />
              </label>
              <button
                type="button"
                className="btn primary sm"
                disabled={(labelEdits[c.key] ?? c.label) === c.label}
                onClick={() => save(c, { label: labelEdits[c.key] })}
              >
                ذخیره نام
              </button>
              <button type="button" className="btn danger sm" onClick={() => remove(c)}>
                حذف دسته
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Configs (panel accounts) ---------------- */

function ConfigsTab({ flash }: { flash: Flash }) {
  const [groups, setGroups] = useState<Array<{ key: string; label: string }>>([]);
  const [groupKey, setGroupKey] = useState("all");
  const [items, setItems] = useState<Array<{ email: string; code: string | null; subId: string | null; status: string | null; inDb: boolean; ownerLabel: string }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api<{ groups: typeof groups }>("/admin/configs/groups").then((r) => setGroups(r.groups));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: typeof items; total: number }>(`/admin/configs/${groupKey}?page=${page}`);
      setItems(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [groupKey, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(email: string, subId: string | null) {
    if (!confirm(`اکانت ${email} از پنل و ربات حذف شود؟`)) return;
    try {
      const r = await api<{ message: string }>("/admin/configs/delete", { body: { email, subId } });
      flash(r.message);
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  return (
    <div className="panel">
      <h2>اکانت‌ها بر اساس گروه پنل</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        شامل اکانت‌هایی که مستقیم در پنل 3x-ui ساخته شده‌اند (برچسب «فقط پنل»).
      </p>
      <div className="chip-row" style={{ marginBottom: 13 }}>
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`chip${groupKey === g.key ? " on" : ""}`}
            onClick={() => {
              setGroupKey(g.key);
              setPage(0);
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
      {loading && <p className="muted">در حال دریافت…</p>}
      <div className="list">
        {items.map((c) => (
          <div key={c.email} className="row-card">
            <div>
              <strong className="num">{c.code || c.email}</strong>{" "}
              {!c.inDb && <span className="badge warn">فقط پنل</span>}
              {c.status === "active" && <span className="badge ok">فعال</span>}
              <div className="muted num">{c.email}</div>
              <div className="muted">{c.ownerLabel}</div>
            </div>
            <button type="button" className="btn danger sm" onClick={() => remove(c.email, c.subId)}>
              حذف
            </button>
          </div>
        ))}
        {!items.length && !loading && <p className="muted">اکانتی در این گروه نیست.</p>}
      </div>
      {total > 30 && (
        <div className="actions" style={{ marginTop: 13 }}>
          <button type="button" className="btn ghost sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            قبلی
          </button>
          <span className="muted" style={{ alignSelf: "center" }}>
            صفحه {page + 1} از {Math.ceil(total / 30)}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={(page + 1) * 30 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            بعدی
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Panels ---------------- */

function PanelsTab({ flash }: { flash: Flash }) {
  const [panels, setPanels] = useState<PanelRow[]>([]);
  const [form, setForm] = useState({ name: "", baseUrl: "", apiToken: "", inboundIds: "1" });

  const load = useCallback(() => api<{ panels: PanelRow[] }>("/admin/panels").then((r) => setPanels(r.panels)), []);

  useEffect(() => {
    void load();
  }, [load]);

  async function test(id: string) {
    try {
      const r = await api<{ ok: boolean; inboundCount?: number; error?: string }>(`/admin/panels/${id}/test`, { body: {} });
      flash(r.ok ? `اتصال برقرار است — ${r.inboundCount} اینباند` : null, r.ok ? null : r.error || "خطا در اتصال");
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function toggle(p: PanelRow, key: "active" | "sellEnabled", value: boolean) {
    try {
      await api(`/admin/panels/${p.id}`, { method: "PUT", body: { [key]: value } });
      flash("ذخیره شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function add() {
    try {
      await api("/admin/panels", { body: form });
      flash("پنل اضافه شد");
      setForm({ name: "", baseUrl: "", apiToken: "", inboundIds: "1" });
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  return (
    <>
      <div className="panel">
        <h2>سرورهای پنل</h2>
        <div className="list">
          {panels.map((p) => (
            <div key={p.id} className="row-card">
              <div>
                <strong>{p.name}</strong>
                <div className="muted num">{p.baseUrl}</div>
                <div className="muted">
                  اینباند: <span className="num">{p.inboundIds}</span> · توکن {p.hasToken ? "✓" : "✗"}
                </div>
              </div>
              <div className="actions" style={{ alignItems: "center" }}>
                <label className="switch" title="فعال">
                  <input type="checkbox" checked={p.active} onChange={(e) => toggle(p, "active", e.target.checked)} />
                  <span className="track" />
                </label>
                <button type="button" className="btn ghost sm" onClick={() => test(p.id)}>
                  تست اتصال
                </button>
              </div>
            </div>
          ))}
          {!panels.length && <p className="muted">پنلی ثبت نشده — از .env استفاده می‌شود.</p>}
        </div>
      </div>
      <div className="panel">
        <h2>افزودن پنل</h2>
        <div className="field">
          <label>نام</label>
          <input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </div>
        <div className="field">
          <label>آدرس (https://panel.example.com:2053)</label>
          <input dir="ltr" value={form.baseUrl} onChange={(e) => setForm((s) => ({ ...s, baseUrl: e.target.value }))} />
        </div>
        <div className="field">
          <label>توکن API</label>
          <input dir="ltr" value={form.apiToken} onChange={(e) => setForm((s) => ({ ...s, apiToken: e.target.value }))} />
        </div>
        <div className="field">
          <label>شناسه اینباندها (مثلاً 1,2,3)</label>
          <input dir="ltr" className="num" value={form.inboundIds} onChange={(e) => setForm((s) => ({ ...s, inboundIds: e.target.value }))} />
        </div>
        <button type="button" className="btn success" disabled={!form.name || !form.baseUrl || !form.apiToken} onClick={add}>
          افزودن پنل
        </button>
      </div>
    </>
  );
}

/* ---------------- Settings ---------------- */

const TEXT_SETTINGS: Array<{ key: string; label: string; ltr?: boolean; multiline?: boolean }> = [
  { key: "brand_name", label: "نام برند" },
  { key: "card_number", label: "شماره کارت", ltr: true },
  { key: "card_holder", label: "نام صاحب کارت" },
  { key: "support_username", label: "یوزرنیم پشتیبانی (بدون @)", ltr: true },
  { key: "miniapp_url", label: "آدرس مینی‌اپ", ltr: true },
  { key: "welcome_text", label: "متن خوش‌آمد ربات", multiline: true },
  { key: "guide_text", label: "متن آموزش اتصال", multiline: true },
];

function SettingsTab({ flash }: { flash: Flash }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api<{ settings: Record<string, string> }>("/admin/settings").then((r) => {
      setSettings(r.settings);
      setLoaded(true);
    });
  }, []);

  async function save(patch: Record<string, string>) {
    try {
      await api("/admin/settings", { method: "PUT", body: patch });
      setSettings((s) => ({ ...s, ...patch }));
      flash("تنظیمات ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    }
  }

  if (!loaded) return <p className="muted">در حال دریافت تنظیمات…</p>;

  const multiMonth = Number(settings.max_purchase_months || "1") > 1;

  return (
    <>
      <div className="panel">
        <h2>قوانین فروش</h2>
        <div className="setting-row">
          <div>
            <div className="t">فروش اشتراک بیش از یک ماه</div>
            <div className="d">با غیرفعال بودن، فقط پلن‌های یک‌ماهه قابل خرید هستند.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={multiMonth}
              onChange={(e) => save({ max_purchase_months: e.target.checked ? "12" : "1" })}
            />
            <span className="track" />
          </label>
        </div>
        {multiMonth && (
          <div className="setting-row">
            <div>
              <div className="t">حداکثر ماه قابل خرید</div>
            </div>
            <select
              value={settings.max_purchase_months || "12"}
              onChange={(e) => save({ max_purchase_months: e.target.value })}
              style={{
                border: "1px solid var(--line)",
                background: "rgba(10,13,35,.6)",
                color: "var(--text)",
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              {[2, 3, 6, 12].map((m) => (
                <option key={m} value={String(m)}>
                  {m} ماه
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="setting-row">
          <div>
            <div className="t">سرویس تست رایگان</div>
            <div className="d">کاربران بتوانند یک اکانت تست دریافت کنند.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.test_service_enabled !== "false"}
              onChange={(e) => save({ test_service_enabled: e.target.checked ? "true" : "false" })}
            />
            <span className="track" />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">محدودیت پیش‌فرض دستگاه (IP)</div>
            <div className="d">۰ یعنی نامحدود.</div>
          </div>
          <select
            value={settings.default_limit_ip || "2"}
            onChange={(e) => save({ default_limit_ip: e.target.value })}
            style={{
              border: "1px solid var(--line)",
              background: "rgba(10,13,35,.6)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "8px 12px",
            }}
          >
            {[0, 1, 2, 3, 4, 5, 10].map((n) => (
              <option key={n} value={String(n)}>
                {n === 0 ? "نامحدود" : `${n} دستگاه`}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">حالت قیمت‌گذاری</div>
            <div className="d">ماتریکس = پلن‌های ثابت · نرخی = فرمول حجم × ماه</div>
          </div>
          <select
            value={settings.pricing_mode || "matrix"}
            onChange={(e) => save({ pricing_mode: e.target.value })}
            style={{
              border: "1px solid var(--line)",
              background: "rgba(10,13,35,.6)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "8px 12px",
            }}
          >
            <option value="matrix">ماتریکس</option>
            <option value="rate">نرخی</option>
          </select>
        </div>
      </div>

      <div className="panel">
        <h2>اطلاعات پایه</h2>
        {TEXT_SETTINGS.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            {f.multiline ? (
              <textarea
                rows={4}
                value={settings[f.key] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                dir={f.ltr ? "ltr" : undefined}
                value={settings[f.key] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn primary"
          onClick={() => save(Object.fromEntries(TEXT_SETTINGS.map((f) => [f.key, settings[f.key] ?? ""])))}
        >
          ذخیره اطلاعات پایه
        </button>
      </div>
    </>
  );
}

/* ---------------- Reports ---------------- */

function ReportsTab() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("week");
  const [report, setReport] = useState<{ total: number; count: number } | null>(null);
  const [audit, setAudit] = useState<Array<{ action: string; detail: string | null; createdAt: string }>>([]);

  useEffect(() => {
    void api<{ total: number; count: number }>(`/admin/reports/sales?period=${period}`).then(setReport);
  }, [period]);

  useEffect(() => {
    void api<{ logs: typeof audit }>("/admin/audit").then((r) => setAudit(r.logs));
  }, []);

  return (
    <>
      <div className="panel">
        <h2>گزارش فروش</h2>
        <div className="chip-row" style={{ marginBottom: 13 }}>
          {(
            [
              ["today", "امروز"],
              ["week", "هفته"],
              ["month", "ماه"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={`chip${period === k ? " on" : ""}`} onClick={() => setPeriod(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid">
          <div className="stat accent">
            <div className="label">جمع فروش</div>
            <div className="value num">{report ? formatToman(report.total) : "—"}</div>
          </div>
          <div className="stat">
            <div className="label">تعداد سفارش</div>
            <div className="value num">{report?.count ?? "—"}</div>
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>لاگ عملیات</h2>
        <div className="list">
          {audit.map((a, i) => (
            <div key={i} className="row-card">
              <div>
                <strong>{a.action}</strong>
                {a.detail && <div className="muted">{a.detail}</div>}
              </div>
              <span className="muted">{new Date(a.createdAt).toLocaleString("fa-IR")}</span>
            </div>
          ))}
          {!audit.length && <p className="muted">لاگی ثبت نشده.</p>}
        </div>
      </div>
    </>
  );
}

/* ---------------- Import ---------------- */

function ImportTab({ flash }: { flash: Flash }) {
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState("");

  return (
    <div className="panel">
      <h2>ورود قیمت و تنظیمات از اکسل</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        فایل xlsx را انتخاب کنید — همان قالبی که در ربات استفاده می‌شود.
      </p>
      <input
        type="file"
        accept=".xlsx,.xls"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const buf = await file.arrayBuffer();
            const r = await api<{ text: string }>("/admin/import", {
              rawBody: buf,
              headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            });
            setResultText(r.text);
            flash("فایل پردازش شد");
          } catch (ex) {
            flash(null, errText(ex));
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
      {resultText && (
        <pre className="muted" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 13 }}>
          {resultText}
        </pre>
      )}
    </div>
  );
}
