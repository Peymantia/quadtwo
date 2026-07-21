import { api, setToken, type SessionUser } from "./api";

export type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  themeParams?: Record<string, string>;
  colorScheme?: "light" | "dark";
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";

let scriptPromise: Promise<boolean> | null = null;

/** Load Telegram WebApp JS if needed. Returns true when WebApp object exists. */
export function ensureTelegramScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Telegram?.WebApp) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Telegram?.WebApp)));
      existing.addEventListener("error", () => resolve(false));
      // Already loaded
      if (window.Telegram?.WebApp) resolve(true);
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve(Boolean(window.Telegram?.WebApp));
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });

  return scriptPromise;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** True when opened inside Telegram with signed initData. */
export function isTelegramMiniApp(): boolean {
  const wa = getTelegramWebApp();
  return Boolean(wa?.initData);
}

export function prepareTelegramUi(wa: TelegramWebApp) {
  try {
    wa.ready();
    wa.expand();
  } catch {
    /* ignore */
  }
  document.documentElement.classList.add("tg-webapp");
  const bg = wa.themeParams?.bg_color;
  if (bg) {
    try {
      wa.setHeaderColor?.(bg);
      wa.setBackgroundColor?.(bg);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Silent login via Telegram initData → JWT.
 * Returns null when not inside Mini App or auth fails.
 */
export async function loginWithTelegramWebApp(): Promise<{ token: string; user: SessionUser } | null> {
  await ensureTelegramScript();
  const wa = getTelegramWebApp();
  if (!wa?.initData) return null;
  prepareTelegramUi(wa);
  const r = await api<{ token: string; user: SessionUser }>("/auth/telegram", {
    token: null,
    body: { initData: wa.initData },
  });
  setToken(r.token);
  return r;
}
