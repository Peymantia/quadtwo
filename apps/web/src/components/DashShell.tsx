"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { clearToken, roleLabel, type Role } from "../lib/api";

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
  | "shield";

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
  }
}

export type ShellTab = { key: string; label: string; icon: IconName };

export function DashShell(props: {
  brand: string;
  title: string;
  role: Role;
  userLabel?: string;
  walletLabel?: string;
  tabs: ShellTab[];
  active: string;
  onTab: (key: string) => void;
  children: ReactNode;
}) {
  const router = useRouter();

  function logout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <div>
      <div className="mobile-top">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={props.brand} />
          <span>{props.brand}</span>
        </div>
        <div className="topbar-side">
          {props.walletLabel && <span className="money-pill num">{props.walletLabel}</span>}
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
              {props.walletLabel && <span className="money-pill num hide-mobile">{props.walletLabel}</span>}
              <span className="role-pill">{roleLabel(props.role)}</span>
            </div>
          </div>
          {props.children}
        </main>
      </div>

      <nav className="bottom-nav">
        {props.tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={props.active === t.key ? "active" : ""}
            onClick={() => props.onTab(t.key)}
          >
            <Icon name={t.icon} size={21} />
            {t.label}
          </button>
        ))}
        <button type="button" onClick={logout}>
          <Icon name="logout" size={21} />
          خروج
        </button>
      </nav>
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
