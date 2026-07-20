"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, homePathForRole, type Role, type SessionUser } from "../lib/api";

export default function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace("/login");
      return;
    }
    api<{ user: SessionUser }>("/me/home", { token: t })
      .then((r) => router.replace(homePathForRole(r.user.role as Role)))
      .catch(() => router.replace("/login"));
  }, [router]);
  return (
    <div className="loading-page">
      <div style={{ textAlign: "center" }}>
        <div className="spinner" />
        در حال انتقال…
      </div>
    </div>
  );
}
