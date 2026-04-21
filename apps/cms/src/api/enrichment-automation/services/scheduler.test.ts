import { describe, expect, it, vi } from "vitest"

import { runDueAutomations, type SchedulerStore } from "./scheduler"
import type { ClaimedAutomation } from "./types"

function createStore(
  automations: ClaimedAutomation[],
): SchedulerStore & { runs: Array<Record<string, unknown>> } {
  const runs: Array<Record<string, unknown>> = []

  return {
    runs,
    async claimNextDueAutomation(now, leaseToken, leaseExpiresAt) {
      const automation = automations.find((candidate) => {
        if (candidate.status !== "active") return false
        if (!candidate.nextRunAt || new Date(candidate.nextRunAt) > now) {
          return false
        }
        if (
          candidate.leaseExpiresAt &&
          new Date(candidate.leaseExpiresAt) > now
        ) {
          return false
        }
        return true
      })
      if (!automation) return null
      automation.leaseToken = leaseToken
      automation.leaseExpiresAt = leaseExpiresAt.toISOString()
      return automation
    },
    async createRunAttempt(input) {
      const run = { documentId: `run-${runs.length + 1}`, ...input }
      runs.push(run)
      return run
    },
    async completeRunAttempt(documentId, input) {
      const run = runs.find((candidate) => candidate.documentId === documentId)
      Object.assign(run ?? {}, input)
    },
    async completeAutomationCycle(documentId, input) {
      const automation = automations.find(
        (candidate) => candidate.documentId === documentId,
      )
      Object.assign(automation ?? {}, input, {
        leaseToken: null,
        leaseExpiresAt: null,
      })
    },
  }
}

const dueAutomation: ClaimedAutomation = {
  documentId: "automation-1",
  name: "Missing subtitles",
  template: "target_subtitles_missing",
  status: "active",
  runMode: "live",
  schedule: { kind: "every_minute", timezone: "UTC" },
  refreshMode: "missing_only",
  targetLanguageIds: ["529"],
  maxVideosPerRun: 1,
  nextRunAt: "2026-04-12T09:00:00.000Z",
  leaseToken: null,
  leaseExpiresAt: null,
}

