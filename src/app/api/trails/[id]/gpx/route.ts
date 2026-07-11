import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// GET — export the trail as a downloadable GPX file
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const trail = await prisma.trail.findUnique({
    where: { id: params.id },
    select: { name: true, geojson: true, isPublic: true },
  });
  if (!trail) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const geo = trail.geojson as any;
  const coords: any[] = geo?.geometry?.coordinates ?? [];
  const eles: number[] = geo?.properties?.elevations ?? [];
  if (coords.length < 2) return NextResponse.json({ error: "Trace vide" }, { status: 422 });

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const pts = coords.map(([lng, lat]: any, i: number) => {
    const ele = eles[i];
    return `      <trkpt lat="${lat}" lon="${lng}">${ele != null ? `<ele>${Math.round(ele)}</ele>` : ""}</trkpt>`;
  }).join("\n");

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Senda" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(trail.name)}</name></metadata>
  <trk>
    <name>${esc(trail.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;

  const safeName = trail.name.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60) || "trace";
  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${safeName}.gpx"`,
    },
  });
}
