import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "trailrate_user";

// Secret used to sign session cookies. Prefer a dedicated SESSION_SECRET;
// falls back to DATABASE_URL (already secret & always set on Vercel).
const SECRET = process.env.SESSION_SECRET || process.env.DATABASE_URL || "senda-dev-secret-change-me";

// A session token is `userId.HMAC(userId)` — the signature makes it impossible
// to forge a cookie for another user without knowing the secret.
export function makeSessionToken(userId: string): string {
  const sig = crypto.createHmac("sha256", SECRET).update(userId).digest("base64url");
  return `${userId}.${sig}`;
}

export function readSessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const userId = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(userId).digest("base64url");
  try {
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch { return null; }
  return userId;
}

// Get the current user from the (signed) cookie — server-side.
export async function getCurrentUser() {
  const userId = readSessionToken(cookies().get(COOKIE_NAME)?.value);
  if (!userId) return null;
  try {
    return await prisma.user.findUnique({ where: { id: userId } });
  } catch {
    return null;
  }
}

// Get just the verified user ID (null if missing or the signature is invalid).
export async function getCurrentUserId(): Promise<string | null> {
  return readSessionToken(cookies().get(COOKIE_NAME)?.value);
}

export { COOKIE_NAME };