describe("runDueAutomations", () => {
  it("claims one due active automation, creates a run, dispatches, and advances the schedule", async () => {
    const automation = { ...dueAutomation }
    const store = createStore([automation])
    const managerClient = {
      enqueueAutomationRun: vi.fn().mockResolvedValue({
        runMode: "live",
        status: "success",
        eligibleCount: 2,
        enqueuedCount: 1,
        skippedDuplicateCount: 1,
        errorCount: 0,
        jobDocumentIds: ["job-1"],
        errors: [],
        report: null,
        summary: "Enqueued 1 job.",
      }),
    }

    const result = await runDueAutomations({
      store,
      managerClient,
      now: new Date("2026-04-12T09:00:30.000Z"),
    })

    expect(result).toEqual({ claimed: 1 })
    expect(managerClient.enqueueAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        automation,
        runDocumentId: "run-1",
      }),
    )
    expect(store.runs[0]).toMatchObject({
      documentId: "run-1",
      runMode: "live",
      status: "success",
      enqueuedCount: 1,
      skippedDuplicateCount: 1,
      jobDocumentIds: ["job-1"],
    })
    expect(automation.status).toBe("active")
    expect(automation.leaseToken).toBeNull()
    expect(automation.leaseExpiresAt).toBeNull()
    expect(automation.nextRunAt).toBe("2026-04-12T09:01:00.000Z")
    expect(automation.lastRunStatus).toBe("success")
  })

  it("skips paused automations and automations with active leases", async () => {
    const store = createStore([
      { ...dueAutomation, documentId: "paused", status: "paused" },
      {
        ...dueAutomation,
        documentId: "leased",
        leaseExpiresAt: "2026-04-12T09:10:00.000Z",
      },
    ])
    const managerClient = { enqueueAutomationRun: vi.fn() }

    const result = await runDueAutomations({
      store,
      managerClient,
      now: new Date("2026-04-12T09:00:30.000Z"),
    })

    expect(result).toEqual({ claimed: 0 })
    expect(managerClient.enqueueAutomationRun).not.toHaveBeenCalled()
    expect(store.runs).toEqual([])
  })

  it("records an empty backlog as no-op and keeps the automation active", async () => {
    const automation = { ...dueAutomation }
    const store = createStore([automation])
    const managerClient = {
      enqueueAutomationRun: vi.fn().mockResolvedValue({
        runMode: "live",
        status: "no_op",
        eligibleCount: 0,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
        report: null,
        summary: "No eligible videos.",
      }),
    }

    await runDueAutomations({
      store,
      managerClient,
      now: new Date("2026-04-12T09:00:30.000Z"),
    })

    expect(store.runs[0]).toMatchObject({
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
    })
    expect(automation.status).toBe("active")
    expect(automation.lastRunStatus).toBe("no_op")
    expect(automation.nextRunAt).toBe("2026-04-12T09:01:00.000Z")
  })

  it("does not overwrite successful dispatch state when automation completion needs a retry", async () => {
    const automation = { ...dueAutomation }
    const store = createStore([automation])
    const completeAutomationCycle = vi.spyOn(store, "completeAutomationCycle")
    completeAutomationCycle.mockRejectedValueOnce(new Error("database timeout"))
    const managerClient = {
      enqueueAutomationRun: vi.fn().mockResolvedValue({
        runMode: "live",
        status: "success",
        eligibleCount: 1,
        enqueuedCount: 1,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: ["job-1"],
        errors: [],
        report: null,
        summary: "Enqueued 1 job.",
      }),
    }

    await runDueAutomations({
      store,
      managerClient,
      now: new Date("2026-04-12T09:00:30.000Z"),
    })

    expect(managerClient.enqueueAutomationRun).toHaveBeenCalledTimes(1)
    expect(store.runs[0]).toMatchObject({
      status: "success",
      enqueuedCount: 1,
      jobDocumentIds: ["job-1"],
    })
    expect(completeAutomationCycle).toHaveBeenCalledTimes(2)
    expect(automation.leaseToken).toBeNull()
    expect(automation.leaseExpiresAt).toBeNull()
    expect(automation.lastRunStatus).toBe("success")
    expect(automation.nextRunAt).toBe("2026-04-12T09:01:00.000Z")
  })

  it("persists dry-run reports while still advancing the schedule", async () => {
    const automation = {
      ...dueAutomation,
      documentId: "automation-dry-run",
      runMode: "dry_run" as const,
    }
    const store = createStore([automation])
    const managerClient = {
      enqueueAutomationRun: vi.fn().mockResolvedValue({
        runMode: "dry_run",
        status: "success",
        eligibleCount: 2,
        enqueuedCount: 0,
        skippedDuplicateCount: 1,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
        report: {
          kind: "metadata",
          data: {
            runMode: "dry_run",
            wouldEnqueueCount: 1,
          },
        },
        summary: "Dry-run complete.",
      }),
    }

    await runDueAutomations({
      store,
      managerClient,
      now: new Date("2026-04-12T09:00:30.000Z"),
    })

    expect(managerClient.enqueueAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        automation,
        runDocumentId: "run-1",
      }),
    )
    expect(store.runs[0]).toMatchObject({
      documentId: "run-1",
      runMode: "dry_run",
      status: "success",
      enqueuedCount: 0,
      skippedDuplicateCount: 1,
      report: {
        kind: "metadata",
        data: {
          runMode: "dry_run",
          wouldEnqueueCount: 1,
        },
      },
      summary: "Dry-run complete.",
    })
    expect(automation.nextRunAt).toBe("2026-04-12T09:01:00.000Z")
    expect(automation.lastRunStatus).toBe("success")
  })
})
