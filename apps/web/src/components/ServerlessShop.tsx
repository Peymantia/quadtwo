"use client";

import { useEffect, useMemo, useState } from "react";
import { formatToman } from "../lib/api";
import { ACCOUNT_NAME_HINT, filterAccountNameInput, isValidAccountName } from "../lib/account-name";

export type ServerlessDuration = {
  id: string;
  months: number;
  label: string;
  minGb: number;
  maxGb: number;
  step: number;
};

export type ServerlessCatalog = {
  serverless: true;
  discountsEnabled?: boolean;
  serverlessPricing: {
    pricePerGb: number;
    pricePerMonth: number;
    durations: ServerlessDuration[];
  };
};

export type ServerlessOrderPayload = {
  trafficGb: number;
  months: number;
  category: "serverless";
  quantity: 1;
  accountName?: string;
  discountCode?: string | null;
};

type Props = {
  catalog: ServerlessCatalog;
  busy: boolean;
  onSubmit: (payload: ServerlessOrderPayload) => void | Promise<void>;
};

function calcPrice(gb: number, months: number, perGb: number, perMonth: number, isAdminFree: boolean) {
  if (isAdminFree) return 0;
  if (months <= 0) return gb * perGb;
  return gb * perGb + months * perMonth;
}

export function ServerlessShop({ catalog, busy, onSubmit }: Props) {
  const durations = catalog.serverlessPricing.durations;
  const [durIdx, setDurIdx] = useState(0);
  const duration = durations[durIdx] ?? durations[0];
  const [gb, setGb] = useState(duration?.minGb ?? 1);
  const [name, setName] = useState("");
  const [discountCode, setDiscountCode] = useState("");

  useEffect(() => {
    if (!duration) return;
    setGb((g) => Math.max(duration.minGb, Math.min(duration.maxGb, g)));
  }, [duration]);

  const price = useMemo(() => {
    if (!duration) return null;
    return calcPrice(
      gb,
      duration.months,
      catalog.serverlessPricing.pricePerGb,
      catalog.serverlessPricing.pricePerMonth,
      false,
    );
  }, [gb, duration, catalog.serverlessPricing.pricePerGb, catalog.serverlessPricing.pricePerMonth]);

  if (!duration) {
    return <p className="muted">در شرایط فعلی هیچ پلنی برای خرید فعال نیست.</p>;
  }

  return (
    <div className="serverless-shop">
      <p className="muted" style={{ marginTop: 0 }}>
        مدت اعتبار را انتخاب کنید، سپس حجم را تنظیم کنید.
      </p>
      <div className="chip-row" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {durations.map((d, i) => (
          <button
            key={d.id}
            type="button"
            className={`chip${i === durIdx ? " on" : ""}`}
            disabled={busy}
            onClick={() => setDurIdx(i)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="setting-row" style={{ marginBottom: 12 }}>
        <div>
          <div className="t">حجم: {gb} گیگ</div>
          <div className="d">
            از {duration.minGb} تا {duration.maxGb} گیگ
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn sm"
            disabled={busy || gb <= duration.minGb}
            onClick={() => setGb((g) => Math.max(duration.minGb, g - (duration.step || 1)))}
          >
            −
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy || gb >= duration.maxGb}
            onClick={() => setGb((g) => Math.min(duration.maxGb, g + (duration.step || 1)))}
          >
            +
          </button>
        </div>
      </div>

      <div className="field">
        <label>نام اکانت (اختیاری)</label>
        <input
          dir="ltr"
          value={name}
          disabled={busy}
          placeholder="Ali_01"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(filterAccountNameInput(e.target.value))}
        />
        <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
          {ACCOUNT_NAME_HINT}
        </p>
      </div>

      {catalog.discountsEnabled && (
        <div className="field">
          <label>کد تخفیف</label>
          <input
            value={discountCode}
            disabled={busy}
            onChange={(e) => setDiscountCode(e.target.value)}
          />
        </div>
      )}

      <div style={{ margin: "12px 0", fontWeight: 600 }}>
        مبلغ: {price == null ? "—" : formatToman(price)}
      </div>

      <button
        type="button"
        className="btn success"
        disabled={busy || (Boolean(name.trim()) && !isValidAccountName(name))}
        onClick={() => {
          const trimmed = name.trim();
          if (trimmed && !isValidAccountName(trimmed)) return;
          void onSubmit({
            trafficGb: gb,
            months: duration.months,
            category: "serverless",
            quantity: 1,
            accountName: trimmed || undefined,
            discountCode: discountCode.trim() || null,
          });
        }}
      >
        ادامه خرید
      </button>
    </div>
  );
}
