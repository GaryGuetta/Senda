import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// ─── Auto-calibration ─────────────────────────────────────────────────────────
// Measures the systematic gap between the formula's calculated score and the
// real score given by hikers. If the formula consistently over- or under-rates,
// we surface a calibration offset that future imports can apply.

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ calibrated: false, reason: "not_logged_in" });
  try {
    const trails: any[] = await prisma.$queryRaw`
      SELECT t.geojson,
        AVG(r.difficulty) as user_score,
        COUNT(r.id) as review_count
      FROM trails t
      INNER JOIN reviews r ON r."trailId" = t.id
      WHERE r."userId" = ${userId}
      GROUP BY t.id, t.geojson
      HAVING COUNT(r.id) >= 1
    `;

    const pairs: { calculated: number; user: number; weight: number }[] = [];
    for (const t of trails) {
      const calc = t.geojson?.properties?.calculatedScore ?? t.geojson?.properties?.globalScore;
      const user = t.user_score != null ? parseFloat(t.user_score) : null;
      if (calc != null && user != null) {
        pairs.push({ calculated: calc, user, weight: Math.log(1 + parseInt(t.review_count)) });
      }
    }

    if (pairs.length < 3) {
      return NextResponse.json({
        calibrated: false,
        reason: "insufficient_data",
        pairsHave: pairs.length,
        pairsNeeded: 3,
      });
    }

    // Weighted mean signed error (user - calculated)
    let weightedErrSum = 0, weightSum = 0, absErrSum = 0;
    for (const p of pairs) {
      weightedErrSum += (p.user - p.calculated) * p.weight;
      weightSum += p.weight;
      absErrSum += Math.abs(p.user - p.calculated);
    }
    const meanOffset = weightedErrSum / weightSum;
    const meanAbsError = absErrSum / pairs.length;

    // Correlation between calculated and user scores
    const calcMean = pairs.reduce((s, p) => s + p.calculated, 0) / pairs.length;
    const userMean = pairs.reduce((s, p) => s + p.user, 0) / pairs.length;
    let cov = 0, calcVar = 0, userVar = 0;
    for (const p of pairs) {
      cov += (p.calculated - calcMean) * (p.user - userMean);
      calcVar += (p.calculated - calcMean) ** 2;
      userVar += (p.user - userMean) ** 2;
    }
    const correlation = (calcVar > 0 && userVar > 0)
      ? cov / Math.sqrt(calcVar * userVar) : 0;

    // Direction of bias
    let bias: string;
    if (Math.abs(meanOffset) < 0.4) bias = "neutral";
    else if (meanOffset > 0) bias = "underrates"; // formula too low
    else bias = "overrates"; // formula too high

    return NextResponse.json({
      calibrated: true,
      pairs: pairs.length,
      meanOffset: Math.round(meanOffset * 100) / 100,
      meanAbsError: Math.round(meanAbsError * 100) / 100,
      correlation: Math.round(correlation * 100) / 100,
      bias,
      // Suggested correction to apply to future formula scores
      suggestedOffset: Math.round(meanOffset * 0.7 * 100) / 100, // damped
    });
  } catch (e: any) {
    console.error("[CALIBRATION]", e);
    return NextResponse.json({ calibrated: false, error: e.message }, { status: 500 });
  }
}
