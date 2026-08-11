"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, formatToman } from "../lib/api";
import { ACCOUNT_NAME_HINT, filterAccountNameInput, isValidAccountName } from "../lib/account-name";
import { Modal } from "./Modal";

export type RateShopCatalog = {
  categories: string[];
  categoryLabels: Record<string, string>;
  maxMonths: number;
  pricingMode?: "matrix" | "rate";
  defaultLimitIp?: number;
  canEditLimitIp?: boolean;
  discountsEnabled?: boolean;
  /** Admin checkout is free; catalog still shows reseller-tier service amounts */
  adminComplimentary?: boolean;
  volumeRules?: {
    data: { min: number; max: number; step: number };
    national: { min: number; max: number; step: number };
    unlimited: null;
  };
  /** For matrix mode — snap volume/months to priced cells; offer uses fixed cards */
  cells?: Array<{
    id?: string;
    category: string;
    trafficGb: number | null;
    months: number;
    title?: string | null;
    price?: number | null;
    isGolden?: boolean;
    limitIp?: number;
  }>;
};

export type RateOrderPayload = {
  category: string;
  trafficGb: number | null;
  months: number;
  limitIp: number;
  accountName?: string;
  note?: string | null;
  /** @deprecated prefer paymentMethod */
  payWithWallet: boolean;
  paymentMethod?: "wallet" | "card_to_card" | "crypto";
  discountCode?: string | null;
  quantity?: number;
  priceCellId?: string | null;
};

export type PublicPaymentMethods = {
  card: { enabled: boolean };
  wallet: { enabled: boolean };
  online: { enabled: boolean; ready: boolean; label: string };
  crypto: {
    enabled: boolean;
    configured: boolean;
    asset: string;
    network: string;
    address: string;
    note: string;
  };
};

type Props = {
  catalog: RateShopCatalog;
  busy?: boolean;
  /** user: wallet + card · agent: wallet only · admin: complimentary */
  variant: "user" | "agent" | "admin";
  onSubmit: (payload: RateOrderPayload) => void | Promise<void>;
};

type SeekStep = { value: number; label: string };

function sortCategories(cats: string[]): string[] {
  // Catalog already returns admin display order; keep that order.
  return [...cats];
}

