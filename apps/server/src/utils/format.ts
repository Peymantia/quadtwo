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

export function formatTraffic(gb: number | null): string {
  if (gb === null) return "نامحدود";
  return `${gb} گیگ`;
}

export function formatDuration(days: number): string {
  if (days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "۱ ماه" : `${months} ماه`;
  }
  return `${days} روز`;
}
