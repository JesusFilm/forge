import type { CtrTotals } from "./ctr-evidence"
import { comparePrecomputedVisitRates, type CtrArmMoments } from "./ctr-policy"

function count(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("precomputed_engagement_count_overflow")
  return result
}

function armEngagement(totals: CtrTotals) {
  const visits = count(totals.eligibleVisits)
  const measuredVisits = count(totals.engagementMeasuredVisits)
  const unmeasuredArchivedVisits = visits - measuredVisits
  if (unmeasuredArchivedVisits < 0)
    throw new Error("precomputed_engagement_measured_visit_mismatch")
  const engagedVisits = count(totals.engagedVisits)
  const milliseconds = count(totals.activePlaybackMilliseconds)
  const selections = count(totals.acceptedSelections)
  const claimed = count(totals.claimedPlaybacks)
  const observed = count(totals.observedPlaybacks)
  const complete = count(totals.completePlaybacks)
  // Old archives and entirely absent clicked-playback evidence are unknown.
  // Partial capture yields an observed lower-bound rate alongside coverage.
  const available =
    visits > 0 &&
    unmeasuredArchivedVisits === 0 &&
    (selections === 0 || observed > 0)
  return {
    measuredVisits,
    unmeasuredArchivedVisits,
    engagedVisits,
    engagedViewRate: available ? engagedVisits / visits : null,
    activeWatchMinutes: milliseconds / 60_000,
    activeWatchMinutesPer100Visits: available
      ? (milliseconds / 60_000 / visits) * 100
      : null,
    claimedPlaybacks: claimed,
    observedPlaybacks: observed,
    completePlaybacks: complete,
    partialPlaybacks: count(totals.partialPlaybacks),
    missingOutcomePlaybacks: count(totals.missingOutcomePlaybacks),
    missingCoveragePlaybacks: count(totals.missingCoveragePlaybacks),
    pendingPlaybacks: count(totals.pendingPlaybacks),
    invalidPlaybacks: count(totals.invalidPlaybacks),
    playbackClaimRate: selections ? claimed / selections : null,
    activeCoverageRate: claimed ? observed / claimed : null,
    completeCoverageRate: claimed ? complete / claimed : null,
  }
}

export type PrecomputedEngagementReport = {
  version: "observed-active-watch-v1"
  classifierVersion: "active-watch-proxy-v1"
  interpretation: "secondary_observed_comparison"
  byArm: Record<"control" | "challenger", ReturnType<typeof armEngagement>>
  engagedViewUncertainty: {
    confidence: 0.95
    difference: number | null
    lowerBound: number | null
    upperBound: number | null
  }
}

export function buildEngagementReport(
  totals: Record<"control" | "challenger", CtrTotals>,
  moments: Record<"control" | "challenger", CtrArmMoments>,
): PrecomputedEngagementReport {
  const byArm = {
    control: armEngagement(totals.control),
    challenger: armEngagement(totals.challenger),
  }
  const comparison = comparePrecomputedVisitRates(moments)
  const available =
    byArm.control.engagedViewRate != null &&
    byArm.challenger.engagedViewRate != null
  return {
    version: "observed-active-watch-v1",
    classifierVersion: "active-watch-proxy-v1",
    interpretation: "secondary_observed_comparison",
    byArm,
    engagedViewUncertainty: {
      confidence: 0.95,
      difference: available ? comparison.difference : null,
      lowerBound: available ? comparison.lowerBound : null,
      upperBound: available ? comparison.upperBound : null,
    },
  }
}
