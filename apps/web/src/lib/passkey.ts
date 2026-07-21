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
