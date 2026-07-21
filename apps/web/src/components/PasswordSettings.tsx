"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { canUsePasskey, passkeyErrorMessage, registerPasskey } from "../lib/passkey";

type Props = {
  hasPassword: boolean;
  onSaved?: () => void;
  onFlash?: (ok: string | null, err?: string | null) => void;
};

type PasskeyRow = {
  id: string;
  label: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Shared password + passkey settings for all dashboard roles. */
export function PasswordSettings({ hasPassword, onSaved, onFlash }: Props) {
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [passBusy, setPassBusy] = useState(false);

  const loadPasskeys = useCallback(() => {
    void api<{ passkeys: PasskeyRow[] }>("/me/passkeys")
      .then((r) => setPasskeys(r.passkeys))
      .catch(() => setPasskeys([]));
  }, []);

  useEffect(() => {
    void canUsePasskey().then(setPasskeyOk);
    loadPasskeys();
  }, [loadPasskeys]);

  async function save() {
    if (password.length < 8) {
      onFlash?.(null, "رمز باید حداقل ۸ کاراکتر باشد");
      return;
    }
    setBusy(true);
    try {
      await api("/me/password", {
        body: { password, currentPassword: currentPassword || undefined },
      });
      setPassword("");
      setCurrentPassword("");
      onFlash?.("رمز عبور ذخیره شد ✅ از این پس می‌توانید بدون OTP وارد شوید.");
      onSaved?.();
    } catch (e) {
      onFlash?.(null, String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setPassBusy(true);
    try {
      await registerPasskey("Face ID / اثرانگشت");
      onFlash?.("Passkey ثبت شد ✅ از این پس می‌توانید با Face ID / اثرانگشت وارد شوید.");
      loadPasskeys();
      onSaved?.();
    } catch (e) {
      onFlash?.(null, passkeyErrorMessage(e));
    } finally {
      setPassBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setPassBusy(true);
    try {
      await api(`/me/passkeys/${id}`, { method: "DELETE" });
      onFlash?.("Passkey حذف شد");
      loadPasskeys();
      onSaved?.();
    } catch (e) {
      onFlash?.(null, String(e instanceof Error ? e.message : e));
    } finally {
      setPassBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <h2>ورود با Face ID / اثرانگشت</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Passkey روی همین دستگاه ثبت می‌شود و ورود بعدی با بیومتریک (بدون OTP) انجام می‌شود. نیاز به HTTPS دارد.
        </p>
        {!passkeyOk && (
          <p className="hint" style={{ marginTop: 0 }}>
            این مرورگر یا دستگاه از WebAuthn پشتیبانی نمی‌کند، یا روی HTTP معمولی هستید.
          </p>
        )}
        <div className="list" style={{ marginBottom: 12 }}>
          {passkeys.map((p) => (
            <div key={p.id} className="row-card" style={{ alignItems: "center" }}>
              <div>
                <strong>{p.label}</strong>
                <div className="muted">
                  ثبت: {new Date(p.createdAt).toLocaleDateString("fa-IR")}
                  {p.lastUsedAt ? ` · آخرین ورود: ${new Date(p.lastUsedAt).toLocaleDateString("fa-IR")}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="btn danger sm"
                disabled={passBusy}
                onClick={() => void removePasskey(p.id)}
              >
                حذف
              </button>
            </div>
          ))}
          {!passkeys.length && <p className="muted">هنوز Passkeyای ثبت نشده.</p>}
        </div>
        <button type="button" className="btn success" disabled={!passkeyOk || passBusy} onClick={() => void addPasskey()}>
          {passBusy ? "در حال ثبت…" : "فعال‌سازی Face ID / اثرانگشت"}
        </button>
      </div>

      <div className="panel">
        <h2>رمز ورود مستقیم</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          با تنظیم رمز، بدون نیاز به کد یکبارمصرف از ربات وارد داشبورد می‌شوید.
        </p>
        {hasPassword ? (
          <p className="muted" style={{ marginTop: 0 }}>
            رمز قبلاً تنظیم شده — برای تغییر، رمز فعلی و رمز جدید را وارد کنید.
          </p>
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>
            هنوز رمزی ندارید؛ همین‌جا یک رمز جدید بسازید.
          </p>
        )}
        {hasPassword && (
          <div className="field">
            <label>رمز فعلی</label>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        )}
        <div className="field">
          <label>رمز جدید (حداقل ۸ کاراکتر)</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="button" className="btn primary" disabled={busy || password.length < 8} onClick={() => void save()}>
          {busy ? "در حال ذخیره…" : hasPassword ? "تغییر رمز عبور" : "ذخیره رمز عبور"}
        </button>
      </div>
    </>
  );
}
