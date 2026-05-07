import { beforeEach, describe, expect, it, vi } from "vitest"

const world = vi.hoisted(() => ({
  runs: {
    list: vi.fn(),
    get: vi.fn(),
  },
  steps: {
    list: vi.fn(),
  },
  events: {
    list: vi.fn(),
    get: vi.fn(),
  },
  hooks: {
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
      hasMore: false,
      cursor: null,
    })
    world.hooks.list.mockResolvedValue({
      data: [{ hookId: "hook-1" }],
      hasMore: false,
      cursor: null,
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

  it("loads detail data for an embedded workflow trace", async () => {
    const run = {
      runId: "runtime-run-1",
      workflowName: "workflow//./src/workflows/coreSync//runCoreSync",
      status: "running",
      createdAt: new Date("2026-04-29T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T00:00:00.000Z"),
      deploymentId: "deployment-1",
      input: undefined,
      output: undefined,
      error: undefined,
    }
    world.runs.get.mockResolvedValueOnce(run)
    world.events.list.mockResolvedValueOnce({
      data: [{ runId: "runtime-run-1", eventId: "event-1" }],
      hasMore: true,
      cursor: "event-cursor",
    })
    world.steps.list.mockResolvedValueOnce({
      data: [{ runId: "runtime-run-1", stepId: "step-1" }],
      hasMore: false,
      cursor: null,
    })
    world.hooks.list.mockResolvedValueOnce({
      data: [{ runId: "runtime-run-1", hookId: "hook-1" }],
      hasMore: false,
      cursor: null,
    })
    const { loadWorkflowRuntimeRunDetail } =
      await import("./workflow-runtime.service")

    await expect(
      loadWorkflowRuntimeRunDetail("runtime-run-1"),
    ).resolves.toEqual({
      run,
      events: [{ runId: "runtime-run-1", eventId: "event-1" }],
      steps: [{ runId: "runtime-run-1", stepId: "step-1" }],
      hooks: [{ runId: "runtime-run-1", hookId: "hook-1" }],
      hasMoreEvents: true,
      hasMoreSteps: false,
      hasMoreHooks: false,
    })
    expect(world.runs.get).toHaveBeenCalledWith("runtime-run-1", {
      resolveData: "none",
    })
    expect(world.events.list).toHaveBeenCalledWith({
      runId: "runtime-run-1",
      pagination: { limit: 1000, sortOrder: "asc" },
      resolveData: "none",
    })
  })

  it("returns null when a detail run cannot be loaded", async () => {
    world.runs.get.mockRejectedValueOnce(new Error("missing run"))
    const { loadWorkflowRuntimeRunDetail } =
      await import("./workflow-runtime.service")

    await expect(
      loadWorkflowRuntimeRunDetail("missing-run"),
    ).resolves.toBeNull()
  })
})
