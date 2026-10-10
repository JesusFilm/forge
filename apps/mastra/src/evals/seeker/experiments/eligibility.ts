import { z } from "zod"

import {
  EligibilityRecordSchema,
  HypothesisCriterionSchema,
  type EligibilityRecord,
} from "./types"

type Measurements = {
  gateReport: unknown
  score: unknown
  comparison?: unknown
}

type CriterionEvaluator = (
  parameters: unknown,
  measurements: Measurements,
) => "passed" | "failed" | "unavailable" | null

const MinimumRunScoreParameters = z
  .object({ minimum: z.number().finite() })
  .strict()
const MinimumScoreDeltaParameters = z
  .object({ minimumDelta: z.number().finite() })
  .strict()

const registry: Record<string, CriterionEvaluator> = {
  "minimum-run-score@1": (parameters, { score }) => {
    const parsed = MinimumRunScoreParameters.safeParse(parameters)
    if (!parsed.success) return "unavailable"
    const runScore = (score as { runScore?: unknown } | null)?.runScore
    if (typeof runScore !== "number" || !Number.isFinite(runScore))
      return "unavailable"
    return runScore >= parsed.data.minimum ? "passed" : "failed"
  },
  "minimum-score-delta@1": (parameters, { gateReport }) => {
    const parsed = MinimumScoreDeltaParameters.safeParse(parameters)
    if (!parsed.success) return "unavailable"
    const delta = (gateReport as { scoreDelta?: { delta?: unknown } } | null)
      ?.scoreDelta?.delta
    if (typeof delta !== "number" || !Number.isFinite(delta))
      return "unavailable"
    return delta >= parsed.data.minimumDelta ? "passed" : "failed"
  },
}

export type EvaluateEligibilityInput = Measurements & {
  criterion: unknown
  evidence: string[]
}

/** Pure, fail-closed composition of persisted gate and criterion evidence. */
export function evaluateEligibility(
  input: EvaluateEligibilityInput,
): EligibilityRecord {
  const gate = (input.gateReport as { verdict?: unknown } | null)?.verdict
  const gateOutcome =
    gate === "green" || gate === "red" || gate === "refused" ? gate : "refused"
  const parsedCriterion = HypothesisCriterionSchema.safeParse(input.criterion)
  let criterionOutcome: "passed" | "failed" | "unknown" | "unavailable" =
    "unknown"
  let criterionId = "unknown"
  let criterionVersion = "unknown"
  if (parsedCriterion.success) {
    criterionId = parsedCriterion.data.id
    criterionVersion = parsedCriterion.data.version
    const evaluator = registry[`${criterionId}@${criterionVersion}`]
    if (evaluator != null) {
      criterionOutcome =
        evaluator(parsedCriterion.data.parameters, input) ?? "unknown"
    }
  }

  return EligibilityRecordSchema.parse({
    gate: { outcome: gateOutcome },
    criterion: {
      id: criterionId,
      version: criterionVersion,
      outcome: criterionOutcome,
    },
    eligible: gateOutcome === "green" && criterionOutcome === "passed",
    evidence: input.evidence,
  })
}
