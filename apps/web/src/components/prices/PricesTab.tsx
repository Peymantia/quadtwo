"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatToman } from "../../lib/api";
import { Icon, type IconName } from "../DashShell";
import { SettingsAccordion } from "../SettingsAccordion";
import {
  FALLBACK_CATEGORIES,
  catLabel,
  errText,
  formatPriceInput,
  isWholesaleCategory,
  parsePriceInput,
  volumeCats,
  type PriceRatesState,
  type PriceRow,
  type PricesAskConfirm,
  type PricesFlash,
  type PricingModesState,
} from "./price-utils";

type PricesSubTab =
  | "overview"
  | "data"
  | "national"
  | "unlimited"
  | "offer"
  | "wholesale"
  | "rates";

const SUBTABS: Array<{ key: PricesSubTab; label: string; icon: IconName }> = [
  { key: "overview", label: "نمای کلی", icon: "home" },
  { key: "data", label: "بسته‌های حجمی", icon: "wifi" },
  { key: "national", label: "اینترنت ملی", icon: "layers" },
  { key: "unlimited", label: "نامحدود", icon: "renew" },
  { key: "offer", label: "پیشنهاد ویژه", icon: "tag" },
  { key: "wholesale", label: "عمده‌فروش", icon: "shop" },
  { key: "rates", label: "نرخ‌ها و حالت‌ها", icon: "gear" },
];

const emptyNew = (category: string) => ({
  category,
  trafficGb: "",
  months: "1",
  priceUser: "",
  pricePartner: "",
  priceWholesale: "",
  priceReseller: "",
  limitIp: "1",
  title: "",
  isGolden: false,
});

