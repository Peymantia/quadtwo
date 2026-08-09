"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DashShell, LoadingScreen, Icon, type ShellTab } from "../../components/DashShell";
import { Modal } from "../../components/Modal";
import { ConfirmToast, Toast } from "../../components/Toast";
import { PasswordSettings } from "../../components/PasswordSettings";
import { TrafficProgress } from "../../components/PaymentCard";
import { api, apiBase, formatToman, getDemoRole, getToken } from "../../lib/api";
import { useDashAuth } from "../../lib/useDashAuth";
import { RateShop, type RateOrderPayload, type RateShopCatalog } from "../../components/RateShop";
import { type ListSort } from "../../components/SortSelect";
import { RenewModal, type RenewInfo } from "../../components/RenewModal";
import { AccountCreatedModal, type CreatedAccount } from "../../components/AccountCreatedModal";
import { SubQrModal } from "../../components/SubQrModal";
import { DiscountCodesPanel } from "../../components/DiscountCodesPanel";
import { AgentsLeaderboardPanel, SalesReportPanel, AccountDetailModal } from "../../components/SalesReportPanel";
import { SettingsAccordion } from "../../components/SettingsAccordion";
import { SuperadminTenantsPanel } from "../../components/SuperadminTenantsPanel";
import { broadcastAppearance } from "../../components/ThemeBoot";
import { parseColorMode, parseUiSkin, setUserColorOverride, type ColorMode } from "../../lib/theme";

const CONFIG_PAGE_SIZES = [10, 20, 30, 50, 100] as const;
const TABS: ShellTab[] = [
  { key: "home", label: "داشبورد", icon: "home", pin: true, pinOrder: 3, bubble: true },
  { key: "create", label: "ساخت اکانت", shortLabel: "فروش", icon: "shop", pin: true, pinOrder: 1 },
  { key: "configs", label: "اکانت‌ها", icon: "wifi", pin: true, pinOrder: 2 },
  { key: "orders", label: "سفارش‌ها", icon: "orders", pin: true, pinOrder: 4 },
  { key: "prices", label: "قیمت‌ها", icon: "tag" },
  { key: "discounts", label: "کد تخفیف", icon: "tag" },
  { key: "users", label: "کاربران", icon: "users", pin: true, pinOrder: 5 },
  { key: "categories", label: "دسته‌ها", icon: "layers" },
  { key: "panels", label: "سرورها", icon: "server", gapAfter: true },
  { key: "sync", label: "همگام‌سازی", icon: "sync" },
  { key: "reports", label: "گزارشات", icon: "chart" },
  { key: "import", label: "اکسل", icon: "file" },
  { key: "settings", label: "تنظیمات", icon: "gear", gapAfter: true },
  { key: "super", label: "مستأجرها", icon: "layers" },
];

type PendingOrder = {
  id: string;
  kind: string;
  status: string;
  price: number;
  paymentMethod?: string;
  summary: string;
  receiptText: string | null;
  hasReceiptImage?: boolean;
  createdAt: string;
  provisionError?: string | null;
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
  discountCodesAllowed?: boolean;
  discountMaxPercent?: number;
  priceOverride?: {
    category: string;
    perGb: number | null;
    perMonth: number | null;
    unlimitedPerMonth: number | null;
    partnerPricePercent: number;
    note: string | null;
  } | null;
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
  priceReseller?: number;
  limitIp?: number;
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

/** Quick expiry from now → datetime-local value. */
function expiryFromNow(opts: { weeks?: number; months?: number }): string {
  const d = new Date();
  if (opts.weeks) d.setDate(d.getDate() + opts.weeks * 7);
  if (opts.months) d.setMonth(d.getMonth() + opts.months);
  return toLocalInput(d.toISOString());
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
  reseller: "همکار ویژه",
  wholesale: "عمده‌فروش",
  admin: "ادمین",
};

export default function AdminPage() {
  const { home, loading, reload } = useDashAuth(["admin"]);
  const [tab, setTab] = useState("home");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);

  useEffect(() => {
    if (tab === "bulk") setTab("configs");
  }, [tab]);

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
  const isSuper = Boolean(home.user.isSuperAdmin);
  const tabs = isSuper ? TABS : TABS.filter((t) => t.key !== "super");

  return (
    <DashShell
      brand={home.brand}
      logoUrl={home.logoUrl}
      title="کنترل سنتر"
      role={home.user.role}
      userLabel={userLabel}
      tabs={tabs}
      active={tab}
      demoMode={Boolean(home.demoMode)}
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
      {tab === "create" && <AdminCreateTab flash={flash} />}
      {tab === "orders" && <OrdersTab flash={flash} />}
      {tab === "users" && <UsersTab flash={flash} askConfirm={askConfirm} />}
      {tab === "prices" && <PricesTab flash={flash} askConfirm={askConfirm} />}
      {tab === "discounts" && (
        <DiscountCodesPanel flash={flash} askConfirm={askConfirm} showOwner />
      )}
      {tab === "categories" && <CategoriesTab flash={flash} askConfirm={askConfirm} />}
      {tab === "configs" && <ConfigsTab flash={flash} askConfirm={askConfirm} />}
      {tab === "sync" && <SyncTab flash={flash} askConfirm={askConfirm} />}
      {tab === "panels" && <PanelsTab flash={flash} askConfirm={askConfirm} />}
      {tab === "settings" && (
        <SettingsTab
          flash={flash}
          askConfirm={askConfirm}
          hasPassword={Boolean(home.user.hasPassword)}
          onPasswordSaved={() => void reload()}
        />
      )}
      {tab === "reports" && <ReportsTab />}
      {tab === "import" && <ImportTab flash={flash} />}
      {tab === "super" && isSuper && <SuperadminTenantsPanel flash={flash} />}
    </DashShell>
  );
}

type Flash = (ok: string | null, bad?: string | null) => void;
type AskConfirm = (message: string) => Promise<boolean>;

