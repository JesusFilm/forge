import { describe, expect, it } from "vitest"
import { assessPlaybackProxyReadiness } from "./playback-proxy-evaluation.service"

const healthy = {
  finalizedTotal: 100,
  activeOutcomeTotal: 100,
  durationCohorts: { short: 25, medium: 40, long: 25, unknown: 10 },
  cohortComparisons: {
    short: { legacyQualified: 12, proxyQualified: 11, disagreements: 1 },
  },
  completeCoverage: 97,
  legacyQualifiedTotal: 55,
  proxyQualifiedTotal: 50,
  classificationDisagreements: 7,
  p95FinalizationLagMs: 60_000,
  conflictRate: 0.001,
  revisionRate: 0.02,
  retentionHealthy: true,
  writeFailureCount: 0,
}

describe("assessPlaybackProxyReadiness", () => {
  it("keeps sparse evidence inconclusive", () => {
    expect(
      assessPlaybackProxyReadiness({
        ...healthy,
        finalizedTotal: 49,
        completeCoverage: 49,
        durationCohorts: { short: 9, medium: 40 },
      }),
    ).toEqual({
      state: "inconclusive",
      reasonCodes: [
        "finalized_total_below_50",
        "duration_cohort_short_below_10",
      ],
    })
  })

  it("requests revision for degraded collection quality", () => {
    expect(
      assessPlaybackProxyReadiness({
        ...healthy,
        completeCoverage: 90,
        conflictRate: 0.02,
      }),
    ).toEqual({
      state: "revise",
      reasonCodes: [
        "active_coverage_below_95_percent",
        "conflict_rate_above_1_percent",
      ],
    })
  })

  it("treats missing proxy outcomes as degraded coverage before lag is available", () => {
    expect(
      assessPlaybackProxyReadiness({
        ...healthy,
        activeOutcomeTotal: 0,
        completeCoverage: 0,
        p95FinalizationLagMs: null,
      }),
    ).toEqual({
      state: "revise",
      reasonCodes: ["active_coverage_below_95_percent"],
    })
  })

  it("permits only offline shadow evaluation when evidence is sufficient", () => {
    expect(assessPlaybackProxyReadiness(healthy)).toEqual({
      state: "eligible_for_shadow_evaluation",
      reasonCodes: ["bounded_collection_quality_sufficient"],
    })
  })

  it("recommends retirement only for a mature complete zero-signal proxy", () => {
    expect(
      assessPlaybackProxyReadiness({
        ...healthy,
        legacyQualifiedTotal: 40,
        proxyQualifiedTotal: 0,
      }),
    ).toEqual({
      state: "retire",
      reasonCodes: ["proxy_zero_signal_in_mature_legacy_positive_window"],
    })
  })
})
