import { env } from "@/config/env"

type WorkflowStartupState = {
  retryTimer?: ReturnType<typeof setTimeout>
  started: boolean
  starting: boolean
}

type WatchSearchPrewarmState = {
  started: boolean
}

type RecommendationRecoveryState = {
  retryTimer?: ReturnType<typeof setTimeout>
  started: boolean
  starting: boolean
  attempt: number
}

const TRANSIENT_WORKFLOW_STARTUP_PATTERNS = [
  /too many clients already/i,
  /remaining connection slots are reserved/i,
  /connection limit exceeded/i,
] as const

function workflowStartupGlobal() {
  return globalThis as typeof globalThis & {
    __forgeAdminWorkflowStartup?: WorkflowStartupState
    __forgeAdminWatchSearchPrewarm?: WatchSearchPrewarmState
    __forgeAdminRecommendationRecovery?: RecommendationRecoveryState
  }
}

function recommendationRecoveryState() {
  const global = workflowStartupGlobal()
  const current = global.__forgeAdminRecommendationRecovery
  if (current) return current
  const state: RecommendationRecoveryState = {
    started: false,
    starting: false,
    attempt: 0,
  }
  global.__forgeAdminRecommendationRecovery = state
  return state
}

function workflowStartupState() {
  const current = workflowStartupGlobal().__forgeAdminWorkflowStartup
  if (current) return current

  const state: WorkflowStartupState = {
    started: false,
    starting: false,
  }
  workflowStartupGlobal().__forgeAdminWorkflowStartup = state
  return state
}

function positiveIntegerValue(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function maxTransientWorkflowStartupAttempts() {
  return positiveIntegerValue(env.WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS, 12)
}

function maxRecommendationRecoveryAttempts() {
  return positiveIntegerValue(env.RECOMMENDATION_RECOVERY_MAX_ATTEMPTS, 12)
}

function transientWorkflowStartupDelayMs() {
  return positiveIntegerValue(env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS, 10_000)
}

export function recommendationRecoveryBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const cappedExponentialMs = Math.min(
    60_000,
    transientWorkflowStartupDelayMs() *
      2 ** Math.min(Math.max(0, attempt - 1), 6),
  )
  // Equal jitter prevents every Admin replica from retrying the recovery scan
  // against Postgres at the same instant after a shared outage.
  const boundedRandom = Math.min(1, Math.max(0, random()))
  return Math.ceil(cappedExponentialMs * (0.5 + boundedRandom * 0.5))
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function startWatchSearchPrewarm(): void {
  // Prewarm once per process; requests remain independent of this best-effort path.
  const global = workflowStartupGlobal()
  const state = global.__forgeAdminWatchSearchPrewarm ?? { started: false }
  global.__forgeAdminWatchSearchPrewarm = state
  if (state.started) return

  state.started = true
  void import("@/services/watch-search.service")
    .then(async ({ prewarmWatchSearchQueryEmbeddings }) => {
      const { prisma } = await import("@/db/client")
      return prewarmWatchSearchQueryEmbeddings({ prisma })
    })
    .catch((error) => {
      console.warn(
        `[watch-search] event=query_embedding_prewarm_start_failure error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
      )
    })
}

export function isTransientWorkflowStartupError(error: unknown): boolean {
  const code =
    typeof error === "object" && error != null && "code" in error
      ? String(error.code)
      : undefined
  return (
    code === "53300" ||
    TRANSIENT_WORKFLOW_STARTUP_PATTERNS.some((pattern) =>
      pattern.test(errorText(error)),
    )
  )
}

export function shouldStartWorkflowWorld(): boolean {
  return (
    process.env.NEXT_RUNTIME === "nodejs" &&
    env.WORKFLOW_RUNNER_ENABLED === "true" &&
    env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  )
}

async function startWorkflowWorld(): Promise<void> {
  const { getWorld } = await import("workflow/runtime")
  const { startWorkflowWorkerHeartbeat } =
    await import("@/services/workflow-worker-heartbeat.service")
  const { ensureCoreSyncSchedulerStarted } =
    await import("@/services/core-sync/job")
  const { ensureVideoDbBackupSchedulerStarted } =
    await import("@/services/video-db-backup/job")
  const { ensureSearchTraceRetentionSchedulerStarted } =
    await import("@/services/search-trace-retention/job")
  const { ensureRecommendationRetentionSchedulerStarted } =
    await import("@/services/recommendations/retention/job")
  const { ensureRecommendationControlReadinessSchedulerStarted } =
    await import("@/services/recommendations/control-readiness/job")
  const { ensureRecommendationEpisodeFinalizationRecovery } =
    await import("@/services/recommendations/finalization/job")
  const world = getWorld()
  await world.start?.()
  await startWorkflowWorkerHeartbeat()
  await ensureCoreSyncSchedulerStarted()
  await ensureVideoDbBackupSchedulerStarted()
  await ensureSearchTraceRetentionSchedulerStarted()
  await ensureRecommendationRetentionSchedulerStarted()
  await ensureRecommendationControlReadinessSchedulerStarted()
  void ensureRecommendationRecovery(
    ensureRecommendationEpisodeFinalizationRecovery,
  )
}

async function ensureRecommendationRecovery(
  ensure: () => Promise<unknown> | unknown,
): Promise<void> {
  const state = recommendationRecoveryState()
  if (state.started || state.starting) return
  state.starting = true
  try {
    await ensure()
    state.started = true
    state.attempt = 0
  } catch (error) {
    state.attempt += 1
    console.warn(
      `[recommendation-finalization] event=recovery_start_failure error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
    )
    if (state.attempt >= maxRecommendationRecoveryAttempts()) {
      console.error(
        `[recommendation-finalization] event=recovery_start_exhausted attempts=${state.attempt}`,
      )
      return
    }
    const delayMs = recommendationRecoveryBackoffMs(state.attempt)
    state.retryTimer = setTimeout(() => {
      state.retryTimer = undefined
      void ensureRecommendationRecovery(ensure)
    }, delayMs)
    state.retryTimer.unref?.()
  } finally {
    state.starting = false
  }
}

function scheduleWorkflowStartupRetry(attempt: number) {
  const state = workflowStartupState()
  const delayMs = transientWorkflowStartupDelayMs()

  state.retryTimer = setTimeout(() => {
    void startWorkflowWorldWithTransientRetry(attempt)
  }, delayMs)
  state.retryTimer.unref?.()
}

async function startWorkflowWorldWithTransientRetry(
  attempt = 1,
): Promise<void> {
  const state = workflowStartupState()
  if (state.started || state.starting) return

  state.starting = true
  try {
    await startWorkflowWorld()
    state.started = true
  } catch (error) {
    const isTransient = isTransientWorkflowStartupError(error)
    const maxAttempts = maxTransientWorkflowStartupAttempts()

    if (!isTransient || attempt >= maxAttempts) {
      throw error
    }

    process.stderr.write(
      `[workflow-startup] transient startup failure; retrying attempt ${attempt + 1}/${maxAttempts} error=${errorText(error)}\n`,
    )
    scheduleWorkflowStartupRetry(attempt + 1)
  } finally {
    state.starting = false
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { configureDatadog } = await import("@/observability/datadog")
    configureDatadog()
    startWatchSearchPrewarm()
  }

  if (!shouldStartWorkflowWorld()) return

  await startWorkflowWorldWithTransientRetry()
}
