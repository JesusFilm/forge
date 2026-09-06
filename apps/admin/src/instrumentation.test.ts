import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    NEXT_RUNTIME: "nodejs" as "nodejs" | "edge" | undefined,
    WORKFLOW_RUNNER_ENABLED: "false" as "true" | "false" | undefined,
    WORKFLOW_TARGET_WORLD: undefined as
      | "local"
      | "@workflow/world-postgres"
      | undefined,
    WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS: 12,
    RECOMMENDATION_RECOVERY_MAX_ATTEMPTS: 12,
    WORKFLOW_STARTUP_TRANSIENT_DELAY_MS: 10_000,
  },
}))

const worldStart = vi.hoisted(() => vi.fn())
const getWorld = vi.hoisted(() => vi.fn(() => ({ start: worldStart })))
const startWorkflowWorkerHeartbeat = vi.hoisted(() => vi.fn())
const ensureCoreSyncSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureVideoDbBackupSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureSearchTraceRetentionSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureRecommendationRetentionSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureRecommendationControlReadinessSchedulerStarted = vi.hoisted(() =>
  vi.fn(),
)
const ensureRecommendationEpisodeFinalizationRecovery = vi.hoisted(() =>
  vi.fn(),
)
const prewarmWatchSearchQueryEmbeddings = vi.hoisted(() => vi.fn())
const prisma = vi.hoisted(() => ({ id: "mock-prisma" }))

function clearWorkflowStartupState() {
  const workflowGlobal = globalThis as typeof globalThis & {
    __forgeAdminWorkflowStartup?: {
      retryTimer?: ReturnType<typeof setTimeout>
    }
    __forgeAdminWatchSearchPrewarm?: unknown
    __forgeAdminRecommendationRecovery?: {
      retryTimer?: ReturnType<typeof setTimeout>
    }
  }
  if (workflowGlobal.__forgeAdminWorkflowStartup?.retryTimer) {
    clearTimeout(workflowGlobal.__forgeAdminWorkflowStartup.retryTimer)
  }
  delete workflowGlobal.__forgeAdminWorkflowStartup
  delete workflowGlobal.__forgeAdminWatchSearchPrewarm
  if (workflowGlobal.__forgeAdminRecommendationRecovery?.retryTimer) {
    clearTimeout(workflowGlobal.__forgeAdminRecommendationRecovery.retryTimer)
  }
  delete workflowGlobal.__forgeAdminRecommendationRecovery
}

vi.mock("@/config/env", () => mockEnv)
vi.mock("workflow/runtime", () => ({ getWorld }))
vi.mock("@/services/workflow-worker-heartbeat.service", () => ({
  startWorkflowWorkerHeartbeat,
}))
vi.mock("@/services/core-sync/job", () => ({
  ensureCoreSyncSchedulerStarted,
}))
vi.mock("@/services/video-db-backup/job", () => ({
  ensureVideoDbBackupSchedulerStarted,
}))
vi.mock("@/services/search-trace-retention/job", () => ({
  ensureSearchTraceRetentionSchedulerStarted,
}))
vi.mock("@/services/recommendations/retention/job", () => ({
  ensureRecommendationRetentionSchedulerStarted,
}))
vi.mock("@/services/recommendations/control-readiness/job", () => ({
  ensureRecommendationControlReadinessSchedulerStarted,
}))
vi.mock("@/services/recommendations/finalization/job", () => ({
  ensureRecommendationEpisodeFinalizationRecovery,
}))
vi.mock("@/services/watch-search.service", () => ({
  prewarmWatchSearchQueryEmbeddings,
}))
vi.mock("@/db/client", () => ({ prisma }))

