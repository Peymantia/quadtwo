"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./DashShell";
import { Modal } from "./Modal";
import { formatPriceInput, parsePriceInput } from "./prices/price-utils";

export type PriceOverrideCard = {
  id: string;
  category: string;
  perGb: number | null;
  perMonth: number | null;
  unlimitedPerMonth: number | null;
  partnerPricePercent: number;
  note: string | null;
};

type CatOpt = { key: string; label: string };

type Props = {
  userId: string;
  useCustomPricing: boolean;
  overrides: PriceOverrideCard[];
  onFlash: (ok: string | null, bad?: string | null) => void;
  askConfirm: (message: string) => Promise<boolean>;
  onChange: (next: { useCustomPricing: boolean; priceOverrides: PriceOverrideCard[] }) => void;
};

const emptyForm = (category: string) => ({
  category,
  perGb: "",
  perMonth: "",
  unlimitedPerMonth: "",
  note: "",
});

function errText(e: unknown) {
  return String(e instanceof Error ? e.message : e);
}

function summarizeOverride(o: PriceOverrideCard) {
  if (o.category === "unlimited") {
    return o.unlimitedPerMonth != null ? `${formatPriceInput(o.unlimitedPerMonth)} تومان / ماه` : "—";
  }
  const parts: string[] = [];
  if (o.perGb != null) parts.push(`${formatPriceInput(o.perGb)} / گیگ`);
  if (o.perMonth != null) parts.push(`${formatPriceInput(o.perMonth)} / ماه`);
  return parts.length ? parts.join(" · ") : "—";
}

