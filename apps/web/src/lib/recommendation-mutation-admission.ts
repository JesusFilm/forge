import "server-only"

import { createHmac } from "node:crypto"
import { RecommendationRouteError } from "@/lib/recommendation-route-policy"
import {
  RECOMMENDATION_MUTATION_CLIENT_LIMIT,
  RECOMMENDATION_MUTATION_AGGREGATE_LIMIT,
  WINDOW_MS,
  runRedisAdmission,
  resetRedisAdmissionForTests,
  observeAdmissionFailure,
  type MutationRedis,
  type RecommendationAdmissionNamespace,
  type RecommendationMutationAdmissionResult,
} from "./recommendation-redis-admission"
import {
  admitInWorker,
  resetAdmissionWorkerForTests,
} from "./recommendation-admission-worker-client"
export {
  RECOMMENDATION_MUTATION_CLIENT_LIMIT,
  RECOMMENDATION_MUTATION_AGGREGATE_LIMIT,
  type RecommendationAdmissionNamespace,
  type RecommendationMutationAdmissionResult,
} from "./recommendation-redis-admission"

const MAX_LOCAL_BUCKETS = 10_000
const localClientBuckets = new Map<string, number[]>()
const localAggregateBuckets = new Map<
  RecommendationAdmissionNamespace,
  number[]
>()
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

  return async function admit(
    headers: Pick<Headers, "get">,
    namespace: RecommendationAdmissionNamespace,
  ): Promise<RecommendationMutationAdmissionResult> {
    const secret =
      dependencies && "secret" in dependencies
        ? dependencies.secret
        : admissionSecret(production)
    if (!secret) {
      observeAdmissionFailure("configuration", "secret_missing")
      return { allowed: false, reason: "admission_unavailable" }
    }
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
    const result =
      production && dependencies == null
        ? await admitInWorker(clientKey, aggregateKey, namespace)
        : await runRedisAdmission(clientKey, aggregateKey, namespace, {
            monotonicNow,
            redis: dependencies?.redis,
          })
    if (result) return result
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
  resetRedisAdmissionForTests()
  resetAdmissionWorkerForTests()
}
