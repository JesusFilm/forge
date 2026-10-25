import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import {
  EmbeddingGenerationModeSchema,
  EmbeddingTimestampSchema,
  statusForEmbeddingRewrite,
} from "@/services/embedding-ingest-shared"
import {
  buildExperienceEmbeddingSource,
  writeExperienceEmbeddingPayloadInTransaction,
  type ExperienceEmbeddingGenerationMode,
} from "@/services/embeddings.service"
import {
  contentEmbeddingTupleMatches,
  resolveActiveContentEmbeddingContract,
  type ContentEmbeddingContract,
  type ContentEmbeddingTuple,
} from "@/services/content-embedding-contract"

const TargetSchema = z
  .object({
    experienceId: z.string().min(1),
    experienceLocaleId: z.string().min(1),
    locale: z.string().min(1),
    slug: z.string().min(1).optional(),
  })
  .strict()

export const ExperienceEmbeddingIngestPayloadSchema = z
  .object({
    target: TargetSchema,
    source: z
      .object({
        contentHash: z.string().min(1),
        summary: z.string().min(1),
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
    embedding: z.array(z.number().finite()).min(1),
  })
  .strict()

export type ExperienceEmbeddingIngestPayload = z.infer<
  typeof ExperienceEmbeddingIngestPayloadSchema
>

type ResolvedTarget = {
  experienceId: string
  experienceLocaleId: string
  locale: string
}

type ExistingExperienceEmbeddingSummary = {
  healthy: boolean
  sourceContentHash: string | null
  sourceSummary: string | null
  model: string | null
  dimensions: number | null
  provider: string | null
  nativeDimensions: number | null
  transformVersion: string | null
}

export type ExperienceEmbeddingIngestStatus =
  | "created"
  | "unchanged"
  | "repaired"
  | "forced"
  | "model_upgraded"
  | "rejected"

export type ExperienceEmbeddingIngestResult = {
  status: ExperienceEmbeddingIngestStatus
  reason?: string
  target: ResolvedTarget
  model: string
  dimensions: number
  mastraRunId: string
}

export class ExperienceEmbeddingIngestError extends Error {
  constructor(
    readonly code:
      | "payload_invalid"
      | "target_not_found"
      | "target_unpublished"
      | "contract_mismatch"
      | "dimension_mismatch"
      | "source_hash_mismatch"
      | "write_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ExperienceEmbeddingIngestError"
  }
}

function validateEmbedding(
  payload: ExperienceEmbeddingIngestPayload,
  contract: ContentEmbeddingContract,
): void {
  if (payload.model.dimensions !== contract.storage.dimensions) {
    throw new ExperienceEmbeddingIngestError(
      "dimension_mismatch",
      `payload dimensions=${payload.model.dimensions}; expected ${contract.storage.dimensions}`,
    )
  }
  if (payload.embedding.length !== payload.model.dimensions) {
    throw new ExperienceEmbeddingIngestError(
      "dimension_mismatch",
      "embedding length does not match payload dimensions",
    )
  }
}

function payloadEmbeddingTuple(
  payload: ExperienceEmbeddingIngestPayload,
): ContentEmbeddingTuple | null {
  if (
    payload.model.provider == null ||
    payload.model.nativeDimensions == null
  ) {
    return null
  }

  return {
    provider: payload.model.provider,
    model: payload.model.name,
    nativeDimensions: payload.model.nativeDimensions,
    dimensions: payload.model.dimensions,
    transformVersion: payload.model.transformVersion ?? null,
  }
}

function assertPayloadMatchesActiveContract(
  payload: ExperienceEmbeddingIngestPayload,
  contract: ContentEmbeddingContract,
): void {
  const payloadTuple = payloadEmbeddingTuple(payload)
  if (
    payloadTuple == null ||
    !contentEmbeddingTupleMatches(contract.storage, payloadTuple)
  ) {
    throw new ExperienceEmbeddingIngestError(
      "contract_mismatch",
      `experience embedding payload does not match active content embedding contract ${contract.id}`,
    )
  }
}

async function resolveTargetAndValidateSource(
  prisma: PrismaClient | Prisma.TransactionClient,
  payload: ExperienceEmbeddingIngestPayload,
): Promise<ResolvedTarget> {
  const row = await prisma.experienceLocale.findUnique({
    where: { id: payload.target.experienceLocaleId },
    select: {
      id: true,
      experienceId: true,
      locale: true,
      slug: true,
      status: true,
      title: true,
      metaDescription: true,
      ogTitle: true,
      ogDescription: true,
      blocks: true,
      experience: {
        select: {
          archivedAt: true,
        },
      },
    },
  })

  if (!row || row.experience.archivedAt != null) {
    throw new ExperienceEmbeddingIngestError(
      "target_not_found",
      "experience locale target was not found",
    )
  }
  if (
    row.experienceId !== payload.target.experienceId ||
    row.locale !== payload.target.locale ||
    (payload.target.slug != null && row.slug !== payload.target.slug)
  ) {
    throw new ExperienceEmbeddingIngestError(
      "target_not_found",
      "experience locale target identity does not match current Admin row",
    )
  }
  if (row.status !== "PUBLISHED") {
    throw new ExperienceEmbeddingIngestError(
      "target_unpublished",
      "experience locale must be published before ingesting embeddings",
    )
  }

  const source = buildExperienceEmbeddingSource(row)
  if (
    source.contentHash !== payload.source.contentHash ||
    source.summary !== payload.source.summary
  ) {
    throw new ExperienceEmbeddingIngestError(
      "source_hash_mismatch",
      "source content hash does not match current ExperienceLocale content",
    )
  }

  return {
    experienceId: row.experienceId,
    experienceLocaleId: row.id,
    locale: row.locale,
  }
}

async function readExistingSummary(
  prisma: PrismaClient | Prisma.TransactionClient,
  localeId: string,
): Promise<ExistingExperienceEmbeddingSummary | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      healthy: boolean
      source_content_hash: string | null
      source_summary: string | null
      model: string | null
      dimensions: number | null
      provider: string | null
      native_dimensions: number | null
      transform_version: string | null
    }>
  >`
    SELECT
      embedding IS NOT NULL AS healthy,
      embedding_source_content_hash AS source_content_hash,
      embedding_source_summary AS source_summary,
      embedding_model AS model,
      embedding_dimensions AS dimensions,
      embedding_provider AS provider,
      embedding_native_dimensions AS native_dimensions,
      embedding_transform_version AS transform_version
    FROM experience_locale
    WHERE id = ${localeId}
  `
  const row = rows[0]
  if (!row) return null
  return {
    healthy: row.healthy,
    sourceContentHash: row.source_content_hash,
    sourceSummary: row.source_summary,
    model: row.model,
    dimensions: row.dimensions,
    provider: row.provider,
    nativeDimensions: row.native_dimensions,
    transformVersion: row.transform_version,
  }
}

