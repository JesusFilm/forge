import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { CoverageAudit } from "@/services/core-sync/coverage-audit"
import type { SyncResult } from "@/services/core-sync/orchestrator"
import { runCoreSync } from "@/workflows/coreSync"

const syncPrisma = vi.hoisted(() => ({ name: "sync-prisma" }))
const runSync = vi.hoisted(() => vi.fn())
const start = vi.hoisted(() => vi.fn())
const workflowRunLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
  recordCoreSyncRunResult: vi.fn(),
}))

vi.mock("@/db/client", () => ({ syncPrisma }))
vi.mock("workflow/api", () => ({ start }))
vi.mock("@/services/workflow-run-log.service", () => workflowRunLog)
vi.mock("@/services/core-sync/orchestrator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/core-sync/orchestrator")>()
  return {
    ...actual,
    runSync,
  }
})

describe("core sync job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowRunLog.createWorkflowRunLog.mockResolvedValue({
      id: "ledger-run-1",
    })
    workflowRunLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
    workflowRunLog.markWorkflowRunFailed.mockResolvedValue(undefined)
    workflowRunLog.markWorkflowRunStarted.mockResolvedValue(undefined)
    workflowRunLog.recordCoreSyncRunResult.mockResolvedValue(undefined)
  })

  it("normalizes scheduled input to incremental all-phase sync", async () => {
    const { normalizeCoreSyncInput } = await import("./job")

    expect(normalizeCoreSyncInput({ trigger: "scheduled" })).toEqual({
      scope: [
        "languages",
        "countries",
        "keywords",
        "video-origins",
        "videos",
        "video-images",
        "video-editions",
        "video-subtitles",
        "video-dubs",
        "video-dub-downloads",
      ],
      incremental: true,
      trigger: "scheduled",
    })
  })

  it("preserves manual full-sync scope", async () => {
    const { normalizeCoreSyncInput } = await import("./job")

    expect(
      normalizeCoreSyncInput({
        scope: ["languages", "videos"],
        incremental: false,
        trigger: "manual",
      }),
    ).toEqual({
      scope: ["languages", "videos"],
      incremental: false,
      trigger: "manual",
    })
  })

  it("runs the orchestrator with syncPrisma and normalized input", async () => {
    const result = {
      incremental: false,
      phases: [],
      durationMs: 42,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(
      runCoreSyncJob({
        scope: "languages",
        incremental: false,
        trigger: "graphql",
        ledgerRunId: "ledger-run-1",
      }),
    ).resolves.toEqual({
      ...result,
      scope: ["languages"],
      trigger: "graphql",
    })
    expect(runSync).toHaveBeenCalledWith(
      syncPrisma as unknown as PrismaClient,
      {
        scope: ["languages"],
        incremental: false,
      },
    )
    expect(workflowRunLog.markWorkflowRunStarted).toHaveBeenCalledWith(
      "ledger-run-1",
    )
    expect(workflowRunLog.recordCoreSyncRunResult).toHaveBeenCalledWith(
      "ledger-run-1",
      result,
    )
  })

  it("dispatches the Core sync workflow without awaiting the run result", async () => {
    const returnValue = Promise.resolve({
      incremental: true,
      phases: [],
      durationMs: 100,
      scope: ["languages"],
      trigger: "manual",
    })
    start.mockResolvedValueOnce({ runId: "run-core-sync-1", returnValue })
    const { dispatchCoreSync } = await import("./job")

    await expect(
      dispatchCoreSync({
        scope: "languages",
        incremental: true,
        trigger: "manual",
      }),
    ).resolves.toEqual({
      workflow: "core-sync",
      runId: "run-core-sync-1",
      scope: ["languages"],
      incremental: true,
      trigger: "manual",
      status: "queued",
    })
    expect(start).toHaveBeenCalledWith(runCoreSync, [
      {
        scope: ["languages"],
        incremental: true,
        trigger: "manual",
        ledgerRunId: "ledger-run-1",
      },
    ])
    expect(workflowRunLog.createWorkflowRunLog).toHaveBeenCalledWith({
      workflowKey: "core-sync",
      workflowName: "Core Sync",
      trigger: "manual",
      subjectType: "sync",
      subjectId: "core",
      summary: "Core Sync workflow queued.",
      details: {
        scope: ["languages"],
        incremental: true,
      },
    })
    expect(workflowRunLog.attachWorkflowRuntimeRunId).toHaveBeenCalledWith(
      "ledger-run-1",
      "run-core-sync-1",
    )
  })

  it("marks the ledger failed when workflow dispatch fails", async () => {
    const boom = new Error("workflow backend unavailable")
    start.mockRejectedValueOnce(boom)
    const { dispatchCoreSync } = await import("./job")

    await expect(dispatchCoreSync({ trigger: "scheduled" })).rejects.toBe(boom)
    expect(workflowRunLog.markWorkflowRunFailed).toHaveBeenCalledWith(
      "ledger-run-1",
      boom,
    )
  })

  it("preserves lock-held skipped results", async () => {
    const result = {
      skipped: true,
      incremental: true,
      phases: [],
      durationMs: 0,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(
      runCoreSyncJob({ trigger: "scheduled" }),
    ).resolves.toMatchObject({
      skipped: true,
      incremental: true,
      scope: [
        "languages",
        "countries",
        "keywords",
        "video-origins",
        "videos",
        "video-images",
        "video-editions",
        "video-subtitles",
        "video-dubs",
        "video-dub-downloads",
      ],
      trigger: "scheduled",
    })
  })

  it("preserves coverage audit result payloads", async () => {
    const coverageAudit = {
      generatedAt: "2026-04-29T00:00:00.000Z",
      status: "pass",
      checks: [],
    } satisfies CoverageAudit
    const result = {
      incremental: true,
      phases: [],
      durationMs: 10,
      coverageAudit,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(runCoreSyncJob()).resolves.toMatchObject({
      coverageAudit,
      trigger: "manual",
    })
  })
})
