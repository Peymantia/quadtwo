/** Nested-modal-safe body scroll lock (refcount). */

let locks = 0;
let prevBodyOverflow = "";
let prevHtmlOverflow = "";

export function lockBodyScroll() {
  if (typeof document === "undefined") return;
  if (locks === 0) {
    prevBodyOverflow = document.body.style.overflow;
    prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  locks += 1;
}

export function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  locks = Math.max(0, locks - 1);
  if (locks === 0) {
    document.body.style.overflow = prevBodyOverflow;
    document.documentElement.style.overflow = prevHtmlOverflow;
  }
}

/** Force-clear if something left the page stuck (safety net). */
export function resetBodyScrollLock() {
  if (typeof document === "undefined") return;
  locks = 0;
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
}
