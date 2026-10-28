import {
  isRetentionDecisionObservation,
  safeRetentionDecisionObservation,
  type RetentionDecisionObservation,
} from "./retention-operation-diagnostics"
import { Prisma } from "@prisma/client"
import { RecommendationConflictError } from "./errors"

// Code-owned labels only. Neither data values nor SQL may become a phase label.
export const RETENTION_PHASE_LABELS = [
  "unknown",
  "select_request_roots",
  "precomputed_visit_roots",
  "precomputed_generation_proofs",
  "precomputed_generations",
  "composition_evidence",
  "cowatch_trial_authorities",
  "owner_releases",
  "cowatch_refresh_metadata",
  "watch_exposure_page",
  "watch_compact_receipt_page",
  "watch_compact_item_page",
  "watch_compact_window_page",
  "select_direct_actions",
  "select_standalone_episodes",
  "delete_standalone_episode",
  "delete_direct_actions",
  "delete_request_roots",
  "trace_access_audit",
  "projection_run_page",
  "projection_contribution_page",
  "profile_interest_page",
  "projection_run_unlink_page",
  "projection_decision_unlink_page",
  "projection_generation_page",
  "orphan_profile_vectors",
  "select_cowatch_generations",
  "delete_cowatch_generation",
  "expiredCowatchSuppressions",
  "select_viewers",
  "delete_viewers",
  "expiredConsentReceipts",
  "profile_fence_and_erase",
  "expiredProfileSessionLinks",
  "expiredConsentTransitions",
  "expiredControlEvaluations",
  "select_shadow_evaluations",
  "delete_shadow_evaluation",
  "expiredPromotionEvents",
  "expiredPromotionRuns",
  "expiredPromotionApprovals",
  "expiredExperimentEvaluations",
  "expiredExperimentEvaluationRuns",
  "select_experiment_assignments",
  "delete_experiment_assignments",
  "select_experiments",
  "delete_experiment",
  "select_retired_profiles",
  "delete_retired_profile",
  "retention_run_expiry",
  "oldest_expired_scan",
  "terminal_success",
  "terminal_budget_yield",
] as const

export type RetentionPhaseLabel = (typeof RETENTION_PHASE_LABELS)[number]
export type RetentionPhaseStage =
  | "unavailable"
  | "admission"
  | "acquire"
  | "post_acquisition_admission"
  | "advisory_lock"
  | "post_lock_admission"
  | "configure_timeout"
  | "post_configuration_admission"
  | "operation"
  | "counter_update"
  | "commit_acknowledgement"
  | "complete"

export type RetentionPhaseTiming = {
  label: RetentionPhaseLabel
  ordinal: number
  stage: RetentionPhaseStage
  remainingBudgetMs: number | null
  admittedBudgetMs: number | null
  acquisitionMs: number | null
  advisoryLockMs: number | null
  configurationMs: number | null
  operationMs: number | null
  counterUpdateMs: number | null
  commitAcknowledgementMs: number | null
  incompleteStageElapsedMs: number | null
  totalMs: number | null
}

const HISTORY_LIMIT = 4
const LOGS_PER_MINUTE = 16
const PHASE_LABEL_SET: ReadonlySet<string> = new Set(RETENTION_PHASE_LABELS)
const PHASE_STAGE_SET: ReadonlySet<string> = new Set([
  "unavailable",
  "admission",
  "acquire",
  "post_acquisition_admission",
  "advisory_lock",
  "post_lock_admission",
  "configure_timeout",
  "post_configuration_admission",
  "operation",
  "counter_update",
  "commit_acknowledgement",
  "complete",
])
const PRISMA_CODES: ReadonlySet<string> = new Set([
  "P1008", // operation timeout
  "P1017", // server closed connection
  "P2010", // raw query failure
  "P2028", // interactive transaction failure
  "P2034", // write conflict or deadlock
])
const SQLSTATES: ReadonlySet<string> = new Set([
  "08003", // connection does not exist
  "08006", // connection failure
  "40P01", // deadlock
  "40001", // serialization failure
  "55P03", // lock not available
  "57014", // statement cancelled
  "P0001", // raised exception
])
const ERROR_CLASSES: ReadonlySet<string> = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
  "RecommendationConflictError",
  "Error",
  "Unknown",
])
const LOG_PREFIX =
  "[recommendations] event=recommendation_retention_phase_failure payload="

