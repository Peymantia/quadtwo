"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "./Modal";

/** Dark-themed QR modal for a subscription URL. */
export function SubQrModal({
  open,
  title = "QR اشتراک",
  subUrl,
  onClose,
}: {
  open: boolean;
  title?: string;
  subUrl: string | null | undefined;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !subUrl) {
      setSrc(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setErr(null);
    void QRCode.toDataURL(subUrl, {
      width: 280,
      margin: 2,
      color: { dark: "#e2e8f0", light: "#12162e" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setErr("ساخت QR ناموفق بود");
      });
    return () => {
      cancelled = true;
    };
  }, [open, subUrl]);

  return (
    <Modal open={open && Boolean(subUrl)} title={title} onClose={onClose}>
      <div className="sub-qr-modal">
        {err && <p className="err">{err}</p>}
        {!err && !src && <p className="muted">در حال ساخت QR…</p>}
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sub-qr-img" src={src} alt="QR کد اشتراک" width={280} height={280} />
        )}
        <p className="muted sub-qr-hint">با اپ کلاینت اسکن کنید</p>
        <button type="button" className="btn ghost wide" onClick={onClose}>
          بستن
        </button>
      </div>
    </Modal>
  );
}
