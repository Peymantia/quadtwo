"use client";

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { api } from "./api";

export async function canUsePasskey(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
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
  if (/SecurityError|secure context|insecure/i.test(msg) || name === "SecurityError") {
    return "ورود بیومتریک فقط روی HTTPS فعال است.";
  }
  if (/InvalidStateError|not registered|no credentials/i.test(msg) || name === "InvalidStateError") {
    return "Passkey ثبت‌شده‌ای پیدا نشد. ابتدا با OTP وارد شوید و در تنظیمات فعال کنید.";
  }
  if (/NetworkError|fetch|failed to fetch/i.test(msg)) {
    return "اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.";
  }
  return msg.length > 120 ? "خطا در ورود بیومتریک. دوباره تلاش کنید." : msg;
}
