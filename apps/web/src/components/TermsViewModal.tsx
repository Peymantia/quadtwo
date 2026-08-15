"use client";

import { Modal } from "./Modal";

/** Read-only terms viewer for non-admin dashboards. */
export function TermsViewModal({
  open,
  text,
  onClose,
}: {
  open: boolean;
  text: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Modal open title="قوانین پیـنگ" onClose={onClose} wide>
      <pre
        className="muted"
        style={{
          whiteSpace: "pre-wrap",
          fontFamily: "inherit",
          margin: 0,
          lineHeight: 1.75,
          maxHeight: "min(70vh, 560px)",
          overflow: "auto",
        }}
      >
        {text}
      </pre>
      <div className="actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn primary" onClick={onClose}>
          بستن
        </button>
      </div>
    </Modal>
  );
}
