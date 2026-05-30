import { beforeEach, describe, expect, it, vi } from "vitest"

const { cmsPostMock, queryMock } = vi.hoisted(() => ({
  cmsPostMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock("@/cms/client", () => ({
  default: () => ({ query: queryMock }),
}))

vi.mock("@/services/cmsClient", () => ({
  cmsPost: cmsPostMock,
}))

import {
  claimAutomationDryRun,
  getAutomation,
  getAutomationRun,
  hasInFlightAutomationRun,
  markAutomationRunFailedIfInFlight,
  releaseAutomationDryRunClaim,
} from "./automation-store"

const baseAutomation = {
  documentId: "automation-1",
  name: "Missing metadata",
  template: "metadata_missing",
  status: "active",
  runMode: "dry_run",
  schedule: { kind: "every_minute", timezone: "UTC" },
  scheduleSummary: "Every minute",
  timezone: "UTC",
  nextRunAt: "2026-04-12T09:00:00.000Z",
  refreshMode: "missing_only",
  targetLanguageIds: [],
  maxVideosPerRun: 1,
}

describe("automation-store", () => {
  beforeEach(() => {
    cmsPostMock.mockReset()
    queryMock.mockReset()
  })

  it("drops malformed dry-run reports before they reach the UI", async () => {
    queryMock.mockResolvedValue({
      data: {
        enrichmentAutomation: {
          ...baseAutomation,
          runs: [
            {
              documentId: "run-1",
              status: "success",
              runMode: "dry_run",
              scheduledFor: "2026-04-12T09:00:00.000Z",
              eligibleCount: 1,
              enqueuedCount: 0,
              skippedDuplicateCount: 0,
              errorCount: 0,
              jobDocumentIds: [],
              errors: [],
              summary: "Dry run would enqueue 1 video.",
              report: {
                kind: "metadata",
                data: {
                  runMode: "dry_run",
                  wouldEnqueueCount: 1,
                },
              },
            },
          ],
        },
      },
    })

    const automation = await getAutomation("automation-1")

    expect(automation?.runs[0]?.report).toBeNull()
  })

  it("queries in-flight runs without depending on the display-limited run slice", async () => {
    queryMock.mockResolvedValue({
      data: {
        enrichmentAutomationRuns: [{ documentId: "run-older-claimed" }],
      },
    })

    await expect(hasInFlightAutomationRun("automation-1")).resolves.toBe(true)

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          automationDocumentId: "automation-1",
          statuses: ["claimed", "running"],
        },
        fetchPolicy: "no-cache",
      }),
    )
  })

  it("reads a single automation run for completion reconciliation", async () => {
    queryMock.mockResolvedValue({
      data: {
        enrichmentAutomationRun: {
          documentId: "run-1",
          status: "success",
          runMode: "dry_run",
          scheduledFor: "2026-04-12T09:00:00.000Z",
          eligibleCount: 1,
          enqueuedCount: 0,
          skippedDuplicateCount: 0,
          errorCount: 0,
          jobDocumentIds: [],
          errors: [],
          summary: "Dry run would enqueue 1 video.",
        },
      },
    })

    const run = await getAutomationRun("run-1")

    expect(run).toMatchObject({
      documentId: "run-1",
      status: "success",
      runMode: "dry_run",
    })
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { documentId: "run-1" },
        fetchPolicy: "no-cache",
      }),
    )
  })

  it("claims and releases manual dry-run leases through CMS atomic endpoints", async () => {
    cmsPostMock
      .mockResolvedValueOnce({
        documentId: "automation-1",
        leaseToken: "lease-1",
        leaseExpiresAt: "2026-04-12T09:10:00.000Z",
      })
      .mockResolvedValueOnce({ released: true })

    await expect(claimAutomationDryRun("automation-1")).resolves.toEqual({
      documentId: "automation-1",
      leaseToken: "lease-1",
      leaseExpiresAt: "2026-04-12T09:10:00.000Z",
    })
    await expect(
      releaseAutomationDryRunClaim("automation-1", "lease-1"),
    ).resolves.toBe(true)

    expect(cmsPostMock).toHaveBeenNthCalledWith(
      1,
      "/enrichment-automation/automation-1/manual-dry-run-claim",
      {},
    )
    expect(cmsPostMock).toHaveBeenNthCalledWith(
      2,
      "/enrichment-automation/automation-1/manual-dry-run-release",
      { leaseToken: "lease-1" },
    )
  })

  it("returns null when the CMS manual dry-run claim reports a conflict", async () => {
    cmsPostMock.mockRejectedValue({ status: 409 })

    await expect(claimAutomationDryRun("automation-1")).resolves.toBeNull()
  })

  it("conditionally marks a run failed through the CMS in-flight endpoint", async () => {
    cmsPostMock.mockResolvedValue({ updated: true })

    await expect(
      markAutomationRunFailedIfInFlight({
        runDocumentId: "run-1",
        error: "database timeout",
        finishedAt: "2026-04-12T09:04:00.000Z",
      }),
    ).resolves.toBe(true)

    expect(cmsPostMock).toHaveBeenCalledWith(
      "/enrichment-automation-run/run-1/mark-failed-if-in-flight",
      {
        error: "database timeout",
        finishedAt: "2026-04-12T09:04:00.000Z",
      },
    )
  })
})
