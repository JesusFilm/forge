/**
 * KTD2's run shape.
 *
 * The workflow directives are inert under vitest, so the body runs directly with
 * every service mocked. That proves the loop, the gates, and the order of the
 * steps. It cannot prove the production event log, which is why the structural
 * guard below pins the sequential step calls a parallel fanout would break.
 */
import { readFile } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sleeps: (Date | number)[] = []
vi.mock("workflow", () => ({
  sleep: vi.fn(async (value: Date | number) => {
    sleeps.push(value)
  }),
  getWorkflowMetadata: () => ({ workflowRunId: "runtime-1" }),
  RetryableError: class RetryableError extends Error {},
  FatalError: class FatalError extends Error {},
}))

const dispatchService = vi.hoisted(() => ({
  startPushCampaignRun: vi.fn(async () => ({
    kind: "LIVE" as const,
    groupCount: 2,
  })),
  readNextPushZoneGroup: vi.fn(),
  finishPushCampaignRun: vi.fn(async () => undefined),
  failPushCampaignRun: vi.fn(
    async (_input: {
      campaignId: string
      ledgerRunId: string
      kind: string
      error: { name: string; message: string }
    }) => undefined,
  ),
}))
vi.mock("@/services/push/dispatch", () => dispatchService)

const batchService = vi.hoisted(() => ({
  createPushBatchStore: vi.fn(() => ({ store: true })),
  runPushCampaignBatch: vi.fn(),
}))
vi.mock("@/services/push/batch", () => batchService)

const receiptService = vi.hoisted(() => ({
  createPushReceiptStore: vi.fn(() => ({ store: true })),
  reconcilePushCampaignReceipts: vi.fn(
    async (_input: { campaignId: string; minAgeMs?: number }) => ({
      status: "exhausted" as const,
      counts: { handedOff: 1, failed: 0, invalid: 0, unknown: 0, pending: 0 },
    }),
  ),
}))
vi.mock("@/services/push/receipts", () => receiptService)

const transportService = vi.hoisted(() => ({
  createPushTransport: vi.fn(() => ({ transport: true })),
  resolvePushSendConfig: vi.fn(() => ({ campaignsEnabled: true })),
}))
vi.mock("@/services/push/transport", () => transportService)

vi.mock("@/db/client", () => ({ prisma: { id: "prisma" } }))

const {
  PUSH_FINAL_RECONCILE_DELAY_MS,
  PUSH_MAX_RECONCILE_STEPS,
  PUSH_MAX_RECONCILE_STEPS_PER_GROUP,
  runPushCampaign,
  stepReconcilePushCampaignReceipts,
  stepRunPushCampaignBatch,
} = await import("./pushCampaign")
const {
  PushProviderAuthError,
  PushProviderFatalError,
  PushProviderRetryableError,
} = await import("@/services/push/errors")

const INPUT = {
  campaignId: "campaign-1",
  ledgerRunId: "ledger-1",
  kind: "LIVE" as const,
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    status: "exhausted" as const,
    nextCursor: null,
    counts: {
      audience: 1,
      claimed: 1,
      suppressed: 0,
      unreachable: 0,
      accepted: 1,
      failed: 0,
      invalid: 0,
      indeterminate: 0,
      missed: 0,
    },
    ...overrides,
  }
}

function receipts(overrides: Record<string, unknown> = {}) {
  return {
    status: "exhausted" as const,
    counts: { handedOff: 1, failed: 0, invalid: 0, unknown: 0, pending: 0 },
    ...overrides,
  }
}

/** One group ready to send, then nothing. The shape most cases start from. */
function oneGroup() {
  dispatchService.readNextPushZoneGroup
    .mockResolvedValueOnce({
      kind: "group",
      instant: "2026-10-01T00:00:00.000Z",
      zoneCount: 1,
    })
    .mockResolvedValue({ kind: "none" })
  batchService.runPushCampaignBatch.mockResolvedValue(batch())
}

beforeEach(() => {
  sleeps.length = 0
  dispatchService.startPushCampaignRun.mockClear()
  dispatchService.readNextPushZoneGroup.mockReset()
  dispatchService.finishPushCampaignRun.mockClear()
  dispatchService.failPushCampaignRun.mockClear()
  batchService.runPushCampaignBatch.mockReset()
  // A reset drops any queued once-value, so a deferred case cannot leak into the
  // next test and spin its reconcile loop to the guard.
  receiptService.reconcilePushCampaignReceipts.mockReset()
  receiptService.reconcilePushCampaignReceipts.mockResolvedValue(receipts())
})