export function boundedRetentionMilliseconds(value: number): number | null {
  return Number.isFinite(value) && value >= 0
    ? value > 0
      ? Math.max(1, Math.round(value))
      : 0
    : null
}

function safeTiming(timing: RetentionPhaseTiming): RetentionPhaseTiming {
  return {
    label: PHASE_LABEL_SET.has(timing.label) ? timing.label : "unknown",
    ordinal:
      Number.isSafeInteger(timing.ordinal) && timing.ordinal > 0
        ? timing.ordinal
        : 0,
    stage: PHASE_STAGE_SET.has(timing.stage) ? timing.stage : "unavailable",
    remainingBudgetMs: boundedRetentionMilliseconds(
      timing.remainingBudgetMs ?? NaN,
    ),
    admittedBudgetMs: boundedRetentionMilliseconds(
      timing.admittedBudgetMs ?? NaN,
    ),
    acquisitionMs: boundedRetentionMilliseconds(timing.acquisitionMs ?? NaN),
    advisoryLockMs: boundedRetentionMilliseconds(timing.advisoryLockMs ?? NaN),
    configurationMs: boundedRetentionMilliseconds(
      timing.configurationMs ?? NaN,
    ),
    operationMs: boundedRetentionMilliseconds(timing.operationMs ?? NaN),
    counterUpdateMs: boundedRetentionMilliseconds(
      timing.counterUpdateMs ?? NaN,
    ),
    commitAcknowledgementMs: boundedRetentionMilliseconds(
      timing.commitAcknowledgementMs ?? NaN,
    ),
    incompleteStageElapsedMs: boundedRetentionMilliseconds(
      timing.incompleteStageElapsedMs ?? NaN,
    ),
    totalMs: boundedRetentionMilliseconds(timing.totalMs ?? NaN),
  }
}

function errorField(error: unknown, field: string): unknown {
  if (error === null || typeof error !== "object") return undefined
  return Object.getOwnPropertyDescriptor(error, field)?.value
}

export function normalizedRetentionError(error: unknown): {
  class: string
  prismaCode: string | null
  sqlstate: string | null
} {
  const errorClass =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? "PrismaClientKnownRequestError"
      : error instanceof Prisma.PrismaClientUnknownRequestError
        ? "PrismaClientUnknownRequestError"
        : error instanceof Prisma.PrismaClientInitializationError
          ? "PrismaClientInitializationError"
          : error instanceof Prisma.PrismaClientValidationError
            ? "PrismaClientValidationError"
            : error instanceof RecommendationConflictError
              ? "RecommendationConflictError"
              : error instanceof Error
                ? "Error"
                : "Unknown"
  const directCode = errorField(error, "code")
  const meta = errorField(error, "meta")
  const metaCode = errorField(meta, "code")
  const metaSqlstate = errorField(meta, "sqlstate")
  const sqlstate = [directCode, metaCode, metaSqlstate].find(
    (code) => typeof code === "string" && SQLSTATES.has(code),
  )
  return {
    class: errorClass,
    prismaCode:
      typeof directCode === "string" && PRISMA_CODES.has(directCode)
        ? directCode
        : null,
    sqlstate: typeof sqlstate === "string" ? sqlstate : null,
  }
}

