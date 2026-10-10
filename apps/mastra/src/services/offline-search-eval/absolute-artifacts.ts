import { mkdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { getMastraStorageDir } from "../../config/env"
import { SearchResultSchema } from "../admin-search-eval-client"
import { ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION } from "./absolute-query-set"
import type { AbsoluteSearchEvalReport } from "./absolute-runner"

const SAFE_REPORT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

const LaneStatusSchema = z
  .object({
    lane: z.string().min(1).max(64),
    status: z.enum(["fulfilled", "degraded", "skipped"]),
    startedOffsetMs: z.number().nonnegative(),
    elapsedMs: z.number().nonnegative(),
    resultCount: z.number().int().nonnegative(),
    reason: z.string().max(256).nullable(),
    detail: z.string().max(128).nullable(),
  })
  .strict()

const RelevanceSchema = z.record(
  z.string().min(1).max(256),
  z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
)

const AbsoluteSearchEvalObservationSchema = z
  .object({
    caseId: z.string().min(1).max(128),
    split: z.enum(["development", "held-out"]),
    intent: z.enum([
      "product-title",
      "metadata-topic",
      "semantic-intent",
      "typo-recovery",
      "confusing-or-no-result",
    ]),
    locale: z.string().min(1).max(32),
    expectedLanguageSlug: z.string().min(1).max(128).optional(),
    expectedNoResult: z.boolean().optional(),
    multilingual: z.boolean(),
    queryText: z.string().min(1).max(200),
    languageSlug: z.string().min(1).max(128).optional(),
    results: z.array(SearchResultSchema).max(50),
    relevance: RelevanceSchema,
    latencyMs: z.number().nonnegative(),
    roundTripLatencyMs: z.number().nonnegative(),
    serverLatencyMs: z.number().nonnegative().nullable(),
    requestId: z.string().max(128).nullable(),
    serverRevision: z.string().max(128).nullable(),
    laneStatuses: z.array(LaneStatusSchema).max(20),
    degraded: z.boolean().optional(),
    pointwiseRating: z
      .enum(["excellent", "useful", "weak", "unacceptable"])
      .optional(),
    pointwiseRationale: z.string().max(1_000).optional(),
    searchFailure: z.string().max(128).optional(),
    judgeFailure: z.string().max(128).optional(),
  })
  .strict()

const AbsoluteSearchQualitySchema = z
  .object({
    queries: z.number().int().nonnegative(),
    evaluatedRelevanceCases: z.number().int().nonnegative(),
    successAt1: z.number().min(0).max(1),
    successAt10: z.number().min(0).max(1),
    mrr: z.number().min(0).max(1),
    ndcgAt10: z.number().min(0).max(1),
    productTitleSuccessAt1: z.number().min(0).max(1),
    semanticIntentSuccessAt10: z.number().min(0).max(1),
    multilingualSuccessAt10: z.number().min(0).max(1),
    noResultRate: z.number().min(0).max(1),
    expectedNoResultCases: z.number().int().nonnegative(),
    expectedNoResultAccuracy: z.number().min(0).max(1),
    languageCorrectness: z.number().min(0).max(1),
    canonicalDuplicateRate: z.number().min(0).max(1),
    degradationRate: z.number().min(0).max(1),
    pointwiseUsefulRate: z.number().min(0).max(1),
    pointwiseUnacceptableRate: z.number().min(0).max(1),
    latency: z
      .object({
        p50Ms: z.number().nonnegative(),
        p95Ms: z.number().nonnegative(),
        p99Ms: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict()

const CandidateIdentitySchema = z
  .object({
    revision: z.string().min(7).max(128),
    collections: z
      .object({
        catalog: z.string().min(1).max(256),
        availability: z.string().min(1).max(256),
        lexical: z.string().min(1).max(256),
        transcripts: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict()

const OperatorReviewSchema = z
  .object({
    approved: z.boolean(),
    reviewer: z.string().min(1).max(128),
    notes: z.string().min(1).max(2_000),
  })
  .strict()

export const AbsoluteSearchEvalReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("absolute-report"),
    reportId: z.string().regex(SAFE_REPORT_ID),
    querySetVersion: z.literal(ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION),
    split: z.enum(["development", "held-out"]),
    backendMode: z.enum(["modern", "default"]),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    adminSearchUrl: z.string().url().nullable(),
    relevanceJudgmentSetVersion: z.string().min(1).max(128),
    judgeModel: z.string().nullable(),
    judgeProvider: z.string().nullable(),
    candidateIdentity: CandidateIdentitySchema.nullable(),
    observedServerRevisions: z.array(z.string().max(128)).max(5),
    operatorReview: OperatorReviewSchema.nullable(),
    observations: z.array(AbsoluteSearchEvalObservationSchema).min(1).max(150),
    quality: AbsoluteSearchQualitySchema,
    relevanceCoverage: z.number().min(0).max(1),
    gate: z
      .object({
        passed: z.boolean(),
        reasons: z.array(z.string().max(128)).max(30),
      })
      .strict(),
    cost: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        reportedUsd: z.number().nonnegative().nullable(),
      })
      .strict(),
    timings: z
      .object({
        searchMs: z.number().nonnegative(),
        judgeMs: z.number().nonnegative(),
        totalMs: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict()

export type AbsoluteSearchEvalArtifactWriter = {
  writeReport: (report: AbsoluteSearchEvalReport) => Promise<{ path: string }>
}

export function createAbsoluteSearchEvalArtifactWriter(
  rootDir = path.join(getMastraStorageDir(), "search-eval", "absolute-reports"),
): AbsoluteSearchEvalArtifactWriter {
  return {
    async writeReport(report) {
      const parsed = AbsoluteSearchEvalReportSchema.safeParse(report)
      if (!parsed.success) {
        throw new Error("absolute search eval report failed validation", {
          cause: parsed.error,
        })
      }
      await mkdir(rootDir, { recursive: true })
      const destination = path.join(rootDir, `${report.reportId}.json`)
      const temporary = `${destination}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(parsed.data, null, 2)}\n`, {
        mode: 0o600,
      })
      await rename(temporary, destination)
      return { path: destination }
    },
  }
}
