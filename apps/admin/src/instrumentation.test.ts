vi.mock("@/services/core-sync/phase-execution", () => ({
  ensureCoreSyncPhaseWorkerStarted: vi.fn(),
}))
vi.mock("@/services/watch-catalog-publication-worker", () => ({
  ensureWatchCatalogPublicationWorkerStarted: vi.fn(),
}))
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    NODE_ENV: "test" as "test" | "development" | "production",
    NEXT_RUNTIME: "nodejs" as "nodejs" | "edge" | undefined,
    WORKFLOW_RUNNER_ENABLED: "false" as "true" | "false" | undefined,
    WORKFLOW_TARGET_WORLD: undefined as
      | "local"
      | "@workflow/world-postgres"
      | undefined,
    WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS: 12,
    RECOMMENDATION_RECOVERY_MAX_ATTEMPTS: 12,
    WORKFLOW_STARTUP_TRANSIENT_DELAY_MS: 10_000,
    WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED: "false" as
      | "true"
      | "false"
      | undefined,
    TYPESENSE_HOST: undefined as string | undefined,
    TYPESENSE_OPERATOR_API_KEY: undefined as string | undefined,
    EXPO_ACCESS_TOKEN: undefined as string | undefined,
  },
  resolveWatchSearchTranscriptPublicationEnabled: vi.fn(
    (value?: unknown) =>
      (value ?? mockEnv.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED) ===
      "true",
  ),
}))

const ensureStudioCalendarSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureStudioCalendarPublicationSchedulerStarted = vi.hoisted(() =>
  vi.fn(),
)
vi.mock("@/services/studio-authoring/calendar-scheduler", () => ({
  ensureStudioCalendarSchedulerStarted,
  ensureStudioCalendarPublicationSchedulerStarted,
}))

