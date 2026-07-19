"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { clearToken, roleLabel, type Role } from "../lib/api";

export type NavItem = { href: string; label: string };

export function DashShell(props: {
  title: string;
  role: Role;
  userLabel?: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();

  function logout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <div>
      <div className="gauge" />
      <div className="mobile-nav">
        {props.nav.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link key={n.href} href={n.href}>
              <span
                style={{
                  display: "inline-block",
                  whiteSpace: "nowrap",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "8px 12px",
                  color: active ? "white" : "var(--mute)",
                  background: active ? "var(--signal)" : "transparent",
                }}
              >
                {n.label}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="shell">
        <aside className="sidebar">
          <Image className="logo" src="/logo.png" alt="Piing" width={160} height={60} priority unoptimized />
          {props.nav.map((n) => {
            const active = path === n.href || path.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} className={`nav-item${active ? " active" : ""}`}>
                {n.label}
              </Link>
            );
          })}
          <div style={{ flex: 1 }} />
          <button type="button" className="nav-item" onClick={logout}>
            خروج
          </button>
        </aside>
        <main className="main">
          <div className="topbar">
            <div>
              <h1>{props.title}</h1>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {props.userLabel}
              </p>
            </div>
            <span className="role-pill">{roleLabel(props.role)}</span>
          </div>
          {props.children}
        </main>
      </div>
    </div>
  );
}
