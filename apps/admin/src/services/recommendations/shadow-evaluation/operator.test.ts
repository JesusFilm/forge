import {
  RecommendationShadowEvaluationState,
  WorkflowRunStatus,
} from "@prisma/client"
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

import { startExactHybridShadowEvaluation } from "./operator"

const NOW = new Date("2026-08-30T12:00:00.000Z")
const WINDOW_START = new Date("2026-08-29T00:00:00.000Z")
const WINDOW_END = new Date("2026-08-30T00:00:00.000Z")
const EVALUATION_ID = "11111111-1111-4111-8111-111111111111"

function prisma(existing: unknown = null, workflow: unknown = null) {
  return {
    recommendationShadowEvaluation: {
      findUnique: vi.fn().mockResolvedValue(existing),
    },
    workflowRun: {
      findFirst: vi.fn().mockResolvedValue(workflow),
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
      { actorId: "admin-1" },
    )
  })

  it("returns the durable workflow on an idempotent operator retry", async () => {
    const client = prisma(exactEvaluation(), {
      id: "ledger-1",
      runtimeRunId: "runtime-1",
      status: WorkflowRunStatus.RUNNING,
      details: { minimumRuns: 200 },
    })

    await expect(
      startExactHybridShadowEvaluation(client as never, input()),
    ).resolves.toEqual({
      status: "already_dispatched",
      evaluationId: EVALUATION_ID,
      generation: 1,
      created: false,
      dispatch: {
        queued: true,
        ledgerRunId: "ledger-1",
        runId: "runtime-1",
      },
    })
    expect(createShadowEvaluation).not.toHaveBeenCalled()
    expect(dispatchRecommendationShadowEvaluation).not.toHaveBeenCalled()
  })

  it("retries a failed dispatch without creating another evaluation", async () => {
    const client = prisma(exactEvaluation(), {
      id: "ledger-failed",
      runtimeRunId: null,
      status: WorkflowRunStatus.FAILED,
      details: { minimumRuns: 200 },
    })

    await expect(
      startExactHybridShadowEvaluation(client as never, input()),
    ).resolves.toMatchObject({ status: "queued", created: false })
    expect(createShadowEvaluation).not.toHaveBeenCalled()
    expect(dispatchRecommendationShadowEvaluation).toHaveBeenCalledOnce()
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
