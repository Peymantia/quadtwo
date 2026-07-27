"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatToman } from "../lib/api";
import { Modal } from "./Modal";
import type { PublicPaymentMethods } from "./RateShop";

export type RenewInfo = {
  ok: true;
  message: string;
  category: string;
  categoryLabel: string;
  maxMonths: number;
  discountsEnabled?: boolean;
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
    paymentMethod?: "wallet" | "card_to_card" | "crypto";
    discountCode?: string | null;
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
  const [priceBefore, setPriceBefore] = useState<number | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [verifiedDiscount, setVerifiedDiscount] = useState<string | null>(null);
  const [discountErr, setDiscountErr] = useState<string | null>(null);
  const [discountOkHint, setDiscountOkHint] = useState<string | null>(null);
  const [checkingDiscount, setCheckingDiscount] = useState(false);
  const [payMethods, setPayMethods] = useState<PublicPaymentMethods | null>(null);

  const rules = useMemo(() => (info ? rulesFor(info.category, info) : null), [info]);
  const monthOptions = useMemo(() => {
    const max = Math.max(1, Math.min(3, info?.maxMonths || 1));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [info?.maxMonths]);
  const discountsAllowed = variant === "user" && Boolean(info?.discountsEnabled);

  useEffect(() => {
    if (!open || variant === "admin") return;
    void api<{ methods: PublicPaymentMethods }>("/me/payment-methods")
      .then((r) => setPayMethods(r.methods))
      .catch(() => setPayMethods(null));
  }, [open, variant]);

  useEffect(() => {
    if (!open || !info || !rules) return;
    setMonths(1);
    setDiscountCode("");
    setVerifiedDiscount(null);
    setDiscountErr(null);
    setDiscountOkHint(null);
    setDiscountAmount(0);
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
      void api<{
        price: number;
        priceBefore?: number;
        discountAmount?: number;
        discountError?: string | null;
      }>("/me/quote", {
        body: {
          category: info.category,
          trafficGb: rules.kind === "unlimited" ? null : trafficGb,
          months: info.category === "national" ? 1 : months,
          discountCode:
            discountsAllowed && verifiedDiscount && verifiedDiscount === discountCode.trim().toUpperCase()
              ? verifiedDiscount
              : null,
        },
      })
        .then((r) => {
          if (cancelled) return;
          setPrice(r.price);
          setPriceBefore(r.priceBefore ?? r.price);
          setDiscountAmount(r.discountAmount ?? 0);
          if (!r.discountError && verifiedDiscount) setDiscountErr(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setPrice(null);
          setPriceBefore(null);
          setDiscountAmount(0);
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
  }, [open, info, trafficGb, months, rules, discountsAllowed, verifiedDiscount, discountCode]);

  function bumpGb(dir: 1 | -1) {
    if (!rules || rules.kind !== "stepped") return;
    const cur = trafficGb ?? rules.min;
    setGbInput(String(snap(cur + dir * rules.step, rules.min, rules.max, rules.step)));
  }

  async function checkDiscountCode() {
    if (!info || !rules) return;
    const code = discountCode.trim().toUpperCase();
    if (!code) {
      setDiscountErr("کد تخفیف را وارد کنید");
      setDiscountOkHint(null);
      setVerifiedDiscount(null);
      return;
    }
    setCheckingDiscount(true);
    setDiscountErr(null);
    setDiscountOkHint(null);
    try {
      const r = await api<{
        price: number;
        priceBefore?: number;
        discountAmount?: number;
        discountError?: string | null;
        percentOff?: number | null;
        discountCode?: string | null;
      }>("/me/quote", {
        body: {
          category: info.category,
          trafficGb: rules.kind === "unlimited" ? null : trafficGb,
          months: info.category === "national" ? 1 : months,
          discountCode: code,
        },
      });
      if (r.discountError) {
        setVerifiedDiscount(null);
        setDiscountAmount(0);
        setDiscountErr(r.discountError);
        setPrice(r.priceBefore ?? r.price);
        setPriceBefore(r.priceBefore ?? r.price);
        return;
      }
      if (!r.discountAmount || r.discountAmount <= 0) {
        setVerifiedDiscount(null);
        setDiscountErr("کد تخفیف وارد شده صحیح نیست");
        return;
      }
      setVerifiedDiscount(r.discountCode || code);
      setDiscountCode(r.discountCode || code);
      setDiscountAmount(r.discountAmount);
      setPrice(r.price);
      setPriceBefore(r.priceBefore ?? r.price);
      setDiscountOkHint(
        r.percentOff != null ? `کد معتبر است (−${r.percentOff}٪)` : "کد معتبر است و اعمال شد",
      );
    } catch (e) {
      setVerifiedDiscount(null);
      setDiscountErr(String(e instanceof Error ? e.message : e));
    } finally {
      setCheckingDiscount(false);
    }
  }

  const canSubmit = !busy && !quoting && price != null && Boolean(info);

  async function submit(method: "wallet" | "card_to_card" | "crypto") {
    if (!info || !rules) return;
    await onSubmit({
      category: info.category,
      trafficGb: rules.kind === "unlimited" ? null : trafficGb,
      months: info.category === "national" ? 1 : months,
      payWithWallet: method === "wallet",
      paymentMethod: method,
      discountCode:
        discountsAllowed && verifiedDiscount && verifiedDiscount === discountCode.trim().toUpperCase()
          ? verifiedDiscount
          : null,
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

          {info.category !== "national" && monthOptions.length > 1 && (
            <div className="field">
              <label>مدت تمدید</label>
              <div className="chip-row">
                {monthOptions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`chip${months === m ? " on" : ""}`}
                    disabled={busy}
                    onClick={() => setMonths(m)}
                  >
                    {m.toLocaleString("fa-IR")} ماه
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="seek-price seek-price-live">
            <span className="muted">مبلغ</span>
            <strong className="num">
              {quoting ? "…" : price != null ? formatToman(price) : quoteErr ? "—" : "…"}
            </strong>
          </div>
          {discountAmount > 0 && priceBefore != null && priceBefore !== price && (
            <p className="muted" style={{ margin: "0 0 8px" }}>
              قبل از تخفیف: {formatToman(priceBefore)} · تخفیف −{formatToman(discountAmount)}
            </p>
          )}
          {discountErr && (
            <p className="muted" style={{ color: "var(--pink)", margin: "0 0 8px" }}>
              {discountErr}
            </p>
          )}
          {quoteErr && (
            <p className="muted" style={{ color: "var(--pink)", margin: 0 }}>
              {quoteErr}
            </p>
          )}

          {discountsAllowed && (
            <div className="field">
              <label>کد تخفیف (اختیاری)</label>
              <div className="discount-check-row">
                <input
                  value={discountCode}
                  onChange={(e) => {
                    setDiscountCode(e.target.value.toUpperCase());
                    setDiscountErr(null);
                    setDiscountOkHint(null);
                    setDiscountAmount(0);
                    setVerifiedDiscount(null);
                  }}
                  placeholder="مثلاً SALE20"
                  disabled={busy || checkingDiscount}
                />
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={busy || checkingDiscount || !discountCode.trim()}
                  onClick={() => void checkDiscountCode()}
                >
                  {checkingDiscount ? "…" : "بررسی کد"}
                </button>
              </div>
              {discountOkHint && !discountErr && (
                <p className="muted" style={{ color: "var(--green)", margin: "6px 0 0" }}>
                  {discountOkHint}
                </p>
              )}
            </div>
          )}

          <div className="actions stack" style={{ marginTop: 14 }}>
            {variant === "admin" ? (
              <button type="button" className="btn primary wide" disabled={!canSubmit} onClick={() => void submit("wallet")}>
                تمدید رایگان
              </button>
            ) : (
              <>
                {(payMethods?.wallet.enabled ?? true) && (
                  <button type="button" className="btn primary wide" disabled={!canSubmit} onClick={() => void submit("wallet")}>
                    پرداخت از کیف پول
                  </button>
                )}
                {(payMethods?.card.enabled ?? true) && (
                  <button type="button" className="btn ghost wide" disabled={!canSubmit} onClick={() => void submit("card_to_card")}>
                    کارت‌به‌کارت
                  </button>
                )}
                {payMethods?.crypto.enabled && (
                  <button
                    type="button"
                    className="btn ghost wide"
                    disabled={!canSubmit || !payMethods.crypto.configured}
                    onClick={() => void submit("crypto")}
                  >
                    کریپتو{!payMethods.crypto.configured ? " (آدرس تنظیم نشده)" : ""}
                  </button>
                )}
                {payMethods?.online.enabled && (
                  <button type="button" className="btn ghost wide" disabled title="به‌زودی">
                    پرداخت آنلاین — به‌زودی
                  </button>
                )}
              </>
            )}
            <button type="button" className="btn ghost wide" disabled={busy} onClick={onClose}>
              انصراف
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
