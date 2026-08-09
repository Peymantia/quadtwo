/** Shared UI labels for volume / expiry (unlimited → ∞). */

export function formatTrafficGb(gb: number | null | undefined, opts?: { unit?: boolean }): string {
  if (gb == null || gb <= 0) return "∞";
  const n = Number.isInteger(gb) ? String(gb) : (Math.round(gb * 10) / 10).toFixed(1);
  return opts?.unit === false ? n : `${n} GB`;
}

export function formatTrafficGbFa(gb: number | null | undefined): string {
  if (gb == null || gb <= 0) return "∞";
  return `${gb.toLocaleString("fa-IR")} گیگابایت`;
}

export function formatExpiryDate(iso: string | null | undefined): string {
  if (!iso) return "∞";
  try {
    return new Date(iso).toLocaleDateString("fa-IR");
  } catch {
    return iso;
  }
}

export function formatRemainDays(iso: string | null | undefined): string {
  if (!iso) return "∞";
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (Number.isNaN(days)) return "∞";
  if (days < 0) return `${Math.abs(days)} روز گذشته`;
  if (days === 0) return "کمتر از یک روز";
  return `${days} روز`;
}
