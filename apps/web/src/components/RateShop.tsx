"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, formatToman } from "../lib/api";
import { Modal } from "./Modal";

export type RateShopCatalog = {
  categories: string[];
  categoryLabels: Record<string, string>;
  maxMonths: number;
  pricingMode?: "matrix" | "rate";
  defaultLimitIp?: number;
  canEditLimitIp?: boolean;
  volumeRules?: {
    data: { min: number; max: number; step: number };
    national: { min: number; max: number; step: number };
    unlimited: null;
  };
  /** For matrix mode — snap volume/months to priced cells */
  cells?: Array<{
    category: string;
    trafficGb: number | null;
    months: number;
  }>;
};

export type RateOrderPayload = {
  category: string;
  trafficGb: number | null;
  months: number;
  limitIp: number;
  accountName?: string;
  note?: string | null;
  payWithWallet: boolean;
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
  const rank = (k: string) => (k === "data" ? 0 : k === "national" ? 1 : k === "unlimited" ? 2 : 10);
  return [...cats].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
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
  const pct = max <= 0 ? 0 : (Math.min(max, Math.max(0, index)) / max) * 100;
  const markEvery = steps.length > 14 ? 2 : 1;

  return (
    <div className={`seek-block${disabled ? " is-disabled" : ""}`}>
      <div className="seek-head">
        <span className="seek-title">{title}</span>
        <strong className="seek-metric">{value}</strong>
      </div>
      <div className="seek-track-wrap">
        <input
          type="range"
          className="seek-range"
          min={0}
          max={max}
          step={1}
          value={Math.min(max, Math.max(0, index))}
          disabled={disabled || max <= 0}
          aria-label={title}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ["--seek-pct" as string]: `${pct}%` }}
        />
      </div>
      <div className="seek-marks" aria-hidden="true">
        {steps.map((s, i) =>
          i % markEvery === 0 || i === steps.length - 1 ? (
            <span key={`${s.value}-${i}`} className="seek-mark num" style={{ ["--i" as string]: i, ["--n" as string]: max || 1 }}>
              {s.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** Always render as «N unit» with Latin digits inside an LTR isolate (RTL-safe). */
function SeekValueLabel({ num, unit }: { num: number | string; unit: string }) {
  const n = typeof num === "number" ? String(num) : num;
  return (
    <bdi
      className="seek-metric-ltr"
      dir="ltr"
      style={{ direction: "ltr", unicodeBidi: "isolate", display: "inline-block" }}
    >
      {n}
      {"\u00A0"}
      {unit}
    </bdi>
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
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");

  const volumeFixed = category === "unlimited";
  const monthsLocked = category === "national" || Math.max(1, catalog.maxMonths || 1) <= 1;
  const ipLocked = !allowIpEdit;

  const volumeSteps = useMemo((): SeekStep[] => {
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
    if (category === "national") {
      const r = catalog.volumeRules?.national ?? { min: 1, max: 20, step: 1 };
      return steppedValues(r.min, r.max, r.step).map((g) => ({ value: g, label: String(g) }));
    }
    const r = catalog.volumeRules?.data ?? { min: 10, max: 50, step: 5 };
    return steppedValues(r.min, r.max, r.step).map((g) => ({ value: g, label: String(g) }));
  }, [category, catalog, volumeFixed]);

  const monthSteps = useMemo((): SeekStep[] => {
    if (category === "national") return [{ value: 1, label: "۱" }];
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
  }, [category, catalog]);

  const ipSteps = useMemo((): SeekStep[] => {
    const def = Math.max(0, Math.min(10, catalog.defaultLimitIp ?? 0));
    if (ipLocked) {
      return [{ value: def, label: def <= 0 ? "∞" : String(def) }];
    }
    return Array.from({ length: 11 }, (_, i) => ({
      value: i,
      label: i === 0 ? "∞" : String(i),
    }));
  }, [catalog.defaultLimitIp, ipLocked]);

  useEffect(() => {
    if (!cats.includes(category)) setCategory(cats[0] || "data");
  }, [cats, category]);

  useEffect(() => {
    setGbIndex(0);
    setMonthIndex(0);
    if (ipLocked) setIpIndex(0);
    else setIpIndex(nearestIndex(ipSteps, catalog.defaultLimitIp ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on category change
  }, [category]);

  useEffect(() => {
    setGbIndex((i) => Math.min(i, Math.max(0, volumeSteps.length - 1)));
  }, [volumeSteps]);

  useEffect(() => {
    setMonthIndex((i) => Math.min(i, Math.max(0, monthSteps.length - 1)));
  }, [monthSteps]);

  const trafficGb = volumeFixed ? null : volumeSteps[gbIndex]?.value ?? volumeSteps[0]?.value ?? 10;
  const months = monthSteps[monthIndex]?.value ?? 1;
  const limitIp = ipSteps[ipIndex]?.value ?? catalog.defaultLimitIp ?? 0;

  const volumeValue = volumeFixed ? (
    "نامحدود"
  ) : (
    <SeekValueLabel num={trafficGb ?? 0} unit="گیگابایت" />
  );
  const monthValue = <SeekValueLabel num={months} unit="ماه" />;
  const ipValue = limitIp <= 0 ? "نامحدود" : <SeekValueLabel num={limitIp} unit="کاربر" />;

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      setQuoting(true);
      setQuoteErr(null);
      void api<{ price: number }>("/me/quote", {
        body: {
          category,
          trafficGb: volumeFixed ? null : trafficGb,
          months: category === "national" ? 1 : months,
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
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [category, trafficGb, months, volumeFixed]);

  function resolveAccountName() {
    if (nameMode === "custom") return customName.trim();
    return randomName(variant === "agent" || variant === "admin" ? "p" : "u");
  }

  function openConfirm() {
    if (nameMode === "custom" && !customName.trim()) return;
    setPendingName(resolveAccountName());
    setConfirmOpen(true);
  }

  async function confirmPay(payWithWallet: boolean) {
    setConfirmOpen(false);
    await onSubmit({
      category,
      trafficGb: volumeFixed ? null : trafficGb,
      months: category === "national" ? 1 : months,
      limitIp,
      accountName: pendingName,
      note: note.trim() || null,
      payWithWallet,
    });
  }

  const canSubmit = !busy && !quoting && price != null && (nameMode === "random" || Boolean(customName.trim()));
  const catLabel = catalog.categoryLabels[category] || category;
  const confirmLines = [
    `اکانت «${pendingName}»`,
    `نوع: ${catLabel}`,
    `حجم: ${volumeFixed ? "نامحدود" : `${(trafficGb ?? 0).toLocaleString("fa-IR")} گیگابایت`}`,
    `مدت: ${(category === "national" ? 1 : months).toLocaleString("fa-IR")} ماه`,
    `محدودیت کاربر: ${limitIp <= 0 ? "نامحدود" : `${limitIp.toLocaleString("fa-IR")} کاربر`}`,
    `مبلغ: ${price != null ? formatToman(price) : "—"}`,
  ];
  if (note.trim()) confirmLines.push(`توضیحات: ${note.trim()}`);

  if (!cats.length) {
    return <p className="muted" style={{ margin: 0 }}>هنوز دسته‌ای برای فروش فعال نشده است.</p>;
  }

  return (
    <div className="rate-shop seek-shop">
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

      <div className="seek-price seek-price-live">
        <span className="muted">مبلغ</span>
        <strong className="num">
          {quoting ? "…" : price != null ? formatToman(price) : quoteErr ? "—" : "…"}
        </strong>
      </div>
      {quoteErr && (
        <p className="muted" style={{ color: "var(--pink)", margin: 0 }}>
          {quoteErr}
        </p>
      )}

      {(variant === "agent" || variant === "admin") && (
        <>
          <div className="field">
            <label>نام کاربر</label>
            <div className="chip-row" style={{ marginBottom: 10 }}>
              <button type="button" className={`chip${nameMode === "random" ? " on" : ""}`} onClick={() => setNameMode("random")}>
                رندوم
              </button>
              <button type="button" className={`chip${nameMode === "custom" ? " on" : ""}`} onClick={() => setNameMode("custom")}>
                شخصی
              </button>
            </div>
            {nameMode === "custom" && (
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="مثلاً ali-mobile"
                disabled={busy}
              />
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
          <label>نام اکانت (اختیاری)</label>
          <div className="chip-row" style={{ marginBottom: 10 }}>
            <button type="button" className={`chip${nameMode === "random" ? " on" : ""}`} onClick={() => setNameMode("random")}>
              رندوم
            </button>
            <button type="button" className={`chip${nameMode === "custom" ? " on" : ""}`} onClick={() => setNameMode("custom")}>
              شخصی
            </button>
          </div>
          {nameMode === "custom" && (
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="مثلاً ali-mobile"
              disabled={busy}
            />
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
            ساخت رایگان توسط ادمین — بدون کسر از کیف پول.
          </p>
        )}
        <div className="actions order-confirm-actions">
          {variant !== "admin" && (
            <>
              <button
                type="button"
                className="btn seek-pay-wallet"
                disabled={busy}
                onClick={() => void confirmPay(true)}
              >
                تأیید و پرداخت از کیف پول
              </button>
              <button
                type="button"
                className="btn seek-pay-card"
                disabled={busy}
                onClick={() => void confirmPay(false)}
              >
                تأیید و پرداخت کارت به کارت
              </button>
            </>
          )}
          {variant === "admin" && (
            <button type="button" className="btn success" disabled={busy} onClick={() => void confirmPay(true)}>
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