function existingMatches(
  existing: ExistingExperienceEmbeddingSummary,
  payload: ExperienceEmbeddingIngestPayload,
): boolean {
  return (
    existing.sourceContentHash === payload.source.contentHash &&
    existing.sourceSummary === payload.source.summary &&
    existing.model === payload.model.name &&
    existing.dimensions === payload.model.dimensions &&
    existing.provider === (payload.model.provider ?? null) &&
    existing.nativeDimensions ===
      (payload.model.nativeDimensions ?? existing.dimensions) &&
    existing.transformVersion === (payload.model.transformVersion ?? null)
  )
}

function resultForRejected(
  payload: ExperienceEmbeddingIngestPayload,
  target: ResolvedTarget,
  reason: string,
): ExperienceEmbeddingIngestResult {
  return {
    status: "rejected",
    reason,
    target,
    model: payload.model.name,
    dimensions: payload.model.dimensions,
    mastraRunId: payload.generation.mastraRunId,
  }
}

function isFirstExperienceEmbeddingWrite(
  existing: ExistingExperienceEmbeddingSummary | null,
): boolean {
  return (
    existing == null ||
    (!existing.healthy &&
      existing.sourceContentHash == null &&
      existing.sourceSummary == null &&
      existing.model == null &&
      existing.dimensions == null &&
      existing.provider == null &&
      existing.nativeDimensions == null &&
      existing.transformVersion == null)
  )
}

