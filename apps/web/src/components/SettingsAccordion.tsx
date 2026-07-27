"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "./DashShell";

type Props = {
  id: string;
  title: string;
  icon: IconName;
  openId: string | null;
  onToggle: (id: string) => void;
  children: ReactNode;
};

/** Exclusive settings section: only one open at a time via shared openId. */
export function SettingsAccordion({ id, title, icon, openId, onToggle, children }: Props) {
  const open = openId === id;
  return (
    <div className={`panel settings-acc${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="settings-acc__head"
        aria-expanded={open}
        aria-controls={`settings-acc-${id}`}
        id={`settings-acc-btn-${id}`}
        onClick={() => onToggle(id)}
      >
        <span className="settings-acc__title">
          <span className="settings-acc__icon" aria-hidden>
            <Icon name={icon} size={18} />
          </span>
          {title}
        </span>
        <span className={`settings-acc__chev${open ? " open" : ""}`} aria-hidden>
          ▾
        </span>
      </button>
      <div
        id={`settings-acc-${id}`}
        role="region"
        aria-labelledby={`settings-acc-btn-${id}`}
        className="settings-acc__body"
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
