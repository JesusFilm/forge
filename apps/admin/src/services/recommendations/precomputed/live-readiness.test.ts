import { describe, expect, it } from "vitest"
import { evaluatePrecomputedLiveFacts } from "./live-readiness"

const now = new Date("2026-10-07T12:00:00.000Z")
const verified = () => ({
  now,
  policy: {
    authority: "prelaunch_agreed" as const,
    digest: "a".repeat(64),
    baselineHumanVisitCtr: 0.04,
  },
  baseline: {
    authority: "live_verified" as const,
    isFinal: true,
    reportDigest: "b".repeat(64),
    eligibleVisits: 100,
    visitCtr: 0.04,
    startsAt: "2026-09-29T00:00:00.000Z",
    endsAt: "2026-10-06T00:00:00.000Z",
  },
  web: {
    status: "complete" as const,
    startHour: "2026-09-29T00:00:00.000Z",
    endHourExclusive: "2026-10-06T00:00:00.000Z",
    requestedHours: 168,
    coveredHours: 168,
    missingHours: [],
    imbalancedHours: [],
    qualifiedRequestAttempts: 110,
    clickUnavailable: 0,
    verificationUnavailable: 0,
  },
  generation: {
    status: "complete",
    protocolVersion: 2,
    modelId: "gpt-6-astra",
    inputMode: "historical_analytics",
    sourceSetDigest: "e".repeat(64),
    historicalQualificationDigest: "c".repeat(64),
    expectedSourceCount: 1_031,
    sourceCount: 1_031,
    catalogSourceCount: 1_031,
    catalogSourceSetDigest: "e".repeat(64),
    modelCallCount: 1_000,
    unknownModelCostCount: 0,
  },
  capacity: {
    status: "passed" as const,
    receiptDigest: "d".repeat(64),
    measuredAt: "2026-10-07T11:55:00.000Z",
    availableAfterReserveBytes: 12_000_000_000,
    projectedBytes: 2_000_000_000,
  },
  hourAlignedCohort: true,
})

describe("contingent public Watch live readiness", () => {
  it("can qualify only an explicitly agreed numeric policy with real stored evidence", () => {
    expect(evaluatePrecomputedLiveFacts(verified())).toEqual([])
  })

  it("names fixture, Web loss, unknown model cost, and stale capacity independently", () => {
    const facts = verified()
    expect(
      evaluatePrecomputedLiveFacts({
        ...facts,
        policy: { ...facts.policy, authority: "fixture_only" },
        baseline: { ...facts.baseline, authority: "isolated_fixture" },
        web: {
          ...facts.web,
          status: "incomplete",
          missingHours: ["2026100102"],
          qualifiedRequestAttempts: 90,
          clickUnavailable: 1,
        },
        generation: { ...facts.generation, unknownModelCostCount: 1 },
        capacity: { ...facts.capacity, measuredAt: "2026-10-07T10:00:00.000Z" },
      }),
    ).toEqual(
      expect.arrayContaining([
        "numeric_policy_not_agreed",
        "verified_incumbent_baseline_missing",
        "web_request_health_incomplete",
        "qualified_request_count_below_durable_visits",
        "click_tracking_unavailable",
        "model_cost_unknown",
        "launch_capacity_stale",
      ]),
    )
  })

  it("rejects a self-consistent two-video pilot against a 1031-video catalog and an alternate model", () => {
    const facts = verified()
    expect(
      evaluatePrecomputedLiveFacts({
        ...facts,
        generation: {
          ...facts.generation,
          modelId: "gpt-6.1-sol",
          expectedSourceCount: 2,
          sourceCount: 2,
          catalogSourceCount: 1_031,
        },
      }),
    ).toContain("actual_catalog_build_unverified")
  })
})
