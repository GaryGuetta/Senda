import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// POST — toggle "I've done this hike" for the current user.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const existing = await prisma.completion.findUnique({
    where: { trailId_userId: { trailId: params.id, userId } },
  });
  const want = typeof body.completed === "boolean" ? body.completed : !existing;

  if (want && !existing) {
    await prisma.completion.create({ data: { trailId: params.id, userId } });
  } else if (!want && existing) {
    await prisma.completion.delete({ where: { trailId_userId: { trailId: params.id, userId } } });
  }
  return NextResponse.json({ ok: true, completed: want });
}
