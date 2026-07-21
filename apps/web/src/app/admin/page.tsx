"use client";

import { useCallback, useEffect, useState } from "react";
import { DashShell, LoadingScreen, type ShellTab } from "../../components/DashShell";
import { Modal } from "../../components/Modal";
import { ConfirmToast, Toast } from "../../components/Toast";
import { PasswordSettings } from "../../components/PasswordSettings";
import { TrafficProgress } from "../../components/PaymentCard";
import { api, formatToman } from "../../lib/api";
import { useDashAuth } from "../../lib/useDashAuth";

const TABS: ShellTab[] = [
  { key: "home", label: "داشبورد", icon: "home", pin: true },
  { key: "orders", label: "سفارش‌ها", icon: "orders", pin: true },
  { key: "users", label: "کاربران", icon: "users", pin: true },
  { key: "configs", label: "اکانت‌ها", icon: "wifi", pin: true },
  { key: "prices", label: "قیمت‌ها", icon: "tag" },
  { key: "categories", label: "دسته‌ها", icon: "layers" },
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
  active: boolean;
};

type CategoryRow = { key: string; label: string; enabled: boolean; cellCount: number; builtin?: boolean };

type PanelRow = {
  id: string;
  name: string;
  baseUrl: string;
  active: boolean;
  sellEnabled: boolean;
  hasToken: boolean;
  inboundIds: string;
  subBase?: string | null;
  weight?: number;
  categories?: string;
};

const FALLBACK_CATEGORIES = [
  { key: "data", label: "حجمی" },
  { key: "national", label: "ملی" },
  { key: "unlimited", label: "نامحدود" },
];

function catLabel(key: string, cats?: Array<{ key: string; label: string }>) {
  return cats?.find((c) => c.key === key)?.label || FALLBACK_CATEGORIES.find((c) => c.key === key)?.label || key;
}

function parseCats(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return ["data", "unlimited"];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as string[]) : ["data", "unlimited"];
  } catch {
    return ["data", "unlimited"];
  }
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Thousand-separated price for inputs (e.g. 150,000). */
function formatPriceInput(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : parsePriceInput(String(n));
  if (!Number.isFinite(num)) return "";
  return Math.trunc(num).toLocaleString("en-US");
}

function parsePriceInput(raw: string): number {
  const cleaned = String(raw).replace(/[^\d]/g, "");
  if (!cleaned) return 0;
  return Number(cleaned);
}

const ROLE_FA: Record<string, string> = {
  user: "کاربر",
  partner: "همکار",
  wholesale: "عمده‌فروش",
  admin: "ادمین",
};

export default function AdminPage() {
  const { home, loading, reload } = useDashAuth(["admin"]);
  const [tab, setTab] = useState("home");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);

  const flash = useCallback((ok: string | null, bad: string | null = null) => {
    setMsg(ok);
    setErr(bad);
  }, []);

  const clearFlash = useCallback(() => {
    setMsg(null);
    setErr(null);
  }, []);

  const askConfirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        setConfirm({ message, resolve });
        setMsg(null);
        setErr(null);
      }),
    [],
  );

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
      <Toast msg={msg} err={err} onClear={clearFlash} />
      {confirm && (
        <ConfirmToast
          message={confirm.message}
          onYes={() => {
            confirm.resolve(true);
            setConfirm(null);
          }}
          onNo={() => {
            confirm.resolve(false);
            setConfirm(null);
          }}
        />
      )}

      {tab === "home" && <HomeTab onGo={setTab} />}
      {tab === "orders" && <OrdersTab flash={flash} />}
      {tab === "users" && <UsersTab flash={flash} askConfirm={askConfirm} />}
      {tab === "prices" && <PricesTab flash={flash} askConfirm={askConfirm} />}
      {tab === "categories" && <CategoriesTab flash={flash} askConfirm={askConfirm} />}
      {tab === "configs" && <ConfigsTab flash={flash} askConfirm={askConfirm} />}
      {tab === "panels" && <PanelsTab flash={flash} />}
      {tab === "settings" && (
        <SettingsTab flash={flash} hasPassword={Boolean(home.user.hasPassword)} onPasswordSaved={() => void reload()} />
      )}
      {tab === "reports" && <ReportsTab />}
      {tab === "import" && <ImportTab flash={flash} />}
    </DashShell>
  );
}

type Flash = (ok: string | null, bad?: string | null) => void;
type AskConfirm = (message: string) => Promise<boolean>;

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
      <div className="grid stats-row-4">
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
        <div className="quick-actions">
          <button type="button" className="btn primary wide" onClick={() => onGo("orders")}>
            بررسی سفارش‌ها
          </button>
          <button type="button" className="btn light wide" onClick={() => onGo("users")}>
            مدیریت کاربران
          </button>
          <button type="button" className="btn ghost wide" onClick={() => onGo("prices")}>
            قیمت‌گذاری
          </button>
          <button type="button" className="btn ghost wide" onClick={() => onGo("settings")}>
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
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});

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
        const note = (rejectNote[id] ?? "").trim();
        await api(`/admin/orders/${id}/reject`, { body: { note } });
        flash("سفارش رد شد");
        setRejectNote((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        });
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
              <div className="field" style={{ margin: 0, minWidth: 160 }}>
                <label>دلیل رد (اختیاری)</label>
                <input
                  value={rejectNote[o.id] ?? ""}
                  onChange={(e) => setRejectNote((m) => ({ ...m, [o.id]: e.target.value }))}
                  placeholder="مثلاً رسید نامعتبر"
                />
              </div>
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

function UsersTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
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
    if (!(await askConfirm(`نقش ${u.username ? "@" + u.username : u.telegramId} به «${ROLE_FA[role]}» تغییر کند؟`))) return;
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

  async function zeroWallet() {
    if (!selected || selected.balance <= 0) return;
    if (!(await askConfirm(`موجودی ${formatToman(selected.balance)} صفر شود؟`))) return;
    try {
      const r = await api<{ balance: number }>(`/admin/users/${selected.id}/wallet`, {
        body: { amount: -selected.balance, note: walletNote || "صفر کردن موجودی توسط ادمین" },
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
          {shown.length > 60 && (
            <p className="muted" style={{ marginTop: 10 }}>
              نمایش ۶۰ از {shown.length} کاربر — جستجو یا فیلتر نقش را دقیق‌تر کنید.
            </p>
          )}
        </div>
        {!shown.length && <p className="muted">کاربری یافت نشد.</p>}
      </div>

      {selected && (
        <Modal
          open
          title={`${selected.username ? `@${selected.username}` : selected.firstName || selected.telegramId} — ${ROLE_FA[selected.role]}`}
          onClose={() => setSelected(null)}
          wide
        >
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

          <h2 style={{ marginTop: 4, fontSize: "1rem" }}>تغییر دستی شارژ حساب</h2>
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
            <button type="button" className="btn ghost" disabled={!selected || selected.balance <= 0} onClick={() => void zeroWallet()}>
              صفر کردن موجودی
            </button>
          </div>

          {detail && (
            <>
              <h2 style={{ marginTop: 18, fontSize: "1rem" }}>سرویس‌ها</h2>
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
              <h2 style={{ marginTop: 18, fontSize: "1rem" }}>تراکنش‌های کیف پول</h2>
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
        </Modal>
      )}
    </>
  );
}

/* ---------------- Prices ---------------- */

function PricesTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  const [cells, setCells] = useState<PriceRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<PriceRow>>>({});
  const [catFilter, setCatFilter] = useState("");
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [bulkMode, setBulkMode] = useState<"percent" | "amount">("percent");
  const [bulkValue, setBulkValue] = useState("");
  const [modes, setModes] = useState({ user: "matrix", partner: "matrix", wholesale: "matrix" });
  const [rates, setRates] = useState({
    user: { perGb: 15000, perMonth: 30000, unlimitedPerMonth: 1500000 },
    partner: { perGb: 12000, perMonth: 25000, unlimitedPerMonth: 1200000 },
    wholesale: { perGb: 10000, perMonth: 20000, unlimitedPerMonth: 1000000 },
    categories: {} as Record<
      string,
      {
        user?: { perGb?: number; perMonth?: number };
        partner?: { perGb?: number; perMonth?: number };
        wholesale?: { perGb?: number; perMonth?: number };
      }
    >,
  });
  const [ratesBusy, setRatesBusy] = useState(false);
  const [newCell, setNewCell] = useState({
    category: "data",
    trafficGb: "",
    months: "1",
    priceUser: "",
    pricePartner: "",
    priceWholesale: "",
    title: "",
  });

  const load = useCallback(
    () =>
      api<{
        cells: PriceRow[];
        modes?: typeof modes;
        rates?: typeof rates;
      }>("/admin/prices").then((r) => {
        setCells(r.cells);
        if (r.modes) setModes(r.modes);
        if (r.rates) setRates({ ...r.rates, categories: r.rates.categories ?? {} });
      }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<{ categories: CategoryRow[] }>("/admin/categories")
      .then((r) => {
        if (r.categories?.length) {
          setCategories(r.categories.map((c) => ({ key: c.key, label: c.label })));
        }
      })
      .catch(() => {
        /* keep fallback */
      });
  }, []);

  const shown = catFilter ? cells.filter((c) => c.category === catFilter) : cells;
  const rateCategories = categories.filter((c) => c.key !== "unlimited");

  function catUnit(cat: string, role: "user" | "partner" | "wholesale", field: "perGb" | "perMonth") {
    return Number(rates.categories?.[cat]?.[role]?.[field] ?? rates[role][field] ?? 0);
  }

  function setCatUnit(cat: string, role: "user" | "partner" | "wholesale", field: "perGb" | "perMonth", value: number) {
    setRates((s) => ({
      ...s,
      categories: {
        ...s.categories,
        [cat]: {
          ...(s.categories[cat] ?? {}),
          [role]: {
            ...(s.categories[cat]?.[role] ?? {}),
            [field]: value,
          },
        },
      },
    }));
  }

  async function saveModes(next: typeof modes) {
    setModes(next);
    try {
      await api("/admin/pricing-modes", { method: "PUT", body: next });
      flash("حالت قیمت‌گذاری نقش‌ها ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
      await load();
    }
  }

  async function saveRates() {
    setRatesBusy(true);
    try {
      await api("/admin/price-rates", { method: "PUT", body: rates });
      flash("نرخ‌های گیگ/ماه ذخیره شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setRatesBusy(false);
    }
  }

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

  async function saveAll() {
    const ids = Object.keys(edits);
    if (!ids.length) return;
    try {
      let n = 0;
      for (const id of ids) {
        const c = cells.find((x) => x.id === id);
        const e = edits[id];
        if (!c || !e) continue;
        await api(`/admin/prices/${id}`, {
          method: "PUT",
          body: {
            priceUser: Number(e.priceUser ?? c.priceUser),
            pricePartner: Number(e.pricePartner ?? c.pricePartner),
            priceWholesale: Number(e.priceWholesale ?? c.priceWholesale),
            title: e.title ?? c.title,
          },
        });
        n++;
      }
      setEdits({});
      flash(`${n} پلن ذخیره شد`);
      await load();
    } catch (er) {
      flash(null, errText(er));
    }
  }

  async function deleteRow(c: PriceRow) {
    if (!(await askConfirm(`پلن ${c.trafficGb ?? "∞"}GB / ${c.months} ماه حذف شود؟`))) return;
    try {
      await api(`/admin/prices/${c.id}`, { method: "DELETE" });
      flash("پلن حذف شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function toggleActive(c: PriceRow, active: boolean) {
    try {
      await api(`/admin/prices/${c.id}`, { method: "PUT", body: { active } });
      setCells((list) => list.map((x) => (x.id === c.id ? { ...x, active } : x)));
      flash(active ? "پلن فعال شد" : "پلن غیرفعال شد");
    } catch (e) {
      flash(null, errText(e));
      await load();
    }
  }

  async function addCell() {
    try {
      await api("/admin/prices", {
        body: {
          category: newCell.category,
          trafficGb: newCell.trafficGb === "" ? null : Number(newCell.trafficGb),
          months: Number(newCell.months),
          priceUser: parsePriceInput(newCell.priceUser),
          pricePartner: parsePriceInput(newCell.pricePartner),
          priceWholesale: newCell.priceWholesale ? parsePriceInput(newCell.priceWholesale) : undefined,
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
    if (!(await askConfirm(`قیمت ${catFilter ? "دستهٔ انتخابی" : "همهٔ پلن‌ها"} ${label} یابد؟`))) return;
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
        <h2>حالت قیمت‌گذاری هر نقش</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          ماتریکس = پلن‌های ثابت جدول زیر · نرخی = فرمول (گیگ × قیمت هر گیگ) + (ماه × قیمت هر ماه)
        </p>
        <div className="pricing-mode-grid">
          {(
            [
              ["user", "کاربر عادی"],
              ["partner", "همکار"],
              ["wholesale", "عمده‌فروش"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="field" style={{ margin: 0 }}>
              <label>{label}</label>
              <select
                value={modes[key]}
                onChange={(e) => void saveModes({ ...modes, [key]: e.target.value as "matrix" | "rate" })}
              >
                <option value="matrix">ماتریکس (پلن ثابت)</option>
                <option value="rate">نرخی (گیگ + ماه)</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>قیمت ثابت هر گیگ / هر ماه</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          برای نقش‌هایی که حالت «نرخی» دارند استفاده می‌شود. هر دسته می‌تواند نرخ جدا داشته باشد.
        </p>
        {rateCategories.map((cat) => (
          <div key={cat.key} className="rate-cat-card">
            <strong>{cat.label}</strong>
            <div className="price-plan-fields" style={{ marginTop: 10 }}>
              {(
                [
                  ["user", "کاربر"],
                  ["partner", "همکار"],
                  ["wholesale", "عمده"],
                ] as const
              ).map(([role, roleLabel]) => (
                <div key={role} className="field">
                  <label>{roleLabel} — هر گیگ</label>
                  <input
                    className="num"
                    inputMode="numeric"
                    dir="ltr"
                    value={formatPriceInput(catUnit(cat.key, role, "perGb"))}
                    onChange={(e) => setCatUnit(cat.key, role, "perGb", parsePriceInput(e.target.value))}
                  />
                  <label style={{ marginTop: 8 }}>{roleLabel} — هر ماه</label>
                  <input
                    className="num"
                    inputMode="numeric"
                    dir="ltr"
                    value={formatPriceInput(catUnit(cat.key, role, "perMonth"))}
                    onChange={(e) => setCatUnit(cat.key, role, "perMonth", parsePriceInput(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="rate-cat-card">
          <strong>نامحدود (قیمت هر ماه)</strong>
          <div className="price-plan-fields" style={{ marginTop: 10 }}>
            {(
              [
                ["user", "کاربر"],
                ["partner", "همکار"],
                ["wholesale", "عمده"],
              ] as const
            ).map(([role, roleLabel]) => (
              <div key={role} className="field">
                <label>{roleLabel}</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={formatPriceInput(rates[role].unlimitedPerMonth)}
                  onChange={(e) =>
                    setRates((s) => ({
                      ...s,
                      [role]: { ...s[role], unlimitedPerMonth: parsePriceInput(e.target.value) },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={ratesBusy} onClick={() => void saveRates()}>
            ذخیره نرخ‌ها
          </button>
        </div>
        <p className="hint">
          مثال: ۵۰ گیگ ۲ ماهه با نرخ کاربر دستهٔ فعلی = (۵۰ × هر گیگ) + (۲ × هر ماه)
        </p>
      </div>

      <div className="panel">
        <h2>ویرایش گروهی قیمت‌ها</h2>
        <div className="actions" style={{ marginBottom: 12 }}>
          <button key="all" type="button" className={`chip${catFilter === "" ? " on" : ""}`} onClick={() => setCatFilter("")}>
            همه
          </button>
          {categories.map((c) => (
            <button key={c.key} type="button" className={`chip${catFilter === c.key ? " on" : ""}`} onClick={() => setCatFilter(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="bulk-price-row">
          <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "percent" | "amount")}>
            <option value="percent">درصدی</option>
            <option value="amount">مبلغ ثابت</option>
          </select>
          <input
            className="num"
            inputMode="numeric"
            placeholder={bulkMode === "percent" ? "مثلاً 10 یا -5" : "مثلاً 5000"}
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
          />
          <button type="button" className="btn primary sm" onClick={() => void bulk()}>
            اعمال روی {catFilter ? "این دسته" : "همه"}
          </button>
        </div>
        <p className="hint">مقدار منفی = کاهش قیمت. نتیجه به نزدیک‌ترین ۱٬۰۰۰ تومان گرد می‌شود و روی هر سه ستون قیمت اعمال می‌شود.</p>
      </div>

      <div className="panel">
        <h2>پلن‌ها و قیمت‌ها</h2>
        <div className="price-plan-list">
          {shown.map((c) => {
            const e = edits[c.id] ?? {};
            return (
              <div key={c.id} className={`price-plan-card${c.active === false ? " off" : ""}`}>
                <div className="price-plan-head">
                  <div className="price-plan-title">
                    <strong className="num">
                      {c.trafficGb ?? "∞"}GB · {c.months}ماه
                      {c.isGolden && " ⭐"}
                    </strong>
                    <span className="muted">{catLabel(c.category, categories)}</span>
                  </div>
                  <label className="switch" title="فعال / غیرفعال">
                    <input
                      type="checkbox"
                      checked={c.active !== false}
                      onChange={(ev) => void toggleActive(c, ev.target.checked)}
                    />
                    <span className="track" />
                  </label>
                </div>
                <div className="price-plan-fields">
                  <div className="field">
                    <label>کاربر</label>
                    <input
                      className="num"
                      inputMode="numeric"
                      dir="ltr"
                      value={formatPriceInput(e.priceUser ?? c.priceUser)}
                      onChange={(ev) =>
                        setEdits((m) => ({
                          ...m,
                          [c.id]: { ...m[c.id], priceUser: parsePriceInput(ev.target.value) },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>همکار</label>
                    <input
                      className="num"
                      inputMode="numeric"
                      dir="ltr"
                      value={formatPriceInput(e.pricePartner ?? c.pricePartner)}
                      onChange={(ev) =>
                        setEdits((m) => ({
                          ...m,
                          [c.id]: { ...m[c.id], pricePartner: parsePriceInput(ev.target.value) },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>عمده</label>
                    <input
                      className="num"
                      inputMode="numeric"
                      dir="ltr"
                      value={formatPriceInput(e.priceWholesale ?? c.priceWholesale)}
                      onChange={(ev) =>
                        setEdits((m) => ({
                          ...m,
                          [c.id]: { ...m[c.id], priceWholesale: parsePriceInput(ev.target.value) },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="price-plan-actions">
                  <button type="button" className="btn primary sm" disabled={!edits[c.id]} onClick={() => saveRow(c)}>
                    ذخیره
                  </button>
                  <button type="button" className="btn danger sm" onClick={() => void deleteRow(c)}>
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {!shown.length && <p className="muted">پلنی در این دسته نیست.</p>}
        <div className="save-bar">
          <button type="button" className="btn primary" disabled={!Object.keys(edits).length} onClick={() => void saveAll()}>
            ذخیره همه تغییرات قیمت‌ها ({Object.keys(edits).length})
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>افزودن پلن جدید</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <div className="field">
            <label>دسته</label>
            <select value={newCell.category} onChange={(e) => setNewCell((s) => ({ ...s, category: e.target.value }))}>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
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
            <input
              className="num"
              inputMode="numeric"
              dir="ltr"
              value={formatPriceInput(newCell.priceUser)}
              onChange={(e) => setNewCell((s) => ({ ...s, priceUser: formatPriceInput(parsePriceInput(e.target.value) || "") }))}
            />
          </div>
          <div className="field">
            <label>قیمت همکار</label>
            <input
              className="num"
              inputMode="numeric"
              dir="ltr"
              value={formatPriceInput(newCell.pricePartner)}
              onChange={(e) => setNewCell((s) => ({ ...s, pricePartner: formatPriceInput(parsePriceInput(e.target.value) || "") }))}
            />
          </div>
          <div className="field">
            <label>قیمت عمده</label>
            <input
              className="num"
              inputMode="numeric"
              dir="ltr"
              value={formatPriceInput(newCell.priceWholesale)}
              onChange={(e) => setNewCell((s) => ({ ...s, priceWholesale: formatPriceInput(parsePriceInput(e.target.value) || "") }))}
            />
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

function CategoriesTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");

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
    if (!(await askConfirm(`دستهٔ «${c.label}» حذف شود؟ فروش غیرفعال و ${c.cellCount} پلن آن حذف می‌شود.`))) return;
    try {
      const r = await api<{ deactivated: number }>(`/admin/categories/${c.key}`, { method: "DELETE" });
      flash(`دسته حذف شد (${r.deactivated} پلن غیرفعال شد)`);
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function addCategory() {
    if (!newKey.trim()) {
      flash(null, "کلید دسته را وارد کنید");
      return;
    }
    try {
      await api("/admin/categories", { body: { key: newKey.trim(), label: newLabel.trim() || newKey.trim() } });
      flash("دسته اضافه شد");
      setNewKey("");
      setNewLabel("");
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
                  {c.builtin ? " · پیش‌فرض" : ""}
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
              <button type="button" className="btn danger sm" onClick={() => void remove(c)}>
                حذف دسته
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 18 }}>افزودن دسته</h2>
      <div className="field">
        <label>کلید (انگلیسی، مثلاً vip2)</label>
        <input dir="ltr" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="vip2" />
      </div>
      <div className="field">
        <label>نام نمایشی</label>
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="ویژه ۲" />
      </div>
      <button type="button" className="btn success wide" disabled={!newKey.trim()} onClick={() => void addCategory()}>
        افزودن دسته
      </button>
    </div>
  );
}

/* ---------------- Configs (panel accounts) ---------------- */

function ConfigsTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  const [groups, setGroups] = useState<Array<{ key: string; label: string }>>([]);
  const [groupKey, setGroupKey] = useState("all");
  const [items, setItems] = useState<
    Array<{
      email: string;
      code: string | null;
      subId: string | null;
      status: string | null;
      inDb: boolean;
      ownerLabel: string;
      title?: string | null;
      trafficGb?: number | null;
      usedTrafficBytes?: number;
      expiresAt?: string | null;
      subUrl?: string | null;
    }>
  >([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{
    email: string;
    subId: string | null;
    code: string | null;
    title: string | null;
    note: string | null;
    comment: string | null;
    trafficGb: number | null;
    usedTrafficBytes: number;
    expiresAt: string | null;
    limitIp: number;
    enable: boolean;
  } | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    trafficGb: "",
    expiresAt: "",
    limitIp: "0",
    note: "",
    enable: true,
  });
  const [editBusy, setEditBusy] = useState(false);
  const [sync, setSync] = useState<{
    panelOnly: Array<{
      email: string;
      panelName: string;
      trafficGb: number | null;
      expiresAt: string | null;
      enable: boolean;
    }>;
    botOnly: Array<{ email: string; code: string; subId: string; ownerLabel: string }>;
    matched: number;
    panelTotal: number;
    botTotal: number;
  } | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [selectedImport, setSelectedImport] = useState<Record<string, boolean>>({});
  const [searchInput, setSearchInput] = useState("");
  const [searchQ, setSearchQ] = useState("");

  useEffect(() => {
    void api<{ groups: typeof groups }>("/admin/configs/groups").then((r) => setGroups(r.groups));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQ(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = searchQ.trim() ? `&q=${encodeURIComponent(searchQ.trim())}` : "";
      const r = await api<{ items: typeof items; total: number }>(`/admin/configs/${groupKey}?page=${page}${q}`);
      setItems(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [groupKey, page, searchQ]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runDiff() {
    setSyncBusy(true);
    try {
      const r = await api<NonNullable<typeof sync>>("/admin/configs/sync-diff");
      setSync(r);
      const sel: Record<string, boolean> = {};
      for (const x of r.panelOnly) sel[x.email] = true;
      setSelectedImport(sel);
      flash(`مقایسه شد: ${r.panelOnly.length} فقط پنل · ${r.matched} مشترک · ${r.botOnly.length} فقط ربات`);
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setSyncBusy(false);
    }
  }

  async function runReconcile() {
    if (
      !(await askConfirm(
        "تغییرات پنل (حذف / غیرفعال / حجم / انقضا) روی اکانت‌های ربات اعمال شود؟\nاکانت حذف‌شده از پنل در ربات غیرفعال می‌شود.",
      ))
    ) {
      return;
    }
    setSyncBusy(true);
    try {
      const r = await api<{
        checked: number;
        updated: number;
        disabledFromPanel: number;
        removedFromPanel: number;
        reactivated: number;
        errors: number;
      }>("/admin/configs/reconcile", { method: "POST", body: {} });
      flash(
        `همگام شد: ${r.updated} به‌روز · ${r.disabledFromPanel} غیرفعال · ${r.removedFromPanel} حذف‌شده از پنل · ${r.reactivated} فعال مجدد`,
      );
      await load();
      if (sync) void runDiff();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setSyncBusy(false);
    }
  }

  async function doImport(emails?: string[]) {
    const list = emails ?? Object.keys(selectedImport).filter((e) => selectedImport[e]);
    if (!list.length) {
      flash(null, "اکانتی برای وارد کردن انتخاب نشده");
      return;
    }
    if (
      !(await askConfirm(
        `${list.length} اکانت از پنل وارد دیتابیس ربات شود؟\nمالک همهٔ آن‌ها ادمین خواهد بود.`,
      ))
    ) {
      return;
    }
    setSyncBusy(true);
    try {
      const r = await api<{
        imported: number;
        skipped: number;
        failed: Array<{ email: string; error: string }>;
        ownerLabel: string;
      }>("/admin/configs/import", { body: { emails: list } });
      const failNote = r.failed.length ? ` · ${r.failed.length} ناموفق` : "";
      flash(
        `${r.imported} وارد شد برای ${r.ownerLabel}${r.skipped ? ` · ${r.skipped} رد شد` : ""}${failNote}`,
      );
      await runDiff();
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setSyncBusy(false);
    }
  }

  type ConfigDetailFull = {
    email: string;
    subId: string | null;
    code: string | null;
    title: string | null;
    note: string | null;
    comment: string | null;
    trafficGb: number | null;
    usedTrafficBytes: number;
    expiresAt: string | null;
    limitIp: number;
    enable: boolean;
    status: string | null;
    ownerLabel: string;
    inDb: boolean;
    panelFound: boolean;
  };

  async function startEdit(email: string, subId: string | null) {
    setEditBusy(true);
    try {
      const q = `email=${encodeURIComponent(email)}${subId ? `&subId=${encodeURIComponent(subId)}` : ""}`;
      const d = await api<ConfigDetailFull>(`/admin/configs/detail?${q}`);
      setEditing(d);
      setEditForm({
        title: d.title ?? "",
        trafficGb: d.trafficGb == null ? "" : String(d.trafficGb),
        expiresAt: toLocalInput(d.expiresAt),
        limitIp: String(d.limitIp ?? 0),
        note: d.note ?? "",
        enable: d.enable !== false,
      });
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setEditBusy(false);
    }
  }

  function remainDays(isoDate: string | null | undefined): number | null {
    if (!isoDate) return null;
    const ms = new Date(isoDate).getTime() - Date.now();
    return Math.ceil(ms / 86400000);
  }

  function fmtDate(isoDate: string | null | undefined): string {
    if (!isoDate) return "—";
    try {
      return new Date(isoDate).toLocaleDateString("fa-IR");
    } catch {
      return isoDate;
    }
  }

  function daysLabel(isoDate: string | null | undefined): string {
    const days = remainDays(isoDate);
    if (days == null) return "—";
    if (days < 0) return `${Math.abs(days)} روز گذشته`;
    if (days === 0) return "کمتر از یک روز";
    return `${days} روز`;
  }

  function fmtUsedBytes(bytes: number): string {
    if (bytes <= 0) return "۰";
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    return `${Math.round(bytes / 1024 ** 2)} MB`;
  }

  async function saveEdit() {
    if (!editing) return;
    setEditBusy(true);
    try {
      const r = await api<{ message: string }>("/admin/configs/update", {
        method: "PUT",
        body: {
          email: editing.email,
          subId: editing.subId,
          title: editForm.title || null,
          note: editForm.note || null,
          trafficGb: editForm.trafficGb === "" ? null : Number(editForm.trafficGb),
          expiresAt: fromLocalInput(editForm.expiresAt),
          limitIp: Number(editForm.limitIp) || 0,
          enable: editForm.enable,
        },
      });
      flash(r.message);
      setEditing(null);
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function remove(email: string, subId: string | null) {
    if (!(await askConfirm(`اکانت ${email} از پنل و ربات حذف شود؟`))) return;
    try {
      const r = await api<{ message: string }>("/admin/configs/delete", { body: { email, subId } });
      flash(r.message);
      if (editing?.email === email) setEditing(null);
      await load();
      if (sync) void runDiff();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  const selectedCount = Object.values(selectedImport).filter(Boolean).length;

  return (
    <>
      <div className="panel">
        <h2>همگام‌سازی پنل ↔ ربات</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          اگر در پنل 3x-ui اکانت را حذف، غیرفعال یا ویرایش کردید، با «اعمال تغییرات پنل» وضعیت ربات به‌روز می‌شود. همچنین هر ۱۰ دقیقه خودکار همگام می‌شود.
        </p>
        <div className="sync-actions">
          <button type="button" className="btn primary" disabled={syncBusy} onClick={() => void runDiff()}>
            {syncBusy ? "در حال مقایسه…" : "مقایسه با پنل"}
          </button>
          <button type="button" className="btn success" disabled={syncBusy} onClick={() => void runReconcile()}>
            اعمال تغییرات پنل روی ربات
          </button>
        </div>
        {sync && (
          <div className="actions" style={{ marginBottom: 12 }}>
            {sync.panelOnly.length > 0 && (
              <button type="button" className="btn ghost sm" disabled={syncBusy || !selectedCount} onClick={() => void doImport()}>
                وارد کردن انتخاب‌شده ({selectedCount})
              </button>
            )}
            {sync.panelOnly.length > 0 && (
              <button
                type="button"
                className="btn ghost sm"
                disabled={syncBusy}
                onClick={() => void doImport(sync.panelOnly.map((x) => x.email))}
              >
                وارد کردن همهٔ فقط‌پنل
              </button>
            )}
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setSync(null);
                setSelectedImport({});
              }}
            >
              انصراف
            </button>
          </div>
        )}
        {sync && (
          <div className="grid" style={{ marginBottom: 14 }}>
            <div className="stat accent">
              <div className="label">فقط پنل (قابل ورود)</div>
              <div className="value num">{sync.panelOnly.length}</div>
            </div>
            <div className="stat">
              <div className="label">مشترک</div>
              <div className="value num">{sync.matched}</div>
            </div>
            <div className="stat">
              <div className="label">فقط ربات</div>
              <div className="value num">{sync.botOnly.length}</div>
            </div>
            <div className="stat">
              <div className="label">کل پنل / ربات</div>
              <div className="value num" style={{ fontSize: "1rem" }}>
                {sync.panelTotal} / {sync.botTotal}
              </div>
            </div>
          </div>
        )}
        {sync && sync.panelOnly.length > 0 && (
          <div className="list">
            {sync.panelOnly.map((c) => (
              <div key={c.email} className="row-card" style={{ alignItems: "center" }}>
                <label className="switch" title="انتخاب برای ورود" style={{ marginInlineEnd: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedImport[c.email])}
                    onChange={(e) => setSelectedImport((m) => ({ ...m, [c.email]: e.target.checked }))}
                  />
                  <span className="track" />
                </label>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <strong className="num">{c.email}</strong> <span className="badge warn">فقط پنل</span>
                  <div className="muted">
                    {c.panelName} · {c.trafficGb == null ? "∞ گیگ" : `${c.trafficGb} گیگ`}
                    {c.expiresAt ? ` · ${new Date(c.expiresAt).toLocaleDateString("fa-IR")}` : ""}
                  </div>
                </div>
                <button type="button" className="btn success sm" disabled={syncBusy} onClick={() => void doImport([c.email])}>
                  وارد کردن
                </button>
              </div>
            ))}
          </div>
        )}
        {sync && !sync.panelOnly.length && <p className="muted">همهٔ اکانت‌های پنل در دیتابیس ربات هستند.</p>}
      </div>

      <div className="panel">
        <h2>اکانت‌ها بر اساس گروه پنل</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          اکانت‌های دیتابیس ربات به‌همراه کلاینت‌های زنده‌ی 3x-ui. اگر فقط روی پنل ساخته شده باشند با برچسب «فقط پنل» دیده می‌شوند.
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
        <div className="field" style={{ marginBottom: 12 }}>
          <label>جستجو (ایمیل، کد، مالک)</label>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="مثلاً email یا کد سرویس"
          />
        </div>
        {loading && <p className="muted">در حال دریافت…</p>}
        <div className="list">
          {items.map((c) => {
            const expired = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
            return (
              <div key={c.email} className="row-card" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div>
                  <strong className="num">{c.code || c.email}</strong>{" "}
                  {!c.inDb && <span className="badge warn">فقط پنل</span>}
                  {c.status === "active" && !expired && <span className="badge ok">فعال</span>}
                  {(c.status === "disabled" || expired) && (
                    <span className="badge warn">{expired ? "منقضی" : "غیرفعال"}</span>
                  )}
                  {c.title && <div className="muted">{c.title}</div>}
                  <div className="muted num">{c.email}</div>
                  <div className="muted">{c.ownerLabel}</div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    حجم کل:{" "}
                    <strong className="num">
                      {c.trafficGb == null || c.trafficGb <= 0 ? "نامحدود" : `${c.trafficGb} GB`}
                    </strong>
                    {" · "}
                    مصرف‌شده: <strong className="num">{fmtUsedBytes(c.usedTrafficBytes ?? 0)}</strong>
                    {" · "}
                    انقضا: <strong className="num">{fmtDate(c.expiresAt)}</strong>
                    {" · "}
                    باقی‌مانده:{" "}
                    <strong className={remainDays(c.expiresAt) != null && remainDays(c.expiresAt)! < 0 ? "bad" : undefined}>
                      {daysLabel(c.expiresAt)}
                    </strong>
                  </div>
                  <TrafficProgress usedBytes={c.usedTrafficBytes ?? 0} totalGb={c.trafficGb ?? null} />
                </div>
                <div className="actions" style={{ marginTop: 10 }}>
                  {!c.inDb && (
                    <button type="button" className="btn success sm" disabled={syncBusy} onClick={() => void doImport([c.email])}>
                      وارد کردن
                    </button>
                  )}
                  <button type="button" className="btn primary sm" disabled={editBusy} onClick={() => void startEdit(c.email, c.subId)}>
                    ویرایش
                  </button>
                  <button type="button" className="btn danger sm" onClick={() => void remove(c.email, c.subId)}>
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
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

      {editing && (
        <Modal open title={`ویرایش اکانت — ${editing.code || editing.email}`} onClose={() => setEditing(null)} wide>
          <div className="muted num" style={{ marginBottom: 12 }}>
            {editing.email}
          </div>
          <div className="field">
            <label>نام</label>
            <input value={editForm.title} onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))} />
          </div>
          <div className="field">
            <label>حجم GB (خالی = نامحدود)</label>
            <input
              className="num"
              inputMode="numeric"
              value={editForm.trafficGb}
              onChange={(e) => setEditForm((s) => ({ ...s, trafficGb: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>انقضا</label>
            <input
              type="datetime-local"
              dir="ltr"
              value={editForm.expiresAt}
              onChange={(e) => setEditForm((s) => ({ ...s, expiresAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>لیمیت IP (۰ = نامحدود)</label>
            <input
              className="num"
              inputMode="numeric"
              value={editForm.limitIp}
              onChange={(e) => setEditForm((s) => ({ ...s, limitIp: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>نوت</label>
            <input value={editForm.note} onChange={(e) => setEditForm((s) => ({ ...s, note: e.target.value }))} />
          </div>
          <div className="setting-row" style={{ marginBottom: 12 }}>
            <div className="t">فعال</div>
            <label className="switch">
              <input
                type="checkbox"
                checked={editForm.enable}
                onChange={(e) => setEditForm((s) => ({ ...s, enable: e.target.checked }))}
              />
              <span className="track" />
            </label>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" disabled={editBusy} onClick={() => void saveEdit()}>
              ذخیره تغییرات
            </button>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              لغو
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Panels ---------------- */

function PanelsTab({ flash }: { flash: Flash }) {
  const [panels, setPanels] = useState<PanelRow[]>([]);
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [form, setForm] = useState({ name: "", baseUrl: "", apiToken: "", inboundIds: "1" });
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routeAllPanelId, setRouteAllPanelId] = useState("");
  const [dedicatedCategory, setDedicatedCategory] = useState("national");
  const [dedicatedPanelId, setDedicatedPanelId] = useState("");
  const [editing, setEditing] = useState<PanelRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    baseUrl: "",
    apiToken: "",
    inboundIds: "1",
    subBase: "",
    weight: "100",
    categories: ["data", "unlimited"] as string[],
    active: true,
    sellEnabled: true,
  });

  const load = useCallback(() => api<{ panels: PanelRow[] }>("/admin/panels").then((r) => setPanels(r.panels)), []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!routeAllPanelId && panels[0]?.id) setRouteAllPanelId(panels[0].id);
    if (!dedicatedPanelId && panels[0]?.id) setDedicatedPanelId(panels[0].id);
  }, [panels, routeAllPanelId, dedicatedPanelId]);

  useEffect(() => {
    void api<{ categories: CategoryRow[] }>("/admin/categories")
      .then((r) => {
        if (r.categories?.length) {
          setCategories(r.categories.map((c) => ({ key: c.key, label: c.label })));
        }
      })
      .catch(() => {
        /* keep fallback */
      });
  }, []);

  function openEdit(p: PanelRow) {
    setEditing(p);
    setEditForm({
      name: p.name,
      baseUrl: p.baseUrl,
      apiToken: "",
      inboundIds: p.inboundIds || "1",
      subBase: p.subBase ?? "",
      weight: String(p.weight ?? 100),
      categories: parseCats(p.categories),
      active: p.active,
      sellEnabled: p.sellEnabled,
    });
  }

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
      if (editing?.id === p.id) {
        setEditing((e) => (e ? { ...e, [key]: value } : e));
        setEditForm((s) => ({ ...s, [key]: value }));
      }
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const body: Record<string, unknown> = {
        name: editForm.name,
        baseUrl: editForm.baseUrl,
        inboundIds: editForm.inboundIds || "1",
        subBase: editForm.subBase.trim() || null,
        weight: Number(editForm.weight) || 100,
        categories: editForm.categories,
        active: editForm.active,
        sellEnabled: editForm.sellEnabled,
      };
      if (editForm.apiToken.trim()) body.apiToken = editForm.apiToken.trim();
      await api(`/admin/panels/${editing.id}`, { method: "PUT", body });
      flash("پنل ذخیره شد");
      setEditing(null);
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
      setShowAddPanel(false);
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  function toggleCat(key: string) {
    setEditForm((s) => {
      const set = new Set(s.categories);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...s, categories: [...set] };
    });
  }

  async function applyAllCategoriesToPanel() {
    if (!routeAllPanelId) return;
    setRoutingBusy(true);
    try {
      const allCats = categories.map((c) => c.key);
      for (const p of panels) {
        await api(`/admin/panels/${p.id}`, {
          method: "PUT",
          body: { categories: p.id === routeAllPanelId ? allCats : [] },
        });
      }
      flash("همه دسته‌ها روی سرور انتخاب‌شده قرار گرفت");
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setRoutingBusy(false);
    }
  }

  async function dedicateCategoryToPanel() {
    if (!dedicatedPanelId || !dedicatedCategory) return;
    setRoutingBusy(true);
    try {
      for (const p of panels) {
        const next = new Set(parseCats(p.categories));
        if (p.id === dedicatedPanelId) next.add(dedicatedCategory);
        else next.delete(dedicatedCategory);
        await api(`/admin/panels/${p.id}`, {
          method: "PUT",
          body: { categories: [...next] },
        });
      }
      const catName = categories.find((c) => c.key === dedicatedCategory)?.label || dedicatedCategory;
      flash(`دسته «${catName}» فقط روی سرور انتخاب‌شده قرار گرفت`);
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setRoutingBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>سرورهای پنل</h2>
          <button type="button" className="btn success sm" onClick={() => setShowAddPanel(true)}>
            افزودن پنل جدید
          </button>
        </div>
        {!!panels.length && (
          <div className="panel-routing">
            <div className="panel-routing-card">
              <div className="panel-routing-title">همه دسته‌ها روی یک سرور</div>
              <p className="panel-routing-desc">
                همه دسته‌های فروش فقط روی سرور انتخابی فعال می‌شوند و از بقیه سرورها برداشته می‌شوند.
              </p>
              <div className="field">
                <label>سرور مقصد</label>
                <select value={routeAllPanelId} onChange={(e) => setRouteAllPanelId(e.target.value)}>
                  {panels.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn primary wide"
                disabled={routingBusy || !routeAllPanelId}
                onClick={() => void applyAllCategoriesToPanel()}
              >
                همه دسته‌ها را روی این سرور بگذار
              </button>
            </div>

            <div className="panel-routing-card">
              <div className="panel-routing-title">یک دسته فقط روی یک سرور</div>
              <p className="panel-routing-desc">
                دسته انتخابی فقط روی سرور مشخص فعال می‌شود و از سرورهای دیگر حذف می‌گردد. بقیه دسته‌ها دست‌نخورده می‌مانند.
              </p>
              <div className="panel-routing-fields">
                <div className="field">
                  <label>دسته</label>
                  <select value={dedicatedCategory} onChange={(e) => setDedicatedCategory(e.target.value)}>
                    {categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>سرور آن دسته</label>
                  <select value={dedicatedPanelId} onChange={(e) => setDedicatedPanelId(e.target.value)}>
                    {panels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="btn success wide"
                disabled={routingBusy || !dedicatedPanelId}
                onClick={() => void dedicateCategoryToPanel()}
              >
                این دسته را فقط به این سرور اختصاص بده
              </button>
            </div>

            <p className="hint" style={{ margin: 0 }}>
              وزن فقط بین سرورهایی اعمال می‌شود که همان دسته را دارند. مثلاً «نت ملی» را فقط روی یک سرور بگذارید و بقیه
              دسته‌ها را بین چند سرور لودبالانس کنید.
            </p>
          </div>
        )}
        <div className="list" style={{ marginTop: 12 }}>
          {panels.map((p) => {
            const cats = parseCats(p.categories);
            // routing badge: for each category on this panel, how many other panels share it?
            const catBadges = cats.map((k) => {
              const siblings = panels.filter((x) => x.id !== p.id && parseCats(x.categories).includes(k) && x.active && x.sellEnabled);
              return { key: k, label: catLabel(k, categories), shared: siblings.length > 0 };
            });
            return (
            <div key={p.id} className="row-card" style={{ cursor: "pointer" }} onClick={() => openEdit(p)}>
              <div>
                <strong>{p.name}</strong>
                <div className="muted num">{p.baseUrl}</div>
                <div className="muted">
                  اینباند: <span className="num">{p.inboundIds}</span> · توکن {p.hasToken ? "✓" : "✗"}
                  {p.weight != null && (
                    <>
                      {" "}
                      · وزن <span className="num">{p.weight}</span>
                    </>
                  )}
                </div>
                {cats.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                    {catBadges.map(({ key, label, shared }) => (
                      <span
                        key={key}
                        className={`badge ${shared ? "info" : "ok"}`}
                        title={shared ? "لودبالانس — این دسته روی چند سرور است" : "اختصاصی — فقط این سرور"}
                      >
                        {label} {shared ? "⇄" : "⊕"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="badge bad" style={{ marginTop: 5, display: "inline-block" }}>بدون دسته</span>
                )}
              </div>
              <div className="actions" style={{ alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                <label className="switch" title="فعال">
                  <input type="checkbox" checked={p.active} onChange={(e) => toggle(p, "active", e.target.checked)} />
                  <span className="track" />
                </label>
                <label className="switch" title="فروش">
                  <input
                    type="checkbox"
                    checked={p.sellEnabled}
                    onChange={(e) => toggle(p, "sellEnabled", e.target.checked)}
                  />
                  <span className="track" />
                </label>
                <button type="button" className="btn ghost sm" onClick={() => openEdit(p)}>
                  ویرایش
                </button>
                <button type="button" className="btn ghost sm" onClick={() => test(p.id)}>
                  تست اتصال
                </button>
              </div>
            </div>
            );
          })}
          {!panels.length && <p className="muted">پنلی ثبت نشده — از .env استفاده می‌شود.</p>}
        </div>
      </div>

      {editing && (
        <Modal open title={`ویرایش پنل — ${editing.name}`} onClose={() => setEditing(null)} wide>
          <div className="field">
            <label>نام</label>
            <input value={editForm.name} onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))} />
          </div>
          <div className="field">
            <label>آدرس</label>
            <input dir="ltr" value={editForm.baseUrl} onChange={(e) => setEditForm((s) => ({ ...s, baseUrl: e.target.value }))} />
          </div>
          <div className="field">
            <label>توکن API</label>
            <input
              dir="ltr"
              value={editForm.apiToken}
              onChange={(e) => setEditForm((s) => ({ ...s, apiToken: e.target.value }))}
              placeholder="خالی = بدون تغییر"
            />
          </div>
          <div className="field">
            <label>شناسه اینباندها</label>
            <input
              dir="ltr"
              className="num"
              value={editForm.inboundIds}
              onChange={(e) => setEditForm((s) => ({ ...s, inboundIds: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Sub base</label>
            <input dir="ltr" value={editForm.subBase} onChange={(e) => setEditForm((s) => ({ ...s, subBase: e.target.value }))} />
          </div>
          <div className="field">
            <label>وزن</label>
            <input
              className="num"
              inputMode="numeric"
              value={editForm.weight}
              onChange={(e) => setEditForm((s) => ({ ...s, weight: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>دسته‌ها</label>
            <div className="actions">
              {categories.map((c) => (
                <label key={c.key} className="chip" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={editForm.categories.includes(c.key)}
                    onChange={() => toggleCat(c.key)}
                    style={{ marginLeft: 6 }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div className="t">فعال</div>
            <label className="switch">
              <input
                type="checkbox"
                checked={editForm.active}
                onChange={(e) => setEditForm((s) => ({ ...s, active: e.target.checked }))}
              />
              <span className="track" />
            </label>
          </div>
          <div className="setting-row">
            <div className="t">فروش فعال</div>
            <label className="switch">
              <input
                type="checkbox"
                checked={editForm.sellEnabled}
                onChange={(e) => setEditForm((s) => ({ ...s, sellEnabled: e.target.checked }))}
              />
              <span className="track" />
            </label>
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={!editForm.name || !editForm.baseUrl} onClick={() => void saveEdit()}>
              ذخیره پنل
            </button>
            <button type="button" className="btn ghost" onClick={() => test(editing.id)}>
              تست اتصال
            </button>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              لغو
            </button>
          </div>
        </Modal>
      )}

      {showAddPanel && (
        <Modal open title="افزودن پنل جدید" onClose={() => setShowAddPanel(false)} wide>
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
          <div className="actions">
            <button type="button" className="btn success" disabled={!form.name || !form.baseUrl || !form.apiToken} onClick={() => void add()}>
              افزودن پنل
            </button>
            <button type="button" className="btn ghost" onClick={() => setShowAddPanel(false)}>
              لغو
            </button>
          </div>
        </Modal>
      )}
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
];

const GUIDE_PLATFORMS = [
  { id: "android", label: "اندروید", textKey: "guide_android_text", urlKey: "guide_android_url" },
  { id: "ios", label: " آیفون", textKey: "guide_ios_text", urlKey: "guide_ios_url" },
  { id: "windows", label: "ویندوز", textKey: "guide_windows_text", urlKey: "guide_windows_url" },
  { id: "macos", label: " مک", textKey: "guide_macos_text", urlKey: "guide_macos_url" },
] as const;

function SettingsTab({
  flash,
  hasPassword,
  onPasswordSaved,
}: {
  flash: Flash;
  hasPassword: boolean;
  onPasswordSaved: () => void;
}) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [guideEdit, setGuideEdit] = useState<(typeof GUIDE_PLATFORMS)[number] | null>(null);
  const [guideDraft, setGuideDraft] = useState({ text: "", url: "" });
  const [channels, setChannels] = useState<Array<{ username: string; required: boolean }>>([]);
  const [forceMembership, setForceMembership] = useState(false);
  const [newChannel, setNewChannel] = useState("");
  const [channelBusy, setChannelBusy] = useState(false);
  const [backup, setBackup] = useState<{
    enabled: boolean;
    hour: number;
    minute: number;
    lastAt: string;
    lastStatus: string;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  useEffect(() => {
    void api<{ settings: Record<string, string> }>("/admin/settings").then((r) => {
      setSettings(r.settings);
      setLoaded(true);
    });
    void api<{ channels: Array<{ username: string; required: boolean }>; forceMembership: boolean }>("/admin/channels").then(
      (r) => {
        setChannels(r.channels ?? []);
        setForceMembership(Boolean(r.forceMembership));
      },
    );
    void api<{
      config: { enabled: boolean; hour: number; minute: number; lastAt: string; lastStatus: string };
    }>("/admin/backup").then((r) => setBackup(r.config));
  }, []);

  function openGuideEdit(platform: (typeof GUIDE_PLATFORMS)[number]) {
    setGuideEdit(platform);
    setGuideDraft({
      text: settings[platform.textKey] ?? "",
      url: settings[platform.urlKey] ?? "",
    });
  }

  async function saveGuideEdit() {
    if (!guideEdit) return;
    await save({ [guideEdit.textKey]: guideDraft.text, [guideEdit.urlKey]: guideDraft.url });
    setGuideEdit(null);
  }

  async function save(patch: Record<string, string>) {
    try {
      await api("/admin/settings", { method: "PUT", body: patch });
      setSettings((s) => ({ ...s, ...patch }));
      flash("تنظیمات ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function persistChannels(
    next: Array<{ username: string; required: boolean }>,
    force?: boolean,
  ) {
    setChannelBusy(true);
    try {
      const r = await api<{
        channels: Array<{ username: string; required: boolean }>;
        forceMembership: boolean;
      }>("/admin/channels", {
        method: "PUT",
        body: {
          channels: next,
          ...(typeof force === "boolean" ? { forceMembership: force } : {}),
        },
      });
      setChannels(r.channels ?? []);
      setForceMembership(Boolean(r.forceMembership));
      flash("تنظیمات کانال ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setChannelBusy(false);
    }
  }

  async function addChannel() {
    const username = newChannel.replace(/^@/, "").trim();
    if (!username) {
      flash(null, "یوزرنیم کانال را وارد کنید");
      return;
    }
    if (channels.some((c) => c.username.toLowerCase() === username.toLowerCase())) {
      flash(null, "این کانال قبلاً اضافه شده");
      return;
    }
    setNewChannel("");
    await persistChannels([...channels, { username, required: forceMembership || channels.length === 0 }]);
  }

  async function saveBackup(patch: Partial<{ enabled: boolean; hour: number; minute: number }>) {
    if (!backup) return;
    setBackupBusy(true);
    try {
      const r = await api<{ config: typeof backup }>("/admin/backup", {
        method: "PUT",
        body: { ...backup, ...patch },
      });
      setBackup(r.config);
      flash("تنظیمات پشتیبان ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBackupBusy(false);
    }
  }

  async function sendBackupNow() {
    setBackupBusy(true);
    try {
      const r = await api<{ ok: boolean; name: string; sent: number; error?: string }>("/admin/backup/send", {
        method: "POST",
        body: {},
      });
      if (r.ok) {
        flash(`پشتیبان برای ${r.sent} ادمین ارسال شد`);
        const refreshed = await api<{ config: NonNullable<typeof backup> }>("/admin/backup");
        setBackup(refreshed.config);
      } else {
        flash(null, r.error || "ارسال پشتیبان ناموفق بود");
      }
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBackupBusy(false);
    }
  }

  if (!loaded) return <p className="muted">در حال دریافت تنظیمات…</p>;

  const multiMonth = Number(settings.max_purchase_months || "1") > 1;

  return (
    <>
      <PasswordSettings hasPassword={hasPassword} onFlash={flash} onSaved={onPasswordSaved} />

      <div className="panel">
        <h2>کانال‌های ربات</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          کانال‌هایی که کاربر قبل از استفاده از ربات باید عضو شود. عضویت اجباری را می‌توانید کلی یا برای هر کانال جداگانه تنظیم کنید.
        </p>
        <div className="setting-row">
          <div>
            <div className="t">عضویت اجباری</div>
            <div className="d">اگر روشن باشد، کاربر تا عضویت در کانال‌های اجباری وارد منوی اصلی نمی‌شود.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={forceMembership}
              disabled={channelBusy}
              onChange={(e) => void persistChannels(channels, e.target.checked)}
            />
            <span className="track" />
          </label>
        </div>
        <div className="list" style={{ marginTop: 8 }}>
          {channels.map((ch, idx) => (
            <div key={`${ch.username}-${idx}`} className="row-card" style={{ alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong className="num" dir="ltr">
                  @{ch.username}
                </strong>
                <div className="muted">{ch.required ? "عضویت اجباری" : "اختیاری"}</div>
              </div>
              <div className="actions" style={{ alignItems: "center" }}>
                <label className="switch" title="اجباری / اختیاری">
                  <input
                    type="checkbox"
                    checked={ch.required}
                    disabled={channelBusy}
                    onChange={(e) => {
                      const next = channels.map((c, i) => (i === idx ? { ...c, required: e.target.checked } : c));
                      void persistChannels(next);
                    }}
                  />
                  <span className="track" />
                </label>
                <button
                  type="button"
                  className="btn danger sm"
                  disabled={channelBusy}
                  onClick={() => void persistChannels(channels.filter((_, i) => i !== idx))}
                >
                  حذف
                </button>
              </div>
            </div>
          ))}
          {!channels.length && <p className="muted">هنوز کانالی ثبت نشده است.</p>}
        </div>
        <div className="bulk-price-row" style={{ marginTop: 12 }}>
          <input
            dir="ltr"
            placeholder="@channel یا channel"
            value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addChannel();
              }
            }}
          />
          <button type="button" className="btn success sm" disabled={channelBusy || !newChannel.trim()} onClick={() => void addChannel()}>
            افزودن کانال
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>پشتیبان دیتابیس</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          فایل SQLite برای همه ادمین‌های تلگرام ارسال می‌شود. زمان‌بندی بر اساس ساعت محلی سرور است.
        </p>
        {backup && (
          <>
            <div className="setting-row">
              <div>
                <div className="t">پشتیبان خودکار روزانه</div>
                <div className="d">
                  آخرین ارسال:{" "}
                  {backup.lastAt ? new Date(backup.lastAt).toLocaleString("fa-IR") : "هنوز انجام نشده"}
                  {backup.lastStatus ? ` · ${backup.lastStatus}` : ""}
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={backup.enabled}
                  disabled={backupBusy}
                  onChange={(e) => void saveBackup({ enabled: e.target.checked })}
                />
                <span className="track" />
              </label>
            </div>
            <div className="bulk-price-row" style={{ marginTop: 4 }}>
              <div className="field" style={{ margin: 0, flex: "1 1 120px" }}>
                <label>ساعت</label>
                <select
                  value={String(backup.hour)}
                  disabled={backupBusy}
                  onChange={(e) => void saveBackup({ hour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0, flex: "1 1 120px" }}>
                <label>دقیقه</label>
                <select
                  value={String(backup.minute)}
                  disabled={backupBusy}
                  onChange={(e) => void saveBackup({ minute: Number(e.target.value) })}
                >
                  {Array.from({ length: 60 }, (_, m) => (
                    <option key={m} value={String(m)}>
                      {String(m).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="hint">
              ارسال خودکار هر روز ساعت{" "}
              <strong className="num">
                {String(backup.hour).padStart(2, "0")}:{String(backup.minute).padStart(2, "0")}
              </strong>{" "}
              (زمان سرور)
            </p>
            <button type="button" className="btn primary wide" disabled={backupBusy} onClick={() => void sendBackupNow()}>
              {backupBusy ? "در حال ارسال…" : "ارسال الان به تلگرام"}
            </button>
          </>
        )}
        {!backup && <p className="muted">در حال دریافت تنظیمات پشتیبان…</p>}
      </div>

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
            <div className="t">مدت اعتبار نشست داشبورد</div>
            <div className="d">بعد از ورود، کاربر چند ساعت لاگین بماند (روی ورودهای جدید اثر می‌گذارد).</div>
          </div>
          <select
            value={String(Number(settings.web_session_hours || "168"))}
            onChange={(e) => save({ web_session_hours: e.target.value })}
            style={{
              border: "1px solid var(--line)",
              background: "rgba(10,13,35,.6)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "8px 12px",
            }}
          >
            {[1, 3, 6, 12, 24, 48, 72, 168, 336, 720].map((h) => (
              <option key={h} value={String(h)}>
                {h < 24 ? `${h} ساعت` : `${h / 24} روز (${h} ساعت)`}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">حالت قیمت‌گذاری</div>
            <div className="d">برای هر نقش جداگانه در تب «قیمت‌ها» تنظیم کنید (ماتریکس یا نرخی).</div>
          </div>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            تب قیمت‌ها
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>آموزش اتصال</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          برای هر سیستم‌عامل متن راهنما و لینک دانلود اپ را جداگانه تنظیم کنید.
        </p>
        <div className="guide-platform-grid">
          {GUIDE_PLATFORMS.map((p) => (
            <button key={p.id} type="button" className="btn ghost guide-platform-btn" onClick={() => openGuideEdit(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {guideEdit && (
        <Modal
          open
          title={`آموزش اتصال — ${guideEdit.label}`}
          onClose={() => setGuideEdit(null)}
          wide
        >
          <div className="field">
            <label>متن آموزش</label>
            <textarea
              rows={8}
              value={guideDraft.text}
              onChange={(e) => setGuideDraft((s) => ({ ...s, text: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>لینک دانلود اپ</label>
            <input
              dir="ltr"
              value={guideDraft.url}
              onChange={(e) => setGuideDraft((s) => ({ ...s, url: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => void saveGuideEdit()}>
              ذخیره
            </button>
            <button type="button" className="btn ghost" onClick={() => setGuideEdit(null)}>
              لغو
            </button>
          </div>
        </Modal>
      )}

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
        <div className="save-bar">
          <button
            type="button"
            className="btn primary"
            onClick={() => save(Object.fromEntries(TEXT_SETTINGS.map((f) => [f.key, settings[f.key] ?? ""])))}
          >
            ذخیره اطلاعات پایه
          </button>
        </div>
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
