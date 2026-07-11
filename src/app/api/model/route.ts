import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { trainModel, TrainingFeatures, LearnedModel } from "@/lib/learning";
import { aggregateReviews } from "@/lib/score";
import { getCurrentUserId } from "@/lib/session";

// In-memory cache of the trained model PER USER
const modelCache = new Map<string, { model: LearnedModel; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

// Build training features from a trail's stored stats
function extractFeatures(geojson: any): TrainingFeatures | null {
  const props = geojson?.properties;
  const f = props?.features;
  const stats = props?.stats;
  if (!f && !stats) return null;

  return {
    effortIndex: f?.effortIndex ?? stats?.effortIndex ?? 0,
    slopeMax: f?.slopeMax ?? stats?.slopeMax ?? 0,
    slopeAvg: f?.slopeAvg ?? 0,
    pctSteep: f?.pctSteep ?? 0,
    surfaceScore: f?.surfaceScore ?? props?.surfaceScore ?? 5,
    maxAlt: f?.altMax ?? stats?.maxAlt ?? 0,
    pctHighAlt: f?.pctHighAlt ?? 0,
    sacScore: f?.sacScore ?? 0,
    poiDanger: f?.poiDangerCount ?? 0,
    distKm: f?.distKm ?? stats?.distKm ?? 0,
  };
}

// GET — return the current learned model (training it if needed)
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ trained: false, reason: "not_logged_in" });

  const now = Date.now();
  const cached = modelCache.get(userId);
  if (cached && now - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.model as any);
  }

  try {
    // Only this user's reviewed trails
    const trails: any[] = await prisma.$queryRaw`
      SELECT t.id, t.geojson,
        COUNT(r.id) as review_count,
        AVG(r.difficulty) as avg_score
      FROM trails t
      INNER JOIN reviews r ON r."trailId" = t.id
      WHERE r."userId" = ${userId}
      GROUP BY t.id, t.geojson
      HAVING COUNT(r.id) >= 1
    `;

    const samples: { features: TrainingFeatures; targetScore: number }[] = [];
    for (const t of trails) {
      const features = extractFeatures(t.geojson);
      if (features && t.avg_score != null) {
        samples.push({ features, targetScore: parseFloat(t.avg_score) });
      }
    }

    // Need a minimum number of samples to train meaningfully
    if (samples.length < 5) {
      return NextResponse.json({
        trained: false,
        reason: "insufficient_data",
        samplesNeeded: 5,
        samplesHave: samples.length,
      });
    }

    const model = trainModel(samples);
    modelCache.set(userId, { model, ts: now });

    return NextResponse.json({
      trained: true,
      ...model,
      featureImportance: model.features.map((name, i) => ({
        feature: name,
        weight: Math.round(model.weights[i] * 1000) / 1000,
      })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    });
  } catch (e: any) {
    console.error("[MODEL]", e);
    return NextResponse.json({ trained: false, error: e.message }, { status: 500 });
  }
}

// POST — force a retrain
export async function POST() {
  const userId = await getCurrentUserId();
  if (userId) modelCache.delete(userId);
  return GET();
}
