"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { PaymentAmountBlock } from "./PaymentCard";

export type CryptoPayInfo = {
  asset: string;
  network: string;
  address: string;
  note?: string;
};

/**
 * Crypto payment dialog: destination address, amount, tx hash / receipt.
 */
export function CryptoPayModal({
  open,
  title = "پرداخت کریپتو",
  amount,
  crypto,
  busy,
  onPaid,
  onSendReceipt,
  onCancel,
  onCopied,
}: {
  open: boolean;
  title?: string;
  amount: number;
  crypto: CryptoPayInfo;
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

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(crypto.address);
      onCopied?.();
    } catch {
      /* ignore */
    }
  }

  return (
    <Modal open={open} title={title} onClose={close}>
      <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
        مبلغ را با {crypto.asset} روی شبکه {crypto.network} به آدرس زیر واریز کنید. سپس هش تراکنش یا رسید را ارسال کنید.
      </p>

      <div className="pay-dest-card" style={{ marginBottom: 12 }}>
        <div className="muted" style={{ fontSize: "0.8rem", marginBottom: 4 }}>
          {crypto.asset} · {crypto.network}
        </div>
        <button type="button" className="pay-dest-number" dir="ltr" onClick={() => void copyAddress()}>
          {crypto.address}
        </button>
        <p className="hint" style={{ margin: "8px 0 0" }}>
          برای کپی روی آدرس بزنید
        </p>
        {crypto.note ? (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
            {crypto.note}
          </p>
        ) : null}
      </div>

      <PaymentAmountBlock amount={amount} />

      {receiptOpen ? (
        <div style={{ marginTop: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>هش تراکنش / متن رسید</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="مثلاً TxID یا توضیح واریز"
              dir="ltr"
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
            ارسال هش / رسید
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={close}>
            لغو
          </button>
        </div>
      )}
    </Modal>
  );
}
