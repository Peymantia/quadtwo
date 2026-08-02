"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type DiscountItem = {
  id: string;
  code: string;
  percentOff: number;
  active: boolean;
  shareable?: boolean;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
  ownerLabel?: string;
  ownerRole?: string;
};

type Flash = (ok: string | null, err?: string | null) => void;

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function expiryFromNow(opts: { days?: number; weeks?: number; months?: number }): string {
  const d = new Date();
  if (opts.days) d.setDate(d.getDate() + opts.days);
  if (opts.weeks) d.setDate(d.getDate() + opts.weeks * 7);
  if (opts.months) d.setMonth(d.getMonth() + opts.months);
  return toLocalInput(d.toISOString());
}

const EXPIRY_PRESETS: Array<{ label: string; opts: { days?: number; weeks?: number; months?: number } }> = [
  { label: "یک روز", opts: { days: 1 } },
  { label: "سه روز", opts: { days: 3 } },
  { label: "یک هفته", opts: { weeks: 1 } },
  { label: "دو هفته", opts: { weeks: 2 } },
  { label: "یک ماه", opts: { months: 1 } },
];

export function DiscountCodesPanel({
  flash,
  askConfirm,
  showOwner = false,
}: {
  flash: Flash;
  askConfirm?: (msg: string) => Promise<boolean>;
  showOwner?: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [maxPercent, setMaxPercent] = useState(30);
  const [partnerCap, setPartnerCap] = useState(30);
  const [maxPercentDraft, setMaxPercentDraft] = useState("30");
  const [items, setItems] = useState<DiscountItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("10");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [shareable, setShareable] = useState(false);
  const [expiryMenuOpen, setExpiryMenuOpen] = useState(false);
  const expiryMenuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ enabled: boolean; maxPercent: number; items: DiscountItem[] }>("/me/discounts");
      setEnabled(r.enabled);
      setMaxPercent(r.maxPercent);
      setItems(r.items ?? []);
      if (showOwner) {
        const s = await api<{ settings: Record<string, string> }>("/admin/settings");
        const cap = String(s.settings.discount_max_percent || "30");
        setMaxPercentDraft(cap);
      } else {
        setMaxPercentDraft(String(r.maxPercent));
      }
    } catch (e) {
      flash(null, String(e instanceof Error ? e.message : e));
    }
  }, [flash, showOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!expiryMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!expiryMenuRef.current?.contains(e.target as Node)) setExpiryMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpiryMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [expiryMenuOpen]);

  async function create() {
    setBusy(true);
    try {
      await api("/me/discounts", {
        method: "POST",
        body: {
          code,
          percentOff: Number(percent),
          maxUses: maxUses.trim() ? Number(maxUses) : null,
          expiresAt: expiresAt.trim() || null,
          note: note.trim() || null,
          shareable,
        },
      });
      setCode("");
      setPercent("10");
      setMaxUses("");
      setExpiresAt("");
      setNote("");
      setShareable(false);
      setExpiryMenuOpen(false);
      flash("کد تخفیف ساخته شد");
      await load();
    } catch (e) {
      flash(null, String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: DiscountItem) {
    setBusy(true);
    try {
      await api(`/me/discounts/${item.id}`, {
        method: "PATCH",
        body: { active: !item.active },
      });
      flash(item.active ? "کد غیرفعال شد" : "کد فعال شد");
      await load();
    } catch (e) {
      flash(null, String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: DiscountItem) {
    if (askConfirm && !(await askConfirm(`کد «${item.code}» حذف شود؟`))) return;
    setBusy(true);
    try {
      await api(`/me/discounts/${item.id}`, { method: "DELETE" });
      flash("حذف شد");
      await load();
    } catch (e) {
      flash(null, String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  function pickExpiry(opts: { days?: number; weeks?: number; months?: number }) {
    setExpiresAt(expiryFromNow(opts));
    setExpiryMenuOpen(false);
  }

  async function saveAdminDiscountSettings(patch: { enabled?: boolean; maxPercent?: number }) {
    if (!showOwner) return;
    setSettingsBusy(true);
    try {
      const body: Record<string, string> = {};
      if (patch.enabled !== undefined) body.discount_codes_enabled = patch.enabled ? "true" : "false";
      if (patch.maxPercent !== undefined) {
        body.discount_max_percent = String(Math.max(1, Math.min(100, Math.floor(patch.maxPercent))));
      }
      await api("/admin/settings", { method: "PUT", body });
      flash("تنظیمات تخفیف ذخیره شد");
      await load();
    } catch (e) {
      flash(null, String(e instanceof Error ? e.message : e));
    } finally {
      setSettingsBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>کدهای تخفیف</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        کد ادمین برای همه خریداران معتبر است. کد همکار/همکار ویژه به‌صورت پیش‌فرض فقط برای خودش است؛ با «قابل‌اشتراک»
        مشتری‌ها هم می‌توانند استفاده کنند. سقف درصد شما: {maxPercent}٪.
        {!enabled ? " — فعلاً توسط ادمین خاموش است (ادمین همچنان می‌تواند کد بسازد)." : ""}
      </p>

      {showOwner && (
        <div className="panel" style={{ marginBottom: 14, padding: 12 }}>
          <div className="setting-row" style={{ marginBottom: 10 }}>
            <div>
              <div className="t">فعال‌سازی کد تخفیف در خرید</div>
              <div className="d">ربات و وب‌پنل — مشتریان بتوانند کد وارد کنند.</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={enabled}
                disabled={settingsBusy}
                onChange={(e) => void saveAdminDiscountSettings({ enabled: e.target.checked })}
              />
              <span className="track" />
            </label>
          </div>
          <div className="setting-row">
            <div>
              <div className="t">سقف درصد تخفیف همکار / همکار ویژه</div>
              <div className="d">ادمین تا ۱۰۰٪؛ نماینده‌ها حداکثر این عدد.</div>
            </div>
            <input
              className="num"
              inputMode="numeric"
              disabled={settingsBusy}
              value={maxPercentDraft}
              onChange={(e) => setMaxPercentDraft(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => {
                const n = Math.max(1, Math.min(100, Number(maxPercentDraft || "30") || 30));
                setMaxPercentDraft(String(n));
                void saveAdminDiscountSettings({ maxPercent: n });
              }}
              style={{
                width: 72,
                border: "1px solid var(--line)",
                background: "rgba(10,13,35,.6)",
                color: "var(--text)",
                borderRadius: 10,
                padding: "8px 12px",
              }}
            />
          </div>
        </div>
      )}

      <div className="grid discount-codes-form" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>کد</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="مثلاً SALE20"
            disabled={busy}
          />
        </div>
        <div className="field">
          <label>درصد تخفیف (۱–{maxPercent})</label>
          <input
            className="num"
            inputMode="numeric"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label>حداکثر استفاده (خالی = نامحدود)</label>
          <input
            className="num"
            inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field expiry-field">
          <label>انقضا (اختیاری)</label>
          <div className="expiry-quick-row expiry-quick-row--inline">
            <input
              type="datetime-local"
              dir="ltr"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={busy}
            />
            <div className="expiry-preset-menu" ref={expiryMenuRef}>
              <button
                type="button"
                className="btn ghost sm expiry-preset-trigger"
                disabled={busy}
                aria-expanded={expiryMenuOpen}
                aria-haspopup="menu"
                aria-label="انتخاب مدت انقضا"
                onClick={() => setExpiryMenuOpen((o) => !o)}
              >
                مدت ▾
              </button>
              {expiryMenuOpen && (
                <div className="expiry-preset-dropdown" role="menu">
                  {EXPIRY_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      role="menuitem"
                      className="expiry-preset-item"
                      onClick={() => pickExpiry(p.opts)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>یادداشت</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </div>
        <div className="setting-row" style={{ gridColumn: "1 / -1", margin: 0 }}>
          <div>
            <div className="t">قابل‌اشتراک با مشتری</div>
            <div className="d">اگر روشن باشد، دیگران هم می‌توانند این کد را در خریدشان بزنند.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={shareable}
              disabled={busy}
              onChange={(e) => setShareable(e.target.checked)}
            />
            <span className="track" />
          </label>
        </div>
      </div>
      <div className="actions" style={{ marginBottom: 16 }}>
        <button type="button" className="btn primary" disabled={busy || !code.trim()} onClick={() => void create()}>
          ساخت کد
        </button>
      </div>

      {!items.length ? (
        <p className="muted">هنوز کدی نساخته‌اید.</p>
      ) : (
        <div className="list">
          {items.map((item) => (
            <div key={item.id} className="row-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <strong className="num">{item.code}</strong>{" "}
                  <span className={`badge ${item.active ? "ok" : "bad"}`}>{item.active ? "فعال" : "خاموش"}</span>
                  <div className="muted">
                    {item.percentOff}٪ · استفاده {item.usedCount.toLocaleString("fa-IR")}
                    {item.maxUses != null ? ` / ${item.maxUses.toLocaleString("fa-IR")}` : " / ∞"}
                    {item.expiresAt ? ` · تا ${new Date(item.expiresAt).toLocaleString("fa-IR")}` : ""}
                    {item.shareable ? " · قابل‌اشتراک" : ""}
                    {showOwner && item.ownerLabel ? ` · ${item.ownerLabel}` : ""}
                  </div>
                  {item.note && <div className="muted">{item.note}</div>}
                </div>
                <div className="disc-item-actions">
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void toggle(item)}>
                    {item.active ? "غیرفعال" : "فعال"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        try {
                          await api(`/me/discounts/${item.id}`, {
                            method: "PATCH",
                            body: { shareable: !item.shareable },
                          });
                          flash(!item.shareable ? "کد قابل‌اشتراک شد" : "اشتراک کد برداشته شد");
                          await load();
                        } catch (e) {
                          flash(null, String(e instanceof Error ? e.message : e));
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    {item.shareable ? "فقط خودم" : "اشتراک"}
                  </button>
                  <button type="button" className="btn danger sm" disabled={busy} onClick={() => void remove(item)}>
                    حذف
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
