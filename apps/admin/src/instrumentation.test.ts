import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    NEXT_RUNTIME: "nodejs" as "nodejs" | "edge" | undefined,
    WORKFLOW_RUNNER_ENABLED: "false" as "true" | "false" | undefined,
    WORKFLOW_TARGET_WORLD: undefined as
      | "local"
      | "@workflow/world-postgres"
      | undefined,
  },
}))

const worldStart = vi.hoisted(() => vi.fn())
const getWorld = vi.hoisted(() => vi.fn(() => ({ start: worldStart })))
const startWorkflowWorkerHeartbeat = vi.hoisted(() => vi.fn())
const ensureVideoDbBackupSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureSearchTraceRetentionSchedulerStarted = vi.hoisted(() => vi.fn())

vi.mock("@/config/env", () => mockEnv)
vi.mock("workflow/runtime", () => ({ getWorld }))
vi.mock("@/services/workflow-worker-heartbeat.service", () => ({
  startWorkflowWorkerHeartbeat,
}))
vi.mock("@/services/video-db-backup/job", () => ({
  ensureVideoDbBackupSchedulerStarted,
}))
vi.mock("@/services/search-trace-retention/job", () => ({
  ensureSearchTraceRetentionSchedulerStarted,
}))

describe("workflow instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_RUNTIME = "nodejs"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "false"
    mockEnv.env.WORKFLOW_TARGET_WORLD = undefined
  })

  it("does not start a world when Postgres World is not selected", async () => {
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(false)
    await register()

    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
    expect(startWorkflowWorkerHeartbeat).not.toHaveBeenCalled()
    expect(ensureVideoDbBackupSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureSearchTraceRetentionSchedulerStarted).not.toHaveBeenCalled()
  })

  it("does not start a world on web services that only read workflow data", async () => {
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "false"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(false)
    await register()

    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
    expect(startWorkflowWorkerHeartbeat).not.toHaveBeenCalled()
    expect(ensureVideoDbBackupSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureSearchTraceRetentionSchedulerStarted).not.toHaveBeenCalled()
  })

  it("does not start a world in the edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(false)
    await register()

    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
    expect(startWorkflowWorkerHeartbeat).not.toHaveBeenCalled()
    expect(ensureVideoDbBackupSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureSearchTraceRetentionSchedulerStarted).not.toHaveBeenCalled()
  })

  it("starts Postgres World in the node runtime", async () => {
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(true)
    await register()

    expect(getWorld).toHaveBeenCalledTimes(1)
    expect(worldStart).toHaveBeenCalledTimes(1)
    expect(startWorkflowWorkerHeartbeat).toHaveBeenCalledTimes(1)
    expect(ensureVideoDbBackupSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureSearchTraceRetentionSchedulerStarted).toHaveBeenCalledTimes(1)
  })
})
