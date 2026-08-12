"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../../components/Toast";
import { Icon } from "../../components/DashShell";
import { api, getToken, homePathForRole, setToken, type Role, type SessionUser } from "../../lib/api";
import { canUsePasskey, loginWithPasskey, passkeyErrorMessage } from "../../lib/passkey";
import { isTelegramMiniApp, loginWithTelegramWebApp } from "../../lib/telegram";
import {
  applyAppearance,
  getUserColorOverride,
  parseColorMode,
  parseUiSkin,
  readCachedAppearance,
  resolveTheme,
  toggleStudioTheme,
  type UiSkin,
} from "../../lib/theme";

const OTP_LEN = 4;
const SUCCESS_MS = 1100;

function toEnglishDigits(value: string): string {
  return value
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function digitsOnly(value: string): string {
  return toEnglishDigits(value).replace(/\D/g, "");
}

function LoginThemeToggle({ skin }: { skin: UiSkin }) {
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => {
    if (skin !== "studio") return;
    const sync = () => {
      const cached = readCachedAppearance();
      setResolved(resolveTheme(cached.colorMode));
      const dt = document.documentElement.dataset.theme;
      if (dt === "light" || dt === "dark") setResolved(dt);
    };
    sync();
    window.addEventListener("piing:appearance", sync);
    return () => window.removeEventListener("piing:appearance", sync);
  }, [skin]);

  if (skin !== "studio") return null;

  return (
    <button
      type="button"
      className="theme-toggle login-theme-toggle"
      aria-label={resolved === "light" ? "حالت تاریک" : "حالت روشن"}
      title={resolved === "light" ? "حالت تاریک" : "حالت روشن"}
      onClick={() => {
        const cached = readCachedAppearance();
        applyAppearance("studio", cached.colorMode);
        const next = toggleStudioTheme(cached.colorMode);
        setResolved(next);
        window.dispatchEvent(
          new CustomEvent("piing:appearance", { detail: { skin: "studio", colorMode: cached.colorMode } }),
        );
      }}
    >
      <Icon name={resolved === "light" ? "moon" : "sun"} size={18} />
    </button>
  );
}

