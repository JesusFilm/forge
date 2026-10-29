import { describe, expect, it, vi } from "vitest"
import { runRecommendationProfileReconciliationBatch } from "./reconciliation.service"
describe("retired behavioral reconciliation", () => {
  it("does not classify history or queue replacement profiles", async () => {
    const classifyOutcome = vi.fn(),
      classifySelection = vi.fn(),
      dispatchProjection = vi.fn(),
      redispatchRun = vi.fn()
    await expect(
      runRecommendationProfileReconciliationBatch({
        classifyOutcome,
        classifySelection,
        dispatchProjection,
        redispatchRun,
      }),
    ).resolves.toMatchObject({
      retired: true,
      rebuildsQueued: 0,
      staleRunsQueued: 0,
    })
    for (const operation of [
      classifyOutcome,
      classifySelection,
      dispatchProjection,
      redispatchRun,
    ])
      expect(operation).not.toHaveBeenCalled()
  })
})
