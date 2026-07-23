"use client";

import { useState } from "react";
import { Modal } from "./Modal";

export type CreatedAccount = {
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

/** Success dialog after account provision — details, copy sub link, QR. */
export function AccountCreatedModal({
  open,
  account,
  onClose,
  onCopied,
}: {
  open: boolean;
  account: CreatedAccount | null;
  onClose: () => void;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!account) return null;

  async function copySub() {
    if (!account?.subUrl) return;
    try {
      await navigator.clipboard.writeText(account.subUrl);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const rows: Array<{ label: string; value: string; ltr?: boolean }> = [
    { label: "کد", value: account.code, ltr: true },
    ...(account.email ? [{ label: "ایمیل / نام", value: account.email, ltr: true }] : []),
    ...(account.title && account.title !== account.email
      ? [{ label: "عنوان", value: account.title }]
      : []),
    ...(account.categoryLabel ? [{ label: "دسته", value: account.categoryLabel }] : []),
    { label: "حجم", value: trafficLabel(account.trafficGb) },
    ...(account.months != null && account.months > 0
      ? [{ label: "مدت", value: `${account.months.toLocaleString("fa-IR")} ماه` }]
      : []),
    { label: "انقضا", value: fmtExpiry(account.expiresAt), ltr: true },
    ...(account.note?.trim() ? [{ label: "نوت", value: account.note.trim() }] : []),
  ];

  return (
    <Modal open={open} title="اکانت ساخته شد" onClose={onClose} wide>
      <div className="acct-created">
        <p className="acct-created-lead">مشخصات اکانت آماده است — لینک اشتراک را کپی کنید یا QR را اسکن کنید.</p>

        <dl className="acct-created-meta">
          {rows.map((r) => (
            <div key={r.label} className="acct-created-row">
              <dt>{r.label}</dt>
              <dd className={r.ltr ? "num url-break" : undefined}>{r.value}</dd>
            </div>
          ))}
        </dl>

        {account.subUrl && (
          <div className="acct-created-link">
            <div className="muted num url-break" dir="ltr">
              {account.subUrl}
            </div>
            <button type="button" className="btn primary wide" onClick={() => void copySub()}>
              {copied ? "کپی شد ✓" : "کپی لینک ساب"}
            </button>
          </div>
        )}

        {account.qrDataUrl && (
          <div className="acct-created-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={account.qrDataUrl} alt="QR کد اشتراک" width={220} height={220} />
            <span className="muted">اسکن برای افزودن اشتراک</span>
          </div>
        )}

        <button type="button" className="btn ghost wide" onClick={onClose}>
          بستن
        </button>
      </div>
    </Modal>
  );
}
