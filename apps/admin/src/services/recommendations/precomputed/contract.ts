import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { getSemanticDeliveryRecommendations } from "../delivery-retriever"
import type { SceneRecommendation } from "@/services/scene-recommendations.service"
import { videoIdentityDuplicateReason } from "@/services/video-dedup"
import { isValidMastraRecommendationIngestBearer } from "@/auth/mastra-ingest-bearer"
import { retrieveCuratedFallback } from "../curated-fallback"
import { nominationEligibilityReasons } from "../eligibility"
import { RECOMMENDATION_CONTRACTS } from "../contracts"
import type { CuratedDeliveryDiagnostics } from "../delivery-diagnostics"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import {
  assertPrecomputedObservedVersion,
  PrecomputedCatalogError,
} from "./catalog"

const id = z.string().trim().min(1).max(191)
const englishText = z.string().trim().min(12).max(600)
const passage = z.object({
  chunkId: id,
  excerpt: z.string().trim().min(8).max(240),
})
const failureCode = z.enum([
  "provider_invalid_output",
  "provider_unavailable",
  "provider_access_unavailable",
  "input_stale",
  "catalog_unavailable",
  "analytics_unavailable",
  "analytics_incomplete",
  "analytics_mapping_unverified",
  "analytics_transition_totals_only",
  "analytics_transition_missing_session_identity",
  "analytics_transition_missing_event_order",
  "analytics_transition_missing_video_identity",
  "analytics_transition_unverified_definition",
  "contract_rejected",
  "internal_failure",
])
const historicalSignalQuality = z
  .object({
    botBasis: z.enum([
      "unverified",
      "verified_export_filter",
      "verified_query_filter",
    ]),
    overlapIdentity: z.enum([
      "unknown",
      "event_id",
      "verified_disjoint_export",
    ]),
  })
  .strict()
const historicalQualification = z
  .object({
    sourceTable: z
      .string()
      .max(191)
      .regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){2}$/),
    observedStart: z.iso.date(),
    observedEnd: z.iso.date(),
    watchScope: z
      .object({
        version: z.literal("jesusfilm-watch-v1"),
        hosts: z.tuple([
          z.literal("jesusfilm.org"),
          z.literal("www.jesusfilm.org"),
        ]),
        pathRule: z.literal("watch-route-and-children"),
        totalEvents: z.number().int().nonnegative().safe(),
        includedEvents: z.number().int().nonnegative().safe(),
        missingUrlEvents: z.number().int().nonnegative().safe(),
        malformedUrlEvents: z.number().int().nonnegative().safe(),
        excludedHostEvents: z.number().int().nonnegative().safe(),
        excludedPathEvents: z.number().int().nonnegative().safe(),
      })
      .strict(),
    videoIdCoverage: z
      .object({
        eventName: z.literal("videostarts"),
        inScopeEvents: z.number().int().nonnegative().safe(),
        withIdEvents: z.number().int().nonnegative().safe(),
        mappedEvents: z.number().int().nonnegative().safe().nullable(),
      })
      .strict(),
    engagement: historicalSignalQuality.extend({
      definitionVersion: z.literal("watch-videostarts-v1"),
    }),
    transitions: historicalSignalQuality.extend({
      status: z.literal("available"),
      definitionVersion: z.literal("consecutive-videostarts-v1"),
      continuity: z.literal("all_video_starts"),
      sessionIdentity: z.literal("verified"),
      ordering: z.literal("timestamp_and_sequence"),
    }),
  })
  .strict()
const historicalProvenance = z
  .object({
    provider: z.enum(["bigquery", "fixture"]),
    status: z.literal("complete"),
    queryId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
    rangeStart: z.iso.date(),
    rangeEnd: z.iso.date(),
    cutoff: z.string().datetime(),
    identity: z.enum(["canonical_id", "core_id", "slug", "verified_alias"]),
    botFiltering: z.enum(["unknown", "verified_excluded"]),
    measurement: z.enum(["observed_events", "qualified_engagement"]),
    overlap: z.enum(["unknown", "verified_disjoint"]),
    // Older saved generations remain readable, but their scope is unknown.
    qualification: historicalQualification.optional(),
    rowCount: z.number().int().nonnegative(),
    catalogCandidates: z.number().int().nonnegative(),
    inspectedCandidates: z.number().int().nonnegative(),
    unmappedCandidates: z.number().int().nonnegative(),
    mappedRows: z.number().int().nonnegative(),
    unmappedRows: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    queryExecutionCount: z.number().int().nonnegative(),
    queryUsageDigest: z.string().regex(/^[a-f0-9]{64}$/),
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/),
    unmappedDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    bytesProcessed: z.number().int().nonnegative().nullable(),
    costQualification: z.enum(["usage_only", "unavailable"]),
  })
  .strict()
