import { Prisma, type PrismaClient } from "@prisma/client"
import { createVideoIdentityDuplicateReasonResolver } from "@/services/video-dedup"
import { hydrateCuratedVideos } from "./curated-pools.catalog"
import { digestValue } from "./promotion/manifest"
import {
  CURATED_POOL_MAX_RUNTIME_CANDIDATES,
  CURATED_POOL_POINTER_ID,
  CURATED_POOL_VALIDATION_VERSION,
  CuratedPoolCoverageError,
  CuratedPoolInputError,
  CuratedPoolPromotionError,
  materializeCuratedContext,
  parseCuratedPoolSource,
  requiredCuratedDepth,
  validateCuratedContexts,
  type CuratedCoverageReport,
  type CuratedCoverageRequirement,
  type CuratedPoolContext,
  type CuratedRecommendationCandidate,
} from "./curated-pools.types"

type Database = Prisma.TransactionClient
type ImportInput = {
  source: unknown
  contexts: readonly CuratedPoolContext[]
  requirement: CuratedCoverageRequirement
}

/** One-time, versioned editorial data. No model calls or catalog scans on reads. */
export class CuratedPoolsService {
  constructor(private readonly dependencies: { prisma: PrismaClient }) {}

  private async validate(db: Database, input: ImportInput) {
    const source = parseCuratedPoolSource(input.source)
    validateCuratedContexts(input.contexts)
    requiredCuratedDepth(input.requirement)
    const coreIds = source.candidates.flatMap((item) => [
      item.coreVideoId,
      ...item.alternateCoreVideoIds,
    ])
    const videos = await db.video.findMany({
      where: { coreId: { in: coreIds } },
      select: { id: true, coreId: true },
    })
    const languages = await db.language.findMany({
      where: {
        slug: {
          in: [
            ...new Set(
              input.contexts.map((context) => context.audioLanguageSlug),
            ),
          ],
        },
        deletedAt: null,
      },
      select: { slug: true, coreId: true },
    })
    const languageIds = new Map(
      languages.map((language) => [language.slug, language.coreId]),
    )
    const resolved = new Set(videos.map((video) => video.coreId))
    const materialized = []
    for (const context of input.contexts) {
      const validLanguage =
        languageIds.get(context.audioLanguageSlug) === context.coreLanguageId
      const hydrated = validLanguage
        ? await hydrateCuratedVideos(
            db,
            videos.map((video) => video.id),
            context,
          )
        : []
      materialized.push(
        materializeCuratedContext(
          source,
          hydrated,
          context,
          validLanguage,
          input.requirement,
        ),
      )
    }
    const report: CuratedCoverageReport = {
      validationVersion: CURATED_POOL_VALIDATION_VERSION,
      version: source.version,
      sourceDigest: digestValue(source),
      checkedAt: new Date().toISOString(),
      passed:
        coreIds.every((id) => resolved.has(id)) &&
        materialized.every((item) => item.coverage.passed),
      requirement: input.requirement,
      unknownCoreVideoIds: coreIds.filter((id) => !resolved.has(id)),
      contexts: materialized.map((item) => item.coverage),
    }
    return { source, report, videos, materialized }
  }

  async audit(input: ImportInput): Promise<CuratedCoverageReport> {
    return (await this.validate(this.dependencies.prisma, input)).report
  }

  async importGeneration(input: ImportInput): Promise<CuratedCoverageReport> {
    // Repeatable-read keeps the report and materialized IDs in the same snapshot.
    return this.dependencies.prisma.$transaction(
      async (db) => {
        const { source, report, videos, materialized } = await this.validate(
          db,
          input,
        )
        if (!report.passed) throw new CuratedPoolCoverageError(report)
        const existing = await db.recommendationCuratedGeneration.findUnique({
          where: { version: source.version },
          select: { id: true },
        })
        if (existing)
          throw new CuratedPoolInputError(
            "Curated version already exists; use a new immutable version",
          )
        const generation = await db.recommendationCuratedGeneration.create({
          data: {
            version: source.version,
            sourceDigest: report.sourceDigest,
            validationVersion: CURATED_POOL_VALIDATION_VERSION,
            sourceManifest: source as Prisma.InputJsonObject,
            coverageReport: report as unknown as Prisma.InputJsonObject,
          },
        })
        const byCoreId = new Map(
          videos.map((video) => [video.coreId, video.id]),
        )
        await db.recommendationCuratedMembership.createMany({
          data: source.candidates
            .filter((item) => !item.sensitivityReviewRequired)
            .flatMap((item) =>
              [item.coreVideoId, ...item.alternateCoreVideoIds].flatMap(
                (coreVideoId) => {
                  const videoId = byCoreId.get(coreVideoId)
                  return videoId
                    ? [
                        {
                          generationId: generation.id,
                          videoId,
                          coreVideoId,
                          themeKeys: item.themeKeys,
                          editorialRank: item.editorialRank,
                          metadata: {
                            duplicateGroup: item.duplicateGroup,
                            rationale: item.rationale,
                          },
                        },
                      ]
                    : []
                },
              ),
            ),
        })
        // Batches bound parameter counts even for an explicit all-language import.
        const pools = materialized.flatMap(({ coverage, pools }) =>
          [...pools].map(([poolKey, videoIds]) => ({
            generationId: generation.id,
            locale: coverage.locale,
            audioLanguageSlug: coverage.audioLanguageSlug,
            coreLanguageId: coverage.coreLanguageId,
            poolKey,
            videoIds,
          })),
        )
        for (let offset = 0; offset < pools.length; offset += 250) {
          await db.recommendationCuratedPool.createMany({
            data: pools.slice(offset, offset + 250),
          })
        }
        await db.recommendationCuratedGeneration.update({
          where: { id: generation.id },
          data: { sealedAt: new Date() },
        })
        return report
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 600_000,
        maxWait: 10_000,
      },
    )
  }

