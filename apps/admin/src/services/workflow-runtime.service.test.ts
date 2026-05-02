import { beforeEach, describe, expect, it, vi } from "vitest"

const world = vi.hoisted(() => ({
  runs: {
    list: vi.fn(),
  },
  steps: {
    list: vi.fn(),
  },
  events: {
    list: vi.fn(),
  },
}))
const getWorld = vi.hoisted(() => vi.fn(() => world))

vi.mock("workflow/runtime", () => ({ getWorld }))

describe("workflow runtime service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    world.steps.list.mockResolvedValue({ data: [{ stepId: "step-1" }] })
    world.events.list.mockResolvedValue({
      data: [{ eventId: "event-1" }, { eventId: "event-2" }],
    })
  })

  it("lists runtime runs with step and event counts", async () => {
    world.runs.list.mockResolvedValueOnce({
      data: [
        {
          runId: "runtime-run-1",
          workflowName: "workflow//./src/workflows/coreSync//runCoreSync",
          status: "completed",
          createdAt: new Date("2026-04-29T00:00:00.000Z"),
          startedAt: new Date("2026-04-29T00:00:01.000Z"),
          completedAt: new Date("2026-04-29T00:00:05.000Z"),
        },
      ],
    })
    const { loadWorkflowRuntimeRuns } =
      await import("./workflow-runtime.service")

    await expect(loadWorkflowRuntimeRuns(10)).resolves.toEqual([
      expect.objectContaining({
        runId: "runtime-run-1",
        displayName: "runCoreSync",
        status: "completed",
        stepCount: 1,
        eventCount: 2,
      }),
    ])
    expect(world.runs.list).toHaveBeenCalledWith({
      pagination: { limit: 10, sortOrder: "desc" },
      resolveData: "none",
    })
  })

  it("returns an empty list when the world is unavailable", async () => {
    getWorld.mockImplementationOnce(() => {
      throw new Error("world unavailable")
    })
    const { loadWorkflowRuntimeRuns } =
      await import("./workflow-runtime.service")

    await expect(loadWorkflowRuntimeRuns()).resolves.toEqual([])
  })
})
