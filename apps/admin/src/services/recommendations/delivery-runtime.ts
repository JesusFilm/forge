import { Prisma, type PrismaClient } from "@prisma/client"
import type { SemanticCandidatePoolItem } from "./candidate"
import {
  CANDIDATE_POOL_TTL_SECONDS,
  RECOMMENDATION_CONTRACTS,
} from "./contracts"
import type { SemanticRecommendationDelivery } from "./delivery.types"

const candidatePools = new Map<
  string,
  { expiresAt: number; items: SemanticCandidatePoolItem[] }
>()
const MAX_CANDIDATE_POOLS = 1_000
const STALE_CANDIDATE_POOL_EVIDENCE_MS = 5 * 60 * 1_000

export const DELIVERY_ISSUANCE_RESERVE_MS = 250
export const CACHED_RECHECK_RESERVE_MS = 100
export const DELIVERY_RESPONSE_RESERVE_MS = 25

export function invalidateRecommendationCandidatePools(): void {
  candidatePools.clear()
}

export function readCandidatePool(key: string) {
  return candidatePools.get(key)
}

export function setCandidatePool(
  key: string,
  items: SemanticCandidatePoolItem[],
  now: number,
): void {
  for (const [existingKey, pool] of candidatePools) {
    if (pool.expiresAt + STALE_CANDIDATE_POOL_EVIDENCE_MS <= now) {
      candidatePools.delete(existingKey)
    }
  }
  while (candidatePools.size >= MAX_CANDIDATE_POOLS) {
    const oldestKey = candidatePools.keys().next().value as string | undefined
    if (!oldestKey) break
    candidatePools.delete(oldestKey)
  }
  candidatePools.set(key, {
    expiresAt: now + CANDIDATE_POOL_TTL_SECONDS * 1_000,
    items,
  })
}

export function unavailable(reason: string): SemanticRecommendationDelivery {
  return {
    contractVersion: RECOMMENDATION_CONTRACTS.delivery,
    surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
    strategyVersion: RECOMMENDATION_CONTRACTS.strategy,
    classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
    requestId: null,
    result: "unavailable",
    reason,
    expiresAt: null,
    items: [],
  }
}

export class RecommendationRetrievalTimeoutError extends Error {
  constructor() {
    super("retrieval_timeout")
    this.name = "RecommendationRetrievalTimeoutError"
  }
}

export async function withinDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  nowMilliseconds: () => number,
): Promise<T> {
  const remaining = deadlineAt - nowMilliseconds()
  if (remaining <= 0) throw new RecommendationRetrievalTimeoutError()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RecommendationRetrievalTimeoutError()),
          remaining,
        )
      }),
    ])
    if (nowMilliseconds() > deadlineAt) {
      throw new RecommendationRetrievalTimeoutError()
    }
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function runRecommendationRetrievalQuery<T>(
  prisma: PrismaClient,
  deadlineAt: number,
  operation: (scopedPrisma: Pick<PrismaClient, "$queryRaw">) => Promise<T>,
  nowMilliseconds: () => number = Date.now,
): Promise<T> {
  const remaining = Math.floor(deadlineAt - nowMilliseconds())
  if (remaining <= 0) throw new RecommendationRetrievalTimeoutError()
  return prisma.$transaction(
    async (tx) => {
      const queryRemaining = Math.floor(deadlineAt - nowMilliseconds())
      if (queryRemaining <= 0) {
        throw new RecommendationRetrievalTimeoutError()
      }
      await tx.$queryRaw`
        SELECT
          set_config('statement_timeout', ${String(queryRemaining)}, true),
          set_config(
            'search_path',
            quote_ident(current_schema()) || ',public',
            true
          )
      `
      return operation(tx)
    },
    { maxWait: remaining, timeout: remaining },
  )
}

export async function runRecommendationDeliveryTransaction<T>(
  prisma: PrismaClient,
  deadlineAt: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  nowMilliseconds: () => number,
): Promise<T> {
  const remaining = Math.floor(deadlineAt - nowMilliseconds())
  if (remaining <= 0) throw new RecommendationRetrievalTimeoutError()
  return prisma.$transaction(
    async (tx) => {
      const queryRemaining = Math.floor(deadlineAt - nowMilliseconds())
      if (queryRemaining <= 0) {
        throw new RecommendationRetrievalTimeoutError()
      }
      await tx.$queryRaw`
        SELECT set_config(
          'statement_timeout',
          ${String(queryRemaining)},
          true
        )
      `
      return operation(tx)
    },
    { maxWait: remaining, timeout: remaining },
  )
}
