import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// GET ?type=trail|refuge&id=<targetId> — list comments for a target
export async function GET(req: NextRequest) {
  const targetType = req.nextUrl.searchParams.get("type") || "";
  const targetId = req.nextUrl.searchParams.get("id") || "";
  if (!targetType || !targetId) return NextResponse.json({ comments: [] });
  const comments = await prisma.comment.findMany({
    where: { targetType, targetId },
    orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ comments });
}

// POST — add a comment (login required)
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });

  const b = await req.json();
  const targetType = (b.targetType ?? "").toString();
  const targetId = (b.targetId ?? "").toString();
  const text = (b.text ?? "").toString().trim().slice(0, 2000);
  const visitDate = b.visitDate ? String(b.visitDate).slice(0, 10) : null;
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, 4) : [];
  if (!targetType || !targetId) return NextResponse.json({ error: "cible requise" }, { status: 400 });
  if (!text && photos.length === 0) return NextResponse.json({ error: "Commentaire ou photo requis." }, { status: 400 });

  const comment = await prisma.comment.create({
    data: { targetType, targetId, userId, username: user?.username ?? "Anonyme", text, visitDate, photos: photos.length ? photos : undefined },
  });
  return NextResponse.json({ comment });
}

// DELETE ?id=<commentId> — delete own comment
export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const c = await prisma.comment.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (c.userId !== userId) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  await prisma.comment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
