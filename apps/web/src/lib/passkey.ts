"use client";

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { api } from "./api";
import { isTelegramMiniApp } from "./telegram";

export function isPasskeySecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

export async function canUsePasskey(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!isPasskeySecureContext()) return false;
  if (!browserSupportsWebAuthn()) return false;
  try {
    // Some desktops report false for platform auth but still support security keys /
    // hybrid — allow WebAuthn UI if the API exists.
    const platform = await platformAuthenticatorIsAvailable();
    return platform || browserSupportsWebAuthn();
  } catch {
    return browserSupportsWebAuthn();
  }
}

export async function registerPasskey(label?: string) {
  const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>(
    "/me/passkeys/register/options",
    { body: {} },
  );
  const response = await startRegistration({ optionsJSON: options });
  await api("/me/passkeys/register/verify", { body: { response, label } });
}

export async function loginWithPasskey(loginHint?: string) {
  const { options, challengeId } = await api<{
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeId: string;
  }>("/auth/passkey/options", {
    token: null,
    body: { login: loginHint?.trim() || undefined },
  });
  const response = await startAuthentication({ optionsJSON: options });
  return api<{ token: string; user: import("./api").SessionUser }>("/auth/passkey/verify", {
    token: null,
    body: { response, challengeId },
  });
}

type PublicKeyCredentialCreationOptionsJSON = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];
type PublicKeyCredentialRequestOptionsJSON = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];

/** Map WebAuthn / browser errors to Persian for the UI. */
export function passkeyErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const msg = String(err instanceof Error ? err.message : err);

  if (/NotAllowedError|not allowed|timed out|timeout|abort|cancel/i.test(msg) || name === "NotAllowedError") {
    if (/timed out|timeout/i.test(msg)) {
      return "زمان تأیید بیومتریک تمام شد. دوباره تلاش کنید.";
    }
    if (/abort|cancel/i.test(msg)) {
      return "ورود بیومتریک لغو شد.";
    }
    return "تأیید بیومتریک انجام نشد. دوباره تلاش کنید یا از OTP استفاده کنید.";
  }

  if (/SecurityError|secure context|insecure|The operation is insecure/i.test(msg) || name === "SecurityError") {
    if (typeof window !== "undefined" && window.isSecureContext) {
      if (isTelegramMiniApp()) {
        return "بیومتریک داخل مینی‌اپ تلگرام محدود است. پنل را در مرورگر (Safari/Chrome) با همان آدرس HTTPS باز کنید.";
      }
      return "دامنهٔ فعلی با تنظیمات WebAuthn سرور یکی نیست. از همان آدرس اصلی داشبورد وارد شوید.";
    }
    return "ورود بیومتریک فقط روی HTTPS فعال است.";
  }

  if (/expected origin|rpId|RP ID|origin/i.test(msg)) {
    return "دامنهٔ پنل با تنظیمات سرور هم‌خوان نیست. از آدرس اصلی داشبورد وارد شوید.";
  }

  if (/InvalidStateError|not registered|no credentials/i.test(msg) || name === "InvalidStateError") {
    return "Passkey ثبت‌شده‌ای پیدا نشد. ابتدا با OTP وارد شوید و در تنظیمات فعال کنید.";
  }
  if (/NetworkError|fetch|failed to fetch/i.test(msg)) {
    return "اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.";
  }
  return msg.length > 120 ? "خطا در ورود بیومتریک. دوباره تلاش کنید." : msg;
}

export function passkeyUnavailableHint(): string {
  if (typeof window === "undefined") return "";
  if (!window.isSecureContext) {
    return "این صفحه روی HTTP است؛ بیومتریک فقط روی HTTPS کار می‌کند.";
  }
  if (isTelegramMiniApp()) {
    return "در مینی‌اپ تلگرام ممکن است بیومتریک کار نکند — در صورت خطا از مرورگر معمولی استفاده کنید.";
  }
  if (!browserSupportsWebAuthn()) {
    return "این مرورگر از WebAuthn / Passkey پشتیبانی نمی‌کند.";
  }
  return "این دستگاه احراز هویت بیومتریک در دسترس ندارد.";
}
