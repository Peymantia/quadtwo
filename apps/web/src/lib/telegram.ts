import { api, setToken, type SessionUser } from "./api";

export type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";

export type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  isFullscreen?: boolean;
  isExpanded?: boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  themeParams?: Record<string, string>;
  colorScheme?: "light" | "dark";
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
  /** Bot API 8.0+ — prompt to add Mini App shortcut to the device home screen. */
  addToHomeScreen?: () => void;
  /** Bot API 8.0+ — check whether home-screen shortcut is supported / already added. */
  checkHomeScreenStatus?: (callback?: (status: HomeScreenStatus) => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";
const SCRIPT_TIMEOUT_MS = 2500;

let scriptPromise: Promise<boolean> | null = null;

/** URL/hash hints that Telegram opened us as a Mini App. */
export function likelyTelegramMiniApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.Telegram?.WebApp?.initData) return true;
  const blob = `${window.location.href}${window.location.hash}`;
  return /tgWebAppData|tgWebAppVersion|tgWebAppPlatform/i.test(blob);
}

/** Load Telegram WebApp JS if needed. Never hangs — times out and resolves false. */
export function ensureTelegramScript(timeoutMs = SCRIPT_TIMEOUT_MS): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Telegram?.WebApp) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timer = window.setTimeout(() => done(Boolean(window.Telegram?.WebApp)), timeoutMs);

    const finish = (ok: boolean) => {
      window.clearTimeout(timer);
      done(ok);
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      if (window.Telegram?.WebApp) {
        finish(true);
        return;
      }
      // Script tag present but may already have finished loading (load won't fire again).
      const complete = (existing as HTMLScriptElement & { readyState?: string }).readyState;
      if (complete === "complete" || complete === "loaded") {
        finish(Boolean(window.Telegram?.WebApp));
        return;
      }
      existing.addEventListener("load", () => finish(Boolean(window.Telegram?.WebApp)), { once: true });
      existing.addEventListener("error", () => finish(false), { once: true });
      return;
    }

    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => finish(Boolean(window.Telegram?.WebApp));
    s.onerror = () => finish(false);
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
    // Full-size = expand bottom sheet to max height (not requestFullscreen).
    if (wa.isFullscreen) wa.exitFullscreen?.();
    wa.expand();
  } catch {
    /* ignore */
  }
  document.documentElement.classList.add("tg-webapp");

  const skin = document.documentElement.dataset.skin;
  if (skin === "studio") {
    const resolved = (document.documentElement.dataset.theme === "light" ? "light" : "dark") as
      | "light"
      | "dark";
    const fromCss = getComputedStyle(document.documentElement).getPropertyValue("--bg0").trim();
    const bg = fromCss || (resolved === "light" ? "#F4F6FA" : "#0B0F14");
    try {
      wa.setHeaderColor?.(bg);
      wa.setBackgroundColor?.(bg);
    } catch {
      /* ignore */
    }
    return;
  }

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
 * Prompt Telegram to add this Mini App to the device home screen (no-op if unsupported).
 */
export function promptAddToHomeScreen(): boolean {
  const wa = getTelegramWebApp();
  if (!wa?.addToHomeScreen) return false;
  try {
    wa.addToHomeScreen();
    return true;
  } catch {
    return false;
  }
}

/** Resolve home-screen shortcut status when Telegram exposes the API. */
export function checkHomeScreenStatus(): Promise<HomeScreenStatus | null> {
  const wa = getTelegramWebApp();
  if (!wa?.checkHomeScreenStatus) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = (status: HomeScreenStatus | null) => {
        if (settled) return;
        settled = true;
        resolve(status);
      };
      window.setTimeout(() => done(null), 1500);
      wa.checkHomeScreenStatus?.((status) => done(status));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Silent login via Telegram initData → JWT.
 * Returns null when not inside Mini App or auth fails.
 */
export async function loginWithTelegramWebApp(): Promise<{ token: string; user: SessionUser } | null> {
  // Inside Telegram the bridge is usually already injected — don't block on CDN.
  if (!window.Telegram?.WebApp && likelyTelegramMiniApp()) {
    await ensureTelegramScript();
  } else if (!window.Telegram?.WebApp) {
    // Desktop browser: brief attempt only; skip if CDN is blocked.
    await ensureTelegramScript(1200);
  }

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
