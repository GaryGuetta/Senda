import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregateReviews } from "@/lib/score";
import { getCurrentUserId } from "@/lib/session";

// GET — the public trace bank. No authentication required.
// Photos are excluded here (loaded only on the detail page) to keep it fast.
export async function GET() {
  try {
    const userId = await getCurrentUserId(); // may be null (public browsing)

    const trails = await prisma.trail.findMany({
      where: { isPublic: true },
      select: {
        id: true, name: true, description: true, distance: true, elevation: true,
        geojson: true, center: true, createdAt: true, userId: true,
        isPublic: true, difficulty: true,
        reviews: true,
        user: { select: { username: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Mark which ones the current user has completed (if logged in)
    let doneSet = new Set<string>();
    if (userId) {
      const completions = await prisma.completion.findMany({
        where: { userId }, select: { trailId: true },
      });
      doneSet = new Set(completions.map((c: { trailId: string }) => c.trailId));
    }
    // Completion counts per trail (social proof)
    const counts = await prisma.completion.groupBy({ by: ["trailId"], _count: { trailId: true } });
    const countMap = new Map(counts.map((c: any) => [c.trailId, c._count.trailId]));

    const result = trails.map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      distance: t.distance,
      elevation: t.elevation,
      center: t.center as { lat: number; lng: number },
      geojson: t.geojson,
      createdAt: t.createdAt,
      isPublic: t.isPublic,
      difficulty: t.difficulty,
      author: t.user?.username ?? "Anonyme",
      completed: doneSet.has(t.id),
      completionCount: countMap.get(t.id) ?? 0,
      score: aggregateReviews(t.reviews),
    }));

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
