import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadWorkflowWorkerStatusRows } from "./workflow-worker-heartbeat.service"

const queryRaw = vi.hoisted(() => vi.fn())
const executeRaw = vi.hoisted(() => vi.fn())

vi.mock("@/db/client", () => ({
  prisma: {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  },
}))

function sqlText(query: unknown) {
  if (
    query &&
    typeof query === "object" &&
    "strings" in query &&
    Array.isArray(query.strings)
  ) {
    return query.strings.join("?")
  }

  return String(query)
}

const heartbeatRow = {
  workerId: "admin:test:1",
  service: "admin",
  status: "online",
  startedAt: new Date(Date.now() - 30_000),
  lastSeenAt: new Date(),
  currentJob: null,
  currentRunId: null,
}

describe("loadWorkflowWorkerStatusRows", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps heartbeat rows available when Graphile jobs are not initialized", async () => {
    queryRaw
      .mockResolvedValueOnce([heartbeatRow])
      .mockResolvedValueOnce([{ exists: false }])

    const rows = await loadWorkflowWorkerStatusRows()

    expect(rows).toEqual([
      expect.objectContaining({
        id: "admin:test:1",
        statusLabel: "Online",
        statusTone: "success",
      }),
    ])
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })

  it("reads locked jobs from the Graphile public jobs view", async () => {
    queryRaw
      .mockResolvedValueOnce([heartbeatRow])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([
        {
          workerId: "graphile-worker-1",
          lockedJobs: 2n,
          lockedAt: new Date(),
          task: "forge_adminflows",
          queueName: null,
        },
      ])

    const rows = await loadWorkflowWorkerStatusRows()

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "graphile:graphile-worker-1",
          statusLabel: "Processing",
          detail: expect.stringContaining("2 locked job(s)"),
        }),
      ]),
    )

    const lockedJobsQuery = sqlText(queryRaw.mock.calls[2][0])
    expect(lockedJobsQuery).toContain("FROM graphile_worker.jobs")
    expect(lockedJobsQuery).not.toContain("_private_jobs")
  })
})
