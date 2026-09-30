import {
  runVideoDbBackup,
  runVideoDbBackupScheduler,
} from "@/workflows/videoDbBackup"
import { runRecommendationEpisodeFinalization } from "@/workflows/recommendationEpisodeFinalization"
import { runRecommendationControlReadinessScheduler } from "@/workflows/recommendationControlReadiness"
import { runPlaybackObservationSnapshotBootstrap } from "@/workflows/playbackObservationSnapshotBootstrap"
import { runRecommendationShadowEvaluation } from "@/workflows/recommendationShadowEvaluation"
import { runRecommendationExperimentEvaluation } from "@/workflows/recommendationExperimentEvaluation"
import { runRecommendationPromotion } from "@/workflows/recommendationPromotion"
import { runRecommendationProfileProjection } from "@/workflows/recommendationProfileProjection"
import { runRecommendationProfileReconciliationScheduler } from "@/workflows/recommendationProfileReconciliation"
import {
  runRecommendationRetention,
  runRecommendationRetentionScheduler,
} from "@/workflows/recommendationRetention"
import { runPushCampaign } from "@/workflows/pushCampaign"

type WorkflowExport = {
  name: string
  workflowId?: string
}

export function getKnownVideoDbBackupWorkflowIds(): string[] {
  return [runVideoDbBackup, runVideoDbBackupScheduler].map((workflow) => {
    const registered = workflow as WorkflowExport
    return registered.workflowId ?? registered.name
  })
}

export function getKnownRecommendationWorkflowIds(): string[] {
  return [
    runRecommendationEpisodeFinalization,
    runRecommendationControlReadinessScheduler,
    runPlaybackObservationSnapshotBootstrap,
    runRecommendationShadowEvaluation,
    runRecommendationExperimentEvaluation,
    runRecommendationPromotion,
    runRecommendationProfileProjection,
    runRecommendationProfileReconciliationScheduler,
    runRecommendationRetention,
    runRecommendationRetentionScheduler,
  ].map((workflow) => {
    const registered = workflow as WorkflowExport
    return registered.workflowId ?? registered.name
  })
}

/**
 * The push campaign run. One run per campaign, so the dashboard lists a row per
 * send rather than one long-lived scheduler.
 */
export function getKnownPushWorkflowIds(): string[] {
  return [runPushCampaign].map((workflow) => {
    const registered = workflow as WorkflowExport
    return registered.workflowId ?? registered.name
  })
}