function AuthSuccessOverlay({ show }: { show: boolean }) {
  return (
    <div className={`login-success-overlay${show ? " show" : ""}`} aria-hidden={!show}>
      <div className="login-success-glow" />
      <div className="login-success-wrap">
        <div className="login-success-ring" />
        <div className="login-success-circle">
          <svg className="login-success-icon" viewBox="0 0 52 52" aria-hidden>
            <path className="login-success-path" d="M14 27l7 7 16-16" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: OTP_LEN }, () => ""));
  const [otpSent, setOtpSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [brand, setBrand] = useState("پیـنگ");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uiSkin, setUiSkin] = useState<UiSkin>(() =>
    typeof window !== "undefined" ? readCachedAppearance().skin : "classic",
  );
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [tgBooting, setTgBooting] = useState(true);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join("");

  const clearFlash = useCallback(() => {
    setHint(null);
    setError(null);
  }, []);

  const setDigitAt = useCallback((index: number, value: string) => {
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const applyOtpPaste = useCallback((raw: string, startIndex = 0) => {
    const cleaned = digitsOnly(raw).slice(0, OTP_LEN - startIndex);
    if (!cleaned) return;
    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < cleaned.length; i++) {
        next[startIndex + i] = cleaned[i]!;
      }
      return next;
    });
    const focusAt = Math.min(startIndex + cleaned.length, OTP_LEN - 1);
    requestAnimationFrame(() => {
      const el = otpRefs.current[focusAt];
      el?.focus();
      el?.select();
    });
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

    // Prefer cached tenant skin; /auth/meta may refine it below.
    const cached = readCachedAppearance();
    const loginTheme = getUserColorOverride() ?? resolveTheme(cached.colorMode);
    applyAppearance(cached.skin, cached.skin === "studio" ? loginTheme : cached.colorMode);
    setUiSkin(cached.skin);

    api<{ brand: string; logoUrl?: string | null; uiSkin?: string; uiColorMode?: string }>("/auth/meta", {
      token: null,
    })
      .then((r) => {
        if (!cancelled) {
          setBrand(r.brand);
          setLogoUrl(r.logoUrl ?? null);
          const skin = parseUiSkin(r.uiSkin ?? cached.skin);
          const colorMode = parseColorMode(r.uiColorMode ?? cached.colorMode);
          const theme = getUserColorOverride() ?? resolveTheme(colorMode);
          applyAppearance(skin, skin === "studio" ? theme : colorMode);
          setUiSkin(skin);
        }
      })
      .catch(() => undefined);
    void canUsePasskey().then((ok) => {
      if (!cancelled) setPasskeyOk(ok);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (otpSent) {
      requestAnimationFrame(() => otpRefs.current[0]?.focus());
    }
  }, [otpSent]);

  async function finishLogin(r: { token: string; user: SessionUser }, withFx = false) {
    setToken(r.token);
    const dest = homePathForRole(r.user.role as Role);
    if (!withFx) {
      router.replace(dest);
      return;
    }
    setAuthSuccess(true);
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_MS));
    router.replace(dest);
  }

  async function requestOtp() {
    setBusy(true);
    clearFlash();
    try {
      const r = await api<{ hint: string }>("/auth/otp/request", { token: null, body: { login } });
      setHint(r.hint);
      setOtpSent(true);
      setDigits(Array.from({ length: OTP_LEN }, () => ""));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < OTP_LEN) return;
    setBusy(true);
    clearFlash();
    try {
      const r = await api<{ token: string; user: SessionUser }>("/auth/otp/verify", {
        token: null,
        body: { login, code },
      });
      await finishLogin(r, true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setDigits(Array.from({ length: OTP_LEN }, () => ""));
      requestAnimationFrame(() => otpRefs.current[0]?.focus());
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
      await finishLogin(r, true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setBusy(false);
    }
  }

  async function onPasskey() {
    setBusy(true);
    clearFlash();
    try {
      const r = await loginWithPasskey(login.trim() || undefined);
      await finishLogin(r, true);
    } catch (err) {
      setError(passkeyErrorMessage(err));
      setBusy(false);
    }
  }

  function onOtpInput(index: number, raw: string) {
    const cleaned = digitsOnly(raw);
    if (cleaned.length > 1) {
      applyOtpPaste(cleaned, index);
      return;
    }
    const digit = cleaned.slice(-1);
    setDigitAt(index, digit);
    if (digit && index < OTP_LEN - 1) {
      requestAnimationFrame(() => {
        otpRefs.current[index + 1]?.focus();
        otpRefs.current[index + 1]?.select();
      });
    }
  }

  function onOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        e.preventDefault();
        setDigitAt(index - 1, "");
        otpRefs.current[index - 1]?.focus();
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < OTP_LEN - 1) {
      e.preventDefault();
      otpRefs.current[index + 1]?.focus();
    }
  }

  function onOtpPaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    applyOtpPaste(e.clipboardData.getData("text"), index === 0 ? 0 : index);
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
      <div className="login-bg" aria-hidden>
        <div className="login-bg-grid" />
        <div className="login-orb login-orb-a" />
        <div className="login-orb login-orb-b" />
      </div>

      <LoginThemeToggle skin={uiSkin} />

      <Toast msg={hint} err={error} onClear={clearFlash} />

      <div className="login-inner">
        <div className="logo-orb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl || "/logo.png"} alt="" />
        </div>
        <h1 className="brand-word">{brand}</h1>
        <p className="login-sub">ورود به پنل کاربری</p>

        <div className={`login-card${authSuccess ? " auth-success" : ""}`}>
          <AuthSuccessOverlay show={authSuccess} />
          <form onSubmit={verifyOtp}>
            <div className="field">
              <label htmlFor="login-id" className="sr-only">
                یوزرنیم تلگرام یا آی‌دی عددی
              </label>
              <input
                id="login-id"
                dir="ltr"
                className="login-input"
                style={{ textAlign: "center" }}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="یوزرنیم تلگرام با @ یا عدد"
                autoComplete="username"
                required
              />
            </div>

            <div className="field otp-field">
              <div className="otp-grid" dir="ltr" role="group" aria-label="ارقام کد تایید">
                {digits.map((digit, index) => (
                  <div
                    key={index}
                    className={`otp-cell${digit ? " filled" : ""}`}
                    style={{ ["--cell-acc" as string]: `var(--otp-acc-${index + 1})` }}
                  >
                    <div className="otp-puff" aria-hidden />
                    <input
                      ref={(el) => {
                        otpRefs.current[index] = el;
                      }}
                      className="otp-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      maxLength={OTP_LEN}
                      value={digit}
                      disabled={busy}
                      aria-label={`رقم ${index + 1}`}
                      onChange={(e) => onOtpInput(index, e.target.value)}
                      onKeyDown={(e) => onOtpKeyDown(index, e)}
                      onPaste={(e) => onOtpPaste(index, e)}
                      onFocus={(e) => e.target.select()}
                    />
                    <div className="otp-bar-track" aria-hidden>
                      <div className="otp-bar-fill" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              className="btn primary wide login-submit"
              disabled={busy || !login.trim() || code.length < OTP_LEN}
              type="submit"
            >
              ورود
            </button>

            <button
              className="btn success wide login-request-otp"
              type="button"
              disabled={busy || !login.trim()}
              onClick={requestOtp}
            >
              دریافت کد ورود از ربات
            </button>

            {passkeyOk && (
              <div className="passkey-block">
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
              </div>
            )}
          </form>

          <div className="or-divider">یا</div>

          <button
            type="button"
            className="collapse-toggle"
            aria-expanded={showPassword}
            aria-controls="password-form"
            onClick={() => setShowPassword((v) => !v)}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
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
              aria-hidden
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showPassword && (
            <form id="password-form" onSubmit={onPassword} className="password-form">
              <div className="field">
                <label htmlFor="login-password">رمز عبور</label>
                <input
                  id="login-password"
                  className="login-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <button className="btn primary wide" disabled={busy || !login.trim() || !password} type="submit">
                ورود با رمز
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
