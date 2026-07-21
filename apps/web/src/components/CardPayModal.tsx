"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { PaymentAmountBlock, PaymentCardBlock } from "./PaymentCard";

type Card = { number: string; holder: string };

/**
 * Card-to-card payment dialog: destination card, amount, paid / receipt / cancel.
 */
export function CardPayModal({
  open,
  title = "پرداخت کارت به کارت",
  amount,
  card,
  busy,
  onPaid,
  onSendReceipt,
  onCancel,
  onCopied,
}: {
  open: boolean;
  title?: string;
  amount: number;
  card: Card;
  busy?: boolean;
  onPaid: () => void | Promise<void>;
  onSendReceipt: (note: string) => void | Promise<void>;
  onCancel: () => void;
  onCopied?: () => void;
}) {
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [note, setNote] = useState("");

  function close() {
    setReceiptOpen(false);
    setNote("");
    onCancel();
  }

  return (
    <Modal open={open} title={title} onClose={close}>
      <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
        مبلغ را به کارت زیر واریز کنید. پس از پرداخت، وضعیت را اعلام کنید تا ادمین بررسی کند.
      </p>

      <PaymentCardBlock number={card.number} holder={card.holder} onCopied={onCopied} />
      <PaymentAmountBlock amount={amount} />

      {receiptOpen ? (
        <div style={{ marginTop: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>متن رسید / شماره پیگیری</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="مثلاً شماره پیگیری یا توضیح واریز"
              autoFocus
            />
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn success"
              disabled={busy || !note.trim()}
              onClick={() => void onSendReceipt(note.trim())}
            >
              ثبت و ارسال رسید
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setReceiptOpen(false)}>
              بازگشت
            </button>
          </div>
        </div>
      ) : (
        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn success" disabled={busy} onClick={() => void onPaid()}>
            پرداخت شد
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => setReceiptOpen(true)}>
            ارسال رسید
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={close}>
            لغو
          </button>
        </div>
      )}
    </Modal>
  );
}
