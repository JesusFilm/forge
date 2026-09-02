import {
  runVideoDbBackup,
  runVideoDbBackupScheduler,
} from "@/workflows/videoDbBackup"
import { runRecommendationEpisodeFinalization } from "@/workflows/recommendationEpisodeFinalization"
import { runRecommendationControlReadinessScheduler } from "@/workflows/recommendationControlReadiness"
import { runRecommendationShadowEvaluation } from "@/workflows/recommendationShadowEvaluation"
import { runRecommendationExperimentEvaluation } from "@/workflows/recommendationExperimentEvaluation"
import { runRecommendationPromotion } from "@/workflows/recommendationPromotion"
import { runRecommendationProfileProjection } from "@/workflows/recommendationProfileProjection"
import { runRecommendationPlaybackProxyEvaluation } from "@/workflows/recommendationPlaybackProxyEvaluation"
import {
  runRecommendationRetention,
  runRecommendationRetentionScheduler,
} from "@/workflows/recommendationRetention"

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
    runRecommendationShadowEvaluation,
    runRecommendationExperimentEvaluation,
    runRecommendationPromotion,
    runRecommendationProfileProjection,
    runRecommendationPlaybackProxyEvaluation,
    runRecommendationRetention,
    runRecommendationRetentionScheduler,
  ].map((workflow) => {
    const registered = workflow as WorkflowExport
    return registered.workflowId ?? registered.name
  })
}
