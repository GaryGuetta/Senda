import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregateReviews } from "@/lib/score";
import { getCurrentUserId } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json(null);
  const review = await prisma.review.findUnique({
    where: { trailId_userId: { trailId: params.id, userId } },
  });
  return NextResponse.json(review);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const body = await req.json();
  const { pctRoute, pctSentier, pctRocheux, pctMontagne, difficulty, comment } = body;

  // Validate percentages
  for (const val of [pctRoute, pctSentier, pctRocheux, pctMontagne]) {
    if (typeof val !== "number" || val < 0 || val > 100)
      return NextResponse.json({ error: "Pourcentage invalide (0-100)" }, { status: 400 });
  }
  if (typeof difficulty !== "number" || difficulty < 1 || difficulty > 10)
    return NextResponse.json({ error: "Difficulté invalide (1-10)" }, { status: 400 });

  const review = await prisma.review.upsert({
    where: { trailId_userId: { trailId: params.id, userId } },
    update: { pctRoute, pctSentier, pctRocheux, pctMontagne, difficulty, comment: comment || null },
    create: { trailId: params.id, userId, pctRoute, pctSentier, pctRocheux, pctMontagne, difficulty, comment: comment || null },
  });

  const allReviews = await prisma.review.findMany({ where: { trailId: params.id } });
  const score = aggregateReviews(allReviews);
  return NextResponse.json({ review, score, willImproveModel: true });
}
