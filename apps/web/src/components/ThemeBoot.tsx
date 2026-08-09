"use client";

import { useEffect } from "react";
import { api } from "../lib/api";
import {
  applyAppearance,
  parseColorMode,
  parseUiSkin,
  readCachedAppearance,
  type ColorMode,
  type UiSkin,
} from "../lib/theme";

type MetaTheme = {
  uiSkin?: string;
  uiColorMode?: string;
};

/**
 * Bootstraps skin/theme from cache, then syncs with /auth/meta.
 * Listens for system preference and Telegram theme changes when relevant.
 */
export function ThemeBoot() {
  useEffect(() => {
    const cached = readCachedAppearance();
    applyAppearance(cached.skin, cached.colorMode);

    let skin: UiSkin = cached.skin;
    let colorMode: ColorMode = cached.colorMode;
    let cancelled = false;

    void api<MetaTheme>("/auth/meta", { token: null })
      .then((r) => {
        if (cancelled) return;
        skin = parseUiSkin(r.uiSkin);
        colorMode = parseColorMode(r.uiColorMode);
        applyAppearance(skin, colorMode);
      })
      .catch(() => undefined);

    const onSystem = () => {
      if (skin === "studio" && (colorMode === "system" || colorMode === "telegram")) {
        applyAppearance(skin, colorMode);
      }
    };
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", onSystem);

    const onTgTheme = () => {
      if (skin === "studio" && colorMode === "telegram") {
        applyAppearance(skin, colorMode);
      }
    };
    const wa = window.Telegram?.WebApp as
      | { onEvent?: (e: string, cb: () => void) => void; offEvent?: (e: string, cb: () => void) => void }
      | undefined;
    wa?.onEvent?.("themeChanged", onTgTheme);

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ skin?: UiSkin; colorMode?: ColorMode }>).detail;
      if (detail?.skin) skin = detail.skin;
      if (detail?.colorMode) colorMode = detail.colorMode;
      applyAppearance(skin, colorMode);
    };
    window.addEventListener("piing:appearance", onCustom);

    return () => {
      cancelled = true;
      mq.removeEventListener("change", onSystem);
      wa?.offEvent?.("themeChanged", onTgTheme);
      window.removeEventListener("piing:appearance", onCustom);
    };
  }, []);

  return null;
}

/** Notify ThemeBoot + apply immediately after admin saves. */
export function broadcastAppearance(skin: UiSkin, colorMode: ColorMode) {
  applyAppearance(skin, colorMode);
  window.dispatchEvent(new CustomEvent("piing:appearance", { detail: { skin, colorMode } }));
}
