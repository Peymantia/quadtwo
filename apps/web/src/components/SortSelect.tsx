"use client";

export type ListSort = "newest" | "oldest" | "ending";

export function SortSelect({
  value,
  onChange,
  id = "list-sort",
}: {
  value: ListSort;
  onChange: (v: ListSort) => void;
  id?: string;
}) {
  return (
    <div className="sort-bar">
      <label htmlFor={id}>مرتب‌سازی</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as ListSort)}>
        <option value="newest">از جدید به قدیم</option>
        <option value="oldest">از قدیم به جدید</option>
        <option value="ending">اتمام حجم یا تاریخ</option>
      </select>
    </div>
  );
}

/**
 * Urgency in "days until done" — lower sorts first for «ending».
 * Uses the nearer of: days until expiry, or remaining-traffic mapped onto a 90-day scale.
 * Expired / fully depleted → ≤ 0.
 */
export function endingUrgencyDays(opts: {
  expiresAt: string | Date | null | undefined;
  usedBytes?: number;
  totalGb?: number | null;
}): number {
  const now = Date.now();
  const expMs = opts.expiresAt ? new Date(opts.expiresAt).getTime() : Number.NaN;
  const hasExp = Number.isFinite(expMs);
  const daysLeft = hasExp ? (expMs - now) / 864e5 : Number.POSITIVE_INFINITY;

  const totalBytes = opts.totalGb != null && opts.totalGb > 0 ? opts.totalGb * 1024 ** 3 : 0;
  const used = Math.max(0, opts.usedBytes ?? 0);
  let trafficDays = Number.POSITIVE_INFINITY;
  if (totalBytes > 0) {
    const leftFrac = Math.max(0, 1 - used / totalBytes);
    trafficDays = leftFrac * 90;
    if (used >= totalBytes) trafficDays = 0;
  }

  if (hasExp && daysLeft <= 0) {
    // Already expired: more overdue → more negative → earlier in list
    return daysLeft;
  }
  if (totalBytes > 0 && used >= totalBytes) return 0;

  return Math.min(
    Number.isFinite(daysLeft) ? Math.max(0, daysLeft) : Number.POSITIVE_INFINITY,
    trafficDays,
  );
}

/** @deprecated prefer endingUrgencyDays — kept for call-site compatibility */
export function remainingRatio(opts: {
  expiresAt: string | Date | null | undefined;
  usedBytes?: number;
  totalGb?: number | null;
}): number {
  const days = endingUrgencyDays(opts);
  if (!Number.isFinite(days)) return 1;
  if (days <= 0) return 0;
  return Math.min(1, days / 90);
}

export function sortByMode<T>(
  items: T[],
  mode: ListSort,
  getters: {
    createdAt: (item: T) => number;
    expiresAt: (item: T) => number;
    remainingRatio: (item: T) => number;
    /** Optional; when present, «ending» uses this instead of remainingRatio */
    endingUrgencyDays?: (item: T) => number;
  },
): T[] {
  const copy = [...items];
  if (mode === "newest") {
    copy.sort((a, b) => getters.createdAt(b) - getters.createdAt(a));
  } else if (mode === "oldest") {
    copy.sort((a, b) => getters.createdAt(a) - getters.createdAt(b));
  } else {
    copy.sort((a, b) => {
      const ua = getters.endingUrgencyDays?.(a) ?? getters.remainingRatio(a);
      const ub = getters.endingUrgencyDays?.(b) ?? getters.remainingRatio(b);
      if (ua !== ub) return ua - ub;
      const ea = getters.expiresAt(a);
      const eb = getters.expiresAt(b);
      if (ea !== eb) return ea - eb;
      return 0;
    });
  }
  return copy;
}
