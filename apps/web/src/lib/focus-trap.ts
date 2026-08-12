const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && el.tabIndex !== -1,
  );
}

/** Trap Tab inside `container`. Returns cleanup. */
export function trapFocus(container: HTMLElement, e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const nodes = getFocusable(container);
  if (nodes.length === 0) {
    e.preventDefault();
    return;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey) {
    if (!active || active === first || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (!active || active === last || !container.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

/** Save focus, then restore on dispose. */
export function rememberFocus(): () => void {
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return () => {
    prev?.focus?.();
  };
}