describe("runPushCampaign", () => {
  it("sleeps to each group in order, then finishes as sent", async () => {
    dispatchService.readNextPushZoneGroup
      .mockResolvedValueOnce({
        kind: "group",
        instant: "2026-10-01T00:00:00.000Z",
        zoneCount: 1,
      })
      .mockResolvedValueOnce({
        kind: "group",
        instant: "2026-10-01T03:00:00.000Z",
        zoneCount: 2,
      })
      .mockResolvedValue({ kind: "none" })
    batchService.runPushCampaignBatch.mockResolvedValue(batch())

    const report = await runPushCampaign(INPUT)

    expect(sleeps.slice(0, 2)).toEqual([
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-10-01T03:00:00.000Z"),
    ])
    expect(report.outcome).toBe("sent")
    expect(report.groupsDispatched).toBe(2)
    expect(report.counts.accepted).toBe(2)
  })

  it("starts the run before it reads the first group", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValue({ kind: "none" })

    await runPushCampaign(INPUT)

    expect(
      dispatchService.startPushCampaignRun.mock.invocationCallOrder[0],
    ).toBeLessThan(
      dispatchService.readNextPushZoneGroup.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    )
  })

  it("follows the cursor across pages of one group", async () => {
    dispatchService.readNextPushZoneGroup
      .mockResolvedValueOnce({
        kind: "group",
        instant: "2026-10-01T00:00:00.000Z",
        zoneCount: 1,
      })
      .mockResolvedValue({ kind: "none" })
    batchService.runPushCampaignBatch
      .mockResolvedValueOnce(batch({ status: "continue", nextCursor: "reg-5" }))
      .mockResolvedValueOnce(batch({ status: "exhausted", nextCursor: null }))

    await runPushCampaign(INPUT)

    const cursors = batchService.runPushCampaignBatch.mock.calls.map(
      (call) => (call[0] as { cursor: string | null }).cursor,
    )
    expect(cursors).toEqual([null, "reg-5"])
  })

  it("resumes from the same cursor after a deferred page", async () => {
    dispatchService.readNextPushZoneGroup
      .mockResolvedValueOnce({
        kind: "group",
        instant: "2026-10-01T00:00:00.000Z",
        zoneCount: 1,
      })
      .mockResolvedValue({ kind: "none" })
    batchService.runPushCampaignBatch
      .mockResolvedValueOnce(batch({ status: "deferred", nextCursor: "reg-9" }))
      .mockResolvedValueOnce(batch({ status: "exhausted", nextCursor: null }))

    await runPushCampaign(INPUT)

    const cursors = batchService.runPushCampaignBatch.mock.calls.map(
      (call) => (call[0] as { cursor: string | null }).cursor,
    )
    expect(cursors).toEqual([null, "reg-9"])
  })

  it("stops at a cancel between pages, after reconciling the dispatched group", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValueOnce({
      kind: "group",
      instant: "2026-10-01T00:00:00.000Z",
      zoneCount: 1,
    })
    batchService.runPushCampaignBatch
      .mockResolvedValueOnce(batch({ status: "continue", nextCursor: "reg-5" }))
      .mockResolvedValueOnce(batch({ status: "cancelled", nextCursor: null }))

    const report = await runPushCampaign(INPUT)

    expect(report.outcome).toBe("cancelled")
    expect(receiptService.reconcilePushCampaignReceipts).toHaveBeenCalled()
    expect(dispatchService.readNextPushZoneGroup).toHaveBeenCalledOnce()
  })

  it("ends as paused when the flag goes off mid-group", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValueOnce({
      kind: "group",
      instant: "2026-10-01T00:00:00.000Z",
      zoneCount: 1,
    })
    batchService.runPushCampaignBatch.mockResolvedValueOnce(
      batch({
        status: "paused",
        nextCursor: null,
        counts: { ...batch().counts, missed: 4 },
      }),
    )

    const report = await runPushCampaign(INPUT)

    expect(report.outcome).toBe("paused")
    expect(report.counts.missed).toBe(4)
  })

  it("ends immediately when the campaign has already left the sending statuses", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValueOnce({
      kind: "ended",
      status: "CANCELLED",
    })

    const report = await runPushCampaign(INPUT)

    expect(report.outcome).toBe("cancelled")
    expect(batchService.runPushCampaignBatch).not.toHaveBeenCalled()
  })

  it("keeps going past a late group the group step already retired", async () => {
    dispatchService.readNextPushZoneGroup
      .mockResolvedValueOnce({
        kind: "group",
        instant: "2026-10-01T00:00:00.000Z",
        zoneCount: 1,
      })
      .mockResolvedValue({ kind: "none" })
    batchService.runPushCampaignBatch.mockResolvedValueOnce(
      batch({
        status: "late",
        nextCursor: null,
        counts: { ...batch().counts, missed: 7, accepted: 0 },
      }),
    )

    const report = await runPushCampaign(INPUT)

    expect(report.outcome).toBe("sent")
    expect(report.counts.missed).toBe(7)
  })

  it("reconciles once more after the final wait, with no age limit", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValue({ kind: "none" })

    await runPushCampaign(INPUT)

    expect(sleeps.at(-1)).toBe(PUSH_FINAL_RECONCILE_DELAY_MS)
    expect(
      receiptService.reconcilePushCampaignReceipts.mock.calls.at(-1)?.[0],
    ).toMatchObject({ campaignId: "campaign-1", minAgeMs: 0 })
  })

  it("finishes the run with the accumulated counts", async () => {
    oneGroup()

    await runPushCampaign(INPUT)

    expect(dispatchService.finishPushCampaignRun).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "campaign-1",
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        outcome: "sent",
      }),
    )
  })

  it("pauses a run that dispatched no group, rather than calling it sent", async () => {
    // Send now with an audience of zero, and a wave whose every group was already
    // retired late, both arrive here. The finish step moves only sending to sent,
    // so "sent" would leave the campaign scheduled with a succeeded ledger.
    dispatchService.readNextPushZoneGroup.mockResolvedValue({ kind: "none" })

    const report = await runPushCampaign(INPUT)

    expect(report.outcome).toBe("paused")
    expect(report.groupsDispatched).toBe(0)
    expect(dispatchService.finishPushCampaignRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "paused" }),
    )
  })

  it("still reports a cancel that ended the run before any group", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValue({
      kind: "ended",
      status: "CANCELLED",
    })

    const report = await runPushCampaign(INPUT)

    expect(report.outcome).toBe("cancelled")
  })

  it("leaves a test send that dispatched no group reading as sent", async () => {
    batchService.runPushCampaignBatch.mockResolvedValue(batch())

    const report = await runPushCampaign({ ...INPUT, kind: "TEST" })

    expect(report.groupsDispatched).toBe(0)
    expect(report.outcome).toBe("sent")
  })
})

