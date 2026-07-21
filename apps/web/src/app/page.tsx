"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearToken, getToken, homePathForRole, type Role, type SessionUser } from "../lib/api";
import {
  ensureTelegramScript,
  getTelegramWebApp,
  likelyTelegramMiniApp,
  loginWithTelegramWebApp,
  prepareTelegramUi,
} from "../lib/telegram";

/**
 * Entry redirect: existing JWT → role home; else Telegram Mini App silent login; else /login.
 */
export default function HomeRedirect() {
  const router = useRouter();
  const [status, setStatus] = useState("در حال انتقال…");

  useEffect(() => {
    let cancelled = false;

    async function go() {
      try {
        // Only wait on Telegram CDN when it looks like a Mini App (or bridge already present).
        if (typeof window !== "undefined" && (window.Telegram?.WebApp || likelyTelegramMiniApp())) {
          await ensureTelegramScript();
          const wa = getTelegramWebApp();
          if (wa?.initData) prepareTelegramUi(wa);
        }

        const existing = getToken();
        if (existing) {
          try {
            const r = await api<{ user: SessionUser }>("/me/home", { token: existing });
            if (!cancelled) router.replace(homePathForRole(r.user.role as Role));
            return;
          } catch {
            clearToken();
            /* fall through — try Telegram or login */
          }
        }

        if (getTelegramWebApp()?.initData || likelyTelegramMiniApp()) {
          setStatus("ورود از تلگرام…");
          try {
            const tg = await loginWithTelegramWebApp();
            if (tg && !cancelled) {
              router.replace(homePathForRole(tg.user.role as Role));
              return;
            }
          } catch {
            /* not in Mini App or invalid initData */
          }
        }
      } catch {
        /* never block the browser on auth bootstrap errors */
      }

      if (!cancelled) router.replace("/login");
    }

    void go();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="loading-page">
      <div style={{ textAlign: "center" }}>
        <div className="spinner" />
        {status}
      </div>
    </div>
  );
}