describe("workflow instrumentation", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    worldStart.mockReset()
    getWorld.mockReset()
    getWorld.mockImplementation(() => ({ start: worldStart }))
    startWorkflowWorkerHeartbeat.mockReset()
    ensureCoreSyncSchedulerStarted.mockReset()
    ensureVideoDbBackupSchedulerStarted.mockReset()
    ensureSearchTraceRetentionSchedulerStarted.mockReset()
    ensureRecommendationRetentionSchedulerStarted.mockReset()
    ensureRecommendationControlReadinessSchedulerStarted.mockReset()
    ensureRecommendationEpisodeFinalizationRecovery.mockReset()
    prewarmWatchSearchQueryEmbeddings.mockReset()
    prewarmWatchSearchQueryEmbeddings.mockResolvedValue(undefined)
    clearWorkflowStartupState()
    process.env.NEXT_RUNTIME = "nodejs"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "false"
    mockEnv.env.WORKFLOW_TARGET_WORLD = undefined
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS = 12
    mockEnv.env.RECOMMENDATION_RECOVERY_MAX_ATTEMPTS = 12
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS = 10_000
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
    expect(ensureCoreSyncSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureVideoDbBackupSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureSearchTraceRetentionSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureRecommendationRetentionSchedulerStarted).not.toHaveBeenCalled()
    expect(
      ensureRecommendationControlReadinessSchedulerStarted,
    ).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prewarmWatchSearchQueryEmbeddings).toHaveBeenCalledTimes(1)
    expect(prewarmWatchSearchQueryEmbeddings).toHaveBeenCalledWith({ prisma })
  })

  it("starts watch search embedding prewarm only once per process", async () => {
    const { register } = await import("./instrumentation")

    await register()
    await register()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(prewarmWatchSearchQueryEmbeddings).toHaveBeenCalledTimes(1)
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
    expect(ensureCoreSyncSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureVideoDbBackupSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureSearchTraceRetentionSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureRecommendationRetentionSchedulerStarted).not.toHaveBeenCalled()
    expect(
      ensureRecommendationControlReadinessSchedulerStarted,
    ).not.toHaveBeenCalled()
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
    expect(ensureCoreSyncSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureVideoDbBackupSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureSearchTraceRetentionSchedulerStarted).not.toHaveBeenCalled()
    expect(ensureRecommendationRetentionSchedulerStarted).not.toHaveBeenCalled()
    expect(
      ensureRecommendationControlReadinessSchedulerStarted,
    ).not.toHaveBeenCalled()
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
    expect(ensureCoreSyncSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureVideoDbBackupSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureSearchTraceRetentionSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureRecommendationRetentionSchedulerStarted).toHaveBeenCalledTimes(
      1,
    )
    expect(
      ensureRecommendationControlReadinessSchedulerStarted,
    ).toHaveBeenCalledTimes(1)
    expect(
      ensureRecommendationEpisodeFinalizationRecovery,
    ).toHaveBeenCalledTimes(1)
  })

  it("does not block worker startup when recommendation recovery fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    ensureRecommendationEpisodeFinalizationRecovery.mockRejectedValueOnce(
      new Error("recovery unavailable"),
    )
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register } = await import("./instrumentation")

    await expect(register()).resolves.toBeUndefined()
    await Promise.resolve()

    expect(warn).toHaveBeenCalledWith(
      "[recommendation-finalization] event=recovery_start_failure error_class=Error",
    )
    warn.mockRestore()
  })

  it("retries recommendation recovery after a transient bootstrap failure", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS = 10
    ensureRecommendationEpisodeFinalizationRecovery
      .mockRejectedValueOnce(new Error("recovery unavailable"))
      .mockResolvedValueOnce(undefined)
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register } = await import("./instrumentation")

    await expect(register()).resolves.toBeUndefined()
    await Promise.resolve()
    expect(
      ensureRecommendationEpisodeFinalizationRecovery,
    ).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10)
    expect(
      ensureRecommendationEpisodeFinalizationRecovery,
    ).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it("jitters recommendation recovery backoff across replicas", async () => {
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS = 10_000
    const { recommendationRecoveryBackoffMs } =
      await import("./instrumentation")

    expect(recommendationRecoveryBackoffMs(1, () => 0)).toBe(5_000)
    expect(recommendationRecoveryBackoffMs(1, () => 1)).toBe(10_000)
    expect(recommendationRecoveryBackoffMs(7, () => 0)).toBe(30_000)
    expect(recommendationRecoveryBackoffMs(7, () => 1)).toBe(60_000)
  })

  it("stops recommendation recovery after its configured attempt ceiling", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS = 10
    mockEnv.env.RECOMMENDATION_RECOVERY_MAX_ATTEMPTS = 2
    ensureRecommendationEpisodeFinalizationRecovery.mockRejectedValue(
      new Error("recovery unavailable"),
    )
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register } = await import("./instrumentation")

    await expect(register()).resolves.toBeUndefined()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10)
    await vi.runAllTimersAsync()

    expect(
      ensureRecommendationEpisodeFinalizationRecovery,
    ).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith(
      "[recommendation-finalization] event=recovery_start_exhausted attempts=2",
    )
    warn.mockRestore()
    error.mockRestore()
  })

  it("schedules a retry instead of throwing on transient startup saturation", async () => {
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS = 1
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
    expect(ensureCoreSyncSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureVideoDbBackupSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureSearchTraceRetentionSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureRecommendationRetentionSchedulerStarted).toHaveBeenCalledTimes(
      1,
    )
    expect(
      ensureRecommendationControlReadinessSchedulerStarted,
    ).toHaveBeenCalledTimes(1)
    expect(
      ensureRecommendationEpisodeFinalizationRecovery,
    ).toHaveBeenCalledTimes(1)
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
    expect(ensureCoreSyncSchedulerStarted).not.toHaveBeenCalled()
  })
})
