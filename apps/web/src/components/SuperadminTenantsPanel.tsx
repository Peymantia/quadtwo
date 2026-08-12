"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken } from "../lib/api";
import { Modal } from "./Modal";
import { Icon } from "./DashShell";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  brandName: string;
  logoUrl: string | null;
  botUsername: string | null;
  status: string;
  isPlatform: boolean;
  ownerTelegramId: string | null;
  dashUrl: string;
  createdAt: string;
};

type Flash = (ok: string | null, bad?: string | null) => void;

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const emptyForm = {
  name: "",
  slug: "",
  botToken: "",
  brandName: "",
  ownerTelegramId: "",
  supportUsername: "",
};

async function postTenantLogo(id: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (typeof window !== "undefined") {
    const slug = new URLSearchParams(window.location.search).get("tenant");
    if (slug) headers["X-Tenant-Slug"] = slug;
  }
  const res = await fetch(`/api/super/tenants/${id}/logo`, { method: "POST", headers, body: fd });
  const data = (await res.json()) as { error?: string; logoUrl?: string };
  if (!res.ok) throw new Error(data.error || "آپلود لوگو ناموفق");
  return data.logoUrl ?? null;
}

export function SuperadminTenantsPanel({ flash }: { flash: Flash }) {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [createLogoFile, setCreateLogoFile] = useState<File | null>(null);
  const [createLogoPreview, setCreateLogoPreview] = useState<string | null>(null);
  const [createLogoModalOpen, setCreateLogoModalOpen] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ownerTelegramId: "", botToken: "", brandName: "" });

  const [logoTenantId, setLogoTenantId] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const createFileRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api<{ tenants: TenantRow[] }>("/super/tenants");
    setTenants(r.tenants);
  }, []);

  useEffect(() => {
    void load().catch((e) => flash(null, errText(e)));
  }, [load, flash]);

  useEffect(() => {
    return () => {
      if (createLogoPreview?.startsWith("blob:")) URL.revokeObjectURL(createLogoPreview);
      if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    };
  }, [createLogoPreview, logoPreview]);

  function pickCreateLogo(file: File | null) {
    if (createLogoPreview?.startsWith("blob:")) URL.revokeObjectURL(createLogoPreview);
    if (!file) {
      setCreateLogoFile(null);
      setCreateLogoPreview(null);
      return;
    }
    setCreateLogoFile(file);
    setCreateLogoPreview(URL.createObjectURL(file));
    setCreateLogoModalOpen(true);
  }

  function clearCreateLogo() {
    if (createLogoPreview?.startsWith("blob:")) URL.revokeObjectURL(createLogoPreview);
    setCreateLogoFile(null);
    setCreateLogoPreview(null);
    setCreateLogoModalOpen(false);
    if (createFileRef.current) createFileRef.current.value = "";
  }

  async function createTenant() {
    if (!form.name.trim() || !form.slug.trim() || !form.botToken.trim()) {
      flash(null, "نام، اسلاگ و توکن ربات لازم است");
      return;
    }
    if (!form.ownerTelegramId.trim()) {
      flash(null, "آی‌دی تلگرام ادمین خریدار لازم است تا بتواند وارد داشبورد شود");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ tenant: { id: string; dashUrl: string; botUsername?: string | null } }>("/super/tenants", {
        body: {
          name: form.name.trim(),
          slug: form.slug.trim().toLowerCase(),
          botToken: form.botToken.trim(),
          brandName: form.brandName.trim() || undefined,
          ownerTelegramId: form.ownerTelegramId.trim(),
          supportUsername: form.supportUsername.trim() || undefined,
        },
      });
      if (createLogoFile && r.tenant.id) {
        try {
          await postTenantLogo(r.tenant.id, createLogoFile);
        } catch (logoErr) {
          flash(`مستأجر ساخته شد ولی لوگو آپلود نشد: ${errText(logoErr)}`);
          clearCreateLogo();
          setForm(emptyForm);
          await load();
          return;
        }
      }
      flash(`مستأجر ساخته شد — ${r.tenant.botUsername ? `@${r.tenant.botUsername}` : r.tenant.dashUrl}`);
      clearCreateLogo();
      setForm(emptyForm);
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(t: TenantRow) {
    setEditId(t.id);
    setEditForm({
      ownerTelegramId: t.ownerTelegramId || "",
      botToken: "",
      brandName: t.brandName || "",
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    try {
      const body: Record<string, string | null> = {};
      if (editForm.brandName.trim()) body.brandName = editForm.brandName.trim();
      body.ownerTelegramId = editForm.ownerTelegramId.trim() || null;
      if (editForm.botToken.trim()) body.botToken = editForm.botToken.trim();
      await api(`/super/tenants/${editId}`, { method: "PATCH", body });
      flash("مستأجر به‌روز شد");
      setEditId(null);
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, action: "suspend" | "activate") {
    setBusy(true);
    try {
      await api(`/super/tenants/${id}/${action}`, { body: {} });
      flash(action === "suspend" ? "تعلیق شد" : "فعال شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  function openLogoModal(t: TenantRow) {
    if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    setLogoTenantId(t.id);
    setLogoFile(null);
    setLogoPreview(t.logoUrl);
    if (editFileRef.current) editFileRef.current.value = "";
  }

  function pickLogoFile(file: File | null) {
    if (!file) return;
    if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function saveLogo() {
    if (!logoTenantId || !logoFile) {
      flash(null, "ابتدا فایل لوگو را انتخاب کنید");
      return;
    }
    setBusy(true);
    try {
      await postTenantLogo(logoTenantId, logoFile);
      flash("لوگو ذخیره شد");
      setLogoTenantId(null);
      setLogoFile(null);
      if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  const editing = editId ? tenants.find((t) => t.id === editId) : null;
  const logoTenant = logoTenantId ? tenants.find((t) => t.id === logoTenantId) : null;

  return (
    <div className="panel tenants-panel">
      <h2 style={{ marginTop: 0 }}>مستأجرها (SaaS)</h2>
      <p className="muted tenants-panel__lead">
        توکن ربات خریدار را بگیرید، مستأجر بسازید، سپس لینک داشبورد را به او بدهید.
      </p>

      <div className="tenants-create">
        <div className="tenants-create__grid">
          <div className="field">
            <label>نام مستأجر</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثلاً Acme VPN"
            />
          </div>
          <div className="field">
            <label>اسلاگ ساب‌دامین</label>
            <input
              dir="ltr"
              className="num"
              value={form.slug}
              onChange={(e) =>
                setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))
              }
              placeholder="acme"
            />
          </div>
          <div className="field tenants-create__span2">
            <label>توکن ربات تلگرام</label>
            <input
              dir="ltr"
              value={form.botToken}
              onChange={(e) => setForm((f) => ({ ...f, botToken: e.target.value }))}
              placeholder="123456:ABC…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label>برند (اختیاری)</label>
            <input
              value={form.brandName}
              onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))}
              placeholder="نام نمایشی"
            />
          </div>
          <div className="field">
            <label>آی‌دی ادمین خریدار</label>
            <input
              dir="ltr"
              className="num"
              value={form.ownerTelegramId}
              onChange={(e) => setForm((f) => ({ ...f, ownerTelegramId: e.target.value.replace(/\D/g, "") }))}
              placeholder="آی‌دی عددی"
            />
          </div>
          <div className="field tenants-create__span2">
            <label>پشتیبانی (اختیاری)</label>
            <input
              dir="ltr"
              value={form.supportUsername}
              onChange={(e) => setForm((f) => ({ ...f, supportUsername: e.target.value }))}
              placeholder="@support"
            />
          </div>
        </div>

        {(createLogoPreview || createLogoFile) && (
          <div className="tenants-create__logo-status">
            <div className="tenants-logo-thumb" aria-hidden>
              {createLogoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={createLogoPreview} alt="" />
              ) : (
                <span>لوگو</span>
              )}
            </div>
            <div className="tenants-logo-pick__actions">
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => setCreateLogoModalOpen(true)}
              >
                پیش‌نمایش
              </button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={clearCreateLogo}>
                حذف لوگو
              </button>
            </div>
          </div>
        )}

        <input
          ref={createFileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pickCreateLogo(e.target.files?.[0] ?? null)}
        />

        <div className="tenants-create__footer">
          <button
            type="button"
            className="btn ghost tenants-create__btn"
            disabled={busy}
            onClick={() => createFileRef.current?.click()}
          >
            <Icon name="file" size={15} />
            {createLogoPreview ? "تغییر لوگو" : "انتخاب لوگو"}
          </button>
          <button
            type="button"
            className="btn primary tenants-create__btn"
            disabled={busy}
            onClick={() => void createTenant()}
          >
            <Icon name="plus" size={15} />
            {busy ? "…" : "ساخت مستأجر + استارت ربات"}
          </button>
        </div>
      </div>

      <div className="tenants-list-head">
        <h3>لیست</h3>
        <span className="muted num">{tenants.length.toLocaleString("fa-IR")} مورد</span>
      </div>

      <div className="tenants-cards">
        {tenants.map((t) => (
          <article key={t.id} className={`tenants-card${t.isPlatform ? " is-platform" : ""}`}>
            <div className="tenants-card__top">
              <div className="tenants-card__brand">
                <div className="tenants-card__avatar">
                  {t.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.logoUrl} alt="" />
                  ) : (
                    <span>{(t.brandName || t.name || "?").slice(0, 1)}</span>
                  )}
                </div>
                <div className="tenants-card__meta">
                  <strong>
                    {t.brandName || t.name}
                    {t.isPlatform ? <span className="tenants-pill">پلتفرم</span> : null}
                  </strong>
                  <span className="muted" dir="ltr">
                    {t.slug}
                    {t.botUsername ? ` · @${t.botUsername}` : ""}
                  </span>
                </div>
              </div>
              <span className={`tenants-status${t.status === "active" ? " is-on" : " is-off"}`}>
                {t.status === "active" ? "فعال" : "تعلیق"}
              </span>
            </div>
            <div className="tenants-card__facts">
              <div>
                <span className="muted">ادمین</span>
                <span dir="ltr">{t.ownerTelegramId || "—"}</span>
              </div>
              <div>
                <span className="muted">داشبورد</span>
                <a href={t.dashUrl} target="_blank" rel="noreferrer">
                  باز کردن
                </a>
              </div>
            </div>
            <div className="tenants-card__actions">
              <button type="button" className="btn ghost sm tenants-card__action" disabled={busy} onClick={() => openEdit(t)}>
                <Icon name="edit" size={14} />
                ویرایش
              </button>
              <button type="button" className="btn ghost sm tenants-card__action" disabled={busy} onClick={() => openLogoModal(t)}>
                <Icon name="layers" size={14} />
                لوگو
              </button>
              {!t.isPlatform && t.status === "active" && (
                <button
                  type="button"
                  className="btn danger sm tenants-card__action"
                  disabled={busy}
                  onClick={() => void setStatus(t.id, "suspend")}
                >
                  <Icon name="close" size={14} />
                  تعلیق
                </button>
              )}
              {!t.isPlatform && t.status !== "active" && (
                <button
                  type="button"
                  className="btn primary sm tenants-card__action"
                  disabled={busy}
                  onClick={() => void setStatus(t.id, "activate")}
                >
                  <Icon name="check" size={14} />
                  فعال‌سازی
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <Modal
        open={createLogoModalOpen && Boolean(createLogoPreview)}
        title="پیش‌نمایش لوگو"
        onClose={() => setCreateLogoModalOpen(false)}
      >
        <div className="tenants-logo-modal">
          <div className="tenants-logo-modal__preview">
            {createLogoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={createLogoPreview} alt="پیش‌نمایش لوگو" />
            ) : null}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            بعد از ساخت مستأجر، این لوگو به‌صورت خودکار آپلود می‌شود.
          </p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => setCreateLogoModalOpen(false)}>
              <Icon name="check" size={15} />
              تأیید
            </button>
            <button type="button" className="btn ghost" onClick={clearCreateLogo}>
              <Icon name="trash" size={15} />
              حذف لوگو
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(editing)} title={editing ? `ویرایش — ${editing.brandName || editing.name}` : "ویرایش"} onClose={() => setEditId(null)}>
        {editing && (
          <div className="tenants-edit-modal">
            <div className="field">
              <label>برند</label>
              <input
                value={editForm.brandName}
                onChange={(e) => setEditForm((f) => ({ ...f, brandName: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>آی‌دی ادمین خریدار</label>
              <input
                dir="ltr"
                className="num"
                value={editForm.ownerTelegramId}
                onChange={(e) => setEditForm((f) => ({ ...f, ownerTelegramId: e.target.value.replace(/\D/g, "") }))}
                placeholder="آی‌دی عددی"
              />
            </div>
            <div className="field">
              <label>توکن ربات جدید (خالی = بدون تغییر)</label>
              <input
                dir="ltr"
                value={editForm.botToken}
                onChange={(e) => setEditForm((f) => ({ ...f, botToken: e.target.value }))}
                placeholder="چرخش توکن"
                autoComplete="off"
              />
            </div>
            <div className="actions">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void saveEdit()}>
                <Icon name="check" size={15} />
                ذخیره
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditId(null)}>
                <Icon name="close" size={15} />
                انصراف
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(logoTenant)}
        title={logoTenant ? `لوگو — ${logoTenant.brandName || logoTenant.name}` : "لوگو"}
        onClose={() => {
          setLogoTenantId(null);
          setLogoFile(null);
          if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
          setLogoPreview(null);
        }}
      >
        {logoTenant && (
          <div className="tenants-logo-modal">
            <div className="tenants-logo-modal__preview">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="لوگو" />
              ) : (
                <span className="muted">هنوز لوگویی نیست</span>
              )}
            </div>
            <div className="actions" style={{ marginBottom: 12 }}>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => editFileRef.current?.click()}>
                <Icon name="file" size={15} />
                انتخاب فایل
              </button>
              <input
                ref={editFileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => pickLogoFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="actions">
              <button type="button" className="btn primary" disabled={busy || !logoFile} onClick={() => void saveLogo()}>
                <Icon name="check" size={15} />
                ذخیره لوگو
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setLogoTenantId(null);
                  setLogoFile(null);
                }}
              >
                <Icon name="close" size={15} />
                بستن
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
