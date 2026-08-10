"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { SubQrModal } from "./SubQrModal";
import { api, formatToman } from "../lib/api";
import { ACCOUNT_NAME_HINT, filterAccountNameInput, isValidAccountName } from "../lib/account-name";
import type { CryptoPayInfo } from "./CryptoPayModal";

type AddonsInfo = {
  subscription: { id: string; email: string; trafficGb: number | null; isTest: boolean };
  addDays: { allowed: boolean; maxDays: number; perDay: number; reason?: string };
  addGb: { allowed: boolean; maxGb: number; perGb: number; reason?: string };
};

type PayResult = {
  order?: { id: string; price: number };
  card?: { number: string; holder: string };
  crypto?: CryptoPayInfo;
  provisioned?: unknown;
};

/**
 * Same 2-col action layout as the Telegram bot service keyboard.
 *
 * Admin: refresh + rotate-sub; others: rotate-sub + rename (no config-link rotate).
 */
export function SubAddonsBar({
  subId,
  email,
  subUrl,
  isTest,
  trafficGb,
  note,
  busy,
  walletBalance,
  showBack,
  showRenew,
  isAdmin,
  onBusy,
  onDone,
  onPayCard,
  onPayCrypto,
  onError,
  onMsg,
  onBack,
  onRenew,
}: {
  subId: string;
  email: string;
  subUrl?: string | null;
  isTest?: boolean;
  trafficGb?: number | null;
  note?: string | null;
  busy: boolean;
  walletBalance: number;
  showBack?: boolean;
  showRenew?: boolean;
  isAdmin?: boolean;
  onBusy: (v: boolean) => void;
  onDone: () => void;
  onPayCard: (orderId: string, price: number, card: { number: string; holder: string }) => void;
  onPayCrypto: (orderId: string, price: number, crypto: CryptoPayInfo) => void;
  onError: (msg: string) => void;
  onMsg: (msg: string) => void;
  onBack?: () => void;
  onRenew?: () => void;
}) {
  const [info, setInfo] = useState<AddonsInfo | null>(null);
  const [mode, setMode] = useState<"days" | "gb" | "rename" | "b64" | "note" | "rotsub" | null>(null);
  const [days, setDays] = useState(1);
  const [gb, setGb] = useState(1);
  const [rename, setRename] = useState(email);
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [b64, setB64] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    setRename(email);
  }, [email]);

  useEffect(() => {
    setNoteDraft(note ?? "");
  }, [note]);

  useEffect(() => {
    if (mode !== "days" && mode !== "gb") return;
    void api<AddonsInfo>(`/me/subscriptions/${subId}/addons`)
      .then(setInfo)
      .catch((e) => onError(String(e instanceof Error ? e.message : e)));
  }, [mode, subId, onError]);

  async function checkout(
    path: string,
    body: Record<string, unknown>,
    paymentMethod: "wallet" | "card_to_card" | "crypto",
  ) {
    onBusy(true);
    onError("");
    try {
      const r = await api<PayResult>(path, {
        method: "POST",
        body: { ...body, paymentMethod, payWithWallet: paymentMethod === "wallet" },
      });
      setMode(null);
      if (r.provisioned) {
        onMsg("با موفقیت اعمال شد ✅");
        onDone();
      } else if (r.order && r.crypto?.address) {
        onPayCrypto(r.order.id, r.order.price, r.crypto);
      } else if (r.order && r.card) {
        onPayCard(r.order.id, r.order.price, r.card);
      } else if (r.order) {
        onMsg(`سفارش ${formatToman(r.order.price)} ثبت شد`);
        onDone();
      }
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      onBusy(false);
    }
  }

  async function copyText(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      onMsg(okMsg);
    } catch {
      onError("کپی ناموفق بود");
    }
  }

  async function rotateSub() {
    onBusy(true);
    onError("");
    try {
      await api(`/me/subscriptions/${subId}/rotate-sub`, { method: "POST" });
      onMsg("لینک ساب عوض شد");
      setMode(null);
      onDone();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      onBusy(false);
    }
  }

  async function refreshFromPanel() {
    onBusy(true);
    onError("");
    try {
      const r = await api<{ changed: string[]; email: string }>(
        `/me/subscriptions/${subId}/refresh-from-panel`,
        { method: "POST" },
      );
      onMsg(
        r.changed.length
          ? `بروزرسانی شد: ${r.changed.join("، ")}`
          : "اطلاعات با پنل یکسان بود",
      );
      onDone();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      onBusy(false);
    }
  }

  const canDays = !isTest;
  const canGb = !isTest && trafficGb != null && trafficGb > 0;
  const daysPrice = (info?.addDays.perDay ?? 2000) * days;
  const gbPrice = (info?.addGb.perGb ?? 0) * gb;

  const backOrRenew = showBack ? (
    <button type="button" className="btn sm" disabled={busy} onClick={() => onBack?.()}>
      بازگشت
    </button>
  ) : showRenew && onRenew ? (
    <button type="button" className="btn sm" disabled={busy || !!isTest} onClick={() => onRenew()}>
      تمدید
    </button>
  ) : null;

  return (
    <>
      <div className="svc-actions-grid">
        <div className="qa-row qa-row--1">
          <button
            type="button"
            className="btn sm"
            disabled={busy || !subUrl}
            onClick={() => {
              if (subUrl) void copyText(subUrl, "لینک اشتراک کپی شد");
            }}
          >
            لینک اشتراک
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => {
              setB64(null);
              setMode("b64");
              onBusy(true);
              void api<{ base64: string }>(`/me/subscriptions/${subId}/secure-base64`)
                .then((r) => setB64(r.base64))
                .catch((e) => onError(String(e instanceof Error ? e.message : e)))
                .finally(() => onBusy(false));
            }}
          >
            لینک Base64 کانفیگ
          </button>
        </div>

        <div className="qa-row qa-row--2">
          <button type="button" className="btn sm" disabled={busy || !canDays} onClick={() => setMode("days")}>
            افزایش روز
          </button>
          <button type="button" className="btn sm" disabled={busy || !canGb} onClick={() => setMode("gb")}>
            افزایش حجم
          </button>
        </div>

        <div className="qa-row qa-row--3">
          {isAdmin ? (
            <button type="button" className="btn sm" disabled={busy} onClick={() => void refreshFromPanel()}>
              بروزرسانی
            </button>
          ) : (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => {
                setRename(email);
                setMode("rename");
              }}
            >
              تغییر نام دلخواه
            </button>
          )}
          <button type="button" className="btn sm" disabled={busy} onClick={() => setMode("rotsub")}>
            تغییر لینک ساب
          </button>
        </div>

        <div className="qa-row qa-row--4">
          {isAdmin && (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => {
                setRename(email);
                setMode("rename");
              }}
            >
              تغییر نام دلخواه
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            disabled={busy || !subUrl}
            onClick={() => setQrOpen(true)}
          >
            نمایش QR Code
          </button>
          {!isAdmin && (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => {
                setNoteDraft(note ?? "");
                setMode("note");
              }}
            >
              یادداشت
            </button>
          )}
        </div>

        {(isAdmin || backOrRenew) && (
          <div className="qa-row qa-row--5">
            {isAdmin && (
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => {
                  setNoteDraft(note ?? "");
                  setMode("note");
                }}
              >
                یادداشت
              </button>
            )}
            {backOrRenew}
          </div>
        )}
      </div>

      <Modal open={mode === "days"} title="افزایش روز" onClose={() => setMode(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          حداکثر ۱۰ روز · هر روز {formatToman(info?.addDays.perDay ?? 2000)}
        </p>
        <div className="rate-stepper" style={{ marginBottom: 12 }}>
          <button type="button" className="rate-step-btn" disabled={busy || days <= 1} onClick={() => setDays((d) => d - 1)}>
            −
          </button>
          <strong className="rate-step-value num">{days} روز</strong>
          <button
            type="button"
            className="rate-step-btn"
            disabled={busy || days >= (info?.addDays.maxDays ?? 10)}
            onClick={() => setDays((d) => d + 1)}
          >
            +
          </button>
        </div>
        <p>
          مبلغ: <strong className="num">{formatToman(daysPrice)}</strong>
        </p>
        <div className="qa-row qa-row--1">
          <button
            type="button"
            className="btn sm"
            disabled={busy || walletBalance < daysPrice}
            onClick={() => void checkout(`/me/subscriptions/${subId}/add-days`, { days }, "wallet")}
          >
            کیف پول
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => void checkout(`/me/subscriptions/${subId}/add-days`, { days }, "card_to_card")}
          >
            کارت‌به‌کارت
          </button>
        </div>
      </Modal>

      <Modal open={mode === "gb"} title="افزایش حجم" onClose={() => setMode(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          هر گیگابایت: {info?.addGb.allowed ? formatToman(info.addGb.perGb) : "—"}
        </p>
        <div className="rate-stepper" style={{ marginBottom: 12 }}>
          <button type="button" className="rate-step-btn" disabled={busy || gb <= 1} onClick={() => setGb((g) => g - 1)}>
            −
          </button>
          <strong className="rate-step-value num">{gb} GB</strong>
          <button
            type="button"
            className="rate-step-btn"
            disabled={busy || gb >= (info?.addGb.maxGb ?? 100)}
            onClick={() => setGb((g) => g + 1)}
          >
            +
          </button>
        </div>
        <p>
          مبلغ: <strong className="num">{formatToman(gbPrice)}</strong>
        </p>
        <div className="qa-row qa-row--1">
          <button
            type="button"
            className="btn sm"
            disabled={busy || !info?.addGb.allowed || walletBalance < gbPrice}
            onClick={() => void checkout(`/me/subscriptions/${subId}/add-gb`, { gb }, "wallet")}
          >
            کیف پول
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !info?.addGb.allowed}
            onClick={() => void checkout(`/me/subscriptions/${subId}/add-gb`, { gb }, "card_to_card")}
          >
            کارت‌به‌کارت
          </button>
        </div>
      </Modal>

      <Modal open={mode === "rename"} title="تغییر نام دلخواه" onClose={() => setMode(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          ایمیل اکانت عوض می‌شود. اگر تکراری باشد عدد سه‌رقمی به انتها اضافه می‌شود.
        </p>
        <div className="field">
          <label>نام جدید</label>
          <input value={rename} onChange={(e) => setRename(filterAccountNameInput(e.target.value))} placeholder="english-name" dir="ltr" autoComplete="off" spellCheck={false} />
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          {ACCOUNT_NAME_HINT}
        </p>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !isValidAccountName(rename)}
          onClick={async () => {
            onBusy(true);
            try {
              const r = await api<{ email: string; changed: boolean }>(`/me/subscriptions/${subId}/rename`, {
                method: "POST",
                body: { name: rename.trim() },
              });
              onMsg(r.changed ? `نام جدید: ${r.email}` : "نام بدون تغییر ماند");
              setMode(null);
              onDone();
            } catch (e) {
              onError(String(e instanceof Error ? e.message : e));
            } finally {
              onBusy(false);
            }
          }}
        >
          ذخیره نام
        </button>
      </Modal>

      <Modal open={mode === "note"} title="یادداشت" onClose={() => setMode(null)}>
        <div className="field">
          <label>یادداشت شخصی</label>
          <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="یادداشت…" />
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            onBusy(true);
            try {
              await api(`/me/subscriptions/${subId}/note`, {
                method: "PATCH",
                body: { note: noteDraft },
              });
              onMsg("یادداشت ذخیره شد");
              setMode(null);
              onDone();
            } catch (e) {
              onError(String(e instanceof Error ? e.message : e));
            } finally {
              onBusy(false);
            }
          }}
        >
          ذخیره
        </button>
      </Modal>

      <Modal open={mode === "b64"} title="لینک Base64 کانفیگ" onClose={() => setMode(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          برای کپی، روی متن بزنید.
        </p>
        {b64 ? (
          <button
            type="button"
            className="tap-copy"
            onClick={() => {
              void copyText(b64, "لینک Base64 کپی شد");
            }}
          >
            {b64}
          </button>
        ) : (
          <p className="muted">در حال آماده‌سازی…</p>
        )}
      </Modal>

      <Modal open={mode === "rotsub"} title="تغییر لینک ساب" onClose={() => setMode(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          با تغییر لینک ساب، اتصال فعلی قطع می‌شود. ادامه می‌دهید؟
        </p>
        <div className="qa-row qa-row--2">
          <button type="button" className="btn danger sm" disabled={busy} onClick={() => void rotateSub()}>
            تأیید تغییر
          </button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => setMode(null)}>
            انصراف
          </button>
        </div>
      </Modal>

      <SubQrModal
        open={qrOpen}
        title={`QR — ${email}`}
        subUrl={subUrl}
        onClose={() => setQrOpen(false)}
      />
    </>
  );
}
