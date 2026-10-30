import { createHash, randomUUID } from "node:crypto"
import { env } from "@/config/env"
import { getRedisClient } from "@/infra/redis"
import { RecommendationInternalStateError } from "./errors"

const IN_FLIGHT_TTL_MS = 10_000
const COOLDOWN_MS = 5_000
const SESSION_WINDOW_MS = 60 * 60 * 1_000
const SESSION_LIMIT = 30
// Keep availability isolation per anonymous recommendation session while a
// separate bearer-wide ceiling bounds total Web amplification. The aggregate
// is deliberately sized above one viewer's traffic: a shared server bearer is
// a caller class, not a single end user.
const CLIENT_ENDPOINT_WINDOW_MS = 60 * 1_000
const CLIENT_ENDPOINT_LIMIT = 60
const AGGREGATE_ENDPOINT_WINDOW_MS = 60 * 1_000
const AGGREGATE_ENDPOINT_LIMIT = 600
const COMMAND_TIMEOUT_MS = 250

// The development adapter is process-local, but it must still be shared by
// every request-scoped service instance. Production never reaches these maps.
const localInflight = new Map<string, string>()
const localCooldown = new Map<string, number>()
const localHourly = new Map<string, number[]>()
const localClientEndpoint = new Map<string, number[]>()
const localAggregateEndpoint = new Map<string, number[]>()
const localLeases = new Map<string, string>()
const MAX_LOCAL_BUCKETS = 10_000

function pruneLocalBuckets(now: number): void {
  if (
    localCooldown.size < MAX_LOCAL_BUCKETS &&
    localHourly.size < MAX_LOCAL_BUCKETS &&
    localClientEndpoint.size < MAX_LOCAL_BUCKETS &&
    localAggregateEndpoint.size < MAX_LOCAL_BUCKETS
  ) {
    return
  }
  for (const [key, expiresAt] of localCooldown) {
    if (expiresAt <= now) localCooldown.delete(key)
  }
  for (const [key, attempts] of localHourly) {
    const fresh = attempts.filter((at) => at > now - SESSION_WINDOW_MS)
    if (fresh.length === 0) localHourly.delete(key)
    else localHourly.set(key, fresh)
  }
  for (const [key, attempts] of localClientEndpoint) {
    const fresh = attempts.filter((at) => at > now - CLIENT_ENDPOINT_WINDOW_MS)
    if (fresh.length === 0) localClientEndpoint.delete(key)
    else localClientEndpoint.set(key, fresh)
  }
  for (const [key, attempts] of localAggregateEndpoint) {
    const fresh = attempts.filter(
      (at) => at > now - AGGREGATE_ENDPOINT_WINDOW_MS,
    )
    if (fresh.length === 0) localAggregateEndpoint.delete(key)
    else localAggregateEndpoint.set(key, fresh)
  }
  for (const buckets of [
    localCooldown,
    localHourly,
    localClientEndpoint,
    localAggregateEndpoint,
  ]) {
    while (buckets.size >= MAX_LOCAL_BUCKETS) {
      const oldestKey = buckets.keys().next().value
      if (oldestKey == null) break
      buckets.delete(oldestKey)
    }
  }
}

const ADMIT_LUA = `
local server_time = redis.call('TIME')
local server_now_ms = tonumber(server_time[1]) * 1000 + math.floor(tonumber(server_time[2]) / 1000)
if server_now_ms >= tonumber(ARGV[10]) then return {'deadline_elapsed'} end
if redis.call('EXISTS', KEYS[1]) == 1 then return {'in_flight'} end
if redis.call('EXISTS', KEYS[2]) == 1 then return {'cooldown'} end
local current = tonumber(redis.call('GET', KEYS[3]) or '0')
if current >= tonumber(ARGV[4]) then return {'session_hour'} end
local client_endpoint_current = tonumber(redis.call('GET', KEYS[4]) or '0')
if client_endpoint_current >= tonumber(ARGV[6]) then return {'endpoint_rate'} end
local aggregate_endpoint_current = tonumber(redis.call('GET', KEYS[5]) or '0')
if aggregate_endpoint_current >= tonumber(ARGV[8]) then return {'endpoint_rate'} end
if not redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then return {'in_flight'} end
redis.call('SET', KEYS[2], '1', 'PX', ARGV[3], 'NX')
local count = redis.call('INCR', KEYS[3])
if count == 1 then redis.call('PEXPIRE', KEYS[3], ARGV[5]) end
local client_endpoint_count = redis.call('INCR', KEYS[4])
if client_endpoint_count == 1 then redis.call('PEXPIRE', KEYS[4], ARGV[7]) end
local aggregate_endpoint_count = redis.call('INCR', KEYS[5])
if aggregate_endpoint_count == 1 then redis.call('PEXPIRE', KEYS[5], ARGV[9]) end
return {'allowed', ARGV[1]}
`

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export type RecommendationAdmissionResult =
  | { allowed: true; leaseId: string }
  | {
      allowed: false
      reason:
        | "in_flight"
        | "cooldown"
        | "session_hour"
        | "endpoint_rate"
        | "admission_unavailable"
    }

