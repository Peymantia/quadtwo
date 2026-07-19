"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, homePathForRole, setToken, type Role, type SessionUser } from "../../lib/api";

type Mode = "password" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("otp");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState("Piing");

  useEffect(() => {
    const t = getToken();
    if (t) {
      api<{ user: SessionUser }>("/me/home", { token: t })
        .then((r) => router.replace(homePathForRole(r.user.role as Role)))
        .catch(() => undefined);
    }
    api<{ brand: string }>("/auth/meta", { token: null })
      .then((r) => setBrand(r.brand))
      .catch(() => undefined);
  }, [router]);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: SessionUser }>("/auth/password/login", {
        token: null,
        body: { login, password },
      });
      setToken(r.token);
      router.replace(homePathForRole(r.user.role as Role));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp() {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const r = await api<{ hint: string }>("/auth/otp/request", {
        token: null,
        body: { login },
      });
      setHint(r.hint);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: SessionUser }>("/auth/otp/verify", {
        token: null,
        body: { login, code },
      });
      setToken(r.token);
      router.replace(homePathForRole(r.user.role as Role));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="gauge" style={{ position: "fixed", top: 0, left: 0, right: 0 }} />
      <div className="login-card">
        <div className="brand-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Piing" />
          <h1>داشبورد {brand}</h1>
        </div>

        <div className="tabs">
          <button type="button" className={mode === "otp" ? "on" : ""} onClick={() => setMode("otp")}>
            کد یکبار مصرف
          </button>
          <button type="button" className={mode === "password" ? "on" : ""} onClick={() => setMode("password")}>
            رمز عبور
          </button>
        </div>

        {mode === "password" ? (
          <form onSubmit={onPassword}>
            <div className="field">
              <label>آی‌دی تلگرام یا یوزرنیم</label>
              <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="@username یا 123456" required />
            </div>
            <div className="field">
              <label>رمز عبور</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn primary" disabled={busy} type="submit">
              ورود
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <div className="field">
              <label>آی‌دی تلگرام یا یوزرنیم</label>
              <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="@username یا 123456" required />
            </div>
            <button className="btn ghost" type="button" disabled={busy || !login} onClick={requestOtp} style={{ width: "100%", marginBottom: 12 }}>
              ارسال کد به تلگرام
            </button>
            <div className="field">
              <label>کد ۶ رقمی</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required />
            </div>
            <button className="btn primary" disabled={busy} type="submit">
              تأیید و ورود
            </button>
          </form>
        )}

        {hint && <p className="ok">{hint}</p>}
        {error && <p className="err">{error}</p>}
        <p className="hint">اول یک‌بار در ربات /start بزنید. رمز را بعد از ورود OTP می‌توانید تنظیم کنید.</p>
      </div>
    </div>
  );
}
