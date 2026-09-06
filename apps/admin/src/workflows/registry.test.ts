import { describe, expect, it } from "vitest"
import { getKnownRecommendationWorkflowIds } from "./registry"
import {
  runRecommendationRetention,
  runRecommendationRetentionScheduler,
} from "./recommendationRetention"

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
  })
})