function qualifiedHistoryIsConsistent(
  history: z.output<typeof historicalProvenance>,
): boolean {
  const quality = history.qualification
  if (!quality) return false
  const scope = quality.watchScope
  const ids = quality.videoIdCoverage
  return (
    quality.observedStart <= history.rangeStart &&
    quality.observedEnd >= history.rangeEnd &&
    quality.observedStart <= quality.observedEnd &&
    scope.totalEvents ===
      scope.includedEvents +
        scope.missingUrlEvents +
        scope.malformedUrlEvents +
        scope.excludedHostEvents +
        scope.excludedPathEvents &&
    ids.inScopeEvents <= scope.includedEvents &&
    ids.withIdEvents <= ids.inScopeEvents &&
    (ids.mappedEvents === null || ids.mappedEvents <= ids.withIdEvents) &&
    (history.botFiltering !== "verified_excluded" ||
      (quality.engagement.botBasis !== "unverified" &&
        quality.transitions.botBasis !== "unverified")) &&
    (history.overlap !== "verified_disjoint" ||
      (quality.engagement.overlapIdentity !== "unknown" &&
        quality.transitions.overlapIdentity !== "unknown"))
  )
}
const choice = z.object({
  targetVideoId: id,
  kind: z.enum(["direct", "alternative"]),
  rank: z.number().int().positive(),
  relationship: z.string().trim().min(3).max(80),
  reasonEnglish: englishText,
  addedViewingValueEnglish: englishText.optional(),
  evidence: z.discriminatedUnion("basis", [
    z.object({
      basis: z.literal("transcript"),
      passages: z.array(passage).min(1).max(3),
    }),
    z.object({
      basis: z.literal("metadata"),
      fields: z
        .array(
          z.enum([
            "title",
            "description",
            "keywords",
            "themes",
            "bibleCitations",
          ]),
        )
        .min(1)
        .max(5),
    }),
  ]),
})
const submission = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    generationId: id,
    modelId: z.string().trim().min(1).max(100),
    promptVersion: z.string().trim().min(1).max(100),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    inputCutoff: z.string().datetime(),
    expectedSourceCount: z.number().int().nonnegative(),
    inputMode: z
      .enum([
        "fixture",
        "content_only",
        "historical_fixture",
        "historical_analytics",
      ])
      .default("fixture"),
    inputSnapshotMode: z
      .enum(["fixture", "observed_fenced", "preflight_failed"])
      .optional(),
  }),
  z.object({
    action: z.literal("history"),
    generationId: id,
    history: historicalProvenance,
  }),
  z.object({
    action: z.literal("source"),
    generationId: id,
    sourceVideoId: id,
    choices: z.array(choice),
  }),
  z.object({ action: z.literal("complete"), generationId: id }),
  z.object({
    action: z.literal("model_call"),
    generationId: id,
    sourceVideoId: id,
    callId: id,
    stage: z.enum([
      "source_summary",
      "analytics_query_plan",
      "catalog_discovery",
      "candidate_judgment",
    ]),
    status: z.enum(["succeeded", "failed"]),
    modelId: z.string().trim().min(1).max(100),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    outputDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    errorCode: failureCode.optional(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
  }),
  z.object({
    action: z.literal("status"),
    generationId: id,
    sourceVideoId: id.optional(),
  }),
  z.object({
    action: z.literal("fail"),
    generationId: id,
    sourceVideoId: id.optional(),
    failureCode: failureCode.optional(),
  }),
])

type Choice = z.infer<typeof choice>
type SavedChoice = Omit<Choice, "evidence"> & {
  evidence:
    | { basis: "metadata"; fields: string[] }
    | {
        basis: "transcript"
        passages: Array<{
          chunkId: string
          videoId: string
          language: string
          excerpt: string
        }>
      }
}

