import { TrailScore } from "@/types";

type RawReview = {
  pctRoute: number;
  pctSentier: number;
  pctRocheux: number;
  pctMontagne: number;
  difficulty: number;
};

export function aggregateReviews(reviews: RawReview[]): TrailScore | null {
  if (reviews.length === 0) return null;

  const avgDifficulty = reviews.reduce((s, r) => s + r.difficulty, 0) / reviews.length;
  const avgRoute = reviews.reduce((s, r) => s + r.pctRoute, 0) / reviews.length;
  const avgSentier = reviews.reduce((s, r) => s + r.pctSentier, 0) / reviews.length;
  const avgRocheux = reviews.reduce((s, r) => s + r.pctRocheux, 0) / reviews.length;
  const avgMontagne = reviews.reduce((s, r) => s + r.pctMontagne, 0) / reviews.length;

  return {
    global: Math.round(avgDifficulty * 10) / 10,
    surfaceBreakdown: {
      route: Math.round(avgRoute),
      sentier: Math.round(avgSentier),
      rocheux: Math.round(avgRocheux),
      montagne: Math.round(avgMontagne),
    },
    count: reviews.length,
  };
}
