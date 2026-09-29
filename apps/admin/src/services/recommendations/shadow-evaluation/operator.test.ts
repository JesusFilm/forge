import { RecommendationShadowEvaluationState } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CANDIDATE_CONTEXT_VERSION,
  CANDIDATE_ELIGIBILITY_VERSION,
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
} from "../candidate"
import { HYBRID_PERSONALIZED_MANIFEST_ID } from "../promotion/manifest"
import { HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY } from "./job"

const createShadowEvaluation = vi.hoisted(() => vi.fn())
const dispatchRecommendationShadowEvaluation = vi.hoisted(() => vi.fn())

vi.mock("./service", () => ({ createShadowEvaluation }))
vi.mock("./job", async (importOriginal) => {
  const original = await importOriginal<typeof import("./job")>()
  return { ...original, dispatchRecommendationShadowEvaluation }
})

import {
  startExactCowatchShadowEvaluation,
  startExactHybridShadowEvaluation,
} from "./operator"
import { COWATCH_SHADOW_GENERATOR_KEY } from "../cowatch/graph"

const NOW = new Date("2026-08-30T12:00:00.000Z")
const WINDOW_START = new Date("2026-08-29T00:00:00.000Z")
const WINDOW_END = new Date("2026-08-30T00:00:00.000Z")
const EVALUATION_ID = "11111111-1111-4111-8111-111111111111"
const GENERATION_ID = "a".repeat(64)

function prisma(existing: unknown = null) {
  return {
    recommendationShadowEvaluation: {
      findUnique: vi.fn().mockResolvedValue(existing),
    },
  }
}

function input() {
  return {
    evaluationId: EVALUATION_ID,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    requestedSampleSize: 500,
    minimumRuns: 200,
    actorId: "admin-1",
    now: NOW,
  }
}

function exactEvaluation(overrides: Record<string, unknown> = {}) {
  return {
    id: EVALUATION_ID,
    manifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
    generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
    contextVersion: CANDIDATE_CONTEXT_VERSION,
    eligibilityVersion: CANDIDATE_ELIGIBILITY_VERSION,
    state: RecommendationShadowEvaluationState.ACTIVE,
    generation: 1,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    requestedSampleSize: 500,
    manifest: { enabled: true },
    ...overrides,
  }
}

describe("exact hybrid shadow evaluation operator", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createShadowEvaluation.mockResolvedValue(exactEvaluation())
    dispatchRecommendationShadowEvaluation.mockResolvedValue({
      queued: true,
      state: "attached",
      reused: false,
      ledgerRunId: "ledger-1",
      runId: "runtime-1",
    })
  })

  it("commits the exact hybrid evaluation before dispatching its workflow", async () => {
    const client = prisma()
    client.recommendationShadowEvaluation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(exactEvaluation())

    await expect(
      startExactHybridShadowEvaluation(client as never, input()),
    ).resolves.toMatchObject({
      status: "queued",
      evaluationId: EVALUATION_ID,
      created: true,
    })

    expect(createShadowEvaluation).toHaveBeenCalledWith(client, {
      evaluationId: EVALUATION_ID,
      manifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
      generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
      contextVersion: CANDIDATE_CONTEXT_VERSION,
      eligibilityVersion: CANDIDATE_ELIGIBILITY_VERSION,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      requestedSampleSize: 500,
      now: NOW,
    })
    expect(createShadowEvaluation).toHaveBeenCalledBefore(
      dispatchRecommendationShadowEvaluation,
    )
    expect(dispatchRecommendationShadowEvaluation).toHaveBeenCalledWith(
      {
        evaluationId: EVALUATION_ID,
        expectedGeneration: 1,
        generatorKey: HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
        minimumRuns: 200,
      },
      { actorId: "admin-1", client, now: NOW },
    )
  })

  it.each([
    ["uncertain", true, "dispatch_uncertain"],
    ["terminal", true, "terminal"],
    ["running", true, "already_dispatched"],
  ])(
    "exposes a %s dispatch receipt without reinterpreting it",
    async (state, reused, status) => {
      const client = prisma(
        exactEvaluation({
          generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
          cowatchGenerationId: GENERATION_ID,
        }),
      )
      dispatchRecommendationShadowEvaluation.mockResolvedValueOnce({
        state,
        reused,
        queued: state === "running",
        ledgerRunId: "ledger-1",
        runId: null,
      })
      await expect(
        startExactCowatchShadowEvaluation(client as never, {
          ...input(),
          cowatchGenerationId: GENERATION_ID,
        }),
      ).resolves.toMatchObject({ status, created: false, dispatch: { state } })
      expect(createShadowEvaluation).not.toHaveBeenCalled()
    },
  )

  it("refuses a changed graph or a legacy unpinned evaluation without dispatch", async () => {
    for (const cowatchGenerationId of [null, "b".repeat(64)]) {
      const client = prisma(
        exactEvaluation({
          generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
          cowatchGenerationId,
        }),
      )
      await expect(
        startExactCowatchShadowEvaluation(client as never, {
          ...input(),
          cowatchGenerationId: GENERATION_ID,
        }),
      ).rejects.toThrow("does not match")
    }
    expect(createShadowEvaluation).not.toHaveBeenCalled()
    expect(dispatchRecommendationShadowEvaluation).not.toHaveBeenCalled()
  })

  it("requires an explicit graph identity before creating a co-watch evaluation", async () => {
    await expect(
      startExactCowatchShadowEvaluation(prisma() as never, {
        ...input(),
        cowatchGenerationId: "latest",
      }),
    ).rejects.toThrow("exact graph")
    expect(createShadowEvaluation).not.toHaveBeenCalled()
    expect(dispatchRecommendationShadowEvaluation).not.toHaveBeenCalled()
  })

  it("rejects retries whose immutable evaluation parameters do not match", async () => {
    const client = prisma(exactEvaluation({ requestedSampleSize: 499 }))

    await expect(
      startExactHybridShadowEvaluation(client as never, input()),
    ).rejects.toThrow("does not match")
    expect(dispatchRecommendationShadowEvaluation).not.toHaveBeenCalled()
  })

  it("rejects open event windows and impossible completion thresholds", async () => {
    const client = prisma()

    await expect(
      startExactHybridShadowEvaluation(client as never, {
        ...input(),
        windowEnd: new Date("2026-08-30T12:01:01.000Z"),
      }),
    ).rejects.toThrow("closed")
    await expect(
      startExactHybridShadowEvaluation(client as never, {
        ...input(),
        minimumRuns: 501,
      }),
    ).rejects.toThrow("cannot exceed")
    expect(createShadowEvaluation).not.toHaveBeenCalled()
  })
})
