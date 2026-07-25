/** Shared 3x-ui expiryTime ↔ bot Subscription mapping. */

export function expiryFromPanel(expiryTime: number): {
  expiresAt: Date;
  startsOnConnect: boolean;
  activatedAt: Date | null;
} {
  if (expiryTime < 0) {
    return {
      expiresAt: new Date(Date.now() + Math.abs(expiryTime)),
      startsOnConnect: true,
      activatedAt: null,
    };
  }
  if (expiryTime > 0) {
    return {
      expiresAt: new Date(expiryTime),
      startsOnConnect: false,
      activatedAt: new Date(),
    };
  }
  return {
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    startsOnConnect: false,
    activatedAt: new Date(),
  };
}

/** True when panel expiryTime should overwrite bot (absolute or duration renew). */
export function panelExpiryDiffersFromBot(
  panelExpiryTime: number,
  sub: {
    expiresAt: Date;
    startsOnConnect: boolean;
    activatedAt: Date | null;
    panelExpiryTime?: bigint | null;
  },
): boolean {
  const mirrored =
    sub.panelExpiryTime != null && Number.isFinite(Number(sub.panelExpiryTime))
      ? Number(sub.panelExpiryTime)
      : null;

  // Prefer raw mirror when we have it — detects duration renews (-1m → -2m) reliably
  if (mirrored != null && Math.abs(mirrored - panelExpiryTime) > 60_000) return true;
  if (mirrored != null && Math.abs(mirrored - panelExpiryTime) <= 60_000) return false;

  if (panelExpiryTime > 0) {
    if (sub.startsOnConnect) return true;
    return Math.abs(panelExpiryTime - sub.expiresAt.getTime()) > 60_000;
  }
  if (panelExpiryTime < 0) {
    // Duration mode on panel — bot should also be starts-on-connect
    if (!sub.startsOnConnect || sub.activatedAt) return true;
    // Legacy rows without mirror: compare duration buckets (days)
    const panelDays = Math.round(Math.abs(panelExpiryTime) / 86_400_000);
    const botRemainingDays = Math.round(
      Math.max(0, sub.expiresAt.getTime() - Date.now()) / 86_400_000,
    );
    // Allow 2-day drift for placeholder ageing; larger gap = renew / different package
    return Math.abs(panelDays - botRemainingDays) > 2;
  }
  return false;
}

export function applyPanelExpiryToBotData(
  panelExpiryTime: number,
  sub: { activatedAt: Date | null },
): {
  expiresAt: Date;
  startsOnConnect: boolean;
  activatedAt: Date | null;
  panelExpiryTime: bigint;
} {
  const exp = expiryFromPanel(panelExpiryTime);
  return {
    expiresAt: exp.expiresAt,
    startsOnConnect: exp.startsOnConnect,
    activatedAt: exp.startsOnConnect ? null : (sub.activatedAt ?? new Date()),
    panelExpiryTime: BigInt(Math.trunc(panelExpiryTime)),
  };
}

/** Raw expiryTime to write to 3x-ui from a bot subscription row. */
export function expiryTimeForPanel(sub: {
  startsOnConnect: boolean;
  activatedAt: Date | null;
  expiresAt: Date;
  panelExpiryTime?: bigint | null;
}): number {
  if (sub.panelExpiryTime != null) {
    const n = Number(sub.panelExpiryTime);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  if (sub.startsOnConnect && !sub.activatedAt) {
    return -Math.max(60_000, sub.expiresAt.getTime() - Date.now());
  }
  return sub.expiresAt.getTime();
}