export function PricesTab({ flash, askConfirm }: { flash: PricesFlash; askConfirm: PricesAskConfirm }) {
  const [sub, setSub] = useState<PricesSubTab>("overview");
  const [cells, setCells] = useState<PriceRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<PriceRow>>>({});
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [bulkMode, setBulkMode] = useState<"percent" | "amount">("percent");
  const [bulkValue, setBulkValue] = useState("");
  const [modes, setModes] = useState<PricingModesState>({
    user: "matrix",
    partner: "matrix",
    reseller: "matrix",
    wholesale: "matrix",
  });
  const [rates, setRates] = useState<PriceRatesState>({
    user: { perGb: 15000, perMonth: 30000, unlimitedPerMonth: 1500000 },
    partner: { perGb: 12000, perMonth: 25000, unlimitedPerMonth: 1200000 },
    wholesale: { perGb: 10000, perMonth: 20000, unlimitedPerMonth: 1000000 },
    wholesaleRole: { perGb: 8000, perMonth: 15000, unlimitedPerMonth: 900000 },
    categories: {},
  });
  const [ratesBusy, setRatesBusy] = useState(false);
  const [newCell, setNewCell] = useState(emptyNew("data"));
  const [dataCat, setDataCat] = useState("data");
  const [modeAccOpen, setModeAccOpen] = useState<string | null>(null);
  const [toolsAccOpen, setToolsAccOpen] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{
        cells: PriceRow[];
        modes?: PricingModesState;
        rates?: PriceRatesState;
      }>("/admin/prices").then((r) => {
        setCells(r.cells);
        if (r.modes) {
          setModes({
            user: r.modes.user ?? "matrix",
            partner: r.modes.partner ?? "matrix",
            reseller: r.modes.reseller ?? "matrix",
            wholesale: "matrix",
          });
        }
        if (r.rates) {
          setRates({
            ...r.rates,
            categories: r.rates.categories ?? {},
            wholesaleRole:
              r.rates.wholesaleRole ??
              r.rates.wholesale ?? {
                perGb: 8000,
                perMonth: 15000,
                unlimitedPerMonth: 900000,
              },
          });
        }
      }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<{ categories: Array<{ key: string; label: string }> }>("/admin/categories")
      .then((r) => {
        if (r.categories?.length) {
          setCategories(r.categories.map((c) => ({ key: c.key, label: c.label })));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setToolsAccOpen(null);
    if (sub === "data") {
      const vols = volumeCats(categories);
      const next = vols.some((c) => c.key === dataCat) ? dataCat : vols[0]?.key || "data";
      setDataCat(next);
      setNewCell((s) => (s.category === next ? s : emptyNew(next)));
    } else if (sub === "national") {
      setNewCell(emptyNew("national"));
    } else if (sub === "unlimited") {
      setNewCell(emptyNew("unlimited"));
    } else if (sub === "offer") {
      setNewCell(emptyNew("offer"));
    } else if (sub === "wholesale") {
      setNewCell(emptyNew("wholesale"));
    }
  }, [sub, categories, dataCat]);

  const scopedCategory = useMemo(() => {
    if (sub === "data") return dataCat;
    if (sub === "national") return "national";
    if (sub === "unlimited") return "unlimited";
    if (sub === "offer") return "offer";
    if (sub === "wholesale") return "wholesale";
    return "";
  }, [sub, dataCat]);

  const shown = useMemo(() => {
    if (sub === "data") {
      const keys = new Set(volumeCats(categories).map((c) => c.key));
      return cells.filter((c) => keys.has(c.category));
    }
    if (sub === "national") return cells.filter((c) => c.category === "national");
    if (sub === "unlimited") return cells.filter((c) => c.category === "unlimited");
    if (sub === "offer") return cells.filter((c) => c.category === "offer");
    if (sub === "wholesale") return cells.filter((c) => isWholesaleCategory(c.category));
    return [];
  }, [cells, sub, categories]);

  const shownScoped = useMemo(() => {
    if (sub === "data" && dataCat) return shown.filter((c) => c.category === dataCat);
    return shown;
  }, [shown, sub, dataCat]);

  const rateCategories = categories.filter(
    (c) => c.key !== "unlimited" && c.key !== "wholesale" && c.key !== "offer" && c.key !== "reseller",
  );

  function catUnit(cat: string, role: "user" | "partner" | "wholesale", field: "perGb" | "perMonth") {
    return Number(rates.categories?.[cat]?.[role]?.[field] ?? rates[role][field] ?? 0);
  }

  function setCatUnit(cat: string, role: "user" | "partner" | "wholesale", field: "perGb" | "perMonth", value: number) {
    setRates((s) => ({
      ...s,
      categories: {
        ...s.categories,
        [cat]: {
          ...(s.categories[cat] ?? {}),
          [role]: {
            ...(s.categories[cat]?.[role] ?? {}),
            [field]: value,
          },
        },
      },
    }));
  }

  async function saveModes(next: PricingModesState) {
    const locked = { ...next, wholesale: "matrix" as const };
    setModes(locked);
    try {
      await api("/admin/pricing-modes", { method: "PUT", body: locked });
      flash("حالت قیمت‌گذاری نقش‌ها ذخیره شد");
    } catch (e) {
      flash(null, errText(e));
      await load();
    }
  }

  async function saveRates() {
    setRatesBusy(true);
    try {
      await api("/admin/price-rates", { method: "PUT", body: rates });
      flash("نرخ‌های گیگ/ماه ذخیره شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setRatesBusy(false);
    }
  }

  async function putCell(c: PriceRow, e: Partial<PriceRow>) {
    const isWh = isWholesaleCategory(c.category);
    const resellerPrice = Number(e.priceReseller ?? c.priceReseller ?? 0);
    await api(`/admin/prices/${c.id}`, {
      method: "PUT",
      body: isWh
        ? {
            priceUser: resellerPrice,
            pricePartner: resellerPrice,
            priceWholesale: resellerPrice,
            priceReseller: resellerPrice,
            limitIp: Number(e.limitIp ?? c.limitIp ?? 0),
            title: e.title ?? c.title,
          }
        : {
            priceUser: Number(e.priceUser ?? c.priceUser),
            pricePartner: Number(e.pricePartner ?? c.pricePartner),
            priceWholesale: Number(e.priceWholesale ?? c.priceWholesale),
            priceReseller: Number(e.priceReseller ?? c.priceReseller ?? 0),
            limitIp: Number(e.limitIp ?? c.limitIp ?? 0),
            title: e.title ?? c.title,
          },
    });
  }

  async function saveRow(c: PriceRow) {
    const e = edits[c.id];
    if (!e) return;
    try {
      await putCell(c, e);
      flash("قیمت ذخیره شد");
      setEdits((m) => {
        const n = { ...m };
        delete n[c.id];
        return n;
      });
      await load();
    } catch (er) {
      flash(null, errText(er));
    }
  }

  async function saveAllScoped() {
    const ids = Object.keys(edits).filter((id) => shownScoped.some((c) => c.id === id));
    if (!ids.length) return;
    try {
      let n = 0;
      for (const id of ids) {
        const c = cells.find((x) => x.id === id);
        const e = edits[id];
        if (!c || !e) continue;
        await putCell(c, e);
        n++;
      }
      setEdits((m) => {
        const next = { ...m };
        for (const id of ids) delete next[id];
        return next;
      });
      flash(`${n} پلن ذخیره شد`);
      await load();
    } catch (er) {
      flash(null, errText(er));
    }
  }

  function discardScopedEdits() {
    const ids = new Set(shownScoped.map((c) => c.id));
    setEdits((m) => {
      const next = { ...m };
      for (const id of Object.keys(next)) {
        if (ids.has(id)) delete next[id];
      }
      return next;
    });
    flash("تغییرات این بخش لغو شد");
  }

  async function deleteRow(c: PriceRow) {
    if (!(await askConfirm(`پلن ${c.trafficGb ?? "∞"}GB / ${c.months} ماه حذف شود؟`))) return;
    try {
      await api(`/admin/prices/${c.id}`, { method: "DELETE" });
      flash("پلن حذف شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function toggleActive(c: PriceRow, active: boolean) {
    try {
      await api(`/admin/prices/${c.id}`, { method: "PUT", body: { active } });
      setCells((list) => list.map((x) => (x.id === c.id ? { ...x, active } : x)));
      flash(active ? "پلن فعال شد" : "پلن غیرفعال شد");
    } catch (e) {
      flash(null, errText(e));
      await load();
    }
  }

  async function toggleGolden(c: PriceRow, isGolden: boolean) {
    try {
      await api(`/admin/prices/${c.id}`, { method: "PUT", body: { isGolden } });
      setCells((list) => list.map((x) => (x.id === c.id ? { ...x, isGolden } : x)));
      flash(isGolden ? "اولویت روی نرخ فعال شد" : "اولویت روی نرخ برداشته شد");
    } catch (e) {
      flash(null, errText(e));
      await load();
    }
  }

  async function addCell() {
    try {
      const isUnlimited = newCell.category === "unlimited";
      const isOffer = newCell.category === "offer";
      const isWholesale = isWholesaleCategory(newCell.category);
      const trafficGb =
        isUnlimited || (isOffer && !String(newCell.trafficGb).trim())
          ? null
          : newCell.trafficGb === ""
            ? null
            : Number(newCell.trafficGb);
      if (!isUnlimited && !isOffer && (trafficGb === null || !Number.isFinite(trafficGb) || trafficGb <= 0)) {
        flash(null, "برای دسته‌های حجمی، حجم GB را وارد کنید.");
        return;
      }
      if (isOffer && trafficGb != null && (!Number.isFinite(trafficGb) || trafficGb <= 0)) {
        flash(null, "حجم پیشنهاد ویژه نامعتبر است (خالی = نامحدود).");
        return;
      }
      if (isWholesale && !parsePriceInput(newCell.priceReseller)) {
        flash(null, "قیمت عمده‌فروش را وارد کنید.");
        return;
      }
      if (!isWholesale && !parsePriceInput(newCell.priceUser)) {
        flash(null, "قیمت کاربر را وارد کنید.");
        return;
      }
      const wholesalePrice = parsePriceInput(newCell.priceReseller);
      await api("/admin/prices", {
        body: isWholesale
          ? {
              category: "wholesale",
              trafficGb,
              months: Number(newCell.months),
              priceUser: wholesalePrice,
              pricePartner: wholesalePrice,
              priceWholesale: wholesalePrice,
              priceReseller: wholesalePrice,
              limitIp: Number(newCell.limitIp) || 1,
              title: newCell.title || undefined,
              isGolden: false,
            }
          : {
              category: isUnlimited ? "unlimited" : newCell.category,
              trafficGb,
              months: Number(newCell.months),
              priceUser: parsePriceInput(newCell.priceUser),
              pricePartner: parsePriceInput(newCell.pricePartner),
              priceWholesale: parsePriceInput(newCell.priceWholesale),
              priceReseller: parsePriceInput(newCell.priceReseller),
              title: newCell.title || undefined,
              isGolden: newCell.isGolden,
            },
      });
      flash("پلن جدید اضافه شد");
      setNewCell(emptyNew(newCell.category));
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  async function bulk() {
    const value = Number(bulkValue);
    if (!value) {
      flash(null, "مقدار را وارد کنید (مثلاً 10 یا -5)");
      return;
    }
    const scope = scopedCategory || (sub === "data" ? dataCat : "");
    if (!scope) {
      flash(null, "دسته برای ویرایش گروهی مشخص نیست.");
      return;
    }
    const label =
      bulkMode === "percent"
        ? `${value}% ${value > 0 ? "افزایش" : "کاهش"}`
        : `${formatToman(Math.abs(value))} ${value > 0 ? "افزایش" : "کاهش"}`;
    if (!(await askConfirm(`قیمت دستهٔ «${catLabel(scope, categories)}» ${label} یابد؟`))) return;
    try {
      const r = await api<{ updated: number }>("/admin/prices/bulk", {
        body: { category: scope, mode: bulkMode, value, roundTo: 1000 },
      });
      flash(`${r.updated} پلن به‌روزرسانی شد`);
      setBulkValue("");
      await load();
    } catch (e) {
      flash(null, errText(e));
    }
  }

  const modeLabel = (m: string) => (m === "rate" ? "نرخی" : "ماتریکس");

  function openRoleMode(roleKey: "user" | "partner" | "reseller" | "wholesale") {
    if (roleKey === "wholesale") {
      setSub("wholesale");
      return;
    }
    setSub("rates");
    setModeAccOpen(`mode-${roleKey}`);
  }

  return (
    <div className="prices-page">
      <div className="prices-nav">
        <div className="prices-subtabs" role="tablist" aria-label="بخش‌های قیمت‌ها">
          {SUBTABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={sub === t.key}
              className={`prices-subtab${sub === t.key ? " on" : ""}`}
              onClick={() => setSub(t.key)}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>
        {sub !== "overview" && (
          <button type="button" className="btn ghost sm prices-back" onClick={() => setSub("overview")}>
            <Icon name="home" size={14} />
            بازگشت به نمای کلی
          </button>
        )}
      </div>

      {sub === "overview" && (
        <section className="panel prices-section">
          <div className="prices-section-head">
            <h2>نمای کلی قیمت‌گذاری</h2>
            <p className="muted">
              از تب‌های بالا نوع محصول را انتخاب کنید. کارت هر نقش فقط وضعیت همان نقش را نشان می‌دهد — برای تغییر حالت، روی
              همان کارت بزنید.
            </p>
          </div>
          <div className="prices-overview-grid">
            {(
              [
                ["user", "کاربر عادی", modes.user],
                ["partner", "همکار", modes.partner],
                ["reseller", "همکار ویژه", modes.reseller],
                ["wholesale", "عمده‌فروش", "matrix"],
              ] as const
            ).map(([key, label, mode]) => (
              <button
                key={key}
                type="button"
                className="prices-overview-card"
                onClick={() => openRoleMode(key)}
              >
                <strong>{label}</strong>
                <span className="muted">{modeLabel(mode)}</span>
                {key === "wholesale" && <small className="hint">همیشه پلن ثابت عمده</small>}
              </button>
            ))}
          </div>
          <div className="prices-legend">
            <p className="hint" style={{ margin: 0 }}>
              <strong>همکار ویژه</strong> ≠ <strong>عمده‌فروش</strong> — قیمت همکار ویژه ستون جداست؛ عمده‌فروش فقط پلن‌های
              تب «عمده‌فروش» را می‌بیند و می‌خرد.
            </p>
          </div>
        </section>
      )}

      {sub === "rates" && (
        <>
          <div className="prices-section-head" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>حالت قیمت‌گذاری هر نقش</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              هر نقش آکاردئون جدا دارد. ماتریکس = پلن ثابت · نرخی = (گیگ × نرخ) + (ماه × نرخ)
            </p>
          </div>
          <div className="prices-mode-accs">
            {(
              [
                ["user", "کاربر عادی", "users"],
                ["partner", "همکار", "users"],
                ["reseller", "همکار ویژه", "shield"],
              ] as const
            ).map(([key, label, icon]) => (
              <SettingsAccordion
                key={key}
                id={`mode-${key}`}
                title={`${label} — ${modeLabel(modes[key])}`}
                icon={icon}
                openId={modeAccOpen}
                onToggle={(id) => setModeAccOpen((cur) => (cur === id ? null : id))}
              >
                <div className="pricing-mode-card pricing-mode-card--in-acc">
                  <label>حالت قیمت‌گذاری</label>
                  <select
                    value={modes[key]}
                    onChange={(e) => void saveModes({ ...modes, [key]: e.target.value as "matrix" | "rate" })}
                  >
                    <option value="matrix">ماتریکس (پلن ثابت)</option>
                    <option value="rate">نرخی (گیگ + ماه)</option>
                  </select>
                </div>
              </SettingsAccordion>
            ))}
            <SettingsAccordion
              id="mode-wholesale"
              title={`عمده‌فروش — ${modeLabel("matrix")}`}
              icon="shop"
              openId={modeAccOpen}
              onToggle={(id) => setModeAccOpen((cur) => (cur === id ? null : id))}
            >
              <div className="pricing-mode-card pricing-mode-card--locked pricing-mode-card--in-acc">
                <label>حالت قیمت‌گذاری</label>
                <select value="matrix" disabled>
                  <option value="matrix">ماتریکس (پلن ثابت)</option>
                </select>
                <p className="hint" style={{ margin: "6px 0 0" }}>
                  پلن‌های ثابت عمده همیشه ماتریکس‌اند؛ سوئیچ نرخی روی خرید عمده اعمال نمی‌شود.
                </p>
              </div>
            </SettingsAccordion>
          </div>

          <section className="panel prices-section">
            <div className="prices-section-head">
              <h2>نرخ هر گیگ / هر ماه</h2>
              <p className="muted">برای نقش‌هایی که حالت «نرخی» دارند. نامحدود از «قیمت هر ماه نامحدود» می‌آید.</p>
            </div>
            <div className="rate-cards-grid">
              {rateCategories.map((cat) => (
                <div key={cat.key} className="rate-cat-card">
                  <div className="rate-cat-card__title">{cat.label}</div>
                  <div className="rate-role-rows">
                    {(
                      [
                        ["user", "کاربر"],
                        ["partner", "همکار"],
                        ["wholesale", "همکار ویژه"],
                      ] as const
                    ).map(([role, roleLabel]) => (
                      <div key={role} className="rate-role-row">
                        <span className="rate-role-label">{roleLabel}</span>
                        <div className="field">
                          <label>هر گیگ</label>
                          <input
                            className="num"
                            inputMode="numeric"
                            dir="ltr"
                            value={formatPriceInput(catUnit(cat.key, role, "perGb"))}
                            onChange={(e) => setCatUnit(cat.key, role, "perGb", parsePriceInput(e.target.value))}
                          />
                        </div>
                        <div className="field">
                          <label>هر ماه</label>
                          <input
                            className="num"
                            inputMode="numeric"
                            dir="ltr"
                            value={formatPriceInput(catUnit(cat.key, role, "perMonth"))}
                            onChange={(e) => setCatUnit(cat.key, role, "perMonth", parsePriceInput(e.target.value))}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="rate-cat-card rate-cat-card--unlimited">
                <div className="rate-cat-card__title">نامحدود (قیمت هر ماه)</div>
                <p className="muted rate-cat-card__note">
                  اگر این عدد پر باشد، حتی در حالت ماتریکس برای نامحدود از نرخ استفاده می‌شود.
                </p>
                <div className="rate-unlimited-fields">
                  {(
                    [
                      ["user", "کاربر"],
                      ["partner", "همکار"],
                      ["wholesale", "همکار ویژه"],
                    ] as const
                  ).map(([role, roleLabel]) => (
                    <div key={role} className="field">
                      <label>{roleLabel}</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(rates[role].unlimitedPerMonth)}
                        onChange={(e) =>
                          setRates((s) => ({
                            ...s,
                            [role]: { ...s[role], unlimitedPerMonth: parsePriceInput(e.target.value) },
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rate-cat-card rate-cat-card--wholesale-role">
                <div className="rate-cat-card__title">نرخ عمده‌فروش (آینده / نرخی)</div>
                <p className="muted rate-cat-card__note">
                  جدا از «همکار ویژه». اگر روزی خرید عمده از حالت ثابت خارج شود، از این نرخ استفاده می‌شود. فعلاً
                  کاتالوگ عمده فقط پلن ثابت است.
                </p>
                <div className="rate-unlimited-fields">
                  <div className="field">
                    <label>هر گیگ</label>
                    <input
                      className="num"
                      inputMode="numeric"
                      dir="ltr"
                      value={formatPriceInput(rates.wholesaleRole?.perGb ?? 0)}
                      onChange={(e) =>
                        setRates((s) => ({
                          ...s,
                          wholesaleRole: {
                            perGb: parsePriceInput(e.target.value),
                            perMonth: s.wholesaleRole?.perMonth ?? 0,
                            unlimitedPerMonth: s.wholesaleRole?.unlimitedPerMonth ?? 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>هر ماه</label>
                    <input
                      className="num"
                      inputMode="numeric"
                      dir="ltr"
                      value={formatPriceInput(rates.wholesaleRole?.perMonth ?? 0)}
                      onChange={(e) =>
                        setRates((s) => ({
                          ...s,
                          wholesaleRole: {
                            perGb: s.wholesaleRole?.perGb ?? 0,
                            perMonth: parsePriceInput(e.target.value),
                            unlimitedPerMonth: s.wholesaleRole?.unlimitedPerMonth ?? 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>نامحدود / ماه</label>
                    <input
                      className="num"
                      inputMode="numeric"
                      dir="ltr"
                      value={formatPriceInput(rates.wholesaleRole?.unlimitedPerMonth ?? 0)}
                      onChange={(e) =>
                        setRates((s) => ({
                          ...s,
                          wholesaleRole: {
                            perGb: s.wholesaleRole?.perGb ?? 0,
                            perMonth: s.wholesaleRole?.perMonth ?? 0,
                            unlimitedPerMonth: parsePriceInput(e.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
            <p className="hint" style={{ margin: "12px 0 10px" }}>
              مثال حجمی: ۵۰ گیگ ۲ ماهه = (۵۰ × هر گیگ) + (۲ × هر ماه)
            </p>
            <button
              type="button"
              className="btn success prices-save-rates-btn"
              disabled={ratesBusy}
              onClick={() => void saveRates()}
            >
              <Icon name="check" size={15} />
              {ratesBusy ? "…" : "ذخیره نرخ‌ها"}
            </button>
          </section>
        </>
      )}

      {(sub === "data" ||
        sub === "national" ||
        sub === "unlimited" ||
        sub === "offer" ||
        sub === "wholesale") && (
        <>
          {sub === "unlimited" && (
            <p className="prices-banner" role="status">
              اگر در «نرخ‌ها و حالت‌ها» قیمت ماهانه نامحدود پر باشد، همان نرخ بر سلول ماتریکس اولویت دارد — مگر پلن
              «اولویت روی نرخ» داشته باشد (آن‌وقت قیمت ثابت پلن استفاده می‌شود).
            </p>
          )}
          {sub === "offer" && (
            <p className="prices-banner" role="status">
              پیشنهاد ویژه همیشه پلن ثابت ماتریکس است؛ فرمول نرخی روی آن اعمال نمی‌شود.
            </p>
          )}
          {sub === "wholesale" && (
            <p className="prices-banner" role="status">
              این پلن‌ها فقط برای نقش عمده‌فروش قابل خریدند و همیشه ماتریکس‌اند.
            </p>
          )}

          <div className="prices-tools-accs">
            <SettingsAccordion
              id="add-plan"
              title={
                sub === "wholesale"
                  ? "افزودن پلن عمده‌فروش"
                  : sub === "offer"
                    ? "افزودن پیشنهاد ویژه"
                    : sub === "unlimited"
                      ? "افزودن پلن نامحدود"
                      : sub === "national"
                        ? "افزودن پلن اینترنت ملی"
                        : "افزودن پلن حجمی"
              }
              icon="plus"
              openId={toolsAccOpen}
              onToggle={(id) => setToolsAccOpen((cur) => (cur === id ? null : id))}
            >
              <p className="muted prices-acc-hint">
                {sub === "wholesale"
                  ? "قیمت و تعداد کاربر (IP) برای عمده‌فروش."
                  : "چهار ستون قیمت: کاربر، همکار، همکار ویژه، عمده‌فروش."}
              </p>
              <div className="prices-add-grid">
                {sub === "data" && (
                  <div className="field">
                    <label>دسته حجمی</label>
                    <select
                      value={dataCat}
                      onChange={(e) => {
                        setDataCat(e.target.value);
                        setNewCell(emptyNew(e.target.value));
                      }}
                    >
                      {volumeCats(categories).map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>
                    {sub === "unlimited"
                      ? "حجم (نامحدود)"
                      : sub === "offer"
                        ? "حجم GB (خالی = نامحدود)"
                        : "حجم GB"}
                  </label>
                  <input
                    className="num"
                    inputMode="numeric"
                    disabled={sub === "unlimited"}
                    placeholder={sub === "unlimited" ? "∞" : sub === "offer" ? "مثلاً 50 یا خالی" : "مثلاً 100"}
                    value={sub === "unlimited" ? "" : newCell.trafficGb}
                    onChange={(e) => setNewCell((s) => ({ ...s, trafficGb: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>مدت (ماه)</label>
                  <input
                    className="num"
                    inputMode="numeric"
                    value={newCell.months}
                    onChange={(e) => setNewCell((s) => ({ ...s, months: e.target.value }))}
                  />
                </div>
                {sub === "wholesale" ? (
                  <>
                    <div className="field">
                      <label>قیمت عمده‌فروش</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(newCell.priceReseller)}
                        onChange={(e) =>
                          setNewCell((s) => ({
                            ...s,
                            priceReseller: formatPriceInput(parsePriceInput(e.target.value) || ""),
                          }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label>تعداد کاربر (IP)</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={newCell.limitIp}
                        onChange={(e) => setNewCell((s) => ({ ...s, limitIp: e.target.value.replace(/[^\d]/g, "") }))}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label>قیمت کاربر</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(newCell.priceUser)}
                        onChange={(e) =>
                          setNewCell((s) => ({
                            ...s,
                            priceUser: formatPriceInput(parsePriceInput(e.target.value) || ""),
                          }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label>قیمت همکار</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(newCell.pricePartner)}
                        onChange={(e) =>
                          setNewCell((s) => ({
                            ...s,
                            pricePartner: formatPriceInput(parsePriceInput(e.target.value) || ""),
                          }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label>قیمت همکار ویژه</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(newCell.priceWholesale)}
                        onChange={(e) =>
                          setNewCell((s) => ({
                            ...s,
                            priceWholesale: formatPriceInput(parsePriceInput(e.target.value) || ""),
                          }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label>قیمت عمده‌فروش</label>
                      <input
                        className="num"
                        inputMode="numeric"
                        dir="ltr"
                        value={formatPriceInput(newCell.priceReseller)}
                        onChange={(e) =>
                          setNewCell((s) => ({
                            ...s,
                            priceReseller: formatPriceInput(parsePriceInput(e.target.value) || ""),
                          }))
                        }
                      />
                    </div>
                  </>
                )}
                <div className="field prices-add-title">
                  <label>عنوان (اختیاری)</label>
                  <input value={newCell.title} onChange={(e) => setNewCell((s) => ({ ...s, title: e.target.value }))} />
                </div>
              </div>
              {sub !== "wholesale" && sub !== "offer" && (
                <div className="setting-row prices-add-gold-row">
                  <div>
                    <div className="t">اولویت روی نرخ</div>
                    <div className="d">اگر روشن باشد، قیمت ثابت این پلن به‌جای فرمول نرخ استفاده می‌شود.</div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={newCell.isGolden}
                      onChange={(e) => setNewCell((s) => ({ ...s, isGolden: e.target.checked }))}
                    />
                    <span className="track" />
                  </label>
                </div>
              )}
              <button
                type="button"
                className="btn success prices-add-submit"
                disabled={
                  !newCell.months ||
                  (sub === "wholesale"
                    ? !newCell.priceReseller || !newCell.trafficGb
                    : !newCell.priceUser ||
                      (sub !== "unlimited" && sub !== "offer" && !newCell.trafficGb))
                }
                onClick={() => void addCell()}
              >
                <Icon name="plus" size={15} />
                افزودن پلن
              </button>
            </SettingsAccordion>

            <SettingsAccordion
              id="bulk-edit"
              title="ویرایش گروهی این بخش"
              icon="layers"
              openId={toolsAccOpen}
              onToggle={(id) => setToolsAccOpen((cur) => (cur === id ? null : id))}
            >
              <p className="muted prices-acc-hint">
                فقط روی پلن‌های همین تب
                {scopedCategory ? ` («${catLabel(scopedCategory, categories)}»)` : ""} · مقدار منفی = کاهش · روی هر چهار
                ستون قیمت
              </p>
              {sub === "data" && (
                <div className="prices-bulk-cats">
                  {volumeCats(categories).map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={`chip${dataCat === c.key ? " on" : ""}`}
                      onClick={() => setDataCat(c.key)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="bulk-price-row bulk-price-row--compact">
                <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "percent" | "amount")}>
                  <option value="percent">درصدی</option>
                  <option value="amount">مبلغ ثابت</option>
                </select>
                <input
                  className="num"
                  inputMode="numeric"
                  placeholder={bulkMode === "percent" ? "۱۰ یا ‎-۵" : "۵۰۰۰"}
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                />
                <button type="button" className="btn primary sm" onClick={() => void bulk()}>
                  <Icon name="layers" size={14} />
                  اعمال
                </button>
              </div>
              <p className="hint" style={{ margin: "8px 0 0" }}>
                نتیجه به نزدیک‌ترین ۱٬۰۰۰ تومان گرد می‌شود.
              </p>
            </SettingsAccordion>
          </div>

          <section className="panel prices-section">
            <div className="prices-section-head">
              <h2>پلن‌های این بخش</h2>
              <p className="muted">ویرایش قیمت، فعال/غیرفعال، و ذخیره.</p>
            </div>
            {sub === "data" && (
              <div className="prices-bulk-cats" style={{ marginBottom: 14 }}>
                {volumeCats(categories).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`chip${dataCat === c.key ? " on" : ""}`}
                    onClick={() => setDataCat(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <div className={`price-plan-list${sub === "wholesale" ? " price-plan-list--wholesale" : ""}`}>
              {shownScoped.map((c) => {
                const e = edits[c.id] ?? {};
                const isWh = isWholesaleCategory(c.category);
                return (
                  <div
                    key={c.id}
                    className={`price-plan-card${c.active === false ? " off" : ""}${c.isGolden ? " golden" : ""}${isWh ? " price-plan-card--wholesale" : ""}`}
                  >
                    <div className="price-plan-head">
                      <div className="price-plan-title">
                        <strong className="num">
                          {c.title?.trim() || `${c.trafficGb ?? "∞"}GB · ${c.months}ماه`}
                          {!isWh && c.isGolden && " ★"}
                        </strong>
                        <span className="muted">{catLabel(c.category, categories)}</span>
                      </div>
                      <div className="price-plan-toggles">
                        {!isWh && sub !== "offer" && (
                          <label
                            className="price-plan-gold"
                            title="در حالت نرخی، قیمت ثابت این پلن به‌جای فرمول نرخ استفاده می‌شود"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(c.isGolden)}
                              onChange={(ev) => void toggleGolden(c, ev.target.checked)}
                            />
                            <span>اولویت روی نرخ</span>
                          </label>
                        )}
                        <label className="switch" title="فعال / غیرفعال">
                          <input
                            type="checkbox"
                            checked={c.active !== false}
                            onChange={(ev) => void toggleActive(c, ev.target.checked)}
                          />
                          <span className="track" />
                        </label>
                      </div>
                    </div>
                    <div className={`price-plan-fields${isWh ? " price-plan-fields--wholesale" : ""}`}>
                      {isWh ? (
                        <>
                          <div className="field">
                            <label>قیمت عمده‌فروش</label>
                            <input
                              className="num"
                              inputMode="numeric"
                              dir="ltr"
                              value={formatPriceInput(e.priceReseller ?? c.priceReseller ?? 0)}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: { ...m[c.id], priceReseller: parsePriceInput(ev.target.value) },
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label>کاربر (IP)</label>
                            <input
                              className="num"
                              inputMode="numeric"
                              dir="ltr"
                              value={String(e.limitIp ?? c.limitIp ?? 0)}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: {
                                    ...m[c.id],
                                    limitIp: Number(ev.target.value.replace(/[^\d]/g, "") || "0"),
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="field price-plan-fields__title">
                            <label>عنوان</label>
                            <input
                              value={String(e.title ?? c.title ?? "")}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: { ...m[c.id], title: ev.target.value },
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="field">
                            <label>کاربر</label>
                            <input
                              className="num"
                              inputMode="numeric"
                              dir="ltr"
                              value={formatPriceInput(e.priceUser ?? c.priceUser)}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: { ...m[c.id], priceUser: parsePriceInput(ev.target.value) },
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label>همکار</label>
                            <input
                              className="num"
                              inputMode="numeric"
                              dir="ltr"
                              value={formatPriceInput(e.pricePartner ?? c.pricePartner)}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: { ...m[c.id], pricePartner: parsePriceInput(ev.target.value) },
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label>همکار ویژه</label>
                            <input
                              className="num"
                              inputMode="numeric"
                              dir="ltr"
                              value={formatPriceInput(e.priceWholesale ?? c.priceWholesale)}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: { ...m[c.id], priceWholesale: parsePriceInput(ev.target.value) },
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label>عمده‌فروش</label>
                            <input
                              className="num"
                              inputMode="numeric"
                              dir="ltr"
                              value={formatPriceInput(e.priceReseller ?? c.priceReseller ?? 0)}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: { ...m[c.id], priceReseller: parsePriceInput(ev.target.value) },
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label>عنوان</label>
                            <input
                              value={String(e.title ?? c.title ?? "")}
                              onChange={(ev) =>
                                setEdits((m) => ({
                                  ...m,
                                  [c.id]: { ...m[c.id], title: ev.target.value },
                                }))
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="price-plan-actions">
                      <button type="button" className="btn primary sm" disabled={!edits[c.id]} onClick={() => void saveRow(c)}>
                        <Icon name="check" size={14} />
                        ذخیره
                      </button>
                      <button type="button" className="btn danger sm" onClick={() => void deleteRow(c)}>
                        <Icon name="trash" size={14} />
                        حذف
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {!shownScoped.length && <p className="muted">پلنی در این بخش نیست.</p>}
          </section>

          <div className="settings-sticky-bar prices-sticky-bar" role="toolbar" aria-label="ذخیره تغییرات قیمت">
            <div className="settings-sticky-bar__inner prices-sticky-bar__inner">
              <button
                type="button"
                className="settings-sticky-bar__btn settings-sticky-bar__btn--cancel"
                disabled={!Object.keys(edits).some((id) => shownScoped.some((c) => c.id === id))}
                onClick={discardScopedEdits}
              >
                <Icon name="close" size={15} />
                انصراف
              </button>
              <button
                type="button"
                className="settings-sticky-bar__btn settings-sticky-bar__btn--save"
                disabled={!Object.keys(edits).some((id) => shownScoped.some((c) => c.id === id))}
                onClick={() => void saveAllScoped()}
              >
                <Icon name="check" size={15} />
                ذخیره
                {Object.keys(edits).filter((id) => shownScoped.some((c) => c.id === id)).length
                  ? ` (${Object.keys(edits).filter((id) => shownScoped.some((c) => c.id === id)).length})`
                  : ""}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
