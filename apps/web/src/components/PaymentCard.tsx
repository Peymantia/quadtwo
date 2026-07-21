"use client";

import { formatToman } from "../lib/api";

export function formatCardDigits(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (!digits) return number;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/** Destination card — tap number to copy. */
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
      <button
        type="button"
        className="pay-dest-number num"
        dir="ltr"
        title="کلیک برای کپی"
        onClick={() => {
          void navigator.clipboard.writeText(number.replace(/\D/g, "") || number);
          onCopied?.();
        }}
      >
        {formatCardDigits(number)}
      </button>
      <div className="pay-dest-hint">برای کپی روی شماره بزنید</div>
      {holder ? <div className="pay-dest-holder">{holder}</div> : null}
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

export function TrafficProgress({
  usedBytes,
  totalGb,
}: {
  usedBytes: number;
  totalGb: number | null;
}) {
  const totalBytes = totalGb != null && totalGb > 0 ? totalGb * 1024 ** 3 : 0;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;
  const usedLabel =
    usedBytes <= 0
      ? "۰"
      : usedBytes >= 1024 ** 3
        ? `${(usedBytes / 1024 ** 3).toFixed(2)} GB`
        : `${Math.round(usedBytes / 1024 ** 2)} MB`;

  return (
    <div className="traffic-progress" style={{ marginTop: 8 }}>
      <div className="traffic-progress-track">
        <div
          className={`traffic-progress-fill${pct >= 90 ? " danger" : pct >= 70 ? " warn" : ""}`}
          style={{ width: `${totalBytes > 0 ? pct : Math.min(8, usedBytes > 0 ? 8 : 0)}%` }}
        />
      </div>
      <div className="traffic-progress-meta num">
        {totalBytes > 0
          ? `${pct}% · ${usedLabel} از ${totalGb} GB`
          : `${usedLabel} مصرف‌شده${totalGb === null ? " (نامحدود)" : ""}`}
      </div>
    </div>
  );
}
