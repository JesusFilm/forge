import { createHash } from "node:crypto"
import { z } from "zod"
import {
  composeMmrSlate,
  MMR_SLATE_POLICY_VERSION,
  MMR_WEIGHTS,
  type MmrSlateItemEvidence,
} from "./mmr"

export const COMPOSITION_EVIDENCE_VERSION = "mmr-structural-observations-v1"
export const COMPOSITION_PROTOCOL_VERSION = "mmr-controlled-study-readiness-v1"
export const MMR_CONFIG = {
  composerVersion: MMR_SLATE_POLICY_VERSION,
  weights: MMR_WEIGHTS,
  candidateLimit: 64,
  positionLimit: 6,
  supportedInputs: ["source", "interest", "theme", "recent_history"],
  excludedInputs: ["editorial_adapter", "series", "speaker"],
  history: "request_window_reconstruction",
  missingInputDisposition: "deterministic_fallback",
} as const

// No defaults: operators freeze bounded operational thresholds before observing
// this sample. Structural invariants and policy weights cannot be waived.
export const CompositionThresholds = z
  .object({
    minimumRuns: z.number().int().min(1).max(500),
    maxFallbackRate: z.number().min(0).max(1),
    maxMissingInputRate: z.number().min(0).max(1),
    maxLatencyMs: z.number().positive().max(200),
    minimumFillRate: z.number().min(0).max(1),
  })
  .strict()
export type CompositionThresholds = z.infer<typeof CompositionThresholds>

export const CompositionMetrics = z
  .object({
    candidateCount: z.number().int().min(0).max(64),
    itemCount: z.number().int().min(0).max(6),
    fillRate: z.number().min(0).max(1),
    latencyMs: z.number().min(0).max(60_000),
    missingSource: z.boolean(),
    missingInterest: z.boolean(),
    missingTheme: z.boolean(),
    missingHistory: z.boolean(),
    fallback: z.boolean(),
    structuralFailure: z.boolean(),
  })
  .strict()
export type CompositionMetrics = z.infer<typeof CompositionMetrics>
export type CompositionObservation = Readonly<{
  items: readonly MmrSlateItemEvidence[]
  inputDigest: string
  outputDigest: string
  metrics: CompositionMetrics
}>

export function compositionDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return value
}

export function observeComposition(
  input: Parameters<typeof composeMmrSlate>[0] & { historyAvailable: boolean },
  latencyMs: number,
): CompositionObservation {
  const result = composeMmrSlate(input)
  const metrics: CompositionMetrics = {
    candidateCount: Math.min(64, input.ordered.length),
    itemCount: result.composed.length,
    fillRate: result.composed.length / Math.max(1, Math.min(6, input.limit)),
    latencyMs: Math.min(60_000, Math.max(0, latencyMs)),
    ...compositionInputAvailability(result, input.historyAvailable),
    fallback: result.fallbackReason !== null,
    structuralFailure:
      result.composed.some(
        (candidate, index) => candidate.composedPosition !== index,
      ) ||
      result.fallbackReason === "editorial_constraints_unavailable" ||
      result.fallbackReason === "policy_unavailable",
  }
  const actual = hasMissingInput(metrics)
    ? composeMmrSlate({
        ...input,
        policyVersion: "deterministic-composition-fallback",
      })
    : result
  return {
    items: actual.evidence,
    inputDigest: compositionDigest({
      ...input,
      ordered: input.ordered.slice(0, 64),
      config: MMR_CONFIG,
    }),
    outputDigest: compositionDigest(actual.evidence),
    metrics: {
      ...metrics,
      fallback: metrics.fallback || hasMissingInput(metrics),
    },
  }
}

export function compositionInputAvailability(
  result: ReturnType<typeof composeMmrSlate>,
  historyAvailable: boolean,
) {
  return {
    missingSource: result.coverage.availableSources === 0,
    missingInterest: result.coverage.availableInterests === 0,
    missingTheme:
      result.composed.length === 0 ||
      result.coverage.itemsWithThemes !== result.composed.length,
    missingHistory: !historyAvailable,
  }
}

export function hasMissingInput(
  metrics: Pick<
    CompositionMetrics,
    "missingSource" | "missingInterest" | "missingTheme" | "missingHistory"
  >,
): boolean {
  return (
    metrics.missingSource ||
    metrics.missingInterest ||
    metrics.missingTheme ||
    metrics.missingHistory
  )
}

export function summarizeComposition(
  observations: readonly CompositionMetrics[],
) {
  const count = observations.length
  const rate = (predicate: (value: CompositionMetrics) => boolean) =>
    count === 0 ? 0 : observations.filter(predicate).length / count
  const latency = observations.map((row) => row.latencyMs).sort((a, b) => a - b)
  return {
    count,
    usableCount: observations.filter((row) => !hasMissingInput(row)).length,
    structuralFailures: observations.filter((row) => row.structuralFailure)
      .length,
    fillRate:
      count === 0
        ? 0
        : observations.reduce((sum, row) => sum + row.fillRate, 0) / count,
    fallbackRate: rate((row) => row.fallback),
    missingInputRate: rate(hasMissingInput),
    missingSourceRate: rate((row) => row.missingSource),
    missingInterestRate: rate((row) => row.missingInterest),
    missingThemeRate: rate((row) => row.missingTheme),
    missingHistoryRate: rate((row) => row.missingHistory),
    latencyP95Ms: latency[Math.max(0, Math.ceil(count * 0.95) - 1)] ?? 0,
  }
}

export function decideComposition(
  summary: ReturnType<typeof summarizeComposition>,
  thresholds: CompositionThresholds,
) {
  if (summary.count < thresholds.minimumRuns)
    return {
      decision: "inconclusive",
      reasonCode: "insufficient_current_observations",
    } as const
  if (summary.structuralFailures > 0)
    return {
      decision: "retire",
      reasonCode: "structural_invariant_failed",
    } as const
  if (
    summary.usableCount < thresholds.minimumRuns ||
    summary.missingInputRate > thresholds.maxMissingInputRate
  )
    return {
      decision: "inconclusive",
      reasonCode: "required_inputs_unavailable",
    } as const
  if (
    summary.fallbackRate > thresholds.maxFallbackRate ||
    summary.fillRate < thresholds.minimumFillRate ||
    summary.latencyP95Ms > thresholds.maxLatencyMs
  )
    return {
      decision: "revise",
      reasonCode: "operational_threshold_failed",
    } as const
  return {
    decision: "qualify_for_controlled_study",
    reasonCode: "structural_and_operational_thresholds_met",
  } as const
}
