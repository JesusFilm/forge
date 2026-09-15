import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"

export const RECOMMENDATION_CONTROL_READINESS_POLICY = Object.freeze({
  version: "semantic-control-readiness-v1",
  outcomePolicyVersion: "watch-semantic-control-outcomes-v1",
  integrityPolicyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
  classifierVersion: "active-watch-proxy-v1",
  evidenceWindowDays: 7,
  minimumIssuedRequests: 100,
  minimumImpressions: 100,
  minimumMatureOutcomes: 50,
  minimumDeliveryRate: 0.95,
  maximumFallbackRate: 0.05,
  maximumRetrievalP95Ms: 1_500,
  minimumQualifiedOutcomeRate: 0.1,
  confidenceLevel: 0.95,
  uncertaintyMethod: "wilson-score-v1",
  missionOffsetPurposes: ["find_to_share", "course_build"],
})

export type SemanticControlReadinessState =
  | "ready"
  | "not-ready"
  | "inconclusive"
  | "data-unhealthy"

export type SemanticControlDimensionState =
  | "pass"
  | "fail"
  | "inconclusive"
  | "unhealthy"

export type SemanticControlEvidence = Readonly<{
  issuedRequests: number
  servedRequests: number
  fallbackRequests: number
  servedItems: number
  impressions: number
  selections: number
  selectionWithoutImpression: number
  matureOutcomes: number
  qualifiedViewOutcomes: number
  missionQualifiedOutcomes: number
  missionOffsetOutcomes: number
  rejectedMissionOffsets: number
  machineExcluded: number
  integrityExcluded: number
  classifierLag: number
  writeFailures: number
  conflicts: number
  lateEvidence: number
  retrievalP95Ms: number | null
}>

type DimensionDecision = Readonly<{
  state: SemanticControlDimensionState
  reasonCodes: string[]
}>

type WilsonInterval = Readonly<{
  lower: number
  upper: number
}>

export type SemanticControlReadinessDecision = Readonly<{
  state: SemanticControlReadinessState
  dimensions: Readonly<{
    delivery: DimensionDecision
    attribution: DimensionDecision
    maturity: DimensionDecision
    operational: DimensionDecision
    mission: DimensionDecision
    guardrail: DimensionDecision
  }>
  rates: Readonly<{
    delivery: number | null
    fallback: number | null
    ctr: number | null
    qualifiedOutcome: number | null
  }>
  uncertainty: Readonly<{
    confidenceLevel: 0.95
    method: "wilson-score-v1"
    ctr: WilsonInterval | null
    qualifiedOutcome: WilsonInterval | null
  }>
  reasonCodes: string[]
  explanation: string
}>

export function evaluateSemanticControlReadiness(
  evidence: SemanticControlEvidence,
): SemanticControlReadinessDecision {
  assertBoundedEvidence(evidence)

  const rates = {
    delivery: ratio(evidence.servedRequests, evidence.issuedRequests),
    fallback: ratio(evidence.fallbackRequests, evidence.issuedRequests),
    ctr: ratio(evidence.selections, evidence.impressions),
    qualifiedOutcome: ratio(
      evidence.qualifiedViewOutcomes + evidence.missionOffsetOutcomes,
      evidence.matureOutcomes,
    ),
  }
  const uncertainty = {
    confidenceLevel: 0.95 as const,
    method: "wilson-score-v1" as const,
    ctr: wilson95(evidence.selections, evidence.impressions),
    qualifiedOutcome: wilson95(
      evidence.qualifiedViewOutcomes + evidence.missionOffsetOutcomes,
      evidence.matureOutcomes,
    ),
  }

  const dimensions = {
    delivery: deliveryDecision(evidence, rates),
    attribution: attributionDecision(evidence),
    maturity: maturityDecision(evidence),
    operational: operationalDecision(evidence),
    mission: missionDecision(evidence),
    guardrail: guardrailDecision(evidence, uncertainty.qualifiedOutcome),
  }
  const state = overallState(Object.values(dimensions))
  const reasonCodes = orderedUnique(
    Object.values(dimensions).flatMap((dimension) => dimension.reasonCodes),
  )

  return {
    state,
    dimensions,
    rates,
    uncertainty,
    reasonCodes,
    explanation: explanationFor(state, reasonCodes),
  }
}

function deliveryDecision(
  evidence: SemanticControlEvidence,
  rates: {
    delivery: number | null
    fallback: number | null
  },
): DimensionDecision {
  if (
    evidence.issuedRequests <
    RECOMMENDATION_CONTROL_READINESS_POLICY.minimumIssuedRequests
  ) {
    return dimension("inconclusive", "minimum_request_traffic_not_met")
  }
  if (
    (rates.delivery ?? 0) <
      RECOMMENDATION_CONTROL_READINESS_POLICY.minimumDeliveryRate ||
    (rates.fallback ?? 1) >
      RECOMMENDATION_CONTROL_READINESS_POLICY.maximumFallbackRate
  ) {
    return dimension("fail", "delivery_reliability_floor_missed")
  }
  return dimension("pass", "delivery_reliability_met")
}

function attributionDecision(
  evidence: SemanticControlEvidence,
): DimensionDecision {
  const impossibleFunnel =
    evidence.impressions > evidence.servedItems ||
    evidence.selections > evidence.impressions
  if (evidence.selectionWithoutImpression > 0 || impossibleFunnel) {
    return dimension("unhealthy", "selection_without_eligible_impression")
  }
  if (evidence.conflicts > 0) {
    return dimension("unhealthy", "conflicting_attribution_evidence")
  }
  return dimension("pass", "attribution_reconciled")
}

