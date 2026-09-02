import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
}))
const recommendationPlaybackEpisode = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
}))
const recommendationEvidenceAudit = vi.hoisted(() => ({ create: vi.fn() }))
const queryRaw = vi.hoisted(() => vi.fn())
const recoveryTransaction = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  workflowRun: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}))
const prismaTransaction = vi.hoisted(() => vi.fn())
const workflowLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunRuntimeStarted: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
}))
const finalize = vi.hoisted(() => vi.fn())
const classifyPlaybackOutcome = vi.hoisted(() => vi.fn())
const dispatchRecommendationProfileFeedback = vi.hoisted(() => vi.fn())
const recommendationOutcomeRevision = vi.hoisted(() => ({
  findUnique: vi.fn(),
}))
const recommendationProfileSessionLink = vi.hoisted(() => ({
  findFirst: vi.fn(),
}))

vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({
  prisma: {
    workflowRun,
    recommendationPlaybackEpisode,
    recommendationEvidenceAudit,
    recommendationOutcomeRevision,
    recommendationProfileSessionLink,
    $queryRaw: queryRaw,
    $transaction: prismaTransaction,
  },
}))
vi.mock("@/services/workflow-run-log.service", () => workflowLog)
vi.mock("@/services/recommendations/outcome.service", () => ({
  createRecommendationOutcomeService: vi.fn(() => ({ finalize })),
}))
vi.mock("@/services/recommendations/integrity.service", () => ({
  createRecommendationIntegrityService: vi.fn(() => ({
    classifyPlaybackOutcome,
  })),
}))
vi.mock("@/services/recommendations/profiles/job", () => ({
  dispatchRecommendationProfileFeedback,
}))

import {
  dispatchRecommendationEpisodeFinalization,
  ensureRecommendationEpisodeFinalizationRecovery,
  recoverRecommendationEpisodeFinalizations,
  runRecommendationEpisodeFinalizationJob,
} from "./job"
import {
  runRecommendationEpisodeFinalization,
  runRecommendationEpisodeFinalizationRecovery,
} from "@/workflows/recommendationEpisodeFinalization"

beforeEach(() => {
  vi.clearAllMocks()
  workflowLog.createWorkflowRunLog.mockResolvedValue({ id: "ledger-1" })
  start.mockResolvedValue({ runId: "runtime-1" })
  workflowLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
  workflowLog.markWorkflowRunFailed.mockResolvedValue(undefined)
  workflowLog.markWorkflowRunStarted.mockResolvedValue(undefined)
  workflowRun.update.mockResolvedValue({})
  workflowRun.findFirst.mockResolvedValue(null)
  workflowRun.findMany.mockResolvedValue([])
  recoveryTransaction.$queryRaw.mockResolvedValue([{ locked: true }])
  recoveryTransaction.workflowRun.findFirst.mockResolvedValue(null)
  recoveryTransaction.workflowRun.update.mockResolvedValue({})
  prismaTransaction.mockImplementation(async (work) =>
    work(recoveryTransaction),
  )
  recommendationEvidenceAudit.create.mockResolvedValue({})
  queryRaw.mockResolvedValue([])
  classifyPlaybackOutcome.mockResolvedValue({
    state: "eligible",
    eligibleScopes: ["profile"],
  })
  dispatchRecommendationProfileFeedback.mockResolvedValue(undefined)
  recommendationOutcomeRevision.findUnique.mockResolvedValue({
    createdAt: new Date("2026-08-19T03:01:00.000Z"),
    episode: {
      sessionDigest: "a".repeat(64),
      request: {
        experimentAssignment: {
          profileId: "profile-1",
          privacyGeneration: 4,
          state: "ACTIVE",
          profile: {
            state: "ACTIVE",
            tokenDigest: "d".repeat(64),
            privacyGeneration: 4,
            expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          },
        },
      },
    },
  })
  recommendationProfileSessionLink.findFirst.mockResolvedValue({
    profileId: "profile-1",
    privacyGeneration: 4,
    profile: { privacyGeneration: 4 },
  })
  recommendationPlaybackEpisode.findUnique.mockResolvedValue({
    id: "episode-1",
    contextId: "context-1",
    requestId: "request-1",
    generation: 2,
    expiresAt: new Date("2026-09-17T03:00:00.000Z"),
    context: { expiresAt: new Date("2026-09-17T03:00:00.000Z") },
    request: { expiresAt: new Date("2026-09-17T03:00:00.000Z") },
  })
})

