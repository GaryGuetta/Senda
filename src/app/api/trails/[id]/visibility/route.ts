import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// POST — toggle a trail's public/private status. Owner only.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const trail = await prisma.trail.findUnique({
    where: { id: params.id },
    select: { userId: true, isPublic: true },
  });
  if (!trail) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (trail.userId !== userId) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  // Allow explicit set, or toggle if not provided
  const nextPublic = typeof body.isPublic === "boolean" ? body.isPublic : !trail.isPublic;

  await prisma.trail.update({
    where: { id: params.id },
    data: { isPublic: nextPublic },
  });

  return NextResponse.json({ ok: true, isPublic: nextPublic });
}
