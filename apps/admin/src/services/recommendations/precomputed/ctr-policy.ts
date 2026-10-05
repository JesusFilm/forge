/** One fixed final look. Visits are the ratio denominator; independently
 * randomized browser units provide the uncertainty, including repeat visits.
 * The six arm moments are sufficient for the cluster delta variance in Deng,
 * Lu & Qin (2021), Theorem 1.3: sum((c_i - p*n_i)^2) / N^2. */
export type CtrPolicySettings = {
  baselineHumanVisitCtr: number
  /** Planning effect size, not the observed effect required for a decision. */
  minimumDetectableAbsoluteUplift: number
  minimumPracticalAbsoluteUplift: number
  plannedPower: number
  minimumEligibleVisitsPerArm: number
  minimumIndependentBrowsersPerArm: number
  minimumDurationHours: number
  lateEventCutoffHours: number
  maximumActualFallbackRate: number
  maximumUnlinkedDeliveryRate: number
}

export type CtrArmMoments = {
  browsers: number
  eligibleVisits: number
  clickedVisits: number
  sumVisitsSquared: number
  sumClicksSquared: number
  sumVisitsClicks: number
  actualFallbackVisits: number
  unlinkedDeliveredVisits: number
}

export type CtrEvaluationEvidence = {
  startsAt: Date
  endsAt: Date
  asOf: Date
  byArm: { control: CtrArmMoments; challenger: CtrArmMoments }
  botEligibility: "verified" | "unverified"
  trackingLoss: "verified" | "unobservable"
}

export type CtrEvaluation = {
  outcome: "control" | "challenger" | "inconclusive"
  reasons: string[]
  controlCtr: number | null
  challengerCtr: number | null
  difference: number | null
  standardError: number | null
  lowerBound: number | null
  upperBound: number | null
  criticalValue: number | null
  conservativeDegreesOfFreedom: number | null
  effectiveBrowsers: { control: number | null; challenger: number | null }
}

export function validateCtrPolicySettings(value: CtrPolicySettings): void {
  const probability = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1
  if (
    !probability(value.baselineHumanVisitCtr) ||
    !probability(value.minimumDetectableAbsoluteUplift) ||
    !probability(value.minimumPracticalAbsoluteUplift) ||
    !Number.isFinite(value.plannedPower) ||
    value.plannedPower <= 0 ||
    value.plannedPower >= 1 ||
    !probability(value.maximumActualFallbackRate) ||
    !probability(value.maximumUnlinkedDeliveryRate) ||
    !Number.isSafeInteger(value.minimumEligibleVisitsPerArm) ||
    value.minimumEligibleVisitsPerArm < 1 ||
    !Number.isSafeInteger(value.minimumIndependentBrowsersPerArm) ||
    value.minimumIndependentBrowsersPerArm < 3 ||
    !Number.isSafeInteger(value.minimumDurationHours) ||
    value.minimumDurationHours < 1 ||
    !Number.isSafeInteger(value.lateEventCutoffHours) ||
    value.lateEventCutoffHours < 0 ||
    value.lateEventCutoffHours > 672
  )
    throw new Error("invalid_ctr_stopping_policy")
}

function armUncertainty(arm: CtrArmMoments) {
  if (arm.eligibleVisits <= 0 || arm.browsers < 2)
    return { ctr: null, variance: null, effective: null, coherent: true }
  const {
    eligibleVisits: n,
    clickedVisits: c,
    browsers: m,
    sumVisitsSquared: qnn,
    sumClicksSquared: qcc,
    sumVisitsClicks: qnc,
  } = arm
  const coherent =
    [n, c, m, qnn, qcc, qnc].every(Number.isSafeInteger) &&
    c >= 0 &&
    c <= n &&
    m >= 1 &&
    m <= n &&
    qnn >= n &&
    qnn <= n * n &&
    qnn + 1e-9 >= (n * n) / m &&
    qcc >= c &&
    qcc <= qnn &&
    qcc + 1e-9 >= (c * c) / m &&
    qnc >= c &&
    qnc <= qnn &&
    qnc * qnc <= qnn * qcc + 1e-9 &&
    (m === n ? qnn === n && qcc === c && qnc === c : qnn !== n)
  if (!coherent)
    return { ctr: null, variance: null, effective: null, coherent: false }
  const ctr = arm.clickedVisits / arm.eligibleVisits
  const effective =
    (arm.eligibleVisits * arm.eligibleVisits) / arm.sumVisitsSquared
  const residual =
    arm.sumClicksSquared -
    2 * ctr * arm.sumVisitsClicks +
    ctr * ctr * arm.sumVisitsSquared
  const roundingTolerance =
    1e-9 *
    Math.max(
      1,
      arm.sumClicksSquared,
      2 * ctr * arm.sumVisitsClicks,
      ctr * ctr * arm.sumVisitsSquared,
    )
  if (residual < -roundingTolerance)
    return { ctr, variance: null, effective, coherent: false }
  // The predeclared m/(m-1) small-cluster correction is only a correction,
  // never a replacement for minimum nominal and effective cluster gates.
  const variance =
    (Math.max(0, residual) / (arm.eligibleVisits * arm.eligibleVisits)) *
    (arm.browsers / (arm.browsers - 1))
  return { ctr, variance, effective, coherent: true }
}