export type RecommendationDeliveryAdmission = {
  acquire(input: {
    sessionDigest: string
    webConsumerBucketKey: string
    seedMediaId: string
    locale: string
  }): Promise<RecommendationAdmissionResult>
  release(leaseId: string): Promise<void>
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new RecommendationInternalStateError("recommendation_redis_timeout")
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new RecommendationInternalStateError(
                "recommendation_redis_timeout",
              ),
            ),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createRecommendationDeliveryAdmission(): RecommendationDeliveryAdmission {
  return {
    async acquire(input) {
      const sessionKey = digest(input.sessionDigest)
      const clientEndpointKey = digest(
        `recommendation-client-session\0${input.sessionDigest}`,
      )
      const aggregateEndpointKey = digest(
        `recommendation-web-consumer\0${input.webConsumerBucketKey}`,
      )
      const seedKey = digest(`${input.seedMediaId}\0${input.locale}`)
      const inflightKey = `recommendation:delivery:inflight:${sessionKey}`
      const cooldownKey = `recommendation:delivery:cooldown:${sessionKey}:${seedKey}`
      const hourlyKey = `recommendation:delivery:hour:${sessionKey}`
      const clientEndpointRateKey = `recommendation:delivery:endpoint:client:${clientEndpointKey}`
      const aggregateEndpointRateKey = `recommendation:delivery:endpoint:aggregate:${aggregateEndpointKey}`
      const leaseId = randomUUID()
      const redis = getRedisClient()

      if (redis) {
        try {
          // Establish the caller deadline from Redis's own clock. The Lua
          // script checks that absolute deadline before its first mutation,
          // so an eval that sits in a client/network queue past our timeout
          // cannot later consume admission behind the caller's back.
          const startedAt = Date.now()
          const redisTime = await withTimeout(redis.time(), COMMAND_TIMEOUT_MS)
          const elapsedMs = Date.now() - startedAt
          const remainingMs = COMMAND_TIMEOUT_MS - elapsedMs
          if (remainingMs <= 0) {
            return { allowed: false, reason: "admission_unavailable" }
          }
          const redisNowMs =
            Number(redisTime[0]) * 1_000 +
            Math.floor(Number(redisTime[1]) / 1_000)
          if (!Number.isSafeInteger(redisNowMs)) {
            return { allowed: false, reason: "admission_unavailable" }
          }
          const raw = (await withTimeout(
            redis.eval(
              ADMIT_LUA,
              5,
              inflightKey,
              cooldownKey,
              hourlyKey,
              clientEndpointRateKey,
              aggregateEndpointRateKey,
              leaseId,
              IN_FLIGHT_TTL_MS,
              COOLDOWN_MS,
              SESSION_LIMIT,
              SESSION_WINDOW_MS,
              CLIENT_ENDPOINT_LIMIT,
              CLIENT_ENDPOINT_WINDOW_MS,
              AGGREGATE_ENDPOINT_LIMIT,
              AGGREGATE_ENDPOINT_WINDOW_MS,
              redisNowMs + remainingMs,
            ) as Promise<unknown>,
            remainingMs,
          )) as string[]
          if (raw[0] === "allowed") {
            localLeases.set(leaseId, inflightKey)
            return { allowed: true, leaseId }
          }
          if (
            raw[0] === "in_flight" ||
            raw[0] === "cooldown" ||
            raw[0] === "session_hour" ||
            raw[0] === "endpoint_rate"
          ) {
            return { allowed: false, reason: raw[0] }
          }
          return { allowed: false, reason: "admission_unavailable" }
        } catch {
          return { allowed: false, reason: "admission_unavailable" }
        }
      }

      if (env.NODE_ENV === "production") {
        return { allowed: false, reason: "admission_unavailable" }
      }

      const now = Date.now()
      pruneLocalBuckets(now)
      const attempts = (localHourly.get(hourlyKey) ?? []).filter(
        (at) => at > now - SESSION_WINDOW_MS,
      )
      const clientEndpointAttempts = (
        localClientEndpoint.get(clientEndpointRateKey) ?? []
      ).filter((at) => at > now - CLIENT_ENDPOINT_WINDOW_MS)
      const aggregateEndpointAttempts = (
        localAggregateEndpoint.get(aggregateEndpointRateKey) ?? []
      ).filter((at) => at > now - AGGREGATE_ENDPOINT_WINDOW_MS)
      if (localInflight.has(inflightKey)) {
        return { allowed: false, reason: "in_flight" }
      }
      if ((localCooldown.get(cooldownKey) ?? 0) > now) {
        return { allowed: false, reason: "cooldown" }
      }
      if (attempts.length >= SESSION_LIMIT) {
        return { allowed: false, reason: "session_hour" }
      }
      if (
        clientEndpointAttempts.length >= CLIENT_ENDPOINT_LIMIT ||
        aggregateEndpointAttempts.length >= AGGREGATE_ENDPOINT_LIMIT
      ) {
        return { allowed: false, reason: "endpoint_rate" }
      }
      localInflight.set(inflightKey, leaseId)
      localCooldown.set(cooldownKey, now + COOLDOWN_MS)
      attempts.push(now)
      localHourly.set(hourlyKey, attempts)
      clientEndpointAttempts.push(now)
      localClientEndpoint.set(clientEndpointRateKey, clientEndpointAttempts)
      aggregateEndpointAttempts.push(now)
      localAggregateEndpoint.set(
        aggregateEndpointRateKey,
        aggregateEndpointAttempts,
      )
      localLeases.set(leaseId, inflightKey)
      return { allowed: true, leaseId }
    },

    async release(leaseId) {
      const inflightKey = localLeases.get(leaseId)
      localLeases.delete(leaseId)
      if (!inflightKey) return
      const redis = getRedisClient()
      if (redis) {
        try {
          await withTimeout(
            redis.eval(
              RELEASE_LUA,
              1,
              inflightKey,
              leaseId,
            ) as Promise<unknown>,
            COMMAND_TIMEOUT_MS,
          )
        } catch {
          // Lease expiry is the fail-safe; never widen a failed release.
        }
        return
      }
      if (localInflight.get(inflightKey) === leaseId) {
        localInflight.delete(inflightKey)
      }
    },
  }
}