describe("a deferred receipt reconcile", () => {
  it("resumes the final reconcile until the step is exhausted", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValue({ kind: "none" })
    receiptService.reconcilePushCampaignReceipts
      .mockResolvedValueOnce(receipts({ status: "deferred" }))
      .mockResolvedValueOnce(receipts({ status: "exhausted" }))

    const report = await runPushCampaign(INPUT)

    expect(receiptService.reconcilePushCampaignReceipts).toHaveBeenCalledTimes(
      2,
    )
    // Every resumed step's counts land in the report, so nothing is lost.
    expect(report.counts.handedOff).toBe(2)
  })

  it("stops the final reconcile at the guard when the step never exhausts", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValue({ kind: "none" })
    receiptService.reconcilePushCampaignReceipts.mockResolvedValue(
      receipts({ status: "deferred" }),
    )

    await runPushCampaign(INPUT)

    expect(receiptService.reconcilePushCampaignReceipts).toHaveBeenCalledTimes(
      PUSH_MAX_RECONCILE_STEPS,
    )
  })

  it("resumes between groups too, under its own shorter guard", async () => {
    oneGroup()
    receiptService.reconcilePushCampaignReceipts.mockResolvedValue(
      receipts({ status: "deferred" }),
    )

    await runPushCampaign(INPUT)

    expect(receiptService.reconcilePushCampaignReceipts).toHaveBeenCalledTimes(
      PUSH_MAX_RECONCILE_STEPS_PER_GROUP + PUSH_MAX_RECONCILE_STEPS,
    )
  })

  it("keeps the between-groups guard shorter than the final one", () => {
    // A wave that waited out a full final-length reconcile per group would have
    // its remaining zones retired unsent as more than three hours late.
    expect(PUSH_MAX_RECONCILE_STEPS_PER_GROUP).toBeLessThan(
      PUSH_MAX_RECONCILE_STEPS,
    )
  })
})

