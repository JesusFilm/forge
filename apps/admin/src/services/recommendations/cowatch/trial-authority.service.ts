import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import type { CowatchSourceWindow } from "./source-window"

export const COWATCH_FROZEN_TRIAL_MODE =
  "frozen-source-controlled-trial-v1" as const

/** Historical study shape only; no new co-watch authority can be qualified. */
export type CowatchTrialBinding = Readonly<{
  mode: typeof COWATCH_FROZEN_TRIAL_MODE
  studyId: string
  experimentGeneration: number
  protocolDigest: string
  manifestId: string
  manifestDigest: string
  graphGenerationId: string
  sourceWindow: CowatchSourceWindow
  calibrationCompletedAt: Date
  enrollmentEnd: Date
  trialValidUntil: Date
  shadowEvaluationId: string
  shadowDecisionId: string
}>

export function cowatchTrialBindingRecord(binding: CowatchTrialBinding) {
  return {
    mode: binding.mode,
    studyId: binding.studyId,
    experimentGeneration: binding.experimentGeneration,
    protocolDigest: binding.protocolDigest,
    manifestId: binding.manifestId,
    manifestDigest: binding.manifestDigest,
    graphGenerationId: binding.graphGenerationId,
    sourceWindow: {
      version: binding.sourceWindow.version,
      windowStart: binding.sourceWindow.windowStart.toISOString(),
      windowEnd: binding.sourceWindow.windowEnd.toISOString(),
      evaluationAsOf: binding.sourceWindow.evaluationAsOf.toISOString(),
    },
    calibrationCompletedAt: binding.calibrationCompletedAt.toISOString(),
    enrollmentEnd: binding.enrollmentEnd.toISOString(),
    trialValidUntil: binding.trialValidUntil.toISOString(),
    shadowEvaluationId: binding.shadowEvaluationId,
    shadowDecisionId: binding.shadowDecisionId,
  }
}

export function cowatchTrialBindingDigest(
  binding: CowatchTrialBinding,
): string {
  return createHash("sha256")
    .update(JSON.stringify(cowatchTrialBindingRecord(binding)))
    .digest("hex")
}

export type CowatchTrialRefusal = "behavioral_recommendations_retired"

type Refused = Readonly<{ status: "refused"; reason: CowatchTrialRefusal }>
const refused = (): Refused => ({
  status: "refused",
  reason: "behavioral_recommendations_retired",
})

export async function qualifyCowatchTrialAuthority(
  _prisma: PrismaClient,
  _binding: CowatchTrialBinding,
  _now: Date = new Date(),
): Promise<Refused> {
  return refused()
}

export async function readCowatchTrialAuthority(
  _tx: Prisma.TransactionClient,
  _binding: CowatchTrialBinding,
  _now: Date,
): Promise<
  Refused | { status: "current"; authority: { dependencyExpiresAt: Date } }
> {
  return refused()
}

export async function lockCowatchTrialAuthorityForIssuance(
  _tx: Prisma.TransactionClient,
  _binding: CowatchTrialBinding,
  _now: Date,
): Promise<Refused> {
  return refused()
}
