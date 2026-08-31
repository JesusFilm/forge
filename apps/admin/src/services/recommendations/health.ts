export type RecommendationHealthState =
  | "healthy"
  | "zero_activity"
  | "unavailable_unknown"
  | "loss_suspected"
  | "replay"
  | "conflict"
  | "late"
  | "classifier_lag"
  | "retention_overdue"

export type RecommendationHealthFacts = Readonly<{
  databaseAvailable: boolean
  retentionOverdue: boolean
  durableSuccessWatermark: Date | null
  requestCount: number
  committedRejectionCount: number
  writeFailureCount: number
  replayCount: number
  conflictCount: number
  lateCount: number
  classifierLagCount: number
  selectionWithoutImpressionCount: number
}>

export type RecommendationHealth = Readonly<{
  primary: RecommendationHealthState
  states: RecommendationHealthState[]
  counts: {
    requests: number
    lossSuspected: number
    replays: number
    conflicts: number
    late: number
    classifierLag: number
    selectionWithoutImpression: number
  }
}>

/** Pure KTD26 truth table: absence is never presented as zero after an outage. */
export function classifyRecommendationHealth(
  facts: RecommendationHealthFacts,
): RecommendationHealth {
  const counts = {
    requests: facts.requestCount,
    lossSuspected: facts.committedRejectionCount + facts.writeFailureCount,
    replays: facts.replayCount,
    conflicts: facts.conflictCount,
    late: facts.lateCount,
    classifierLag: facts.classifierLagCount,
    selectionWithoutImpression: facts.selectionWithoutImpressionCount,
  }
  if (!facts.databaseAvailable) {
    return {
      primary: "unavailable_unknown",
      states: ["unavailable_unknown"],
      counts,
    }
  }
  if (facts.durableSuccessWatermark == null) {
    return {
      primary: "unavailable_unknown",
      states: ["unavailable_unknown"],
      counts,
    }
  }
  if (facts.retentionOverdue) {
    return {
      primary: "retention_overdue",
      states: ["retention_overdue"],
      counts,
    }
  }
  if (facts.requestCount === 0) {
    return {
      primary: "zero_activity",
      states: ["zero_activity"],
      counts,
    }
  }

  const states: RecommendationHealthState[] = []
  if (counts.lossSuspected > 0) states.push("loss_suspected")
  if (counts.replays > 0) states.push("replay")
  if (counts.conflicts > 0) states.push("conflict")
  if (counts.late > 0) states.push("late")
  if (counts.classifierLag > 0) states.push("classifier_lag")
  if (states.length === 0) {
    states.push("healthy")
  }
  return { primary: states[0], states, counts }
}