async function lockExperienceLocale(
  tx: Prisma.TransactionClient,
  localeId: string,
): Promise<void> {
  await tx.$queryRaw`
    WITH lock AS (
      SELECT pg_advisory_xact_lock(hashtext(${`experience-locale:${localeId}`}))
    )
    SELECT 1::int AS locked
  `
}

async function writePayload(
  tx: Prisma.TransactionClient,
  payload: ExperienceEmbeddingIngestPayload,
  target: ResolvedTarget,
): Promise<void> {
  try {
    await writeExperienceEmbeddingPayloadInTransaction(tx, {
      localeId: target.experienceLocaleId,
      embedding: payload.embedding,
      user: SYSTEM_PRINCIPAL,
      provenance: {
        sourceContentHash: payload.source.contentHash,
        sourceSummary: payload.source.summary,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        provider: payload.model.provider,
        nativeDimensions: payload.model.nativeDimensions,
        transformVersion: payload.model.transformVersion,
        generationMode: payload.generation.mode,
        mastraRunId: payload.generation.mastraRunId,
        generatedAt: payload.generation.generatedAt,
      },
    })
  } catch (error) {
    throw new ExperienceEmbeddingIngestError(
      "write_failed",
      "failed to write experience embedding payload",
      error,
    )
  }
}

export async function ingestExperienceEmbedding(
  prisma: PrismaClient,
  rawPayload: unknown,
): Promise<ExperienceEmbeddingIngestResult> {
  const parsed = ExperienceEmbeddingIngestPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    console.warn(
      `[mastra-experience-ingest] event=payload_invalid issues=${parsed.error.issues.length}`,
    )
    throw new ExperienceEmbeddingIngestError(
      "payload_invalid",
      "experience embedding ingest payload failed validation",
      parsed.error,
    )
  }

  const payload = parsed.data
  const mode = payload.generation.mode as ExperienceEmbeddingGenerationMode

  return prisma.$transaction(
    async (tx) => {
      const contract = await resolveActiveContentEmbeddingContract(tx)
      assertPayloadMatchesActiveContract(payload, contract)
      validateEmbedding(payload, contract)
      await lockExperienceLocale(tx, payload.target.experienceLocaleId)
      const target = await resolveTargetAndValidateSource(tx, payload)
      const existing = await readExistingSummary(tx, target.experienceLocaleId)

      if (existing && !isFirstExperienceEmbeddingWrite(existing)) {
        const matches = existingMatches(existing, payload)

        if (mode === "idempotent" && matches) {
          if (!existing.healthy) {
            return resultForRejected(
              payload,
              target,
              "existing_experience_embedding_incomplete",
            )
          }
          return {
            status: "unchanged",
            target,
            model: payload.model.name,
            dimensions: payload.model.dimensions,
            mastraRunId: payload.generation.mastraRunId,
          }
        }

        if (mode === "idempotent") {
          return resultForRejected(
            payload,
            target,
            "existing_experience_embedding_differs",
          )
        }

        if (mode === "repair" && !matches) {
          return resultForRejected(
            payload,
            target,
            "repair_requires_matching_provenance",
          )
        }
        if (mode === "repair" && existing.healthy) {
          return {
            status: "unchanged",
            target,
            model: payload.model.name,
            dimensions: payload.model.dimensions,
            mastraRunId: payload.generation.mastraRunId,
          }
        }
      }

      let status: ExperienceEmbeddingIngestStatus = "created"
      if (!isFirstExperienceEmbeddingWrite(existing)) {
        if (mode === "idempotent") {
          return resultForRejected(
            payload,
            target,
            "existing_experience_embedding_differs",
          )
        }
        status = statusForEmbeddingRewrite(mode)
      }

      await writePayload(tx, payload, target)

      return {
        status,
        target,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        mastraRunId: payload.generation.mastraRunId,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export const _internals = {
  validateEmbedding,
  existingMatches,
}