function maturityDecision(
  evidence: SemanticControlEvidence,
): DimensionDecision {
  if (evidence.classifierLag > 0) {
    return dimension("unhealthy", "classifier_watermark_lag")
  }
  if (
    evidence.matureOutcomes <
    RECOMMENDATION_CONTROL_READINESS_POLICY.minimumMatureOutcomes
  ) {
    return dimension(
      "inconclusive",
      "minimum_mature_outcomes_not_met",
      ...(evidence.machineExcluded > 0 ? ["machine_evidence_excluded"] : []),
    )
  }
  return dimension(
    "pass",
    "outcome_maturity_met",
    ...(evidence.machineExcluded > 0 ? ["machine_evidence_excluded"] : []),
  )
}

function operationalDecision(
  evidence: SemanticControlEvidence,
): DimensionDecision {
  if (evidence.writeFailures > 0) {
    return dimension("unhealthy", "evidence_write_failure")
  }
  if (evidence.retrievalP95Ms == null) {
    return dimension("inconclusive", "retrieval_latency_unavailable")
  }
  if (
    evidence.retrievalP95Ms >
    RECOMMENDATION_CONTROL_READINESS_POLICY.maximumRetrievalP95Ms
  ) {
    return dimension("fail", "delivery_deadline_regressed")
  }
  return dimension(
    "pass",
    "delivery_deadline_met",
    ...(evidence.lateEvidence > 0 ? ["late_evidence_reconciled"] : []),
  )
}

function missionDecision(evidence: SemanticControlEvidence): DimensionDecision {
  const reasons = []
  if (evidence.missionOffsetOutcomes > 0) {
    reasons.push("declared_purpose_mission_offset_applied")
  } else {
    reasons.push("no_declared_purpose_mission_offset")
  }
  if (evidence.rejectedMissionOffsets > 0) {
    reasons.push("undeclared_mission_offset_excluded")
  }
  return { state: "pass", reasonCodes: reasons }
}

function guardrailDecision(
  evidence: SemanticControlEvidence,
  interval: WilsonInterval | null,
): DimensionDecision {
  if (
    evidence.matureOutcomes <
      RECOMMENDATION_CONTROL_READINESS_POLICY.minimumMatureOutcomes ||
    interval == null
  ) {
    return dimension("inconclusive", "qualified_outcome_uncertain")
  }
  const floor =
    RECOMMENDATION_CONTROL_READINESS_POLICY.minimumQualifiedOutcomeRate
  if (interval.upper < floor) {
    return dimension("fail", "qualified_outcome_floor_conclusively_missed")
  }
  if (interval.lower < floor) {
    return dimension("inconclusive", "qualified_outcome_floor_uncertain")
  }
  return dimension("pass", "qualified_outcome_guardrail_met")
}

function overallState(
  dimensions: DimensionDecision[],
): SemanticControlReadinessState {
  if (dimensions.some((dimension) => dimension.state === "unhealthy")) {
    return "data-unhealthy"
  }
  if (dimensions.some((dimension) => dimension.state === "fail")) {
    return "not-ready"
  }
  if (dimensions.some((dimension) => dimension.state === "inconclusive")) {
    return "inconclusive"
  }
  return "ready"
}

function explanationFor(
  state: SemanticControlReadinessState,
  reasonCodes: string[],
): string {
  const lead = {
    ready:
      "Semantic-only is ready to serve as a measurable control; no incremental viewer-value claim is made.",
    "not-ready":
      "Semantic-only is not ready to serve as a control under the pinned outcome policy.",
    inconclusive:
      "Readiness is inconclusive; collect more eligible human traffic or mature outcomes without widening exposure.",
    "data-unhealthy":
      "Readiness cannot be trusted until the identified instrumentation or evidence-health problem is repaired.",
  }[state]
  return `${lead} Policy ${RECOMMENDATION_CONTROL_READINESS_POLICY.version}; outcomes ${RECOMMENDATION_CONTROL_READINESS_POLICY.outcomePolicyVersion}. Reasons: ${reasonCodes.join(", ")}.`
}

function dimension(
  state: SemanticControlDimensionState,
  ...reasonCodes: string[]
): DimensionDecision {
  return { state, reasonCodes }
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return numerator / denominator
}

function wilson95(successes: number, total: number): WilsonInterval | null {
  if (total === 0) return null
  const z = 1.959963984540054
  const proportion = successes / total
  const denominator = 1 + (z * z) / total
  const center = proportion + (z * z) / (2 * total)
  const margin =
    z *
    Math.sqrt(
      (proportion * (1 - proportion)) / total + (z * z) / (4 * total * total),
    )
  return {
    lower: roundProbability((center - margin) / denominator),
    upper: roundProbability((center + margin) / denominator),
  }
}

function roundProbability(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000
}

function orderedUnique(values: string[]): string[] {
  return [...new Set(values)]
}

function assertBoundedEvidence(evidence: SemanticControlEvidence): void {
  for (const [key, value] of Object.entries(evidence)) {
    if (key === "retrievalP95Ms" && value == null) continue
    if (
      key === "retrievalP95Ms" &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
    ) {
      continue
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      !Number.isSafeInteger(value)
    ) {
      throw new TypeError(`Invalid semantic control evidence: ${key}`)
    }
  }
}
