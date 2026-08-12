"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll, unlockBodyScroll } from "../lib/body-scroll-lock";
import { getFocusable, rememberFocus, trapFocus } from "../lib/focus-trap";

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
    const t = setTimeout(onClear, err ? 8000 : 2800);
    return () => clearTimeout(t);
  }, [msg, err, onClear]);

  if (!msg && !err) return null;
  if (typeof document === "undefined") return null;

  const isErr = Boolean(err);

  return createPortal(
    <div className="toast-wrap" role={isErr ? "alert" : "status"} aria-live={isErr ? "assertive" : "polite"}>
      <div className={`toast ${isErr ? "err" : "ok"}`} onClick={onClear}>
        {err ?? msg}
      </div>
    </div>,
    document.body,
  );
}

/** Centered yes/no confirm dialog (replaces window.confirm). Portaled above Modals. */
export function ConfirmToast({
  message,
  onYes,
  onNo,
}: {
  message: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const onNoRef = useRef(onNo);
  onNoRef.current = onNo;

  useEffect(() => {
    const restore = rememberFocus();
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onNoRef.current();
      if (panelRef.current) trapFocus(panelRef.current, e);
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask(() => {
      const first = panelRef.current ? getFocusable(panelRef.current)[0] : null;
      (first ?? yesRef.current)?.focus();
    });
    return () => {
      unlockBodyScroll();
      window.removeEventListener("keydown", onKey);
      restore();
    };
  }, [onNo]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="toast-wrap toast-wrap-modal"
      role="presentation"
      onClick={() => onNoRef.current()}
    >
      <div
        ref={panelRef}
        className="toast confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={(e) => e.stopPropagation()}
      >
        <p id={labelId} className="toast-confirm-msg">
          {message}
        </p>
        <div className="toast-confirm-actions">
          <button ref={yesRef} type="button" className="btn success sm" onClick={onYes}>
            تأیید
          </button>
          <button type="button" className="btn ghost sm" onClick={() => onNoRef.current()}>
            لغو
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
