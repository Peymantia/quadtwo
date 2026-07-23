import { randomBytes } from "node:crypto";

export function shortCode(prefix = "QT"): string {
  return `${prefix}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function randomSubId(): string {
  return randomBytes(8).toString("hex");
}

export function gbToBytes(gb: number | null): number {
  if (gb === null || gb <= 0) return 0;
  return gb * 1024 * 1024 * 1024;
}

export function formatToman(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

/** Isolate LTR runs (card numbers, codes) so RTL Persian UI does not reverse digits on screen. */
export function ltrIsolate(value: string): string {
  const v = value.trim();
  if (!v) return v;
  return `\u2066${v}\u2069`;
}

/** Card number for display in RTL chats (copy-friendly, visually LTR). */
export function formatCardNumberDisplay(number: string): string {
  return ltrIsolate(number.replace(/\s+/g, ""));
}

export function formatTraffic(gb: number | null): string {
  if (gb === null) return "نامحدود";
  return `${gb} گیگ`;
}

/** Days counted per billed month (panel Duration Days). */
export const DAYS_PER_MONTH = 31;

/** Duration in ms for N months (31-day months → panel Duration Days). */
export function monthsToMs(months: number): number {
  return Math.max(1, months) * DAYS_PER_MONTH * 24 * 60 * 60 * 1000;
}

/**
 * 3x-ui "start after first connect": negative expiryTime = duration until first use.
 * Panel UI shows this as Duration Days with Start After First Use enabled.
 * @see https://github.com/MHSanaei/3x-ui/issues/2145
 */
export function firstConnectExpiryMs(months: number): number {
  return -monthsToMs(months);
}

export function formatExpiryLabel(opts: {
  expiresAt: Date;
  startsOnConnect?: boolean;
  activatedAt?: Date | null;
  createdAt?: Date;
}): string {
  if (opts.startsOnConnect && !opts.activatedAt) {
    if (opts.createdAt) {
      const months = Math.max(1, Math.round((opts.expiresAt.getTime() - opts.createdAt.getTime()) / monthsToMs(1)));
      return `از اولین اتصال · ${months} ماه (هنوز شروع نشده)`;
    }
    return "از اولین اتصال (هنوز شروع نشده)";
  }
  return opts.expiresAt.toLocaleDateString("fa-IR");
}

export function formatDuration(days: number): string {
  if (days % DAYS_PER_MONTH === 0) {
    const months = days / DAYS_PER_MONTH;
    return months === 1 ? "۱ ماه" : `${months} ماه`;
  }
  return `${days} روز`;
}