export type PrecomputedComparison =
  | {
      state: "not_found" | "not_in_generation" | "incomplete" | "failed"
      experimental: []
      semanticBaseline: []
      coverageGap: null
      failureCode?: string | null
      inputSnapshotMode?: string
      history?: z.output<typeof historicalProvenance> | null
      usage?: ModelUsage
    }
  | {
      state: "ready"
      generation: {
        id: string
        modelId: string
        promptVersion: string
        inputCutoff: Date
        inputMode: string
        inputSnapshotMode: string
        acceptedCount: number
      }
      usage: ModelUsage
      history: z.output<typeof historicalProvenance> | null
      experimental: Array<
        SavedChoice & {
          videoSlug: string
          videoTitle: string
          playbackId: string
          imageUrl: string
        }
      >
      allAcceptedCount: number
      coverageGap: "no_connections" | "no_playable_connections" | null
      gaps: Array<{ targetVideoId: string; reason: string }>
      semanticBaseline: SceneRecommendation[]
      semanticBaselineState: "available" | "unavailable"
      anonymousBaseline: Array<{
        videoId: string
        videoSlug: string
        videoTitle: string
        imageUrl: string | null
      }>
      anonymousBaselineState:
        | "available"
        | "missing_generation"
        | "missing_context"
        | "unavailable"
    }

export class PrecomputedRecommendationError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "conflict"
      | "not_found"
      | "unauthorized"
      | "stale_cutoff",
    message: string,
  ) {
    super(message)
  }
}