describe("a run that fails", () => {
  it("records the failure and rethrows, so the runtime still fails the run", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValueOnce({
      kind: "group",
      instant: "2026-10-01T00:00:00.000Z",
      zoneCount: 1,
    })
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new Error("the push provider answered UNAUTHORIZED"),
    )

    await expect(runPushCampaign(INPUT)).rejects.toThrow("UNAUTHORIZED")

    expect(dispatchService.failPushCampaignRun).toHaveBeenCalledTimes(1)
    expect(dispatchService.failPushCampaignRun).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "campaign-1",
        ledgerRunId: "ledger-1",
        kind: "LIVE",
      }),
    )
  })

  it("crosses the durable boundary with a name and a message only", async () => {
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new TypeError("something broke"),
    )
    dispatchService.readNextPushZoneGroup.mockResolvedValueOnce({
      kind: "group",
      instant: "2026-10-01T00:00:00.000Z",
      zoneCount: 1,
    })

    await runPushCampaign(INPUT).catch(() => undefined)

    const [call] = dispatchService.failPushCampaignRun.mock.calls
    const error = call[0].error
    // A raw Error does not survive the event log, so the step takes a plain
    // object it can serialize.
    expect(error).toEqual({ name: "TypeError", message: "something broke" })
    expect(error).not.toBeInstanceOf(Error)
    expect(JSON.parse(JSON.stringify(error))).toEqual(error)
  })

  it("records a failure the finish step raises", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValue({ kind: "none" })
    dispatchService.finishPushCampaignRun.mockRejectedValueOnce(
      new Error("ledger unreachable"),
    )

    await expect(runPushCampaign(INPUT)).rejects.toThrow("ledger unreachable")

    expect(dispatchService.failPushCampaignRun).toHaveBeenCalledTimes(1)
  })

  it("never records a failure on a run that finished", async () => {
    dispatchService.readNextPushZoneGroup.mockResolvedValue({ kind: "none" })

    await runPushCampaign(INPUT)

    expect(dispatchService.failPushCampaignRun).not.toHaveBeenCalled()
  })

  it("leaves the retryable mapping at the step where it belongs", async () => {
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new PushProviderRetryableError("http_429"),
    )
    const { RetryableError } = await import("workflow")

    await expect(
      stepRunPushCampaignBatch({
        campaignId: "campaign-1",
        kind: "LIVE",
        groupInstant: null,
        cursor: null,
      }),
    ).rejects.toBeInstanceOf(RetryableError)
    expect(dispatchService.failPushCampaignRun).not.toHaveBeenCalled()
  })
})

describe("a test run", () => {
  it("never reads a zone group and never sleeps to an instant", async () => {
    batchService.runPushCampaignBatch.mockResolvedValue(batch())

    const report = await runPushCampaign({ ...INPUT, kind: "TEST" })

    expect(dispatchService.readNextPushZoneGroup).not.toHaveBeenCalled()
    expect(sleeps).toEqual([PUSH_FINAL_RECONCILE_DELAY_MS])
    expect(batchService.runPushCampaignBatch).toHaveBeenCalledWith(
      {
        campaignId: "campaign-1",
        kind: "TEST",
        groupInstant: null,
        cursor: null,
      },
      expect.anything(),
    )
    expect(report.kind).toBe("TEST")
  })
})

