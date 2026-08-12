"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, roleLabel, type Role } from "../lib/api";
import { lockBodyScroll, unlockBodyScroll } from "../lib/body-scroll-lock";
import { getFocusable, rememberFocus, trapFocus } from "../lib/focus-trap";
import {
  parseColorMode,
  readCachedAppearance,
  resolveTheme,
  toggleStudioTheme,
  type ColorMode,
} from "../lib/theme";
import { DemoModeBar } from "./DemoModeBar";

const PREVIEW_PANELS = [
  { path: "/admin", label: "ادمین" },
  { path: "/app", label: "کاربر" },
  { path: "/partner", label: "همکار" },
  { path: "/reseller", label: "همکار ویژه" },
  { path: "/wholesaler", label: "عمده‌فروش" },
] as const;

function ThemeToggleBtn() {
  const [skin, setSkin] = useState<"classic" | "studio">("classic");
  const [colorMode, setColorMode] = useState<ColorMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const sync = () => {
      const cached = readCachedAppearance();
      setSkin(cached.skin);
      setColorMode(cached.colorMode);
      setResolved(resolveTheme(cached.colorMode));
      const ds = document.documentElement.dataset.skin;
      if (ds === "studio" || ds === "classic") setSkin(ds);
      const dt = document.documentElement.dataset.theme;
      if (dt === "light" || dt === "dark") setResolved(dt);
    };
    sync();
    window.addEventListener("piing:appearance", sync);
    return () => window.removeEventListener("piing:appearance", sync);
  }, []);

  if (skin !== "studio") return null;

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={resolved === "light" ? "حالت تاریک" : "حالت روشن"}
      title={resolved === "light" ? "حالت تاریک" : "حالت روشن"}
      onClick={() => {
        const next = toggleStudioTheme(colorMode || parseColorMode(localStorage.getItem("piing_ui_color_mode")));
        setResolved(next);
      }}
    >
      <Icon name={resolved === "light" ? "moon" : "sun"} size={18} />
    </button>
  );
}

