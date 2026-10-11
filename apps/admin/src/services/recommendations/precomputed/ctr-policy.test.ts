import { describe, expect, it } from "vitest"
import {
  evaluatePrecomputedCtr,
  validateCtrPolicySettings,
  type CtrPolicySettings,
} from "./ctr-policy"

const settings: CtrPolicySettings = {
  baselineHumanVisitCtr: 0.2,
  minimumDetectableAbsoluteUplift: 0.05,
  minimumPracticalAbsoluteUplift: 0.05,
  plannedPower: 0.8,
  minimumEligibleVisitsPerArm: 30,
  minimumIndependentBrowsersPerArm: 20,
  minimumDurationHours: 24,
  lateEventCutoffHours: 24,
  maximumActualFallbackRate: 0.1,
  maximumUnlinkedDeliveryRate: 0,
}

const start = new Date("2026-10-01T00:00:00.000Z")
const end = new Date("2026-10-03T00:00:00.000Z")
const afterCutoff = new Date("2026-10-04T00:00:00.000Z")

function arm(clicks: number) {
  return {
    browsers: 50,
    eligibleVisits: 50,
    clickedVisits: clicks,
    sumVisitsSquared: 50,
    sumClicksSquared: clicks,
    sumVisitsClicks: clicks,
    actualFallbackVisits: 0,
    unlinkedDeliveredVisits: 0,
  }
}

describe("fixed-horizon clustered visit CTR", () => {
  it("does not invent a loss limit and rejects an invalid owner value", () => {
    expect(() =>
      validateCtrPolicySettings({
        ...settings,
        maximumEndToEndLossRate: null,
      }),
    ).not.toThrow()
    expect(() =>
      validateCtrPolicySettings({
        ...settings,
        maximumEndToEndLossRate: 1.1,
      }),
    ).toThrow("invalid_ctr_stopping_policy")
  })
  it("finds a clear challenger win only after the declared final look", () => {
    const evidence = {
      startsAt: start,
      endsAt: end,
      asOf: afterCutoff,
      byArm: { control: arm(10), challenger: arm(30) },
      botEligibility: "verified" as const,
      trackingLoss: "verified" as const,
    }
    const final = evaluatePrecomputedCtr(settings, evidence)
    expect(final).toMatchObject({
      outcome: "challenger",
      controlCtr: 0.2,
      challengerCtr: 0.6,
      reasons: [],
    })
    expect(final.difference).toBeCloseTo(0.4)
    expect(final.lowerBound).toBeGreaterThan(0)
    expect(
      evaluatePrecomputedCtr(settings, {
        ...evidence,
        asOf: new Date("2026-10-03T12:00:00.000Z"),
      }),
    ).toMatchObject({
      outcome: "inconclusive",
      reasons: expect.arrayContaining(["before_fixed_horizon"]),
    })
  })

  it("weights visits while treating repeat visits from one browser as one cluster", () => {
    const small = {
      ...settings,
      minimumEligibleVisitsPerArm: 1,
      minimumIndependentBrowsersPerArm: 3,
    }
    const result = evaluatePrecomputedCtr(small, {
      startsAt: start,
      endsAt: end,
      asOf: afterCutoff,
      byArm: {
        control: {
          browsers: 3,
          eligibleVisits: 102,
          clickedVisits: 11,
          sumVisitsSquared: 10002,
          sumClicksSquared: 101,
          sumVisitsClicks: 1001,
          actualFallbackVisits: 0,
          unlinkedDeliveredVisits: 0,
        },
        challenger: arm(30),
      },
      botEligibility: "verified",
      trackingLoss: "verified",
    })
    expect(result.controlCtr).toBeCloseTo(11 / 102)
    expect(result.controlCtr).not.toBeCloseTo((0.1 + 1 + 0) / 3)
    expect(result.effectiveBrowsers.control).toBeLessThan(2)
    expect(result).toMatchObject({
      outcome: "inconclusive",
      reasons: expect.arrayContaining([
        "control_independent_browsers_insufficient",
      ]),
    })
  })

  it("does not certify a numerical lead with unknown bots, lost events or degenerate variance", () => {
    const result = evaluatePrecomputedCtr(settings, {
      startsAt: start,
      endsAt: end,
      asOf: afterCutoff,
      byArm: { control: arm(0), challenger: arm(50) },
      botEligibility: "unverified",
      trackingLoss: "unobservable",
    })
    expect(result).toMatchObject({
      outcome: "inconclusive",
      reasons: expect.arrayContaining([
        "bot_eligibility_unverified",
        "tracking_loss_unobservable",
        "uncertainty_unavailable",
      ]),
    })
  })

  it("does not call three independent browsers per arm a clear winner under a z approximation", () => {
    const three = {
      ...settings,
      minimumEligibleVisitsPerArm: 3,
      minimumIndependentBrowsersPerArm: 3,
    }
    const result = evaluatePrecomputedCtr(three, {
      startsAt: start,
      endsAt: end,
      asOf: afterCutoff,
      byArm: {
        control: {
          browsers: 3,
          eligibleVisits: 3,
          clickedVisits: 0,
          sumVisitsSquared: 3,
          sumClicksSquared: 0,
          sumVisitsClicks: 0,
          actualFallbackVisits: 0,
          unlinkedDeliveredVisits: 0,
        },
        challenger: {
          browsers: 3,
          eligibleVisits: 3,
          clickedVisits: 2,
          sumVisitsSquared: 3,
          sumClicksSquared: 2,
          sumVisitsClicks: 2,
          actualFallbackVisits: 0,
          unlinkedDeliveredVisits: 0,
        },
      },
      botEligibility: "verified",
      trackingLoss: "verified",
    })
    expect(result.outcome).toBe("inconclusive")
    expect(result.lowerBound).toBeLessThan(0)
  })

  it("refuses incoherent moments and does not show a zero-width confidence interval", () => {
    const impossible = evaluatePrecomputedCtr(settings, {
      startsAt: start,
      endsAt: end,
      asOf: afterCutoff,
      byArm: {
        control: { ...arm(10), sumClicksSquared: 0 },
        challenger: arm(30),
      },
      botEligibility: "verified",
      trackingLoss: "verified",
    })
    expect(impossible).toMatchObject({
      outcome: "inconclusive",
      reasons: expect.arrayContaining(["incoherent_cluster_moments"]),
    })
    const degenerate = evaluatePrecomputedCtr(settings, {
      startsAt: start,
      endsAt: end,
      asOf: afterCutoff,
      byArm: { control: arm(0), challenger: arm(50) },
      botEligibility: "verified",
      trackingLoss: "verified",
    })
    expect(degenerate).toMatchObject({
      lowerBound: null,
      upperBound: null,
      reasons: expect.arrayContaining(["uncertainty_unavailable"]),
    })
  })

  it("rejects cross moments impossible when every browser has exactly one visit", () => {
    for (const impossible of [
      { ...arm(10), sumVisitsClicks: 20 },
      { ...arm(10), sumVisitsSquared: 100, sumVisitsClicks: 30 },
    ]) {
      const result = evaluatePrecomputedCtr(settings, {
        startsAt: start,
        endsAt: end,
        asOf: afterCutoff,
        byArm: { control: impossible, challenger: arm(19) },
        botEligibility: "verified",
        trackingLoss: "verified",
      })
      expect(result).toMatchObject({
        outcome: "inconclusive",
        reasons: expect.arrayContaining(["incoherent_cluster_moments"]),
      })
    }
  })
})
