"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { SubQrModal } from "./SubQrModal";

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

/** Success dialog after account provision — details, copy sub link, optional QR. */
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
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (!open) setQrOpen(false);
  }, [open]);

  if (!open || !account) return null;

  const acct = account;

  async function copySub() {
    if (!acct.subUrl) return;
    try {
      await navigator.clipboard.writeText(acct.subUrl);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  function closeAll() {
    setQrOpen(false);
    onClose();
  }

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
    <>
      <Modal open={open && !qrOpen} title="اکانت ساخته شد" onClose={closeAll} wide>
        <div className="acct-created">
          <p className="acct-created-lead">مشخصات اکانت آماده است — لینک اشتراک را کپی کنید یا QR را باز کنید.</p>

          <dl className="acct-created-meta">
            {rows.map((r) => (
              <div key={r.label} className="acct-created-row">
                <dt>{r.label}</dt>
                <dd className={r.ltr ? "num url-break" : undefined}>{r.value}</dd>
              </div>
            ))}
          </dl>

          {acct.subUrl && (
            <div className="acct-created-link">
              <div className="muted num url-break" dir="ltr">
                {acct.subUrl}
              </div>
              <div className="acct-created-btns">
                <button type="button" className="btn primary" onClick={() => void copySub()}>
                  {copied ? "کپی شد ✓" : "کپی لینک ساب"}
                </button>
                <button type="button" className="btn ghost" onClick={() => setQrOpen(true)}>
                  📷 QR
                </button>
              </div>
            </div>
          )}

          <button type="button" className="btn ghost wide" onClick={closeAll}>
            بستن
          </button>
        </div>
      </Modal>

      <SubQrModal
        open={qrOpen}
        title={`QR — ${acct.code}`}
        subUrl={acct.subUrl}
        onClose={() => setQrOpen(false)}
      />
    </>
  );
}