const worldStart = vi.hoisted(() => vi.fn())
const getWorld = vi.hoisted(() => vi.fn(() => ({ start: worldStart })))
const startWorkflowWorkerHeartbeat = vi.hoisted(() => vi.fn())
const ensureCoreSyncSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureVideoDbBackupSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureSearchTraceRetentionSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureRecommendationRetentionSchedulerStarted = vi.hoisted(() => vi.fn())
const ensureRecommendationCowatchRefreshSchedulerStarted = vi.hoisted(() =>
  vi.fn(),
)
const ensureRecommendationControlReadinessSchedulerStarted = vi.hoisted(() =>
  vi.fn(),
)
const ensurePlaybackObservationSnapshotBootstrapStarted = vi.hoisted(() =>
  vi.fn(),
)
const ensureRecommendationProfileReconciliationSchedulerStarted = vi.hoisted(
  () => vi.fn(),
)
const ensureRecommendationEpisodeFinalizationRecovery = vi.hoisted(() =>
  vi.fn(),
)
const ensureWatchSearchTranscriptPublicationWorkerStarted = vi.hoisted(() =>
  vi.fn(async () => ({ started: false, reason: "disabled" as const })),
)
const prewarmWatchSearchQueryEmbeddings = vi.hoisted(() => vi.fn())
const ensurePushCampaignRecovery = vi.hoisted(() =>
  vi.fn(async () => ({
    campaignsInspected: 0,
    campaignsSwept: 0,
    zonesMissed: 0,
    deliveriesMissed: 0,
    failures: 0,
  })),
)
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
    __forgeAdminProfileReconciliationRecovery?: {
      retryTimer?: ReturnType<typeof setTimeout>
    }
    __forgeAdminCowatchRefreshRecovery?: {
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
  if (workflowGlobal.__forgeAdminProfileReconciliationRecovery?.retryTimer) {
    clearTimeout(
      workflowGlobal.__forgeAdminProfileReconciliationRecovery.retryTimer,
    )
  }
  delete workflowGlobal.__forgeAdminProfileReconciliationRecovery
  if (workflowGlobal.__forgeAdminCowatchRefreshRecovery?.retryTimer)
    clearTimeout(workflowGlobal.__forgeAdminCowatchRefreshRecovery.retryTimer)
  delete workflowGlobal.__forgeAdminCowatchRefreshRecovery
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
vi.mock("@/services/recommendations/cowatch/refresh.job", () => ({
  ensureRecommendationCowatchRefreshSchedulerStarted,
}))
vi.mock("@/services/recommendations/control-readiness/job", () => ({
  ensureRecommendationControlReadinessSchedulerStarted,
}))
vi.mock("@/services/recommendations/playback-observation-snapshot.job", () => ({
  ensurePlaybackObservationSnapshotBootstrapStarted,
}))
vi.mock("@/services/recommendations/profiles/reconciliation.job", () => ({
  ensureRecommendationProfileReconciliationSchedulerStarted,
}))
vi.mock("@/services/recommendations/finalization/job", () => ({
  ensureRecommendationEpisodeFinalizationRecovery,
}))
vi.mock("@/services/typesense-watch-search-transcript-publication", () => ({
  ensureWatchSearchTranscriptPublicationWorkerStarted,
}))
vi.mock("@/services/push/recovery", () => ({ ensurePushCampaignRecovery }))
vi.mock("@/services/watch-search.service", () => ({
  prewarmWatchSearchQueryEmbeddings,
}))
vi.mock("@/db/client", () => ({ prisma, syncPrisma: prisma }))

describe("workflow instrumentation", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    ensurePushCampaignRecovery.mockClear()
    ensureStudioCalendarSchedulerStarted.mockReset()
    ensureStudioCalendarPublicationSchedulerStarted.mockReset()
    worldStart.mockReset()
    getWorld.mockReset()
    getWorld.mockImplementation(() => ({ start: worldStart }))
    startWorkflowWorkerHeartbeat.mockReset()
    ensureCoreSyncSchedulerStarted.mockReset()
    ensureVideoDbBackupSchedulerStarted.mockReset()
    ensureSearchTraceRetentionSchedulerStarted.mockReset()
    ensureRecommendationRetentionSchedulerStarted.mockReset()
    ensureRecommendationCowatchRefreshSchedulerStarted.mockReset()
    ensureRecommendationControlReadinessSchedulerStarted.mockReset()
    ensurePlaybackObservationSnapshotBootstrapStarted.mockReset()
    ensureRecommendationProfileReconciliationSchedulerStarted.mockReset()
    ensureRecommendationEpisodeFinalizationRecovery.mockReset()
    ensureWatchSearchTranscriptPublicationWorkerStarted.mockReset()
    ensureWatchSearchTranscriptPublicationWorkerStarted.mockResolvedValue({
      started: false,
      reason: "disabled",
    })
    prewarmWatchSearchQueryEmbeddings.mockReset()
    prewarmWatchSearchQueryEmbeddings.mockResolvedValue(undefined)
    clearWorkflowStartupState()
    process.env.NEXT_RUNTIME = "nodejs"
    mockEnv.env.NODE_ENV = "test"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "false"
    mockEnv.env.WORKFLOW_TARGET_WORLD = undefined
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS = 12
    mockEnv.env.RECOMMENDATION_RECOVERY_MAX_ATTEMPTS = 12
    mockEnv.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS = 10_000
    mockEnv.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED = "false"
    mockEnv.env.TYPESENSE_HOST = undefined
    mockEnv.env.TYPESENSE_OPERATOR_API_KEY = undefined
    mockEnv.env.EXPO_ACCESS_TOKEN = undefined
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
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).not.toHaveBeenCalled()
    expect(
      ensureRecommendationProfileReconciliationSchedulerStarted,
    ).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prewarmWatchSearchQueryEmbeddings).toHaveBeenCalledTimes(1)
    expect(prewarmWatchSearchQueryEmbeddings).toHaveBeenCalledWith({ prisma })
  })

  it("fails startup when transcript publication is enabled outside the dedicated Postgres worker", async () => {
    mockEnv.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED = "true"
    const { register, WorkflowStartupConfigurationError } =
      await import("./instrumentation")

    await expect(register()).rejects.toBeInstanceOf(
      WorkflowStartupConfigurationError,
    )
    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).not.toHaveBeenCalled()
    expect(prewarmWatchSearchQueryEmbeddings).not.toHaveBeenCalled()
  })

  it("refuses the Typesense operator credential on production web replicas", async () => {
    mockEnv.env.NODE_ENV = "production"
    mockEnv.env.TYPESENSE_OPERATOR_API_KEY = "operator-key"
    const { register, WorkflowStartupConfigurationError } =
      await import("./instrumentation")

    await expect(register()).rejects.toThrow(
      new WorkflowStartupConfigurationError(
        "TYPESENSE_OPERATOR_API_KEY is restricted to the dedicated Postgres worker in production",
      ),
    )
    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
    expect(prewarmWatchSearchQueryEmbeddings).not.toHaveBeenCalled()
  })

  it("refuses the Expo access token on production web replicas", async () => {
    mockEnv.env.NODE_ENV = "production"
    mockEnv.env.EXPO_ACCESS_TOKEN = "expo-access-token"
    const { register, WorkflowStartupConfigurationError } =
      await import("./instrumentation")

    await expect(register()).rejects.toThrow(
      new WorkflowStartupConfigurationError(
        "EXPO_ACCESS_TOKEN is restricted to the dedicated Postgres worker in production",
      ),
    )
    expect(getWorld).not.toHaveBeenCalled()
    expect(ensurePushCampaignRecovery).not.toHaveBeenCalled()
  })

  it("allows the Expo access token on the production worker", async () => {
    mockEnv.env.NODE_ENV = "production"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    mockEnv.env.EXPO_ACCESS_TOKEN = "expo-access-token"
    const { register } = await import("./instrumentation")

    await expect(register()).resolves.toBeUndefined()
    expect(ensurePushCampaignRecovery).toHaveBeenCalledTimes(1)
  })

  it("allows the Expo access token outside production", async () => {
    mockEnv.env.EXPO_ACCESS_TOKEN = "expo-access-token"
    const { register } = await import("./instrumentation")

    await expect(register()).resolves.toBeUndefined()
  })

  it("allows a staged operator credential on the production worker while publication remains disabled", async () => {
    mockEnv.env.NODE_ENV = "production"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    mockEnv.env.TYPESENSE_OPERATOR_API_KEY = "operator-key"
    const { register } = await import("./instrumentation")

    await expect(register()).resolves.toBeUndefined()
    expect(worldStart).toHaveBeenCalledTimes(1)
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).toHaveBeenCalledWith(prisma)
  })

  it("fails before workflow side effects when transcript publication lacks Typesense configuration", async () => {
    mockEnv.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED = "true"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, WorkflowStartupConfigurationError } =
      await import("./instrumentation")

    await expect(register()).rejects.toBeInstanceOf(
      WorkflowStartupConfigurationError,
    )
    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
    expect(startWorkflowWorkerHeartbeat).not.toHaveBeenCalled()
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).not.toHaveBeenCalled()
  })

  it("fails before workflow side effects when the publisher host is not HTTP(S)", async () => {
    mockEnv.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED = "true"
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    mockEnv.env.TYPESENSE_HOST = "file:///tmp/typesense"
    mockEnv.env.TYPESENSE_OPERATOR_API_KEY = "operator-key"
    const { register, WorkflowStartupConfigurationError } =
      await import("./instrumentation")

    await expect(register()).rejects.toBeInstanceOf(
      WorkflowStartupConfigurationError,
    )
    expect(getWorld).not.toHaveBeenCalled()
    expect(worldStart).not.toHaveBeenCalled()
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
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).not.toHaveBeenCalled()
    expect(
      ensureRecommendationProfileReconciliationSchedulerStarted,
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
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).not.toHaveBeenCalled()
    expect(
      ensureRecommendationProfileReconciliationSchedulerStarted,
    ).not.toHaveBeenCalled()
  })

  it("starts Postgres World in the node runtime", async () => {
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register, shouldStartWorkflowWorld } =
      await import("./instrumentation")

    expect(shouldStartWorkflowWorld()).toBe(true)
    await register()
    expect(ensureStudioCalendarSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(
      ensureStudioCalendarPublicationSchedulerStarted,
    ).toHaveBeenCalledTimes(1)

    expect(getWorld).toHaveBeenCalledTimes(1)
    expect(worldStart).toHaveBeenCalledTimes(1)
    expect(startWorkflowWorkerHeartbeat).toHaveBeenCalledTimes(1)
    expect(ensureCoreSyncSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureVideoDbBackupSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(ensureSearchTraceRetentionSchedulerStarted).toHaveBeenCalledTimes(1)
    expect(
      ensureRecommendationCowatchRefreshSchedulerStarted,
    ).not.toHaveBeenCalled()
    expect(ensureRecommendationRetentionSchedulerStarted).toHaveBeenCalledTimes(
      1,
    )
    expect(
      ensureRecommendationControlReadinessSchedulerStarted,
    ).toHaveBeenCalledTimes(1)
    expect(
      ensurePlaybackObservationSnapshotBootstrapStarted,
    ).toHaveBeenCalledTimes(1)
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).toHaveBeenCalledTimes(1)
    expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted,
    ).toHaveBeenCalledWith(prisma)
    expect(
      ensureRecommendationProfileReconciliationSchedulerStarted,
    ).not.toHaveBeenCalled()
    expect(
      ensureRecommendationEpisodeFinalizationRecovery,
    ).toHaveBeenCalledTimes(1)
    expect(ensurePushCampaignRecovery).toHaveBeenCalledTimes(1)
  })

  it("keeps other startup work running when playback snapshot bootstrap cannot queue", async () => {
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    ensurePlaybackObservationSnapshotBootstrapStarted.mockRejectedValueOnce(
      new Error("snapshot store unavailable"),
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { register } = await import("./instrumentation")
      await register()
      expect(
        ensureRecommendationProfileReconciliationSchedulerStarted,
      ).not.toHaveBeenCalled()
      expect(
        ensureRecommendationEpisodeFinalizationRecovery,
      ).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(
        "Playback observation bootstrap could not be queued",
        { error: "Error" },
      )
    } finally {
      warn.mockRestore()
    }
  })

  it("never starts or recovers retired behavioral learners", async () => {
    vi.useFakeTimers()
    mockEnv.env.WORKFLOW_RUNNER_ENABLED = "true"
    mockEnv.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
    const { register } = await import("./instrumentation")
    await register()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(
      ensureRecommendationProfileReconciliationSchedulerStarted,
    ).not.toHaveBeenCalled()
    expect(
      ensureRecommendationCowatchRefreshSchedulerStarted,
    ).not.toHaveBeenCalled()
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
    await vi.advanceTimersByTimeAsync(10)

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
      ensureRecommendationProfileReconciliationSchedulerStarted,
    ).not.toHaveBeenCalled()
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

describe("Admin worker Railway credential isolation", () => {
  const readers = ["TYPESENSE_API_KEY", "TYPESENSE_SEARCH_API_KEY"]
  const workerAuthority = [
    "EXPO_ACCESS_TOKEN",
    "TYPESENSE_OPERATOR_API_KEY",
    "WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED",
    "WATCH_CATALOG_PUBLICATION_ENABLED",
  ]

  function workerScripts() {
    const read = (name: string) =>
      readFileSync(
        fileURLToPath(new URL(`../${name}`, import.meta.url)),
        "utf8",
      )
    const config = read("railway.worker.toml")
    expect(config).toMatch(/^builder = "DOCKERFILE"$/m)
    expect(config).toMatch(/^dockerfilePath = "apps\/admin\/Dockerfile"$/m)
    for (const [command, script] of [
      ["preDeployCommand", "predeploy-production.sh"],
      ["startCommand", "start-production.sh"],
    ]) {
      expect(config).toContain(
        `${command} = "sh /app/apps/admin/${script} worker"`,
      )
    }
    expect(config).not.toMatch(/^buildCommand =/m)
    return {
      build: read("Dockerfile").replace(/\\\n/g, " "),
      predeploy: read("predeploy-production.sh"),
      runtime: read("start-production.sh"),
      ignore: read("Dockerfile.dockerignore"),
    }
  }

  function unsetVariables(script: string) {
    expect(script).toContain('if [ "${1:-web}" = worker ]; then')
    return (
      script
        .match(/^\s*unset ([^\n]+)$/m)?.[1]
        .trim()
        .split(/\s+/) ?? []
    )
  }

  it("keeps inherited Typesense reader credentials outside the image and both worker phases", () => {
    const scripts = workerScripts()
    for (const script of [scripts.predeploy, scripts.runtime]) {
      expect(unsetVariables(script)).toEqual(expect.arrayContaining(readers))
    }
    // Docker only receives explicitly declared build arguments. Nested env files
    // must stay outside the context copied by COPY apps/admin.
    for (const name of [...readers, ...workerAuthority]) {
      expect(scripts.build).not.toMatch(
        new RegExp(`^(?:ARG|ENV) .*\\b${name}\\b`, "m"),
      )
    }
    expect(scripts.ignore.split("\n")).toEqual(
      expect.arrayContaining(["**/.env", "**/.env.*"]),
    )
  })

  it("removes the Expo access token before pre-deploy and retains it at runtime", () => {
    const scripts = workerScripts()
    expect(unsetVariables(scripts.predeploy)).toContain("EXPO_ACCESS_TOKEN")
    expect(unsetVariables(scripts.runtime)).not.toContain("EXPO_ACCESS_TOKEN")
  })

  it("exposes Typesense operator and publication authority only to the runtime publisher", () => {
    const scripts = workerScripts()
    expect(unsetVariables(scripts.predeploy)).toEqual(
      expect.arrayContaining(workerAuthority),
    )
    expect(unsetVariables(scripts.runtime)).toEqual(readers)
  })
})
