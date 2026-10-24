export type MatchStrength = "high" | "medium" | "low"

export type PublicMatchCandidate = {
  coreId: string
  videoVariantId: string
  confidence: number
  matchStrength: MatchStrength
}

export function clampConfidence(score: number): number {
  if (Number.isNaN(score)) return 0
  return Math.max(0, Math.min(1, score))
}

export function classifyMatchStrength(confidence: number): MatchStrength {
  const normalized = clampConfidence(confidence)

  if (normalized >= 0.85) return "high"
  if (normalized >= 0.6) return "medium"
  return "low"
}

export function roundConfidence(score: number): number {
  return Math.round(clampConfidence(score) * 1_000) / 1_000
}
