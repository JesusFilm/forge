import { createClient } from "redis"

class AdmissionTimeoutError extends Error {}

export const RECOMMENDATION_MUTATION_CLIENT_LIMIT = 30
export const RECOMMENDATION_MUTATION_AGGREGATE_LIMIT = 600
export const WINDOW_MS = 60_000
export const COMMAND_TIMEOUT_MS = 250
// Context diagnostics show TIME reply delay consuming the conservative Redis
// deadline. Its 5 s browser / 3 s upstream contract can reserve 750 ms total
// admission (250 ms connection + 500 ms commands). Other paths stay unchanged.
export const PLAYBACK_CONTEXT_COMMAND_TIMEOUT_MS = 500
const REDIS_RETRY_BACKOFF_MS = 1_000

// Failure-only diagnostics: never pass Redis errors, keys, URLs or headers to
// the logger. Durations distinguish a fired timer from delayed event-loop work.
export function observeAdmissionFailure(
  stage:
    | "configuration"
    | "connect"
    | "backoff"
    | "load"
    | "time"
    | "eval"
    | "worker",
  reason:
    | "secret_missing"
    | "redis_missing"
    | "retry_backoff"
    | "unavailable"
    | "timeout"
    | "client_error"
    | "budget_exhausted"
    | "invalid_clock"
    | "redis_deadline"
    | "invalid_result",
  elapsedMs = 0,
  budgetMs = COMMAND_TIMEOUT_MS,
): void {
  const durationMs = Number.isFinite(elapsedMs)
    ? Math.min(60_000, Math.max(0, Math.round(elapsedMs)))
    : 0
  try {
    console.info(
      `event=recommendation.admission stage=${stage} reason=${reason} durationMs=${durationMs} budgetMs=${Math.min(COMMAND_TIMEOUT_MS + PLAYBACK_CONTEXT_COMMAND_TIMEOUT_MS, Math.max(0, Math.floor(budgetMs)))}`,
    )
  } catch {
    // Observability must not change admission or playback behavior.
  }
}

const ADMIT_LUA = `
local server_time = redis.call('TIME')
local now_ms = tonumber(server_time[1]) * 1000 + math.floor(tonumber(server_time[2]) / 1000)
if now_ms >= tonumber(ARGV[4]) then return {'unavailable'} end
local client_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local aggregate_count = tonumber(redis.call('GET', KEYS[2]) or '0')
if client_count >= tonumber(ARGV[1]) then return {'rate_limited'} end
if aggregate_count >= tonumber(ARGV[2]) then return {'rate_limited'} end
client_count = redis.call('INCR', KEYS[1])
if client_count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
aggregate_count = redis.call('INCR', KEYS[2])
if aggregate_count == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
return {'allowed'}
`

export type MutationRedis = {
  on?(event: "error", listener: () => void): unknown
  time(): Promise<string[]>
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>
  destroy?(): void
}

export type RecommendationAdmissionNamespace =
  | "delivery"
  | "profile-status"
  | "profile-mutation"
  | "privacy-control"
  | "content-action"
  | "playback-context"

export type RecommendationMutationAdmissionResult =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" | "admission_unavailable" }

let redisPromise: Promise<MutationRedis | null> | undefined
type RedisConnection = {
  client: MutationRedis
  activeAdmissions: number
  retiring: boolean
}
let redisConnection: RedisConnection | null = null
let redisRetryAt = 0

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = COMMAND_TIMEOUT_MS,
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new AdmissionTimeoutError("admission_unavailable")
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AdmissionTimeoutError("admission_unavailable"))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function defaultRedis(): Promise<MutationRedis | null> {
  const url = process.env.REDIS_URL?.trim()
  if (!url) {
    observeAdmissionFailure("configuration", "redis_missing")
    return null
  }
  if (Date.now() < redisRetryAt) {
    observeAdmissionFailure("backoff", "retry_backoff")
    return null
  }
  if (redisPromise) return redisPromise

  const attempt = (async () => {
    const client = createClient({
      url,
      socket: {
        connectTimeout: COMMAND_TIMEOUT_MS,
        reconnectStrategy: false,
      },
    }) as unknown as MutationRedis & { connect(): Promise<unknown> }
    client.on?.("error", () => undefined)
    const startedAt = performance.now()
    try {
      await withTimeout(client.connect())
      redisConnection = { client, activeAdmissions: 0, retiring: false }
      return client
    } catch (error) {
      observeAdmissionFailure(
        "connect",
        error instanceof AdmissionTimeoutError ? "timeout" : "client_error",
        performance.now() - startedAt,
      )
      try {
        client.destroy?.()
      } catch {
        // The client is already unusable; the retry backoff below remains the
        // source of truth even when node-redis rejects a duplicate destroy.
      }
      return null
    }
  })()
  redisPromise = attempt
  const client = await attempt
  if (!client && redisPromise === attempt) {
    redisRetryAt = Date.now() + REDIS_RETRY_BACKOFF_MS
    redisPromise = undefined
  }
  return client
}

function destroyRedis(client: MutationRedis): void {
  try {
    client.destroy?.()
  } catch {
    // A timed-out node-redis command may already have closed the socket.
  }
}

