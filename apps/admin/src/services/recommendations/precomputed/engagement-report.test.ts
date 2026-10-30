import { describe, expect, it } from "vitest"
import { blankCtrTotals } from "./ctr-evidence"
import { buildEngagementReport } from "./engagement-report"

function arm(engaged: number) {
  return {
    browsers: 100,
    eligibleVisits: 100,
    clickedVisits: engaged,
    sumVisitsSquared: 100,
    sumClicksSquared: engaged,
    sumVisitsClicks: engaged,
    actualFallbackVisits: 0,
    unlinkedDeliveredVisits: 0,
  }
}
function totals(engaged: number) {
  return {
    ...blankCtrTotals(),
    eligibleVisits: 100n,
    engagementMeasuredVisits: 100n,
    clickedVisits: 40n,
    acceptedSelections: 50n,
    engagedVisits: BigInt(engaged),
    claimedPlaybacks: 40n,
    observedPlaybacks: 35n,
    completePlaybacks: 30n,
    partialPlaybacks: 5n,
    activePlaybackMilliseconds: 600_000n,
  }
}

describe("observed engagement comparison", () => {
  it("uses all visits for rates and distinct denominators for claim and playback coverage", () => {
    const result = buildEngagementReport(
      { control: totals(10), challenger: totals(30) },
      { control: arm(10), challenger: arm(30) },
    )
    expect(result.byArm.control).toMatchObject({
      engagedViewRate: 0.1,
      activeWatchMinutesPer100Visits: 10,
      playbackClaimRate: 0.8,
      activeCoverageRate: 0.875,
      completeCoverageRate: 0.75,
    })
    expect(result.engagedViewUncertainty.difference).toBeCloseTo(0.2)
    expect(result.engagedViewUncertainty.lowerBound).toBeGreaterThan(0)
    expect(result.interpretation).toBe("secondary_observed_comparison")
  })

  it("withholds a full-cohort interval when older archives have no engagement evidence", () => {
    const control = { ...totals(10), engagementMeasuredVisits: 90n }
    const result = buildEngagementReport(
      { control, challenger: totals(30) },
      { control: arm(10), challenger: arm(30) },
    )
    expect(result.byArm.control.unmeasuredArchivedVisits).toBe(10)
    expect(result.byArm.control.engagedViewRate).toBeNull()
    expect(result.engagedViewUncertainty.difference).toBeNull()
  })

  it("distinguishes no clicks from clicked visits with entirely missing playback evidence", () => {
    const noClicks = {
      ...blankCtrTotals(),
      eligibleVisits: 100n,
      engagementMeasuredVisits: 100n,
    }
    const missing = { ...noClicks, acceptedSelections: 2n }
    const result = buildEngagementReport(
      { control: noClicks, challenger: missing },
      { control: arm(0), challenger: arm(0) },
    )
    expect(result.byArm.control.engagedViewRate).toBe(0)
    expect(result.byArm.challenger.engagedViewRate).toBeNull()
    expect(result.byArm.challenger.activeWatchMinutesPer100Visits).toBeNull()
  })

  it("rejects unsafe retained counts instead of rounding them into analytics", () => {
    expect(() =>
      buildEngagementReport(
        {
          control: {
            ...totals(10),
            activePlaybackMilliseconds: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          },
          challenger: totals(30),
        },
        { control: arm(10), challenger: arm(30) },
      ),
    ).toThrow("precomputed_engagement_count_overflow")
  })
})