export function createRetentionPhaseRecorder() {
  const precedingCompleted: RetentionPhaseTiming[] = []
  const failed: RetentionPhaseTiming[] = []
  let precedingAtFailure: RetentionPhaseTiming[] | null = null
  let slowestCompleted: RetentionPhaseTiming | null = null
  let terminal: RetentionPhaseTiming | null = null
  return {
    completed(timing: RetentionPhaseTiming, isTerminal = false) {
      const safe = safeTiming(timing)
      if (isTerminal) {
        terminal = safe
      } else if (precedingAtFailure === null) {
        if (
          slowestCompleted === null ||
          (safe.totalMs ?? -1) > (slowestCompleted.totalMs ?? -1)
        )
          slowestCompleted = safe
        precedingCompleted.push(safe)
        if (precedingCompleted.length > HISTORY_LIMIT)
          precedingCompleted.shift()
      }
    },
    failed(timing: RetentionPhaseTiming, isTerminal = false) {
      const safe = safeTiming(timing)
      if (precedingAtFailure === null)
        precedingAtFailure = [...precedingCompleted]
      if (failed.length < 2) failed.push(safe)
      if (isTerminal) terminal = safe
    },
    diagnostic(
      mode: "scheduled" | "stored-expiry-only",
      errors: {
        phase: unknown
        terminal?: unknown
        fallbackLedger?: unknown
      },
      fallbackLedger: {
        outcome: "succeeded" | "failed" | "not_attempted"
        elapsedMs: number | null
      },
      decisionOperation?: RetentionDecisionObservation | null,
    ) {
      return {
        event: "recommendation_retention_phase_failure" as const,
        version: decisionOperation === undefined ? (1 as const) : (2 as const),
        ...(decisionOperation === undefined
          ? {}
          : {
              decisionOperation:
                safeRetentionDecisionObservation(decisionOperation),
            }),
        mode,
        errors: {
          phase: normalizedRetentionError(errors.phase),
          terminal:
            errors.terminal === undefined
              ? null
              : normalizedRetentionError(errors.terminal),
          fallbackLedger:
            errors.fallbackLedger === undefined
              ? null
              : normalizedRetentionError(errors.fallbackLedger),
        },
        precedingCompleted: precedingAtFailure ?? [...precedingCompleted],
        slowestCompleted,
        failed,
        terminal,
        fallbackLedger: {
          outcome: fallbackLedger.outcome,
          elapsedMs: boundedRetentionMilliseconds(
            fallbackLedger.elapsedMs ?? NaN,
          ),
        },
      }
    },
  }
}

export function createRetentionDiagnosticLogLimiter(limit = LOGS_PER_MINUTE) {
  let minute = -1
  let emitted = 0
  let suppressed = 0
  return {
    allow(nowMs = Date.now()): {
      emit: boolean
      suppressedPriorMinute: number
    } {
      const nextMinute = Math.floor(nowMs / 60_000)
      let suppressedPriorMinute = 0
      if (nextMinute !== minute) {
        suppressedPriorMinute = suppressed
        minute = nextMinute
        emitted = 0
        suppressed = 0
      }
      if (emitted >= limit) {
        suppressed += 1
        return { emit: false, suppressedPriorMinute: 0 }
      }
      emitted += 1
      return { emit: true, suppressedPriorMinute }
    },
  }
}

export type RetentionPhaseFailureLog = ReturnType<
  ReturnType<typeof createRetentionPhaseRecorder>["diagnostic"]
> & { suppressedPriorMinute: number }

export function formatRetentionPhaseFailureLog(
  diagnostic: RetentionPhaseFailureLog,
): string {
  return `${LOG_PREFIX}${JSON.stringify(diagnostic)}`
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

function safeMilliseconds(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  )
}

function safeError(value: unknown): boolean {
  return (
    exactKeys(value, ["class", "prismaCode", "sqlstate"]) &&
    typeof value.class === "string" &&
    ERROR_CLASSES.has(value.class) &&
    (value.prismaCode === null ||
      (typeof value.prismaCode === "string" &&
        PRISMA_CODES.has(value.prismaCode))) &&
    (value.sqlstate === null ||
      (typeof value.sqlstate === "string" && SQLSTATES.has(value.sqlstate)))
  )
}