function randomName(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function steppedValues(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  if (!out.length || out[out.length - 1]! < max) out.push(max);
  return [...new Set(out)];
}

function nearestIndex(steps: SeekStep[], value: number): number {
  if (!steps.length) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(steps[i]!.value - value);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function SeekBar({
  title,
  value,
  steps,
  index,
  disabled,
  onChange,
}: {
  title: string;
  value: ReactNode;
  steps: SeekStep[];
  index: number;
  disabled?: boolean;
  onChange: (index: number) => void;
}) {
  const max = Math.max(0, steps.length - 1);
  const safeIndex = Math.min(max, Math.max(0, index));
  const pct = max <= 0 ? 0 : (safeIndex / max) * 100;
  const showDots = steps.length > 1 && steps.length <= 20;
  const seekStyle = { ["--seek-pct" as string]: String(pct) };

  return (
    <div className={`seek-block${disabled ? " is-disabled" : ""}`}>
      <div className="seek-head">
        <span className="seek-title">{title}</span>
        <strong className="seek-metric" dir="ltr">
          {value}
        </strong>
      </div>
      <div className="seek-track-wrap" style={seekStyle}>
        <div className="seek-rail" aria-hidden="true">
          <div className="seek-rail-fill" />
          {showDots ? (
            <div className="seek-dots">
              {steps.map((s, i) => (
                <span
                  key={`${s.value}-${i}`}
                  className={`seek-dot${i === safeIndex ? " is-current" : i < safeIndex ? " is-passed" : ""}`}
                  style={{ ["--i" as string]: i, ["--n" as string]: max || 1 }}
                />
              ))}
            </div>
          ) : null}
        </div>
        <input
          type="range"
          className="seek-range"
          min={0}
          max={max}
          step={1}
          value={safeIndex}
          disabled={disabled || max <= 0}
          aria-label={title}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

/** «۳۰ گیگابایت» — Persian digits, physical LTR via inline-table (survives html[dir=rtl] + stale CSS). */
function faNum(n: number | string): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString("fa-IR");
}

function SeekValueLabel({ num, unit }: { num: number | string; unit: string }) {
  return (
    <span
      className="seek-metric-pair"
      dir="ltr"
      style={{
        display: "inline-table",
        direction: "ltr",
        unicodeBidi: "isolate",
        borderCollapse: "collapse",
        lineHeight: 1.2,
      }}
    >
      <span
        className="seek-metric-num"
        style={{
          display: "table-cell",
          direction: "ltr",
          unicodeBidi: "isolate",
          paddingInlineEnd: "0.35em",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {faNum(num)}
      </span>
      <span className="seek-metric-unit" style={{ display: "table-cell", whiteSpace: "nowrap" }}>
        {unit}
      </span>
    </span>
  );
}

export function RateShop({ catalog, busy, variant, onSubmit }: Props) {
  const cats = sortCategories(catalog.categories.length ? catalog.categories : []);
  const allowIpEdit =
    variant === "admin" || variant === "agent" ? true : Boolean(catalog.canEditLimitIp);

  const [category, setCategory] = useState(cats[0] || "data");
  const [gbIndex, setGbIndex] = useState(0);
  const [monthIndex, setMonthIndex] = useState(0);
  const [ipIndex, setIpIndex] = useState(0);
  const [nameMode, setNameMode] = useState<"random" | "custom">("random");
  const [customName, setCustomName] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [servicePrice, setServicePrice] = useState<number | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [priceBefore, setPriceBefore] = useState<number | null>(null);
  const [discountErr, setDiscountErr] = useState<string | null>(null);
  const [discountOkHint, setDiscountOkHint] = useState<string | null>(null);
  const [checkingDiscount, setCheckingDiscount] = useState(false);
  const [verifiedDiscount, setVerifiedDiscount] = useState<string | null>(null);
  const [offerIndex, setOfferIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [payMethods, setPayMethods] = useState<PublicPaymentMethods | null>(null);

  useEffect(() => {
    if (variant === "admin") return;
    void api<{ methods: PublicPaymentMethods }>("/me/payment-methods")
      .then((r) => setPayMethods(r.methods))
      .catch(() => setPayMethods(null));
  }, [variant]);

  const isOffer = category === "offer";
  const isFixedSingle =
    isOffer || category === "unlimited" || category === "national" || category === "wholesale" || category === "reseller";
  const unlimitedIpLocked = category === "unlimited";
  const fixedCells = useMemo(
    () => (catalog.cells ?? []).filter((c) => c.category === category && c.price != null),
    [catalog.cells, category],
  );
  const selectedFixed = isFixedSingle
    ? fixedCells[Math.min(offerIndex, Math.max(0, fixedCells.length - 1))] ?? null
    : null;
  const showQty = variant === "agent" && !isFixedSingle;
  const qty = showQty ? Math.max(1, Math.min(50, quantity)) : 1;

  const volumeFixed = category === "unlimited" || (isFixedSingle && selectedFixed?.trafficGb == null);
  const monthsLocked = isFixedSingle || Math.max(1, catalog.maxMonths || 1) <= 1;
  const ipLocked = isFixedSingle || unlimitedIpLocked || !allowIpEdit;

  const volumeSteps = useMemo((): SeekStep[] => {
    if (isFixedSingle && selectedFixed) {
      if (selectedFixed.trafficGb == null) return [{ value: 0, label: "∞" }];
      return [{ value: selectedFixed.trafficGb, label: String(selectedFixed.trafficGb) }];
    }
    if (volumeFixed) return [{ value: 0, label: "∞" }];
    if (catalog.pricingMode === "matrix" && catalog.cells?.length) {
      const gbs = [
        ...new Set(
          catalog.cells
            .filter((c) => c.category === category && c.trafficGb != null && c.trafficGb > 0)
            .map((c) => c.trafficGb as number),
        ),
      ].sort((a, b) => a - b);
      if (gbs.length) return gbs.map((g) => ({ value: g, label: String(g) }));
    }
    const r = catalog.volumeRules?.data ?? { min: 10, max: 50, step: 5 };
    return steppedValues(r.min, r.max, r.step).map((g) => ({ value: g, label: String(g) }));
  }, [category, catalog, volumeFixed, isFixedSingle, selectedFixed]);

  const monthSteps = useMemo((): SeekStep[] => {
    if (isFixedSingle && selectedFixed) return [{ value: selectedFixed.months, label: String(selectedFixed.months) }];
    if (catalog.pricingMode === "matrix" && catalog.cells?.length) {
      const ms = [
        ...new Set(
          catalog.cells.filter((c) => c.category === category).map((c) => c.months).filter((m) => m >= 1),
        ),
      ].sort((a, b) => a - b);
      if (ms.length) return ms.map((m) => ({ value: m, label: String(m) }));
    }
    const max = Math.max(1, Math.min(12, catalog.maxMonths || 1));
    return Array.from({ length: max }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  }, [category, catalog, isFixedSingle, selectedFixed]);

  const ipSteps = useMemo((): SeekStep[] => {
    if (unlimitedIpLocked) {
      return [{ value: 2, label: "2" }];
    }
    const def = Math.max(0, Math.min(10, catalog.defaultLimitIp ?? 0));
    if (ipLocked) {
      return [{ value: def, label: def <= 0 ? "∞" : String(def) }];
    }
    return Array.from({ length: 11 }, (_, i) => ({
      value: i,
      label: i === 0 ? "∞" : String(i),
    }));
  }, [catalog.defaultLimitIp, ipLocked, unlimitedIpLocked]);

  useEffect(() => {
    if (!cats.includes(category)) setCategory(cats[0] || "data");
  }, [cats, category]);

  useEffect(() => {
    setGbIndex(0);
    setMonthIndex(0);
    setOfferIndex(0);
    setDiscountCode("");
    setVerifiedDiscount(null);
    setDiscountOkHint(null);
    setDiscountErr(null);
    setDiscountAmount(0);
    if (ipLocked) setIpIndex(0);
    else setIpIndex(nearestIndex(ipSteps, catalog.defaultLimitIp ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on category change
  }, [category]);

  useEffect(() => {
    setOfferIndex((i) => Math.min(i, Math.max(0, fixedCells.length - 1)));
  }, [fixedCells]);

  useEffect(() => {
    setGbIndex((i) => Math.min(i, Math.max(0, volumeSteps.length - 1)));
  }, [volumeSteps]);

  useEffect(() => {
    setMonthIndex((i) => Math.min(i, Math.max(0, monthSteps.length - 1)));
  }, [monthSteps]);

  const trafficGb = isFixedSingle
    ? category === "unlimited"
      ? null
      : selectedFixed?.trafficGb ?? null
    : volumeFixed
      ? null
      : volumeSteps[gbIndex]?.value ?? volumeSteps[0]?.value ?? 10;
  const months = isFixedSingle ? selectedFixed?.months ?? 1 : monthSteps[monthIndex]?.value ?? 1;
  const limitIp = isFixedSingle
    ? category === "unlimited"
      ? 2
      : selectedFixed && typeof selectedFixed.limitIp === "number" && selectedFixed.limitIp > 0
        ? Math.max(0, Math.min(10, selectedFixed.limitIp))
        : Math.max(0, Math.min(10, catalog.defaultLimitIp ?? 0))
    : unlimitedIpLocked
      ? 2
    : ipSteps[ipIndex]?.value ?? catalog.defaultLimitIp ?? 0;

  const volumeValue = volumeFixed || trafficGb == null ? (
    "نامحدود"
  ) : (
    <SeekValueLabel num={trafficGb ?? 0} unit="گیگ" />
  );
  const monthValue = <SeekValueLabel num={months} unit="ماه" />;
  const ipValue = limitIp <= 0 ? "نامحدود" : <SeekValueLabel num={limitIp} unit="کاربر" />;

  const discountsAllowed =
    Boolean(catalog.discountsEnabled) &&
    !isOffer &&
    category !== "wholesale" &&
    category !== "reseller" &&
    variant !== "admin";

  useEffect(() => {
    if (isFixedSingle) setQuantity(1);
  }, [isFixedSingle]);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (isFixedSingle && !selectedFixed) {
        setPrice(null);
        setServicePrice(null);
        setPriceBefore(null);
        setDiscountAmount(0);
        setDiscountErr(null);
        setQuoteErr(
          isOffer
            ? "پلنی برای پیشنهاد ویژه تعریف نشده است"
            : `پلنی برای «${catalog.categoryLabels[category] || category}» تعریف نشده است`,
        );
        setQuoting(false);
        return;
      }
      setQuoting(true);
      setQuoteErr(null);
      void api<{
        price: number;
        servicePrice?: number;
        priceBefore?: number;
        discountAmount?: number;
        discountError?: string | null;
      }>("/me/quote", {
        body: {
          category,
          trafficGb,
          months: category === "national" ? 1 : months,
          quantity: qty,
          priceCellId: selectedFixed?.id || null,
          discountCode:
            discountsAllowed && verifiedDiscount && verifiedDiscount === discountCode.trim().toUpperCase()
              ? verifiedDiscount
              : null,
        },
      })
        .then((r) => {
          if (cancelled) return;
          setPrice(r.price);
          setServicePrice(r.servicePrice ?? r.price);
          setPriceBefore(r.priceBefore ?? r.price);
          setDiscountAmount(r.discountAmount ?? 0);
          // Keep check-button errors; only clear when verified discount applies cleanly
          if (!r.discountError && verifiedDiscount) setDiscountErr(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setPrice(null);
          setServicePrice(null);
          setPriceBefore(null);
          setDiscountAmount(0);
          setDiscountErr(null);
          setQuoteErr(String(e instanceof Error ? e.message : e));
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [category, trafficGb, months, discountsAllowed, isFixedSingle, selectedFixed, verifiedDiscount, qty, discountCode, catalog.categoryLabels, isOffer]);

  async function checkDiscountCode() {
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
          category,
          trafficGb,
          months: category === "national" ? 1 : months,
          quantity: qty,
          priceCellId: selectedFixed?.id || null,
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
        `کد معتبر است${r.percentOff ? ` (−${r.percentOff}٪)` : ""} · تخفیف ${formatToman(r.discountAmount)}`,
      );
    } catch (e) {
      setVerifiedDiscount(null);
      setDiscountErr(String(e instanceof Error ? e.message : e));
    } finally {
      setCheckingDiscount(false);
    }
  }

  function resolveAccountName() {
    if (nameMode === "custom") return customName.trim();
    return randomName(variant === "agent" || variant === "admin" ? "p" : "u");
  }

  function openConfirm() {
    if (nameMode === "custom") {
      const name = customName.trim();
      if (!name) return;
      if (!isValidAccountName(name)) {
        return;
      }
    }
    setPendingName(resolveAccountName());
    setConfirmOpen(true);
  }

  async function confirmPay(method: "wallet" | "card_to_card" | "crypto") {
    setConfirmOpen(false);
    await onSubmit({
      category,
      trafficGb,
      months: category === "national" ? 1 : months,
      limitIp,
      accountName: pendingName,
      note: note.trim() || null,
      payWithWallet: method === "wallet",
      paymentMethod: method,
      quantity: qty,
      priceCellId: selectedFixed?.id || null,
      discountCode:
        discountsAllowed && verifiedDiscount && verifiedDiscount === discountCode.trim().toUpperCase()
          ? verifiedDiscount
          : null,
    });
  }

  const canSubmit =
    !busy &&
    !quoting &&
    price != null &&
    (!isFixedSingle || Boolean(selectedFixed)) &&
    (nameMode === "random" || isValidAccountName(customName));
  const catLabel = catalog.categoryLabels[category] || category;
  const displayService =
    variant === "admin"
      ? servicePrice ?? selectedFixed?.price ?? price
      : price;
  const confirmLines = [
    `اکانت «${pendingName}»`,
    `نوع: ${catLabel}`,
    selectedFixed?.title ? `پلن: ${selectedFixed.title}` : "",
    `حجم: ${trafficGb == null ? "نامحدود" : `${(trafficGb ?? 0).toLocaleString("fa-IR")} گیگابایت`}`,
    `مدت: ${(category === "national" ? 1 : months).toLocaleString("fa-IR")} ماه`,
    qty > 1 ? `تعداد: ${qty.toLocaleString("fa-IR")}` : "",
    `محدودیت کاربر: ${limitIp <= 0 ? "نامحدود" : `${limitIp.toLocaleString("fa-IR")} کاربر`}`,
    discountAmount > 0 && priceBefore != null
      ? `قبل از تخفیف: ${formatToman(priceBefore)}`
      : "",
    discountAmount > 0 ? `تخفیف: −${formatToman(discountAmount)}` : "",
    variant === "admin"
      ? `مبلغ سرویس: ${displayService != null ? formatToman(displayService) : "—"}`
      : `مبلغ: ${price != null ? formatToman(price) : "—"}`,
    variant === "admin" ? "مبلغ قابل پرداخت: صفر" : "",
  ].filter(Boolean);
  if (note.trim()) confirmLines.push(`توضیحات: ${note.trim()}`);

  if (!cats.length) {
    return <p className="muted" style={{ margin: 0 }}>هنوز دسته‌ای برای فروش فعال نشده است.</p>;
  }

  return (
    <div className="rate-shop seek-shop">
      {cats.length > 1 ? (
        <div className="field">
          <label>نوع اشتراک</label>
          <div className="chip-row rate-shop-cats">
            {cats.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`chip${category === cat ? " on" : ""}`}
                onClick={() => setCategory(cat)}
              >
                {catalog.categoryLabels[cat] || cat}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isFixedSingle ? (
        <div className="field">
          <p className="plan-pick-hint">
            {isOffer ? "⭐" : category === "unlimited" ? "💎" : "📦"} پلن مورد نظر خود را انتخاب کنید:
          </p>
          {!fixedCells.length ? (
            <p className="muted" style={{ color: "var(--pink)", margin: 0 }}>
              هنوز پلنی در این دسته تعریف نشده است.
            </p>
          ) : (
            <div className="plan-card-list">
              {fixedCells.map((cell, idx) => {
                const months = Math.max(1, cell.months || 1);
                const monthsLabel =
                  months === 1
                    ? "یک ماهه"
                    : months === 2
                      ? "دو ماهه"
                      : months === 3
                        ? "سه ماهه"
                        : `${months.toLocaleString("fa-IR")} ماهه`;
                const volLabel =
                  cell.trafficGb == null || category === "unlimited"
                    ? "نامحدود"
                    : `${cell.trafficGb.toLocaleString("fa-IR")} گیگ`;
                const primaryLabel =
                  cell.title?.trim() && isOffer
                    ? cell.title.trim()
                    : cell.trafficGb == null || category === "unlimited"
                      ? `${monthsLabel} نامحدود`
                      : `${monthsLabel} ${volLabel}`;
                const ip = typeof cell.limitIp === "number" ? cell.limitIp : 0;
                const limitLabel =
                  ip <= 0
                    ? "نامحدود"
                    : ip === 1
                      ? "یک کاربره"
                      : ip === 2
                        ? "دو کاربره"
                        : `${ip.toLocaleString("fa-IR")} کاربره`;
                return (
                  <button
                    key={cell.id || `${cell.trafficGb}-${cell.months}-${idx}`}
                    type="button"
                    className={`plan-card plan-card--compact${offerIndex === idx ? " on" : ""}${isOffer ? " golden" : ""}`}
                    onClick={() => setOfferIndex(idx)}
                    disabled={busy}
                  >
                    <div className="plan-card-specs" dir="rtl">
                      <div className="plan-card-primary">{primaryLabel}</div>
                      <div className="plan-card-limit">
                        {isOffer && cell.title?.trim()
                          ? `${
                              cell.trafficGb == null ? `${monthsLabel} نامحدود` : `${monthsLabel} ${volLabel}`
                            } · محدودیت: ${limitLabel}`
                          : `محدودیت: ${limitLabel}`}
                      </div>
                    </div>
                    <div className="plan-price num" dir="rtl">
                      {formatToman(cell.price ?? 0)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <SeekBar
            title="حجم"
            value={volumeValue}
            steps={volumeSteps}
            index={gbIndex}
            disabled={busy || volumeFixed || volumeSteps.length <= 1}
            onChange={setGbIndex}
          />

          <SeekBar
            title="مدت"
            value={monthValue}
            steps={monthSteps}
            index={monthIndex}
            disabled={busy || monthsLocked || monthSteps.length <= 1}
            onChange={setMonthIndex}
          />

          <SeekBar
            title="محدودیت کاربر"
            value={ipValue}
            steps={ipSteps}
            index={ipIndex}
            disabled={busy || ipLocked || ipSteps.length <= 1}
            onChange={setIpIndex}
          />
        </>
      )}

      {showQty && (
        <div className="field">
          <label>تعداد اکانت</label>
          <div className="rate-stepper">
            <button
              type="button"
              className="rate-step-btn"
              disabled={busy || qty <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="کاهش تعداد"
            >
              −
            </button>
            <input
              className="rate-step-input num"
              inputMode="numeric"
              value={String(qty)}
              disabled={busy}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^\d]/g, ""));
                setQuantity(Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 1);
              }}
              aria-label="تعداد اکانت"
            />
            <button
              type="button"
              className="rate-step-btn"
              disabled={busy || qty >= 50}
              onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              aria-label="افزایش تعداد"
            >
              +
            </button>
          </div>
          <p className="muted rate-shop-hint" style={{ marginTop: 8 }}>
            حداکثر ۵۰ اکانت در هر سفارش
          </p>
        </div>
      )}

      <div className="seek-price seek-price-live">
        <span className="muted">{variant === "admin" ? "مبلغ سرویس" : "مبلغ"}</span>
        <strong className="num">
          {quoting
            ? "…"
            : displayService != null
              ? formatToman(displayService)
              : quoteErr
                ? "—"
                : "…"}
        </strong>
      </div>
      {variant === "admin" && displayService != null && (
        <p className="muted" style={{ margin: "0 0 8px" }}>
          مبلغ قابل پرداخت: صفر
        </p>
      )}
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

      {(variant === "agent" || variant === "admin") && (
        <>
          <div className="field">
            <label>نام کاربر</label>
            <div className="name-mode-row">
              <button
                type="button"
                className={`chip${nameMode === "random" ? " on" : ""}`}
                onClick={() => setNameMode("random")}
                disabled={busy}
              >
                رندوم
              </button>
              <button
                type="button"
                className={`chip${nameMode === "custom" ? " on" : ""}`}
                onClick={() => setNameMode("custom")}
                disabled={busy}
              >
                شخصی
              </button>
              <input
                className="name-mode-input"
                dir="ltr"
                value={customName}
                onChange={(e) => setCustomName(filterAccountNameInput(e.target.value))}
                placeholder="Ali_01"
                disabled={busy || nameMode !== "custom"}
                aria-label="نام شخصی"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {nameMode === "custom" && (
              <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                {ACCOUNT_NAME_HINT}
              </p>
            )}
          </div>
          <div className="field">
            <label>توضیحات (اختیاری)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder="یادداشت برای این کانفیگ"
              rows={2}
              disabled={busy}
            />
          </div>
        </>
      )}

      {variant === "user" && (
        <div className="field">
          <label>نام کاربر</label>
          <div className="name-mode-row">
            <button
              type="button"
              className={`chip${nameMode === "random" ? " on" : ""}`}
              onClick={() => setNameMode("random")}
              disabled={busy}
            >
              رندوم
            </button>
            <button
              type="button"
              className={`chip${nameMode === "custom" ? " on" : ""}`}
              onClick={() => setNameMode("custom")}
              disabled={busy}
            >
              شخصی
            </button>
            <input
              className="name-mode-input"
              dir="ltr"
              value={customName}
              onChange={(e) => setCustomName(filterAccountNameInput(e.target.value))}
              placeholder="Ali_01"
              disabled={busy || nameMode !== "custom"}
              aria-label="نام شخصی"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {nameMode === "custom" && (
            <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
              {ACCOUNT_NAME_HINT}
            </p>
          )}
        </div>
      )}

      <div className="seek-checkout">
        <div className="seek-pay-row">
          <button type="button" className="btn seek-pay-card wide" disabled={!canSubmit} onClick={openConfirm}>
            {variant === "admin" ? "ساخت کانفیگ" : "بررسی و پرداخت"}
          </button>
        </div>
      </div>

      <Modal open={confirmOpen} title="تأیید ساخت اکانت" onClose={() => setConfirmOpen(false)}>
        <p className="order-confirm-summary">{confirmLines.join("\n")}</p>
        {variant === "admin" && (
          <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
            ساخت توسط ادمین — مبلغ قابل پرداخت صفر است و از کیف پول کسر نمی‌شود.
          </p>
        )}
        <div className="actions order-confirm-actions">
          {variant !== "admin" && (
            <>
              {(payMethods?.wallet.enabled ?? true) && (
                <button
                  type="button"
                  className="btn seek-pay-wallet"
                  disabled={busy}
                  onClick={() => void confirmPay("wallet")}
                >
                  تأیید و پرداخت از کیف پول
                </button>
              )}
              {(payMethods?.card.enabled ?? true) && (
                <button
                  type="button"
                  className="btn seek-pay-card"
                  disabled={busy}
                  onClick={() => void confirmPay("card_to_card")}
                >
                  تأیید و پرداخت کارت به کارت
                </button>
              )}
              {payMethods?.crypto.enabled && (
                <button
                  type="button"
                  className="btn seek-pay-card"
                  disabled={busy || !payMethods.crypto.configured}
                  onClick={() => void confirmPay("crypto")}
                >
                  تأیید و پرداخت کریپتو
                  {!payMethods.crypto.configured ? " (آدرس تنظیم نشده)" : ""}
                </button>
              )}
              {payMethods?.online.enabled && (
                <button type="button" className="btn ghost" disabled title="به‌زودی">
                  پرداخت آنلاین — به‌زودی
                </button>
              )}
            </>
          )}
          {variant === "admin" && (
            <button type="button" className="btn success" disabled={busy} onClick={() => void confirmPay("wallet")}>
              تأیید و ساخت
            </button>
          )}
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>
            انصراف
          </button>
        </div>
      </Modal>
    </div>
  );
}
