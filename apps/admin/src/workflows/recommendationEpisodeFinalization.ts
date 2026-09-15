import { getWorkflowMetadata, sleep } from "workflow"
import type { RecommendationEpisodeFinalizationInput } from "@/services/recommendations/finalization/job"

export async function runRecommendationEpisodeFinalization(
  input: RecommendationEpisodeFinalizationInput,
) {
  "use workflow"
  await stepMarkRecommendationFinalizationStarted(input)
  if (input.notBefore) {
    const notBefore = new Date(input.notBefore)
    if (notBefore > new Date()) await sleep(notBefore)
  }
  return stepFinalizeRecommendationEpisode(input)
}

export async function runRecommendationEpisodeFinalizationRecovery(
  input: { ledgerRunId?: string } = {},
): Promise<never> {
  "use workflow"
  await stepMarkRecommendationRecoveryStarted(input)
  while (true) {
    const totals = await stepRecoverRecommendationEpisodeFinalizations()
    const next = await stepRecordRecommendationRecoveryHeartbeat(input, totals)
    await sleep(next)
  }
}

async function stepMarkRecommendationFinalizationStarted(
  input: RecommendationEpisodeFinalizationInput,
): Promise<void> {
  "use step"
  const { markRecommendationEpisodeFinalizationRuntimeStarted } =
    await import("@/services/recommendations/finalization/job")
  await markRecommendationEpisodeFinalizationRuntimeStarted(
    input.ledgerRunId,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepMarkRecommendationRecoveryStarted(input: {
  ledgerRunId?: string
}): Promise<void> {
  "use step"
  const { markRecommendationEpisodeFinalizationRuntimeStarted } =
    await import("@/services/recommendations/finalization/job")
  await markRecommendationEpisodeFinalizationRuntimeStarted(
    input.ledgerRunId,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRecoverRecommendationEpisodeFinalizations() {
  "use step"
  const { recoverRecommendationEpisodeFinalizations } =
    await import("@/services/recommendations/finalization/job")
  return recoverRecommendationEpisodeFinalizations()
}

async function stepRecordRecommendationRecoveryHeartbeat(
  input: { ledgerRunId?: string },
  totals: {
    scanned: number
    dispatched: number
    skipped: number
    failed: number
  },
): Promise<Date> {
  "use step"
  const {
    nextRecommendationEpisodeFinalizationRecoveryAt,
    recordRecommendationEpisodeFinalizationRecoveryHeartbeat,
  } = await import("@/services/recommendations/finalization/job")
  const next = nextRecommendationEpisodeFinalizationRecoveryAt()
  await recordRecommendationEpisodeFinalizationRecoveryHeartbeat(
    input.ledgerRunId,
    next,
    totals,
  )
  return next
}

async function stepFinalizeRecommendationEpisode(
  input: RecommendationEpisodeFinalizationInput,
) {
  "use step"
  const { runRecommendationEpisodeFinalizationJob } =
    await import("@/services/recommendations/finalization/job")
  return runRecommendationEpisodeFinalizationJob(input)
}
