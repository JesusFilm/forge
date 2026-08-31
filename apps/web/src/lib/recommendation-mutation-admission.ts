import "server-only"

import { createHmac } from "node:crypto"
import { createClient } from "redis"
import { RecommendationRouteError } from "@/lib/recommendation-route-policy"

export const RECOMMENDATION_MUTATION_CLIENT_LIMIT = 30
export const RECOMMENDATION_MUTATION_AGGREGATE_LIMIT = 600
const WINDOW_MS = 60_000
const COMMAND_TIMEOUT_MS = 250
const REDIS_RETRY_BACKOFF_MS = 1_000
const MAX_LOCAL_BUCKETS = 10_000

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

type MutationRedis = {
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

export type RecommendationMutationAdmissionResult =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" | "admission_unavailable" }

const localClientBuckets = new Map<string, number[]>()
const localAggregateBuckets = new Map<
  RecommendationAdmissionNamespace,
  number[]
>()
let redisPromise: Promise<MutationRedis | null> | undefined
let redisClient: MutationRedis | null = null
let redisRetryAt = 0

function hmacKey(secret: string, namespace: string, value: string): string {
  return createHmac("sha256", secret)
    .update(namespace)
    .update("\0")
    .update(value)
    .digest("hex")
}

function trustedClientIdentifier(headers: Pick<Headers, "get">): string {
  // Production Watch sits behind Cloudflare. X-Forwarded-For is deliberately
  // ignored because a direct caller can supply it. Missing authoritative
  // identity collapses into one bounded bucket instead of bypassing admission.
  const address = headers.get("cf-connecting-ip")?.trim()
  return address && address.length <= 128 ? address : "unknown"
}

function admissionSecret(production: boolean): string | null {
  const configured = process.env.WEB_SESSION_SECRET?.trim()
  if (configured && configured.length >= 32) return configured
  return production ? null : "forge-local-recommendation-mutation-admission-v1"
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = COMMAND_TIMEOUT_MS,
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new RecommendationRouteError(503, "admission_unavailable")
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RecommendationRouteError(503, "admission_unavailable"))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function defaultRedis(): Promise<MutationRedis | null> {
  const url = process.env.REDIS_URL?.trim()
  if (!url) return null
  if (Date.now() < redisRetryAt) return null
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
    try {
      await withTimeout(client.connect())
      redisClient = client
      return client
    } catch {
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

function retireDefaultRedis(client: MutationRedis): void {
  if (redisClient !== client) return
  redisClient = null
  redisPromise = undefined
  redisRetryAt = Date.now() + REDIS_RETRY_BACKOFF_MS
  try {
    client.destroy?.()
  } catch {
    // A timed-out node-redis command may already have closed the socket.
  }
}

function pruneLocal(now: number): void {
  for (const [namespace, attempts] of localAggregateBuckets) {
    const fresh = attempts.filter((attempt) => attempt > now - WINDOW_MS)
    if (fresh.length === 0) localAggregateBuckets.delete(namespace)
    else localAggregateBuckets.set(namespace, fresh)
  }
  for (const [key, attempts] of localClientBuckets) {
    const fresh = attempts.filter((attempt) => attempt > now - WINDOW_MS)
    if (fresh.length === 0) localClientBuckets.delete(key)
    else localClientBuckets.set(key, fresh)
  }
  while (localClientBuckets.size >= MAX_LOCAL_BUCKETS) {
    const oldest = localClientBuckets.keys().next().value
    if (oldest == null) break
    localClientBuckets.delete(oldest)
  }
}

export function createRecommendationMutationAdmission(dependencies?: {
  production?: boolean
  now?: () => number
  monotonicNow?: () => number
  redis?: () => Promise<MutationRedis | null>
  secret?: string | null
}) {
  const production =
    dependencies?.production ?? process.env.NODE_ENV === "production"
  const now = dependencies?.now ?? Date.now
  const monotonicNow =
    dependencies?.monotonicNow ?? performance.now.bind(performance)
  const loadRedis = dependencies?.redis ?? defaultRedis

  return async function admit(
    headers: Pick<Headers, "get">,
    namespace: RecommendationAdmissionNamespace,
  ): Promise<RecommendationMutationAdmissionResult> {
    const secret =
      dependencies && "secret" in dependencies
        ? dependencies.secret
        : admissionSecret(production)
    if (!secret) return { allowed: false, reason: "admission_unavailable" }
    const clientDigest = hmacKey(
      secret,
      `recommendation-admission-client-v2:${namespace}`,
      trustedClientIdentifier(headers),
    )
    const aggregateDigest = hmacKey(
      secret,
      `recommendation-admission-aggregate-v2:${namespace}`,
      "all",
    )
    const clientKey = `recommendation:admission:${namespace}:client:${clientDigest}`
    const aggregateKey = `recommendation:admission:${namespace}:aggregate:${aggregateDigest}`
    const redis = await loadRedis().catch(() => null)

    if (redis) {
      try {
        // The Lua script must compare against Redis's own clock. An
        // application-clock deadline can move admission into the past or let
        // a queued EVAL mutate after the caller has already timed out.
        const startedAt = monotonicNow()
        const redisTime = await withTimeout(redis.time())
        const elapsedMs = Math.max(0, monotonicNow() - startedAt)
        const remainingMs = Math.floor(COMMAND_TIMEOUT_MS - elapsedMs)
        if (remainingMs <= 0) {
          retireDefaultRedis(redis)
          return { allowed: false, reason: "admission_unavailable" }
        }
        const redisNowMs =
          Number(redisTime[0]) * 1_000 +
          Math.floor(Number(redisTime[1]) / 1_000)
        if (!Number.isSafeInteger(redisNowMs)) {
          retireDefaultRedis(redis)
          return { allowed: false, reason: "admission_unavailable" }
        }
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
        return { allowed: false, reason: "admission_unavailable" }
      } catch {
        retireDefaultRedis(redis)
        return { allowed: false, reason: "admission_unavailable" }
      }
    }
    if (production) return { allowed: false, reason: "admission_unavailable" }

    const currentTime = now()
    pruneLocal(currentTime)
    const clientAttempts = localClientBuckets.get(clientKey) ?? []
    const aggregateAttempts = localAggregateBuckets.get(namespace) ?? []
    if (
      clientAttempts.length >= RECOMMENDATION_MUTATION_CLIENT_LIMIT ||
      aggregateAttempts.length >= RECOMMENDATION_MUTATION_AGGREGATE_LIMIT
    ) {
      return { allowed: false, reason: "rate_limited" }
    }
    clientAttempts.push(currentTime)
    localClientBuckets.delete(clientKey)
    localClientBuckets.set(clientKey, clientAttempts)
    aggregateAttempts.push(currentTime)
    localAggregateBuckets.set(namespace, aggregateAttempts)
    return { allowed: true }
  }
}

const admitRecommendationMutation = createRecommendationMutationAdmission()

export async function assertRecommendationMutationAdmission(
  headers: Pick<Headers, "get">,
  namespace: RecommendationAdmissionNamespace,
): Promise<void> {
  const admission = await admitRecommendationMutation(headers, namespace)
  if (!admission.allowed) {
    throw new RecommendationRouteError(
      admission.reason === "rate_limited" ? 429 : 503,
      admission.reason,
    )
  }
}

export function resetRecommendationMutationAdmissionForTests(): void {
  localClientBuckets.clear()
  localAggregateBuckets.clear()
  try {
    redisClient?.destroy?.()
  } catch {
    // Tests may reset after simulating a client-side disconnect.
  }
  redisClient = null
  redisPromise = undefined
  redisRetryAt = 0
}
