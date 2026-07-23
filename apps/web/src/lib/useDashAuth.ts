"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearToken, formatToman, getToken, type Role, type SessionUser } from "./api";

export type HomeData = {
  brand: string;
  support: string;
  demoMode?: boolean;
  demoRole?: Role | null;
  demoRoleLabel?: string | null;
  user: SessionUser & { testClaimed?: boolean; dbRole?: Role };
  wallet: { balance: number };
  stats: { subscriptions: number; active: number };
};

export function useDashAuth(allowed?: Role[]) {
  const router = useRouter();
  const [home, setHome] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const allowedKey = allowed?.slice().sort().join(",") ?? "";

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    try {
      const data = await api<HomeData>("/me/home", { token });
      const roles = allowedKey ? (allowedKey.split(",") as Role[]) : null;
      if (roles && !roles.includes(data.user.role as Role)) {
        router.replace(
          data.user.role === "admin"
            ? "/admin"
            : data.user.role === "wholesale"
              ? "/reseller"
              : data.user.role === "partner"
                ? "/partner"
                : "/app",
        );
        return;
      }
      setHome(data);
      setError(null);
    } catch (err) {
      clearToken();
      setError(String(err instanceof Error ? err.message : err));
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [allowedKey, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { home, error, loading, reload };
}
