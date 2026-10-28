import { type PrismaClient } from "@prisma/client"

import {
  dispatchRecommendationProfileProjection,
  redispatchRecommendationProfileProjectionRun,
} from "./job"

export type RecommendationProfileReconciliationResult = Readonly<{
  retired?: boolean
  locked: boolean
  affectedPointers: number
  classificationsAttempted: number
  classificationsFailed: number
  rebuildsQueued: number
  staleRuns: number
  staleRunsQueued: number
  attemptsExhausted: number
  dispatchFailures: number
}>

type ReconciliationDependencies = Readonly<{
  prisma: PrismaClient
  classifyOutcome: (id: string) => Promise<unknown>
  classifySelection: (id: string) => Promise<unknown>
  dispatchProjection: typeof dispatchRecommendationProfileProjection
  redispatchRun: typeof redispatchRecommendationProfileProjectionRun
}>

export async function runRecommendationProfileReconciliationBatch(
  _overrides: Partial<ReconciliationDependencies> = {},
  _now = new Date(),
): Promise<RecommendationProfileReconciliationResult> {
  return {
    retired: true,
    locked: false,
    affectedPointers: 0,
    classificationsAttempted: 0,
    classificationsFailed: 0,
    rebuildsQueued: 0,
    staleRuns: 0,
    staleRunsQueued: 0,
    attemptsExhausted: 0,
    dispatchFailures: 0,
  }
}
