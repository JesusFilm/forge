export const RECOMMENDATION_EXPERIMENT_POLICY_VERSION =
  "recommendation-experiment-aa-v1" as const

export type ExperimentCounts = Readonly<{
  controlAssigned: number
  challengerAssigned: number
  controlExposed: number
  challengerExposed: number
  controlSelections: number
  challengerSelections: number
  controlQualified: number
  challengerQualified: number
  controlMission: number
  challengerMission: number
  controlPlaybackErrors: number
  challengerPlaybackErrors: number
  contamination: number
  conflictingOutcomes: number
}>

export type ExperimentWatermarks = Readonly<{
  assignment: Date | null
  exposure: Date | null
  outcome: Date | null
  mission: Date | null
  eligibility: Date | null
}>

export type ExperimentPolicy = Readonly<{
  minimumAssignmentsPerArm: number
  srmChiSquareThreshold: number
  maximumPlaybackErrorRateDelta: number
}>

const DEFAULT_POLICY: ExperimentPolicy = {
  minimumAssignmentsPerArm: 50,
  // p < 0.001 for one degree of freedom.
  srmChiSquareThreshold: 10.828,
  maximumPlaybackErrorRateDelta: 0.05,
}

type ArmMetrics = Readonly<{
  denominator: number
  exposed: number
  selectionRate: number
  qualifiedRate: number
  missionRate: number
  playbackErrorRate: number
}>

export type ExperimentEvidenceDecision = Readonly<{
  state: "pass" | "fail" | "inconclusive" | "data_unhealthy"
  reasonCodes: string[]
  sampleRatio: Readonly<{
    expectedChallengerProbability: number
    observedChallengerProbability: number
    chiSquare: number
    healthy: boolean
  }>
  intentToTreat: Readonly<{
    primary: true
    control: ArmMetrics
    challenger: ArmMetrics
  }>
  exposedOnly: Readonly<{
    primary: false
    control: ArmMetrics
    challenger: ArmMetrics
  }>
  uncertainty: Readonly<{
    method: "wilson-score-v1"
    confidenceLevel: 0.95
    qualifiedRateDelta: Readonly<{
      estimate: number
      lower: number
      upper: number
    }>
  }>
  guardrails: Readonly<{
    playbackErrorRateDelta: number
    maximumPlaybackErrorRateDelta: number
    passed: boolean
  }>
}>

