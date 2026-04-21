import { beforeEach, describe, expect, it, vi } from "vitest"

import { createManagerClientFromEnv } from "./manager-client"

const fetchMock = vi.fn()

vi.stubGlobal("fetch", fetchMock)

const automation = {
  documentId: "automation-1",
  name: "Dry run metadata",
  template: "metadata_missing",
  status: "active",
  runMode: "dry_run" as const,
  schedule: { kind: "every_minute", timezone: "UTC" },
  refreshMode: "missing_only" as const,
  targetLanguageIds: [],
  maxVideosPerRun: 1,
  nextRunAt: "2026-04-12T09:00:00.000Z",
}

describe("createManagerClientFromEnv", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it("posts the automation run mode and normalizes dry-run reports", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        eligibleCount: 2,
        enqueuedCount: 0,
        skippedDuplicateCount: 1,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
        dryRunReport: {
          kind: "metadata",
          data: { runMode: "dry_run", wouldEnqueueCount: 1 },
        },
        summary: "Dry-run complete.",
      }),
    })

    const client = createManagerClientFromEnv({
      MANAGER_INTERNAL_URL: "http://manager.example.test/",
      MANAGER_API_KEY: "secret",
    })

    await expect(
      client.enqueueAutomationRun({
        runDocumentId: "run-1",
        automation,
      }),
    ).resolves.toMatchObject({
      runMode: "dry_run",
      report: {
        kind: "metadata",
        data: { runMode: "dry_run", wouldEnqueueCount: 1 },
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { body: string },
    ]
    expect(url).toBe(
      "http://manager.example.test/api/automations/runs/run-1/enqueue",
    )
    expect(JSON.parse(init.body)).toEqual({ automation })
  })

  it("prefers an explicit report when the Manager returns one", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        runMode: "dry_run",
        status: "success",
        eligibleCount: 1,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
        report: {
          kind: "metadata",
          data: { runMode: "dry_run", wouldEnqueueCount: 1 },
        },
        summary: "Dry-run complete.",
      }),
    })

    const client = createManagerClientFromEnv({
      MANAGER_INTERNAL_URL: "http://manager.example.test",
      MANAGER_API_KEY: "secret",
    })

    await expect(
      client.enqueueAutomationRun({
        runDocumentId: "run-2",
        automation: { ...automation, documentId: "automation-2" },
      }),
    ).resolves.toMatchObject({
      runMode: "dry_run",
      report: {
        kind: "metadata",
        data: { runMode: "dry_run", wouldEnqueueCount: 1 },
      },
    })
  })
})
