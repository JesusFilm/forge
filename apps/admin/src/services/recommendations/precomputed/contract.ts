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

const id = z.string().trim().min(1).max(191)
const englishText = z.string().trim().min(12).max(600)
const passage = z.object({
  chunkId: id,
  excerpt: z.string().trim().min(8).max(240),
})
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
  }),
  z.object({
    action: z.literal("source"),
    generationId: id,
    sourceVideoId: id,
    choices: z.array(choice),
  }),
  z.object({ action: z.literal("complete"), generationId: id }),
  z.object({ action: z.literal("fail"), generationId: id }),
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
    }
  | {
      state: "ready"
      generation: {
        id: string
        modelId: string
        promptVersion: string
        inputCutoff: Date
        acceptedCount: number
      }
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
    readonly code: "invalid" | "conflict" | "not_found" | "unauthorized",
    message: string,
  ) {
    super(message)
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
    }>
  >`
    SELECT id, status, expected_source_count, source_set_digest
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
        where: { locale: "en", status: "PUBLISHED", deletedAt: null },
        select: { title: true },
        take: 1,
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
          { videoCoreId: target.coreId, videoTitle: target.locales[0]?.title },
          { videoCoreId: prior.coreId, videoTitle: prior.locales[0]?.title },
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
      existing.expectedSourceCount !== input.expectedSourceCount
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
  return prisma.$transaction(async (tx) => {
    const generation = await lockGeneration(tx, input.generationId)
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
        if (existing.submissionDigest !== submissionDigest)
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
      if (generation.status === "complete")
        throw new PrecomputedRecommendationError(
          "conflict",
          "Complete generation cannot fail",
        )
      if (generation.status === "failed")
        return {
          generationId: input.generationId,
          state: "failed",
          replay: true,
        }
      await tx.recommendationPrecomputedGeneration.update({
        where: { id: input.generationId },
        data: { status: "failed", failedAt: new Date() },
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
    const sourceRows = await tx.recommendationPrecomputedSource.findMany({
      where: { generationId: input.generationId },
      select: { sourceVideoId: true },
    })
    if (
      sourceRows.length !== generation.expected_source_count ||
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
  if (generation.status !== "complete")
    return {
      state: generation.status === "failed" ? "failed" : "incomplete",
      experimental: [],
      semanticBaseline: [],
      coverageGap: null,
    }
  const source = await prisma.recommendationPrecomputedSource.findUnique({
    where: {
      generationId_sourceVideoId: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    },
  })
  if (!source)
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
        where: { locale: "en", status: "PUBLISHED", deletedAt: null },
        select: { title: true },
        take: 1,
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
    const playbackId = video?.dubs.find((dub) => dub.muxVideo?.playbackId)
      ?.muxVideo?.playbackId
    const reason =
      !video || video.deletedAt || video.restrictViewPlatforms.includes("watch")
        ? "watch_unavailable"
        : !video.locales[0]?.title
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
        videoTitle: video!.locales[0].title!,
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
      acceptedCount: source.acceptedCount,
    },
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
