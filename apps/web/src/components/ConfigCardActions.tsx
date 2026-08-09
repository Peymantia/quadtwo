"use client";

import { useState } from "react";
import { Modal } from "./Modal";

export type ConfigActionItem = {
  email: string;
  subId: string | null;
  subUrl?: string | null;
  status?: string | null;
  title?: string | null;
  note?: string | null;
  expiresAt?: string | null;
};

/**
 * Admin-style subscription action rows used across admin / partner / user panels.
 */
export function ConfigCardActions({
  item,
  busy,
  onBusy,
  onMsg,
  onErr,
  onReload,
  onRenew,
  onCopy,
  onRotate,
  onRefresh,
  onToggleEnable,
  onDelete,
  onSaveEdit,
}: {
  item: ConfigActionItem;
  busy: boolean;
  onBusy?: (v: boolean) => void;
  onMsg: (msg: string) => void;
  onErr: (msg: string) => void;
  onReload: () => void | Promise<void>;
  onRenew?: () => void | Promise<void>;
  onCopy: () => void | Promise<void>;
  onRotate: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onToggleEnable: (nextEnable: boolean) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onSaveEdit: (patch: { title: string | null; note: string | null }) => void | Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState(item.title ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const expired = item.expiresAt ? new Date(item.expiresAt) < new Date() : false;
  const active = item.status === "active" && !expired;

  return (
    <>
      <div className="config-card-actions">
        <div className="config-card-actions-row">
          <button
            type="button"
            className="btn success sm"
            disabled={busy || !item.subId}
            onClick={() => void onRenew?.()}
          >
            تمدید
          </button>
          <button
            type="button"
            className={`btn sm ${active ? "ghost" : "success"}`}
            disabled={busy || expired || !item.subId}
            onClick={() => void onToggleEnable(!active)}
          >
            {active ? "غیرفعال" : "فعال"}
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || !item.subId}
            onClick={() => {
              setTitle(item.title ?? "");
              setNote(item.note ?? "");
              setEditOpen(true);
            }}
          >
            ویرایش
          </button>
          <button type="button" className="btn danger sm" disabled={busy} onClick={() => void onDelete()}>
            حذف
          </button>
        </div>
        <div className="config-card-actions-row sub-links">
          <button type="button" className="btn primary sm" disabled={busy || !item.subUrl} onClick={() => void onCopy()}>
            کپی لینک
          </button>
          <button type="button" className="btn ghost sm" disabled={busy || !item.subId} onClick={() => void onRefresh()}>
            بروزرسانی
          </button>
          <button type="button" className="btn ghost sm" disabled={busy || !item.subId} onClick={() => void onRotate()}>
            لینک جدید
          </button>
        </div>
      </div>

      <Modal open={editOpen} title="ویرایش اکانت" onClose={() => setEditOpen(false)}>
        <div className="field">
          <label>عنوان</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان نمایشی" />
        </div>
        <div className="field">
          <label>یادداشت</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت…" />
        </div>
        <div className="config-card-actions-row">
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() => {
              onBusy?.(true);
              void (async () => {
                try {
                  await onSaveEdit({
                    title: title.trim() || null,
                    note: note.trim() || null,
                  });
                  setEditOpen(false);
                  onMsg("ذخیره شد");
                  await onReload();
                } catch (e) {
                  onErr(String(e instanceof Error ? e.message : e));
                } finally {
                  onBusy?.(false);
                }
              })();
            }}
          >
            ذخیره
          </button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setEditOpen(false)}>
            انصراف
          </button>
        </div>
      </Modal>
    </>
  );
}
