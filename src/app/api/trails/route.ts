import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregateReviews } from "@/lib/score";
import { getCurrentUserId } from "@/lib/session";

// Fields for list views — everything EXCEPT the heavy photos array.
const LIST_SELECT = {
  id: true, name: true, description: true, distance: true, elevation: true,
  geojson: true, center: true, createdAt: true, userId: true,
  isPublic: true, status: true, difficulty: true, reviews: true,
} as const;

// GET — only the current user's trails (private)
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json([]);

    const trails = await prisma.trail.findMany({
      where: { userId },
      select: LIST_SELECT,
      orderBy: { createdAt: "asc" },
    });
    // Which of these has the user completed?
    const completions = await prisma.completion.findMany({
      where: { userId }, select: { trailId: true },
    });
    const doneSet = new Set(completions.map((c: { trailId: string }) => c.trailId));

    const result = trails.map((t: any) => ({
      ...t,
      center: t.center as { lat: number; lng: number },
      completed: doneSet.has(t.id),
      score: aggregateReviews(t.reviews),
    }));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
