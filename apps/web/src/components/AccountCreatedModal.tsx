"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "./Modal";
import { Icon } from "./DashShell";
import { SubAddonsBar } from "./SubAddonsBar";
import { SubQrModal } from "./SubQrModal";
import type { CryptoPayInfo } from "./CryptoPayModal";
import { api } from "../lib/api";
import { formatExpiryDate, formatTrafficGbFa } from "../lib/format-ui";

export type CreatedAccount = {
  subscriptionId?: string;
  code: string;
  email?: string;
  subUrl?: string | null;
  expiresAt?: string | null;
  expiresHint?: string | null;
  qrDataUrl?: string | null;
  note?: string | null;
  trafficGb?: number | null;
  title?: string | null;
  categoryLabel?: string | null;
  months?: number | null;
  isTest?: boolean;
};

function fmtExpiry(iso?: string | null) {
  return formatExpiryDate(iso);
}

function trafficLabel(gb?: number | null) {
  return formatTrafficGbFa(gb);
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function qrThemeColors() {
  if (typeof document === "undefined") {
    return { dark: "#0f172a", light: "#ffffff" };
  }
  const isLight = document.documentElement.dataset.theme === "light";
  return isLight
    ? { dark: "#0f172a", light: "#ffffff" }
    : { dark: "#e2e8f0", light: "#12162e" };
}

/** Success dialog after account provision — details + QR + copy + service actions. */
export function AccountCreatedModal({
  open,
  account,
  onClose,
  onCopied,
  walletBalance = 0,
  onPayCard,
  onPayCrypto,
  onRefresh,
  isAdmin,
}: {
  open: boolean;
  account: CreatedAccount | null;
  onClose: () => void;
  onCopied?: () => void;
  walletBalance?: number;
  onPayCard?: (orderId: string, price: number, card: { number: string; holder: string }) => void;
  onPayCrypto?: (orderId: string, price: number, crypto: CryptoPayInfo) => void;
  onRefresh?: () => void;
  isAdmin?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [b64Open, setB64Open] = useState(false);
  const [b64, setB64] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFlash(null);
      setErr(null);
      setBusy(false);
      setQrSrc(null);
      setQrOpen(false);
      setNoteOpen(false);
      setB64Open(false);
      setB64(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !account?.subUrl) {
      setQrSrc(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(account.subUrl, {
      width: 220,
      margin: 2,
      color: qrThemeColors(),
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, account?.subUrl]);

  if (!open || !account) return null;

  const acct = account;
  const subId = acct.subscriptionId;
  const simpleTest = Boolean(acct.isTest);
  const expiryValue =
    acct.expiresHint?.trim() ||
    (acct.expiresAt ? fmtExpiry(acct.expiresAt) : "—");

  const rows: Array<{ label: string; value: string; ltr?: boolean }> = [
    { label: "کد", value: acct.code, ltr: true },
    ...(acct.email ? [{ label: "ایمیل / نام", value: acct.email, ltr: true }] : []),
    ...(acct.title && acct.title !== acct.email ? [{ label: "عنوان", value: acct.title }] : []),
    ...(acct.categoryLabel ? [{ label: "دسته", value: acct.categoryLabel }] : []),
    { label: "حجم", value: trafficLabel(acct.trafficGb) },
    ...(acct.months != null && acct.months > 0
      ? [{ label: "مدت", value: `${acct.months.toLocaleString("fa-IR")} ماه` }]
      : []),
    { label: "انقضا", value: expiryValue, ltr: Boolean(acct.expiresAt && !acct.expiresHint) },
    ...(acct.note?.trim() ? [{ label: "نوت", value: acct.note.trim() }] : []),
  ];

  async function copy(text: string, okMsg: string) {
    const ok = await copyToClipboard(text);
    if (ok) {
      setFlash(okMsg);
      setErr(null);
      if (okMsg.includes("کپی")) onCopied?.();
    } else {
      setErr("کپی ناموفق بود");
    }
  }

  function openBase64() {
    if (!subId) return;
    setB64(null);
    setB64Open(true);
    setBusy(true);
    void api<{ base64: string }>(`/me/subscriptions/${subId}/secure-base64`)
      .then((r) => setB64(r.base64))
      .catch((e) => setErr(String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  }

  async function saveNote() {
    if (!subId) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/me/subscriptions/${subId}/note`, {
        method: "PATCH",
        body: { note: noteDraft },
      });
      setFlash("یادداشت ذخیره شد");
      setNoteOpen(false);
      onRefresh?.();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={acct.isTest ? "اکانت تست ساخته شد" : "اکانت ساخته شد"} onClose={onClose} wide>
      <div className="acct-created">
        <p className="acct-created-lead">
          اشتراک آماده است — لینک را کپی کنید یا QR را اسکن کنید.
        </p>

        <div className="acct-created-body">
          <dl className="acct-created-meta">
            {rows.map((r) => (
              <div key={r.label} className="acct-created-row">
                <dt>{r.label}</dt>
                <dd dir={r.ltr ? "ltr" : undefined} className={r.ltr ? "num url-break" : undefined}>
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>

          {acct.subUrl ? (
            <div className="acct-created-qr-panel">
              {qrSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="acct-created-qr"
                  src={qrSrc}
                  alt="QR Code اشتراک"
                  width={180}
                  height={180}
                  onClick={() => setQrOpen(true)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setQrOpen(true);
                  }}
                />
              ) : (
                <div className="acct-created-qr-placeholder muted">QR…</div>
              )}
              <p className="muted acct-created-qr-hint">برای بزرگ‌نمایی روی QR بزنید</p>
            </div>
          ) : null}
        </div>

        {acct.subUrl ? (
          <div className="acct-created-link">
            <a
              className="acct-created-url num url-break"
              href={acct.subUrl}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
            >
              {acct.subUrl}
            </a>
            <button
              type="button"
              className="btn primary sm wide"
              disabled={busy || !acct.subUrl}
              onClick={() => void copy(acct.subUrl!, "لینک اشتراک کپی شد")}
            >
              <Icon name="copy" size={15} />
              کپی لینک اشتراک
            </button>
          </div>
        ) : (
          <p className="muted">لینک اشتراک هنوز آماده نیست.</p>
        )}

        {flash && (
          <p className="muted" style={{ marginTop: 0, color: "var(--teal)" }}>
            {flash}
          </p>
        )}
        {err && (
          <p className="muted" style={{ marginTop: 0, color: "var(--pink)" }}>
            {err}
          </p>
        )}

        {simpleTest ? (
          <div className="svc-actions-grid">
            <div className="qa-row qa-row--1">
              <button
                type="button"
                className="btn sm"
                disabled={busy || !acct.subUrl}
                onClick={() => {
                  if (acct.subUrl) void copy(acct.subUrl, "لینک اشتراک کپی شد");
                }}
              >
                <Icon name="copy" size={15} />
                لینک اشتراک
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy || !subId}
                onClick={openBase64}
              >
                <Icon name="link" size={15} />
                لینک Base64 کانفیگ
              </button>
            </div>
            <div className="qa-row qa-row--2">
              <button
                type="button"
                className="btn sm"
                disabled={busy || !subId}
                onClick={() => {
                  setNoteDraft(acct.note ?? "");
                  setNoteOpen(true);
                }}
              >
                <Icon name="file" size={15} />
                یادداشت
              </button>
              <button type="button" className="btn sm" disabled={busy} onClick={onClose}>
                <Icon name="arrowRight" size={15} />
                بازگشت
              </button>
            </div>
          </div>
        ) : subId ? (
          <SubAddonsBar
            subId={subId}
            email={acct.email || acct.code}
            subUrl={acct.subUrl}
            isTest={acct.isTest}
            trafficGb={acct.trafficGb}
            note={acct.note}
            busy={busy}
            walletBalance={walletBalance}
            showBack
            isAdmin={isAdmin}
            onBusy={setBusy}
            onDone={() => onRefresh?.()}
            onPayCard={(orderId, price, card) => onPayCard?.(orderId, price, card)}
            onPayCrypto={(orderId, price, crypto) => onPayCrypto?.(orderId, price, crypto)}
            onError={(m) => setErr(m || null)}
            onMsg={(m) => {
              setFlash(m);
              if (m.includes("کپی")) onCopied?.();
            }}
            onBack={onClose}
          />
        ) : (
          <div className="actions">
            <button type="button" className="btn ghost wide" onClick={onClose}>
              <Icon name="close" size={15} />
              بستن
            </button>
          </div>
        )}
      </div>

      <SubQrModal
        open={qrOpen}
        title={`QR — ${acct.email || acct.code}`}
        subUrl={acct.subUrl}
        onClose={() => setQrOpen(false)}
      />

      <Modal open={noteOpen} title="یادداشت" onClose={() => setNoteOpen(false)}>
        <div className="field">
          <label>یادداشت</label>
          <input
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="یادداشت…"
          />
        </div>
        <div className="qa-row qa-row--1" dir="ltr" style={{ marginTop: 12 }}>
          <button type="button" className="btn sm primary" disabled={busy} onClick={() => void saveNote()}>
            <Icon name="check" size={15} />
            ذخیره
          </button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => setNoteOpen(false)}>
            <Icon name="close" size={15} />
            انصراف
          </button>
        </div>
      </Modal>

      <Modal open={b64Open} title="لینک Base64 کانفیگ" onClose={() => setB64Open(false)}>
        <p className="muted" style={{ marginTop: 0 }}>
          برای کپی، روی متن بزنید.
        </p>
        {b64 ? (
          <button
            type="button"
            className="tap-copy"
            onClick={() => void copy(b64, "لینک Base64 کپی شد")}
          >
            {b64}
          </button>
        ) : (
          <p className="muted">در حال آماده‌سازی…</p>
        )}
      </Modal>
    </Modal>
  );
}
