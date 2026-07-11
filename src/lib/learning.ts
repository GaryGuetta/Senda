// ─── Weight learning via gradient descent ─────────────────────────────────────
// Trains a linear regression that maps trail features → perceived difficulty
// (user score). The learned weights replace the hand-tuned ones once we have
// enough data, blended progressively so early predictions stay stable.

// Features used for the global difficulty prediction.
// These are normalised 0-1 before training.
export interface TrainingFeatures {
  effortIndex: number    // D+ + dist*10, normalised
  slopeMax: number       // 95th percentile slope
  slopeAvg: number
  pctSteep: number       // fraction >20%
  surfaceScore: number   // 0-10 → 0-1
  maxAlt: number         // normalised
  pctHighAlt: number     // fraction >2000m
  sacScore: number       // 0-10 → 0-1
  poiDanger: number      // normalised danger count
  distKm: number         // normalised
}

const FEATURE_KEYS: (keyof TrainingFeatures)[] = [
  "effortIndex", "slopeMax", "slopeAvg", "pctSteep", "surfaceScore",
  "maxAlt", "pctHighAlt", "sacScore", "poiDanger", "distKm",
]

// Normalisation ranges (same spirit as vector.ts)
const RANGES: Record<keyof TrainingFeatures, [number, number]> = {
  effortIndex: [0, 3000],
  slopeMax:    [0, 70],
  slopeAvg:    [0, 30],
  pctSteep:    [0, 1],
  surfaceScore:[0, 10],
  maxAlt:      [0, 3500],
  pctHighAlt:  [0, 1],
  sacScore:    [0, 10],
  poiDanger:   [0, 20],
  distKm:      [0, 50],
}

function normalise(f: TrainingFeatures): number[] {
  return FEATURE_KEYS.map(k => {
    const [min, max] = RANGES[k]
    return Math.max(0, Math.min(1, (f[k] - min) / (max - min)))
  })
}

export interface LearnedModel {
  weights: number[]    // one per feature
  bias: number
  trainedOn: number    // number of samples
  meanError: number    // final mean absolute error (0-10 scale)
  features: string[]   // feature key order
}

// Hand-tuned starting weights (our prior). The model starts here and
// gradient descent nudges them toward the data.
const PRIOR_WEIGHTS: number[] = [
  0.30,  // effortIndex   — effort dominates
  0.16,  // slopeMax
  0.10,  // slopeAvg
  0.10,  // pctSteep
  0.08,  // surfaceScore
  0.06,  // maxAlt
  0.05,  // pctHighAlt
  0.08,  // sacScore
  0.04,  // poiDanger
  0.03,  // distKm
]
const PRIOR_BIAS = 0.5

// ─── Train via gradient descent ───────────────────────────────────────────────
// samples: array of { features, targetScore (0-10) }
// Returns learned weights. Uses L2 regularisation toward the prior so it
// doesn't overfit on small datasets.
export function trainModel(
  samples: { features: TrainingFeatures; targetScore: number }[],
  opts: { epochs?: number; lr?: number; regToPrior?: number } = {}
): LearnedModel {
  const epochs = opts.epochs ?? 800
  const lr = opts.lr ?? 0.05
  const regToPrior = opts.regToPrior ?? 0.02

  const X = samples.map(s => normalise(s.features))
  const y = samples.map(s => s.targetScore / 10) // scale to 0-1
  const n = samples.length
  const dim = FEATURE_KEYS.length

  // Init from prior
  let weights = [...PRIOR_WEIGHTS]
  let bias = PRIOR_BIAS

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(dim).fill(0)
    let gradB = 0

    for (let i = 0; i < n; i++) {
      // Prediction = sigmoid-free linear, clamped later
      let pred = bias
      for (let d = 0; d < dim; d++) pred += weights[d] * X[i][d]
      const err = pred - y[i]
      for (let d = 0; d < dim; d++) gradW[d] += err * X[i][d]
      gradB += err
    }

    // Average + regularisation pulling toward prior
    for (let d = 0; d < dim; d++) {
      gradW[d] = gradW[d] / n + regToPrior * (weights[d] - PRIOR_WEIGHTS[d])
      weights[d] -= lr * gradW[d]
    }
    gradB = gradB / n + regToPrior * (bias - PRIOR_BIAS)
    bias -= lr * gradB
  }

  // Compute mean absolute error on the 0-10 scale
  let errSum = 0
  for (let i = 0; i < n; i++) {
    let pred = bias
    for (let d = 0; d < dim; d++) pred += weights[d] * X[i][d]
    errSum += Math.abs(pred * 10 - samples[i].targetScore)
  }

  return {
    weights, bias,
    trainedOn: n,
    meanError: Math.round((errSum / n) * 100) / 100,
    features: FEATURE_KEYS as string[],
  }
}

// ─── Predict with a learned model ─────────────────────────────────────────────
export function predictScore(model: LearnedModel, f: TrainingFeatures): number {
  const x = normalise(f)
  let pred = model.bias
  for (let d = 0; d < model.weights.length; d++) pred += model.weights[d] * x[d]
  return Math.max(0.5, Math.min(10, pred * 10))
}

// ─── Blend learned prediction with formula score ──────────────────────────────
// Confidence grows with sample count. Below 10 samples we trust the formula;
// by 60+ samples we mostly trust the learned model.
export function blendedScore(
  formulaScore: number,
  learnedScore: number,
  sampleCount: number
): number {
  // Confidence curve: 0 at 0 samples, 0.5 at ~30, ~0.85 at 60+
  const confidence = Math.min(0.85, 1 - Math.exp(-sampleCount / 30))
  return Math.round((formulaScore * (1 - confidence) + learnedScore * confidence) * 10) / 10
}

export { FEATURE_KEYS, PRIOR_WEIGHTS }
