import { z } from "zod"
import type { SceneRecommendation } from "@/services/scene-recommendations.service"
import { createVideoIdentityDuplicateReasonResolver } from "@/services/video-dedup"

export const CURATED_POOL_VALIDATION_VERSION = "curated-admin-eligibility-v1"
export const CURATED_POOL_POINTER_ID = "watch-user-curated-pools-v1"
export const CURATED_POOL_MAX_SOURCE_BYTES = 8 * 1024 * 1024
export const CURATED_POOL_MAX_CANDIDATES = 512
export const CURATED_POOL_MAX_CONTEXTS = 10_000
export const CURATED_POOL_MAX_RUNTIME_CANDIDATES = 256

const identity = z.string().trim().min(1).max(191)
const poolKey = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const candidateSchema = z
  .object({
    coreVideoId: identity,
    alternateCoreVideoIds: z.array(identity).max(8).default([]),
    duplicateGroup: identity,
    editorialRank: z.number().int().min(1).max(CURATED_POOL_MAX_CANDIDATES),
    startPool: z.boolean(),
    themeKeys: z.array(poolKey).max(8),
    rationale: z.string().max(2000),
    sensitivityReviewRequired: z.boolean().default(false),
  })
  .passthrough()

const sourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string().trim().min(1).max(128),
    themeVocabulary: z.array(z.object({ key: poolKey }).passthrough()).max(8),
    candidates: z
      .array(candidateSchema)
      .min(1)
      .max(CURATED_POOL_MAX_CANDIDATES),
  })
  .passthrough()

export type CuratedPoolSource = z.infer<typeof sourceSchema>
export type CuratedSourceCandidate = CuratedPoolSource["candidates"][number]
export type CuratedPoolContext = Readonly<{
  locale: string
  audioLanguageSlug: string
  coreLanguageId: string
}>
export type CuratedCoverageRequirement = Readonly<{
  requestedCount: number
  excludedReserve: number
}>

export type CuratedRecommendationCandidate = Omit<
  SceneRecommendation,
  "sceneIndex" | "similarity"
> & {
  sceneIndex: null
  similarity: null
  videoCoreId: string
  embeddingText: string | null
  locale: string
  audioLanguageSlug: string
  watchPlayable: true
  localePublished: true
  generator: "curated"
  poolKey: string
  poolVersion: string
  editorialRank: number
}

export type CuratedHydratedVideo = Readonly<{
  videoId: string
  videoCoreId: string
  videoSlug: string
  videoTitle: string
  description: string
  imageUrl: string | null
  playbackId: string
  durationSeconds: number | null
  embeddingText: string | null
  rejectionReasons: string[]
}>

export type CuratedPoolRejection = Readonly<{
  coreVideoId: string
  reason: string
}>

export type CuratedContextCoverage = CuratedPoolContext &
  Readonly<{
    passed: boolean
    languageIdentityValid: boolean
    requiredUnique: number
    startUnique: number
    unionUnique: number
    poolCounts: Record<string, number>
    rejected: CuratedPoolRejection[]
  }>

export type CuratedCoverageReport = Readonly<{
  validationVersion: typeof CURATED_POOL_VALIDATION_VERSION
  version: string
  sourceDigest: string
  checkedAt: string
  passed: boolean
  requirement: CuratedCoverageRequirement
  unknownCoreVideoIds: string[]
  contexts: CuratedContextCoverage[]
}>

export class CuratedPoolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CuratedPoolInputError"
  }
}

export class CuratedPoolCoverageError extends Error {
  constructor(readonly report: CuratedCoverageReport) {
    super(
      "Curated pool validation did not meet the declared coverage requirement",
    )
    this.name = "CuratedPoolCoverageError"
  }
}

export class CuratedPoolPromotionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CuratedPoolPromotionError"
  }
}

export function parseCuratedPoolSource(value: unknown): CuratedPoolSource {
  const serialized = JSON.stringify(value)
  if (
    !serialized ||
    Buffer.byteLength(serialized) > CURATED_POOL_MAX_SOURCE_BYTES
  ) {
    throw new CuratedPoolInputError("Curated source exceeds its byte bound")
  }
  const parsed = sourceSchema.safeParse(value)
  if (!parsed.success)
    throw new CuratedPoolInputError("Invalid curated source shape")
  const source = parsed.data
  const themes = new Set(source.themeVocabulary.map((theme) => theme.key))
  if (themes.has("start") || themes.size !== source.themeVocabulary.length) {
    throw new CuratedPoolInputError(
      "Theme keys must be unique and cannot be start",
    )
  }
  const identities = new Set<string>()
  const groups = new Set<string>()
  const ranks = new Set<number>()
  for (const item of source.candidates) {
    if (groups.has(item.duplicateGroup) || ranks.has(item.editorialRank)) {
      throw new CuratedPoolInputError("Duplicate editorial group or rank")
    }
    groups.add(item.duplicateGroup)
    ranks.add(item.editorialRank)
    if (
      new Set(item.themeKeys).size !== item.themeKeys.length ||
      item.themeKeys.some((key) => !themes.has(key))
    ) {
      throw new CuratedPoolInputError(
        "Candidate references an unknown or repeated theme",
      )
    }
    for (const coreId of [item.coreVideoId, ...item.alternateCoreVideoIds]) {
      if (identities.has(coreId))
        throw new CuratedPoolInputError(
          "Core ID belongs to more than one editorial choice",
        )
      identities.add(coreId)
    }
  }
  return source
}

