import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const projectionRun = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))
const project = vi.hoisted(() => vi.fn())
const queryRaw = vi.hoisted(() => vi.fn())
const sessionLink = vi.hoisted(() => ({ findFirst: vi.fn() }))
const transaction = vi.hoisted(() => vi.fn())
vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({
  prisma: {
    recommendationProfileProjectionRun: projectionRun,
    recommendationProfileSessionLink: sessionLink,
    $queryRaw: queryRaw,
    $transaction: transaction,
  },
}))
vi.mock("./profile-projection.service", () => ({
  createDatabaseRecommendationProfileProjectionService: () => ({ project }),
}))

import {
  dispatchRecommendationProfileFeedback,
  dispatchRecommendationProfileProjection,
  runRecommendationProfileProjectionJob,
} from "./job"
import { runRecommendationProfileProjection } from "@/workflows/recommendationProfileProjection"

beforeEach(() => {
  vi.clearAllMocks()
  projectionRun.create.mockResolvedValue({ id: "run-1", generation: 1 })
  projectionRun.findFirst.mockResolvedValue(null)
  projectionRun.findUnique.mockResolvedValue({
    id: "run-1",
    scope: "SESSION",
    profileId: null,
    privacyGeneration: null,
    sessionDigest: "a".repeat(64),
    state: "PENDING",
    generation: 1,
  })
  projectionRun.updateMany.mockResolvedValue({ count: 1 })
  queryRaw.mockResolvedValue([{ id: "profile-1" }])
  sessionLink.findFirst.mockResolvedValue({ id: "link-1" })
  transaction.mockImplementation(async (work) =>
    work({
      $queryRaw: queryRaw,
      recommendationProfileSessionLink: sessionLink,
      recommendationProfileProjectionRun: projectionRun,
    }),
  )
  project.mockResolvedValue({
    status: "published",
    generationId: "projection-1",
    generation: 1,
    replay: false,
  })
  start.mockResolvedValue({ runId: "workflow-1" })
})

describe("recommendation profile projection workflow job", () => {
  it("creates private business truth before dispatch", async () => {
    await expect(
      dispatchRecommendationProfileProjection({
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
      }),
    ).resolves.toMatchObject({ queued: true, runId: "run-1" })

    expect(projectionRun.create).toHaveBeenCalledBefore(start)
    expect(projectionRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionDigest: "a".repeat(64) }),
    })
    expect(start).toHaveBeenCalledWith(runRecommendationProfileProjection, [
      { runId: "run-1", expectedGeneration: 1 },
    ])
  })

  it("keeps projection truth pending when runtime-id recording fails after start", async () => {
    projectionRun.updateMany.mockRejectedValueOnce(
      new Error("pointer unavailable"),
    )

    await expect(
      dispatchRecommendationProfileProjection({
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
      }),
    ).resolves.toMatchObject({
      queued: true,
      workflowRunId: "workflow-1",
    })
    expect(projectionRun.updateMany).toHaveBeenCalledTimes(1)
  })

  it("marks projection truth failed when workflow start fails", async () => {
    start.mockRejectedValueOnce(new Error("runtime unavailable"))

    await expect(
      dispatchRecommendationProfileProjection({
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
      }),
    ).rejects.toThrow("runtime unavailable")
    expect(projectionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "FAILED" }),
      }),
    )
  })

  it("retains the initiating session digest privately for durable session intent", async () => {
    await dispatchRecommendationProfileProjection({
      sessionDigest: "b".repeat(64),
      profileId: "profile-1",
      privacyGeneration: 4,
    })

    expect(projectionRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: "DURABLE",
        profileId: "profile-1",
        privacyGeneration: 4,
        sessionDigest: "b".repeat(64),
      }),
    })
  })

  it("skips feedback learning when no active consented profile generation is linked", async () => {
    queryRaw.mockResolvedValueOnce([])

    await expect(
      dispatchRecommendationProfileFeedback({
        sessionDigest: "b".repeat(64),
        profileId: "profile-1",
        privacyGeneration: 4,
        evidenceWatermark: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      session: null,
      durable: null,
      skipped: "profile_generation_unavailable",
    })
    expect(projectionRun.create).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("creates only a durable run for consented profile feedback", async () => {
    await expect(
      dispatchRecommendationProfileFeedback({
        sessionDigest: "b".repeat(64),
        profileId: "profile-1",
        privacyGeneration: 4,
        evidenceWatermark: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      session: null,
      durable: { queued: true, runId: "run-1" },
      skipped: null,
    })
    expect(sessionLink.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        profileId: "profile-1",
        privacyGeneration: 4,
        sessionDigest: "b".repeat(64),
      }),
      select: { id: true },
    })
    expect(projectionRun.create).toHaveBeenCalledTimes(1)
    expect(projectionRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: "DURABLE",
        profileId: "profile-1",
        privacyGeneration: 4,
      }),
    })
  })

  it("coalesces repeat status wakes for the same exact private scope", async () => {
    projectionRun.findFirst.mockResolvedValueOnce({
      id: "run-existing",
      workflowRunId: "workflow-existing",
    })

    await expect(
      dispatchRecommendationProfileProjection({
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
      }),
    ).resolves.toMatchObject({
      runId: "run-existing",
      workflowRunId: "workflow-existing",
      coalesced: true,
    })
    expect(projectionRun.create).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("recovers a pending run left before workflow dispatch was recorded", async () => {
    projectionRun.findFirst.mockResolvedValueOnce({
      id: "run-recovery",
      generation: 2,
      workflowRunId: null,
      state: "PENDING",
    })

    await expect(
      dispatchRecommendationProfileProjection({
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
      }),
    ).resolves.toMatchObject({
      runId: "run-recovery",
      workflowRunId: "workflow-1",
      coalesced: false,
    })

    expect(projectionRun.create).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith(runRecommendationProfileProjection, [
      { runId: "run-recovery", expectedGeneration: 2 },
    ])
  })

  it("claims, publishes and completes with generation fencing", async () => {
    await expect(
      runRecommendationProfileProjectionJob({
        runId: "run-1",
        expectedGeneration: 1,
      }),
    ).resolves.toMatchObject({
      status: "published",
      generationId: "projection-1",
    })

    expect(projectionRun.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: "run-1",
          generation: 1,
          state: "PENDING",
        }),
        data: expect.objectContaining({ state: "CLAIMED" }),
      }),
    )
    expect(projectionRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "COMPLETED",
          projectionId: "projection-1",
        }),
      }),
    )
  })

  it("does not publish after a stale run generation loses its claim", async () => {
    projectionRun.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(
      runRecommendationProfileProjectionJob({
        runId: "run-1",
        expectedGeneration: 1,
      }),
    ).resolves.toEqual({ status: "fenced", reason: "claim_generation_changed" })
    expect(project).not.toHaveBeenCalled()
  })
})
