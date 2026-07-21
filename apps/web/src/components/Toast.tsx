"use client";

import { useEffect } from "react";

/** Centered toast message; auto-dismisses (errors stay a bit longer). */
export function Toast({
  msg,
  err,
  onClear,
}: {
  msg: string | null;
  err: string | null;
  onClear: () => void;
}) {
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(onClear, err ? 5000 : 2800);
    return () => clearTimeout(t);
  }, [msg, err, onClear]);

  if (!msg && !err) return null;

  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className={`toast ${err ? "err" : "ok"}`} onClick={onClear}>
        {err ?? msg}
      </div>
    </div>
  );
}

/** Centered yes/no confirm dialog (replaces window.confirm). */
export function ConfirmToast({
  message,
  onYes,
  onNo,
}: {
  message: string;
  onYes: () => void;
  onNo: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onNo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNo]);

  return (
    <div className="toast-wrap toast-wrap-modal" role="alertdialog" aria-modal="true" onClick={onNo}>
      <div className="toast confirm" onClick={(e) => e.stopPropagation()}>
        <p className="toast-confirm-msg">{message}</p>
        <div className="toast-confirm-actions">
          <button type="button" className="btn success sm" onClick={onYes}>
            بله
          </button>
          <button type="button" className="btn ghost sm" onClick={onNo}>
            خیر
          </button>
        </div>
      </div>
    </div>
  );
}
