"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatToman } from "../lib/api";
import { Modal } from "./Modal";

export type RenewInfo = {
  ok: true;
  message: string;
  category: string;
  categoryLabel: string;
  maxMonths: number;
  subscription: {
    id: string;
    code: string;
    email: string;
    trafficGb: number | null;
    trafficLabel: string;
  };
  volumeRules?: {
    data: { min: number; max: number; step: number };
    national: { min: number; max: number; step: number };
    unlimited: null;
  };
};

type Props = {
  open: boolean;
  info: RenewInfo | null;
  busy?: boolean;
  /** user: wallet + card · admin: complimentary renew */
  variant?: "user" | "admin";
  onClose: () => void;
  onSubmit: (payload: {
    trafficGb: number | null;
    months: number;
    category: string;
    payWithWallet: boolean;
  }) => void | Promise<void>;
};

function snap(value: number, min: number, max: number, step: number) {
  const n = Math.round(value / step) * step;
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function rulesFor(
  category: string,
  info: RenewInfo,
): { kind: "unlimited" } | { kind: "stepped"; min: number; max: number; step: number } {
  if (category === "unlimited") return { kind: "unlimited" };
  if (category === "national") {
    const r = info.volumeRules?.national ?? { min: 1, max: 20, step: 1 };
    return { kind: "stepped", ...r };
  }
  const r = info.volumeRules?.data ?? { min: 10, max: 50, step: 5 };
  return { kind: "stepped", ...r };
}

export function RenewModal({ open, info, busy, variant = "user", onClose, onSubmit }: Props) {
  const [gbInput, setGbInput] = useState("10");
  const [months, setMonths] = useState(1);
  const [price, setPrice] = useState<number | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  const rules = useMemo(() => (info ? rulesFor(info.category, info) : null), [info]);
  const monthOptions = useMemo(() => {
    const max = Math.max(1, Math.min(3, info?.maxMonths || 1));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [info?.maxMonths]);

  useEffect(() => {
    if (!open || !info || !rules) return;
    setMonths(1);
    if (rules.kind === "unlimited") {
      setGbInput("");
    } else {
      const cur = info.subscription.trafficGb;
      const start =
        cur != null && cur > 0 ? snap(cur, rules.min, rules.max, rules.step) : rules.min;
      setGbInput(String(start));
    }
  }, [open, info?.subscription.id, info?.category]);

  const trafficGb = useMemo(() => {
    if (!rules || rules.kind === "unlimited") return null;
    const raw = Number(gbInput.replace(/[^\d]/g, ""));
    if (!Number.isFinite(raw) || gbInput.trim() === "") return rules.min;
    return snap(raw, rules.min, rules.max, rules.step);
  }, [gbInput, rules]);

  useEffect(() => {
    if (!open || !info || !rules) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      setQuoting(true);
      setQuoteErr(null);
      void api<{ price: number }>("/me/quote", {
        body: {
          category: info.category,
          trafficGb: rules.kind === "unlimited" ? null : trafficGb,
          months: info.category === "national" ? 1 : months,
        },
      })
        .then((r) => {
          if (!cancelled) setPrice(r.price);
        })
        .catch((e) => {
          if (cancelled) return;
          setPrice(null);
          setQuoteErr(String(e instanceof Error ? e.message : e));
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, info, trafficGb, months, rules]);

  function bumpGb(dir: 1 | -1) {
    if (!rules || rules.kind !== "stepped") return;
    const cur = trafficGb ?? rules.min;
    setGbInput(String(snap(cur + dir * rules.step, rules.min, rules.max, rules.step)));
  }

  const canSubmit = !busy && !quoting && price != null && Boolean(info);

  async function submit(payWithWallet: boolean) {
    if (!info || !rules) return;
    await onSubmit({
      category: info.category,
      trafficGb: rules.kind === "unlimited" ? null : trafficGb,
      months: info.category === "national" ? 1 : months,
      payWithWallet,
    });
  }

  return (
    <Modal open={open && Boolean(info)} title="تمدید سرویس" onClose={onClose}>
      {info && rules && (
        <div className="rate-shop renew-shop">
          <p className="muted" style={{ marginTop: 0 }}>
            سرویس: <strong className="num">{info.subscription.code}</strong>
            {" · "}
            {info.subscription.email}
          </p>
          <p className="muted" style={{ marginTop: 0 }}>
            حجم فعلی: {info.subscription.trafficLabel}
            {" · "}
            نوع: {info.categoryLabel}
          </p>
          {info.message && (
            <p className="muted" style={{ marginTop: 0 }}>
              {info.message}
            </p>
          )}

          {rules.kind === "unlimited" ? (
            <div className="rate-shop-card">
              <div className="rate-shop-card-label">حجم تمدید</div>
              <div className="rate-shop-unlimited">نامحدود</div>
            </div>
          ) : (
            <div className="rate-shop-card">
              <div className="rate-shop-card-label">حجم تمدید (گیگابایت)</div>
              <div className="rate-stepper">
                <button type="button" className="rate-step-btn" disabled={busy} onClick={() => bumpGb(-1)} aria-label="کاهش حجم">
                  −
                </button>
                <input
                  className="rate-step-input num"
                  inputMode="numeric"
                  value={gbInput}
                  disabled={busy}
                  onChange={(e) => setGbInput(e.target.value.replace(/[^\d]/g, ""))}
                  onBlur={() => setGbInput(String(trafficGb ?? rules.min))}
                  aria-label="حجم گیگابایت"
                />
                <button type="button" className="rate-step-btn" disabled={busy} onClick={() => bumpGb(1)} aria-label="افزایش حجم">
                  +
                </button>
              </div>
              <p className="muted rate-shop-hint">
                {rules.min} تا {rules.max} گیگ
                {rules.step > 1 ? ` · مضرب ${rules.step}` : ""}
              </p>
            </div>
          )}

          <div className="rate-shop-card">
            <div className="rate-shop-card-label">مدت</div>
            {info.category === "national" || monthOptions.length <= 1 ? (
              <div className="rate-shop-fixed">۱ ماه</div>
            ) : (
              <div className="chip-row">
                {monthOptions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`chip${months === m ? " on" : ""}`}
                    onClick={() => setMonths(m)}
                  >
                    {m === 1 ? "۱ ماه" : `${m} ماه`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rate-shop-price">
            <span className="muted">قیمت</span>
            <strong className="num">
              {quoting ? "…" : price != null ? formatToman(price) : quoteErr ? "—" : "…"}
            </strong>
          </div>
          {quoteErr && (
            <p className="muted" style={{ color: "var(--pink)", marginTop: 0 }}>
              {quoteErr}
            </p>
          )}

          <div className="actions stack rate-shop-actions">
            {variant === "admin" ? (
              <button type="button" className="btn success wide" disabled={!canSubmit} onClick={() => void submit(true)}>
                تمدید سرویس
              </button>
            ) : (
              <>
                <button type="button" className="btn light wide" disabled={!canSubmit} onClick={() => void submit(true)}>
                  پرداخت با کیف پول و تمدید
                </button>
                <button type="button" className="btn success wide" disabled={!canSubmit} onClick={() => void submit(false)}>
                  کارت‌به‌کارت و تمدید
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
