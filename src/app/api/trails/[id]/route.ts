import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregateReviews } from "@/lib/score";
import { getCurrentUserId } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Connexion requise pour voir le détail." }, { status: 401 });
  const trail = await prisma.trail.findUnique({
    where: { id: params.id },
    include: { reviews: true, user: { select: { username: true } } },
  });
  if (!trail) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Has the current user marked this hike as done? + total completions
  let completed = false;
  if (userId) {
    const c = await prisma.completion.findUnique({
      where: { trailId_userId: { trailId: params.id, userId } },
    });
    completed = !!c;
  }
  const completionCount = await prisma.completion.count({ where: { trailId: params.id } });

  return NextResponse.json({
    ...trail,
    author: trail.user?.username ?? "Anonyme",
    isOwner: userId ? trail.userId === userId : false,
    completed,
    completionCount,
    score: aggregateReviews(trail.reviews),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  // Only allow deleting your own trail
  const trail = await prisma.trail.findUnique({ where: { id: params.id }, select: { userId: true } });
  if (!trail) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (trail.userId !== userId) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });

  await prisma.trail.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
