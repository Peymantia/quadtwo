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

export function sortByMode<T>(
  items: T[],
  mode: ListSort,
  getters: {
    createdAt: (item: T) => number;
    expiresAt: (item: T) => number;
    remainingRatio: (item: T) => number;
  },
): T[] {
  const copy = [...items];
  if (mode === "newest") {
    copy.sort((a, b) => getters.createdAt(b) - getters.createdAt(a));
  } else if (mode === "oldest") {
    copy.sort((a, b) => getters.createdAt(a) - getters.createdAt(b));
  } else {
    copy.sort((a, b) => {
      const ra = getters.remainingRatio(a);
      const rb = getters.remainingRatio(b);
      if (ra !== rb) return ra - rb;
      return getters.expiresAt(a) - getters.expiresAt(b);
    });
  }
  return copy;
}

/** 0 = depleted / expired, 1 = full remaining. Lower sorts first for «ending». */
export function remainingRatio(opts: {
  expiresAt: string | Date | null | undefined;
  usedBytes?: number;
  totalGb?: number | null;
}): number {
  const now = Date.now();
  const exp = opts.expiresAt ? new Date(opts.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const timeLeft = Number.isFinite(exp) ? Math.max(0, exp - now) : Number.POSITIVE_INFINITY;
  const timeRatio = Number.isFinite(timeLeft) ? Math.min(1, timeLeft / (90 * 864e5)) : 1;

  const total = opts.totalGb != null && opts.totalGb > 0 ? opts.totalGb * 1024 ** 3 : 0;
  const used = opts.usedBytes ?? 0;
  const trafficRatio = total > 0 ? Math.max(0, 1 - used / total) : 1;

  return Math.min(timeRatio, trafficRatio);
}