export function UserCustomPricingPanel({
  userId,
  useCustomPricing,
  overrides,
  onFlash,
  askConfirm,
  onChange,
}: Props) {
  const [cats, setCats] = useState<CatOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm("data"));

  useEffect(() => {
    void api<{ categories: Array<{ key: string; label: string }> }>("/admin/categories")
      .then((r) => {
        const list = (r.categories || [])
          .filter((c) => c.key !== "wholesale" && c.key !== "offer" && c.key !== "reseller")
          .map((c) => ({ key: c.key, label: c.label }));
        setCats(list.length ? list : [{ key: "data", label: "حجمی" }, { key: "national", label: "ملی" }, { key: "unlimited", label: "نامحدود" }]);
      })
      .catch(() => {
        setCats([
          { key: "data", label: "حجمی" },
          { key: "national", label: "ملی" },
          { key: "unlimited", label: "نامحدود" },
        ]);
      });
  }, []);

  const catLabel = (key: string) => cats.find((c) => c.key === key)?.label || key;

  const availableCats = useMemo(() => {
    const used = new Set(overrides.map((o) => o.category));
    return cats.filter((c) => !used.has(c.key) || c.key === form.category);
  }, [cats, overrides, form.category]);

  async function setDefaultPricing(useDefault: boolean) {
    setBusy(true);
    try {
      const r = await api<{ useCustomPricing: boolean }>(`/admin/users/${userId}/pricing-mode`, {
        method: "PATCH",
        body: { useCustomPricing: !useDefault },
      });
      onChange({ useCustomPricing: r.useCustomPricing, priceOverrides: overrides });
      onFlash(useDefault ? "از این پس قیمت پیش‌فرض پنل اعمال می‌شود" : "قیمت‌گذاری اختصاصی فعال شد");
    } catch (e) {
      onFlash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  function openAdd() {
    const first = availableCats[0]?.key || "data";
    setEditingId(null);
    setForm(emptyForm(first));
    setEditorOpen(true);
  }

  function openEdit(o: PriceOverrideCard) {
    setEditingId(o.id);
    setForm({
      category: o.category,
      perGb: o.perGb != null ? formatPriceInput(o.perGb) : "",
      perMonth: o.perMonth != null ? formatPriceInput(o.perMonth) : "",
      unlimitedPerMonth: o.unlimitedPerMonth != null ? formatPriceInput(o.unlimitedPerMonth) : "",
      note: o.note ?? "",
    });
    setEditorOpen(true);
  }

  async function saveOverride() {
    setBusy(true);
    try {
      const r = await api<{ priceOverrides: PriceOverrideCard[] }>(`/admin/users/${userId}/price-overrides`, {
        method: "PUT",
        body: {
          id: editingId || undefined,
          category: form.category,
          perGb: form.category === "unlimited" ? null : form.perGb ? parsePriceInput(form.perGb) : null,
          perMonth: form.category === "unlimited" ? null : form.perMonth ? parsePriceInput(form.perMonth) : null,
          unlimitedPerMonth:
            form.category === "unlimited" ? (form.unlimitedPerMonth ? parsePriceInput(form.unlimitedPerMonth) : null) : null,
          note: form.note || null,
        },
      });
      onChange({ useCustomPricing: true, priceOverrides: r.priceOverrides });
      onFlash(editingId ? "قیمت اختصاصی به‌روز شد" : "قیمت اختصاصی اضافه شد");
      setEditorOpen(false);
    } catch (e) {
      onFlash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(o: PriceOverrideCard) {
    if (!(await askConfirm(`قیمت اختصاصی «${catLabel(o.category)}» حذف شود؟`))) return;
    setBusy(true);
    try {
      const r = await api<{ priceOverrides: PriceOverrideCard[] }>(
        `/admin/users/${userId}/price-overrides/${o.id}`,
        { method: "DELETE" },
      );
      onChange({ useCustomPricing, priceOverrides: r.priceOverrides });
      onFlash("حذف شد");
    } catch (e) {
      onFlash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  const useDefault = !useCustomPricing;
  const isUnlimited = form.category === "unlimited";

  return (
    <div className="user-pricing">
      <h2 className="user-pricing__title">قیمت‌گذاری</h2>
      <div className="setting-row user-pricing__switch">
        <div>
          <div className="t">استفاده از قیمت‌گذاری پیش‌فرض</div>
          <div className="d">
            روشن = خرید با نرخ پنل. خاموش = کارت‌های اختصاصی زیر اعمال می‌شوند (بدون پاک شدن هنگام روشن‌کردن مجدد).
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={useDefault}
            disabled={busy}
            onChange={(e) => void setDefaultPricing(e.target.checked)}
          />
          <span className="track" />
        </label>
      </div>

      {!useDefault && (
        <div className="user-pricing__custom">
          <div className="user-pricing__toolbar">
            <p className="muted" style={{ margin: 0 }}>
              برای هر سرویس یک نرخ جدا ذخیره کنید.
            </p>
            <button type="button" className="btn primary sm" disabled={busy || !availableCats.length} onClick={openAdd}>
              <Icon name="plus" size={14} />
              افزودن قیمت اختصاصی
            </button>
          </div>

          <div className="user-pricing__cards">
            {overrides.map((o) => (
              <div key={o.id} className="user-pricing-card">
                <div className="user-pricing-card__head">
                  <strong>{catLabel(o.category)}</strong>
                  <span className="num muted">{summarizeOverride(o)}</span>
                </div>
                {o.note ? <p className="user-pricing-card__note">{o.note}</p> : null}
                <div className="user-pricing-card__actions">
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => openEdit(o)}>
                    <Icon name="edit" size={14} />
                    ویرایش
                  </button>
                  <button type="button" className="btn danger sm" disabled={busy} onClick={() => void removeOverride(o)}>
                    <Icon name="trash" size={14} />
                    حذف
                  </button>
                </div>
              </div>
            ))}
            {!overrides.length && <p className="muted">هنوز قیمت اختصاصی ثبت نشده — افزودن را بزنید.</p>}
          </div>
        </div>
      )}

      {editorOpen && (
        <Modal
          open
          title={editingId ? "ویرایش قیمت اختصاصی" : "افزودن قیمت اختصاصی"}
          onClose={() => setEditorOpen(false)}
        >
          <div className="field">
            <label>سرویس</label>
            <select
              value={form.category}
              disabled={Boolean(editingId)}
              onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
            >
              {(editingId ? cats : availableCats).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {isUnlimited ? (
            <div className="field">
              <label>تومان ماهانه نامحدود</label>
              <input
                className="num"
                inputMode="numeric"
                dir="ltr"
                value={form.unlimitedPerMonth}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    unlimitedPerMonth: formatPriceInput(parsePriceInput(e.target.value) || ""),
                  }))
                }
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label>تومان به ازای هر گیگ</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={form.perGb}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      perGb: formatPriceInput(parsePriceInput(e.target.value) || ""),
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>تومان به ازای هر ماه</label>
                <input
                  className="num"
                  inputMode="numeric"
                  dir="ltr"
                  value={form.perMonth}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      perMonth: formatPriceInput(parsePriceInput(e.target.value) || ""),
                    }))
                  }
                />
              </div>
            </>
          )}
          <div className="field">
            <label>توضیحات (اختیاری)</label>
            <input value={form.note} onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))} />
          </div>
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void saveOverride()}>
              <Icon name="check" size={15} />
              ذخیره
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditorOpen(false)}>
              <Icon name="close" size={15} />
              لغو
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