function AdminPanelSwitcher() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const current =
    PREVIEW_PANELS.find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`))?.path ?? "/admin";
  const previewing = current !== "/admin";

  return (
    <label className="panel-switcher" title="پیش‌نمایش پنل‌های دیگر (فقط ادمین)">
      <span className="panel-switcher-label">{previewing ? "پیش‌نمایش" : "نوع پنل"}</span>
      <select
        className="panel-switcher-select"
        value={current}
        onChange={(e) => {
          const next = e.target.value;
          if (next && next !== pathname) router.push(next);
        }}
        aria-label="پیش‌نمایش نوع پنل"
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
  | "close"
  | "sync"
  | "sun"
  | "moon"
  | "install"
  | "renew"
  | "edit"
  | "trash"
  | "copy"
  | "link"
  | "check"
  | "plus"
  | "download"
  | "calendar"
  | "arrowLeft"
  | "arrowRight";

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
    "aria-hidden": true as const,
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
    case "sync":
      return (
        <svg {...p}>
          <path d="M21 12a9 9 0 0 0-15.5-6.4" />
          <path d="M3 4v5h5" />
          <path d="M3 12a9 9 0 0 0 15.5 6.4" />
          <path d="M21 20v-5h-5" />
        </svg>
      );
    case "sun":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "moon":
      return (
        <svg {...p}>
          <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z" />
        </svg>
      );
    case "install":
      return (
        <svg {...p}>
          <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
          <path d="M12 8v7" />
          <path d="m9 12.5 3 3 3-3" />
          <path d="M9.5 18.5h5" />
        </svg>
      );
    case "renew":
      return (
        <svg {...p}>
          <path d="M4 12a8 8 0 0 1 13.7-5.7" />
          <path d="M18 4v4h-4" />
          <path d="M20 12a8 8 0 0 1-13.7 5.7" />
          <path d="M6 20v-4h4" />
        </svg>
      );
    case "edit":
      return (
        <svg {...p}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
        </svg>
      );
    case "trash":
      return (
        <svg {...p}>
          <path d="M4 7h16" />
          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          <path d="M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      );
    case "copy":
      return (
        <svg {...p}>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "link":
      return (
        <svg {...p}>
          <path d="M9.5 14.5 14.5 9.5" />
          <path d="M11 17.5 9 19.5a4 4 0 0 1-5.7-5.7L5.5 11.5" />
          <path d="M13 6.5 15 4.5a4 4 0 0 1 5.7 5.7L18.5 12.5" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <path d="m5 12 5 5L20 7" />
        </svg>
      );
    case "plus":
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "download":
      return (
        <svg {...p}>
          <path d="M12 4v11" />
          <path d="m7.5 11.5 4.5 4.5 4.5-4.5" />
          <path d="M5 19h14" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...p}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17" />
          <path d="M8 3.5v3M16 3.5v3" />
        </svg>
      );
    case "arrowLeft":
      return (
        <svg {...p}>
          <path d="M15 6 9 12l6 6" />
        </svg>
      );
    case "arrowRight":
      return (
        <svg {...p}>
          <path d="m9 6 6 6-6 6" />
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
  /** Keep in mobile bottom bar; remaining tabs go to top overflow menu */
  pin?: boolean;
  /** Also list in the overflow “more” sheet even when pinned (e.g. fill grid) */
  alsoInMore?: boolean;
  /** Order among pinned bottom-nav items (independent of sidebar order) */
  pinOrder?: number;
  /** Raised center bubble in bottom nav (e.g. wallet / فروش) */
  bubble?: boolean;
  /** Desktop sidebar: visual spacer after this item */
  gapAfter?: boolean;
};

export function DashShell(props: {
  brand: string;
  /** Optional tenant logo URL (falls back to /logo.png) */
  logoUrl?: string | null;
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

  const { left, bubble, right, more } = useMemo(() => {
    const bubbleTab = navTabs.find((t) => t.bubble || t.key === "wallet") ?? null;
    const rest = navTabs.filter((t) => t.key !== bubbleTab?.key);
    const byPinOrder = (a: ShellTab, b: ShellTab) => (a.pinOrder ?? 50) - (b.pinOrder ?? 50);
    const pinned = rest.filter((t) => t.pin).sort(byPinOrder);

    let primaryRest: ShellTab[];
    let moreTabs: ShellTab[];
    if (pinned.length) {
      primaryRest = pinned;
      // Keep sidebar/tab declaration order in the more sheet
      moreTabs = rest.filter((t) => !t.pin || t.alsoInMore);
    } else if (rest.length <= 4) {
      primaryRest = rest;
      moreTabs = [];
    } else {
      primaryRest = rest.slice(0, 4);
      moreTabs = rest.slice(4);
    }

    if (bubbleTab) {
      // Admin pinned tabs use explicit pinOrder; user/partner keep declared array order.
      const usePinOrder =
        bubbleTab.pinOrder != null || primaryRest.some((t) => t.pinOrder != null);
      if (usePinOrder) {
        const bubbleOrder = bubbleTab.pinOrder ?? 50;
        const leftTabs = primaryRest
          .filter((t) => (t.pinOrder ?? 50) < bubbleOrder)
          .sort(byPinOrder);
        const rightTabs = primaryRest
          .filter((t) => (t.pinOrder ?? 50) > bubbleOrder)
          .sort(byPinOrder);
        return { left: leftTabs, bubble: bubbleTab, right: rightTabs, more: moreTabs };
      }
      const order = navTabs.map((t) => t.key);
      const bubbleIdx = order.indexOf(bubbleTab.key);
      const leftTabs = primaryRest.filter((t) => order.indexOf(t.key) < bubbleIdx);
      const rightTabs = primaryRest.filter((t) => order.indexOf(t.key) > bubbleIdx);
      return { left: leftTabs, bubble: bubbleTab, right: rightTabs, more: moreTabs };
    }

    const mid = Math.ceil(primaryRest.length / 2);
    return {
      left: primaryRest.slice(0, mid),
      bubble: null as ShellTab | null,
      right: primaryRest.slice(mid),
      more: moreTabs,
    };
  }, [navTabs]);

  const hasMore = more.length > 0 || hasSettings;
  const moreActive = more.some((t) => t.key === props.active);
  const settingsActive = props.active === "settings";
  const bubbleActive = Boolean(bubble && props.active === bubble.key);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const restore = rememberFocus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
      if (moreSheetRef.current) trapFocus(moreSheetRef.current, e);
    };
    lockBodyScroll();
    window.addEventListener("keydown", onKey);
    queueMicrotask(() => {
      const first = moreSheetRef.current ? getFocusable(moreSheetRef.current)[0] : null;
      first?.focus();
    });
    return () => {
      unlockBodyScroll();
      window.removeEventListener("keydown", onKey);
      restore();
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
      <a className="skip-link" href="#main-content">
        پرش به محتوای اصلی
      </a>
      {props.demoMode && <DemoModeBar activeRole={props.role} />}
      <div className="mobile-top">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={props.logoUrl || "/logo.png"} alt={props.brand} />
          <span>{props.brand}</span>
        </div>
        <div className="topbar-side" dir="ltr">
          {hasMore && (
            <button
              ref={moreTriggerRef}
              type="button"
              className={`icon-btn${moreOpen || moreActive ? " on" : ""}`}
              aria-label="منوی بیشتر"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Icon name={moreOpen ? "close" : "menu"} size={22} />
            </button>
          )}
          {hasSettings && (
            <button
              type="button"
              className={`icon-btn settings-gear${settingsActive ? " on" : ""}`}
              aria-label="تنظیمات"
              onClick={openSettings}
            >
              <Icon name="gear" size={18} />
            </button>
          )}
          <ThemeToggleBtn />
          {isAdmin ? (
            <AdminPanelSwitcher />
          ) : (
            props.walletLabel && <span className="money-pill num">{props.walletLabel}</span>
          )}
        </div>
      </div>

      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={props.logoUrl || "/logo.png"} alt={props.brand} />
            <div>
              <strong>{props.brand}</strong>
              <span>{roleLabel(props.role)}</span>
            </div>
          </div>
          {props.tabs.map((t) => (
            <Fragment key={t.key}>
              <button
                type="button"
                className={`nav-item${props.active === t.key ? " active" : ""}`}
                onClick={() => props.onTab(t.key)}
              >
                <Icon name={t.icon} size={19} />
                {t.label}
              </button>
              {t.gapAfter ? <div className="nav-gap" aria-hidden /> : null}
            </Fragment>
          ))}
          <div style={{ flex: 1 }} />
          <button type="button" className="nav-item" onClick={logout}>
            <Icon name="logout" size={19} />
            خروج
          </button>
        </aside>

        <main id="main-content" className="main" tabIndex={-1}>
          <div className="topbar">
            <div>
              <h1>{props.title}</h1>
              {props.userLabel && <p className="sub">{props.userLabel}</p>}
            </div>
            <div className="topbar-side" dir="ltr">
              {hasSettings && (
                <button
                  type="button"
                  className={`settings-btn hide-mobile${settingsActive ? " on" : ""}`}
                  aria-label="تنظیمات"
                  onClick={openSettings}
                >
                  <Icon name="gear" size={16} />
                  <span>تنظیمات</span>
                </button>
              )}
              <span className="hide-mobile">
                <ThemeToggleBtn />
              </span>
              {isAdmin && (
                <span className="hide-mobile">
                  <AdminPanelSwitcher />
                </span>
              )}
              {!isAdmin && props.walletLabel && (
                <span className="money-pill num hide-mobile">{props.walletLabel}</span>
              )}
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

      <nav className={`bottom-nav${bubble ? " has-wallet-bubble" : ""}`} dir="rtl">
        {bubble ? (
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
              className={`nav-wallet-bubble${bubbleActive ? " active" : ""}`}
              onClick={() => pickTab(bubble.key)}
              aria-label={bubble.label}
            >
              <span className="nav-wallet-bubble-inner">
                <Icon name={bubble.icon} size={22} />
              </span>
              <span className="nav-wallet-label">{bubble.shortLabel || bubble.label}</span>
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
          </>
        )}
      </nav>

      {hasMore && moreOpen && (
        <div className="more-sheet-root" role="presentation">
          <button type="button" className="more-sheet-backdrop" aria-label="بستن" onClick={() => setMoreOpen(false)} />
          <div
            ref={moreSheetRef}
            className="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="منوی بیشتر"
          >
            <div className="more-sheet-handle" />
            <div className="more-sheet-title">منوی بیشتر</div>
            <div className="more-sheet-grid">
              {hasSettings && (
                <button
                  type="button"
                  className={`more-sheet-item${settingsActive ? " active" : ""}`}
                  onClick={() => {
                    openSettings();
                  }}
                >
                  <Icon name="gear" size={22} />
                  <span>تنظیمات</span>
                </button>
              )}
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
              <button
                type="button"
                className="more-sheet-item more-sheet-item--logout"
                onClick={() => {
                  setMoreOpen(false);
                  logout();
                }}
              >
                <Icon name="logout" size={22} />
                <span>خروج</span>
              </button>
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