  private async movePointer(input: {
    version?: string
    expectedCurrentVersion: string | null
    rollback: boolean
  }) {
    return this.dependencies.prisma.$transaction(
      async (db) => {
        // The advisory lock also serializes the first promotion, when no row exists.
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${CURATED_POOL_POINTER_ID}, 0))`
        const pointer = await db.recommendationCuratedPointer.findUnique({
          where: { id: CURATED_POOL_POINTER_ID },
          include: { generation: { select: { version: true } } },
        })
        if (
          (pointer?.generation.version ?? null) !== input.expectedCurrentVersion
        ) {
          throw new CuratedPoolPromotionError(
            "Active curated version changed; inspect it before retrying",
          )
        }
        if (input.rollback && !pointer?.previousGenerationId)
          throw new CuratedPoolPromotionError("No previous curated generation")
        const generation = await db.recommendationCuratedGeneration.findUnique({
          where: input.rollback
            ? { id: pointer!.previousGenerationId! }
            : { version: input.version! },
        })
        if (
          !generation?.sealedAt ||
          generation.validationVersion !== CURATED_POOL_VALIDATION_VERSION
        ) {
          throw new CuratedPoolPromotionError(
            "Curated generation is missing or unsealed",
          )
        }
        const stored =
          generation.coverageReport as unknown as CuratedCoverageReport
        if (!stored.passed || !Array.isArray(stored.contexts))
          throw new CuratedPoolPromotionError(
            "Curated generation has no passing coverage report",
          )
        const fresh = await this.validate(db, {
          source: generation.sourceManifest,
          contexts: stored.contexts,
          requirement: stored.requirement,
        })
        if (!fresh.report.passed)
          throw new CuratedPoolCoverageError(fresh.report)
        // Check the actual stored IDs too: an alternate becoming eligible must not
        // hide a now-unplayable ID in an immutable pool.
        const pools = await db.recommendationCuratedPool.findMany({
          where: { generationId: generation.id, poolKey: "start" },
        })
        for (const pool of pools) {
          const hydrated = await hydrateCuratedVideos(db, pool.videoIds, pool)
          const duplicateReason = createVideoIdentityDuplicateReasonResolver()
          const eligible: typeof hydrated = []
          for (const id of pool.videoIds) {
            const item = hydrated.find((video) => video.videoId === id)
            if (
              item &&
              item.rejectionReasons.length === 0 &&
              !eligible.some((prior) => duplicateReason(item, prior))
            )
              eligible.push(item)
          }
          if (eligible.length < requiredCuratedDepth(stored.requirement))
            throw new CuratedPoolPromotionError(
              "Stored starter inventory no longer satisfies coverage",
            )
        }
        if (pools.length !== stored.contexts.length)
          throw new CuratedPoolPromotionError(
            "Stored context coverage is incomplete",
          )
        if (pointer?.generationId === generation.id)
          return { version: generation.version, revision: pointer.revision }
        const next = await db.recommendationCuratedPointer.upsert({
          where: { id: CURATED_POOL_POINTER_ID },
          create: { id: CURATED_POOL_POINTER_ID, generationId: generation.id },
          update: {
            generationId: generation.id,
            previousGenerationId: pointer?.generationId ?? null,
            revision: { increment: 1 },
          },
        })
        return { version: generation.version, revision: next.revision }
      },
      { timeout: 600_000, maxWait: 10_000 },
    )
  }

  promote(input: { version: string; expectedCurrentVersion: string | null }) {
    if (!input.version || input.version.length > 128)
      throw new CuratedPoolInputError("Invalid curated version")
    return this.movePointer({ ...input, rollback: false })
  }

  rollback(input: { expectedCurrentVersion: string }) {
    return this.movePointer({ ...input, rollback: true })
  }

  async getCandidates(input: {
    locale: string
    audioLanguageSlug: string
    interestVideoIds?: readonly string[]
    limit: number
    deadlineAt?: number
  }): Promise<{
    version: string | null
    poolKeys: string[]
    items: CuratedRecommendationCandidate[]
  }> {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > CURATED_POOL_MAX_RUNTIME_CANDIDATES ||
      (input.interestVideoIds?.length ?? 0) > 64 ||
      input.interestVideoIds?.some((id) => !id || id.length > 191)
    ) {
      throw new CuratedPoolInputError("Invalid curated retrieval bound")
    }
    validateCuratedContexts([
      { ...input, coreLanguageId: "resolved-at-import" },
    ])
    const timeout = Math.min(
      1500,
      input.deadlineAt == null
        ? 1500
        : Math.floor(input.deadlineAt - Date.now()),
    )
    if (timeout <= 0)
      throw new CuratedPoolInputError("Curated retrieval deadline expired")
    return this.dependencies.prisma.$transaction(
      async (db) => {
        await db.$executeRaw`SELECT set_config('statement_timeout', ${String(timeout)}, true)`
        const pointer = await db.recommendationCuratedPointer.findUnique({
          where: { id: CURATED_POOL_POINTER_ID },
          select: {
            generationId: true,
            generation: { select: { version: true } },
          },
        })
        if (!pointer) return { version: null, poolKeys: [], items: [] }
        const pools = await db.recommendationCuratedPool.findMany({
          where: {
            generationId: pointer.generationId,
            locale: input.locale,
            audioLanguageSlug: input.audioLanguageSlug,
          },
          take: 9,
          orderBy: { poolKey: "asc" },
        })
        const starter = pools.find((pool) => pool.poolKey === "start")
        if (!starter)
          return {
            version: pointer.generation.version,
            poolKeys: [],
            items: [],
          }
        const interestMemberships = input.interestVideoIds?.length
          ? await db.recommendationCuratedMembership.findMany({
              where: {
                generationId: pointer.generationId,
                videoId: { in: [...input.interestVideoIds] },
              },
              select: { themeKeys: true },
              take: 64,
            })
          : []
        const support = new Map<string, number>()
        for (const membership of interestMemberships)
          for (const key of membership.themeKeys)
            support.set(key, (support.get(key) ?? 0) + 1)
        const ordered = [
          ...pools
            .filter(
              (pool) => pool.poolKey !== "start" && support.has(pool.poolKey),
            )
            .sort(
              (a, b) =>
                support.get(b.poolKey)! - support.get(a.poolKey)! ||
                a.poolKey.localeCompare(b.poolKey),
            ),
          starter,
        ]
        const attribution = new Map<string, string>()
        // Always include a starter reserve, even when a large interest pool fills
        // the bound. Interleave theme pools; append the remaining starter order.
        const interestLimit = Math.floor(
          CURATED_POOL_MAX_RUNTIME_CANDIDATES / 2,
        )
        const themes = ordered.filter((pool) => pool.poolKey !== "start")
        for (
          let position = 0;
          position < interestLimit && attribution.size < interestLimit;
          position++
        ) {
          for (const pool of themes) {
            const id = pool.videoIds[position]
            if (id && !attribution.has(id) && attribution.size < interestLimit)
              attribution.set(id, pool.poolKey)
          }
        }
        for (const id of starter.videoIds) {
          if (attribution.size >= CURATED_POOL_MAX_RUNTIME_CANDIDATES) break
          if (!attribution.has(id)) attribution.set(id, "start")
        }
        const ids = [...attribution.keys()]
        const hydrated = await hydrateCuratedVideos(db, ids, starter)
        const ranks = await db.recommendationCuratedMembership.findMany({
          where: { generationId: pointer.generationId, videoId: { in: ids } },
          select: { videoId: true, editorialRank: true },
          take: CURATED_POOL_MAX_RUNTIME_CANDIDATES,
        })
        const byId = new Map(hydrated.map((video) => [video.videoId, video]))
        const rankById = new Map(
          ranks.map((membership) => [
            membership.videoId,
            membership.editorialRank,
          ]),
        )
        const duplicateReason = createVideoIdentityDuplicateReasonResolver()
        const items: CuratedRecommendationCandidate[] = []
        for (const [id, poolKey] of attribution) {
          if (items.length >= input.limit) break
          const video = byId.get(id)
          const editorialRank = rankById.get(id)
          if (
            !video ||
            !editorialRank ||
            video.rejectionReasons.length ||
            items.some((prior) => duplicateReason(video, prior))
          )
            continue
          items.push({
            videoId: video.videoId,
            videoCoreId: video.videoCoreId,
            videoSlug: video.videoSlug,
            videoTitle: video.videoTitle,
            imageUrl: video.imageUrl,
            description: video.description,
            playbackId: video.playbackId,
            durationSeconds: video.durationSeconds,
            embeddingText: video.embeddingText,
            sceneIndex: null,
            similarity: null,
            startSeconds: 0,
            endSeconds: null,
            themes: [],
            demographics: [],
            spiritualContext: [],
            locale: input.locale,
            audioLanguageSlug: input.audioLanguageSlug,
            watchPlayable: true,
            localePublished: true,
            generator: "curated",
            poolKey,
            poolVersion: pointer.generation.version,
            editorialRank,
          })
        }
        return {
          version: pointer.generation.version,
          poolKeys: [...new Set(items.map((item) => item.poolKey))],
          items,
        }
      },
      { timeout, maxWait: timeout },
    )
  }
}
