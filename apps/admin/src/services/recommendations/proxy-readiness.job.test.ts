import { beforeEach, describe, expect, it, vi } from "vitest"

const evaluate = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({ update: vi.fn() }))
const workflowLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
}))

vi.mock("@/db/client", () => ({ prisma: { workflowRun } }))
vi.mock("@/services/workflow-run-log.service", () => workflowLog)
vi.mock("./proxy-readiness.service", () => ({
  createPlaybackProxyReadinessService: vi.fn(() => ({ evaluate })),
}))

import {
  resolvePlaybackProxyReadinessWindow,
  runPlaybackProxyReadinessFromScheduler,
} from "./proxy-readiness.job"

describe("playback proxy readiness job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowLog.createWorkflowRunLog.mockResolvedValue({ id: "ledger-1" })
    workflowLog.markWorkflowRunStarted.mockResolvedValue(undefined)
    workflowRun.update.mockResolvedValue({})
    evaluate.mockResolvedValue({
      id: "evaluation-1",
      revision: 1,
      decision: "inconclusive",
      rankingInfluence: false,
    })
  })

  it("runs a closed seven-day offline window from the durable daily scheduler", async () => {
    const now = new Date("2026-08-19T12:34:56.000Z")

    await expect(runPlaybackProxyReadinessFromScheduler(now)).resolves.toEqual({
      ok: true,
      ledgerRunId: "ledger-1",
    })
    expect(resolvePlaybackProxyReadinessWindow(now)).toEqual({
      windowStart: new Date("2026-08-12T06:00:00.000Z"),
      windowEnd: new Date("2026-08-19T06:00:00.000Z"),
    })
    expect(evaluate).toHaveBeenCalledWith({
      windowStart: new Date("2026-08-12T06:00:00.000Z"),
      windowEnd: new Date("2026-08-19T06:00:00.000Z"),
    })
    expect(workflowRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ledger-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          details: expect.objectContaining({ rankingInfluence: false }),
        }),
      }),
    )
  })
})