function retireDefaultRedis(client: MutationRedis): void {
  const connection = redisConnection
  if (!connection || connection.client !== client) return
  connection.retiring = true
  redisConnection = null
  redisPromise = undefined
  redisRetryAt = Date.now() + REDIS_RETRY_BACKOFF_MS
  // Other callers share this socket but have their own bounded deadlines.
  // Stop lending it immediately; close it once those callers have finished.
  if (connection.activeAdmissions === 0) destroyRedis(client)
}

export async function runRedisAdmission(
  clientKey: string,
  aggregateKey: string,
  namespace: RecommendationAdmissionNamespace,
  dependencies: {
    monotonicNow?: () => number
    redis?: () => Promise<MutationRedis | null>
    deadlineAt?: number
  } = {},
): Promise<RecommendationMutationAdmissionResult | null> {
  const monotonicNow =
    dependencies.monotonicNow ?? performance.now.bind(performance)
  const loadRedis = dependencies.redis ?? defaultRedis
  const redis = await loadRedis().catch(() => null)

  if (redis) {
    const connection = dependencies?.redis ? null : redisConnection
    if (!dependencies?.redis && connection?.client !== redis) {
      // A different admission can retire the client while loadRedis yields.
      observeAdmissionFailure("load", "unavailable")
      return { allowed: false, reason: "admission_unavailable" }
    }
    if (connection) connection.activeAdmissions += 1
    const requestedCommandTimeoutMs =
      namespace === "playback-context"
        ? PLAYBACK_CONTEXT_COMMAND_TIMEOUT_MS
        : COMMAND_TIMEOUT_MS
    const commandTimeoutMs = Math.min(
      requestedCommandTimeoutMs,
      dependencies.deadlineAt == null
        ? requestedCommandTimeoutMs
        : Math.floor(
            dependencies.deadlineAt -
              (performance.timeOrigin + performance.now()),
          ),
    )
    let stage: "time" | "eval" = "time"
    let stageStartedAt = performance.now()
    let stageBudgetMs = commandTimeoutMs
    try {
      // The Lua script must compare against Redis's own clock. An
      // application-clock deadline can move admission into the past or let
      // a queued EVAL mutate after the caller has already timed out.
      const startedAt = monotonicNow()
      let remainingMs = commandTimeoutMs
      for (let attempt = 0; ; attempt += 1) {
        stage = "time"
        stageBudgetMs = remainingMs
        stageStartedAt = performance.now()
        const redisTime = await withTimeout(redis.time(), remainingMs)
        const elapsedMs = Math.max(0, monotonicNow() - startedAt)
        remainingMs = Math.floor(commandTimeoutMs - elapsedMs)
        if (remainingMs <= 0) {
          observeAdmissionFailure(
            "time",
            "budget_exhausted",
            elapsedMs,
            commandTimeoutMs,
          )
          retireDefaultRedis(redis)
          return { allowed: false, reason: "admission_unavailable" }
        }
        const redisNowMs =
          Number(redisTime[0]) * 1_000 +
          Math.floor(Number(redisTime[1]) / 1_000)
        if (!Number.isSafeInteger(redisNowMs)) {
          observeAdmissionFailure(
            "time",
            "invalid_clock",
            elapsedMs,
            commandTimeoutMs,
          )
          retireDefaultRedis(redis)
          return { allowed: false, reason: "admission_unavailable" }
        }
        stage = "eval"
        stageBudgetMs = remainingMs
        stageStartedAt = performance.now()
        const result = (await withTimeout(
          redis.eval(ADMIT_LUA, {
            keys: [clientKey, aggregateKey],
            arguments: [
              String(RECOMMENDATION_MUTATION_CLIENT_LIMIT),
              String(RECOMMENDATION_MUTATION_AGGREGATE_LIMIT),
              String(WINDOW_MS),
              String(redisNowMs + remainingMs),
            ],
          }),
          remainingMs,
        )) as string[]
        if (result[0] === "allowed") return { allowed: true }
        if (result[0] === "rate_limited") {
          return { allowed: false, reason: "rate_limited" }
        }
        if (result[0] === "unavailable" && attempt === 0) {
          // A delayed TIME reply can expire this conservative Redis-clock
          // deadline early. Only this explicit Lua result proves no mutation
          // occurred. Refresh once, without restarting the caller's budget;
          // never retry a timeout or transport failure with unknown effects.
          remainingMs = Math.floor(
            commandTimeoutMs - Math.max(0, monotonicNow() - startedAt),
          )
          if (remainingMs > 0) continue
        }
        observeAdmissionFailure(
          "eval",
          result[0] === "unavailable" ? "redis_deadline" : "invalid_result",
          performance.now() - stageStartedAt,
          stageBudgetMs,
        )
        return { allowed: false, reason: "admission_unavailable" }
      }
    } catch (error) {
      observeAdmissionFailure(
        stage,
        error instanceof AdmissionTimeoutError ? "timeout" : "client_error",
        performance.now() - stageStartedAt,
        stageBudgetMs,
      )
      retireDefaultRedis(redis)
      return { allowed: false, reason: "admission_unavailable" }
    } finally {
      if (connection) {
        connection.activeAdmissions -= 1
        if (connection.retiring && connection.activeAdmissions === 0) {
          destroyRedis(connection.client)
        }
      }
    }
  }
  return null
}

export function resetRedisAdmissionForTests(): void {
  if (redisConnection) destroyRedis(redisConnection.client)
  redisConnection = null
  redisPromise = undefined
  redisRetryAt = 0
}
