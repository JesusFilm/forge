import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import {
  EmbeddingGenerationModeSchema,
  EmbeddingTimestampSchema,
  statusForEmbeddingRewrite,
} from "@/services/embedding-ingest-shared"
import {
  EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
  writeSceneEmbeddingPayloadInTransaction,
  type SceneEmbeddingGenerationMode,
  type SceneEmbeddingPayloadScene,
} from "@/services/scene-embedding.service"

const AdminTargetSchema = z
  .object({
    videoId: z.string().min(1),
    videoEditionId: z.string().min(1),
    coreId: z.string().min(1).optional(),
  })
  .strict()

const StringArraySchema = z.array(z.string()).default([])

const IngestSceneSchema = z
  .object({
    sceneIndex: z.number().int().nonnegative(),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative().optional(),
    chapterTitle: z.string().min(1).optional(),
    sourceText: z.string().min(1),
    description: z.string().min(1),
    themes: StringArraySchema.optional(),
    bibleVerses: StringArraySchema.optional(),
    demographics: StringArraySchema.optional(),
    spiritualContext: StringArraySchema.optional(),
    embedding: z.array(z.number().finite()).min(1),
  })
  .strict()

export const SceneEmbeddingIngestPayloadSchema = z
  .object({
    target: z
      .object({
        admin: AdminTargetSchema,
      })
      .strict(),
    locale: z.string().min(1),
    source: z
      .object({
        artifactKey: z.string().min(1),
        artifactVersion: z.string().min(1),
        provider: z.string().min(1),
        generatedAt: EmbeddingTimestampSchema.optional(),
        contentHash: z.string().min(1),
      })
      .strict(),
    model: z
      .object({
        name: z.string().min(1),
        dimensions: z.number().int().positive(),
        nativeDimensions: z.number().int().positive().optional(),
        provider: z.string().min(1).optional(),
        transformVersion: z.string().min(1).optional(),
      })
      .strict(),
    generation: z
      .object({
        mode: EmbeddingGenerationModeSchema,
        generatedAt: EmbeddingTimestampSchema,
        mastraRunId: z.string().min(1),
      })
      .strict(),
    scenes: z.array(IngestSceneSchema).min(1),
  })
  .strict()

export type SceneEmbeddingIngestPayload = z.infer<
  typeof SceneEmbeddingIngestPayloadSchema
>

type ResolvedTarget = {
  videoId: string
  videoEditionId: string
  coreId: string
  primaryLanguageBcp47: string | null
}

type ExistingSceneSummary = {
  rowCount: number
  healthyCount: number
  sourceContentHashCount: number
  sourceContentHashes: readonly string[]
  models: readonly string[]
  dimensions: readonly number[]
  embeddingProviderCount: number
  embeddingProviders: readonly string[]
  embeddingNativeDimensionCount: number
  embeddingNativeDimensions: readonly number[]
  embeddingTransformVersionCount: number
  embeddingTransformVersions: readonly string[]
}

export type SceneEmbeddingIngestStatus =
  | "created"
  | "unchanged"
  | "repaired"
  | "forced"
  | "model_upgraded"
  | "rejected"

export type SceneEmbeddingIngestResult = {
  status: SceneEmbeddingIngestStatus
  reason?: string
  target: {
    videoId: string
    videoEditionId: string
    coreId: string
    locale: string
  }
  scenes: number
  model: string
  dimensions: number
  mastraRunId: string
}

