import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// GET ?id=<refugeId> — merged info override + comments for a refuge
export async function GET(req: NextRequest) {
  const refugeId = req.nextUrl.searchParams.get("id");
  if (!refugeId) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const contribution = await prisma.refugeContribution.findUnique({ where: { refugeId } });
  return NextResponse.json({ contribution });
}

// POST — upsert the editable info for a refuge (login required)
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });

  const b = await req.json();
  const refugeId = (b.refugeId ?? "").toString();
  if (!refugeId) return NextResponse.json({ error: "refugeId requis" }, { status: 400 });

  const data = {
    eau: b.eau || null,
    bois: b.bois || null,
    places: b.places ? String(b.places).slice(0, 40) : null,
    altitude: b.altitude != null && b.altitude !== "" ? parseInt(b.altitude) || null : null,
    description: b.description ? String(b.description).slice(0, 2000) : null,
    updatedBy: user?.username ?? null,
  };
  const contribution = await prisma.refugeContribution.upsert({
    where: { refugeId },
    create: { refugeId, ...data },
    update: data,
  });
  return NextResponse.json({ contribution });
}
