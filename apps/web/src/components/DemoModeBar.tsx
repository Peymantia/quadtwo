"use client";

import { useRouter } from "next/navigation";
import { api, homePathForRole, setDemoRoleLocal, type Role } from "../lib/api";

const DEMO_ROLES: { role: Role; label: string }[] = [
  { role: "admin", label: "ادمین" },
  { role: "partner", label: "همکار" },
  { role: "wholesale", label: "عمده" },
  { role: "user", label: "کاربر" },
];

/** Banner + role chips when server DEMO_MODE is on. */
export function DemoModeBar({ activeRole }: { activeRole: Role }) {
  const router = useRouter();

  async function pick(role: Role) {
    setDemoRoleLocal(role);
    try {
      await api("/me/demo-role", { body: { role } });
    } catch {
      /* header alone is enough for subsequent calls */
    }
    router.push(homePathForRole(role));
    router.refresh();
  }

  return (
    <div className="demo-mode-bar" role="status">
      <div className="demo-mode-bar-text">
        <strong>نسخه نمایشی</strong>
        <span>نقش را عوض کنید تا پنل ادمین / همکار / کاربر را ببینید. دادهٔ واقعی نقش شما عوض نمی‌شود.</span>
      </div>
      <div className="demo-mode-chips">
        {DEMO_ROLES.map((r) => (
          <button
            key={r.role}
            type="button"
            className={`chip${activeRole === r.role ? " on" : ""}`}
            onClick={() => void pick(r.role)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