describe("recommendation episode finalization job", () => {
  it("creates an observable ledger before dispatch and attaches the runtime id", async () => {
    await expect(
      dispatchRecommendationEpisodeFinalization({
        episodeId: "episode-1",
        generation: 2,
        reason: "terminal-fact",
        notBefore: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).resolves.toEqual({
      queued: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledBefore(start)
    expect(start).toHaveBeenCalledWith(runRecommendationEpisodeFinalization, [
      {
        episodeId: "episode-1",
        generation: 2,
        reason: "terminal-fact",
        notBefore: "2026-08-19T03:00:00.000Z",
        ledgerRunId: "ledger-1",
      },
    ])
    expect(workflowLog.attachWorkflowRuntimeRunId).toHaveBeenCalledWith(
      "ledger-1",
      "runtime-1",
    )
  })

  it("keeps an already-started finalization queued when runtime attachment fails", async () => {
    workflowLog.attachWorkflowRuntimeRunId.mockRejectedValueOnce(
      new Error("attachment unavailable"),
    )
    await expect(
      dispatchRecommendationEpisodeFinalization({
        episodeId: "episode-1",
        generation: 2,
        reason: "terminal-fact",
        notBefore: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).resolves.toEqual({
      queued: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(workflowLog.markWorkflowRunFailed).not.toHaveBeenCalled()
    expect(recommendationEvidenceAudit.create).not.toHaveBeenCalled()
  })

  it("marks dispatch failure only when the workflow could not start", async () => {
    start.mockRejectedValueOnce(new Error("runtime unavailable"))

    await expect(
      dispatchRecommendationEpisodeFinalization({
        episodeId: "episode-1",
        generation: 2,
        reason: "terminal-fact",
        notBefore: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).rejects.toThrow("runtime unavailable")
    expect(workflowLog.markWorkflowRunFailed).toHaveBeenCalledWith(
      "ledger-1",
      expect.any(Error),
    )
    expect(recommendationEvidenceAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasonCode: "episode_finalization_dispatch_failed",
        }),
      }),
    )
  })

  it("publishes exactly through the outcome service and completes the ledger", async () => {
    finalize.mockResolvedValue({
      status: "published",
      revision: 1,
      factWatermark: 3,
    })
    await expect(
      runRecommendationEpisodeFinalizationJob({
        episodeId: "episode-1",
        generation: 2,
        reason: "terminal-fact",
        ledgerRunId: "ledger-1",
      }),
    ).resolves.toMatchObject({ status: "published" })
    expect(finalize).toHaveBeenCalledWith({
      episodeId: "episode-1",
      generation: 2,
      reason: "terminal-fact",
    })
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-1" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    })
  })

  it("classifies the active outcome and schedules the durable profile refresh", async () => {
    finalize.mockResolvedValue({
      status: "published",
      id: "legacy-outcome",
      activeOutcomeId: "active-outcome",
      revision: 1,
      factWatermark: 3,
      inputDigest: "f".repeat(64),
    })

    await runRecommendationEpisodeFinalizationJob({
      episodeId: "episode-1",
      generation: 2,
      reason: "terminal-fact",
    })

    expect(classifyPlaybackOutcome).toHaveBeenCalledWith("active-outcome")
    expect(dispatchRecommendationProfileFeedback).toHaveBeenCalledWith({
      sessionDigest: "a".repeat(64),
      profileId: "profile-1",
      privacyGeneration: 4,
      evidenceWatermark: new Date("2026-08-19T03:01:00.000Z"),
    })
  })

  it("refreshes the directly linked profile after a qualified outcome without an experiment assignment", async () => {
    finalize.mockResolvedValue({
      status: "published",
      activeOutcomeId: "direct-outcome",
      revision: 1,
      factWatermark: 3,
      inputDigest: "f".repeat(64),
    })
    recommendationOutcomeRevision.findUnique.mockResolvedValueOnce({
      createdAt: new Date("2026-08-19T03:01:00.000Z"),
      episode: {
        sessionDigest: "a".repeat(64),
      },
    })
    recommendationProfileSessionLink.findFirst.mockResolvedValueOnce({
      profileId: "profile-direct",
      privacyGeneration: 7,
      profile: { privacyGeneration: 7 },
    })

    await runRecommendationEpisodeFinalizationJob({
      episodeId: "episode-1",
      generation: 2,
      reason: "terminal-fact",
    })

    expect(dispatchRecommendationProfileFeedback).toHaveBeenCalledWith({
      sessionDigest: "a".repeat(64),
      profileId: "profile-direct",
      privacyGeneration: 7,
      evidenceWatermark: new Date("2026-08-19T03:01:00.000Z"),
    })
  })

  it("replaces a lost claim-time wake when the earlier deadline fences not-ready", async () => {
    const activeUntil = new Date("2099-08-19T10:00:00.000Z")
    finalize.mockResolvedValue({ status: "fenced", reason: "not_ready" })
    recommendationPlaybackEpisode.findUnique.mockResolvedValueOnce({
      generation: 2,
      activeUntil,
      context: { expiresAt: new Date("2099-09-17T03:00:00.000Z") },
      request: { expiresAt: new Date("2099-09-17T03:00:00.000Z") },
    })
    workflowLog.createWorkflowRunLog.mockResolvedValueOnce({
      id: "replacement-ledger",
    })

    await expect(
      runRecommendationEpisodeFinalizationJob({
        episodeId: "episode-1",
        generation: 2,
        reason: "episode-opened",
        ledgerRunId: "selection-wake-ledger",
      }),
    ).resolves.toEqual({ status: "fenced", reason: "not_ready" })

    expect(workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subjectId: { in: ["episode-1"] },
          id: { not: "selection-wake-ledger" },
          createdAt: { gte: expect.any(Date) },
        }),
      }),
    )
    expect(start).toHaveBeenCalledWith(runRecommendationEpisodeFinalization, [
      {
        episodeId: "episode-1",
        generation: 2,
        reason: "timeout",
        notBefore: activeUntil.toISOString(),
        ledgerRunId: "replacement-ledger",
      },
    ])
  })

  it("sweeps due or terminal episodes whose dispatch was lost", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "episode-timeout",
        generation: 1,
        activeUntil: new Date("2026-08-19T02:00:00.000Z"),
        finalizationDueAt: new Date("2026-08-19T02:00:00.000Z"),
        hasTerminal: false,
      },
      {
        id: "episode-terminal",
        generation: 3,
        activeUntil: new Date("2026-08-19T07:00:00.000Z"),
        finalizationDueAt: new Date("2026-08-19T02:30:00.000Z"),
        hasTerminal: true,
      },
    ])
    workflowLog.createWorkflowRunLog
      .mockResolvedValueOnce({ id: "ledger-timeout" })
      .mockResolvedValueOnce({ id: "ledger-terminal" })
    start
      .mockResolvedValueOnce({ runId: "runtime-timeout" })
      .mockResolvedValueOnce({ runId: "runtime-terminal" })

    await expect(
      recoverRecommendationEpisodeFinalizations({
        now: new Date("2026-08-19T03:00:00.000Z"),
        limit: 20,
      }),
    ).resolves.toEqual({ scanned: 2, dispatched: 2, skipped: 0, failed: 0 })
    expect(start).toHaveBeenCalledTimes(2)
    const query = queryRaw.mock.calls[0]?.[0]
    expect(query.strings.join("?")).toContain("WITH due AS MATERIALIZED")
    expect(query.strings.join("?")).toContain(
      'episode."finalization_due_at" <=',
    )
    expect(query.strings.join("?")).toContain('episode."expires_at" >')
    expect(query.strings.join("?")).toContain(
      'ORDER BY episode."finalization_due_at" ASC, episode."id" ASC',
    )
  })

  it("drains actionable recovery candidates beyond the first bounded page", async () => {
    const candidate = (index: number) => ({
      id: `episode-${String(index).padStart(3, "0")}`,
      generation: 1,
      activeUntil: new Date(Date.UTC(2026, 7, 19, 1, 0, index)),
      finalizationDueAt: new Date(Date.UTC(2026, 7, 19, 1, 0, index)),
      hasTerminal: true,
    })
    queryRaw
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, index) => candidate(index)),
      )
      .mockResolvedValueOnce(
        Array.from({ length: 25 }, (_, index) => candidate(index + 100)),
      )

    await expect(
      recoverRecommendationEpisodeFinalizations({
        now: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).resolves.toEqual({
      scanned: 125,
      dispatched: 125,
      skipped: 0,
      failed: 0,
    })
    expect(queryRaw).toHaveBeenCalledTimes(2)
    const secondQuery = queryRaw.mock.calls[1]?.[0]
    expect(secondQuery.strings.join("?")).toContain(
      '(episode."finalization_due_at", episode."id") >',
    )
    expect(start).toHaveBeenCalledTimes(125)
  })

  it("caps each recovery sweep at a bounded number of pages", async () => {
    const candidates = (page: number) =>
      Array.from({ length: 2 }, (_, index) => ({
        id: `episode-${page}-${index}`,
        generation: 1,
        activeUntil: new Date(Date.UTC(2026, 7, 19, 1, page, index)),
        finalizationDueAt: new Date(Date.UTC(2026, 7, 19, 1, page, index)),
        hasTerminal: true,
      }))
    queryRaw
      .mockResolvedValueOnce(candidates(1))
      .mockResolvedValueOnce(candidates(2))

    await expect(
      recoverRecommendationEpisodeFinalizations({
        now: new Date("2026-08-19T03:00:00.000Z"),
        limit: 2,
        maxPages: 2,
      }),
    ).resolves.toEqual({
      scanned: 4,
      dispatched: 4,
      skipped: 0,
      failed: 0,
    })
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })

  it("does not let a queued timeout run suppress a later-fact recovery wake", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "episode-finalized",
        generation: 3,
        activeUntil: new Date("2026-08-19T07:00:00.000Z"),
        finalizationDueAt: new Date("2026-08-19T02:00:00.000Z"),
        hasTerminal: true,
      },
    ])
    workflowRun.findMany.mockResolvedValue([
      {
        id: "queued-timeout",
        subjectId: "episode-finalized",
        details: { reason: "timeout" },
      },
    ])
    await expect(
      recoverRecommendationEpisodeFinalizations({
        now: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).resolves.toEqual({ scanned: 1, dispatched: 1, skipped: 0, failed: 0 })
    expect(workflowRun.findMany).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("dispatches overdue nonterminal facts as timeout work", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "episode-fact-only",
        generation: 4,
        activeUntil: new Date("2026-08-19T02:00:00.000Z"),
        finalizationDueAt: new Date("2026-08-19T02:00:00.000Z"),
        hasTerminal: false,
      },
    ])

    await expect(
      recoverRecommendationEpisodeFinalizations({
        now: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).resolves.toEqual({ scanned: 1, dispatched: 1, skipped: 0, failed: 0 })
    expect(start).toHaveBeenCalledWith(runRecommendationEpisodeFinalization, [
      expect.objectContaining({
        episodeId: "episode-fact-only",
        generation: 4,
        reason: "timeout",
      }),
    ])
  })

  it("deduplicates a terminal candidate while its recovery wake is active", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "episode-terminal",
        generation: 4,
        activeUntil: new Date("2026-08-19T02:00:00.000Z"),
        finalizationDueAt: new Date("2026-08-19T02:00:00.000Z"),
        hasTerminal: true,
      },
    ])
    workflowRun.findMany.mockResolvedValue([
      {
        id: "active-recovery",
        subjectId: "episode-terminal",
        details: { reason: "recovery" },
      },
    ])

    await expect(
      recoverRecommendationEpisodeFinalizations({
        now: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).resolves.toEqual({ scanned: 1, dispatched: 0, skipped: 1, failed: 0 })
    expect(start).not.toHaveBeenCalled()
  })

  it("skips timeout recovery when the batched ledger lookup finds active work", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "episode-timeout",
        generation: 1,
        activeUntil: new Date("2026-08-19T02:00:00.000Z"),
        finalizationDueAt: new Date("2026-08-19T02:00:00.000Z"),
        hasTerminal: false,
      },
    ])
    workflowRun.findMany.mockResolvedValue([
      {
        id: "active-timeout",
        subjectId: "episode-timeout",
        details: { reason: "episode-opened" },
      },
    ])

    await expect(
      recoverRecommendationEpisodeFinalizations({
        now: new Date("2026-08-19T03:00:00.000Z"),
      }),
    ).resolves.toEqual({ scanned: 1, dispatched: 0, skipped: 1, failed: 0 })
    expect(workflowRun.findMany).toHaveBeenCalledTimes(1)
    expect(workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workflowKey: "recommendation-episode-finalization",
          createdAt: { gte: expect.any(Date) },
        }),
      }),
    )
    expect(start).not.toHaveBeenCalled()
  })

  it("reserves one durable recovery runner across concurrent replicas", async () => {
    recoveryTransaction.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ locked: false }])
    workflowLog.createWorkflowRunLog.mockResolvedValueOnce({
      id: "recovery-ledger",
    })

    await expect(
      Promise.all([
        ensureRecommendationEpisodeFinalizationRecovery(),
        ensureRecommendationEpisodeFinalizationRecovery(),
      ]),
    ).resolves.toEqual([
      {
        started: true,
        runId: "runtime-1",
        ledgerRunId: "recovery-ledger",
      },
      { started: false },
    ])
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(
      runRecommendationEpisodeFinalizationRecovery,
      [{ ledgerRunId: "recovery-ledger" }],
    )
  })

  it("reuses the fresh durable recovery runner on repeated startup", async () => {
    recoveryTransaction.workflowRun.findFirst.mockResolvedValueOnce({
      id: "recovery-ledger",
      updatedAt: new Date("2099-08-19T03:00:00.000Z"),
    })

    await expect(
      ensureRecommendationEpisodeFinalizationRecovery(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "recovery-ledger",
    })
    expect(workflowLog.createWorkflowRunLog).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("keeps an already-started recovery runner active when attachment fails", async () => {
    workflowLog.createWorkflowRunLog.mockResolvedValueOnce({
      id: "recovery-ledger",
    })
    workflowLog.attachWorkflowRuntimeRunId.mockRejectedValueOnce(
      new Error("attachment unavailable"),
    )

    await expect(
      ensureRecommendationEpisodeFinalizationRecovery(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "recovery-ledger",
    })
    expect(workflowLog.markWorkflowRunFailed).not.toHaveBeenCalled()
  })
})