describe("the batch step", () => {
  it("turns a retryable provider failure into a runtime retry", async () => {
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new PushProviderRetryableError("http_429"),
    )
    const { RetryableError } = await import("workflow")

    await expect(
      stepRunPushCampaignBatch({
        campaignId: "campaign-1",
        kind: "LIVE",
        groupInstant: null,
        cursor: null,
      }),
    ).rejects.toBeInstanceOf(RetryableError)
  })

  it("refuses to retry a rotated access token", async () => {
    // A 401 answers the same way every time, so five retries would claim five
    // more pages of phones and fail them all for a credential problem.
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new PushProviderAuthError("UNAUTHORIZED"),
    )
    const { FatalError, RetryableError } = await import("workflow")

    const thrown = await stepRunPushCampaignBatch({
      campaignId: "campaign-1",
      kind: "LIVE",
      groupInstant: null,
      cursor: null,
    }).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(FatalError)
    expect(thrown).not.toBeInstanceOf(RetryableError)
  })

  it("carries the app's own code across the boundary, never the provider's message", async () => {
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new PushProviderAuthError("UNAUTHORIZED"),
    )

    const thrown = await stepRunPushCampaignBatch({
      campaignId: "campaign-1",
      kind: "LIVE",
      groupInstant: null,
      cursor: null,
    }).catch((error: unknown) => error)

    expect((thrown as Error).message).toContain("provider_auth")
  })

  it("refuses to retry any other deterministic provider failure", async () => {
    // Synthetic at this seam: batch.ts absorbs a non-auth fatal per chunk today,
    // so only an auth error reaches the step. The guard covers the next one.
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new PushProviderFatalError("MESSAGE_TOO_BIG"),
    )
    const { FatalError } = await import("workflow")

    await expect(
      stepRunPushCampaignBatch({
        campaignId: "campaign-1",
        kind: "LIVE",
        groupInstant: null,
        cursor: null,
      }),
    ).rejects.toBeInstanceOf(FatalError)
  })

  it("lets a configuration failure through unchanged", async () => {
    batchService.runPushCampaignBatch.mockRejectedValueOnce(
      new Error("no destination"),
    )
    const { FatalError, RetryableError } = await import("workflow")

    const thrown = await stepRunPushCampaignBatch({
      campaignId: "campaign-1",
      kind: "LIVE",
      groupInstant: null,
      cursor: null,
    }).catch((error: unknown) => error)

    expect((thrown as Error).message).toBe("no destination")
    expect(thrown).not.toBeInstanceOf(FatalError)
    expect(thrown).not.toBeInstanceOf(RetryableError)
  })

  it("bounds its own retries", () => {
    expect(stepRunPushCampaignBatch.maxRetries).toBe(5)
    expect(stepReconcilePushCampaignReceipts.maxRetries).toBe(5)
  })
})

describe("the receipt step", () => {
  it("turns a retryable provider failure into a runtime retry", async () => {
    receiptService.reconcilePushCampaignReceipts.mockRejectedValueOnce(
      new PushProviderRetryableError("http_429"),
    )
    const { RetryableError } = await import("workflow")

    await expect(
      stepReconcilePushCampaignReceipts({
        campaignId: "campaign-1",
        minAgeMs: null,
      }),
    ).rejects.toBeInstanceOf(RetryableError)
  })

  it("passes no age limit through as undefined, so the default applies", async () => {
    await stepReconcilePushCampaignReceipts({
      campaignId: "campaign-1",
      minAgeMs: null,
    })

    expect(
      receiptService.reconcilePushCampaignReceipts.mock.calls.at(-1)?.[0],
    ).toEqual({ campaignId: "campaign-1", minAgeMs: undefined })
  })
})

describe("the workflow's step composition", () => {
  it("calls every step sequentially, never from a parallel fanout", async () => {
    const source = await readFile(
      new URL("./pushCampaign.ts", import.meta.url),
      "utf8",
    )

    expect(source).not.toMatch(/Promise\.all(Settled)?\(/)
    expect(source).not.toMatch(/\.map\(\s*\(?[^)]*\)?\s*=>\s*step[A-Z]/)
    expect(source).toMatch(/await stepRunPushCampaignBatch\(/)
    expect(source).toMatch(/await stepFailPushCampaignRun\(/)
  })

  it("keeps the durable step payloads to identifiers, a cursor, and counts", async () => {
    const source = await readFile(
      new URL("./pushCampaign.ts", import.meta.url),
      "utf8",
    )

    // A step input that carried the page itself would put phones and tokens in
    // the event log, which is what bound-payload guidance forbids.
    expect(source).not.toMatch(/registrations:/)
    expect(source).not.toMatch(/expoPushToken/)
    expect(source).not.toMatch(/timeZones:/)
  })
})
