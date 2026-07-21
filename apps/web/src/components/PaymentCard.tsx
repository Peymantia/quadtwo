"use client";

import { formatToman } from "../lib/api";

export function formatCardDigits(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (!digits) return number;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/** Prominent destination card block for card-to-card payment. */
export function PaymentCardBlock({
  number,
  holder,
  onCopied,
}: {
  number: string;
  holder?: string | null;
  onCopied?: () => void;
}) {
  return (
    <div className="pay-dest-card">
      <div className="pay-dest-label">شماره کارت مقصد</div>
      <div className="pay-dest-number num" dir="ltr">
        {formatCardDigits(number)}
      </div>
      {holder ? <div className="pay-dest-holder">{holder}</div> : null}
      <button
        type="button"
        className="btn ghost sm"
        style={{ marginTop: 12 }}
        onClick={() => {
          void navigator.clipboard.writeText(number.replace(/\D/g, "") || number);
          onCopied?.();
        }}
      >
        کپی شماره کارت
      </button>
    </div>
  );
}

export function PaymentAmountBlock({ amount }: { amount: number }) {
  return (
    <div className="pay-amount-block">
      <div className="pay-dest-label">مبلغ قابل پرداخت</div>
      <div className="pay-amount-value num">{formatToman(amount)}</div>
    </div>
  );
}