function errText(e: unknown) {
  return String(e instanceof Error ? e.message : e);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------------- Home ---------------- */

function HomeTab({ onGo }: { onGo: (t: string) => void }) {
  const [stats, setStats] = useState<{
    pendingOrders: number;
    users: number;
    activeSubs: number;
    salesToday: { label: string; count: number; total?: number };
  } | null>(null);

  useEffect(() => {
    void api<NonNullable<typeof stats>>("/admin/home").then(setStats);
  }, []);

  const salesTodayNum =
    stats?.salesToday.total != null
      ? stats.salesToday.total.toLocaleString("fa-IR")
      : (stats?.salesToday.label ?? "—").replace(/\s*تومان\s*$/u, "").trim() || "—";

  return (
    <>
      <div className="grid stats-row-4">
        <div className="stat accent">
          <div className="label">فروش امروز (تومان)</div>
          <div className="value num">{salesTodayNum}</div>
        </div>
        <button type="button" className="stat stat-link" onClick={() => onGo("orders")}>
          <div className="label">سفارش در انتظار</div>
          <div className="value num">{stats?.pendingOrders ?? "—"}</div>
        </button>
        <button type="button" className="stat stat-link" onClick={() => onGo("users")}>
          <div className="label">کاربران</div>
          <div className="value num">{stats?.users ?? "—"}</div>
        </button>
        <button type="button" className="stat stat-link" onClick={() => onGo("configs")}>
          <div className="label">سرویس فعال</div>
          <div className="value num">{stats?.activeSubs ?? "—"}</div>
        </button>
      </div>
      <div className="panel">
        <h2>دسترسی سریع</h2>
        <div className="quick-actions">
          <button type="button" className="btn success wide quick-action-btn" onClick={() => onGo("create")}>
            <Icon name="shop" size={18} />
            ساخت اکانت
          </button>
          <button type="button" className="btn primary wide quick-action-btn" onClick={() => onGo("orders")}>
            <Icon name="orders" size={18} />
            بررسی سفارش‌ها
          </button>
          <button type="button" className="btn light wide quick-action-btn" onClick={() => onGo("users")}>
            <Icon name="users" size={18} />
            مدیریت کاربران
          </button>
          <button type="button" className="btn ghost wide quick-action-btn" onClick={() => onGo("prices")}>
            <Icon name="tag" size={18} />
            قیمت‌گذاری
          </button>
          <button type="button" className="btn ghost wide quick-action-btn" onClick={() => onGo("settings")}>
            <Icon name="gear" size={18} />
            تنظیمات
          </button>
        </div>
        <div className="quick-actions-more">
          <button type="button" className="btn ghost sm quick-action-btn" data-qa="categories" onClick={() => onGo("categories")}>
            <Icon name="layers" size={15} />
            دسته‌ها
          </button>
          <button type="button" className="btn ghost sm quick-action-btn" data-qa="panels" onClick={() => onGo("panels")}>
            <Icon name="server" size={15} />
            سرورها
          </button>
          <button type="button" className="btn ghost sm quick-action-btn" data-qa="discounts" onClick={() => onGo("discounts")}>
            <Icon name="tag" size={15} />
            کد تخفیف
          </button>
          <button type="button" className="btn ghost sm quick-action-btn" data-qa="reports" onClick={() => onGo("reports")}>
            <Icon name="chart" size={15} />
            گزارشات
          </button>
          <button type="button" className="btn ghost sm quick-action-btn" data-qa="sync" onClick={() => onGo("sync")}>
            <Icon name="sync" size={15} />
            همگام‌سازی
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Create account (admin complimentary) ---------------- */

function AdminCreateTab({ flash }: { flash: Flash }) {
  type Cell = {
    id: string;
    trafficGb: number | null;
    months: number;
    title: string | null;
    price: number;
    category: string;
    isGolden?: boolean;
  };
  const [cells, setCells] = useState<Cell[]>([]);
  const [catLabels, setCatLabels] = useState<Record<string, string>>({});
  const [rateCatalog, setRateCatalog] = useState<RateShopCatalog | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [accountName, setAccountName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [matrixConfirmOpen, setMatrixConfirmOpen] = useState(false);

  useEffect(() => {
    void api<{
      cells: Cell[];
      categoryLabels: Record<string, string>;
      categories?: string[];
      maxMonths?: number;
      pricingMode?: "matrix" | "rate";
      defaultLimitIp?: number;
      canEditLimitIp?: boolean;
      discountsEnabled?: boolean;
      volumeRules?: RateShopCatalog["volumeRules"];
    }>("/me/catalog").then((r) => {
      setCells(r.cells ?? []);
      setCatLabels(r.categoryLabels ?? {});
      setRateCatalog({
        categories: r.categories ?? [],
        categoryLabels: r.categoryLabels ?? {},
        maxMonths: r.maxMonths ?? 1,
        pricingMode: r.pricingMode === "rate" ? "rate" : "matrix",
        defaultLimitIp: r.defaultLimitIp,
        canEditLimitIp: true,
        discountsEnabled: Boolean(r.discountsEnabled),
        volumeRules: r.volumeRules,
        cells: r.cells,
      });
    });
  }, []);

  async function create() {
    if (!selected) return;
    setMatrixConfirmOpen(false);
    setBusy(true);
    setCreated(null);
    try {
      const r = await api<{
        provisioned?: CreatedAccount;
        error?: string;
      }>("/partner/create", {
        body: {
          trafficGb: selected.trafficGb,
          months: selected.months,
          category: selected.category,
          accountName: accountName.trim() || undefined,
          payWithWallet: true,
        },
      });
      if (r.provisioned?.code) {
        setCreated({
          ...r.provisioned,
          categoryLabel: catLabels[selected.category] || selected.category,
          months: selected.months,
          trafficGb: r.provisioned.trafficGb ?? selected.trafficGb,
        });
        setAccountName("");
      } else {
        flash(null, "ساخت اکانت انجام نشد");
      }
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function createRate(payload: RateOrderPayload) {
    setBusy(true);
    setCreated(null);
    try {
      const r = await api<{
        provisioned?: CreatedAccount;
        error?: string;
      }>("/partner/create", {
        body: {
          trafficGb: payload.trafficGb,
          months: payload.months,
          category: payload.category,
          accountName: payload.accountName,
          limitIp: payload.limitIp,
          note: payload.note,
          payWithWallet: true,
          discountCode: payload.discountCode,
          quantity: payload.quantity,
          priceCellId: payload.priceCellId,
        },
      });
      if (r.provisioned?.code) {
        setCreated({
          ...r.provisioned,
          categoryLabel: catLabels[payload.category] || payload.category,
          months: payload.months,
          trafficGb: r.provisioned.trafficGb ?? payload.trafficGb,
          note: r.provisioned.note ?? payload.note,
        });
      } else {
        flash(null, "ساخت اکانت انجام نشد");
      }
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <h2>ساخت اکانت</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          ساخت فوری و رایگان توسط ادمین — بدون کسر از کیف پول. اگر گروه پنل اختصاصی ندارید، در گروه Telegram ساخته می‌شود.
        </p>
        {rateCatalog && rateCatalog.categories.length > 0 ? (
          <RateShop catalog={rateCatalog} busy={busy} variant="admin" onSubmit={createRate} />
        ) : cells.length > 0 ? (
          <>
            <div className="field">
              <label>نام اکانت (اختیاری)</label>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="مثلاً customer01"
              />
            </div>
            <div className="plan-grid" style={{ marginTop: 12 }}>
              {cells.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`plan-card${selected?.id === c.id ? " on" : ""}${c.isGolden ? " golden" : ""}`}
                  onClick={() => setSelected(c)}
                >
                  <div className="plan-name">
                    {c.title || (c.trafficGb === null ? "نامحدود" : `${c.trafficGb} گیگ`)}
                  </div>
                  <div className="plan-meta">
                    <span>{catLabels[c.category] || c.category}</span>
                    <span className="num">{c.months} ماه</span>
                  </div>
                  <div className="plan-price num">{formatToman(c.price)}</div>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn success wide"
              style={{ marginTop: 14 }}
              disabled={!selected || busy}
              onClick={() => setMatrixConfirmOpen(true)}
            >
              {busy ? "در حال ساخت…" : "ساخت اکانت"}
            </button>
          </>
        ) : (
          <p className="muted">پلنی برای فروش فعال نیست.</p>
        )}
      </div>
      <AccountCreatedModal
        open={!!created}
        account={created}
        onClose={() => setCreated(null)}
        onCopied={() => flash("لینک اشتراک کپی شد")}
        walletBalance={0}
        onRefresh={() => undefined}
        isAdmin
      />
      {selected && (
        <Modal open={matrixConfirmOpen} title="تأیید ساخت اکانت" onClose={() => setMatrixConfirmOpen(false)}>
          <p className="order-confirm-summary">
            {[
              `اکانت «${accountName.trim() || "رندوم"}»`,
              `نوع: ${catLabels[selected.category] || selected.category}`,
              `حجم: ${selected.trafficGb == null ? "نامحدود" : `${selected.trafficGb.toLocaleString("fa-IR")} گیگابایت`}`,
              `مدت: ${selected.months.toLocaleString("fa-IR")} ماه`,
              `مبلغ: ${formatToman(selected.price)}`,
            ].join("\n")}
          </p>
          <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
            ساخت رایگان توسط ادمین — بدون کسر از کیف پول.
          </p>
          <div className="actions order-confirm-actions">
            <button type="button" className="btn success" disabled={busy} onClick={() => void create()}>
              تأیید و ساخت
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setMatrixConfirmOpen(false)}>
              انصراف
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Orders ---------------- */

function OrderReceiptImage({ orderId }: { orderId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const demoRole = getDemoRole();
    if (demoRole) headers["X-Demo-Role"] = demoRole;

    void fetch(`${apiBase()}/api/admin/orders/${orderId}/receipt-file`, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error("fail");
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orderId]);

  if (failed) return <p className="muted" style={{ margin: "8px 0 0" }}>بارگذاری عکس رسید ناموفق بود</p>;
  if (!src) return <p className="muted" style={{ margin: "8px 0 0" }}>در حال بارگذاری عکس رسید…</p>;
  return <img src={src} alt="رسید پرداخت" className="order-receipt-img" />;
}

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
        const r = await api<{ code?: string; walletBalance?: number; serverlessPending?: boolean }>(
          `/admin/orders/${id}/approve`,
          { body: {} },
        );
        flash(
          r.walletBalance !== undefined
            ? "کیف پول کاربر شارژ شد ✅"
            : r.serverlessPending
              ? "تأیید شد — منتظر ارسال لینک ساب از ربات"
              : `تأیید شد ✅ ${r.code ?? ""}`,
        );
      }
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(null);
    }
  }

  const payMethodLabel = (m?: string) => {
    if (m === "wallet") return "کیف پول";
    if (m === "crypto") return "کریپتو";
    if (m === "online") return "آنلاین";
    if (m === "card_to_card") return "کارت‌به‌کارت";
    return null;
  };

  return (
    <div className="panel">
      <h2>سفارش‌های در انتظار بررسی</h2>
      <div className="list">
        {orders.map((o) => (
          <div key={o.id} className="row-card" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong className="num">{formatToman(o.price)}</strong>{" "}
              <span
                className={`badge ${
                  o.status === "awaiting_review"
                    ? "warn"
                    : o.status === "awaiting_delivery"
                      ? "info"
                      : "info"
                }`}
              >
                {o.status === "awaiting_review"
                  ? "منتظر تأیید"
                  : o.status === "awaiting_delivery"
                    ? "ارسال دستی — لینک ساب"
                    : "منتظر پرداخت"}
              </span>
              {payMethodLabel(o.paymentMethod) && (
                <span className="badge info" style={{ marginInlineStart: 6 }}>
                  {payMethodLabel(o.paymentMethod)}
                </span>
              )}
              <pre className="muted" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "7px 0 0" }}>
                {o.summary}
              </pre>
              {o.provisionError ? (
                <div className="badge bad" style={{ marginTop: 8, display: "inline-block" }}>
                  خطای ساخت قبلی: {o.provisionError}
                </div>
              ) : null}
              {(o.receiptText || o.hasReceiptImage) && (
                <div className="order-receipt-box">
                  <div className="order-receipt-box__title">رسید پرداخت</div>
                  {o.receiptText ? (
                    <div className="order-receipt-box__text" dir="auto">
                      {o.receiptText}
                    </div>
                  ) : (
                    <div className="muted">عکس رسید ارسال شده</div>
                  )}
                  {o.hasReceiptImage && <OrderReceiptImage orderId={o.id} />}
                </div>
              )}
              {o.status === "awaiting_review" && !o.receiptText && !o.hasReceiptImage && (
                <div className="muted" style={{ marginTop: 8 }}>
                  رسید ثبت نشده
                </div>
              )}
              <div className="muted" style={{ marginTop: 4 }}>
                {o.user.username ? `@${o.user.username}` : o.user.firstName || o.user.telegramId} ·{" "}
                {new Date(o.createdAt).toLocaleString("fa-IR")}
              </div>
            </div>
            <div className="actions" style={{ flexDirection: "column" }}>
              {o.status === "awaiting_delivery" ? (
                <div className="muted" style={{ maxWidth: 200 }}>
                  لینک ساب را از ربات تلگرام (دکمه ارسال لینک ساب) بفرستید.
                </div>
              ) : (
                <button type="button" className="btn success sm" disabled={busy === o.id} onClick={() => act(o.id, "approve")}>
                  تأیید و ساخت
                </button>
              )}
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
  const [partnerReqs, setPartnerReqs] = useState<
    Array<{
      id: string;
      fullName: string;
      phone: string | null;
      note: string | null;
      createdAt: string;
      user: { id: string; telegramId: string; username: string | null; firstName: string | null; role: string };
    }>
  >([]);
  const [partnerBusy, setPartnerBusy] = useState<string | null>(null);
  const [discountPctDraft, setDiscountPctDraft] = useState("30");
  const [discountBusy, setDiscountBusy] = useState(false);
  const [priceOv, setPriceOv] = useState({
    perGb: "",
    perMonth: "",
    unlimitedPerMonth: "",
    partnerPricePercent: "100",
    note: "",
  });
  const [priceOvBusy, setPriceOvBusy] = useState(false);
  const [detail, setDetail] = useState<{
    txs: Array<{ id: string; amount: number; type: string; note: string | null; createdAt: string }>;
    subscriptions: Array<{ id: string; code: string; status: string; expiresAt: string }>;
  } | null>(null);

  const loadPartners = useCallback(async () => {
    try {
      const r = await api<{ requests: typeof partnerReqs }>("/admin/partners/pending");
      setPartnerReqs(r.requests);
    } catch {
      setPartnerReqs([]);
    }
  }, []);

  const load = useCallback(async () => {
    const r = await api<{ users: AdminUser[] }>(`/admin/users${roleFilter ? `?role=${roleFilter}` : ""}`);
    setUsers(r.users);
  }, [roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setDiscountPctDraft(String(selected.discountMaxPercent ?? 30));
    void api<NonNullable<typeof detail> & { user: AdminUser }>(`/admin/users/${selected.id}`).then((r) => {
      setDetail({ txs: r.txs, subscriptions: r.subscriptions });
      setSelected((s) =>
        s && s.id === r.user.id
          ? {
              ...s,
              discountCodesAllowed: r.user.discountCodesAllowed ?? true,
              discountMaxPercent: r.user.discountMaxPercent ?? 30,
              priceOverride: r.user.priceOverride ?? null,
            }
          : s,
      );
      setDiscountPctDraft(String(r.user.discountMaxPercent ?? 30));
      const ov = r.user.priceOverride;
      setPriceOv({
        perGb: ov?.perGb != null ? String(ov.perGb) : "",
        perMonth: ov?.perMonth != null ? String(ov.perMonth) : "",
        unlimitedPerMonth: ov?.unlimitedPerMonth != null ? String(ov.unlimitedPerMonth) : "",
        partnerPricePercent: String(ov?.partnerPricePercent ?? 100),
        note: ov?.note ?? "",
      });
    });
  }, [selected?.id]);

  const shown = q.trim()
    ? users.filter(
        (u) =>
          (u.username || "").toLowerCase().includes(q.toLowerCase()) ||
          u.telegramId.includes(q) ||
          (u.firstName || "").includes(q) ||
          (u.agentName || "").includes(q),
      )
    : users;

  async function decidePartner(id: string, action: "approve" | "reject", asRole?: "partner" | "wholesale" | "reseller") {
    const label =
      asRole === "reseller"
        ? "همکار ویژه"
        : asRole === "wholesale"
          ? "عمده‌فروش"
          : asRole === "partner"
            ? "همکار"
            : "رد";
    if (
      !(await askConfirm(
        action === "reject"
          ? "این درخواست همکاری رد شود؟"
          : `تأیید به‌عنوان ${label}؟`,
      ))
    ) {
      return;
    }
    setPartnerBusy(id);
    try {
      if (action === "reject") {
        await api(`/admin/partners/${id}/reject`, { body: {} });
        flash("درخواست رد شد");
      } else {
        await api(`/admin/partners/${id}/approve`, { body: { asRole: asRole ?? "partner" } });
        flash(`به‌عنوان ${label} تأیید شد`);
      }
      await loadPartners();
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setPartnerBusy(null);
    }
  }

  async function changeRole(u: AdminUser, role: string) {
    if (!(await askConfirm(`نقش ${u.username ? "@" + u.username : u.telegramId} به «${ROLE_FA[role]}» تغییر کند؟`))) return;
    try {
      await api(`/admin/users/${u.id}/role`, { body: { role } });
      flash("نقش تغییر کرد");
      await load();
      if (selected?.id === u.id) {
        setSelected((s) => (s ? { ...s, role, agentName: role === "user" ? null : s.agentName, panelGroup: role === "user" ? null : s.panelGroup } : s));
      }
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function removePartner(u: AdminUser) {
    const label = u.username ? `@${u.username}` : u.agentName || u.telegramId;
    const kind = u.role === "reseller" ? "همکار ویژه" : u.role === "wholesale" ? "عمده‌فروش" : "همکار";
    if (
      !(await askConfirm(
        `${kind} «${label}» از همکاری حذف شود و به مشتری عادی تبدیل شود؟\nنام نماینده و گروه پنل پاک می‌شود.`,
      ))
    ) {
      return;
    }
    try {
      await api(`/admin/users/${u.id}/demote`, { body: {} });
      flash(`${kind} حذف شد — الان مشتری عادی است`);
      await load();
      if (selected?.id === u.id) {
        setSelected((s) => (s ? { ...s, role: "user", agentName: null, panelGroup: null } : s));
      }
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function saveUserDiscount(patch: { discountCodesAllowed?: boolean; discountMaxPercent?: number }) {
    if (!selected) return;
    setDiscountBusy(true);
    try {
      const r = await api<{
        user: { id: string; discountCodesAllowed: boolean; discountMaxPercent: number };
      }>(`/admin/users/${selected.id}/discount`, { method: "PATCH", body: patch });
      flash("تنظیمات تخفیف ذخیره شد");
      setSelected((s) =>
        s
          ? {
              ...s,
              discountCodesAllowed: r.user.discountCodesAllowed,
              discountMaxPercent: r.user.discountMaxPercent,
            }
          : s,
      );
      setDiscountPctDraft(String(r.user.discountMaxPercent));
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setDiscountBusy(false);
    }
  }

  async function savePriceOverride(clear = false) {
    if (!selected) return;
    setPriceOvBusy(true);
    try {
      const r = await api<{ priceOverride: AdminUser["priceOverride"] }>(`/admin/users/${selected.id}/price-override`, {
        method: "PUT",
        body: clear
          ? { clear: true }
          : {
              perGb: priceOv.perGb === "" ? null : Number(priceOv.perGb),
              perMonth: priceOv.perMonth === "" ? null : Number(priceOv.perMonth),
              unlimitedPerMonth: priceOv.unlimitedPerMonth === "" ? null : Number(priceOv.unlimitedPerMonth),
              partnerPricePercent: Number(priceOv.partnerPricePercent || "100"),
              note: priceOv.note || null,
            },
      });
      flash(clear ? "قیمت اختصاصی پاک شد" : "قیمت اختصاصی ذخیره شد");
      setSelected((s) => (s ? { ...s, priceOverride: r.priceOverride } : s));
      if (clear) {
        setPriceOv({ perGb: "", perMonth: "", unlimitedPerMonth: "", partnerPricePercent: "100", note: "" });
      }
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setPriceOvBusy(false);
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
        <h2>درخواست‌های همکاری در انتظار</h2>
        {!partnerReqs.length ? (
          <p className="muted">درخواستی در صف نیست.</p>
        ) : (
          <div className="list">
            {partnerReqs.map((r) => (
              <div key={r.id} className="row-card row-card--stack">
                <div>
                  <strong>{r.fullName}</strong>{" "}
                  <span className="badge warn">در انتظار</span>
                  <div className="muted">
                    {r.user.username ? `@${r.user.username}` : r.user.firstName || "—"} · TG{" "}
                    <span className="num">{r.user.telegramId}</span>
                    {r.phone ? ` · 📱 ${r.phone}` : ""}
                  </div>
                  {r.note?.trim() && (
                    <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                      {r.note.trim()}
                    </div>
                  )}
                  <div className="muted" style={{ marginTop: 4 }}>
                    ثبت: {new Date(r.createdAt).toLocaleString("fa-IR")}
                  </div>
                </div>
                <div className="config-card-actions">
                  <div className="config-card-actions-row cols-3">
                    <button
                      type="button"
                      className="btn success sm"
                      disabled={partnerBusy === r.id}
                      onClick={() => void decidePartner(r.id, "approve", "partner")}
                    >
                      تأیید همکار
                    </button>
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={partnerBusy === r.id}
                      onClick={() => void decidePartner(r.id, "approve", "reseller")}
                    >
                      همکار ویژه
                    </button>
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={partnerBusy === r.id}
                      onClick={() => void decidePartner(r.id, "approve", "wholesale")}
                    >
                      عمده‌فروش
                    </button>
                    <button
                      type="button"
                      className="btn danger sm"
                      disabled={partnerBusy === r.id}
                      onClick={() => void decidePartner(r.id, "reject")}
                    >
                      رد
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>کاربران</h2>
        <div className="field" style={{ marginBottom: 12, maxWidth: 280 }}>
          <label>دسته کاربران</label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">همه</option>
            {["user", "partner", "wholesale", "reseller", "admin"].map((r) => (
              <option key={r} value={r}>
                {ROLE_FA[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>جستجو (یوزرنیم، آی‌دی، نام)</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="users-mlist users-mlist--always">
          {shown.slice(0, 60).map((u) => (
            <div key={u.id} className="users-mcard">
              <div className="users-mrow">
                <div className="users-muser">
                  <div className="users-muser-title">
                    <span className="users-mlabel">Username:</span>{" "}
                    {u.username ? (
                      <a
                        className="users-musername"
                        href={`https://t.me/${u.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        @{u.username}
                      </a>
                    ) : (
                      <span>{u.firstName || "—"}</span>
                    )}
                  </div>
                  {u.agentName ? <div className="muted">{u.agentName}</div> : null}
                </div>
                <div className="users-mwallet num">{formatToman(u.balance)}</div>
              </div>
              <div className="users-mmeta">
                <div>
                  <span className="users-mlabel">User ID:</span>{" "}
                  <span className="num">{u.telegramId}</span>
                </div>
                <div>
                  <span className="users-mlabel">Group:</span> {u.panelGroup || "—"}
                </div>
              </div>
              <div className="users-mrow-actions">
                <button type="button" className="btn ghost sm" onClick={() => setSelected(u)}>
                  جزئیات و شارژ
                </button>
                <select
                  className="users-mrole"
                  value={u.role}
                  onChange={(e) => changeRole(u, e.target.value)}
                  aria-label="نقش"
                >
                  {Object.entries(ROLE_FA).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        {shown.length > 60 && (
          <p className="muted" style={{ marginTop: 10 }}>
            نمایش ۶۰ از {shown.length} کاربر — جستجو یا فیلتر نقش را دقیق‌تر کنید.
          </p>
        )}
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

          {(selected.role === "partner" || selected.role === "wholesale" || selected.role === "reseller") && (
            <>
              <div className="actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn danger" onClick={() => void removePartner(selected)}>
                  حذف از همکاری — تبدیل به مشتری عادی
                </button>
              </div>

              <h2 style={{ marginTop: 16, fontSize: "1rem" }}>کد تخفیف این نماینده</h2>
              <div className="setting-row" style={{ marginBottom: 10 }}>
                <div>
                  <div className="t">اجازه ساخت کد تخفیف</div>
                  <div className="d">اگر خاموش باشد، منوی کد تخفیف برای این نماینده دیده نمی‌شود.</div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={selected.discountCodesAllowed !== false}
                    disabled={discountBusy}
                    onChange={(e) => void saveUserDiscount({ discountCodesAllowed: e.target.checked })}
                  />
                  <span className="track" />
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <div className="t">سقف درصد تخفیف</div>
                  <div className="d">حداکثر درصدی که این نماینده می‌تواند روی کد بگذارد (پیش‌فرض ۳۰).</div>
                </div>
                <input
                  className="num"
                  inputMode="numeric"
                  disabled={discountBusy || selected.discountCodesAllowed === false}
                  value={discountPctDraft}
                  onChange={(e) => setDiscountPctDraft(e.target.value.replace(/[^\d]/g, ""))}
                  onBlur={() => {
                    const n = Math.max(1, Math.min(100, Number(discountPctDraft || "30") || 30));
                    setDiscountPctDraft(String(n));
                    if (n !== (selected.discountMaxPercent ?? 30)) {
                      void saveUserDiscount({ discountMaxPercent: n });
                    }
                  }}
                  style={{
                    width: 72,
                    border: "1px solid var(--line)",
                    background: "rgba(10,13,35,.6)",
                    color: "var(--text)",
                    borderRadius: 10,
                    padding: "8px 12px",
                  }}
                />
              </div>

              <h2 style={{ marginTop: 16, fontSize: "1rem" }}>قیمت اختصاصی این نماینده</h2>
              <p className="muted" style={{ marginBottom: 10, fontSize: "0.85rem" }}>
                اگر گیگ/ماه پر شود، همان نرخ برای این کاربر استفاده می‌شود. در غیر این صورت درصد روی قیمت ماتریکس/نرخ اعمال می‌شود.
              </p>
              <div className="field">
                <label>تومان به ازای هر گیگ</label>
                <input className="num" inputMode="numeric" value={priceOv.perGb} onChange={(e) => setPriceOv((p) => ({ ...p, perGb: e.target.value.replace(/[^\d]/g, "") }))} placeholder="خالی = پیش‌فرض" />
              </div>
              <div className="field">
                <label>تومان به ازای هر ماه</label>
                <input className="num" inputMode="numeric" value={priceOv.perMonth} onChange={(e) => setPriceOv((p) => ({ ...p, perMonth: e.target.value.replace(/[^\d]/g, "") }))} placeholder="خالی = پیش‌فرض" />
              </div>
              <div className="field">
                <label>تومان ماهانه نامحدود</label>
                <input className="num" inputMode="numeric" value={priceOv.unlimitedPerMonth} onChange={(e) => setPriceOv((p) => ({ ...p, unlimitedPerMonth: e.target.value.replace(/[^\d]/g, "") }))} />
              </div>
              <div className="field">
                <label>درصد قیمت ماتریکس (۱۰۰ = بدون تغییر)</label>
                <input className="num" inputMode="numeric" value={priceOv.partnerPricePercent} onChange={(e) => setPriceOv((p) => ({ ...p, partnerPricePercent: e.target.value.replace(/[^\d]/g, "") }))} />
              </div>
              <div className="field">
                <label>یادداشت</label>
                <input value={priceOv.note} onChange={(e) => setPriceOv((p) => ({ ...p, note: e.target.value }))} />
              </div>
              <div className="actions">
                <button type="button" className="btn primary" disabled={priceOvBusy} onClick={() => void savePriceOverride(false)}>
                  ذخیره قیمت اختصاصی
                </button>
                <button type="button" className="btn" disabled={priceOvBusy || !selected.priceOverride} onClick={() => void savePriceOverride(true)}>
                  پاک کردن
                </button>
              </div>
            </>
          )}

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
    priceReseller: "",
    limitIp: "1",
    title: "",
    isGolden: false,
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
  const rateCategories = categories.filter((c) => c.key !== "unlimited" && c.key !== "wholesale" && c.key !== "offer");
  const isWholesaleForm = newCell.category === "wholesale";

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
      const isWh = c.category === "wholesale" || c.category === "reseller";
      const resellerPrice = Number(e.priceReseller ?? c.priceReseller ?? 0);
      await api(`/admin/prices/${c.id}`, {
        method: "PUT",
        body: isWh
          ? {
              priceUser: resellerPrice,
              pricePartner: resellerPrice,
              priceWholesale: resellerPrice,
              priceReseller: resellerPrice,
              limitIp: Number(e.limitIp ?? c.limitIp ?? 0),
              title: e.title ?? c.title,
            }
          : {
              priceUser: Number(e.priceUser ?? c.priceUser),
              pricePartner: Number(e.pricePartner ?? c.pricePartner),
              priceWholesale: Number(e.priceWholesale ?? c.priceWholesale),
              priceReseller: Number(e.priceReseller ?? c.priceReseller ?? 0),
              limitIp: Number(e.limitIp ?? c.limitIp ?? 0),
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
        const isWh = c.category === "wholesale" || c.category === "reseller";
        const resellerPrice = Number(e.priceReseller ?? c.priceReseller ?? 0);
        await api(`/admin/prices/${id}`, {
          method: "PUT",
          body: isWh
            ? {
                priceUser: resellerPrice,
                pricePartner: resellerPrice,
                priceWholesale: resellerPrice,
                priceReseller: resellerPrice,
                limitIp: Number(e.limitIp ?? c.limitIp ?? 0),
                title: e.title ?? c.title,
              }
            : {
                priceUser: Number(e.priceUser ?? c.priceUser),
                pricePartner: Number(e.pricePartner ?? c.pricePartner),
                priceWholesale: Number(e.priceWholesale ?? c.priceWholesale),
                priceReseller: Number(e.priceReseller ?? c.priceReseller ?? 0),
                limitIp: Number(e.limitIp ?? c.limitIp ?? 0),
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

  async function toggleGolden(c: PriceRow, isGolden: boolean) {
    try {
      await api(`/admin/prices/${c.id}`, { method: "PUT", body: { isGolden } });
      setCells((list) => list.map((x) => (x.id === c.id ? { ...x, isGolden } : x)));
      flash(isGolden ? "پیشنهاد ویژه شد ⭐" : "از پیشنهاد ویژه برداشته شد");
    } catch (e) {
      flash(null, errText(e));
      await load();
    }
  }

  async function addCell() {
    try {
      const isUnlimited = newCell.category === "unlimited";
      const isOffer = newCell.category === "offer";
      const isWholesale = newCell.category === "wholesale";
      const trafficGb =
        isUnlimited || (isOffer && !String(newCell.trafficGb).trim())
          ? null
          : newCell.trafficGb === ""
            ? null
            : Number(newCell.trafficGb);
      if (!isUnlimited && !isOffer && (trafficGb === null || !Number.isFinite(trafficGb) || trafficGb <= 0)) {
        flash(null, "برای دسته‌های حجمی، حجم GB را وارد کنید. نامحدود را از دستهٔ «نامحدود» بسازید.");
        return;
      }
      if (isOffer && trafficGb != null && (!Number.isFinite(trafficGb) || trafficGb <= 0)) {
        flash(null, "حجم پیشنهاد ویژه نامعتبر است (خالی = نامحدود).");
        return;
      }
      if (isWholesale && !parsePriceInput(newCell.priceReseller)) {
        flash(null, "قیمت عمده‌فروش را وارد کنید.");
        return;
      }
      const wholesalePrice = parsePriceInput(newCell.priceReseller);
      await api("/admin/prices", {
        body: isWholesale
          ? {
              category: "wholesale",
              trafficGb,
              months: Number(newCell.months),
              priceUser: wholesalePrice,
              pricePartner: wholesalePrice,
              priceWholesale: wholesalePrice,
              priceReseller: wholesalePrice,
              limitIp: Number(newCell.limitIp) || 1,
              title: newCell.title || undefined,
              isGolden: false,
            }
          : {
              category: isUnlimited ? "unlimited" : newCell.category,
              trafficGb,
              months: Number(newCell.months),
              priceUser: parsePriceInput(newCell.priceUser),
              pricePartner: parsePriceInput(newCell.pricePartner),
              priceWholesale: newCell.priceWholesale ? parsePriceInput(newCell.priceWholesale) : undefined,
              priceReseller: newCell.priceReseller ? parsePriceInput(newCell.priceReseller) : undefined,
              title: newCell.title || undefined,
              isGolden: newCell.isGolden,
            },
      });
      flash("پلن جدید اضافه شد");
      setNewCell({
        category: isWholesale ? "wholesale" : "data",
        trafficGb: "",
        months: "1",
        priceUser: "",
        pricePartner: "",
        priceWholesale: "",
        priceReseller: "",
        limitIp: "1",
        title: "",
        isGolden: false,
      });
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
    <div className="prices-page">
      <section className="panel prices-section">
        <div className="prices-section-head">
          <h2>حالت قیمت‌گذاری هر نقش</h2>
          <p className="muted">ماتریکس = پلن‌های ثابت · نرخی = (گیگ × نرخ گیگ) + (ماه × نرخ ماه)</p>
        </div>
        <div className="pricing-mode-grid">
          {(
            [
              ["user", "کاربر عادی"],
              ["partner", "همکار"],
              ["wholesale", "همکار ویژه"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="pricing-mode-card">
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
      </section>

      <section className="panel prices-section">
        <div className="prices-section-head">
          <h2>{isWholesaleForm ? "افزودن پلن عمده‌فروش" : "افزودن پلن جدید"}</h2>
          <p className="muted">
            {isWholesaleForm
              ? "فقط برای نقش عمده‌فروش؛ پلن ثابت با قیمت و تعداد کاربر مشخص."
              : "پلن ماتریکس جدید به جدول قیمت‌ها اضافه می‌شود."}
          </p>
        </div>
        <div className="prices-add-grid">
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
            <label>
              {newCell.category === "unlimited"
                ? "حجم (نامحدود)"
                : newCell.category === "offer"
                  ? "حجم GB (خالی = نامحدود)"
                  : "حجم GB"}
            </label>
            <input
              className="num"
              inputMode="numeric"
              disabled={newCell.category === "unlimited"}
              placeholder={newCell.category === "unlimited" ? "∞" : newCell.category === "offer" ? "مثلاً 50 یا خالی" : "مثلاً 100"}
              value={newCell.category === "unlimited" ? "" : newCell.trafficGb}
              onChange={(e) => setNewCell((s) => ({ ...s, trafficGb: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>مدت (ماه)</label>
            <input
              className="num"
              inputMode="numeric"
              value={newCell.months}
              onChange={(e) => setNewCell((s) => ({ ...s, months: e.target.value }))}
            />
          </div>
          {isWholesaleForm ? (
            <>
              <div className="field">
                <label>قیمت عمده‌فروش</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={formatPriceInput(newCell.priceReseller)}
                  onChange={(e) =>
                    setNewCell((s) => ({ ...s, priceReseller: formatPriceInput(parsePriceInput(e.target.value) || "") }))
                  }
                />
              </div>
              <div className="field">
                <label>تعداد کاربر (IP)</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={newCell.limitIp}
                  onChange={(e) => setNewCell((s) => ({ ...s, limitIp: e.target.value.replace(/[^\d]/g, "") }))}
                />
              </div>
              <div className="field">
                <label>عنوان (اختیاری)</label>
                <input value={newCell.title} onChange={(e) => setNewCell((s) => ({ ...s, title: e.target.value }))} />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>قیمت کاربر</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={formatPriceInput(newCell.priceUser)}
                  onChange={(e) =>
                    setNewCell((s) => ({ ...s, priceUser: formatPriceInput(parsePriceInput(e.target.value) || "") }))
                  }
                />
              </div>
              <div className="field">
                <label>قیمت همکار</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={formatPriceInput(newCell.pricePartner)}
                  onChange={(e) =>
                    setNewCell((s) => ({ ...s, pricePartner: formatPriceInput(parsePriceInput(e.target.value) || "") }))
                  }
                />
              </div>
              <div className="field">
                <label>قیمت همکار ویژه</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={formatPriceInput(newCell.priceWholesale)}
                  onChange={(e) =>
                    setNewCell((s) => ({
                      ...s,
                      priceWholesale: formatPriceInput(parsePriceInput(e.target.value) || ""),
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>عنوان (اختیاری)</label>
                <input value={newCell.title} onChange={(e) => setNewCell((s) => ({ ...s, title: e.target.value }))} />
              </div>
              <div className="field prices-add-gold">
                <label className="price-plan-gold">
                  <input
                    type="checkbox"
                    checked={newCell.isGolden}
                    onChange={(e) => setNewCell((s) => ({ ...s, isGolden: e.target.checked }))}
                  />
                  <span>پیشنهاد ویژه ⭐</span>
                </label>
              </div>
            </>
          )}
        </div>
        <div className="prices-section-actions">
          <button
            type="button"
            className="btn success"
            disabled={
              !newCell.months ||
              (isWholesaleForm
                ? !newCell.priceReseller || !newCell.trafficGb
                : !newCell.priceUser ||
                  !newCell.pricePartner ||
                  (newCell.category !== "unlimited" && newCell.category !== "offer" && !newCell.trafficGb))
            }
            onClick={addCell}
          >
            افزودن پلن
          </button>
        </div>
      </section>

      <section className="panel prices-section">
        <div className="prices-section-head">
          <h2>ویرایش گروهی قیمت‌ها</h2>
          <p className="muted">افزایش یا کاهش یکجا روی پلن‌های ماتریکس. مقدار منفی = کاهش.</p>
        </div>
        <div className="prices-bulk-cats">
          <button key="all" type="button" className={`chip${catFilter === "" ? " on" : ""}`} onClick={() => setCatFilter("")}>
            همه
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip${catFilter === c.key ? " on" : ""}`}
              onClick={() => setCatFilter(c.key)}
            >
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
        <p className="hint">نتیجه به نزدیک‌ترین ۱٬۰۰۰ تومان گرد می‌شود و روی هر سه ستون قیمت اعمال می‌شود.</p>
      </section>

      <section className="panel prices-section">
        <div className="prices-section-head">
          <h2>قیمت ثابت هر گیگ / هر ماه</h2>
          <p className="muted">برای نقش‌های «نرخی». هر دسته نرخ جدا دارد؛ نامحدود همیشه از نرخ ماهانه محاسبه می‌شود.</p>
        </div>
        <div className="rate-cards-grid">
          {rateCategories.map((cat) => (
            <div key={cat.key} className="rate-cat-card">
              <div className="rate-cat-card__title">{cat.label}</div>
              <div className="rate-role-rows">
                {(
                  [
                    ["user", "کاربر"],
                    ["partner", "همکار"],
                    ["wholesale", "همکار ویژه"],
                  ] as const
                ).map(([role, roleLabel]) => (
                  <div key={role} className="rate-role-row">
                    <span className="rate-role-label">{roleLabel}</span>
                    <div className="field">
                      <label>هر گیگ</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(catUnit(cat.key, role, "perGb"))}
                        onChange={(e) => setCatUnit(cat.key, role, "perGb", parsePriceInput(e.target.value))}
                      />
                    </div>
                    <div className="field">
                      <label>هر ماه</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(catUnit(cat.key, role, "perMonth"))}
                        onChange={(e) => setCatUnit(cat.key, role, "perMonth", parsePriceInput(e.target.value))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="rate-cat-card rate-cat-card--unlimited">
            <div className="rate-cat-card__title">نامحدود (قیمت هر ماه)</div>
            <p className="muted rate-cat-card__note">حتی اگر نقش روی ماتریکس باشد. N ماهه = N × این عدد.</p>
            <div className="rate-unlimited-fields">
              {(
                [
                  ["user", "کاربر"],
                  ["partner", "همکار"],
                  ["wholesale", "همکار ویژه"],
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
        </div>
        <div className="prices-section-actions">
          <button type="button" className="btn primary" disabled={ratesBusy} onClick={() => void saveRates()}>
            ذخیره نرخ‌ها
          </button>
          <p className="hint" style={{ margin: 0 }}>
            مثال حجمی: ۵۰ گیگ ۲ ماهه = (۵۰ × هر گیگ) + (۲ × هر ماه)
          </p>
        </div>
      </section>

      <section className="panel prices-section">
        <div className="prices-section-head">
          <h2>پلن‌ها و قیمت‌ها</h2>
          <p className="muted">ویرایش قیمت ماتریکس، پیشنهاد ویژه و فعال/غیرفعال.</p>
        </div>
        <div className="prices-bulk-cats" style={{ marginBottom: 14 }}>
          <button key="all" type="button" className={`chip${catFilter === "" ? " on" : ""}`} onClick={() => setCatFilter("")}>
            همه
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip${catFilter === c.key ? " on" : ""}`}
              onClick={() => setCatFilter(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {catFilter === "unlimited" && (
          <p className="hint">
            قیمت نامحدود از «نرخ هر ماه» بالا (و در صورت نبود نرخ، از پلن ماتریکس همین دسته) محاسبه می‌شود.
          </p>
        )}
        {(catFilter === "wholesale" || catFilter === "reseller") && (
          <p className="hint">این پلن‌ها فقط برای نقش عمده‌فروش قابل خرید هستند.</p>
        )}
        <div className="price-plan-list">
          {shown.map((c) => {
            const e = edits[c.id] ?? {};
            const isWh = c.category === "wholesale" || c.category === "reseller";
            return (
              <div key={c.id} className={`price-plan-card${c.active === false ? " off" : ""}${c.isGolden ? " golden" : ""}`}>
                <div className="price-plan-head">
                  <div className="price-plan-title">
                    <strong className="num">
                      {c.title?.trim() || `${c.trafficGb ?? "∞"}GB · ${c.months}ماه`}
                      {!isWh && c.isGolden && " ⭐"}
                    </strong>
                    <span className="muted">{catLabel(c.category, categories)}</span>
                  </div>
                  <div className="price-plan-toggles">
                    {!isWh && (
                      <label className="price-plan-gold" title="پیشنهاد ویژه — در حالت نرخی هم قیمت ثابت این پلن اعمال می‌شود">
                        <input
                          type="checkbox"
                          checked={Boolean(c.isGolden)}
                          onChange={(ev) => void toggleGolden(c, ev.target.checked)}
                        />
                        <span>ویژه ⭐</span>
                      </label>
                    )}
                    <label className="switch" title="فعال / غیرفعال">
                      <input
                        type="checkbox"
                        checked={c.active !== false}
                        onChange={(ev) => void toggleActive(c, ev.target.checked)}
                      />
                      <span className="track" />
                    </label>
                  </div>
                </div>
                <div className="price-plan-fields">
                  {isWh ? (
                    <>
                      <div className="field">
                        <label>قیمت</label>
                        <input
                          className="num"
                          inputMode="numeric"
                          dir="ltr"
                          value={formatPriceInput(e.priceReseller ?? c.priceReseller ?? 0)}
                          onChange={(ev) =>
                            setEdits((m) => ({
                              ...m,
                              [c.id]: { ...m[c.id], priceReseller: parsePriceInput(ev.target.value) },
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        <label>کاربر (IP)</label>
                        <input
                          className="num"
                          inputMode="numeric"
                          dir="ltr"
                          value={String(e.limitIp ?? c.limitIp ?? 0)}
                          onChange={(ev) =>
                            setEdits((m) => ({
                              ...m,
                              [c.id]: { ...m[c.id], limitIp: Number(ev.target.value.replace(/[^\d]/g, "") || "0") },
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        <label>عنوان</label>
                        <input
                          value={String(e.title ?? c.title ?? "")}
                          onChange={(ev) =>
                            setEdits((m) => ({
                              ...m,
                              [c.id]: { ...m[c.id], title: ev.target.value },
                            }))
                          }
                        />
                      </div>
                    </>
                  ) : (
                    <>
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
                        <label>همکار ویژه</label>
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
                    </>
                  )}
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
      </section>
    </div>
  );
}

/* ---------------- Categories ---------------- */

function CategoriesTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [reordering, setReordering] = useState(false);

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

  async function moveCategory(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= cats.length) return;
    const ordered = [...cats];
    const tmp = ordered[index]!;
    ordered[index] = ordered[next]!;
    ordered[next] = tmp;
    setCats(ordered);
    setReordering(true);
    try {
      await api("/admin/categories/order", { method: "PUT", body: { order: ordered.map((c) => c.key) } });
      flash("ترتیب ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
      await load();
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="panel">
      <h2>مدیریت دسته‌بندی‌ها</h2>
      <p className="muted cat-intro">
        نام، فعال‌بودن فروش و ترتیب نمایش در ربات و داشبورد را از اینجا تنظیم کنید.
      </p>
      <div className="cat-list">
        {cats.map((c, i) => {
          const draft = labelEdits[c.key] ?? c.label;
          const dirty = draft !== c.label;
          return (
            <div key={c.key} className="cat-card">
              <div className="cat-card__rail" aria-label={`ردیف ${i + 1}`}>
                <button
                  type="button"
                  className="cat-card__move"
                  title="بالا"
                  disabled={reordering || i === 0}
                  onClick={() => void moveCategory(i, -1)}
                  aria-label="جابه‌جایی به بالا"
                >
                  ▲
                </button>
                <span className="cat-card__rank" dir="ltr">
                  {i + 1}
                </span>
                <button
                  type="button"
                  className="cat-card__move"
                  title="پایین"
                  disabled={reordering || i === cats.length - 1}
                  onClick={() => void moveCategory(i, 1)}
                  aria-label="جابه‌جایی به پایین"
                >
                  ▼
                </button>
              </div>
              <div className="cat-card__body">
                <div className="cat-card__head">
                  <div className="cat-card__meta">
                    <span className="cat-card__key" dir="ltr">
                      {c.key}
                    </span>
                    <span>{c.cellCount} پلن</span>
                    {c.builtin ? <span className="cat-card__tag">پیش‌فرض</span> : null}
                    {c.key === "wholesale" ? <span className="cat-card__tag">فقط عمده‌فروش</span> : null}
                  </div>
                  <label className="switch switch-sm" title="فروش فعال/غیرفعال">
                    <input type="checkbox" checked={c.enabled} onChange={(e) => save(c, { enabled: e.target.checked })} />
                    <span className="track" />
                  </label>
                </div>
                {c.key === "wholesale" ? (
                  <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                    با فعال‌سازی، فقط نقش عمده‌فروش این پلن‌ها را می‌بیند و می‌خرد؛ نقش‌های دیگر به این دسته دسترسی ندارند.
                  </p>
                ) : null}
                <input
                  className="cat-card__input"
                  value={draft}
                  onChange={(e) => setLabelEdits((m) => ({ ...m, [c.key]: e.target.value }))}
                  aria-label={`نام دسته ${c.key}`}
                />
                <div className="cat-card__toolbar">
                  {dirty ? (
                    <button type="button" className="btn primary sm" onClick={() => save(c, { label: draft })}>
                      ذخیره
                    </button>
                  ) : null}
                  <button type="button" className="btn ghost sm cat-card__del" onClick={() => void remove(c)}>
                    حذف
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cat-add">
        <h2>افزودن دسته</h2>
        <div className="cat-add__grid">
          <div className="field">
            <label>کلید (انگلیسی)</label>
            <input dir="ltr" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="vip2" />
          </div>
          <div className="field">
            <label>نام نمایشی</label>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="ویژه ۲" />
          </div>
        </div>
        <button type="button" className="btn success sm cat-add__btn" disabled={!newKey.trim()} onClick={() => void addCategory()}>
          افزودن دسته
        </button>
      </div>
    </div>
  );
}

/* ---------------- Configs (panel accounts) ---------------- */

/* ---------------- Panel ↔ Bot sync (dedicated) ---------------- */

const SYNC_OPTION_DEFS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "newAccounts", label: "اکانت‌های جدید" },
  { key: "deletedAccounts", label: "اکانت‌های حذف‌شده" },
  { key: "name", label: "نام (Email)" },
  { key: "traffic", label: "حجم و مقدار مصرف", hint: "فقط حجم کل؛ مصرف از پنل بازنویسی نمی‌شود" },
  { key: "expiry", label: "تاریخ انقضا" },
  { key: "inbounds", label: "اینباندها", hint: "فقط هنگام ساخت اکانت جدید در پنل" },
  { key: "limitIp", label: "محدودیت کاربر" },
  { key: "comment", label: "کامنت", hint: "کامنت پنل → نوت ربات (یا title | note)" },
  { key: "note", label: "نوت" },
];

function SyncTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  type Diff = {
    panelOnly: Array<{ email: string; panelName: string; trafficGb: number | null; expiresAt: string | null }>;
    botOnly: Array<{ email: string; code: string; subId: string; ownerLabel: string }>;
    mismatched: Array<{
      email: string;
      code: string;
      subId: string;
      fields: Array<"expiry" | "traffic" | "limitIp" | "enable">;
      panelExpiresAt: string | null;
      botExpiresAt: string;
      panelTrafficGb: number | null;
      botTrafficGb: number | null;
      panelStartsOnConnect: boolean;
      botStartsOnConnect: boolean;
    }>;
    matched: number;
    panelTotal: number;
    botTotal: number;
  };

  const [direction, setDirection] = useState<"panel_to_bot" | "bot_to_panel">("panel_to_bot");
  const [opts, setOpts] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      SYNC_OPTION_DEFS.map((o) => [
        o.key,
        o.key === "newAccounts" || o.key === "expiry" || o.key === "traffic",
      ]),
    ),
  );
  const [diff, setDiff] = useState<Diff | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const sourceLabel = direction === "panel_to_bot" ? "پنل 3x-ui" : "دیتابیس ربات";
  const destLabel = direction === "panel_to_bot" ? "دیتابیس ربات" : "پنل 3x-ui";
  const selectedOpts = SYNC_OPTION_DEFS.filter((o) => opts[o.key]);
  const allChecked = SYNC_OPTION_DEFS.every((o) => opts[o.key]);

  function setAllOpts(checked: boolean) {
    setOpts(Object.fromEntries(SYNC_OPTION_DEFS.map((o) => [o.key, checked])));
  }

  async function refreshUndo() {
    try {
      const r = await api<{ available: boolean }>("/admin/configs/sync/undo-status");
      setUndoAvailable(Boolean(r.available));
    } catch {
      setUndoAvailable(false);
    }
  }

  useEffect(() => {
    void refreshUndo();
  }, []);

  async function runDiff() {
    setBusy(true);
    try {
      const r = await api<Diff>("/admin/configs/sync-diff");
      setDiff(r);
      const mism = r.mismatched?.length ?? 0;
      flash(
        `مقایسه: ${r.panelOnly.length} فقط پنل · ${r.matched} مشترک · ${mism} ناهمخوان · ${r.botOnly.length} فقط ربات`,
      );
      await refreshUndo();
    } catch (e) {
      setDiff(null);
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  function openApplyModal() {
    if (!selectedOpts.length) {
      flash(null, "حداقل یک گزینه را انتخاب کنید");
      return;
    }
    setApplyOpen(true);
  }

  async function confirmApply() {
    setApplyOpen(false);
    setBusy(true);
    try {
      const r = await api<{
        created: number;
        deleted: number;
        updated: number;
        skippedUnreachable: number;
        failed: Array<{ email: string; error: string }>;
        undoAvailable: boolean;
      }>("/admin/configs/sync/apply", {
        method: "POST",
        body: {
          direction,
          options: selectedOpts.map((o) => o.key),
        },
      });
      setUndoAvailable(Boolean(r.undoAvailable));
      const failNote = r.failed?.length ? ` · ${r.failed.length} ناموفق` : "";
      flash(`اعمال شد: ${r.created} جدید · ${r.deleted} حذف · ${r.updated} به‌روز${failNote}`);
      await runDiff();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function runUndo() {
    if (!(await askConfirm("آخرین همگام‌سازی به‌طور کامل برگردانده شود؟"))) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/admin/configs/sync/undo", {
        method: "POST",
        body: {},
      });
      setUndoAvailable(false);
      flash(r.message);
      await runDiff();
    } catch (e) {
      flash(null, errText(e));
      await refreshUndo();
    } finally {
      setBusy(false);
    }
  }

  const newCount =
    direction === "panel_to_bot" ? (diff?.panelOnly.length ?? null) : (diff?.botOnly.length ?? null);
  const delCount =
    direction === "panel_to_bot" ? (diff?.botOnly.length ?? null) : (diff?.panelOnly.length ?? null);

  return (
    <>
      <div className="panel">
        <h2>همگام‌سازی</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          مشخص کنید داده از کجا به کجا برود. فقط گزینه‌های تیک‌خورده اعمال می‌شوند. اگر اشتباه شد، Undo آخرین اعمال را برمی‌گرداند.
        </p>

        <div className="grid" style={{ marginBottom: 14, gap: 12 }}>
          <div className="field">
            <label>منبع (از)</label>
            <select
              value={direction === "panel_to_bot" ? "panel" : "bot"}
              onChange={(e) => {
                const toPanel = e.target.value === "bot";
                setDirection(toPanel ? "bot_to_panel" : "panel_to_bot");
              }}
            >
              <option value="panel">پنل 3x-ui</option>
              <option value="bot">دیتابیس ربات</option>
            </select>
          </div>
          <div className="field">
            <label>مقصد (به)</label>
            <input value={destLabel} readOnly disabled />
          </div>
        </div>

        <div
          className="row-card"
          style={{
            marginBottom: 14,
            padding: "12px 14px",
            border: direction === "bot_to_panel" ? "1px solid rgba(251,113,133,0.45)" : undefined,
          }}
        >
          <strong>
            {sourceLabel} → {destLabel}
          </strong>
          {direction === "bot_to_panel" ? (
            <p className="muted" style={{ margin: "8px 0 0" }}>
              هشدار: مقادیر انتخاب‌شده از دیتابیس ربات روی پنل نوشته می‌شود و تنظیمات فعلی پنل برای همان فیلدها عوض می‌شود.
            </p>
          ) : (
            <p className="muted" style={{ margin: "8px 0 0" }}>
              مقادیر انتخاب‌شده از پنل روی دیتابیس ربات اعمال می‌شود. پنل دست نخورده می‌ماند.
            </p>
          )}
        </div>

        <h3 style={{ fontSize: "0.95rem", marginBottom: 8 }}>چه چیزهایی همگام شود؟</h3>
        <div className="sync-options">
          <label className="sync-opt sync-opt-all" title="انتخاب / برداشتن همه">
            <input type="checkbox" checked={allChecked} onChange={(e) => setAllOpts(e.target.checked)} />
            <span>همه موارد</span>
          </label>
          {SYNC_OPTION_DEFS.map((o) => (
            <label key={o.key} className="sync-opt" title={o.hint}>
              <input
                type="checkbox"
                checked={Boolean(opts[o.key])}
                onChange={(e) => setOpts((m) => ({ ...m, [o.key]: e.target.checked }))}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>

        <div className="sync-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void runDiff()}>
            {busy ? "…" : "مقایسه وضعیت"}
          </button>
          <button type="button" className="btn success" disabled={busy} onClick={openApplyModal}>
            اعمال تغییرات
          </button>
          <button type="button" className="btn ghost" disabled={busy || !undoAvailable} onClick={() => void runUndo()}>
            Undo
          </button>
        </div>

        {diff && (
          <div className="sync-diff-result">
            <div className="grid" style={{ marginBottom: 12 }}>
              <div className="stat accent">
                <div className="label">فقط پنل</div>
                <div className="value num">{diff.panelOnly.length}</div>
              </div>
              <div className="stat">
                <div className="label">مشترک</div>
                <div className="value num">{diff.matched}</div>
              </div>
              <div className="stat" style={{ borderColor: (diff.mismatched?.length ?? 0) ? "rgba(251,191,36,0.5)" : undefined }}>
                <div className="label">ناهمخوان</div>
                <div className="value num">{diff.mismatched?.length ?? 0}</div>
              </div>
              <div className="stat">
                <div className="label">فقط ربات</div>
                <div className="value num">{diff.botOnly.length}</div>
              </div>
              <div className="stat">
                <div className="label">کل پنل / ربات</div>
                <div className="value num" style={{ fontSize: "1rem" }}>
                  {diff.panelTotal} / {diff.botTotal}
                </div>
              </div>
            </div>

            {!diff.panelOnly.length && !diff.botOnly.length && !(diff.mismatched?.length ?? 0) ? (
              <p className="muted">پنل و ربات از نظر اکانت و فیلدهای کلیدی یکسان‌اند ({diff.matched} مشترک).</p>
            ) : null}

            {(diff.mismatched?.length ?? 0) > 0 && (
              <div className="list" style={{ marginBottom: 12 }}>
                <p style={{ margin: "0 0 8px", fontWeight: 650 }}>
                  فیلد ناهمخوان ({diff.mismatched!.length}) — با تیک «تاریخ انقضا / حجم» و اعمال، از منبع روی مقصد نوشته می‌شود
                </p>
                {diff.mismatched!.map((c) => {
                  const fieldLabels: Record<string, string> = {
                    expiry: "انقضا",
                    traffic: "حجم",
                    limitIp: "محدودیت IP",
                    enable: "فعال/غیرفعال",
                  };
                  return (
                    <div key={c.subId} className="row-card">
                      <strong className="num">{c.email}</strong>{" "}
                      <span className="badge warn">{c.fields.map((f) => fieldLabels[f] ?? f).join(" · ")}</span>
                      <div className="muted">
                        {c.code}
                        {c.fields.includes("expiry")
                          ? ` · انقضا پنل: ${c.panelExpiresAt ? new Date(c.panelExpiresAt).toLocaleDateString("fa-IR") : "—"} / ربات: ${new Date(c.botExpiresAt).toLocaleDateString("fa-IR")}${c.panelStartsOnConnect !== c.botStartsOnConnect ? " (شروع با اتصال متفاوت)" : ""}`
                          : ""}
                        {c.fields.includes("traffic")
                          ? ` · حجم پنل: ${c.panelTrafficGb != null ? `${c.panelTrafficGb} گیگ` : "∞"} / ربات: ${c.botTrafficGb != null ? `${c.botTrafficGb} گیگ` : "∞"}`
                          : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {diff.panelOnly.length > 0 && (
              <div className="list" style={{ marginBottom: 12 }}>
                <p style={{ margin: "0 0 8px", fontWeight: 650 }}>
                  فقط در پنل ({diff.panelOnly.length})
                </p>
                {diff.panelOnly.map((c) => (
                  <div key={c.email} className="row-card">
                    <strong className="num">{c.email}</strong> <span className="badge warn">فقط پنل</span>
                    <div className="muted">
                      {c.panelName}
                      {c.trafficGb != null ? ` · ${c.trafficGb} گیگ` : " · ∞ گیگ"}
                      {c.expiresAt ? ` · ${new Date(c.expiresAt).toLocaleDateString("fa-IR")}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {diff.botOnly.length > 0 && (
              <div className="list">
                <p style={{ margin: "0 0 8px", fontWeight: 650 }}>
                  فقط در ربات ({diff.botOnly.length})
                </p>
                {diff.botOnly.map((c) => (
                  <div key={c.subId} className="row-card">
                    <strong className="num">{c.email}</strong> <span className="badge bad">فقط ربات</span>
                    <div className="muted">
                      {c.code} · {c.ownerLabel}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={applyOpen} title="تأیید همگام‌سازی" onClose={() => setApplyOpen(false)}>
        <p style={{ marginTop: 0 }}>
          <strong>
            {sourceLabel} → {destLabel}
          </strong>
        </p>
        {direction === "bot_to_panel" && (
          <p style={{ marginTop: 0, color: "#fda4af" }}>
            مقصد پنل است؛ تنظیمات فعلی پنل برای فیلدهای انتخاب‌شده با دادهٔ ربات جایگزین می‌شود.
          </p>
        )}
        <p className="muted">گزینه‌ها:</p>
        <ul style={{ marginTop: 0 }}>
          {selectedOpts.map((o) => (
            <li key={o.key}>{o.label}</li>
          ))}
        </ul>
        {opts.newAccounts && (
          <p className="muted" style={{ marginBottom: 6 }}>
            اکانت‌های جدید در مقصد: {newCount == null ? "؟ (اول مقایسه کنید)" : newCount}
          </p>
        )}
        {opts.deletedAccounts && (
          <p className="muted" style={{ marginBottom: 6 }}>
            حذف از مقصد: {delCount == null ? "؟ (اول مقایسه کنید)" : delCount}
          </p>
        )}
        {diff && selectedOpts.some((o) => !["newAccounts", "deletedAccounts", "inbounds"].includes(o.key)) && (
          <p className="muted" style={{ marginBottom: 12 }}>
            فیلدهای مشترک برای حدود {diff.matched} اکانت از منبع روی مقصد نوشته می‌شود
            {(diff.mismatched?.length ?? 0) > 0
              ? ` (${diff.mismatched!.length} مورد الان ناهمخوان‌اند).`
              : "."}
          </p>
        )}
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={() => setApplyOpen(false)}>
            انصراف
          </button>
          <button type="button" className="btn success" onClick={() => void confirmApply()}>
            تأیید و اعمال
          </button>
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Bulk Adjust ---------------- */

function BulkNumStepper({
  value,
  onChange,
  disabled,
  allowNegative = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  allowNegative?: boolean;
}) {
  function parseNum(): number {
    const n = Number(String(value).trim().replace(/[^\d-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  function step(delta: number) {
    let next = parseNum() + delta;
    if (!allowNegative && next < 0) next = 0;
    onChange(String(next));
  }
  return (
    <div className={`bulk-stepper${disabled ? " is-disabled" : ""}`} dir="ltr">
      <button type="button" className="bulk-stepper-btn" disabled={disabled} onClick={() => step(-1)} aria-label="کم کردن">
        −
      </button>
      <input
        className="num"
        inputMode="numeric"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="bulk-stepper-btn" disabled={disabled} onClick={() => step(1)} aria-label="اضافه">
        +
      </button>
    </div>
  );
}

function BulkAdjustPanel({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  type PanelOpt = { id: string; name: string };
  type GroupOpt = { key: string; label: string; panelGroup: string | null; kind?: string };
  type Result = {
    updated: number;
    skipped: number;
    errors: number;
    clientCount: number;
    failed: Array<{ email: string; error: string }>;
    skipReasons: Array<{ email: string; reason: string }>;
  };

  const [panels, setPanels] = useState<PanelOpt[]>([]);
  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const [panelServerId, setPanelServerId] = useState("");
  const [panelGroup, setPanelGroup] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const [doInbounds, setDoInbounds] = useState(false);
  const [inboundIdsRaw, setInboundIdsRaw] = useState("1,2,3,4,5,6,7,8,9,10");

  const [doLimitIp, setDoLimitIp] = useState(false);
  const [limitIpValue, setLimitIpValue] = useState("2");

  const [doAddGb, setDoAddGb] = useState(false);
  const [addGb, setAddGb] = useState("1");

  const [doAddDays, setDoAddDays] = useState(false);
  const [addDays, setAddDays] = useState("1");

  const [clearExpiry, setClearExpiry] = useState(false);

  const agentGroups = groups.filter(
    (g) => g.panelGroup && (g.kind === "admin" || g.kind === "partner" || g.kind === "wholesale"),
  );

  useEffect(() => {
    void api<{ panels: Array<{ id: string; name: string }> }>("/admin/panels")
      .then((r) => setPanels((r.panels ?? []).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setPanels([]));
    void api<{ groups: GroupOpt[] }>("/admin/configs/groups")
      .then((r) => setGroups(r.groups ?? []))
      .catch(() => setGroups([]));
  }, []);

  async function refreshPreview() {
    try {
      const params = new URLSearchParams();
      if (panelServerId) params.set("panelServerId", panelServerId);
      if (panelGroup) params.set("panelGroup", panelGroup);
      const q = params.toString() ? `?${params}` : "";
      const r = await api<{ clientCount: number }>(`/admin/configs/bulk-adjust/preview${q}`);
      setPreviewCount(r.clientCount);
    } catch {
      setPreviewCount(null);
    }
  }

  useEffect(() => {
    void refreshPreview();
  }, [panelServerId, panelGroup]);

  function parseSigned(raw: string): number {
    const n = Number(String(raw).trim().replace(/[^\d-]/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  function scopeLabel(): string {
    const parts: string[] = [];
    parts.push(
      panelServerId
        ? `سرور «${panels.find((p) => p.id === panelServerId)?.name ?? "—"}»`
        : "همه پنل‌های فعال",
    );
    if (panelGroup) {
      const g = agentGroups.find((x) => x.panelGroup === panelGroup);
      parts.push(`گروه «${g?.label ?? panelGroup}»`);
    }
    return parts.join(" · ");
  }

  function summaryLines(): string[] {
    const lines: string[] = [];
    if (doAddGb) {
      const g = parseSigned(addGb);
      lines.push(`${g < 0 ? "کاهش" : "افزایش"} حجم: ${Math.abs(g)} گیگ`);
    }
    if (doAddDays && !clearExpiry) {
      const d = parseSigned(addDays);
      lines.push(`${d < 0 ? "کاهش" : "افزایش"} روز: ${Math.abs(d)}`);
    }
    if (doInbounds) lines.push(`اینباندها (جایگزینی): ${inboundIdsRaw.trim() || "—"}`);
    if (doLimitIp) lines.push(`محدودیت کاربر (IP Limit): ${limitIpValue}`);
    if (clearExpiry) lines.push("حذف تاریخ انقضا (نامحدود)");
    return lines;
  }

  function openApply() {
    if (!doInbounds && !doLimitIp && !doAddGb && !doAddDays && !clearExpiry) {
      flash(null, "حداقل یک عملیات را انتخاب کنید");
      return;
    }
    if (doInbounds && !inboundIdsRaw.trim()) {
      flash(null, "شناسه اینباند را وارد کنید");
      return;
    }
    if (doAddGb && parseSigned(addGb) === 0) {
      flash(null, "مقدار حجم نمی‌تواند صفر باشد");
      return;
    }
    if (doAddDays && !clearExpiry && parseSigned(addDays) === 0) {
      flash(null, "مقدار روز نمی‌تواند صفر باشد");
      return;
    }
    void refreshPreview().then(() => setApplyOpen(true));
  }

  async function confirmApply() {
    setApplyOpen(false);
    const n = previewCount ?? "؟";
    if (
      !(await askConfirm(
        `تغییر دسته‌جمعی روی ${n} اکانت (${scopeLabel()}) اعمال شود؟\n\n${summaryLines().join("\n")}`,
      ))
    ) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        panelServerId: panelServerId || null,
        panelGroup: panelGroup || null,
        clearExpiry,
      };
      if (doInbounds) {
        body.inbounds = { idsRaw: inboundIdsRaw.trim() };
      }
      if (doLimitIp) {
        body.limitIp = { value: Number(limitIpValue.replace(/[^\d]/g, "") || "0") };
      }
      if (doAddGb) body.addGb = parseSigned(addGb);
      if (doAddDays && !clearExpiry) body.addDays = parseSigned(addDays);

      const r = await api<Result>("/admin/configs/bulk-adjust", { method: "POST", body });
      setResult(r);
      flash(
        `انجام شد: ${r.updated} به‌روز · ${r.skipped} ردشده · ${r.errors} خطا (از ${r.clientCount})`,
      );
      await refreshPreview();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="bulk-adjust">
        <p className="muted" style={{ marginTop: 0 }}>
          اعمال همزمان اینباند، محدودیت کاربر، حجم، روز یا حذف انقضا روی کانفیگ‌های پنل 3x-ui (نه فقط دیتابیس ربات).
        </p>

        <div className="bulk-toolbar">
          <div className="bulk-toolbar-fields">
            <div className="field">
              <label>محدوده سرور</label>
              <select value={panelServerId} onChange={(e) => setPanelServerId(e.target.value)}>
                <option value="">همه پنل‌های فعال</option>
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>
                گروه همکار / ادمین / همکار ویژه / عمده‌فروش (
                <span className="num">{previewCount == null ? "…" : previewCount}</span>)
              </label>
              <select value={panelGroup} onChange={(e) => setPanelGroup(e.target.value)}>
                <option value="">همه گروه‌ها</option>
                {agentGroups.map((g) => (
                  <option key={g.key} value={g.panelGroup ?? ""}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" className="btn danger bulk-scope-run" disabled={busy} onClick={openApply}>
            {busy ? "در حال اعمال…" : "اجرای تغییر دسته‌جمعی"}
          </button>
        </div>

        <div className="bulk-cols">
          <div className={`bulk-op bulk-op--gb${doAddGb ? " is-on" : ""}`}>
            <label className="bulk-op-head">
              <input type="checkbox" checked={doAddGb} onChange={(e) => setDoAddGb(e.target.checked)} />
              <span>افزایش یا کاهش حجم باقیمانده (GB)</span>
            </label>
            <BulkNumStepper value={addGb} onChange={setAddGb} disabled={!doAddGb} allowNegative />
            <p className="muted bulk-op-hint">عدد منفی = کاهش · اکانت‌های نامحدود رد می‌شوند.</p>
          </div>

          <div className={`bulk-op bulk-op--days${doAddDays ? " is-on" : ""}${clearExpiry ? " is-blocked" : ""}`}>
            <label className="bulk-op-head">
              <input
                type="checkbox"
                checked={doAddDays}
                disabled={clearExpiry}
                onChange={(e) => setDoAddDays(e.target.checked)}
              />
              <span>افزایش یا کاهش روزهای باقیمانده</span>
            </label>
            <BulkNumStepper
              value={addDays}
              onChange={setAddDays}
              disabled={!doAddDays || clearExpiry}
              allowNegative
            />
            <p className="muted bulk-op-hint">عدد منفی = کاهش روز.</p>
          </div>

          <div className={`bulk-op bulk-op--inbounds${doInbounds ? " is-on" : ""}`}>
            <label className="bulk-op-head">
              <input type="checkbox" checked={doInbounds} onChange={(e) => setDoInbounds(e.target.checked)} />
              <span>اینباندها</span>
            </label>
            <div className="field">
              <input
                dir="ltr"
                className="num"
                disabled={!doInbounds}
                value={inboundIdsRaw}
                onChange={(e) => setInboundIdsRaw(e.target.value)}
                placeholder="1,2,3"
              />
              <p className="muted bulk-op-hint">اینباندهای فعال. با ویرگول جدا کنید. مثال: 1,2,3</p>
            </div>
          </div>

          <div className={`bulk-op bulk-op--limit${doLimitIp ? " is-on" : ""}`}>
            <label className="bulk-op-head">
              <input type="checkbox" checked={doLimitIp} onChange={(e) => setDoLimitIp(e.target.checked)} />
              <span>محدودیت کاربر (IP Limit)</span>
            </label>
            <BulkNumStepper value={limitIpValue} onChange={setLimitIpValue} disabled={!doLimitIp} />
            <p className="muted bulk-op-hint">مقدار ۰ = نامحدود (دستگاه)</p>
          </div>

          <div className={`bulk-op bulk-op--clear${clearExpiry ? " is-on" : ""}`}>
            <label className="bulk-op-head">
              <input
                type="checkbox"
                checked={clearExpiry}
                onChange={(e) => {
                  setClearExpiry(e.target.checked);
                  if (e.target.checked) setDoAddDays(false);
                }}
              />
              <span>حذف تاریخ انقضا (نامحدود کردن تاریخ)</span>
            </label>
          </div>
        </div>
      </div>

      {result && (
        <div className="bulk-adjust-result">
          <h3>نتیجه</h3>
          <p>
            به‌روز: <strong className="num">{result.updated}</strong>
            {" · "}
            ردشده: <strong className="num">{result.skipped}</strong>
            {" · "}
            خطا: <strong className="num">{result.errors}</strong>
            {" · "}
            کل: <strong className="num">{result.clientCount}</strong>
          </p>
          {result.skipReasons.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <strong>ردشده‌ها</strong>
              <ul className="muted" style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                {result.skipReasons.slice(0, 30).map((s) => (
                  <li key={`s-${s.email}`}>
                    <span className="num">{s.email}</span> — {s.reason}
                  </li>
                ))}
                {result.skipReasons.length > 30 && <li>… و {result.skipReasons.length - 30} مورد دیگر</li>}
              </ul>
            </div>
          )}
          {result.failed.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <strong>خطاها</strong>
              <ul className="muted" style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                {result.failed.slice(0, 30).map((f) => (
                  <li key={`f-${f.email}`}>
                    <span className="num">{f.email}</span> — {f.error}
                  </li>
                ))}
                {result.failed.length > 30 && <li>… و {result.failed.length - 30} مورد دیگر</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <Modal open={applyOpen} title="تأیید تغییر دسته‌جمعی" onClose={() => setApplyOpen(false)}>
        <p style={{ marginTop: 0 }}>
          حدود <strong className="num">{previewCount ?? "؟"}</strong> اکانت روی {scopeLabel()} تغییر می‌کنند.
        </p>
        <ul style={{ margin: "0 0 12px", paddingInlineStart: 18 }}>
          {summaryLines().map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          این عملیات برگشت خودکار (Undo) ندارد. قبل از اجرا از صحت گزینه‌ها مطمئن شوید.
        </p>
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={() => setApplyOpen(false)}>
            انصراف
          </button>
          <button type="button" className="btn danger" onClick={() => void confirmApply()}>
            تأیید و اجرا
          </button>
        </div>
      </Modal>
    </>
  );
}

function ConfigsTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  const [bulkOpen, setBulkOpen] = useState<string | null>(null);
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
      note?: string | null;
    }>
  >([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [sort, setSort] = useState<ListSort>("newest");
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
  const [importBusy, setImportBusy] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [renewInfo, setRenewInfo] = useState<RenewInfo | null>(null);
  const [qrSub, setQrSub] = useState<{ url: string; title: string } | null>(null);

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
      const r = await api<{ items: typeof items; total: number; pageSize?: number }>(
        `/admin/configs/${groupKey}?page=${page}&pageSize=${pageSize}&sort=${sort}${q}`,
      );
      setItems(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [groupKey, page, pageSize, sort, searchQ]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doImport(emails: string[]) {
    if (!emails.length) {
      flash(null, "اکانتی برای وارد کردن انتخاب نشده");
      return;
    }
    if (
      !(await askConfirm(
        `${emails.length} اکانت از پنل وارد دیتابیس ربات شود؟\nمالک همهٔ آن‌ها ادمین خواهد بود.`,
      ))
    ) {
      return;
    }
    setImportBusy(true);
    try {
      const r = await api<{
        imported: number;
        skipped: number;
        failed: Array<{ email: string; error: string }>;
        ownerLabel: string;
      }>("/admin/configs/import", { body: { emails } });
      const failNote = r.failed.length ? ` · ${r.failed.length} ناموفق` : "";
      flash(
        `${r.imported} وارد شد برای ${r.ownerLabel}${r.skipped ? ` · ${r.skipped} رد شد` : ""}${failNote}`,
      );
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setImportBusy(false);
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
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function toggleEnable(email: string, subId: string | null, currentlyActive: boolean) {
    const next = !currentlyActive;
    const label = next ? "فعال" : "غیرفعال";
    if (!(await askConfirm(`اکانت ${email} ${label} شود؟`))) return;
    setEditBusy(true);
    try {
      const r = await api<{ message: string }>("/admin/configs/update", {
        method: "PUT",
        body: { email, subId, enable: next },
      });
      flash(r.message || `اکانت ${label} شد`);
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function copySubLink(c: { subUrl?: string | null; email: string }) {
    if (!c.subUrl) {
      flash(null, "لینک اشتراک موجود نیست");
      return;
    }
    await navigator.clipboard.writeText(c.subUrl);
    flash("لینک اشتراک کپی شد");
  }

  async function rotateSubLink(email: string, subId: string | null) {
    if (!subId) {
      flash(null, "این اکانت در دیتابیس ربات نیست");
      return;
    }
    if (!(await askConfirm("با تغییر لینک ساب، اتصال فعلی قطع می‌شود. ادامه می‌دهید؟"))) return;
    setEditBusy(true);
    try {
      const r = await api<{ subUrl?: string | null }>("/admin/configs/rotate-sub", {
        method: "POST",
        body: { email, subId },
      });
      if (r.subUrl) {
        await navigator.clipboard.writeText(r.subUrl);
        flash("لینک ساب جدید ساخته و کپی شد");
      } else {
        flash("لینک ساب جدید ساخته شد");
      }
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function refreshFromPanel(email: string, subId: string | null) {
    if (!subId) {
      flash(null, "این اکانت در دیتابیس ربات نیست");
      return;
    }
    setEditBusy(true);
    try {
      const r = await api<{ changed: string[]; email: string }>("/admin/configs/refresh-from-panel", {
        method: "POST",
        body: { email, subId },
      });
      flash(
        r.changed.length
          ? `بروزرسانی شد: ${r.changed.join("، ")}`
          : "اطلاعات با پنل یکسان بود",
      );
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function openRenew(subId: string | null) {
    if (!subId) {
      flash(null, "این اکانت در دیتابیس ربات نیست");
      return;
    }
    setEditBusy(true);
    try {
      const info = await api<RenewInfo>(`/admin/configs/renew?subId=${encodeURIComponent(subId)}`);
      setRenewInfo(info);
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function submitAdminRenew(payload: {
    trafficGb: number | null;
    months: number;
    category: string;
    payWithWallet: boolean;
  }) {
    if (!renewInfo) return;
    setEditBusy(true);
    try {
      await api("/admin/configs/renew", {
        method: "POST",
        body: {
          subId: renewInfo.subscription.id,
          trafficGb: payload.trafficGb,
          months: payload.months,
          category: payload.category,
        },
      });
      setRenewInfo(null);
      flash("سرویس تمدید شد ✅");
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <>
      <SettingsAccordion
        id="bulk"
        title="تغییر دسته‌جمعی"
        icon="layers"
        openId={bulkOpen}
        onToggle={(id) => setBulkOpen((cur) => (cur === id ? null : id))}
      >
        <BulkAdjustPanel flash={flash} askConfirm={askConfirm} />
      </SettingsAccordion>

      <div className="panel">
        <h2>اکانت‌ها</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          اکانت‌های دیتابیس ربات به‌همراه کلاینت‌های زنده‌ی 3x-ui. اگر فقط روی پنل ساخته شده باشند با برچسب «فقط پنل» دیده می‌شوند.
        </p>
        <div className="configs-filters">
          <div className="field">
            <label>جستجو (ایمیل، کد، مالک، نوت، عنوان)</label>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="مثلاً email یا کد یا نوت"
            />
          </div>
          <div className="field">
            <label htmlFor="admin-config-group">گروه پنل</label>
            <select
              id="admin-config-group"
              value={groupKey}
              onChange={(e) => {
                setGroupKey(e.target.value);
                setPage(0);
              }}
            >
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="admin-config-sort">مرتب‌سازی</label>
            <select
              id="admin-config-sort"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as ListSort);
                setPage(0);
              }}
            >
              <option value="newest">از جدید به قدیم</option>
              <option value="oldest">از قدیم به جدید</option>
              <option value="ending">اتمام حجم یا تاریخ</option>
              <option value="ending_date">نزدیک‌ترین انقضا</option>
              <option value="ending_traffic">کمترین حجم باقی‌مانده</option>
            </select>
          </div>
        </div>
        {loading && <p className="muted">در حال دریافت…</p>}
        <div className="list configs-list">
          {items.map((c) => {
            const expired = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
            return (
              <div key={c.email} className="row-card row-card--stack">
                <div>
                  <div className="config-card-head">
                    <div className="config-card-head__meta">
                      <strong className="num">{c.email}</strong>{" "}
                      {!c.inDb && <span className="badge warn">فقط پنل</span>}
                      {c.status === "active" && !expired && <span className="badge ok">فعال</span>}
                      {(c.status === "disabled" || expired) && (
                        <span className="badge warn">{expired ? "منقضی" : "غیرفعال"}</span>
                      )}
                    </div>
                    {c.inDb && c.subUrl && (
                      <button
                        type="button"
                        className="btn ghost sm config-qr-btn"
                        disabled={editBusy}
                        title="نمایش QR"
                        aria-label="نمایش QR"
                        onClick={() => setQrSub({ url: c.subUrl!, title: c.email })}
                      >
                        QR
                      </button>
                    )}
                  </div>
                  {c.title && c.title !== c.email && <div className="muted">{c.title}</div>}
                  {c.note && (
                    <div className="muted" style={{ marginTop: 4 }}>
                      نوت: {c.note}
                    </div>
                  )}
                  {c.code && <div className="muted num">کد: {c.code}</div>}
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
                <div className="config-card-actions">
                  <div className="config-card-actions-row">
                    {!c.inDb && (
                      <button type="button" className="btn success sm" disabled={importBusy} onClick={() => void doImport([c.email])}>
                        وارد کردن
                      </button>
                    )}
                    {c.inDb && c.subId && (
                      <button type="button" className="btn success sm" disabled={editBusy} onClick={() => void openRenew(c.subId)}>
                        تمدید
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn sm ${c.status === "active" && !expired ? "ghost" : "success"}`}
                      disabled={editBusy || expired}
                      onClick={() => void toggleEnable(c.email, c.subId, c.status === "active")}
                    >
                      {c.status === "active" && !expired ? "غیرفعال" : "فعال"}
                    </button>
                    <button type="button" className="btn primary sm" disabled={editBusy} onClick={() => void startEdit(c.email, c.subId)}>
                      ویرایش
                    </button>
                    <button type="button" className="btn danger sm" onClick={() => void remove(c.email, c.subId)}>
                      حذف
                    </button>
                  </div>
                  {c.inDb && c.subId && (
                    <div className="config-card-actions-row sub-links">
                      <button type="button" className="btn primary sm" disabled={editBusy || !c.subUrl} onClick={() => void copySubLink(c)}>
                        کپی لینک
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        disabled={editBusy}
                        onClick={() => void refreshFromPanel(c.email, c.subId)}
                      >
                        بروزرسانی
                      </button>
                      <button type="button" className="btn ghost sm" disabled={editBusy} onClick={() => void rotateSubLink(c.email, c.subId)}>
                        لینک جدید
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!items.length && !loading && <p className="muted">اکانتی در این گروه نیست.</p>}
        </div>
        {total > 0 && (
          <div className="config-pager">
            <div className="actions config-pager-nav">
              <button type="button" className="btn ghost sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                قبلی
              </button>
              <span className="muted" style={{ alignSelf: "center" }}>
                صفحه {page + 1} از {Math.max(1, Math.ceil(total / pageSize))}
              </span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={(page + 1) * pageSize >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </button>
            </div>
            <div className="sort-bar config-page-size">
              <label htmlFor="admin-config-page-size">تعداد نمایش اکانت در هر صفحه</label>
              <select
                id="admin-config-page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                {CONFIG_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <Modal open title={`ویرایش اکانت — ${editing.email}`} onClose={() => setEditing(null)} wide>
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
            <div className="expiry-quick-row">
              <input
                type="datetime-local"
                dir="ltr"
                value={editForm.expiresAt}
                onChange={(e) => setEditForm((s) => ({ ...s, expiresAt: e.target.value }))}
              />
              <div className="chip-row expiry-quick-chips">
                <button
                  type="button"
                  className="chip chip-sm"
                  onClick={() => setEditForm((s) => ({ ...s, expiresAt: expiryFromNow({ weeks: 1 }) }))}
                >
                  ۱ هفته
                </button>
                <button
                  type="button"
                  className="chip chip-sm"
                  onClick={() => setEditForm((s) => ({ ...s, expiresAt: expiryFromNow({ months: 1 }) }))}
                >
                  ۱ ماه
                </button>
                <button
                  type="button"
                  className="chip chip-sm"
                  onClick={() => setEditForm((s) => ({ ...s, expiresAt: expiryFromNow({ months: 2 }) }))}
                >
                  ۲ ماه
                </button>
                <button
                  type="button"
                  className="chip chip-sm"
                  onClick={() => setEditForm((s) => ({ ...s, expiresAt: expiryFromNow({ months: 3 }) }))}
                >
                  ۳ ماه
                </button>
              </div>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.78rem" }}>
              انتخاب سریع از تاریخ امروز
            </p>
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

      <RenewModal
        open={Boolean(renewInfo)}
        info={renewInfo}
        busy={editBusy}
        variant="admin"
        onClose={() => setRenewInfo(null)}
        onSubmit={submitAdminRenew}
      />

      <SubQrModal
        open={Boolean(qrSub)}
        title={qrSub ? `QR — ${qrSub.title}` : "QR اشتراک"}
        subUrl={qrSub?.url}
        onClose={() => setQrSub(null)}
      />
    </>
  );
}

/* ---------------- Panels ---------------- */

function pickPanelForCategory(panels: PanelRow[], catKey: string): string {
  const owning = panels.filter((p) => parseCats(p.categories).includes(catKey));
  const preferred = owning.find((p) => p.active && p.sellEnabled) || owning[0] || panels[0];
  return preferred?.id || "";
}

function buildRouteMap(panels: PanelRow[], categories: Array<{ key: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of categories) {
    map[c.key] = pickPanelForCategory(panels, c.key);
  }
  return map;
}

function PanelsTab({ flash, askConfirm }: { flash: Flash; askConfirm: AskConfirm }) {
  const [panels, setPanels] = useState<PanelRow[]>([]);
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [form, setForm] = useState({ name: "", baseUrl: "", apiToken: "", inboundIds: "1" });
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routeMap, setRouteMap] = useState<Record<string, string>>({});
  const [savedRouteMap, setSavedRouteMap] = useState<Record<string, string>>({});
  const [routeReady, setRouteReady] = useState(false);
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

  useEffect(() => {
    if (!panels.length || !categories.length) return;
    const next = buildRouteMap(panels, categories);
    setRouteMap((prev) => {
      if (!routeReady) return next;
      const merged = { ...next };
      for (const c of categories) {
        const cur = prev[c.key];
        if (cur && panels.some((p) => p.id === cur)) merged[c.key] = cur;
      }
      return merged;
    });
    if (!routeReady) {
      setSavedRouteMap(next);
      setRouteReady(true);
    }
  }, [panels, categories, routeReady]);

  const routeDirty =
    routeReady &&
    categories.some((c) => (routeMap[c.key] || "") !== (savedRouteMap[c.key] || ""));

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
      flash("ذخیره شد");
      setEditing(null);
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function add() {
    try {
      await api("/admin/panels", { body: form });
      flash("سرور اضافه شد");
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

  async function removePanel(p: PanelRow) {
    if (panels.length <= 1) {
      flash(null, "حداقل یک سرور باید باقی بماند");
      return;
    }
    const ok = await askConfirm(
      `حذف سرور «${p.name}»؟\nاین کار فقط وقتی ممکن است که هیچ اشتراکی روی این سرور نباشد.`,
    );
    if (!ok) return;
    try {
      await api(`/admin/panels/${p.id}`, { method: "DELETE" });
      flash("سرور حذف شد");
      if (editing?.id === p.id) setEditing(null);
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  function cancelRoute() {
    setRouteMap({ ...savedRouteMap });
  }

  async function saveRoute() {
    if (!panels.length || !categories.length) return;
    setRoutingBusy(true);
    try {
      for (const p of panels) {
        const nextCats = categories.filter((c) => routeMap[c.key] === p.id).map((c) => c.key);
        await api(`/admin/panels/${p.id}`, {
          method: "PUT",
          body: { categories: nextCats },
        });
      }
      setSavedRouteMap({ ...routeMap });
      flash("اختصاص پلن‌ها ذخیره شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setRoutingBusy(false);
    }
  }

  const canDelete = panels.length > 1;

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>سرورها</h2>
          <button type="button" className="btn success sm" onClick={() => setShowAddPanel(true)}>
            افزودن سرور جدید
          </button>
        </div>

        {!!panels.length && !!categories.length && (
          <div className="panel-route-card">
            <div className="panel-route-title">اختصاص پلن به سرور</div>
            <p className="panel-route-desc">برای هر پلن، سرور مقصد را انتخاب کنید. با ذخیره، هر پلن فقط روی سرور خودش فعال می‌ماند.</p>
            <div className="panel-route-list">
              {categories.map((c) => (
                <div key={c.key} className="panel-route-row">
                  <div className="panel-route-plan" title={c.label}>
                    {c.label}
                  </div>
                  <select
                    className="combo-select"
                    value={routeMap[c.key] || ""}
                    onChange={(e) => setRouteMap((s) => ({ ...s, [c.key]: e.target.value }))}
                    disabled={routingBusy}
                  >
                    {panels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {!p.active ? " (غیرفعال)" : ""}
                        {!p.sellEnabled ? " (فروش خاموش)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="panel-route-actions">
              <button type="button" className="btn ghost" disabled={!routeDirty || routingBusy} onClick={cancelRoute}>
                لغو
              </button>
              <button type="button" className="btn primary" disabled={!routeDirty || routingBusy} onClick={() => void saveRoute()}>
                {routingBusy ? "…" : "ذخیره"}
              </button>
            </div>
          </div>
        )}

        <div className="list" style={{ marginTop: 12 }}>
          {panels.map((p) => {
            const cats = parseCats(p.categories);
            const catBadges = cats.map((k) => {
              const siblings = panels.filter(
                (x) => x.id !== p.id && parseCats(x.categories).includes(k) && x.active && x.sellEnabled,
              );
              return { key: k, label: catLabel(k, categories), shared: siblings.length > 0 };
            });
            return (
              <div key={p.id} className="row-card row-card--stack server-card" onClick={() => openEdit(p)}>
                <div className="server-card__top">
                  <strong className="server-card__name" dir="ltr">
                    {p.name}
                  </strong>
                  <div className="muted num url-break server-card__url">{p.baseUrl}</div>
                  <div className="muted server-card__meta">
                    اینباند: <span className="num">{p.inboundIds}</span> · توکن {p.hasToken ? "✓" : "✗"}
                    {p.weight != null && (
                      <>
                        {" "}
                        · وزن <span className="num">{p.weight}</span>
                      </>
                    )}
                  </div>
                  {cats.length > 0 ? (
                    <div className="server-card__cats">
                      {catBadges.map(({ key, label, shared }) => (
                        <span
                          key={key}
                          className={`badge ${shared ? "info" : "ok"}`}
                          title={shared ? "لودبالانس — این دسته روی چند سرور است" : "اختصاصی — فقط این سرور"}
                        >
                          {label}
                          <span className="server-card__cat-mark" aria-hidden>
                            {shared ? "⇄" : "⊕"}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="badge bad">بدون دسته</span>
                  )}
                </div>
                <div className="server-card__footer" onClick={(e) => e.stopPropagation()}>
                  <div className="server-card__actions">
                    <label className="server-card__toggle">
                      <span className="server-card__toggle-label">فعال</span>
                      <span className="switch switch-sm">
                        <input type="checkbox" checked={p.active} onChange={(e) => toggle(p, "active", e.target.checked)} />
                        <span className="track" />
                      </span>
                    </label>
                    <label className="server-card__toggle">
                      <span className="server-card__toggle-label">فروش</span>
                      <span className="switch switch-sm">
                        <input
                          type="checkbox"
                          checked={p.sellEnabled}
                          onChange={(e) => toggle(p, "sellEnabled", e.target.checked)}
                        />
                        <span className="track" />
                      </span>
                    </label>
                    <button type="button" className="btn ghost sm" onClick={() => openEdit(p)}>
                      ویرایش
                    </button>
                    <button type="button" className="btn ghost sm" onClick={() => void test(p.id)}>
                      تست
                    </button>
                    {canDelete ? (
                      <button type="button" className="btn danger sm" onClick={() => void removePanel(p)}>
                        حذف
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {!panels.length && <p className="muted">سروری ثبت نشده — از .env استفاده می‌شود.</p>}
        </div>
      </div>

      {editing && (
        <Modal open title={`ویرایش سرور — ${editing.name}`} onClose={() => setEditing(null)} wide>
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
            <button type="button" className="btn ghost" onClick={() => void test(editing.id)}>
              تست اتصال
            </button>
            {canDelete ? (
              <button type="button" className="btn danger" onClick={() => void removePanel(editing)}>
                حذف سرور
              </button>
            ) : null}
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              لغو
            </button>
          </div>
        </Modal>
      )}

      {showAddPanel && (
        <Modal open title="افزودن سرور جدید" onClose={() => setShowAddPanel(false)} wide>
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
              افزودن سرور
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
  { key: "support_username", label: "یوزرنیم پشتیبانی (بدون @)", ltr: true },
  { key: "miniapp_url", label: "آدرس مینی‌اپ", ltr: true },
  { key: "welcome_text", label: "متن خوش‌آمد ربات", multiline: true },
];

type PayMethodsState = {
  card: { enabled: boolean };
  wallet: { enabled: boolean };
  online: { enabled: boolean; provider: string | null };
  crypto: { enabled: boolean; asset: string; network: string; address: string; note: string };
};

function defaultPayMethods(): PayMethodsState {
  return {
    card: { enabled: true },
    wallet: { enabled: true },
    online: { enabled: false, provider: null },
    crypto: { enabled: false, asset: "USDT", network: "TRC20", address: "", note: "" },
  };
}

function parsePayMethods(raw: string | undefined): PayMethodsState {
  const base = defaultPayMethods();
  try {
    const p = JSON.parse(raw || "{}") as Partial<PayMethodsState>;
    return {
      card: { enabled: p.card?.enabled !== false },
      wallet: { enabled: p.wallet?.enabled !== false },
      online: { enabled: Boolean(p.online?.enabled), provider: p.online?.provider ?? null },
      crypto: {
        enabled: Boolean(p.crypto?.enabled),
        asset: p.crypto?.asset || "USDT",
        network: p.crypto?.network || "TRC20",
        address: p.crypto?.address || "",
        note: p.crypto?.note || "",
      },
    };
  } catch {
    return base;
  }
}

function clonePayMethods(m: PayMethodsState): PayMethodsState {
  return parsePayMethods(JSON.stringify(m));
}

/** Format setting numbers with en-US thousand separators (up to 3 fraction digits). */
function formatSettingNumber(raw: unknown, fallback = 0): string {
  const n = parseSettingNumber(raw, fallback);
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** Parse a setting number from user input (strips commas); up to 3 fraction digits. */
function parseSettingNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw ?? "")
    .replace(/,/g, "")
    .trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

const SETTINGS_DEFAULTS: Record<string, string> = {
  brand_name: "پیـنگ",
  support_username: "",
  miniapp_url: "",
  welcome_text: `سلام به ربات پینگ خوش اومدی 🌸
ما اینجاییم تا شما را بدون هیچ محدویتی به شبکه جهانی متصل کنیم ❤️

✅ کیفیت بالا در انواع کانکشن ها
📡 برقرای امنیت در ارتباط
🇮🇷 سرویس ویژه اینترنت ملی
☎️ پشتیبانی تا لحظه آخر`,
  card_number: "6037-0000-0000-0000",
  card_holder: "Card Holder",
  emoji_style: "universal",
  ui_skin: "classic",
  ui_color_mode: "system",
  serverless_enabled: "false",
  serverless_price_per_gb: "10000",
  serverless_price_per_month: "30000",
  serverless_weekly_min_gb: "1",
  serverless_weekly_max_gb: "10",
  serverless_monthly_min_gb: "10",
  serverless_monthly_max_gb: "100",
  serverless_weekly_enabled: "true",
  serverless_month1_enabled: "true",
  serverless_month2_enabled: "true",
  test_service_enabled: "true",
  discount_codes_enabled: "false",
  discount_max_percent: "30",
  default_limit_ip: "2",
  max_purchase_months: "1",
  web_session_hours: "168",
};

const GUIDE_PLATFORMS = [
  { id: "android", label: "اندروید", textKey: "guide_android_text", urlKey: "guide_android_url" },
  { id: "ios", label: "آیفون", textKey: "guide_ios_text", urlKey: "guide_ios_url" },
  { id: "windows", label: "ویندوز", textKey: "guide_windows_text", urlKey: "guide_windows_url" },
  { id: "macos", label: "مک", textKey: "guide_macos_text", urlKey: "guide_macos_url" },
] as const;

function SettingsTab({
  flash,
  askConfirm,
  hasPassword,
  onPasswordSaved,
}: {
  flash: Flash;
  askConfirm: AskConfirm;
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
  const [backupFiles, setBackupFiles] = useState<
    Array<{ name: string; sizeLabel: string; mtime: string; kind: string }>
  >([]);
  const [backupFilesOpen, setBackupFilesOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreInspect, setRestoreInspect] = useState<{
    sizeLabel: string;
    users?: number;
    orders?: number;
    subscriptions?: number;
    discountCodes?: number;
    note?: string;
  } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [notif, setNotif] = useState<{
    expiryDays: { enabled: boolean; hours: number };
    traffic: { enabled: boolean; megabytes: number };
    preDelete: { enabled: boolean; hours: number };
    deleted: { enabled: boolean };
  } | null>(null);
  const [notifBusy, setNotifBusy] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [payMethods, setPayMethods] = useState<PayMethodsState>(defaultPayMethods);
  const [baselineSettings, setBaselineSettings] = useState<Record<string, string>>({});
  const [baselinePayMethods, setBaselinePayMethods] = useState<PayMethodsState>(defaultPayMethods);
  const [saveBusy, setSaveBusy] = useState(false);

  function toggleSection(id: string) {
    setOpenSection((cur) => (cur === id ? null : id));
  }

  useEffect(() => {
    void api<{ settings: Record<string, string> }>("/admin/settings").then((r) => {
      const nextSettings = { ...r.settings };
      const nextPay = parsePayMethods(r.settings.payment_methods_json);
      setSettings(nextSettings);
      setBaselineSettings({ ...nextSettings });
      setPayMethods(nextPay);
      setBaselinePayMethods(clonePayMethods(nextPay));
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
      files?: Array<{ name: string; sizeLabel: string; mtime: string; kind: string }>;
    }>("/admin/backup").then((r) => {
      setBackup(r.config);
      setBackupFiles(r.files ?? []);
    });
    void api<{ config: NonNullable<typeof notif> }>("/admin/notifications").then((r) => setNotif(r.config));
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

  /** Immediate API save for guide modal (and similar); also updates baselines. */
  async function save(patch: Record<string, string>) {
    try {
      await api("/admin/settings", { method: "PUT", body: patch });
      setSettings((s) => ({ ...s, ...patch }));
      setBaselineSettings((s) => ({ ...s, ...patch }));
      if (patch.payment_methods_json) {
        const nextPay = parsePayMethods(patch.payment_methods_json);
        setPayMethods(nextPay);
        setBaselinePayMethods(clonePayMethods(nextPay));
      }
      flash("تنظیمات ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function persistDraft() {
    setSaveBusy(true);
    try {
      const skinChanged =
        (settings.ui_skin ?? "classic") !== (baselineSettings.ui_skin ?? "classic") ||
        (settings.ui_color_mode ?? "system") !== (baselineSettings.ui_color_mode ?? "system");
      const patch: Record<string, string> = {
        ...settings,
        payment_methods_json: JSON.stringify(payMethods),
      };
      await api("/admin/settings", { method: "PUT", body: patch });
      setSettings(patch);
      setBaselineSettings({ ...patch });
      setBaselinePayMethods(clonePayMethods(payMethods));
      if (skinChanged) {
        const skin = parseUiSkin(patch.ui_skin);
        const mode = parseColorMode(patch.ui_color_mode);
        setUserColorOverride(null);
        broadcastAppearance(skin, mode);
      }
      flash("تنظیمات ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setSaveBusy(false);
    }
  }

  function revertDraft() {
    setSettings({ ...baselineSettings });
    setPayMethods(clonePayMethods(baselinePayMethods));
    flash("تغییرات لغو شد");
  }

  function applyDefaultsDraft() {
    setSettings((s) => ({ ...s, ...SETTINGS_DEFAULTS }));
    setPayMethods(defaultPayMethods());
    flash("مقادیر پیش‌فرض اعمال شد — برای ذخیره دکمهٔ ذخیره را بزنید");
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
      const r = await api<{
        config: typeof backup;
        files?: Array<{ name: string; sizeLabel: string; mtime: string; kind: string }>;
      }>("/admin/backup", {
        method: "PUT",
        body: { ...backup, ...patch },
      });
      setBackup(r.config);
      if (r.files) setBackupFiles(r.files);
      flash("تنظیمات پشتیبان ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBackupBusy(false);
    }
  }

  async function saveNotif(patch: Partial<NonNullable<typeof notif>>) {
    if (!notif) return;
    setNotifBusy(true);
    try {
      const body = {
        expiryDays: { ...notif.expiryDays, ...patch.expiryDays },
        traffic: { ...notif.traffic, ...patch.traffic },
        preDelete: { ...notif.preDelete, ...patch.preDelete },
        deleted: { ...notif.deleted, ...patch.deleted },
      };
      const r = await api<{ config: NonNullable<typeof notif> }>("/admin/notifications", {
        method: "PUT",
        body,
      });
      setNotif(r.config);
      flash("تنظیمات اعلان‌ها ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setNotifBusy(false);
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
        const refreshed = await api<{
          config: NonNullable<typeof backup>;
          files?: Array<{ name: string; sizeLabel: string; mtime: string; kind: string }>;
        }>("/admin/backup");
        setBackup(refreshed.config);
        setBackupFiles(refreshed.files ?? []);
      } else {
        flash(null, r.error || "ارسال پشتیبان ناموفق بود");
      }
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBackupBusy(false);
    }
  }

  async function pickRestoreFile(file: File | null) {
    setRestoreFile(file);
    setRestoreInspect(null);
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".db") && !name.endsWith(".sqlite") && !name.endsWith(".sqlite3")) {
      flash(null, "فرمت باید .db باشد");
      setRestoreFile(null);
      return;
    }
    setBackupBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{
        ok: boolean;
        sizeLabel: string;
        users?: number;
        orders?: number;
        subscriptions?: number;
        discountCodes?: number;
        note?: string;
      }>("/admin/backup/inspect", { method: "POST", rawBody: fd });
      setRestoreInspect(r);
    } catch (e) {
      setRestoreFile(null);
      flash(null, errText(e));
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreBackupFile() {
    const file = restoreFile;
    if (!file) {
      flash(null, "ابتدا فایل پشتیبان را انتخاب کنید");
      return;
    }
    if (!restoreInspect) {
      flash(null, "ابتدا فایل را بررسی کنید");
      return;
    }
    const summary = [
      `فایل «${file.name}» (${restoreInspect.sizeLabel})`,
      restoreInspect.users != null ? `کاربر: ${restoreInspect.users.toLocaleString("fa-IR")}` : "",
      restoreInspect.orders != null ? `سفارش: ${restoreInspect.orders.toLocaleString("fa-IR")}` : "",
      restoreInspect.subscriptions != null
        ? `سرویس: ${restoreInspect.subscriptions.toLocaleString("fa-IR")}`
        : "",
      "",
      "دیتابیس فعلی جایگزین شود؟ قبل از بازیابی نسخهٔ ایمنی ساخته می‌شود و سرور ری‌استارت خواهد شد.",
    ]
      .filter(Boolean)
      .join("\n");
    if (!(await askConfirm(summary))) return;
    setBackupBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ ok: boolean; safetyName?: string; message?: string }>("/admin/backup/restore", {
        method: "POST",
        rawBody: fd,
      });
      setRestoreFile(null);
      setRestoreInspect(null);
      flash(r.message || `بازیابی شد · ایمنی: ${r.safetyName || "—"}`);
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBackupBusy(false);
    }
  }

  if (!loaded) return <p className="muted">در حال دریافت تنظیمات…</p>;

  const multiMonth = Number(settings.max_purchase_months || "1") > 1;
  const skinIsClassic = parseUiSkin(settings.ui_skin) === "classic";

  function onSettingNumberChange(key: string, raw: string, fallback: number) {
    const cleaned = raw.replace(/,/g, "");
    if (cleaned !== "" && !/^\d*\.?\d{0,3}$/.test(cleaned)) return;
    setSettings((s) => ({
      ...s,
      [key]: cleaned === "" ? String(fallback) : cleaned,
    }));
  }

  return (
    <div className="settings-page">
      <div className="settings-page__body">
      <SettingsAccordion
        id="auth"
        title="ورود و امنیت"
        icon="shield"
        openId={openSection}
        onToggle={toggleSection}
      >
        <PasswordSettings hasPassword={hasPassword} onFlash={flash} onSaved={onPasswordSaved} />
      </SettingsAccordion>

      <SettingsAccordion
        id="payments"
        title="روش‌های پرداخت"
        icon="wallet"
        openId={openSection}
        onToggle={toggleSection}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          فقط روش‌های فعال در خرید و تمدید نمایش داده می‌شوند. پرداخت آنلاین فعلاً اسکلت است و تا اتصال درگاه قابل انتخاب نیست.
        </p>

        <div className="pay-method-block">
          <div className="setting-row">
            <div>
              <div className="t">کارت به کارت</div>
              <div className="d">واریز به شماره کارت و تأیید دستی رسید</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={payMethods.card.enabled}
                disabled={saveBusy}
                onChange={(e) =>
                  setPayMethods((m) => ({ ...m, card: { enabled: e.target.checked } }))
                }
              />
              <span className="track" />
            </label>
          </div>
          {payMethods.card.enabled && (
            <>
              <div className="field">
                <label>شماره کارت</label>
                <input
                  dir="ltr"
                  className="num"
                  value={settings.card_number ?? ""}
                  disabled={saveBusy}
                  onChange={(e) => setSettings((s) => ({ ...s, card_number: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>نام صاحب کارت</label>
                <input
                  value={settings.card_holder ?? ""}
                  disabled={saveBusy}
                  onChange={(e) => setSettings((s) => ({ ...s, card_holder: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>

        <div className="pay-method-block">
          <div className="setting-row">
            <div>
              <div className="t">کیف پول داخلی</div>
              <div className="d">پرداخت آنی از موجودی داشبورد / ربات</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={payMethods.wallet.enabled}
                disabled={saveBusy}
                onChange={(e) =>
                  setPayMethods((m) => ({ ...m, wallet: { enabled: e.target.checked } }))
                }
              />
              <span className="track" />
            </label>
          </div>
        </div>

        <div className="pay-method-block">
          <div className="setting-row">
            <div>
              <div className="t">پرداخت آنلاین</div>
              <div className="d">درگاه بانکی — اتصال بعداً؛ الان فقط اسکلت و سوییچ</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={payMethods.online.enabled}
                disabled={saveBusy}
                onChange={(e) =>
                  setPayMethods((m) => ({
                    ...m,
                    online: { ...m.online, enabled: e.target.checked },
                  }))
                }
              />
              <span className="track" />
            </label>
          </div>
          {payMethods.online.enabled && (
            <p className="hint" style={{ margin: 0 }}>
              در checkout با برچسب «به‌زودی» دیده می‌شود و تا اتصال درگاه قابل انتخاب نیست.
            </p>
          )}
        </div>

        <div className="pay-method-block">
          <div className="setting-row">
            <div>
              <div className="t">پرداخت کریپتو</div>
              <div className="d">نمایش آدرس کیف + هش/رسید و تأیید دستی ادمین</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={payMethods.crypto.enabled}
                disabled={saveBusy}
                onChange={(e) =>
                  setPayMethods((m) => ({
                    ...m,
                    crypto: { ...m.crypto, enabled: e.target.checked },
                  }))
                }
              />
              <span className="track" />
            </label>
          </div>
          {payMethods.crypto.enabled && (
            <>
              <div className="bulk-price-row" style={{ marginTop: 4 }}>
                <div className="field" style={{ margin: 0, flex: "1 1 120px" }}>
                  <label>دارایی</label>
                  <input
                    dir="ltr"
                    value={payMethods.crypto.asset}
                    disabled={saveBusy}
                    onChange={(e) =>
                      setPayMethods((m) => ({
                        ...m,
                        crypto: { ...m.crypto, asset: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="field" style={{ margin: 0, flex: "1 1 120px" }}>
                  <label>شبکه</label>
                  <input
                    dir="ltr"
                    value={payMethods.crypto.network}
                    disabled={saveBusy}
                    onChange={(e) =>
                      setPayMethods((m) => ({
                        ...m,
                        crypto: { ...m.crypto, network: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="field">
                <label>آدرس کیف پول</label>
                <input
                  dir="ltr"
                  className="num"
                  value={payMethods.crypto.address}
                  disabled={saveBusy}
                  placeholder="T… / 0x…"
                  onChange={(e) =>
                    setPayMethods((m) => ({
                      ...m,
                      crypto: { ...m.crypto, address: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>یادداشت برای کاربر (اختیاری)</label>
                <textarea
                  rows={2}
                  value={payMethods.crypto.note}
                  disabled={saveBusy}
                  placeholder="مثلاً فقط USDT روی شبکه TRC20"
                  onChange={(e) =>
                    setPayMethods((m) => ({
                      ...m,
                      crypto: { ...m.crypto, note: e.target.value },
                    }))
                  }
                />
              </div>
            </>
          )}
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="notifications"
        title="اعلان‌های ربات"
        icon="orders"
        openId={openSection}
        onToggle={toggleSection}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          همان گزینه‌های کنترل‌سنتر تلگرام — هشدار اتمام روز/حجم، قبل از حذف، و حذف نهایی.
        </p>
        {notif ? (
          <>
            <div className="setting-row">
              <div>
                <div className="t">📅 اتمام روز</div>
                <div className="d">هشدار قبل از انقضای تاریخ سرویس</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notif.expiryDays.enabled}
                  disabled={notifBusy}
                  onChange={(e) => void saveNotif({ expiryDays: { ...notif.expiryDays, enabled: e.target.checked } })}
                />
                <span className="track" />
              </label>
            </div>
            {notif.expiryDays.enabled && (
              <div className="field">
                <label>آستانه (ساعت قبل از انقضا)</label>
                <input
                  className="num"
                  dir="ltr"
                  type="number"
                  min={1}
                  max={720}
                  value={notif.expiryDays.hours}
                  disabled={notifBusy}
                  onChange={(e) =>
                    setNotif((n) =>
                      n ? { ...n, expiryDays: { ...n.expiryDays, hours: Number(e.target.value) || 1 } } : n,
                    )
                  }
                  onBlur={() => void saveNotif({ expiryDays: notif.expiryDays })}
                />
              </div>
            )}

            <div className="setting-row">
              <div>
                <div className="t">📦 اتمام حجم</div>
                <div className="d">هشدار وقتی حجم باقی‌مانده کم شود</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notif.traffic.enabled}
                  disabled={notifBusy}
                  onChange={(e) => void saveNotif({ traffic: { ...notif.traffic, enabled: e.target.checked } })}
                />
                <span className="track" />
              </label>
            </div>
            {notif.traffic.enabled && (
              <div className="field">
                <label>آستانه (مگابایت باقی‌مانده)</label>
                <input
                  className="num"
                  dir="ltr"
                  type="number"
                  min={1}
                  max={50000}
                  value={notif.traffic.megabytes}
                  disabled={notifBusy}
                  onChange={(e) =>
                    setNotif((n) =>
                      n ? { ...n, traffic: { ...n.traffic, megabytes: Number(e.target.value) || 1 } } : n,
                    )
                  }
                  onBlur={() => void saveNotif({ traffic: notif.traffic })}
                />
              </div>
            )}

            <div className="setting-row">
              <div>
                <div className="t">⚠️ هشدار قبل از حذف</div>
                <div className="d">حدود چند ساعت قبل از حذف خودکار از پنل</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notif.preDelete.enabled}
                  disabled={notifBusy}
                  onChange={(e) => void saveNotif({ preDelete: { ...notif.preDelete, enabled: e.target.checked } })}
                />
                <span className="track" />
              </label>
            </div>
            {notif.preDelete.enabled && (
              <div className="field">
                <label>پنجره هشدار (ساعت)</label>
                <input
                  className="num"
                  dir="ltr"
                  type="number"
                  min={1}
                  max={720}
                  value={notif.preDelete.hours}
                  disabled={notifBusy}
                  onChange={(e) =>
                    setNotif((n) =>
                      n ? { ...n, preDelete: { ...n.preDelete, hours: Number(e.target.value) || 1 } } : n,
                    )
                  }
                  onBlur={() => void saveNotif({ preDelete: notif.preDelete })}
                />
              </div>
            )}

            <div className="setting-row">
              <div>
                <div className="t">🗑 حذف نهایی سرویس</div>
                <div className="d">اعلان وقتی سرویس واقعاً از پنل پاک/غیرفعال شد</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notif.deleted.enabled}
                  disabled={notifBusy}
                  onChange={(e) => void saveNotif({ deleted: { enabled: e.target.checked } })}
                />
                <span className="track" />
              </label>
            </div>
          </>
        ) : (
          <p className="muted">در حال دریافت تنظیمات اعلان…</p>
        )}
      </SettingsAccordion>

      <SettingsAccordion
        id="channels"
        title="کانال‌های ربات"
        icon="users"
        openId={openSection}
        onToggle={toggleSection}
      >
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
      </SettingsAccordion>

      <SettingsAccordion
        id="backup"
        title="پشتیبان دیتابیس"
        icon="file"
        openId={openSection}
        onToggle={toggleSection}
      >
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
            {backupFiles.length > 0 && (
              <button
                type="button"
                className="btn ghost wide"
                style={{ marginTop: 8 }}
                onClick={() => setBackupFilesOpen(true)}
              >
                فایل‌های اخیر روی سرور ({backupFiles.length.toLocaleString("fa-IR")})
              </button>
            )}
            <Modal
              open={backupFilesOpen}
              title="فایل‌های اخیر روی سرور"
              onClose={() => setBackupFilesOpen(false)}
            >
              {backupFiles.length === 0 ? (
                <p className="muted">فایلی یافت نشد.</p>
              ) : (
                <ul className="backup-files-modal">
                  {backupFiles.map((f) => (
                    <li key={f.name} className="backup-files-modal__item">
                      <span className="num backup-files-modal__name" dir="ltr">
                        {f.name}
                      </span>
                      <span className="muted backup-files-modal__meta">
                        {f.kind === "safety" ? "ایمنی" : f.kind === "backup" ? "پشتیبان" : "دیگر"} · {f.sizeLabel} ·{" "}
                        {new Date(f.mtime).toLocaleString("fa-IR")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Modal>
            <div className="backup-restore">
              <div className="backup-restore__title">بازیابی از فایل پشتیبان</div>
              <p className="hint" style={{ marginTop: 0 }}>
                فایل `.db` پشتیبان را انتخاب کنید؛ دکمهٔ بازیابی ابتدا اعتبار فایل را بررسی می‌کند و بعد از تأیید، جایگزین می‌کند.
              </p>
              <input
                ref={restoreInputRef}
                type="file"
                accept=".db,.sqlite,.sqlite3,application/octet-stream"
                className="backup-restore__input"
                disabled={backupBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void pickRestoreFile(f);
                }}
              />
              <button
                type="button"
                className="backup-restore__pick"
                disabled={backupBusy}
                onClick={() => restoreInputRef.current?.click()}
              >
                <Icon name="file" size={20} />
                <span className="backup-restore__pick-text">
                  <strong>{restoreFile ? "تغییر فایل" : "انتخاب فایل پشتیبان"}</strong>
                  <small>{restoreFile ? restoreFile.name : "فرمت .db · خروجی پشتیبان ربات"}</small>
                </span>
              </button>
              {restoreFile && (
                <div className="backup-restore__meta">
                  <span className="num" dir="ltr">
                    {restoreFile.name}
                  </span>
                  <span className="muted">{formatFileSize(restoreFile.size)}</span>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={backupBusy}
                    onClick={() => {
                      setRestoreFile(null);
                      setRestoreInspect(null);
                    }}
                  >
                    حذف
                  </button>
                </div>
              )}
              {restoreInspect && (
                <p className="hint" style={{ margin: 0 }}>
                  {restoreInspect.note || "فایل معتبر است."}
                  {restoreInspect.users != null
                    ? ` · کاربر ${restoreInspect.users.toLocaleString("fa-IR")}`
                    : ""}
                  {restoreInspect.orders != null
                    ? ` · سفارش ${restoreInspect.orders.toLocaleString("fa-IR")}`
                    : ""}
                  {restoreInspect.subscriptions != null
                    ? ` · سرویس ${restoreInspect.subscriptions.toLocaleString("fa-IR")}`
                    : ""}
                </p>
              )}
              <button
                type="button"
                className="btn danger wide"
                disabled={backupBusy || !restoreFile || !restoreInspect}
                onClick={() => void restoreBackupFile()}
              >
                {backupBusy ? "در حال بررسی / بازیابی…" : "بازیابی فایل پشتیبان"}
              </button>
            </div>
          </>
        )}
        {!backup && <p className="muted">در حال دریافت تنظیمات پشتیبان…</p>}
      </SettingsAccordion>

      <SettingsAccordion
        id="serverless"
        title="سرورلس / Serverless"
        icon="server"
        openId={openSection}
        onToggle={toggleSection}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          فروش بدون اتصال به پنل ۳x-ui. بعد از پرداخت، خریدار پیام آماده‌سازی می‌گیرد و ادمین لینک ساب را دستی ارسال می‌کند.
          پیام‌های مشتری کلمه «سرورلس» ندارند.
        </p>
        <div className="setting-row">
          <div>
            <div className="t">فعال‌سازی سرورلس</div>
            <div className="d">
              با روشن بودن، ماتریس/نامحدود/همکاری/عمده خاموش می‌شود و فقط پلن‌های همین بخش فروخته می‌شوند.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.serverless_enabled === "true"}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  serverless_enabled: e.target.checked ? "true" : "false",
                }))
              }
            />
            <span className="track" />
          </label>
        </div>

        <h3 style={{ margin: "18px 0 8px", fontSize: 15 }}>قیمت‌گذاری</h3>
        <div className="setting-row">
          <div>
            <div className="t">قیمت هر گیگ (تومان)</div>
            <div className="d">برای هفتگی و ماهانه اعمال می‌شود.</div>
          </div>
          <input
            className="num"
            inputMode="decimal"
            value={formatSettingNumber(settings.serverless_price_per_gb, 10000)}
            onChange={(e) => onSettingNumberChange("serverless_price_per_gb", e.target.value, 10000)}
            style={{ width: 110, border: "1px solid var(--line)", background: "rgba(10,13,35,.6)", color: "var(--text)", borderRadius: 10, padding: "8px 12px" }}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="t">قیمت هر ماه (تومان)</div>
            <div className="d">فقط برای پلن‌های یک‌ماهه و دوماهه (علاوه بر قیمت گیگ).</div>
          </div>
          <input
            className="num"
            inputMode="decimal"
            value={formatSettingNumber(settings.serverless_price_per_month, 30000)}
            onChange={(e) => onSettingNumberChange("serverless_price_per_month", e.target.value, 30000)}
            style={{ width: 110, border: "1px solid var(--line)", background: "rgba(10,13,35,.6)", color: "var(--text)", borderRadius: 10, padding: "8px 12px" }}
          />
        </div>

        <h3 style={{ margin: "18px 0 8px", fontSize: 15 }}>اعتبار هفتگی</h3>
        <div className="setting-row">
          <div>
            <div className="t">فعال</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.serverless_weekly_enabled !== "false"}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  serverless_weekly_enabled: e.target.checked ? "true" : "false",
                }))
              }
            />
            <span className="track" />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">حداقل / حداکثر گیگ</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="num"
              inputMode="decimal"
              title="حداقل"
              value={formatSettingNumber(settings.serverless_weekly_min_gb, 1)}
              onChange={(e) => onSettingNumberChange("serverless_weekly_min_gb", e.target.value, 1)}
              style={{ width: 64, border: "1px solid var(--line)", background: "rgba(10,13,35,.6)", color: "var(--text)", borderRadius: 10, padding: "8px 10px" }}
            />
            <input
              className="num"
              inputMode="decimal"
              title="حداکثر"
              value={formatSettingNumber(settings.serverless_weekly_max_gb, 10)}
              onChange={(e) => onSettingNumberChange("serverless_weekly_max_gb", e.target.value, 10)}
              style={{ width: 64, border: "1px solid var(--line)", background: "rgba(10,13,35,.6)", color: "var(--text)", borderRadius: 10, padding: "8px 10px" }}
            />
          </div>
        </div>

        <h3 style={{ margin: "18px 0 8px", fontSize: 15 }}>اعتبار یک‌ماهه و دوماهه</h3>
        <div className="setting-row">
          <div>
            <div className="t">یک‌ماهه</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.serverless_month1_enabled !== "false"}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  serverless_month1_enabled: e.target.checked ? "true" : "false",
                }))
              }
            />
            <span className="track" />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">دوماهه</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.serverless_month2_enabled !== "false"}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  serverless_month2_enabled: e.target.checked ? "true" : "false",
                }))
              }
            />
            <span className="track" />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">حداقل / حداکثر گیگ</div>
            <div className="d">پیش‌فرض ۱۰ تا ۱۰۰ گیگ</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="num"
              inputMode="decimal"
              title="حداقل"
              value={formatSettingNumber(settings.serverless_monthly_min_gb, 10)}
              onChange={(e) => onSettingNumberChange("serverless_monthly_min_gb", e.target.value, 10)}
              style={{ width: 64, border: "1px solid var(--line)", background: "rgba(10,13,35,.6)", color: "var(--text)", borderRadius: 10, padding: "8px 10px" }}
            />
            <input
              className="num"
              inputMode="decimal"
              title="حداکثر"
              value={formatSettingNumber(settings.serverless_monthly_max_gb, 100)}
              onChange={(e) => onSettingNumberChange("serverless_monthly_max_gb", e.target.value, 100)}
              style={{ width: 64, border: "1px solid var(--line)", background: "rgba(10,13,35,.6)", color: "var(--text)", borderRadius: 10, padding: "8px 10px" }}
            />
          </div>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          مثال: ۱۰ گیگ یک‌ماهه = (۱۰ × قیمت گیگ) + (۱ × قیمت ماه). هفتگی فقط قیمت گیگ است.
        </p>
      </SettingsAccordion>

      <SettingsAccordion
        id="sales"
        title="قوانین فروش"
        icon="shop"
        openId={openSection}
        onToggle={toggleSection}
      >
        <div className="setting-row">
          <div>
            <div className="t">فروش اشتراک بیش از یک ماه</div>
            <div className="d">با غیرفعال بودن، فقط پلن‌های یک‌ماهه قابل خرید هستند.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={multiMonth}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  max_purchase_months: e.target.checked ? "12" : "1",
                }))
              }
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
              onChange={(e) => setSettings((s) => ({ ...s, max_purchase_months: e.target.value }))}
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
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  test_service_enabled: e.target.checked ? "true" : "false",
                }))
              }
            />
            <span className="track" />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">کد تخفیف</div>
            <div className="d">فعال‌سازی ورود کد در خرید (ربات و وب). هر کد فقط برای فروش سازنده‌اش.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.discount_codes_enabled === "true"}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  discount_codes_enabled: e.target.checked ? "true" : "false",
                }))
              }
            />
            <span className="track" />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">پیش‌فرض سقف درصد نمایندگان جدید</div>
            <div className="d">
              هنگام تأیید همکار جدید اعمال می‌شود (پیش‌فرض ۳۰٪). سقف هر نماینده را جداگانه از تب کاربران تنظیم کنید.
            </div>
          </div>
          <input
            className="num"
            inputMode="decimal"
            value={formatSettingNumber(settings.discount_max_percent, 30)}
            onChange={(e) => onSettingNumberChange("discount_max_percent", e.target.value, 30)}
            style={{
              width: 72,
              border: "1px solid var(--line)",
              background: "rgba(10,13,35,.6)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "8px 12px",
            }}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="t">محدودیت پیش‌فرض دستگاه (IP)</div>
            <div className="d">۰ یعنی نامحدود.</div>
          </div>
          <select
            value={settings.default_limit_ip || "2"}
            onChange={(e) => setSettings((s) => ({ ...s, default_limit_ip: e.target.value }))}
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
            onChange={(e) => setSettings((s) => ({ ...s, web_session_hours: e.target.value }))}
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
      </SettingsAccordion>

      <SettingsAccordion
        id="guides"
        title="آموزش اتصال"
        icon="wifi"
        openId={openSection}
        onToggle={toggleSection}
      >
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
      </SettingsAccordion>

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

      <SettingsAccordion
        id="appearance"
        title="ظاهر و ایموجی"
        icon="layers"
        openId={openSection}
        onToggle={toggleSection}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          قالب، حالت رنگ و سبک ایموجی ربات را یکجا تنظیم کنید. تغییرات با دکمهٔ ذخیره در پایین صفحه اعمال می‌شود.
        </p>
        <div className="settings-appearance-row">
          <div className="field settings-appearance-row__field">
            <label>قالب</label>
            <select
              value={parseUiSkin(settings.ui_skin)}
              disabled={saveBusy}
              onChange={(e) => {
                const ui_skin = parseUiSkin(e.target.value);
                setSettings((s) => ({ ...s, ui_skin }));
              }}
            >
              <option value="classic">Classic</option>
              <option value="studio">Studio</option>
            </select>
          </div>
          <div className="field settings-appearance-row__field">
            <label>مود</label>
            <select
              value={parseColorMode(settings.ui_color_mode)}
              disabled={saveBusy || skinIsClassic}
              onChange={(e) => {
                const ui_color_mode = e.target.value as ColorMode;
                setSettings((s) => ({ ...s, ui_color_mode }));
              }}
            >
              <option value="system">خودکار</option>
              <option value="dark">تیره</option>
              <option value="light">روشن</option>
              <option value="telegram">تلگرام</option>
            </select>
          </div>
          <div className="field settings-appearance-row__field">
            <label>ایموجی</label>
            <select
              value={(settings.emoji_style || "universal") === "premium" ? "premium" : "universal"}
              disabled={saveBusy}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  emoji_style: e.target.value === "premium" ? "premium" : "universal",
                }))
              }
            >
              <option value="universal">Universal</option>
              <option value="premium">Premium</option>
            </select>
          </div>
        </div>
        {settings.emoji_style === "premium" && (
          <p className="hint settings-appearance-note">
            برای ایموجی پریمیوم، حساب تلگرام سازنده ربات باید Premium باشد. بعد از ذخیره، یک‌بار منوی ربات را با /update
            رفرش کنید.
          </p>
        )}
        <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 0 }}>
          در Studio کاربران می‌توانند با دکمه خورشید/ماه در هدر بین روشن و تیره جابه‌جا شوند. مود فقط برای Studio فعال است.
        </p>
      </SettingsAccordion>

      <SettingsAccordion
        id="basics"
        title="اطلاعات پایه"
        icon="gear"
        openId={openSection}
        onToggle={toggleSection}
      >
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
      </SettingsAccordion>
      </div>

      <div className="settings-sticky-bar" role="toolbar" aria-label="ذخیره تنظیمات">
        <div className="settings-sticky-bar__inner">
          <button
            type="button"
            className="settings-sticky-bar__btn settings-sticky-bar__btn--save"
            disabled={saveBusy}
            onClick={() => void persistDraft()}
          >
            {saveBusy ? "…" : "ذخیره"}
          </button>
          <button
            type="button"
            className="settings-sticky-bar__btn settings-sticky-bar__btn--cancel"
            disabled={saveBusy}
            onClick={revertDraft}
          >
            انصراف
          </button>
          <button
            type="button"
            className="settings-sticky-bar__btn settings-sticky-bar__btn--default"
            disabled={saveBusy}
            onClick={applyDefaultsDraft}
          >
            دیفالت
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Reports ---------------- */

const AUDIT_LABELS: Record<string, string> = {
  admin_config_delete: "حذف اکانت",
  admin_account_restore: "بازگردانی اکانت",
  admin_config_update: "ویرایش اکانت",
  admin_config_import: "ورود از پنل",
};

function ReportsTab() {
  const [audit, setAudit] = useState<
    Array<{
      id: string;
      action: string;
      target: string | null;
      detail: string | null;
      createdAt: string;
    }>
  >([]);
  const [archives, setArchives] = useState<
    Array<{
      id: string;
      email: string;
      reason: string;
      summary: string;
      restoredAt: string | null;
      createdAt: string;
    }>
  >([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{
    email?: string | null;
    archiveId?: string | null;
  }>({});

  const loadReportsMeta = useCallback(() => {
    void api<{ logs: typeof audit }>("/admin/audit").then((r) => setAudit(r.logs));
    void api<{ archives: typeof archives }>("/admin/archives?reason=deleted&limit=40").then((r) =>
      setArchives(r.archives ?? []),
    );
  }, []);

  useEffect(() => {
    loadReportsMeta();
  }, [loadReportsMeta]);

  function openArchiveDetail(a: (typeof archives)[number]) {
    setDetailTarget({ email: a.email, archiveId: a.id });
    setDetailOpen(true);
  }

  function openAuditDetail(a: (typeof audit)[number]) {
    const archiveMatch = a.detail?.match(/archive=([a-z0-9]+)/i);
    if (archiveMatch?.[1]) {
      setDetailTarget({ email: a.target, archiveId: archiveMatch[1] });
      setDetailOpen(true);
      return;
    }
    if (a.target) {
      setDetailTarget({ email: a.target, archiveId: null });
      setDetailOpen(true);
    }
  }

  return (
    <>
      <SalesReportPanel
        endpoint="/admin/reports/sales"
        defaultPeriod="week"
        showWallet
        title="گزارش فروش کل"
      />
      <AgentsLeaderboardPanel />
      <div className="panel">
        <h2>لاگ حذف اکانت</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          قبل از حذف، اسنپ‌شات کامل ذخیره می‌شود تا در صورت اشتباه بتوانید بازگردانی کنید.
        </p>
        <div className="list">
          {archives.map((a) => (
            <div key={a.id} className="row-card" style={{ alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{a.email}</strong>
                <div className="muted">
                  {a.summary}
                  {a.restoredAt ? " · بازگردانی‌شده" : ""}
                  {" · "}
                  {new Date(a.createdAt).toLocaleString("fa-IR")}
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginTop: 8, padding: "4px 10px", fontSize: "0.82rem" }}
                  onClick={() => openArchiveDetail(a)}
                >
                  مشاهده جزئیات
                </button>
              </div>
            </div>
          ))}
          {!archives.length && <p className="muted">حذف آرشیو‌شده‌ای ثبت نشده.</p>}
        </div>
      </div>
      <div className="panel">
        <h2>لاگ عملیات</h2>
        <div className="list">
          {audit.map((a) => {
            const label = AUDIT_LABELS[a.action] || a.action;
            const canDetail = Boolean(a.target) || /archive=/i.test(a.detail || "");
            return (
              <div key={a.id} className="row-card" style={{ alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {label}
                    {a.target ? `: ${a.target}` : ""}
                  </strong>
                  {a.detail && <div className="muted">{a.detail}</div>}
                  {canDetail && (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginTop: 8, padding: "4px 10px", fontSize: "0.82rem" }}
                      onClick={() => openAuditDetail(a)}
                    >
                      مشاهده جزئیات
                    </button>
                  )}
                </div>
                <span className="muted">{new Date(a.createdAt).toLocaleString("fa-IR")}</span>
              </div>
            );
          })}
          {!audit.length && <p className="muted">لاگی ثبت نشده.</p>}
        </div>
      </div>
      <AccountDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        email={detailTarget.email}
        archiveId={detailTarget.archiveId}
        onRestored={loadReportsMeta}
      />
    </>
  );
}

/* ---------------- Import ---------------- */

function ImportTab({ flash }: { flash: Flash }) {
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<{
    sheetNames: string[];
    settings: number;
    channels: number;
    prices: number;
    rates: number;
    salesCategories: number;
    promos: number;
    guides: number;
    panels: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function pickFile(next: File | null) {
    setFile(next);
    setInspect(null);
    setResultText("");
  }

  async function inspectFile() {
    if (!file) {
      flash(null, "ابتدا فایل اکسل را انتخاب کنید");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const r = await api<{ inspect: NonNullable<typeof inspect> }>("/admin/import/inspect", {
        rawBody: buf,
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
      setInspect(r.inspect);
      flash("فایل اکسل بررسی شد");
    } catch (ex) {
      flash(null, errText(ex));
    } finally {
      setBusy(false);
    }
  }

  async function importFile() {
    if (!file) {
      flash(null, "ابتدا فایل اکسل را انتخاب کنید");
      return;
    }
    if (!inspect) {
      flash(null, "ابتدا فایل را بررسی کنید");
      return;
    }
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
    }
  }

  async function downloadCurrentExcel() {
    setBusy(true);
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const demoRole = getDemoRole();
      if (demoRole) headers["X-Demo-Role"] = demoRole;
      const res = await fetch(`${apiBase()}/api/admin/export.xlsx`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `quadtwo-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      flash("خروجی اکسل دانلود شد");
    } catch (ex) {
      flash(null, errText(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>ورود قیمت و تنظیمات از اکسل</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        می‌توانید اول از وضعیت فعلی دیتابیس خروجی اکسل بگیرید، تغییرات را اعمال کنید و دوباره همان فایل را وارد کنید.
      </p>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void downloadCurrentExcel()}>
          دانلود خروجی اکسل فعلی
        </button>
      </div>
      <div className="backup-restore">
        <div className="backup-restore__title">انتخاب و ورود فایل اکسل</div>
        <p className="hint" style={{ marginTop: 0 }}>
          فایل `.xlsx` یا `.xls` را انتخاب کنید؛ قبل از ورود نهایی، ساختار فایل بررسی می‌شود.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="backup-restore__input"
          disabled={busy}
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            e.target.value = "";
            void pickFile(next);
          }}
        />
        <button
          type="button"
          className="backup-restore__pick"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="file" size={20} />
          <span className="backup-restore__pick-text">
            <strong>{file ? "تغییر فایل" : "انتخاب فایل اکسل"}</strong>
            <small>{file ? file.name : "فرمت .xlsx / .xls · قابل import مجدد"}</small>
          </span>
        </button>
        {file && (
          <div className="backup-restore__meta">
            <span className="num" dir="ltr">
              {file.name}
            </span>
            <span className="muted">{formatFileSize(file.size)}</span>
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() => {
                setFile(null);
                setInspect(null);
                setResultText("");
              }}
            >
              حذف
            </button>
          </div>
        )}
        {inspect && (
          <p className="hint" style={{ margin: 0 }}>
            شیت‌ها: {inspect.sheetNames.join("، ") || "—"}
            {` · تنظیمات ${inspect.settings.toLocaleString("fa-IR")}`}
            {` · کانال ${inspect.channels.toLocaleString("fa-IR")}`}
            {` · قیمت ${inspect.prices.toLocaleString("fa-IR")}`}
            {` · نرخ ${inspect.rates.toLocaleString("fa-IR")}`}
            {` · دسته ${inspect.salesCategories.toLocaleString("fa-IR")}`}
            {` · پیام ${inspect.promos.toLocaleString("fa-IR")}`}
            {` · آموزش ${inspect.guides.toLocaleString("fa-IR")}`}
            {` · سرور ${inspect.panels.toLocaleString("fa-IR")}`}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn ghost" disabled={busy || !file} onClick={() => void inspectFile()}>
            بررسی فایل اکسل
          </button>
          <button type="button" className="btn success" disabled={busy || !file || !inspect} onClick={() => void importFile()}>
            {busy ? "در حال بررسی / ورود…" : "ورود فایل اکسل"}
          </button>
        </div>
      </div>
      {resultText && (
        <pre className="muted" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 13 }}>
          {resultText}
        </pre>
      )}
    </div>
  );
}