/** Conservative 95% Student-t critical values. Floor the effective browser
 * count and use the next lower tabulated df (30 for every larger df). This
 * avoids treating a three-cluster z interval as a calibrated small-sample CI.
 * It remains an approximation; live method/sample agreement is external. */
function tCritical(degreesOfFreedom: number): number {
  if (degreesOfFreedom >= 30) return 2.042272456
  if (degreesOfFreedom >= 20) return 2.085963447
  if (degreesOfFreedom >= 10) return 2.228138852
  if (degreesOfFreedom >= 5) return 2.570581836
  if (degreesOfFreedom >= 4) return 2.776445105
  if (degreesOfFreedom >= 3) return 3.182446305
  if (degreesOfFreedom >= 2) return 4.30265273
  return 12.706204736
}

export function evaluatePrecomputedCtr(
  settings: CtrPolicySettings,
  evidence: CtrEvaluationEvidence,
): CtrEvaluation {
  validateCtrPolicySettings(settings)
  const control = armUncertainty(evidence.byArm.control)
  const challenger = armUncertainty(evidence.byArm.challenger)
  const difference =
    control.ctr == null || challenger.ctr == null
      ? null
      : challenger.ctr - control.ctr
  const variance =
    control.variance == null || challenger.variance == null
      ? null
      : control.variance + challenger.variance
  const standardError = variance == null ? null : Math.sqrt(variance)
  const conservativeDegreesOfFreedom =
    control.effective == null || challenger.effective == null
      ? null
      : Math.floor(
          Math.min(
            evidence.byArm.control.browsers,
            evidence.byArm.challenger.browsers,
            control.effective,
            challenger.effective,
          ),
        ) - 1
  const criticalValue =
    conservativeDegreesOfFreedom == null || conservativeDegreesOfFreedom < 1
      ? null
      : tCritical(conservativeDegreesOfFreedom)
  const usableError =
    standardError != null &&
    standardError > 0 &&
    Number.isFinite(standardError) &&
    criticalValue != null
  const lowerBound =
    difference == null || !usableError
      ? null
      : difference - criticalValue * standardError
  const upperBound =
    difference == null || !usableError
      ? null
      : difference + criticalValue * standardError
  const reasons: string[] = []
  if (!control.coherent || !challenger.coherent)
    reasons.push("incoherent_cluster_moments")
  const finalAt =
    evidence.endsAt.getTime() + settings.lateEventCutoffHours * 3_600_000
  if (evidence.asOf.getTime() < finalAt) reasons.push("before_fixed_horizon")
  if (
    evidence.endsAt.getTime() - evidence.startsAt.getTime() <
    settings.minimumDurationHours * 3_600_000
  )
    reasons.push("minimum_duration_unmet")
  for (const name of ["control", "challenger"] as const) {
    const arm = evidence.byArm[name]
    const effective =
      name === "control" ? control.effective : challenger.effective
    if (arm.eligibleVisits < settings.minimumEligibleVisitsPerArm)
      reasons.push(`${name}_sample_insufficient`)
    if (
      arm.browsers < settings.minimumIndependentBrowsersPerArm ||
      effective == null ||
      effective < settings.minimumIndependentBrowsersPerArm
    )
      reasons.push(`${name}_independent_browsers_insufficient`)
    if (
      arm.eligibleVisits > 0 &&
      arm.actualFallbackVisits / arm.eligibleVisits >
        settings.maximumActualFallbackRate
    )
      reasons.push(`${name}_fallback_rate_unhealthy`)
    if (
      arm.eligibleVisits > 0 &&
      arm.unlinkedDeliveredVisits / arm.eligibleVisits >
        settings.maximumUnlinkedDeliveryRate
    )
      reasons.push(`${name}_unlinked_delivery_unhealthy`)
  }
  if (evidence.botEligibility !== "verified")
    reasons.push("bot_eligibility_unverified")
  if (evidence.trackingLoss !== "verified")
    reasons.push("tracking_loss_unobservable")
  if (!usableError) reasons.push("uncertainty_unavailable")
  let outcome: CtrEvaluation["outcome"] = "inconclusive"
  if (reasons.length === 0 && difference != null) {
    if (
      lowerBound != null &&
      lowerBound > 0 &&
      difference >= settings.minimumPracticalAbsoluteUplift
    )
      outcome = "challenger"
    else if (
      upperBound != null &&
      upperBound < 0 &&
      -difference >= settings.minimumPracticalAbsoluteUplift
    )
      outcome = "control"
    else reasons.push("no_clear_effect")
  }
  return {
    outcome,
    reasons,
    controlCtr: control.ctr,
    challengerCtr: challenger.ctr,
    difference,
    standardError,
    lowerBound,
    upperBound,
    criticalValue,
    conservativeDegreesOfFreedom,
    effectiveBrowsers: {
      control: control.effective,
      challenger: challenger.effective,
    },
  }
}