export function evaluateExperimentEvidence(input: {
  counts: ExperimentCounts
  expectedChallengerProbability: number
  watermarks: ExperimentWatermarks
  windowEnd: Date
  inputCapturedAt?: Date
  policy?: Partial<ExperimentPolicy>
}): ExperimentEvidenceDecision {
  const policy = { ...DEFAULT_POLICY, ...input.policy }
  const capturedAt = input.inputCapturedAt ?? new Date("9999-12-31T00:00:00Z")
  const totalAssigned =
    input.counts.controlAssigned + input.counts.challengerAssigned
  const observedChallengerProbability = ratio(
    input.counts.challengerAssigned,
    totalAssigned,
  )
  const chiSquare = sampleRatioChiSquare(
    input.counts.controlAssigned,
    input.counts.challengerAssigned,
    input.expectedChallengerProbability,
  )
  const sampleHealthy = chiSquare <= policy.srmChiSquareThreshold
  const ittControl = armMetrics(input.counts, "control", false)
  const ittChallenger = armMetrics(input.counts, "challenger", false)
  const exposedControl = armMetrics(input.counts, "control", true)
  const exposedChallenger = armMetrics(input.counts, "challenger", true)
  const qualifiedDifference = differenceInterval(
    input.counts.challengerQualified,
    input.counts.challengerAssigned,
    input.counts.controlQualified,
    input.counts.controlAssigned,
  )
  const playbackErrorRateDelta =
    ittChallenger.playbackErrorRate - ittControl.playbackErrorRate
  const guardrailPassed =
    playbackErrorRateDelta <= policy.maximumPlaybackErrorRateDelta
  const reasonCodes: string[] = []

  if (capturedAt < input.windowEnd) reasonCodes.push("outcome_window_open")
  for (const [name, watermark] of Object.entries(input.watermarks)) {
    if (watermark == null || watermark < input.windowEnd) {
      reasonCodes.push(`${name}_watermark_missing`)
    }
  }
  if (!sampleHealthy) reasonCodes.push("sample_ratio_mismatch")
  if (input.counts.contamination > 0) reasonCodes.push("exposure_contamination")
  if (input.counts.conflictingOutcomes > 0)
    reasonCodes.push("conflicting_outcomes")

  let state: ExperimentEvidenceDecision["state"]
  if (reasonCodes.length > 0) {
    state = "data_unhealthy"
  } else if (!guardrailPassed) {
    state = "fail"
    reasonCodes.push("playback_error_guardrail_failed")
  } else if (
    input.counts.controlAssigned < policy.minimumAssignmentsPerArm ||
    input.counts.challengerAssigned < policy.minimumAssignmentsPerArm
  ) {
    state = "inconclusive"
    reasonCodes.push("minimum_assignment_count_not_met")
  } else {
    state = "pass"
    reasonCodes.push("aa_equivalence_guardrails_passed")
  }

  return {
    state,
    reasonCodes,
    sampleRatio: {
      expectedChallengerProbability: input.expectedChallengerProbability,
      observedChallengerProbability,
      chiSquare,
      healthy: sampleHealthy,
    },
    intentToTreat: {
      primary: true,
      control: ittControl,
      challenger: ittChallenger,
    },
    exposedOnly: {
      primary: false,
      control: exposedControl,
      challenger: exposedChallenger,
    },
    uncertainty: {
      method: "wilson-score-v1",
      confidenceLevel: 0.95,
      qualifiedRateDelta: qualifiedDifference,
    },
    guardrails: {
      playbackErrorRateDelta,
      maximumPlaybackErrorRateDelta: policy.maximumPlaybackErrorRateDelta,
      passed: guardrailPassed,
    },
  }
}

function armMetrics(
  counts: ExperimentCounts,
  arm: "control" | "challenger",
  exposedOnly: boolean,
): ArmMetrics {
  const prefix = arm === "control" ? "control" : "challenger"
  const assigned = counts[`${prefix}Assigned`]
  const exposed = counts[`${prefix}Exposed`]
  const denominator = exposedOnly ? exposed : assigned
  return {
    denominator,
    exposed,
    selectionRate: ratio(counts[`${prefix}Selections`], denominator),
    qualifiedRate: ratio(counts[`${prefix}Qualified`], denominator),
    missionRate: ratio(counts[`${prefix}Mission`], denominator),
    playbackErrorRate: ratio(counts[`${prefix}PlaybackErrors`], denominator),
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function sampleRatioChiSquare(
  control: number,
  challenger: number,
  challengerProbability: number,
): number {
  const total = control + challenger
  if (total === 0) return 0
  const expectedChallenger = total * challengerProbability
  const expectedControl = total - expectedChallenger
  if (expectedChallenger <= 0 || expectedControl <= 0)
    return Number.POSITIVE_INFINITY
  return (
    (challenger - expectedChallenger) ** 2 / expectedChallenger +
    (control - expectedControl) ** 2 / expectedControl
  )
}

function wilson(successes: number, count: number): [number, number] {
  if (count === 0) return [0, 1]
  const z = 1.959963984540054
  const p = successes / count
  const denominator = 1 + (z * z) / count
  const center = (p + (z * z) / (2 * count)) / denominator
  const spread =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / count + (z * z) / (4 * count * count))
  return [Math.max(0, center - spread), Math.min(1, center + spread)]
}

function differenceInterval(
  challengerSuccesses: number,
  challengerCount: number,
  controlSuccesses: number,
  controlCount: number,
) {
  const [challengerLower, challengerUpper] = wilson(
    challengerSuccesses,
    challengerCount,
  )
  const [controlLower, controlUpper] = wilson(controlSuccesses, controlCount)
  return {
    estimate:
      ratio(challengerSuccesses, challengerCount) -
      ratio(controlSuccesses, controlCount),
    lower: challengerLower - controlUpper,
    upper: challengerUpper - controlLower,
  }
}