export class SceneEmbeddingIngestError extends Error {
  constructor(
    readonly code:
      | "payload_invalid"
      | "target_not_found"
      | "dimension_mismatch"
      | "scene_invalid"
      | "source_hash_mismatch"
      | "source_locale_mismatch"
      | "write_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SceneEmbeddingIngestError"
  }
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`
}

function sourceContentHash(payload: SceneEmbeddingIngestPayload): string {
  const computed = sha256Json({
    locale: payload.locale,
    scenes: payload.scenes.map((scene) => ({
      sceneIndex: scene.sceneIndex,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds ?? null,
      sourceText: scene.sourceText,
      description: scene.description,
      themes: scene.themes ?? [],
      bibleVerses: scene.bibleVerses ?? [],
      demographics: scene.demographics ?? [],
      spiritualContext: scene.spiritualContext ?? [],
    })),
  })

  if (payload.source.contentHash && payload.source.contentHash !== computed) {
    throw new SceneEmbeddingIngestError(
      "source_hash_mismatch",
      "source content hash does not match payload content",
    )
  }

  return computed
}

function validateScenes(
  payload: SceneEmbeddingIngestPayload,
): readonly SceneEmbeddingPayloadScene[] {
  if (payload.model.dimensions !== EXPECTED_SCENE_EMBEDDING_DIMENSIONS) {
    throw new SceneEmbeddingIngestError(
      "dimension_mismatch",
      `payload dimensions=${payload.model.dimensions}; expected ${EXPECTED_SCENE_EMBEDDING_DIMENSIONS}`,
    )
  }

  const seen = new Set<number>()
  for (const scene of payload.scenes) {
    if (seen.has(scene.sceneIndex)) {
      throw new SceneEmbeddingIngestError(
        "scene_invalid",
        "duplicate sceneIndex in scene embedding payload",
      )
    }
    seen.add(scene.sceneIndex)
    if (scene.endSeconds != null && scene.endSeconds < scene.startSeconds) {
      throw new SceneEmbeddingIngestError(
        "scene_invalid",
        "scene endSeconds must be greater than or equal to startSeconds",
      )
    }
    if (scene.embedding.length !== payload.model.dimensions) {
      throw new SceneEmbeddingIngestError(
        "dimension_mismatch",
        "scene embedding length does not match payload dimensions",
      )
    }
    if (!scene.sourceText.trim() || !scene.description.trim()) {
      throw new SceneEmbeddingIngestError(
        "scene_invalid",
        "scene source text and description must not be empty",
      )
    }
  }

  const sorted = [...payload.scenes].sort((a, b) => a.sceneIndex - b.sceneIndex)
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index]!.sceneIndex !== index) {
      throw new SceneEmbeddingIngestError(
        "scene_invalid",
        "scene indexes must be contiguous from 0",
      )
    }
  }
  return sorted
}

async function resolveTarget(
  prisma: PrismaClient,
  payload: SceneEmbeddingIngestPayload,
): Promise<ResolvedTarget> {
  const row = await prisma.video.findFirst({
    where: { id: payload.target.admin.videoId, deletedAt: null },
    select: {
      id: true,
      coreId: true,
      primaryLanguage: { select: { bcp47: true } },
    },
  })
  if (!row) {
    throw new SceneEmbeddingIngestError(
      "target_not_found",
      "admin target video was not found",
    )
  }
  if (
    payload.target.admin.coreId !== undefined &&
    payload.target.admin.coreId !== row.coreId
  ) {
    throw new SceneEmbeddingIngestError(
      "target_not_found",
      "admin target coreId does not match resolved video",
    )
  }

  const edition = await prisma.videoEdition.findFirst({
    where: {
      id: payload.target.admin.videoEditionId,
      dubs: { some: { videoId: row.id, deletedAt: null } },
      deletedAt: null,
    },
    select: { id: true },
  })
  if (!edition) {
    throw new SceneEmbeddingIngestError(
      "target_not_found",
      "admin target video edition was not found",
    )
  }

  return {
    videoId: row.id,
    videoEditionId: edition.id,
    coreId: payload.target.admin.coreId ?? row.coreId,
    primaryLanguageBcp47: row.primaryLanguage?.bcp47 ?? null,
  }
}

function assertSourceArtifactMatchesLocale(
  payload: SceneEmbeddingIngestPayload,
  target: ResolvedTarget,
): void {
  const locale = normalizeLocale(payload.locale)
  const primary = normalizeLocale(target.primaryLanguageBcp47)
  const key = payload.source.artifactKey.toLowerCase()

  if (key.endsWith(`/scene-analysis-${locale}.json`)) return
  if (key.endsWith("/scene-analysis.json") && primary === locale) return

  throw new SceneEmbeddingIngestError(
    "source_locale_mismatch",
    "scene embedding source artifact does not match target locale",
  )
}

function normalizeLocale(locale: string | null | undefined): string {
  return locale?.trim().toLowerCase() ?? ""
}

async function readExistingSceneSummary(
  prisma: PrismaClient | Prisma.TransactionClient,
  target: ResolvedTarget,
  locale: string,
): Promise<ExistingSceneSummary | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      row_count: number | bigint
      healthy_count: number | bigint
      source_hash_count: number | bigint
      source_hashes: string[] | null
      models: string[] | null
      dimensions: number[] | null
      embedding_provider_count: number | bigint
      embedding_providers: string[] | null
      embedding_native_dimension_count: number | bigint
      embedding_native_dimensions: number[] | null
      embedding_transform_version_count: number | bigint
      embedding_transform_versions: string[] | null
    }>
  >`
    SELECT
      COUNT(*) AS row_count,
      COUNT(*) FILTER (WHERE vsl.embedding IS NOT NULL) AS healthy_count,
      COUNT(vsl.source_content_hash) AS source_hash_count,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT vsl.source_content_hash), NULL) AS source_hashes,
      ARRAY_AGG(DISTINCT vsl.model) AS models,
      ARRAY_AGG(DISTINCT vsl.dimensions) AS dimensions,
      COUNT(vsl.embedding_provider) AS embedding_provider_count,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT vsl.embedding_provider), NULL) AS embedding_providers,
      COUNT(vsl.embedding_native_dimensions) AS embedding_native_dimension_count,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT vsl.embedding_native_dimensions), NULL) AS embedding_native_dimensions,
      COUNT(vsl.embedding_transform_version) AS embedding_transform_version_count,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT vsl.embedding_transform_version), NULL) AS embedding_transform_versions
    FROM video_scene_locale vsl
    JOIN video_scene vs ON vs.id = vsl.video_scene_id
    WHERE vs.video_edition_id = ${target.videoEditionId}
      AND vsl.locale = ${locale}
  `
  const row = rows[0]
  if (!row || Number(row.row_count) === 0) return null
  return {
    rowCount: Number(row.row_count),
    healthyCount: Number(row.healthy_count),
    sourceContentHashCount: Number(row.source_hash_count),
    sourceContentHashes: row.source_hashes ?? [],
    models: row.models ?? [],
    dimensions: row.dimensions ?? [],
    embeddingProviderCount: Number(row.embedding_provider_count),
    embeddingProviders: row.embedding_providers ?? [],
    embeddingNativeDimensionCount: Number(row.embedding_native_dimension_count),
    embeddingNativeDimensions: row.embedding_native_dimensions ?? [],
    embeddingTransformVersionCount: Number(
      row.embedding_transform_version_count,
    ),
    embeddingTransformVersions: row.embedding_transform_versions ?? [],
  }
}

function legacyOpenAiProviderMatches(
  existing: ExistingSceneSummary,
  payload: SceneEmbeddingIngestPayload,
): boolean {
  return (
    existing.embeddingProviderCount === 0 &&
    existing.embeddingNativeDimensionCount === existing.rowCount &&
    existing.embeddingNativeDimensions.length === 1 &&
    existing.embeddingNativeDimensions[0] === payload.model.dimensions &&
    existing.embeddingTransformVersionCount === 0 &&
    payload.model.provider === "openai" &&
    payload.model.nativeDimensions == null &&
    payload.model.transformVersion == null &&
    (existing.models[0] === "openai/text-embedding-3-small" ||
      existing.models[0] === "text-embedding-3-small")
  )
}

function providerProvenanceMatches(
  existing: ExistingSceneSummary,
  payload: SceneEmbeddingIngestPayload,
): boolean {
  if (legacyOpenAiProviderMatches(existing, payload)) return true
  return (
    existing.embeddingProviderCount ===
      (payload.model.provider ? existing.rowCount : 0) &&
    existing.embeddingProviders.length === (payload.model.provider ? 1 : 0) &&
    (payload.model.provider == null ||
      existing.embeddingProviders[0] === payload.model.provider) &&
    existing.embeddingNativeDimensionCount ===
      (payload.model.nativeDimensions ? existing.rowCount : 0) &&
    existing.embeddingNativeDimensions.length ===
      (payload.model.nativeDimensions ? 1 : 0) &&
    (payload.model.nativeDimensions == null ||
      existing.embeddingNativeDimensions[0] ===
        payload.model.nativeDimensions) &&
    existing.embeddingTransformVersionCount ===
      (payload.model.transformVersion ? existing.rowCount : 0) &&
    existing.embeddingTransformVersions.length ===
      (payload.model.transformVersion ? 1 : 0) &&
    (payload.model.transformVersion == null ||
      existing.embeddingTransformVersions[0] === payload.model.transformVersion)
  )
}

function existingMatches(
  existing: ExistingSceneSummary,
  payload: SceneEmbeddingIngestPayload,
  hash: string,
): boolean {
  return (
    existing.rowCount === payload.scenes.length &&
    existing.sourceContentHashCount === existing.rowCount &&
    existing.sourceContentHashes.length === 1 &&
    existing.sourceContentHashes[0] === hash &&
    existing.models.length === 1 &&
    existing.models[0] === payload.model.name &&
    existing.dimensions.length === 1 &&
    existing.dimensions[0] === payload.model.dimensions &&
    providerProvenanceMatches(existing, payload)
  )
}

function resultForRejected(
  payload: SceneEmbeddingIngestPayload,
  target: ResolvedTarget,
  reason: string,
): SceneEmbeddingIngestResult {
  return {
    status: "rejected",
    reason,
    target: publicTarget(target, payload.locale),
    scenes: payload.scenes.length,
    model: payload.model.name,
    dimensions: payload.model.dimensions,
    mastraRunId: payload.generation.mastraRunId,
  }
}

function publicTarget(target: ResolvedTarget, locale: string) {
  return {
    videoId: target.videoId,
    videoEditionId: target.videoEditionId,
    coreId: target.coreId,
    locale,
  }
}

async function writePayload(
  tx: Prisma.TransactionClient,
  payload: SceneEmbeddingIngestPayload,
  target: ResolvedTarget,
  scenes: readonly SceneEmbeddingPayloadScene[],
  hash: string,
): Promise<void> {
  try {
    await writeSceneEmbeddingPayloadInTransaction(tx, {
      editionId: target.videoEditionId,
      videoId: target.videoId,
      coreId: target.coreId,
      locale: payload.locale,
      user: SYSTEM_PRINCIPAL,
      model: payload.model.name,
      dimensions: payload.model.dimensions,
      scenes,
      provenance: {
        embeddingProvider: payload.model.provider,
        embeddingNativeDimensions: payload.model.nativeDimensions,
        embeddingTransformVersion: payload.model.transformVersion,
        sourceArtifactKey: payload.source.artifactKey,
        sourceArtifactVersion: payload.source.artifactVersion,
        sourceContentHash: hash,
        sourceProvider: payload.source.provider,
        sourceGeneratedAt: payload.source.generatedAt,
        generationMode: payload.generation.mode,
        mastraRunId: payload.generation.mastraRunId,
        generatedAt: payload.generation.generatedAt,
      },
    })
  } catch (error) {
    throw new SceneEmbeddingIngestError(
      "write_failed",
      "failed to write scene embedding payload",
      error,
    )
  }
}

async function lockSceneTarget(
  tx: Prisma.TransactionClient,
  target: ResolvedTarget,
  locale: string,
): Promise<void> {
  await tx.$queryRaw`
    WITH lock AS (
      SELECT pg_advisory_xact_lock(
        hashtext(${`scene:${target.videoEditionId}`}),
        hashtext(${locale})
      )
    )
    SELECT 1::int AS locked
  `
}

export async function ingestSceneEmbeddings(
  prisma: PrismaClient,
  rawPayload: unknown,
): Promise<SceneEmbeddingIngestResult> {
  const parsed = SceneEmbeddingIngestPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    console.warn(
      `[mastra-scene-ingest] event=payload_invalid issues=${parsed.error.issues.length}`,
    )
    throw new SceneEmbeddingIngestError(
      "payload_invalid",
      "scene embedding ingest payload failed validation",
      parsed.error,
    )
  }

  const payload = parsed.data
  const scenes = validateScenes(payload)
  const hash = sourceContentHash(payload)
  const target = await resolveTarget(prisma, payload)
  assertSourceArtifactMatchesLocale(payload, target)
  const mode = payload.generation.mode as SceneEmbeddingGenerationMode

  return prisma.$transaction(
    async (tx) => {
      await lockSceneTarget(tx, target, payload.locale)
      const existing = await readExistingSceneSummary(
        tx,
        target,
        payload.locale,
      )

      if (existing) {
        const matches = existingMatches(existing, payload, hash)

        if (
          mode === "idempotent" &&
          matches &&
          existing.healthyCount === payload.scenes.length
        ) {
          return {
            status: "unchanged",
            target: publicTarget(target, payload.locale),
            scenes: payload.scenes.length,
            model: payload.model.name,
            dimensions: payload.model.dimensions,
            mastraRunId: payload.generation.mastraRunId,
          }
        }

        if (mode === "idempotent") {
          return resultForRejected(payload, target, "existing_scene_differs")
        }

        if (mode === "repair" && !matches) {
          return resultForRejected(
            payload,
            target,
            "repair_requires_matching_provenance",
          )
        }
        if (
          mode === "repair" &&
          existing.healthyCount === payload.scenes.length
        ) {
          return {
            status: "unchanged",
            target: publicTarget(target, payload.locale),
            scenes: payload.scenes.length,
            model: payload.model.name,
            dimensions: payload.model.dimensions,
            mastraRunId: payload.generation.mastraRunId,
          }
        }
      }

      let status: SceneEmbeddingIngestStatus = "created"
      if (existing) {
        if (mode === "idempotent") {
          return resultForRejected(payload, target, "existing_scene_differs")
        }
        status = statusForEmbeddingRewrite(mode)
      }

      await writePayload(tx, payload, target, scenes, hash)

      return {
        status,
        target: publicTarget(target, payload.locale),
        scenes: payload.scenes.length,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        mastraRunId: payload.generation.mastraRunId,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export const _internals = {
  sha256Json,
  validateScenes,
  existingMatches,
}
