"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, roleLabel, type Role } from "../lib/api";
import { DemoModeBar } from "./DemoModeBar";

const PREVIEW_PANELS = [
  { path: "/admin", label: "ادمین" },
  { path: "/app", label: "کاربر" },
  { path: "/partner", label: "همکار" },
  { path: "/reseller", label: "عمده‌فروش" },
] as const;

function AdminPanelSwitcher() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const current =
    PREVIEW_PANELS.find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`))?.path ?? "/admin";
  const previewing = current !== "/admin";

  return (
    <label className="panel-switcher" title="سوییچ تست بین پنل‌ها (فقط ادمین)">
      <span className="panel-switcher-label">{previewing ? "پیش‌نمایش" : "پنل"}</span>
      <select
        className="panel-switcher-select"
        value={current}
        onChange={(e) => {
          const next = e.target.value;
          if (next && next !== pathname) router.push(next);
        }}
        aria-label="سوییچ پنل داشبورد"
      >
        {PREVIEW_PANELS.map((p) => (
          <option key={p.path} value={p.path}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export type IconName =
  | "home"
  | "shop"
  | "wifi"
  | "wallet"
  | "chat"
  | "gear"
  | "users"
  | "tag"
  | "layers"
  | "server"
  | "chart"
  | "file"
  | "orders"
  | "logout"
  | "shield"
  | "menu"
  | "close";

export function Icon({ name, size = 21 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "home":
      return (
        <svg {...p}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      );
    case "shop":
      return (
        <svg {...p}>
          <path d="M4 7h16l-1.2 12.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 7Z" />
          <path d="M8.5 10V6a3.5 3.5 0 0 1 7 0v4" />
        </svg>
      );
    case "wifi":
      return (
        <svg {...p}>
          <path d="M2.5 8.5a15 15 0 0 1 19 0" />
          <path d="M5.5 12a10.5 10.5 0 0 1 13 0" />
          <path d="M8.5 15.5a6 6 0 0 1 7 0" />
          <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="13" rx="3" />
          <path d="M3 10h18" />
          <circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "chat":
      return (
        <svg {...p}>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5.1A8 8 0 1 1 21 12Z" />
        </svg>
      );
    case "gear":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.7-1.6L13.5 2h-3l-.3 2.9a7 7 0 0 0-2.7 1.6l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5.1 1.1.2 1.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.7 1.6l.3 2.9h3l.3-2.9a7 7 0 0 0 2.7-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1.1.2-1.6Z" />
        </svg>
      );
    case "users":
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="3.4" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <path d="M16 5a3.2 3.2 0 0 1 0 6.2" />
          <path d="M17.5 14.5A5.7 5.7 0 0 1 21.5 20" />
        </svg>
      );
    case "tag":
      return (
        <svg {...p}>
          <path d="M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8L3 11Z" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "layers":
      return (
        <svg {...p}>
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 13 9 5 9-5" />
          <path d="m3 17.5 9 5 9-5" opacity="0.5" />
        </svg>
      );
    case "server":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="7" rx="2" />
          <rect x="3" y="13" width="18" height="7" rx="2" />
          <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="7.5" cy="16.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "chart":
      return (
        <svg {...p}>
          <path d="M4 20V4" />
          <path d="M4 20h16" />
          <path d="M8 16v-5" />
          <path d="M12.5 16V7" />
          <path d="M17 16v-3" />
        </svg>
      );
    case "file":
      return (
        <svg {...p}>
          <path d="M14 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V8.5L14 3Z" />
          <path d="M14 3v5.5h5.5" />
        </svg>
      );
    case "orders":
      return (
        <svg {...p}>
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <path d="m4 5.5 1 1L6.8 4.8" />
          <path d="m4 11.5 1 1 1.8-1.7" />
          <path d="m4 17.5 1 1 1.8-1.7" />
        </svg>
      );
    case "shield":
      return (
        <svg {...p}>
          <path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "logout":
      return (
        <svg {...p}>
          <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
          <path d="M10 8l-4 4 4 4" />
          <path d="M6 12h10" />
        </svg>
      );
    case "menu":
      return (
        <svg {...p}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      );
    case "close":
      return (
        <svg {...p}>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </svg>
      );
  }
}

export type ShellTab = {
  key: string;
  label: string;
  /** Shorter label for mobile bottom bar (avoids wrapping) */
  shortLabel?: string;
  icon: IconName;
  /** Keep in mobile bottom bar; remaining tabs go to hamburger */
  pin?: boolean;
};

export function DashShell(props: {
  brand: string;
  title: string;
  role: Role;
  userLabel?: string;
  walletLabel?: string;
  tabs: ShellTab[];
  active: string;
  onTab: (key: string) => void;
  /** Open settings from top gear (settings tab removed from bottom nav) */
  onSettings?: () => void;
  /** Server DEMO_MODE — show role switcher banner */
  demoMode?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const [moreOpen, setMoreOpen] = useState(false);
  const isAdmin = props.role === "admin";
  /** Only the real /admin shell uses top gear + overflow “more”; preview of user/partner keeps bottom settings */
  const isAdminPanel = pathname.startsWith("/admin");
  const isPreviewing =
    isAdmin && !isAdminPanel && PREVIEW_PANELS.some((p) => p.path === pathname || pathname.startsWith(`${p.path}/`));

  const navTabs = useMemo(() => {
    // Admin panel: settings stays in top gear / more sheet to keep bottom bar lean
    if (isAdminPanel) return props.tabs.filter((t) => t.key !== "settings");
    // User / partner / wholesale (and admin preview of those): settings in bottom nav
    return props.tabs;
  }, [props.tabs, isAdminPanel]);
  const settingsTab = useMemo(() => props.tabs.find((t) => t.key === "settings"), [props.tabs]);
  const hasSettings = isAdminPanel && Boolean(settingsTab || props.onSettings);

  const { left, wallet, right, more } = useMemo(() => {
    const walletTab = navTabs.find((t) => t.key === "wallet") ?? null;
    const rest = navTabs.filter((t) => t.key !== "wallet");
    const pinned = rest.filter((t) => t.pin);
    const unpinned = rest.filter((t) => !t.pin);

    let primaryRest: ShellTab[];
    let moreTabs: ShellTab[];
    if (pinned.length) {
      primaryRest = pinned;
      moreTabs = unpinned;
    } else if (rest.length <= 4) {
      primaryRest = rest;
      moreTabs = [];
    } else {
      primaryRest = rest.slice(0, 4);
      moreTabs = rest.slice(4);
    }

    if (walletTab) {
      // Keep declared tab order: items before wallet → bubble → items after wallet
      const order = navTabs.map((t) => t.key);
      const walletOrder = order.indexOf("wallet");
      const leftTabs = primaryRest.filter((t) => order.indexOf(t.key) < walletOrder);
      const rightTabs = primaryRest.filter((t) => order.indexOf(t.key) > walletOrder);
      return { left: leftTabs, wallet: walletTab, right: rightTabs, more: moreTabs };
    }

    const mid = Math.ceil(primaryRest.length / 2);
    return {
      left: primaryRest.slice(0, mid),
      wallet: null,
      right: primaryRest.slice(mid),
      more: moreTabs,
    };
  }, [navTabs]);

  const hasMore = more.length > 0;
  const moreActive = more.some((t) => t.key === props.active);
  const settingsActive = props.active === "settings";

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  function pickTab(key: string) {
    setMoreOpen(false);
    props.onTab(key);
  }

  function openSettings() {
    setMoreOpen(false);
    if (props.onSettings) props.onSettings();
    else props.onTab("settings");
  }

  return (
    <div>
      {props.demoMode && <DemoModeBar activeRole={props.role} />}
      <div className="mobile-top">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={props.brand} />
          <span>{props.brand}</span>
        </div>
        <div className="topbar-side">
          {props.walletLabel && <span className="money-pill num">{props.walletLabel}</span>}
          {hasSettings && (
            <button
              type="button"
              className={`icon-btn settings-gear${settingsActive ? " on" : ""}`}
              aria-label="تنظیمات"
              onClick={openSettings}
            >
              <span aria-hidden="true">⚙️</span>
            </button>
          )}
          {hasMore && (
            <button
              type="button"
              className={`icon-btn${moreOpen || moreActive ? " on" : ""}`}
              aria-label="منوی بیشتر"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Icon name={moreOpen ? "close" : "menu"} size={22} />
            </button>
          )}
        </div>
      </div>

      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt={props.brand} />
            <div>
              <strong>{props.brand}</strong>
              <span>{roleLabel(props.role)}</span>
            </div>
          </div>
          {props.tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`nav-item${props.active === t.key ? " active" : ""}`}
              onClick={() => props.onTab(t.key)}
            >
              <Icon name={t.icon} size={19} />
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button type="button" className="nav-item" onClick={logout}>
            <Icon name="logout" size={19} />
            خروج
          </button>
        </aside>

        <main className="main">
          <div className="topbar">
            <div>
              <h1>{props.title}</h1>
              {props.userLabel && <p className="sub">{props.userLabel}</p>}
            </div>
            <div className="topbar-side">
              {isAdmin && <AdminPanelSwitcher />}
              {props.walletLabel && <span className="money-pill num hide-mobile">{props.walletLabel}</span>}
              {hasSettings && (
                <button
                  type="button"
                  className={`icon-btn settings-gear hide-mobile${settingsActive ? " on" : ""}`}
                  aria-label="تنظیمات"
                  onClick={openSettings}
                >
                  <span aria-hidden="true">⚙️</span>
                </button>
              )}
              <span className="role-pill">{roleLabel(props.role)}</span>
            </div>
          </div>
          {isPreviewing && (
            <div className="preview-banner" role="status">
              در حال پیش‌نمایش پنل دیگر هستید — نقش واقعی شما ادمین است. قیمت‌ها و دسترسی‌ها بر اساس نقش ادمین محاسبه می‌شوند.
            </div>
          )}
          {props.children}
        </main>
      </div>

      <nav className={`bottom-nav${wallet ? " has-wallet-bubble" : ""}`} dir="rtl">
        {wallet ? (
          <>
            <div className="bottom-nav-side">
              {left.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={props.active === t.key ? "active" : ""}
                  onClick={() => pickTab(t.key)}
                >
                  <Icon name={t.icon} size={21} />
                  {t.shortLabel || t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`nav-wallet-bubble${props.active === "wallet" ? " active" : ""}`}
              onClick={() => pickTab("wallet")}
              aria-label={wallet.label}
            >
              <span className="nav-wallet-bubble-inner">
                <Icon name="wallet" size={22} />
              </span>
              <span className="nav-wallet-label">{wallet.shortLabel || wallet.label}</span>
            </button>
            <div className="bottom-nav-side">
              {right.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={props.active === t.key ? "active" : ""}
                  onClick={() => pickTab(t.key)}
                >
                  <Icon name={t.icon} size={21} />
                  {t.shortLabel || t.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {left.map((t) => (
              <button
                key={t.key}
                type="button"
                className={props.active === t.key ? "active" : ""}
                onClick={() => pickTab(t.key)}
              >
                <Icon name={t.icon} size={21} />
                {t.shortLabel || t.label}
              </button>
            ))}
            {right.map((t) => (
              <button
                key={t.key}
                type="button"
                className={props.active === t.key ? "active" : ""}
                onClick={() => pickTab(t.key)}
              >
                <Icon name={t.icon} size={21} />
                {t.shortLabel || t.label}
              </button>
            ))}
            {hasMore && (
              <button
                type="button"
                className={moreOpen || moreActive ? "active" : ""}
                aria-expanded={moreOpen}
                aria-label={moreOpen ? "بستن منوی بیشتر" : "منوی بیشتر"}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <Icon name={moreOpen ? "close" : "menu"} size={21} />
                {moreOpen ? "بستن" : "بیشتر"}
              </button>
            )}
          </>
        )}
      </nav>

      {hasMore && moreOpen && (
        <div className="more-sheet-root" role="dialog" aria-modal="true" aria-label="منوی بیشتر">
          <button type="button" className="more-sheet-backdrop" aria-label="بستن" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet">
            <div className="more-sheet-handle" />
            <div className="more-sheet-title">منوی بیشتر</div>
            <div className="more-sheet-grid">
              {more.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`more-sheet-item${props.active === t.key ? " active" : ""}`}
                  onClick={() => pickTab(t.key)}
                >
                  <Icon name={t.icon} size={22} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="loading-page">
      <div style={{ textAlign: "center" }}>
        <div className="spinner" />
        در حال بارگذاری…
      </div>
    </div>
  );
}
