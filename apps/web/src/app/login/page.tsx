"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, homePathForRole, setToken, type Role, type SessionUser } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  function finishLogin(r: { token: string; user: SessionUser }) {
    setToken(r.token);
    router.replace(homePathForRole(r.user.role as Role));
  }

  async function requestOtp() {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const r = await api<{ hint: string }>("/auth/otp/request", { token: null, body: { login } });
      setHint(r.hint);
      setOtpSent(true);
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
      finishLogin(r);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: SessionUser }>("/auth/password/login", {
        token: null,
        body: { login, password },
      });
      finishLogin(r);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-inner">
        <div className="logo-orb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={brand} />
        </div>
        <p className="brand-word">{brand}</p>
        <h1 className="login-title">
          ورود به <em>حساب</em>
        </h1>
        <p className="login-sub">برای ورود یکی از روش‌های زیر را انتخاب کنید</p>

        <div className="login-card">
          {error && <div className="alert err">{error}</div>}
          {hint && !error && <div className="alert ok">{hint}</div>}

          <form onSubmit={verifyOtp}>
            <div className="field">
              <label>آی‌دی عددی تلگرام یا یوزرنیم</label>
              <input
                dir="ltr"
                style={{ textAlign: "center" }}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="@username یا 123456789"
                autoComplete="username"
                required
              />
            </div>

            <button
              className="btn success wide"
              type="button"
              disabled={busy || !login.trim()}
              onClick={requestOtp}
              style={{ marginBottom: 12 }}
            >
              دریافت کد ورود از ربات
            </button>

            {otpSent && (
              <>
                <div className="field">
                  <label>کد ۶ رقمی ارسال‌شده در تلگرام</label>
                  <input
                    className="num"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    style={{ textAlign: "center", letterSpacing: "0.4em", fontSize: "1.2rem" }}
                    required
                  />
                </div>
                <button className="btn primary wide" disabled={busy || code.length < 6} type="submit">
                  تأیید و ورود
                </button>
              </>
            )}
          </form>

          <div className="or-divider">یا</div>

          <button type="button" className="collapse-toggle" onClick={() => setShowPassword((v) => !v)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="5" y="10" width="14" height="10" rx="2.5" />
              <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
            </svg>
            ورود با رمز عبور
            <svg
              className={`chev${showPassword ? " open" : ""}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showPassword && (
            <form onSubmit={onPassword} style={{ marginTop: 10 }}>
              <div className="field">
                <label>رمز عبور</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <button className="btn primary wide" disabled={busy || !login.trim() || !password} type="submit">
                ورود
              </button>
            </form>
          )}
        </div>

        <p className="login-foot">
          رمز عبور ندارید؟ از ربات تلگرام استفاده کنید،
          <br />
          بعد از ورود می‌توانید رمز تنظیم کنید.
        </p>
      </div>
    </div>
  );
}