type ModelUsage = {
  callCount: number
  unknownUsageCallCount: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

async function modelUsage(
  prisma: PrismaClient | Prisma.TransactionClient,
  generationId: string,
): Promise<ModelUsage> {
  const calls = await prisma.recommendationPrecomputedModelCall.findMany({
    where: { generationId },
    select: { inputTokens: true, outputTokens: true, cachedInputTokens: true },
  })
  return {
    callCount: calls.length,
    unknownUsageCallCount: calls.filter(
      (call) => call.inputTokens === null || call.outputTokens === null,
    ).length,
    inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
    outputTokens: calls.reduce(
      (sum, call) => sum + (call.outputTokens ?? 0),
      0,
    ),
    cachedInputTokens: calls.reduce(
      (sum, call) => sum + (call.cachedInputTokens ?? 0),
      0,
    ),
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function digestSourceSet(sourceVideoIds: string[]): string {
  // Producer contract: hash the JSON array after JavaScript's default
  // UTF-16 code-unit sort. Database collation must not determine this digest.
  return digest([...sourceVideoIds].sort())
}

function assertCanReview(reviewer: Principal | null): void {
  if (
    !hasPermission(reviewer, "read:recommendation-aggregates") ||
    !hasPermission(reviewer, "read:recommendation-traces")
  )
    throw new PrecomputedRecommendationError(
      "unauthorized",
      "Admin review permission required",
    )
}

async function lockGeneration(
  tx: Prisma.TransactionClient,
  generationId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string
      status: string
      expected_source_count: number
      source_set_digest: string
      input_mode: string
      input_snapshot_mode: string
      input_cutoff: Date
      historical_provenance: unknown
    }>
  >`
    SELECT id, status, expected_source_count, source_set_digest,
           input_mode, input_snapshot_mode, input_cutoff, historical_provenance
    FROM recommendation_precomputed_generation
    WHERE id = ${generationId}
    FOR UPDATE
  `
  if (!rows[0])
    throw new PrecomputedRecommendationError(
      "not_found",
      "Generation not found",
    )
  return rows[0]
}

async function validateChoices(
  tx: Prisma.TransactionClient,
  sourceVideoId: string,
  choices: Choice[],
): Promise<SavedChoice[]> {
  const videoIds = [sourceVideoId, ...choices.map((item) => item.targetVideoId)]
  const videos = await tx.video.findMany({
    where: { id: { in: videoIds }, deletedAt: null },
    select: {
      id: true,
      coreId: true,
      locales: {
        where: { status: "PUBLISHED", deletedAt: null },
        orderBy: { locale: "asc" },
        select: { locale: true, title: true },
      },
    },
  })
  const byId = new Map(videos.map((video) => [video.id, video]))
  const source = byId.get(sourceVideoId)
  if (!source || byId.size !== new Set(videoIds).size) {
    throw new PrecomputedRecommendationError(
      "invalid",
      "Source or target Video does not exist",
    )
  }
  const seenTargets = new Set<string>()
  const seenRanks = new Set<string>()
  const kept = [source]
  const titleForIdentity = (video: (typeof videos)[number]) =>
    video.locales.find((locale) => locale.locale === "en" && locale.title)
      ?.title ?? video.locales.find((locale) => locale.title)?.title
  for (const item of choices) {
    const target = byId.get(item.targetVideoId)!
    if (seenTargets.has(target.id) || target.id === source.id) {
      throw new PrecomputedRecommendationError(
        "invalid",
        "Duplicate or self target",
      )
    }
    seenTargets.add(target.id)
    const rankKey = `${item.kind}:${item.rank}`
    if (seenRanks.has(rankKey))
      throw new PrecomputedRecommendationError("invalid", "Duplicate rank")
    seenRanks.add(rankKey)
    for (const prior of kept) {
      if (
        videoIdentityDuplicateReason(
          { videoCoreId: target.coreId, videoTitle: titleForIdentity(target) },
          { videoCoreId: prior.coreId, videoTitle: titleForIdentity(prior) },
        )
      )
        throw new PrecomputedRecommendationError(
          "invalid",
          "Duplicate Video content",
        )
    }
    kept.push(target)
  }
  for (const kind of ["direct", "alternative"] as const) {
    const ranks = choices
      .filter((item) => item.kind === kind)
      .map((item) => item.rank)
      .sort((a, b) => a - b)
    if (ranks.some((rank, index) => rank !== index + 1)) {
      throw new PrecomputedRecommendationError(
        "invalid",
        "Ranks must be contiguous within each kind",
      )
    }
  }

  const relatives = await tx.videoRelation.findMany({
    where: {
      OR: [
        { parentId: sourceVideoId, childId: { in: videoIds } },
        { childId: sourceVideoId, parentId: { in: videoIds } },
      ],
    },
    select: { parentId: true, childId: true },
  })
  const relatedIds = new Set(
    relatives.map((item) =>
      item.parentId === sourceVideoId ? item.childId : item.parentId,
    ),
  )
  for (const item of choices) {
    if (relatedIds.has(item.targetVideoId) && !item.addedViewingValueEnglish) {
      throw new PrecomputedRecommendationError(
        "invalid",
        "Parent or chapter needs additional viewing value",
      )
    }
  }

  const chunkIds = choices.flatMap((item) =>
    item.evidence.basis === "transcript"
      ? item.evidence.passages.map((p) => p.chunkId)
      : [],
  )
  const chunks = await tx.videoTranscriptChunk.findMany({
    where: { id: { in: chunkIds } },
    select: {
      id: true,
      language: true,
      text: true,
      rawSourceText: true,
      transcript: { select: { videoId: true } },
    },
  })
  const byChunkId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  return choices.map((item) => {
    if (item.evidence.basis === "metadata") {
      return { ...item, evidence: item.evidence }
    }
    const passages = item.evidence.passages.map((passage) => {
      const chunk = byChunkId.get(passage.chunkId)
      if (
        !chunk ||
        ![sourceVideoId, item.targetVideoId].includes(
          chunk.transcript.videoId,
        ) ||
        !(chunk.rawSourceText ?? chunk.text).includes(passage.excerpt)
      ) {
        throw new PrecomputedRecommendationError(
          "invalid",
          "Transcript evidence does not match its Video and passage",
        )
      }
      return {
        chunkId: chunk.id,
        videoId: chunk.transcript.videoId,
        language: chunk.language,
        excerpt: passage.excerpt,
      }
    })
    return { ...item, evidence: { basis: "transcript" as const, passages } }
  })
}

/** Authenticated producer boundary. A fixture can call the same contract as Astra. */
export async function submitPrecomputedRecommendation(
  prisma: PrismaClient,
  raw: unknown,
  authorizationHeader: string | null,
) {
  if (!isValidMastraRecommendationIngestBearer(authorizationHeader)) {
    throw new PrecomputedRecommendationError(
      "unauthorized",
      "Authorization required",
    )
  }
  const parsed = submission.safeParse(raw)
  if (!parsed.success)
    throw new PrecomputedRecommendationError(
      "invalid",
      "Invalid generation payload",
    )
  const input = parsed.data
  if (input.action === "start") {
    const cutoff = new Date(input.inputCutoff)
    const snapshotMode =
      input.inputSnapshotMode ??
      (input.inputMode === "fixture" ? "fixture" : "observed_fenced")
    if (
      input.inputMode !== "fixture" &&
      snapshotMode !== "observed_fenced" &&
      snapshotMode !== "preflight_failed"
    )
      throw new PrecomputedRecommendationError(
        "invalid",
        "Invalid cutoff provenance",
      )
    if (input.inputMode === "fixture" && snapshotMode !== "fixture")
      throw new PrecomputedRecommendationError(
        "invalid",
        "Invalid historical provenance",
      )
    const inserted =
      await prisma.recommendationPrecomputedGeneration.createMany({
        data: [
          {
            id: input.generationId,
            modelId: input.modelId,
            promptVersion: input.promptVersion,
            inputDigest: input.inputDigest,
            sourceSetDigest: input.sourceSetDigest,
            inputCutoff: cutoff,
            expectedSourceCount: input.expectedSourceCount,
            inputMode: input.inputMode,
            inputSnapshotMode: snapshotMode,
            historicalProvenance: Prisma.DbNull,
          },
        ],
        skipDuplicates: true,
      })
    const existing =
      await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
        where: { id: input.generationId },
      })
    if (
      existing.modelId !== input.modelId ||
      existing.promptVersion !== input.promptVersion ||
      existing.inputDigest !== input.inputDigest ||
      existing.sourceSetDigest !== input.sourceSetDigest ||
      existing.inputCutoff.getTime() !== cutoff.getTime() ||
      existing.expectedSourceCount !== input.expectedSourceCount ||
      existing.inputMode !== input.inputMode ||
      existing.inputSnapshotMode !== snapshotMode
    )
      throw new PrecomputedRecommendationError(
        "conflict",
        "Generation identity has different input",
      )
    return {
      generationId: existing.id,
      state: existing.status,
      replay: inserted.count === 0,
    }
  }
  if (input.action === "status") {
    const generation =
      await prisma.recommendationPrecomputedGeneration.findUnique({
        where: { id: input.generationId },
      })
    if (!generation)
      throw new PrecomputedRecommendationError(
        "not_found",
        "Generation not found",
      )
    const source = input.sourceVideoId
      ? await prisma.recommendationPrecomputedSource.findUnique({
          where: {
            generationId_sourceVideoId: {
              generationId: input.generationId,
              sourceVideoId: input.sourceVideoId,
            },
          },
        })
      : null
    return {
      generationId: generation.id,
      state: generation.status,
      generationFailureCode: generation.failureCode,
      modelId: generation.modelId,
      promptVersion: generation.promptVersion,
      inputDigest: generation.inputDigest,
      sourceSetDigest: generation.sourceSetDigest,
      inputCutoff: generation.inputCutoff.toISOString(),
      expectedSourceCount: generation.expectedSourceCount,
      inputMode: generation.inputMode,
      inputSnapshotMode: generation.inputSnapshotMode,
      history: historicalProvenance
        .nullable()
        .parse(generation.historicalProvenance),
      source: source
        ? {
            status: source.status,
            acceptedCount: source.acceptedCount,
            failureCode: source.failureCode,
          }
        : null,
      usage: await modelUsage(prisma, generation.id),
    }
  }
  return prisma.$transaction(async (tx) => {
    const generation = await lockGeneration(tx, input.generationId)
    if (input.action === "history") {
      if (
        !["historical_analytics", "historical_fixture"].includes(
          generation.input_mode,
        ) ||
        generation.input_snapshot_mode !== "observed_fenced" ||
        (generation.input_mode === "historical_analytics" &&
          input.history.provider !== "bigquery") ||
        (generation.input_mode === "historical_fixture" &&
          input.history.provider !== "fixture") ||
        input.history.cutoff !== generation.input_cutoff.toISOString() ||
        input.history.mappedRows + input.history.unmappedRows !==
          input.history.rowCount ||
        input.history.inspectedCandidates + input.history.unmappedCandidates >
          input.history.catalogCandidates ||
        !qualifiedHistoryIsConsistent(input.history)
      )
        throw new PrecomputedRecommendationError(
          "invalid",
          "Invalid historical result",
        )
      if (generation.historical_provenance !== null) {
        if (
          digest(
            historicalProvenance.parse(generation.historical_provenance),
          ) !== digest(input.history)
        )
          throw new PrecomputedRecommendationError(
            "conflict",
            "Historical result differs",
          )
        return {
          generationId: input.generationId,
          state: generation.status,
          replay: true,
        }
      }
      if (generation.status !== "incomplete")
        throw new PrecomputedRecommendationError(
          "conflict",
          "Generation is closed",
        )
      await tx.recommendationPrecomputedGeneration.update({
        where: { id: input.generationId },
        data: { historicalProvenance: input.history as Prisma.InputJsonValue },
      })
      return {
        generationId: input.generationId,
        state: generation.status,
        replay: false,
      }
    }
    if (input.action === "model_call") {
      if (
        (input.status === "succeeded" &&
          (!input.outputDigest || input.errorCode)) ||
        (input.status === "failed" &&
          (input.outputDigest || !input.errorCode)) ||
        new Date(input.finishedAt) < new Date(input.startedAt)
      )
        throw new PrecomputedRecommendationError(
          "invalid",
          "Invalid model call outcome",
        )
      const row = {
        generationId: input.generationId,
        callId: input.callId,
        sourceVideoId: input.sourceVideoId,
        stage: input.stage,
        status: input.status,
        modelId: input.modelId,
        inputDigest: input.inputDigest,
        outputDigest: input.outputDigest ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        cachedInputTokens: input.cachedInputTokens ?? null,
        errorCode: input.errorCode ?? null,
        startedAt: new Date(input.startedAt),
        finishedAt: new Date(input.finishedAt),
      }
      const existing = await tx.recommendationPrecomputedModelCall.findUnique({
        where: {
          generationId_callId: {
            generationId: input.generationId,
            callId: input.callId,
          },
        },
      })
      if (existing) {
        if (
          digest({
            ...existing,
            startedAt: existing.startedAt.toISOString(),
            finishedAt: existing.finishedAt.toISOString(),
          }) !==
          digest({
            ...row,
            startedAt: row.startedAt.toISOString(),
            finishedAt: row.finishedAt.toISOString(),
          })
        )
          throw new PrecomputedRecommendationError(
            "conflict",
            "Model call retry differs",
          )
        return {
          generationId: input.generationId,
          state: generation.status,
          replay: true,
        }
      }
      if (generation.status !== "incomplete")
        throw new PrecomputedRecommendationError(
          "conflict",
          "Generation is closed",
        )
      await tx.recommendationPrecomputedModelCall.create({ data: row })
      return {
        generationId: input.generationId,
        state: generation.status,
        replay: false,
      }
    }
    if (input.action === "source") {
      const submissionDigest = digest(input.choices)
      const existing = await tx.recommendationPrecomputedSource.findUnique({
        where: {
          generationId_sourceVideoId: {
            generationId: input.generationId,
            sourceVideoId: input.sourceVideoId,
          },
        },
      })
      if (existing) {
        if (
          existing.status !== "complete" ||
          existing.submissionDigest !== submissionDigest
        )
          throw new PrecomputedRecommendationError(
            "conflict",
            "Source retry has different choices",
          )
        return {
          generationId: input.generationId,
          state: generation.status,
          replay: true,
        }
      }
      if (generation.status !== "incomplete")
        throw new PrecomputedRecommendationError(
          "conflict",
          "Generation is closed",
        )
      if (
        generation.input_mode !== "fixture" &&
        generation.input_snapshot_mode === "observed_fenced"
      ) {
        try {
          await assertPrecomputedObservedVersion(
            tx,
            [
              input.sourceVideoId,
              ...input.choices.map((item) => item.targetVideoId),
            ],
            generation.input_cutoff,
          )
        } catch (error) {
          if (
            error instanceof PrecomputedCatalogError &&
            error.code === "stale_cutoff"
          )
            throw new PrecomputedRecommendationError(
              "stale_cutoff",
              "Observed input changed after cutoff",
            )
          throw error
        }
      }
      const payload = await validateChoices(
        tx,
        input.sourceVideoId,
        input.choices,
      )
      await tx.recommendationPrecomputedSource.create({
        data: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
          payload: payload as unknown as Prisma.InputJsonValue,
          submissionDigest,
          acceptedCount: payload.length,
        },
      })
      return {
        generationId: input.generationId,
        state: "incomplete",
        replay: false,
      }
    }
    if (input.action === "fail") {
      if (input.sourceVideoId && !input.failureCode)
        throw new PrecomputedRecommendationError(
          "invalid",
          "Incomplete failure detail",
        )
      if (generation.status === "complete")
        throw new PrecomputedRecommendationError(
          "conflict",
          "Complete generation cannot fail",
        )
      if (input.sourceVideoId && input.failureCode) {
        const existing = await tx.recommendationPrecomputedSource.findUnique({
          where: {
            generationId_sourceVideoId: {
              generationId: input.generationId,
              sourceVideoId: input.sourceVideoId,
            },
          },
        })
        if (
          existing &&
          (existing.status !== "failed" ||
            existing.failureCode !== input.failureCode)
        )
          throw new PrecomputedRecommendationError(
            "conflict",
            "Source outcome differs",
          )
        if (!existing) {
          await tx.recommendationPrecomputedSource.create({
            data: {
              generationId: input.generationId,
              sourceVideoId: input.sourceVideoId,
              payload: [],
              submissionDigest: digest([]),
              acceptedCount: 0,
              status: "failed",
              failureCode: input.failureCode,
            },
          })
        }
      }
      if (generation.status === "failed")
        return {
          generationId: input.generationId,
          state: "failed",
          replay: true,
        }
      await tx.recommendationPrecomputedGeneration.update({
        where: { id: input.generationId },
        data: {
          status: "failed",
          failedAt: new Date(),
          failureCode: input.failureCode,
        },
      })
      return {
        generationId: input.generationId,
        state: "failed",
        replay: false,
      }
    }
    if (generation.status === "complete")
      return {
        generationId: input.generationId,
        state: "complete",
        replay: true,
      }
    if (generation.status !== "incomplete")
      throw new PrecomputedRecommendationError(
        "conflict",
        "Generation is closed",
      )
    const historyForCompletion = historicalProvenance.safeParse(
      generation.historical_provenance,
    )
    if (
      ["historical_analytics", "historical_fixture"].includes(
        generation.input_mode,
      ) &&
      (!historyForCompletion.success ||
        !qualifiedHistoryIsConsistent(historyForCompletion.data))
    )
      throw new PrecomputedRecommendationError(
        "conflict",
        "Historical input incomplete",
      )
    const sourceRows = await tx.recommendationPrecomputedSource.findMany({
      where: { generationId: input.generationId },
      select: { sourceVideoId: true, status: true },
    })
    if (
      sourceRows.length !== generation.expected_source_count ||
      sourceRows.some((row) => row.status !== "complete") ||
      digestSourceSet(sourceRows.map((row) => row.sourceVideoId)) !==
        generation.source_set_digest
    )
      throw new PrecomputedRecommendationError(
        "conflict",
        "Generation source coverage is incomplete",
      )
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: input.generationId },
      data: { status: "complete", completedAt: new Date() },
    })
    return {
      generationId: input.generationId,
      state: "complete",
      replay: false,
    }
  })
}

