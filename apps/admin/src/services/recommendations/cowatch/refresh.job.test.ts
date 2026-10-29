import { describe, expect, it, vi } from "vitest"
const start = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())
vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({ prisma: { $transaction: transaction } }))
import { ensureRecommendationCowatchRefreshSchedulerStarted } from "./refresh.job"
describe("retired CowatchRefresh scheduler", () => {
  it("cannot queue a new run or read the database", async () => {
    await expect(
      ensureRecommendationCowatchRefreshSchedulerStarted(),
    ).resolves.toEqual({ started: false })
    expect(start).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})
