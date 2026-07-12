import { NextRequest } from "next/server";

// Lightweight in-memory rate limiter. Note: on serverless this is per-instance
// (resets on cold starts), so it's a first line of defence, not bulletproof.
// For stronger guarantees, back it with a shared store (e.g. Upstash Redis).

type Bucket = { count: number; reset: number };
const store = new Map<string, Bucket>();

// Occasionally drop expired buckets so the map doesn't grow unbounded.
function sweep(now: number) {
  if (store.size < 5000) return;
  for (const [k, b] of store) if (now > b.reset) store.delete(k);
}

/** Returns true if the action is allowed, false if the limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now > b.reset) {
    store.set(key, { count: 1, reset: now + windowMs });
    sweep(now);
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