export async function loadPrecomputedRecommendationComparison(
  prisma: PrismaClient,
  input: {
    generationId: string
    sourceVideoId: string
    audioLanguageSlug: string
    reviewer: Principal | null
  },
): Promise<PrecomputedComparison> {
  assertCanReview(input.reviewer)
  const generation =
    await prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: input.generationId },
    })
  if (!generation)
    return {
      state: "not_found" as const,
      experimental: [],
      semanticBaseline: [],
      coverageGap: null,
    }
  if (generation.status !== "complete") {
    const failedSource =
      generation.status === "failed"
        ? await prisma.recommendationPrecomputedSource.findUnique({
            where: {
              generationId_sourceVideoId: {
                generationId: input.generationId,
                sourceVideoId: input.sourceVideoId,
              },
            },
            select: { failureCode: true },
          })
        : null
    return {
      state: generation.status === "failed" ? "failed" : "incomplete",
      experimental: [],
      semanticBaseline: [],
      coverageGap: null,
      failureCode: failedSource?.failureCode ?? generation.failureCode,
      inputSnapshotMode: generation.inputSnapshotMode,
      history: historicalProvenance
        .nullable()
        .parse(generation.historicalProvenance),
      usage:
        generation.status === "failed"
          ? await modelUsage(prisma, generation.id)
          : undefined,
    }
  }
  const source = await prisma.recommendationPrecomputedSource.findUnique({
    where: {
      generationId_sourceVideoId: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    },
  })
  if (!source || source.status !== "complete")
    return {
      state: "not_in_generation" as const,
      experimental: [],
      semanticBaseline: [],
      coverageGap: null,
    }
  const choices = source.payload as SavedChoice[]
  const candidates = await prisma.video.findMany({
    where: { id: { in: choices.map((item) => item.targetVideoId) } },
    select: {
      id: true,
      slug: true,
      deletedAt: true,
      restrictViewPlatforms: true,
      locales: {
        where: { status: "PUBLISHED", deletedAt: null },
        orderBy: { locale: "asc" },
        select: { locale: true, title: true },
      },
      dubs: {
        where: {
          deletedAt: null,
          published: true,
          language: { slug: input.audioLanguageSlug },
          muxVideo: { deletedAt: null, playbackId: { not: null } },
        },
        select: { muxVideo: { select: { playbackId: true } } },
        take: 1,
      },
      images: {
        where: { deletedAt: null },
        select: {
          mobileCinematicHigh: true,
          videoStill: true,
          thumbnail: true,
          url: true,
        },
        take: 1,
      },
    },
  })
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const ordered = [...choices].sort((a, b) =>
    a.kind === b.kind ? a.rank - b.rank : a.kind === "direct" ? -1 : 1,
  )
  const gaps: Array<{ targetVideoId: string; reason: string }> = []
  const accepted = ordered.flatMap((item) => {
    const video = byId.get(item.targetVideoId)
    const presentation =
      video?.locales.find((locale) => locale.locale === "en" && locale.title) ??
      video?.locales.find((locale) => locale.title)
    const playbackId = video?.dubs.find((dub) => dub.muxVideo?.playbackId)
      ?.muxVideo?.playbackId
    const reason =
      !video || video.deletedAt || video.restrictViewPlatforms.includes("watch")
        ? "watch_unavailable"
        : !presentation?.title
          ? "presentation_unavailable"
          : !playbackId
            ? "audio_unavailable"
            : null
    if (reason) {
      gaps.push({ targetVideoId: item.targetVideoId, reason })
      return []
    }
    const image = video!.images[0]
    return [
      {
        ...item,
        videoSlug: video!.slug,
        videoTitle: presentation!.title!,
        playbackId: playbackId!,
        imageUrl:
          image?.mobileCinematicHigh ||
          image?.videoStill ||
          image?.thumbnail ||
          image?.url ||
          `https://image.mux.com/${encodeURIComponent(playbackId!)}/thumbnail.jpg?time=0`,
      },
    ]
  })
  // Both reads stay outside the live request/assignment path. The anonymous
  // contextual branch in delivery.service uses curated nominations directly;
  // its empty-result recovery is part of the incumbent and must be visible.
  let semanticBaseline: Awaited<
    ReturnType<typeof getSemanticDeliveryRecommendations>
  > = []
  let semanticBaselineState: "available" | "unavailable" = "available"
  let anonymousBaseline: Array<{
    videoId: string
    videoSlug: string
    videoTitle: string
    imageUrl: string | null
  }> = []
  let anonymousBaselineState:
    | "available"
    | "missing_generation"
    | "missing_context"
    | "unavailable" = "available"
  try {
    semanticBaseline = await getSemanticDeliveryRecommendations(prisma, {
      seedMediaId: input.sourceVideoId,
      locale: "en",
      audioLanguageSlug: input.audioLanguageSlug,
      limit: 6,
    })
  } catch {
    semanticBaselineState = "unavailable"
  }
  try {
    const diagnostics: { state: CuratedDeliveryDiagnostics["state"] } = {
      state: "missing_generation",
    }
    const nominations = await retrieveCuratedFallback(prisma, {
      seedMediaId: input.sourceVideoId,
      locale: "en",
      audioLanguageSlug: input.audioLanguageSlug,
      excludedMediaIds: [],
      deadlineAt: Date.now() + 5000,
      onDiagnostics: (value) => {
        diagnostics.state = value.state
      },
    })
    anonymousBaselineState = diagnostics.state
    anonymousBaseline = nominations
      .filter(
        (nomination) =>
          nominationEligibilityReasons(nomination, {
            surface: RECOMMENDATION_CONTRACTS.surface,
            purpose: "watch",
            locale: "en",
            audioLanguageSlug: input.audioLanguageSlug,
          }).length === 0,
      )
      .slice(0, 6)
      .map((nomination) => ({
        videoId: nomination.targetMediaId,
        videoSlug: nomination.presentation.videoSlug,
        videoTitle: nomination.presentation.videoTitle,
        imageUrl: nomination.presentation.imageUrl,
      }))
  } catch {
    anonymousBaselineState = "unavailable"
  }
  return {
    state: "ready" as const,
    generation: {
      id: generation.id,
      modelId: generation.modelId,
      promptVersion: generation.promptVersion,
      inputCutoff: generation.inputCutoff,
      inputMode: generation.inputMode,
      inputSnapshotMode: generation.inputSnapshotMode,
      acceptedCount: source.acceptedCount,
    },
    usage: await modelUsage(prisma, generation.id),
    history: historicalProvenance
      .nullable()
      .parse(generation.historicalProvenance),
    experimental: accepted.slice(0, 6),
    allAcceptedCount: source.acceptedCount,
    coverageGap:
      choices.length === 0
        ? "no_connections"
        : accepted.length === 0
          ? "no_playable_connections"
          : null,
    gaps,
    semanticBaseline,
    semanticBaselineState,
    anonymousBaseline,
    anonymousBaselineState,
  }
}

/** Bounded selector lookup for the Admin page; presentation never queries DB. */
export async function loadPrecomputedReviewSelection(
  prisma: PrismaClient,
  input: {
    sourceQuery: string
    generationId: string
    reviewer: Principal | null
  },
) {
  assertCanReview(input.reviewer)
  const generations = await prisma.recommendationPrecomputedGeneration.findMany(
    {
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, modelId: true },
    },
  )
  const source = input.sourceQuery
    ? await prisma.video.findFirst({
        where: { OR: [{ id: input.sourceQuery }, { slug: input.sourceQuery }] },
        select: { id: true, slug: true },
      })
    : null
  return {
    generations,
    source,
    generationId: input.generationId || generations[0]?.id || "",
  }
}
