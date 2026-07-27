"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { SubAddonsBar } from "./SubAddonsBar";
import type { CryptoPayInfo } from "./CryptoPayModal";

export type CreatedAccount = {
  subscriptionId?: string;
  code: string;
  email?: string;
  subUrl?: string | null;
  expiresAt?: string | null;
  qrDataUrl?: string | null;
  note?: string | null;
  trafficGb?: number | null;
  title?: string | null;
  categoryLabel?: string | null;
  months?: number | null;
  isTest?: boolean;
};

function fmtExpiry(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fa-IR");
  } catch {
    return iso;
  }
}

function trafficLabel(gb?: number | null) {
  if (gb == null || gb <= 0) return "نامحدود";
  return `${gb.toLocaleString("fa-IR")} گیگابایت`;
}

/** Success dialog after account provision — details + full service action grid. */
export function AccountCreatedModal({
  open,
  account,
  onClose,
  onCopied,
  walletBalance = 0,
  onPayCard,
  onPayCrypto,
  onRefresh,
}: {
  open: boolean;
  account: CreatedAccount | null;
  onClose: () => void;
  onCopied?: () => void;
  walletBalance?: number;
  onPayCard?: (orderId: string, price: number, card: { number: string; holder: string }) => void;
  onPayCrypto?: (orderId: string, price: number, crypto: CryptoPayInfo) => void;
  onRefresh?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFlash(null);
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  if (!open || !account) return null;

  const acct = account;
  const subId = acct.subscriptionId;

  const rows: Array<{ label: string; value: string; ltr?: boolean }> = [
    { label: "کد", value: acct.code, ltr: true },
    ...(acct.email ? [{ label: "ایمیل / نام", value: acct.email, ltr: true }] : []),
    ...(acct.title && acct.title !== acct.email ? [{ label: "عنوان", value: acct.title }] : []),
    ...(acct.categoryLabel ? [{ label: "دسته", value: acct.categoryLabel }] : []),
    { label: "حجم", value: trafficLabel(acct.trafficGb) },
    ...(acct.months != null && acct.months > 0
      ? [{ label: "مدت", value: `${acct.months.toLocaleString("fa-IR")} ماه` }]
      : []),
    { label: "انقضا", value: fmtExpiry(acct.expiresAt), ltr: true },
    ...(acct.note?.trim() ? [{ label: "نوت", value: acct.note.trim() }] : []),
  ];

  return (
    <Modal open={open} title="اکانت ساخته شد" onClose={onClose} wide>
      <div className="acct-created">
        <p className="acct-created-lead">اشتراک آماده است — از دکمه‌های زیر لینک بگیرید یا سرویس را مدیریت کنید.</p>

        <dl className="acct-created-meta">
          {rows.map((r) => (
            <div key={r.label} className="acct-created-row">
              <dt>{r.label}</dt>
              <dd className={r.ltr ? "num url-break" : undefined}>{r.value}</dd>
            </div>
          ))}
        </dl>

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

        {subId ? (
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
          acct.subUrl && (
            <div className="acct-created-link">
              <div className="muted num url-break" dir="ltr">
                {acct.subUrl}
              </div>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
