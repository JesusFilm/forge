import { describe, expect, it } from "vitest"
import {
  getKnownPushWorkflowIds,
  getKnownRecommendationWorkflowIds,
} from "./registry"
import { runPushCampaign } from "./pushCampaign"
import {
  runRecommendationRetention,
  runRecommendationRetentionScheduler,
} from "./recommendationRetention"
import { runRecommendationProfileReconciliationScheduler } from "./recommendationProfileReconciliation"

describe("recommendation workflow registry", () => {
  it("keeps both retention workflows in the deployment discovery graph", () => {
    const workflowIds = getKnownRecommendationWorkflowIds()

    const retentionWorkflowId = (
      runRecommendationRetention as typeof runRecommendationRetention & {
        workflowId?: string
      }
    ).workflowId
    const retentionSchedulerWorkflowId = (
      runRecommendationRetentionScheduler as typeof runRecommendationRetentionScheduler & {
        workflowId?: string
      }
    ).workflowId

    expect(workflowIds).toContain(
      retentionWorkflowId ?? runRecommendationRetention.name,
    )
    expect(workflowIds).toContain(
      retentionSchedulerWorkflowId ?? runRecommendationRetentionScheduler.name,
    )
    expect(workflowIds).toContain(
      (
        runRecommendationProfileReconciliationScheduler as typeof runRecommendationProfileReconciliationScheduler & {
          workflowId?: string
        }
      ).workflowId ?? runRecommendationProfileReconciliationScheduler.name,
    )
  })
})

describe("push workflow registry", () => {
  it("keeps the campaign run in the deployment discovery graph", () => {
    const workflowIds = getKnownPushWorkflowIds()

    expect(workflowIds).toContain(
      (runPushCampaign as typeof runPushCampaign & { workflowId?: string })
        .workflowId ?? runPushCampaign.name,
    )
  })

  it("keeps the push list separate from the recommendation list", () => {
    expect(getKnownRecommendationWorkflowIds()).not.toContain(
      getKnownPushWorkflowIds()[0],
    )
  })
})
