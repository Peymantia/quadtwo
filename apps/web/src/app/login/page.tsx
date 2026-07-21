"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../../components/Toast";
import { api, getToken, homePathForRole, setToken, type Role, type SessionUser } from "../../lib/api";
import { canUsePasskey, loginWithPasskey, passkeyErrorMessage } from "../../lib/passkey";
import { isTelegramMiniApp, loginWithTelegramWebApp } from "../../lib/telegram";

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
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [tgBooting, setTgBooting] = useState(true);

  const clearFlash = useCallback(() => {
    setHint(null);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const t = getToken();
      if (t) {
        try {
          const r = await api<{ user: SessionUser }>("/me/home", { token: t });
          if (!cancelled) {
            router.replace(homePathForRole(r.user.role as Role));
            return;
          }
        } catch {
          /* continue */
        }
      }

      try {
        // Browser: don't wait on telegram.org CDN. Mini App bridge is usually pre-injected.
        const tg = await loginWithTelegramWebApp();
        if (tg && !cancelled) {
          router.replace(homePathForRole(tg.user.role as Role));
          return;
        }
      } catch (err) {
        if (!cancelled && isTelegramMiniApp()) {
          setError(String(err instanceof Error ? err.message : err));
        }
      }

      if (!cancelled) setTgBooting(false);
    }

    void boot();
    api<{ brand: string }>("/auth/meta", { token: null })
      .then((r) => {
        if (!cancelled) setBrand(r.brand);
      })
      .catch(() => undefined);
    void canUsePasskey().then((ok) => {
      if (!cancelled) setPasskeyOk(ok);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  function finishLogin(r: { token: string; user: SessionUser }) {
    setToken(r.token);
    router.replace(homePathForRole(r.user.role as Role));
  }

  async function requestOtp() {
    setBusy(true);
    clearFlash();
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
    clearFlash();
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
    clearFlash();
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

  async function onPasskey() {
    setBusy(true);
    clearFlash();
    try {
      const r = await loginWithPasskey(login.trim() || undefined);
      finishLogin(r);
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (tgBooting) {
    return (
      <div className="loading-page">
        <div style={{ textAlign: "center" }}>
          <div className="spinner" />
          در حال ورود…
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <Toast msg={hint} err={error} onClear={clearFlash} />

      <div className="login-inner">
        <div className="logo-orb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={brand} />
        </div>
        <p className="brand-word">{brand}</p>
        <h1 className="login-title">
          ورود به <em>حساب</em>
        </h1>
        <p className="login-sub">
          {isTelegramMiniApp()
            ? "ورود خودکار از تلگرام ناموفق بود — از روش‌های زیر استفاده کنید"
            : "برای ورود یکی از روش‌های زیر را انتخاب کنید"}
        </p>

        <div className="login-card">
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

            <div className="field">
              <label>کد یکبار مصرف (۶ رقمی)</label>
              <input
                className="num"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                autoFocus={otpSent}
                placeholder="کد را از ربات دریافت کنید"
                style={{ textAlign: "center", letterSpacing: "0.35em", fontSize: "1.15rem" }}
              />
            </div>
            <button
              className="btn primary wide"
              disabled={busy || !login.trim() || code.length < 6}
              type="submit"
              style={{ marginBottom: 12 }}
            >
              ورود
            </button>

            <button
              className="btn success wide"
              type="button"
              disabled={busy || !login.trim()}
              onClick={requestOtp}
            >
              دریافت کد ورود از ربات
            </button>

            {passkeyOk && (
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn primary wide passkey-btn"
                  disabled={busy}
                  onClick={() => void onPasskey()}
                >
                  <span className="passkey-ico" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 3a5 5 0 0 1 5 5v1h1.5A1.5 1.5 0 0 1 20 10.5v9A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-9A1.5 1.5 0 0 1 5.5 9H7V8a5 5 0 0 1 5-5Z" />
                      <circle cx="12" cy="15" r="2" />
                    </svg>
                  </span>
                  ورود با Face ID / اثرانگشت
                </button>
                <p className="hint" style={{ textAlign: "center", marginTop: 10, marginBottom: 0 }}>
                  اگر Passkey ثبت کرده‌اید، بدون OTP وارد شوید
                  {!login.trim() && (
                    <>
                      <br />
                      یا شناسه را خالی بگذارید.
                    </>
                  )}
                </p>
              </div>
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
          رمز یا Passkey ندارید؟ از ربات تلگرام کد بگیرید،
          <br />
          بعد از ورود در تنظیمات فعال کنید.
        </p>
      </div>
    </div>
  );
}
