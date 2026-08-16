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
      <div className="terms-modal-body">
        <pre className="terms-modal-text muted">{text}</pre>
        <div className="terms-modal-actions actions">
          <button type="button" className="btn primary" onClick={onClose}>
            قوانین را مطالعه کردم. بستن صفحه
          </button>
        </div>
      </div>
    </Modal>
  );
}
