import { RecommendationInputError } from "../errors"

export type PromotionStage = "control" | "bounded" | "permanent"
export type PromotionAction =
  | "activate_bounded"
  | "confirm_permanent"
  | "automatic_rollback"
  | "manual_rollback"

type TransitionInput = Readonly<{
  action: PromotionAction
  currentStage: PromotionStage
  actorClass: "admin" | "workflow"
  recentAuthentication: boolean
  approvalMatches: boolean
  evaluationState: "pass" | "fail" | "inconclusive" | "data_unhealthy"
  guardrailsPassed: boolean
  /** Exact, unexpired shadow PROMOTE_TO_EXPERIMENT authority for the first bounded cohort only. */
  initialShadowAuthorization?: boolean
  targetAvailable: boolean
  exposureCeilingBps: number
  currentExposureCeilingBps?: number
  approvedCeilingBps: number
  killSwitchEnabled: boolean
}>

export function assertPromotionTransition(input: TransitionInput): {
  nextStage: PromotionStage
  nextExposureCeilingBps: number
} {
  if (
    input.action === "automatic_rollback" ||
    input.action === "manual_rollback"
  ) {
    return { nextStage: "control", nextExposureCeilingBps: 0 }
  }
  if (input.killSwitchEnabled) invalid("The promotion kill switch is enabled")
  if (!input.approvalMatches) invalid("The exact manifest approval is stale")
  if (!input.targetAvailable) invalid("The approved challenger is unavailable")
  if (input.action === "activate_bounded") {
    if (input.currentStage === "permanent") {
      invalid("A permanent default cannot return to bounded exposure")
    }
    const initialBoundedActivation =
      input.currentStage === "control" &&
      input.initialShadowAuthorization === true
    if (
      !initialBoundedActivation &&
      (input.evaluationState !== "pass" || !input.guardrailsPassed)
    ) {
      invalid(
        "A live governed evaluation and guardrails must pass before increasing exposure",
      )
    }
    if (
      !Number.isInteger(input.exposureCeilingBps) ||
      input.exposureCeilingBps < 1 ||
      input.exposureCeilingBps > input.approvedCeilingBps ||
      input.approvedCeilingBps >= 10_000
    ) {
      invalid("The requested exposure exceeds its pre-approved bounded ceiling")
    }
    if (
      input.currentStage === "bounded" &&
      input.exposureCeilingBps <= (input.currentExposureCeilingBps ?? 0)
    ) {
      invalid("A bounded exposure update must increase the current ceiling")
    }
    return {
      nextStage: "bounded",
      nextExposureCeilingBps: input.exposureCeilingBps,
    }
  }

  if (input.evaluationState !== "pass" || !input.guardrailsPassed) {
    invalid("The governed evaluation and guardrails must pass")
  }

  if (
    input.actorClass !== "admin" ||
    !input.recentAuthentication ||
    input.currentStage !== "bounded"
  ) {
    invalid("Permanent default requires a recently authenticated Admin")
  }
  return { nextStage: "permanent", nextExposureCeilingBps: 10_000 }
}

export function promotionReadiness(input: {
  stage: PromotionStage
  evaluationState: "pass" | "fail" | "inconclusive" | "data_unhealthy" | null
  guardrailsPassed: boolean
  initialShadowAuthorization?: boolean
  approvalMatches: boolean
  targetAvailable: boolean
  killSwitchEnabled: boolean
  exposureCeilingBps: number
  lastKnownGoodManifestId: string
}) {
  const percentage = formatBasisPoints(input.exposureCeilingBps)
  const common = {
    impact:
      input.stage === "control"
        ? `At most ${percentage} of eligible recommendation assignments.`
        : input.stage === "bounded"
          ? `${percentage} of eligible assignments may receive the approved challenger.`
          : "The approved strategy is the permanent default.",
    restore: input.lastKnownGoodManifestId,
  }
  if (input.killSwitchEnabled) {
    return {
      ...common,
      ready: false,
      reason: "Emergency rollback is holding traffic on semantic control.",
      nextAction: "Review the rollback audit before clearing the kill switch.",
    }
  }
  if (!input.targetAvailable) {
    return {
      ...common,
      ready: false,
      reason: "The approved challenger is unavailable.",
      nextAction: `Keep traffic on ${input.lastKnownGoodManifestId}.`,
    }
  }
  if (!input.approvalMatches) {
    return {
      ...common,
      ready: false,
      reason: "The exact manifest digest is not pre-approved.",
      nextAction: "Review and approve the current immutable manifest.",
    }
  }
  const initialBoundedActivation =
    input.stage === "control" && input.initialShadowAuthorization === true
  if (
    !initialBoundedActivation &&
    (input.evaluationState !== "pass" || !input.guardrailsPassed)
  ) {
    return {
      ...common,
      ready: false,
      reason: "The governed evaluation is not a mature pass.",
      nextAction: "Keep semantic control and inspect evaluation guardrails.",
    }
  }
  if (input.stage === "control") {
    return {
      ...common,
      ready: true,
      reason: initialBoundedActivation
        ? "The exact challenger has an unexpired shadow promotion decision and bounded approval."
        : "The exact challenger passed and is approved for bounded exposure.",
      nextAction: `Activate the approved ${percentage} bounded stage.`,
    }
  }
  if (input.stage === "bounded") {
    return {
      ...common,
      ready: true,
      reason: "The bounded stage is active with mature guardrails.",
      nextAction:
        "A recently authenticated Admin may confirm the permanent default.",
    }
  }
  return {
    ...common,
    ready: true,
    reason: "The permanent default was confirmed by an authorized Admin.",
    nextAction: "Continue monitoring; emergency rollback remains available.",
  }
}

function formatBasisPoints(value: number): string {
  const percentage = value / 100
  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(2)}%`
}

function invalid(message: string): never {
  throw new RecommendationInputError(message)
}
