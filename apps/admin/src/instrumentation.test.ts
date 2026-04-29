import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    NEXT_RUNTIME: "nodejs" as "nodejs" | "edge" | undefined,
    WORKFLOW_TARGET_WORLD: undefined as
      | "local"
      | "@workflow/world-postgres"
      | undefined,
  },
}))

const worldStart = vi.hoisted(() => vi.fn())
const getWorld = vi.hoisted(() => vi.fn(() => ({ start: worldStart })))

vi.mock("@/config/env", () => mockEnv)
vi.mock("workflow/runtime", () => ({ getWorld }))

describe("workflow instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.env.NEXT_RUNTIME = "nodejs"
    mockEnv.env.WORKFLOW_TARGET_WORLD = undefined
  })

  it("does not start a world when Postgres World is not selected", async () => {
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(false)
    await register()

    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
  })

  it("does not start a world in the edge runtime", async () => {
    mockEnv.env.NEXT_RUNTIME = "edge"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(false)
    await register()

    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
  })

  it("starts Postgres World in the node runtime", async () => {
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(true)
    await register()

    expect(getWorld).toHaveBeenCalledTimes(1)
    expect(worldStart).toHaveBeenCalledTimes(1)
  })
})
