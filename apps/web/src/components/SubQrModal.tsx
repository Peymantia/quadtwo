"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "./Modal";
import { Icon } from "./DashShell";

function qrColors() {
  if (typeof document === "undefined") {
    return { dark: "#0f172a", light: "#ffffff" };
  }
  const theme = document.documentElement.dataset.theme;
  const isLight = theme === "light";
  // Light theme: dark modules on white. Dark theme: light modules on deep panel.
  return isLight
    ? { dark: "#0f172a", light: "#ffffff" }
    : { dark: "#e2e8f0", light: "#12162e" };
}

/** QR modal for a subscription URL — follows light/dark theme. */
export function SubQrModal({
  open,
  title = "QR Code",
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
    const colors = qrColors();
    void QRCode.toDataURL(subUrl, {
      width: 280,
      margin: 2,
      color: colors,
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
          <img className="sub-qr-img" src={src} alt="QR Code اشتراک" width={280} height={280} />
        )}
        <p className="muted sub-qr-hint">با اپ کلاینت اسکن کنید</p>
        <button type="button" className="btn ghost wide" onClick={onClose}>
          <Icon name="close" size={15} />
          بستن
        </button>
      </div>
    </Modal>
  );
}
