import { afterEach, describe, expect, it, vi } from "vitest"
import { Prisma, WorkflowRunStatus, WorkflowRunTrigger } from "@prisma/client"
import type { SyncResult } from "@/services/core-sync/orchestrator"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
  recordCoreSyncPhaseProgress,
  recordCoreSyncRunResult,
} from "./workflow-run-log.service"

function createMockClient() {
  return {
    workflowRun: {
      create: vi.fn(async (args) => ({ id: "workflow-run-1", ...args.data })),
      findUnique: vi.fn(async () => ({ details: { scope: ["videos"] } })),
      update: vi.fn(async (args) => ({ id: args.where.id, ...args.data })),
    },
    coreSyncRun: {
      upsert: vi.fn(async (args) => args.create),
    },
  }
}

describe("workflow run log service", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates queued workflow ledger rows with product context", async () => {
    const client = createMockClient()

    await createWorkflowRunLog(
      {
        workflowKey: "core-sync",
        workflowName: "Core Sync",
        trigger: "scheduled",
        subjectType: "sync",
        subjectId: "core",
        details: { incremental: true },
      },
      client as never,
    )

    expect(client.workflowRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowKey: "core-sync",
        workflowName: "Core Sync",
        trigger: WorkflowRunTrigger.SCHEDULED,
        subjectType: "sync",
        subjectId: "core",
        status: WorkflowRunStatus.QUEUED,
        details: { incremental: true },
      }),
    })
  })

  it("attaches the runtime run id after workflow dispatch", async () => {
    const client = createMockClient()

    await attachWorkflowRuntimeRunId(
      "workflow-run-1",
      "runtime-run-1",
      client as never,
    )

    expect(client.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      data: { runtimeRunId: "runtime-run-1" },
    })
  })

  it("marks workflow runs as started", async () => {
    const client = createMockClient()

    await markWorkflowRunStarted("workflow-run-1", client as never)

    expect(client.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      data: {
        status: WorkflowRunStatus.RUNNING,
        startedAt: expect.any(Date),
      },
    })
  })

  it("records Core Sync phase totals and marks success", async () => {
    const client = createMockClient()
    const result = {
      incremental: true,
      durationMs: 25,
      phases: [
        {
          phase: "languages",
          created: 1,
          updated: 2,
          softDeleted: 3,
          errors: 0,
          durationMs: 10,
        },
      ],
      coverageAudit: {
        generatedAt: "2026-04-29T00:00:00.000Z",
        status: "pass",
        checks: [],
      },
    } satisfies SyncResult

    await recordCoreSyncRunResult("workflow-run-1", result, client as never)

    expect(client.coreSyncRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workflowRunId: "workflow-run-1" },
        create: expect.objectContaining({
          workflowRunId: "workflow-run-1",
          skippedLock: false,
          incremental: true,
          createdCount: 1,
          updatedCount: 2,
          deletedCount: 3,
          errorCount: 0,
        }),
      }),
    )
    expect(client.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      data: expect.objectContaining({
        status: WorkflowRunStatus.SUCCEEDED,
        durationMs: 25,
        error: null,
      }),
    })
  })

  it("logs a Datadog-visible error summary when caught phase errors fail Core Sync", async () => {
    const client = createMockClient()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = {
      incremental: true,
      durationMs: 100,
      phases: [
        {
          phase: "videos",
          created: 0,
          updated: 0,
          softDeleted: 0,
          errors: 2,
          durationMs: 75,
        },
        {
          phase: "languages",
          created: 1,
          updated: 2,
          softDeleted: 0,
          errors: 0,
          durationMs: 25,
        },
      ],
    } satisfies SyncResult

    await recordCoreSyncRunResult("workflow-run-1", result, client as never)

    expect(client.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      data: expect.objectContaining({
        status: WorkflowRunStatus.FAILED,
        error: "One or more Core sync phases failed.",
      }),
    })
    expect(errorSpy).toHaveBeenCalledTimes(1)

    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]))
    expect(payload).toMatchObject({
      event: "core-sync.run.failed",
      workflowRunId: "workflow-run-1",
      incremental: true,
      durationMs: 100,
      totals: {
        created: 1,
        updated: 2,
        softDeleted: 0,
        errors: 2,
      },
      failedPhases: [
        {
          phase: "videos",
          created: 0,
          updated: 0,
          softDeleted: 0,
          errors: 2,
          durationMs: 75,
        },
      ],
    })
  })

  it("marks skipped lock-held Core Sync runs distinctly", async () => {
    const client = createMockClient()
    const result = {
      skipped: true,
      incremental: true,
      durationMs: 0,
      phases: [],
    } satisfies SyncResult

    await recordCoreSyncRunResult("workflow-run-1", result, client as never)

    expect(client.coreSyncRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          skippedLock: true,
          phaseSummary: [],
          coverageAudit: Prisma.JsonNull,
        }),
      }),
    )
    expect(client.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      data: expect.objectContaining({
        status: WorkflowRunStatus.SKIPPED,
        summary: "Skipped because the Core sync lock was held.",
      }),
    })
  })

  it("marks failed workflow runs with a durable error message", async () => {
    const client = createMockClient()

    await markWorkflowRunFailed(
      "workflow-run-1",
      new Error("workflow runtime down"),
      client as never,
    )

    expect(client.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      data: {
        status: WorkflowRunStatus.FAILED,
        finishedAt: expect.any(Date),
        error: "workflow runtime down",
      },
    })
  })

  it("merges Core Sync progress into existing workflow details", async () => {
    const client = createMockClient()

    await recordCoreSyncPhaseProgress(
      "workflow-run-1",
      {
        phase: "videos",
        completed: 25,
        total: 50,
        elapsedMs: 12_345,
      },
      client as never,
    )

    expect(client.workflowRun.findUnique).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      select: { details: true },
    })
    expect(client.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "workflow-run-1" },
      data: {
        details: {
          scope: ["videos"],
          coreSyncProgress: {
            phase: "videos",
            completed: 25,
            total: 50,
            elapsedMs: 12_345,
            updatedAt: expect.any(String),
          },
        },
      },
    })
  })
})
