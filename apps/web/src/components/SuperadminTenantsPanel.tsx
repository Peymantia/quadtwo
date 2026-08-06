"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "../lib/api";

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

export function SuperadminTenantsPanel({ flash }: { flash: Flash }) {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ownerTelegramId: "", botToken: "", brandName: "" });
  const [form, setForm] = useState({
    name: "",
    slug: "",
    botToken: "",
    brandName: "",
    ownerTelegramId: "",
    supportUsername: "",
  });

  const load = useCallback(async () => {
    const r = await api<{ tenants: TenantRow[] }>("/super/tenants");
    setTenants(r.tenants);
  }, []);

  useEffect(() => {
    void load().catch((e) => flash(null, errText(e)));
  }, [load, flash]);

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
      const r = await api<{ tenant: { dashUrl: string; botUsername?: string | null } }>("/super/tenants", {
        body: {
          name: form.name.trim(),
          slug: form.slug.trim().toLowerCase(),
          botToken: form.botToken.trim(),
          brandName: form.brandName.trim() || undefined,
          ownerTelegramId: form.ownerTelegramId.trim(),
          supportUsername: form.supportUsername.trim() || undefined,
        },
      });
      flash(`مستأجر ساخته شد — ${r.tenant.botUsername ? `@${r.tenant.botUsername}` : r.tenant.dashUrl}`);
      setForm({ name: "", slug: "", botToken: "", brandName: "", ownerTelegramId: "", supportUsername: "" });
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

  async function uploadLogo(id: string, file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
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
      if (!res.ok) throw new Error(data.error || "آپلود ناموفق");
      flash("لوگو ذخیره شد");
      await load();
    } catch (e) {
      flash(null, errText(e));
    } finally {
      setBusy(false);
    }
  }

  const editing = editId ? tenants.find((t) => t.id === editId) : null;

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>مستأجرها (SaaS)</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        توکن ربات خریدار را بگیرید، مستأجر بسازید، سپس لینک داشبورد را به او بدهید. فعال‌سازی دستی است.
      </p>

      <div className="field">
        <label>نام مستأجر</label>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="مثلاً Acme VPN" />
      </div>
      <div className="field">
        <label>اسلاگ ساب‌دامین</label>
        <input
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
          placeholder="acme"
        />
      </div>
      <div className="field">
        <label>توکن ربات تلگرام</label>
        <input
          value={form.botToken}
          onChange={(e) => setForm((f) => ({ ...f, botToken: e.target.value }))}
          placeholder="123456:ABC..."
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label>برند (اختیاری)</label>
        <input value={form.brandName} onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))} />
      </div>
      <div className="field">
        <label>تلگرام ادمین خریدار (الزامی)</label>
        <input
          value={form.ownerTelegramId}
          onChange={(e) => setForm((f) => ({ ...f, ownerTelegramId: e.target.value.replace(/\D/g, "") }))}
          placeholder="آی‌دی عددی"
        />
      </div>
      <div className="field">
        <label>یوزرنیم پشتیبانی (اختیاری)</label>
        <input value={form.supportUsername} onChange={(e) => setForm((f) => ({ ...f, supportUsername: e.target.value }))} />
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void createTenant()}>
          ساخت مستأجر + استارت ربات
        </button>
      </div>

      {editing && (
        <div className="panel" style={{ marginTop: 20, border: "1px solid var(--line)" }}>
          <h3 style={{ marginTop: 0 }}>ویرایش — {editing.brandName || editing.name}</h3>
          <div className="field">
            <label>برند</label>
            <input value={editForm.brandName} onChange={(e) => setEditForm((f) => ({ ...f, brandName: e.target.value }))} />
          </div>
          <div className="field">
            <label>آی‌دی ادمین خریدار</label>
            <input
              value={editForm.ownerTelegramId}
              onChange={(e) => setEditForm((f) => ({ ...f, ownerTelegramId: e.target.value.replace(/\D/g, "") }))}
              placeholder="آی‌دی عددی"
            />
          </div>
          <div className="field">
            <label>توکن ربات جدید (خالی = بدون تغییر)</label>
            <input
              value={editForm.botToken}
              onChange={(e) => setEditForm((f) => ({ ...f, botToken: e.target.value }))}
              placeholder="چرخش توکن"
              autoComplete="off"
            />
          </div>
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void saveEdit()}>
              ذخیره
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setEditId(null)}>
              انصراف
            </button>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 28 }}>لیست</h3>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>برند</th>
              <th>اسلاگ</th>
              <th>ربات</th>
              <th>ادمین</th>
              <th>وضعیت</th>
              <th>داشبورد</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {t.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.logoUrl} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: "cover" }} />
                    ) : null}
                    <span>{t.brandName || t.name}</span>
                    {t.isPlatform ? <span className="muted"> (پلتفرم)</span> : null}
                  </div>
                </td>
                <td>
                  <code>{t.slug}</code>
                </td>
                <td>{t.botUsername ? `@${t.botUsername}` : "—"}</td>
                <td>{t.ownerTelegramId || "—"}</td>
                <td>{t.status === "active" ? "فعال" : "تعلیق"}</td>
                <td>
                  <a href={t.dashUrl} target="_blank" rel="noreferrer">
                    باز کردن
                  </a>
                </td>
                <td>
                  <div className="actions" style={{ flexWrap: "wrap", gap: 6 }}>
                    <button type="button" className="btn" disabled={busy} onClick={() => openEdit(t)}>
                      ویرایش
                    </button>
                    <label className="btn" style={{ cursor: "pointer", margin: 0 }}>
                      لوگو
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => void uploadLogo(t.id, e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {!t.isPlatform && t.status === "active" && (
                      <button type="button" className="btn danger" disabled={busy} onClick={() => void setStatus(t.id, "suspend")}>
                        تعلیق
                      </button>
                    )}
                    {!t.isPlatform && t.status !== "active" && (
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void setStatus(t.id, "activate")}>
                        فعال‌سازی
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