export function validateCuratedContexts(
  contexts: readonly CuratedPoolContext[],
): void {
  if (contexts.length < 1 || contexts.length > CURATED_POOL_MAX_CONTEXTS) {
    throw new CuratedPoolInputError("Invalid curated context count")
  }
  const seen = new Set<string>()
  for (const context of contexts) {
    if (
      !/^[a-zA-Z0-9-]{2,35}$/.test(context.locale) ||
      !/^[a-z0-9-]{1,191}$/.test(context.audioLanguageSlug) ||
      !context.coreLanguageId ||
      context.coreLanguageId.length > 191
    ) {
      throw new CuratedPoolInputError("Invalid exact locale/audio identity")
    }
    const key = `${context.locale}:${context.audioLanguageSlug}`
    if (seen.has(key))
      throw new CuratedPoolInputError("Duplicate locale/audio context")
    seen.add(key)
  }
}

export function requiredCuratedDepth(
  requirement: CuratedCoverageRequirement,
): number {
  if (
    !Number.isInteger(requirement.requestedCount) ||
    requirement.requestedCount < 1 ||
    requirement.requestedCount > 20 ||
    !Number.isInteger(requirement.excludedReserve) ||
    requirement.excludedReserve < 0 ||
    requirement.requestedCount + requirement.excludedReserve >
      CURATED_POOL_MAX_RUNTIME_CANDIDATES
  ) {
    throw new CuratedPoolInputError(
      "Invalid requested-count or exclusion-reserve bound",
    )
  }
  return requirement.requestedCount + requirement.excludedReserve
}

export function materializeCuratedContext(
  source: CuratedPoolSource,
  hydrated: readonly CuratedHydratedVideo[],
  context: CuratedPoolContext,
  languageIdentityValid: boolean,
  requirement: CuratedCoverageRequirement,
): { coverage: CuratedContextCoverage; pools: Map<string, string[]> } {
  const byCoreId = new Map(hydrated.map((video) => [video.videoCoreId, video]))
  const rejected: CuratedPoolRejection[] = []
  const kept: CuratedHydratedVideo[] = []
  const duplicateReason = createVideoIdentityDuplicateReasonResolver()
  const pools = new Map<string, string[]>([
    ["start", []],
    ...source.themeVocabulary.map((theme): [string, string[]] => [
      theme.key,
      [],
    ]),
  ])
  for (const item of [...source.candidates].sort(
    (a, b) => a.editorialRank - b.editorialRank,
  )) {
    if (item.sensitivityReviewRequired) {
      rejected.push({
        coreVideoId: item.coreVideoId,
        reason: "editorial_review_pending",
      })
      continue
    }
    const alternatives = [item.coreVideoId, ...item.alternateCoreVideoIds].map(
      (id) => byCoreId.get(id),
    )
    const video = languageIdentityValid
      ? alternatives.find(
          (candidate) => candidate && candidate.rejectionReasons.length === 0,
        )
      : undefined
    if (!video) {
      const reasons = languageIdentityValid
        ? alternatives.flatMap(
            (candidate) => candidate?.rejectionReasons ?? ["video_unresolved"],
          )
        : ["language_identity_unavailable"]
      for (const reason of new Set(reasons))
        rejected.push({ coreVideoId: item.coreVideoId, reason })
      continue
    }
    const duplicate = kept.find(
      (prior) =>
        prior.videoId === video.videoId || duplicateReason(video, prior),
    )
    if (duplicate) {
      rejected.push({
        coreVideoId: item.coreVideoId,
        reason: "canonical_duplicate",
      })
      continue
    }
    kept.push(video)
    for (const key of [...(item.startPool ? ["start"] : []), ...item.themeKeys])
      pools.get(key)?.push(video.videoId)
  }
  const requiredUnique = requiredCuratedDepth(requirement)
  const startUnique = pools.get("start")?.length ?? 0
  return {
    pools,
    coverage: {
      ...context,
      passed: languageIdentityValid && startUnique >= requiredUnique,
      languageIdentityValid,
      requiredUnique,
      startUnique,
      unionUnique: new Set([...pools.values()].flat()).size,
      poolCounts: Object.fromEntries(
        [...pools].map(([key, ids]) => [key, ids.length]),
      ),
      rejected,
    },
  }
}
