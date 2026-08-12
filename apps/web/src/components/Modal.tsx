"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll, unlockBodyScroll } from "../lib/body-scroll-lock";
import { getFocusable, rememberFocus, trapFocus } from "../lib/focus-trap";

/** Centered modal dialog with a small close (X) button. Portaled to body so fixed centering works in Mini App. */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const restore = rememberFocus();
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (cardRef.current) trapFocus(cardRef.current, e);
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask(() => {
      const card = cardRef.current;
      const first = card ? getFocusable(card)[0] : null;
      (first ?? closeRef.current)?.focus();
    });
    return () => {
      unlockBodyScroll();
      window.removeEventListener("keydown", onKey);
      restore();
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-overlay" onClick={() => onCloseRef.current()} role="presentation">
      <div
        ref={cardRef}
        className={`modal-card${wide ? " wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button ref={closeRef} type="button" className="modal-x" onClick={() => onCloseRef.current()} aria-label="بستن">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
