import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "trailrate_user";

// Get the current user from the cookie (server-side)
export async function getCurrentUser() {
  const cookieStore = cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user;
  } catch {
    return null;
  }
}

// Get just the user ID
export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export { COOKIE_NAME };