const TIMING_KEYS = [
  "label",
  "ordinal",
  "stage",
  "remainingBudgetMs",
  "admittedBudgetMs",
  "acquisitionMs",
  "advisoryLockMs",
  "configurationMs",
  "operationMs",
  "counterUpdateMs",
  "commitAcknowledgementMs",
  "incompleteStageElapsedMs",
  "totalMs",
] as const

function safePhaseTiming(value: unknown): boolean {
  return (
    exactKeys(value, TIMING_KEYS) &&
    typeof value.label === "string" &&
    PHASE_LABEL_SET.has(value.label) &&
    typeof value.ordinal === "number" &&
    Number.isSafeInteger(value.ordinal) &&
    value.ordinal >= 0 &&
    typeof value.stage === "string" &&
    PHASE_STAGE_SET.has(value.stage) &&
    TIMING_KEYS.slice(3).every((key) => safeMilliseconds(value[key]))
  )
}

// Accept only the code-owned diagnostic schema. A Railway log line can carry
// arbitrary request data outside this envelope; callers must never forward it.
export function parseRetentionPhaseFailureLog(
  line: string,
  { allowLegacyJson = false }: { allowLegacyJson?: boolean } = {},
): RetentionPhaseFailureLog | null {
  const payload = line.startsWith(LOG_PREFIX)
    ? line.slice(LOG_PREFIX.length)
    : allowLegacyJson && line.startsWith("{")
      ? line
      : null
  if (payload === null || payload.length > 8192) return null
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    return null
  }
  if (
    !exactKeys(value, [
      "event",
      "version",
      "mode",
      "errors",
      "precedingCompleted",
      "slowestCompleted",
      "failed",
      "terminal",
      "fallbackLedger",
      "suppressedPriorMinute",
      ...(typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 2
        ? ["decisionOperation"]
        : []),
    ]) ||
    value.event !== "recommendation_retention_phase_failure" ||
    (value.version !== 1 && value.version !== 2) ||
    (value.version === 2 &&
      value.decisionOperation !== null &&
      !isRetentionDecisionObservation(value.decisionOperation)) ||
    (value.mode !== "scheduled" && value.mode !== "stored-expiry-only") ||
    !exactKeys(value.errors, ["phase", "terminal", "fallbackLedger"]) ||
    !safeError(value.errors.phase) ||
    !(value.errors.terminal === null || safeError(value.errors.terminal)) ||
    !(
      value.errors.fallbackLedger === null ||
      safeError(value.errors.fallbackLedger)
    ) ||
    !Array.isArray(value.precedingCompleted) ||
    value.precedingCompleted.length > HISTORY_LIMIT ||
    !value.precedingCompleted.every(safePhaseTiming) ||
    !(
      value.slowestCompleted === null || safePhaseTiming(value.slowestCompleted)
    ) ||
    !Array.isArray(value.failed) ||
    value.failed.length > 2 ||
    !value.failed.every(safePhaseTiming) ||
    !(value.terminal === null || safePhaseTiming(value.terminal)) ||
    !exactKeys(value.fallbackLedger, ["outcome", "elapsedMs"]) ||
    typeof value.fallbackLedger.outcome !== "string" ||
    !["succeeded", "failed", "not_attempted"].includes(
      value.fallbackLedger.outcome,
    ) ||
    !safeMilliseconds(value.fallbackLedger.elapsedMs) ||
    typeof value.suppressedPriorMinute !== "number" ||
    !Number.isSafeInteger(value.suppressedPriorMinute) ||
    value.suppressedPriorMinute < 0
  )
    return null
  return value as RetentionPhaseFailureLog
}

// The durable ledger still records every failure. This only bounds log volume
// if an unhealthy scheduler repeatedly retries under ordinary catch-up.
export const retentionDiagnosticLogLimiter =
  createRetentionDiagnosticLogLimiter()
