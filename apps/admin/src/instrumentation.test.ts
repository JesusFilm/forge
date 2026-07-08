import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

function clearWorkflowStartupState() {
  const workflowGlobal = globalThis as typeof globalThis & {
    __forgeAdminWorkflowStartup?: {
      retryTimer?: ReturnType<typeof setTimeout>
    }
  }
  if (workflowGlobal.__forgeAdminWorkflowStartup?.retryTimer) {
    clearTimeout(workflowGlobal.__forgeAdminWorkflowStartup.retryTimer)
  }
  delete workflowGlobal.__forgeAdminWorkflowStartup
}

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
    vi.useRealTimers()
    vi.resetModules()
    worldStart.mockReset()
    getWorld.mockReset()
    getWorld.mockImplementation(() => ({ start: worldStart }))
    startWorkflowWorkerHeartbeat.mockReset()
    ensureVideoDbBackupSchedulerStarted.mockReset()
    ensureSearchTraceRetentionSchedulerStarted.mockReset()
    clearWorkflowStartupState()
    process.env.NEXT_RUNTIME = "nodejs"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "false"
    mockEnv.env.WORKFLOW_TARGET_WORLD = undefined
    delete process.env.WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS
    delete process.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS
  })

  afterEach(() => {
    vi.clearAllTimers()
    clearWorkflowStartupState()
    vi.useRealTimers()
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

  it("schedules a retry instead of throwing on transient startup saturation", async () => {
    process.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS = "1"
    const saturationError = Object.assign(
      new Error("sorry, too many clients already"),
      { code: "53300" },
    )
    worldStart
      .mockRejectedValueOnce(saturationError)
      .mockResolvedValueOnce(null)
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, isTransientWorkflowStartupError } =
      await import("./instrumentation")

    expect(isTransientWorkflowStartupError(saturationError)).toBe(true)
    await expect(register()).resolves.toBeUndefined()
    expect(worldStart).toHaveBeenCalledTimes(1)

    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(worldStart).toHaveBeenCalledTimes(2)
    expect(startWorkflowWorkerHeartbeat).toHaveBeenCalledTimes(1)
    expect(ensureVideoDbBackupSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureSearchTraceRetentionSchedulerStarted).toHaveBeenCalledTimes(1)
  })

  it("throws non-transient startup errors", async () => {
    const configError = new Error("workflow secret missing")
    worldStart.mockRejectedValueOnce(configError)
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, isTransientWorkflowStartupError } =
      await import("./instrumentation")

    expect(isTransientWorkflowStartupError(configError)).toBe(false)
    await expect(register()).rejects.toThrow("workflow secret missing")

    expect(worldStart).toHaveBeenCalledTimes(1)
    expect(startWorkflowWorkerHeartbeat).not.toHaveBeenCalled()
  })
})
