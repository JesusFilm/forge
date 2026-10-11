const HEX_DIGEST = /^[a-f0-9]{64}$/
const HOUR_MS = 3_600_000
const LAUNCH_CAPACITY_MAX_AGE_MS = 30 * 60_000

export type PrecomputedLiveFacts = {
  now: Date
  policy: {
    authority: string
    digest: string
    baselineHumanVisitCtr: number
    maximumEndToEndLossRate: number | null
  } | null
  baseline: {
    authority: string
    isFinal: boolean
    reportDigest: string
    eligibleVisits: number
    visitCtr: number | null
    startsAt: string
    endsAt: string
  } | null
  web: {
    status: string
    startHour: string
    endHourExclusive: string
    requestedHours: number
    coveredHours: number
    missingHours: string[]
    imbalancedHours: string[]
    qualifiedRequestAttempts: number
    clickUnavailable: number
    verificationUnavailable: number
  } | null
  generation: {
    status: string
    protocolVersion: number
    gaCaptureSealed?: boolean
    modelId: string
    inputMode: string
    sourceSetDigest: string
    historicalQualificationDigest: string | null
    expectedSourceCount: number
    sourceCount: number
    catalogSourceCount: number | null
    catalogSourceSetDigest: string | null
    modelCallCount: number
    unknownModelCostCount: number
  } | null
  capacity: {
    status: string
    receiptDigest: string
    measuredAt: string
    availableAfterReserveBytes: number
    projectedBytes: number
  } | null
  hourAlignedCohort: boolean
}

/** A runtime gate, not a declaration of approved numeric values. Every fact
 * comes from a separately authenticated and persisted source. */
export function evaluatePrecomputedLiveFacts(
  facts: PrecomputedLiveFacts,
): string[] {
  const reasons: string[] = []
  if (
    facts.policy?.authority !== "prelaunch_agreed" ||
    !HEX_DIGEST.test(facts.policy.digest)
  )
    reasons.push("numeric_policy_not_agreed")
  if (
    facts.policy?.maximumEndToEndLossRate == null ||
    !Number.isFinite(facts.policy.maximumEndToEndLossRate) ||
    facts.policy.maximumEndToEndLossRate < 0 ||
    facts.policy.maximumEndToEndLossRate > 1
  )
    reasons.push("end_to_end_loss_limit_not_agreed")
  const baseline = facts.baseline
  if (
    baseline?.authority !== "live_verified" ||
    baseline.isFinal !== true ||
    !HEX_DIGEST.test(baseline.reportDigest) ||
    !Number.isSafeInteger(baseline.eligibleVisits) ||
    baseline.eligibleVisits <= 0 ||
    baseline.visitCtr == null ||
    baseline.visitCtr < 0 ||
    baseline.visitCtr > 1 ||
    !Number.isFinite(Date.parse(baseline.startsAt)) ||
    !Number.isFinite(Date.parse(baseline.endsAt)) ||
    Date.parse(baseline.endsAt) - Date.parse(baseline.startsAt) !==
      7 * 24 * HOUR_MS
  )
    reasons.push("verified_incumbent_baseline_missing")
  if (
    facts.policy &&
    baseline?.visitCtr != null &&
    Math.abs(facts.policy.baselineHumanVisitCtr - baseline.visitCtr) > 1e-6
  )
    reasons.push("numeric_baseline_does_not_match_verified_observation")
  if (
    facts.web?.status !== "complete" ||
    !baseline ||
    facts.web.startHour !== baseline.startsAt ||
    facts.web.endHourExclusive !== baseline.endsAt ||
    facts.web.requestedHours !== 168 ||
    facts.web.coveredHours !== 168 ||
    facts.web.missingHours.length > 0 ||
    facts.web.imbalancedHours.length > 0
  )
    reasons.push("web_request_health_incomplete")
  if (
    baseline &&
    facts.web &&
    facts.web.qualifiedRequestAttempts < baseline.eligibleVisits
  )
    reasons.push("qualified_request_count_below_durable_visits")
  if (facts.web && facts.web.clickUnavailable > 0)
    reasons.push("click_tracking_unavailable")
  if (facts.web && facts.web.verificationUnavailable > 0)
    reasons.push("human_verification_unavailable")
  const generation = facts.generation
  if (
    generation?.status !== "complete" ||
    (generation.protocolVersion !== 2 &&
      !(
        [3, 4].includes(generation.protocolVersion) &&
        generation.gaCaptureSealed
      )) ||
    generation.modelId !== "gpt-6-astra" ||
    generation.inputMode !== "historical_analytics" ||
    !HEX_DIGEST.test(generation.sourceSetDigest) ||
    !HEX_DIGEST.test(generation.historicalQualificationDigest ?? "") ||
    generation.expectedSourceCount <= 0 ||
    generation.sourceCount !== generation.expectedSourceCount ||
    generation.catalogSourceCount !== generation.expectedSourceCount ||
    generation.catalogSourceSetDigest !== generation.sourceSetDigest ||
    generation.modelCallCount <= 0
  )
    reasons.push("actual_catalog_build_unverified")
  if (generation && generation.unknownModelCostCount > 0)
    reasons.push(
      generation.protocolVersion === 4
        ? "model_usage_unknown"
        : "model_cost_unknown",
    )
  const capacity = facts.capacity
  if (capacity?.status !== "passed" || !HEX_DIGEST.test(capacity.receiptDigest))
    reasons.push("launch_capacity_unavailable")
  const measuredAt = Date.parse(capacity?.measuredAt ?? "")
  const age = facts.now.getTime() - measuredAt
  if (!Number.isFinite(age) || age < 0 || age > LAUNCH_CAPACITY_MAX_AGE_MS)
    reasons.push("launch_capacity_stale")
  if (
    capacity &&
    (!Number.isSafeInteger(capacity.availableAfterReserveBytes) ||
      !Number.isSafeInteger(capacity.projectedBytes) ||
      capacity.availableAfterReserveBytes < capacity.projectedBytes)
  )
    reasons.push("launch_capacity_insufficient")
  if (!facts.hourAlignedCohort) reasons.push("cohort_window_not_hour_aligned")
  return reasons
}

export function isUtcHour(value: Date): boolean {
  return Number.isFinite(value.getTime()) && value.getTime() % HOUR_MS === 0
}
