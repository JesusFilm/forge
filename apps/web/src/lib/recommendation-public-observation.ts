import "server-only"

import { createClient } from "redis"

// One compact hash per UTC hour. No visit IDs, IPs, tokens, or card IDs enter
// Redis. The fixed 70-day TTL covers a 31-day cohort plus the longest 28-day
// late-click cutoff and a short review margin.
const RETENTION_SECONDS = 70 * 86_400
const COMMAND_TIMEOUT_MS = 250
const READ_TIMEOUT_MS = 2_000
const RETRY_BACKOFF_MS = 1_000
const INCREMENT = `
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 1
`
const READ_HOURS = `
local result = {}
for i, key in ipairs(KEYS) do
  result[i] = redis.call('HGETALL', key)
end
return result
`
const OBSERVATION_FIELDS = new Set<WatchPublicObservation>([
  "delivery_attempt",
  "delivery_excluded",
  "delivery_unknown",
  "delivery_missing_identity",
  "delivery_verification_required",
  "delivery_verification_rejected",
  "delivery_verification_unavailable",
  "delivery_qualified",
  "delivery_inactive",
  "delivery_private",
  "delivery_unavailable",
  "delivery_rejected",
  "click_attempt",
  "click_ack",
  "click_unavailable",
])
const EXPERIMENT_FIELDS = new Set<WatchExperimentObservation>([
  "delivery_attempt",
  "delivery_eligible",
  "delivery_not_eligible",
  "delivery_response_failed",
  "click_attempt",
  "click_ack",
  "click_unavailable",
])
const EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/

export type WatchPublicObservation =
  | "delivery_attempt"
  | "delivery_excluded"
  | "delivery_unknown"
  | "delivery_missing_identity"
  | "delivery_verification_required"
  | "delivery_verification_rejected"
  | "delivery_verification_unavailable"
  | "delivery_qualified"
  | "delivery_inactive"
  | "delivery_private"
  | "delivery_unavailable"
  | "delivery_rejected"
  | "click_attempt"
  | "click_ack"
  | "click_unavailable"

export type WatchExperimentObservation =
  | "delivery_attempt"
  | "delivery_eligible"
  | "delivery_not_eligible"
  | "delivery_response_failed"
  | "click_attempt"
  | "click_ack"
  | "click_unavailable"

type ObservationRedis = {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>
}

type Client = ObservationRedis & {
  connect(): Promise<unknown>
  destroy(): void
  on(event: "error", listener: () => void): unknown
}

let clientPromise: Promise<Client | null> | null = null
let retryAt = 0

async function bounded<T>(
  promise: Promise<T>,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redis_timeout")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function redisClient(): Promise<Client | null> {
  const url = process.env.REDIS_URL?.trim()
  if (!url || Date.now() < retryAt) return null
  if (clientPromise) return clientPromise
  const client = createClient({
    url,
    socket: { connectTimeout: COMMAND_TIMEOUT_MS, reconnectStrategy: false },
  }) as unknown as Client
  client.on("error", () => undefined)
  const attempt = (async () => {
    try {
      await bounded(client.connect())
      return client
    } catch {
      try {
        client.destroy()
      } catch {
        // A failed connection may already be closed.
      }
      retryAt = Date.now() + RETRY_BACKOFF_MS
      return null
    }
  })()
  clientPromise = attempt
  const connected = await attempt
  if (!connected && clientPromise === attempt) clientPromise = null
  return connected
}

export function watchPublicObservationHour(at = new Date()): string {
  return at.toISOString().slice(0, 13).replace(/[-T]/g, "")
}

function observationKey(hour: string) {
  return `recommendation:public-watch-observation:v1:${hour}`
}

function experimentObservationKey(experimentId: string, hour: string) {
  return `recommendation:experiment-watch-observation:v1:${experimentId}:${hour}`
}

async function recordObservation(
  key: string,
  outcome: WatchPublicObservation | WatchExperimentObservation,
  redis?: ObservationRedis | null,
): Promise<boolean> {
  const target = redis === undefined ? await redisClient() : redis
  if (!target) return false
  try {
    const result = await bounded(
      target.eval(INCREMENT, {
        keys: [key],
        arguments: [outcome, String(RETENTION_SECONDS)],
      }),
    )
    return result === 1
  } catch {
    // Readiness treats a missing or unmatched aggregate as unqualified. The
    // recommendation route must still preserve incumbent and player serving.
    if (redis === undefined) {
      try {
        ;(target as Client).destroy()
      } catch {
        // Another operation may already have retired the shared connection.
      }
      clientPromise = null
      retryAt = Date.now() + RETRY_BACKOFF_MS
    }
    return false
  }
}

export function recordWatchPublicObservation(
  outcome: WatchPublicObservation,
  hour = watchPublicObservationHour(),
  redis?: ObservationRedis | null,
): Promise<boolean> {
  if (!/^\d{10}$/.test(hour)) return Promise.resolve(false)
  return recordObservation(observationKey(hour), outcome, redis)
}

export function recordWatchExperimentObservation(
  experimentId: string,
  outcome: WatchExperimentObservation,
  hour = watchPublicObservationHour(),
  redis?: ObservationRedis | null,
): Promise<boolean> {
  if (!EXPERIMENT_ID.test(experimentId) || !/^\d{10}$/.test(hour))
    return Promise.resolve(false)
  return recordObservation(
    experimentObservationKey(experimentId, hour),
    outcome,
    redis,
  )
}

async function readObservationHours<T extends string>(
  hours: readonly string[],
  key: (hour: string) => string,
  fields: ReadonlySet<T>,
  redis?: ObservationRedis | null,
): Promise<Array<{
  hour: string
  counters: Partial<Record<T, number>> | null
}> | null> {
  if (
    hours.length === 0 ||
    hours.length > 840 ||
    hours.some((hour) => !/^\d{10}$/.test(hour))
  )
    return null
  const target = redis === undefined ? await redisClient() : redis
  if (!target) return null
  try {
    const result = await bounded(
      target.eval(READ_HOURS, {
        keys: hours.map(key),
        arguments: [],
      }),
      READ_TIMEOUT_MS,
    )
    if (!Array.isArray(result) || result.length !== hours.length) return null
    return result.map((pairs, index) => {
      if (!Array.isArray(pairs) || pairs.length % 2 !== 0) {
        throw new Error("invalid_observation")
      }
      const counters: Partial<Record<T, number>> = {}
      for (let i = 0; i < pairs.length; i += 2) {
        const field = pairs[i]
        const value = pairs[i + 1]
        if (
          typeof field !== "string" ||
          !fields.has(field as T) ||
          typeof value !== "string" ||
          !/^\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value))
        )
          throw new Error("invalid_observation")
        counters[field as T] = Number(value)
      }
      return {
        hour: hours[index]!,
        counters: pairs.length > 0 ? counters : null,
      }
    })
  } catch {
    return null
  }
}

export function readWatchPublicObservationHours(
  hours: readonly string[],
  redis?: ObservationRedis | null,
) {
  return readObservationHours(hours, observationKey, OBSERVATION_FIELDS, redis)
}

export function readWatchExperimentObservationHours(
  experimentId: string,
  hours: readonly string[],
  redis?: ObservationRedis | null,
) {
  if (!EXPERIMENT_ID.test(experimentId)) return Promise.resolve(null)
  return readObservationHours(
    hours,
    (hour) => experimentObservationKey(experimentId, hour),
    EXPERIMENT_FIELDS,
    redis,
  )
}

export async function closeWatchPublicObservationRedisForTests() {
  const client = await clientPromise
  client?.destroy()
  clientPromise = null
  retryAt = 0
}
