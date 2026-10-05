import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  declare: vi.fn(),
  evaluate: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock("@/auth/session", () => ({ requireSession: mocks.session }))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/services/recommendations/precomputed/visit-admission", () => ({
  configurePrivatePrecomputedExperiment: vi.fn(),
}))
vi.mock("@/services/recommendations/precomputed/ctr-report", () => ({
  declareFixturePrecomputedCtrPolicy: mocks.declare,
  evaluatePrivatePrecomputedCtr: mocks.evaluate,
}))

import {
  createFixturePrecomputedCtrPolicy,
  evaluatePrivateCtr,
} from "./actions"

describe("private CTR evaluation action", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ id: "operator" })
  })

  it("shows bounded revision exhaustion without replacing the old report", async () => {
    mocks.evaluate.mockResolvedValue({
      status: "unavailable",
      reason: "provisional_revision_capacity_exhausted",
    })
    const form = new FormData()
    form.set("experimentId", "private-test")
    await evaluatePrivateCtr(form)
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/recommendations/precomputed/visits?experiment=private-test&evaluation=provisional_revision_capacity_exhausted",
    )
  })

  it("returns to the latest report after a saved revision", async () => {
    mocks.evaluate.mockResolvedValue({
      status: "available",
      report: { revision: 2 },
    })
    const form = new FormData()
    form.set("experimentId", "private-test")
    await evaluatePrivateCtr(form)
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/dashboard/recommendations/precomputed/visits?experiment=private-test",
    )
  })

  it("explains that an existing test with visits needs a fresh predeclared policy", async () => {
    mocks.declare.mockRejectedValue(
      new Error("precomputed_ctr_policy_must_precede_visits"),
    )
    const form = new FormData()
    form.set("experimentId", "private-test")
    for (const name of [
      "baselineHumanVisitCtr",
      "minimumDetectableAbsoluteUplift",
      "minimumPracticalAbsoluteUplift",
      "plannedPower",
      "minimumEligibleVisitsPerArm",
      "minimumIndependentBrowsersPerArm",
      "minimumDurationHours",
      "lateEventCutoffHours",
      "maximumActualFallbackRate",
      "maximumUnlinkedDeliveryRate",
    ])
      form.set(name, "1")
    await createFixturePrecomputedCtrPolicy(form)
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      "/dashboard/recommendations/precomputed/visits?experiment=private-test&evaluation=precomputed_ctr_policy_must_precede_visits",
    )
  })
})
