import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const trailId = searchParams.get("id")
  if (!trailId) return NextResponse.json({ error: "id requis" }, { status: 400 })

  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json([])

  try {
    // Get the vector of the requested trail
    const trail: any[] = await prisma.$queryRaw`
      SELECT "featureVector"::text as vec FROM trails WHERE id = ${trailId}
    `
    if (!trail.length || !trail[0].vec) return NextResponse.json([])

    const vec = trail[0].vec

    const similars: any[] = await prisma.$queryRaw`
      SELECT
        t.id,
        t.name,
        t.distance,
        t.elevation,
        t.geojson,
        ROUND(CAST(GREATEST(0, 1 - (t."featureVector" <-> ${vec}::vector) * 3) * 100 AS numeric), 0) as similarity_pct,
        AVG(r.difficulty) as community_score,
        COUNT(r.id) as review_count
      FROM trails t
      LEFT JOIN reviews r ON r."trailId" = t.id
      WHERE t.id != ${trailId}
        AND t."featureVector" IS NOT NULL
        AND t."userId" = ${userId}
      GROUP BY t.id, t.name, t.distance, t.elevation, t.geojson, t."featureVector"
      ORDER BY t."featureVector" <-> ${vec}::vector
      LIMIT 5
    `

    const results = similars
      .map(s => ({
        id: s.id,
        name: s.name,
        distance: parseFloat(s.distance),
        elevation: parseInt(s.elevation),
        similarity: Math.max(0, parseInt(s.similarity_pct)),
        communityScore: s.community_score ? Math.round(parseFloat(s.community_score) * 10) / 10 : null,
        reviewCount: parseInt(s.review_count),
        globalScore: (s.geojson as any)?.properties?.globalScore ?? null,
      }))
      // Only show trails with meaningful similarity (>40%)
      .filter(s => s.similarity >= 40)
      .sort((a, b) => b.similarity - a.similarity)

    return NextResponse.json(results)
  } catch (e: any) {
    console.error("[similar]", e)
    return NextResponse.json([])
  }
}
