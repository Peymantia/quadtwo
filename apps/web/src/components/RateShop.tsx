"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatToman } from "../lib/api";

export type RateShopCatalog = {
  categories: string[];
  categoryLabels: Record<string, string>;
  maxMonths: number;
  volumeRules?: {
    data: { min: number; max: number; step: number };
    national: { min: number; max: number; step: number };
    unlimited: null;
  };
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

function snap(value: number, min: number, max: number, step: number) {
  const n = Math.round(value / step) * step;
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function rulesFor(
  category: string,
  catalog: RateShopCatalog,
): { kind: "unlimited" | "stepped"; min: number; max: number; step: number } | { kind: "unlimited" } {
  if (category === "unlimited") return { kind: "unlimited" };
  if (category === "national") {
    const r = catalog.volumeRules?.national ?? { min: 1, max: 20, step: 1 };
    return { kind: "stepped", ...r };
  }
  const r = catalog.volumeRules?.data ?? { min: 10, max: 100, step: 5 };
  return { kind: "stepped", ...r };
}

function randomName(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function sortCategories(cats: string[]): string[] {
  const rank = (k: string) => (k === "data" ? 0 : k === "national" ? 1 : k === "unlimited" ? 2 : 10);
  return [...cats].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function RateShop({ catalog, busy, variant, onSubmit }: Props) {
  const cats = sortCategories(catalog.categories.length ? catalog.categories : []);
  const [category, setCategory] = useState(cats[0] || "data");
  const [gbInput, setGbInput] = useState("10");
  const [months, setMonths] = useState(1);
  const [limitIp, setLimitIp] = useState(0);
  const [nameMode, setNameMode] = useState<"random" | "custom">("random");
  const [customName, setCustomName] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  const rules = useMemo(() => rulesFor(category, catalog), [category, catalog]);
  const monthOptions = useMemo(() => {
    const max = Math.max(1, Math.min(3, catalog.maxMonths || 1));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [catalog.maxMonths]);

  // Reset volume defaults when category changes
  useEffect(() => {
    if (!cats.includes(category)) setCategory(cats[0] || "data");
  }, [cats, category]);

  useEffect(() => {
    const r = rulesFor(category, catalog);
    if (r.kind === "unlimited") {
      setGbInput("");
    } else {
      setGbInput(String(category === "national" ? r.min : r.min));
    }
    setMonths(1);
  }, [category, catalog]);

  const trafficGb = useMemo(() => {
    if (rules.kind === "unlimited") return null;
    const raw = Number(gbInput.replace(/[^\d]/g, ""));
    if (!Number.isFinite(raw) || gbInput.trim() === "") return rules.min;
    return snap(raw, rules.min, rules.max, rules.step);
  }, [gbInput, rules]);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      setQuoting(true);
      setQuoteErr(null);
      void api<{ price: number }>("/me/quote", {
        body: {
          category,
          trafficGb: rules.kind === "unlimited" ? null : trafficGb,
          months,
        },
      })
        .then((r) => {
          if (cancelled) return;
          setPrice(r.price);
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
  }, [category, trafficGb, months, rules.kind]);

  function bumpGb(dir: 1 | -1) {
    if (rules.kind !== "stepped") return;
    const cur = trafficGb ?? rules.min;
    setGbInput(String(snap(cur + dir * rules.step, rules.min, rules.max, rules.step)));
  }

  function onGbBlur() {
    if (rules.kind !== "stepped") return;
    setGbInput(String(trafficGb ?? rules.min));
  }

  function bumpIp(dir: 1 | -1) {
    setLimitIp((v) => Math.max(0, Math.min(10, v + dir)));
  }

  async function submit(payWithWallet: boolean) {
    if (nameMode === "custom" && !customName.trim()) return;
    const accountName =
      nameMode === "custom"
        ? customName.trim()
        : randomName(variant === "agent" || variant === "admin" ? "p" : "u");
    await onSubmit({
      category,
      trafficGb: rules.kind === "unlimited" ? null : trafficGb,
      months: category === "national" ? 1 : months,
      limitIp,
      accountName,
      note: note.trim() || null,
      payWithWallet,
    });
  }

  const canSubmit = !busy && !quoting && price != null && (nameMode === "random" || Boolean(customName.trim()));

  if (!cats.length) {
    return <p className="muted" style={{ margin: 0 }}>هنوز دسته‌ای برای فروش فعال نشده است.</p>;
  }

  return (
    <div className="rate-shop">
      <div className="field">
        <label>نوع کانفیگ</label>
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

      {rules.kind === "unlimited" ? (
        <div className="rate-shop-card">
          <div className="rate-shop-card-label">حجم</div>
          <div className="rate-shop-unlimited">نامحدود</div>
        </div>
      ) : (
        <div className="rate-shop-card">
          <div className="rate-shop-card-label">حجم (گیگابایت)</div>
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
              onBlur={onGbBlur}
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
        {category === "national" || monthOptions.length <= 1 ? (
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

      <div className="rate-shop-card">
        <div className="rate-shop-card-label">محدودیت کاربر</div>
        <div className="rate-stepper">
          <button type="button" className="rate-step-btn" disabled={busy || limitIp <= 0} onClick={() => bumpIp(-1)} aria-label="کاهش محدودیت">
            −
          </button>
          <div className="rate-step-value num">{limitIp <= 0 ? "نامحدود" : limitIp}</div>
          <button type="button" className="rate-step-btn" disabled={busy || limitIp >= 10} onClick={() => bumpIp(1)} aria-label="افزایش محدودیت">
            +
          </button>
        </div>
        <p className="muted rate-shop-hint">پیش‌فرض نامحدود · حداکثر ۱۰</p>
      </div>

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

      <div className="rate-shop-price">
        <span className="muted">قیمت</span>
        <strong className="num">
          {quoting ? "…" : price != null ? formatToman(price) : quoteErr ? "—" : "…"}
        </strong>
      </div>
      {quoteErr && <p className="muted" style={{ color: "var(--pink)", marginTop: 0 }}>{quoteErr}</p>}

      <div className="actions stack rate-shop-actions">
        {variant === "user" && (
          <>
            <button type="button" className="btn light wide" disabled={!canSubmit} onClick={() => void submit(true)}>
              پرداخت با کیف پول و ساخت
            </button>
            <button type="button" className="btn success wide" disabled={!canSubmit} onClick={() => void submit(false)}>
              کارت‌به‌کارت و ساخت کانفیگ
            </button>
          </>
        )}
        {variant === "agent" && (
          <button type="button" className="btn success wide" disabled={!canSubmit} onClick={() => void submit(true)}>
            پرداخت و ساخت کانفیگ
          </button>
        )}
        {variant === "admin" && (
          <button type="button" className="btn success wide" disabled={!canSubmit} onClick={() => void submit(true)}>
            ساخت کانفیگ
          </button>
        )}
      </div>
    </div>
  );
}
