"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, formatToman } from "../lib/api";
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

export function SubAddonsBar({
  subId,
  email,
  isTest,
  trafficGb,
  busy,
  walletBalance,
  onBusy,
  onDone,
  onPayCard,
  onPayCrypto,
  onError,
  onMsg,
}: {
  subId: string;
  email: string;
  isTest?: boolean;
  trafficGb?: number | null;
  busy: boolean;
  walletBalance: number;
  onBusy: (v: boolean) => void;
  onDone: () => void;
  onPayCard: (orderId: string, price: number, card: { number: string; holder: string }) => void;
  onPayCrypto: (orderId: string, price: number, crypto: CryptoPayInfo) => void;
  onError: (msg: string) => void;
  onMsg: (msg: string) => void;
}) {
  const [info, setInfo] = useState<AddonsInfo | null>(null);
  const [mode, setMode] = useState<"days" | "gb" | "rename" | "b64" | null>(null);
  const [days, setDays] = useState(1);
  const [gb, setGb] = useState(1);
  const [rename, setRename] = useState(email);
  const [b64, setB64] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
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

  const canDays = !isTest;
  const canGb = !isTest && trafficGb != null && trafficGb > 0;
  const daysPrice = (info?.addDays.perDay ?? 2000) * days;
  const gbPrice = (info?.addGb.perGb ?? 0) * gb;

  return (
    <>
      <div className="config-card-actions-row sub-addons">
        {canDays && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setMode("days")}>
            افزایش روز
          </button>
        )}
        {canGb && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setMode("gb")}>
            افزایش حجم
          </button>
        )}
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy}
          onClick={() => {
            setRename(email);
            setMode("rename");
          }}
        >
          تغییر نام
        </button>
        <button
          type="button"
          className="btn ghost sm"
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
          Base64
        </button>
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
        <div className="config-card-actions-row">
          <button
            type="button"
            className="btn success sm"
            disabled={busy || walletBalance < daysPrice}
            onClick={() =>
              void checkout(`/me/subscriptions/${subId}/add-days`, { days }, "wallet")
            }
          >
            کیف پول
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() =>
              void checkout(`/me/subscriptions/${subId}/add-days`, { days }, "card_to_card")
            }
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
        <div className="config-card-actions-row">
          <button
            type="button"
            className="btn success sm"
            disabled={busy || !info?.addGb.allowed || walletBalance < gbPrice}
            onClick={() => void checkout(`/me/subscriptions/${subId}/add-gb`, { gb }, "wallet")}
          >
            کیف پول
          </button>
          <button
            type="button"
            className="btn primary sm"
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
          <input value={rename} onChange={(e) => setRename(e.target.value)} placeholder="english-name" />
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !rename.trim()}
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

      <Modal open={mode === "b64"} title="لینک امن کانفیگ (Base64)" onClose={() => setMode(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          برای کپی، روی متن بزنید.
        </p>
        {b64 ? (
          <button
            type="button"
            className="tap-copy"
            onClick={() => {
              void navigator.clipboard.writeText(b64);
              onMsg("Base64 کپی شد");
            }}
          >
            {b64}
          </button>
        ) : (
          <p className="muted">در حال آماده‌سازی…</p>
        )}
      </Modal>
    </>
  );
}
