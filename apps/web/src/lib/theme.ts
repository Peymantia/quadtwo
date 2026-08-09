export type UiSkin = "classic" | "studio";
export type ColorMode = "dark" | "light" | "system" | "telegram";
export type ResolvedTheme = "dark" | "light";

const CACHE_SKIN = "piing_ui_skin";
const CACHE_COLOR = "piing_ui_color_mode";
const USER_COLOR_OVERRIDE = "piing_ui_color_override";

export function parseUiSkin(raw: unknown): UiSkin {
  return raw === "studio" ? "studio" : "classic";
}

export function parseColorMode(raw: unknown): ColorMode {
  if (raw === "light" || raw === "dark" || raw === "system" || raw === "telegram") return raw;
  return "system";
}

export function readCachedAppearance(): { skin: UiSkin; colorMode: ColorMode } {
  if (typeof window === "undefined") return { skin: "classic", colorMode: "system" };
  return {
    skin: parseUiSkin(localStorage.getItem(CACHE_SKIN)),
    colorMode: parseColorMode(localStorage.getItem(CACHE_COLOR)),
  };
}

export function cacheAppearance(skin: UiSkin, colorMode: ColorMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CACHE_SKIN, skin);
  localStorage.setItem(CACHE_COLOR, colorMode);
}

export function getUserColorOverride(): ResolvedTheme | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(USER_COLOR_OVERRIDE);
  return v === "light" || v === "dark" ? v : null;
}

export function setUserColorOverride(theme: ResolvedTheme | null) {
  if (typeof window === "undefined") return;
  if (!theme) localStorage.removeItem(USER_COLOR_OVERRIDE);
  else localStorage.setItem(USER_COLOR_OVERRIDE, theme);
}

function systemPrefersLight(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function telegramColorScheme(): ResolvedTheme | null {
  if (typeof window === "undefined") return null;
  const s = window.Telegram?.WebApp?.colorScheme;
  return s === "light" || s === "dark" ? s : null;
}

export function resolveTheme(colorMode: ColorMode): ResolvedTheme {
  const override = getUserColorOverride();
  if (override) return override;
  if (colorMode === "light" || colorMode === "dark") return colorMode;
  if (colorMode === "telegram") return telegramColorScheme() ?? (systemPrefersLight() ? "light" : "dark");
  return systemPrefersLight() ? "light" : "dark";
}

export function applyAppearance(skin: UiSkin, colorMode: ColorMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.skin = skin;
  cacheAppearance(skin, colorMode);

  if (skin === "classic") {
    delete root.dataset.theme;
    root.style.colorScheme = "dark";
    syncTelegramChrome("dark");
    return;
  }

  const resolved = resolveTheme(colorMode);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  syncTelegramChrome(resolved);
}

/** Cycle light/dark override while Studio is active. */
export function toggleStudioTheme(colorMode: ColorMode) {
  const current = resolveTheme(colorMode);
  const next: ResolvedTheme = current === "light" ? "dark" : "light";
  setUserColorOverride(next);
  applyAppearance("studio", colorMode);
  return next;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function syncTelegramChrome(resolved: ResolvedTheme) {
  const wa = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
  if (!wa) return;
  const bg = cssVar("--bg0", resolved === "light" ? "#F4F6FA" : "#0B0F14");
  try {
    wa.setHeaderColor?.(bg);
    wa.setBackgroundColor?.(bg);
  } catch {
    /* ignore */
  }
}

/** Tiny FOUC script — keep in sync with applyAppearance defaults. */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem("piing_ui_skin")||"classic";var m=localStorage.getItem("piing_ui_color_mode")||"system";var o=localStorage.getItem("piing_ui_color_override");var r=document.documentElement;r.setAttribute("data-skin",s==="studio"?"studio":"classic");if(s!=="studio"){r.removeAttribute("data-theme");r.style.colorScheme="dark";return;}var t=o==="light"||o==="dark"?o:(m==="light"||m==="dark"?m:(m==="telegram"&&window.Telegram&&window.Telegram.WebApp&&window.Telegram.WebApp.colorScheme)||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"));r.setAttribute("data-theme",t);r.style.colorScheme=t;}catch(e){}})();`;
