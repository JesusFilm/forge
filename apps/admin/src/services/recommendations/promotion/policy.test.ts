import { describe, expect, it } from "vitest"
import { assertPromotionTransition, promotionReadiness } from "./policy"

describe("recommendation promotion policy", () => {
  it("allows only the pre-approved bounded progression and an authorized permanent confirmation", () => {
    expect(
      assertPromotionTransition({
        action: "activate_bounded",
        currentStage: "control",
        actorClass: "workflow",
        recentAuthentication: false,
        approvalMatches: true,
        evaluationState: "pass",
        guardrailsPassed: true,
        targetAvailable: true,
        exposureCeilingBps: 500,
        approvedCeilingBps: 500,
        killSwitchEnabled: false,
      }),
    ).toEqual({ nextStage: "bounded", nextExposureCeilingBps: 500 })

    expect(() =>
      assertPromotionTransition({
        action: "confirm_permanent",
        currentStage: "bounded",
        actorClass: "admin",
        recentAuthentication: true,
        approvalMatches: true,
        evaluationState: "pass",
        guardrailsPassed: true,
        targetAvailable: true,
        exposureCeilingBps: 10_000,
        approvedCeilingBps: 500,
        killSwitchEnabled: false,
      }),
    ).not.toThrow()
  })

  it("uses shadow authorization only for the initial cohort and requires live PASS before increasing it", () => {
    expect(
      assertPromotionTransition({
        action: "activate_bounded",
        currentStage: "control",
        actorClass: "workflow",
        recentAuthentication: false,
        approvalMatches: true,
        evaluationState: "inconclusive",
        guardrailsPassed: false,
        initialShadowAuthorization: true,
        targetAvailable: true,
        exposureCeilingBps: 100,
        currentExposureCeilingBps: 0,
        approvedCeilingBps: 500,
        killSwitchEnabled: false,
      }),
    ).toEqual({ nextStage: "bounded", nextExposureCeilingBps: 100 })

    expect(() =>
      assertPromotionTransition({
        action: "activate_bounded",
        currentStage: "bounded",
        actorClass: "workflow",
        recentAuthentication: false,
        approvalMatches: true,
        evaluationState: "inconclusive",
        guardrailsPassed: false,
        initialShadowAuthorization: true,
        targetAvailable: true,
        exposureCeilingBps: 200,
        currentExposureCeilingBps: 100,
        approvedCeilingBps: 500,
        killSwitchEnabled: false,
      }),
    ).toThrow(/live governed evaluation/i)

    expect(
      assertPromotionTransition({
        action: "activate_bounded",
        currentStage: "bounded",
        actorClass: "workflow",
        recentAuthentication: false,
        approvalMatches: true,
        evaluationState: "pass",
        guardrailsPassed: true,
        targetAvailable: true,
        exposureCeilingBps: 200,
        currentExposureCeilingBps: 100,
        approvedCeilingBps: 500,
        killSwitchEnabled: false,
      }),
    ).toEqual({ nextStage: "bounded", nextExposureCeilingBps: 200 })
  })

  it("denies workflow permanent authority, stale approval, ceiling escape, guardrail harm, and the kill switch", () => {
    const base = {
      action: "activate_bounded" as const,
      currentStage: "control" as const,
      actorClass: "workflow" as const,
      recentAuthentication: false,
      approvalMatches: true,
      evaluationState: "pass" as const,
      guardrailsPassed: true,
      targetAvailable: true,
      exposureCeilingBps: 500,
      approvedCeilingBps: 500,
      killSwitchEnabled: false,
    }

    for (const overrides of [
      { approvalMatches: false },
      { exposureCeilingBps: 501 },
      { guardrailsPassed: false },
      { targetAvailable: false },
      { killSwitchEnabled: true },
    ]) {
      expect(() =>
        assertPromotionTransition({ ...base, ...overrides }),
      ).toThrow()
    }
    expect(() =>
      assertPromotionTransition({
        ...base,
        action: "confirm_permanent",
        currentStage: "bounded",
        exposureCeilingBps: 10_000,
      }),
    ).toThrow(/permanent/i)
  })

  it("teaches the operator the readiness, impact, next action, and fallback", () => {
    expect(
      promotionReadiness({
        stage: "control",
        evaluationState: "pass",
        guardrailsPassed: true,
        approvalMatches: true,
        targetAvailable: true,
        killSwitchEnabled: false,
        exposureCeilingBps: 500,
        lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
      }),
    ).toMatchObject({
      ready: true,
      nextAction: "Activate the approved 5% bounded stage.",
      impact: "At most 5% of eligible recommendation assignments.",
      restore: "semantic-transcript-pgvector-v1",
    })
  })

  it("reports the exact shadow-authorized initial cohort as ready without claiming a live PASS", () => {
    expect(
      promotionReadiness({
        stage: "control",
        evaluationState: null,
        guardrailsPassed: false,
        initialShadowAuthorization: true,
        approvalMatches: true,
        targetAvailable: true,
        killSwitchEnabled: false,
        exposureCeilingBps: 100,
        lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
      }),
    ).toMatchObject({
      ready: true,
      reason: expect.stringContaining("shadow promotion decision"),
      nextAction: "Activate the approved 1% bounded stage.",
    })
  })
})
