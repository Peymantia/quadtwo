/**
 * Simple in-memory rate limiter (per telegram user / action).
 * Resets on process restart — enough to stop spam buy/receipt floods.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  opts: { max: number; windowMs: number },
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true };
  }
  if (cur.count >= opts.max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true };
}

/** Buy / checkout: max 8 starts per 10 minutes */
export function limitBuy(telegramId: number) {
  return checkRateLimit(`buy:${telegramId}`, { max: 8, windowMs: 10 * 60 * 1000 });
}

/** Receipt upload: max 6 per 10 minutes */
export function limitReceipt(telegramId: number) {
  return checkRateLimit(`receipt:${telegramId}`, { max: 6, windowMs: 10 * 60 * 1000 });
}

/** Partner request: max 3 per hour */
export function limitPartnerRequest(telegramId: number) {
  return checkRateLimit(`partner:${telegramId}`, { max: 3, windowMs: 60 * 60 * 1000 });
}

/** Test claim attempt: max 5 per hour (actual one-time still enforced in DB) */
export function limitTestClaim(telegramId: number) {
  return checkRateLimit(`test:${telegramId}`, { max: 5, windowMs: 60 * 60 * 1000 });
}
