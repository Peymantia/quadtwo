import { prisma } from "../db.js";
import { getSetting } from "./settings.js";
import { env } from "../config/env.js";

/** Parse "1,2,3-5,10" → unique sorted ids */
export function parseInboundIds(raw: string): number[] {
  const ids = new Set<number>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      for (let i = from; i <= to; i++) ids.add(i);
      continue;
    }
    const n = Number(part);
    if (!Number.isNaN(n) && n > 0) ids.add(n);
  }
  return [...ids].sort((a, b) => a - b);
}

export async function getConfiguredInboundIds(): Promise<number[]> {
  const fromSettings = await getSetting("xui_inbound_ids");
  if (fromSettings.trim()) {
    const ids = parseInboundIds(fromSettings);
    if (ids.length) return ids;
  }
  if (env.XUI_INBOUND_IDS?.trim()) {
    const ids = parseInboundIds(env.XUI_INBOUND_IDS);
    if (ids.length) return ids;
  }
  // legacy single id
  return [env.XUI_INBOUND_ID];
}
