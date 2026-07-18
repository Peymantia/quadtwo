"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

type Role = "user" | "partner" | "admin";

type Profile = {
  user: { id: string; role: Role; firstName: string | null; username: string | null; panelGroup: string | null };
  brand: string;
  support: string;
};

type Cell = { trafficGb: number | null; months: number; price: number };
type Sub = {
  id: string;
  code: string;
  email: string;
  trafficLabel: string;
  expiresAt: string;
  subUrl: string | null;
  status: string;
};

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: {
      ...(token ? authHeaders(token) : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default function MiniAppHome() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<"buy" | "subs" | "admin">("buy");
  const [error, setError] = useState<string | null>(null);
  const [gb, setGb] = useState<number | null>(10);
  const [months, setMonths] = useState(1);
  const [price, setPrice] = useState<number | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<Array<{ id: string; summary: string; price: number }>>([]);
  const [matrix, setMatrix] = useState<Array<{ trafficGb: number | null; months: number; priceUser: number; pricePartner: number }>>([]);

  const volumes = useMemo(() => [10, 15, 20, 25, 30, 35, 40, 45, 50, null] as const, []);

  const login = useCallback(async () => {
    try {
      setError(null);
      const tg = (window as unknown as { Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void } } })
        .Telegram?.WebApp;
      tg?.ready();
      tg?.expand();
      let initData = tg?.initData ?? "";
      if (!initData && process.env.NODE_ENV === "development") {
        initData = new URLSearchParams({
          user: JSON.stringify({ id: 7017215026, first_name: "Dev", username: "dev" }),
          auth_date: String(Math.floor(Date.now() / 1000)),
          hash: "dev",
        }).toString();
      }
      if (!initData) throw new Error("Open inside Telegram Mini App");
      const auth = await api<{ token: string }>("/auth/telegram", undefined, {
        method: "POST",
        body: JSON.stringify({ initData }),
      });
      setToken(auth.token);
      localStorage.setItem("qt_token", auth.token);
      const me = await api<Profile>("/me/profile", auth.token);
      setProfile(me);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("qt_token");
    if (saved) {
      setToken(saved);
      api<Profile>("/me/profile", saved)
        .then(setProfile)
        .catch(() => login());
    } else {
      void login();
    }
  }, [login]);

  useEffect(() => {
    if (!token) return;
    void api<{ price: number | null }>("/me/quote", token, {
      method: "POST",
      body: JSON.stringify({ trafficGb: gb, months }),
    }).then((r) => setPrice(r.price));
  }, [token, gb, months]);

  async function loadSubs() {
    if (!token) return;
    const r = await api<{ subscriptions: Sub[] }>("/me/subscriptions", token);
    setSubs(r.subscriptions);
  }

  async function loadAdmin() {
    if (!token || profile?.user.role !== "admin") return;
    const [o, m] = await Promise.all([
      api<{ orders: Array<{ id: string; summary: string; price: number }> }>("/admin/orders/pending", token),
      api<{ cells: typeof matrix }>("/admin/matrix", token),
    ]);
    setPending(o.orders);
    setMatrix(m.cells);
  }

  useEffect(() => {
    if (tab === "subs") void loadSubs();
    if (tab === "admin") void loadAdmin();
  }, [tab, token, profile]);

  async function checkout() {
    if (!token) return;
    setOrderMsg(null);
    const r = await api<{
      order: { id: string; summary: string; price: number };
      card: { number: string; holder: string };
    }>("/me/orders", token, {
      method: "POST",
      body: JSON.stringify({ trafficGb: gb, months }),
    });
    await api(`/me/orders/${r.order.id}/receipt`, token, {
      method: "POST",
      body: JSON.stringify({ receiptText: "pending-card-transfer" }),
    });
    setOrderMsg(
      `${r.order.summary}\n\nCard: ${r.card.number}\n${r.card.holder}\n\nOrder sent for admin review. Send receipt photo in the bot too.`,
    );
  }

  if (error) {
    return (
      <main className="shell">
        <p className="err">{error}</p>
        <button type="button" className="btn" onClick={() => void login()}>
          Retry
        </button>
      </main>
    );
  }

  if (!profile || !token) {
    return (
      <main className="shell">
        <p className="muted">Connecting…</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">SIGNAL SHOP</p>
        <h1>{profile.brand}</h1>
        <p className="lede">
          {profile.user.firstName ?? "User"} · {profile.user.role}
          {profile.user.panelGroup ? ` · ${profile.user.panelGroup}` : ""}
        </p>
      </header>

      <nav className="tabs">
        <button type="button" className={tab === "buy" ? "on" : ""} onClick={() => setTab("buy")}>
          Buy
        </button>
        <button type="button" className={tab === "subs" ? "on" : ""} onClick={() => setTab("subs")}>
          Services
        </button>
        {profile.user.role === "admin" && (
          <button type="button" className={tab === "admin" ? "on" : ""} onClick={() => setTab("admin")}>
            Admin
          </button>
        )}
      </nav>

      {tab === "buy" && (
        <section className="panel">
          <h2>Traffic</h2>
          <div className="chip-row">
            {volumes.map((v) => (
              <button
                key={String(v)}
                type="button"
                className={gb === v ? "chip on" : "chip"}
                onClick={() => setGb(v)}
              >
                {v === null ? "∞" : `${v}G`}
              </button>
            ))}
          </div>
          <h2>Duration</h2>
          <div className="chip-row">
            {[1, 2, 3].map((m) => (
              <button
                key={m}
                type="button"
                className={months === m ? "chip on" : "chip"}
                onClick={() => setMonths(m)}
              >
                {m} mo
              </button>
            ))}
          </div>
          <div className="price-block">
            <span>Total</span>
            <strong>{price === null ? "N/A" : `${price.toLocaleString()} T`}</strong>
          </div>
          <button type="button" className="btn primary" disabled={price === null} onClick={() => void checkout()}>
            Continue to pay
          </button>
          {orderMsg && <pre className="note">{orderMsg}</pre>}
        </section>
      )}

      {tab === "subs" && (
        <section className="panel">
          {subs.length === 0 && <p className="muted">No services yet.</p>}
          {subs.map((s) => (
            <article key={s.id} className="sub">
              <div>
                <strong>{s.code}</strong>
                <p>
                  {s.email} · {s.trafficLabel}
                </p>
                <p className="muted">{new Date(s.expiresAt).toLocaleDateString()}</p>
              </div>
              {s.subUrl && (
                <a className="link" href={s.subUrl} target="_blank" rel="noreferrer">
                  Open sub
                </a>
              )}
              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    void api(`/me/subscriptions/${s.id}/rotate-sub`, token, { method: "POST" }).then(loadSubs)
                  }
                >
                  New sub link
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    void api(`/me/subscriptions/${s.id}/rotate-uuid`, token, { method: "POST" }).then(loadSubs)
                  }
                >
                  New config
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === "admin" && profile.user.role === "admin" && (
        <section className="panel">
          <h2>Pending orders</h2>
          {pending.length === 0 && <p className="muted">Queue empty.</p>}
          {pending.map((o) => (
            <article key={o.id} className="sub">
              <pre className="note">{o.summary}</pre>
              <div className="row">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void api(`/admin/orders/${o.id}/approve`, token, { method: "POST" }).then(loadAdmin)
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    void api(`/admin/orders/${o.id}/reject`, token, { method: "POST" }).then(loadAdmin)
                  }
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
          <h2>Price matrix</h2>
          <div className="matrix">
            {matrix.slice(0, 24).map((c) => (
              <div key={`${c.trafficGb}-${c.months}`} className="matrix-row">
                <span>
                  {c.trafficGb ?? "∞"} / {c.months}m
                </span>
                <span>
                  U {c.priceUser.toLocaleString()} · P {c.pricePartner.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
