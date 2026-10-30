/** Private producer wire contract. These references belong to a frozen corpus,
 * including supplemental subtitles; they are deliberately not DB chunk IDs. */
import { createHash } from "node:crypto"
import { z } from "zod"

export const SHARED_IMPORT_VERSION = "shared-reading-v1"
const id = z.string().min(1).max(191)
const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const text = z.string().min(1)
const integer = z.number().int().nonnegative().safe()
export function canonicalImportJson(value: unknown): string {
  function sort(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sort)
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      )
    return item
  }
  return JSON.stringify(sort(value))
}
export const importDigest = (value: unknown): string =>
  createHash("sha256").update(canonicalImportJson(value)).digest("hex")
export const physicalCallSchema = z
  .object({
    origin: hash,
    sourceVideoId: id,
    sourceVideoIds: z.array(id).min(1),
    stage: z.enum([
      "shared_read",
      "global_rank",
      "global_select",
      "evidence_finalize",
    ]),
    status: z.enum(["succeeded", "failed"]),
    modelId: z.literal("gpt-6-astra"),
    requestDigest: hash,
    responseDigest: hash.nullable(),
    receiptDigest: hash,
    inputTokens: integer,
    outputTokens: integer,
    cachedInputTokens: integer,
    reasoningTokens: integer.nullable(),
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }),
    originalRunDirectory: text,
    originalAttemptPath: text,
    originalManifestDigest: hash,
    reservationDigest: hash,
    receiptJson: text,
  })
  .strict()
export type ImportedPhysicalCall = z.infer<typeof physicalCallSchema>

export const frozenEvidenceSchema = z.discriminatedUnion("basis", [
  z
    .object({
      basis: z.literal("transcript"),
      passages: z
        .array(
          z
            .object({
              chunkId: id,
              excerpt: text,
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      basis: z.literal("metadata"),
      fields: z
        .array(
          z
            .object({
              field: z.enum([
                "title",
                "description",
                "keywords",
                "bibleCitations",
              ]),
              value: text,
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
])
const witnessSchema = z
  .object({
    videoId: id,
    coreId: z.string().nullable(),
    slug: z.string(),
    metadata: z
      .object({
        title: text,
        description: z.string().nullable(),
        keywords: z.array(z.string()),
        bibleCitations: z.array(z.string()),
      })
      .strict(),
    chunks: z.array(
      z.object({ id, transcriptId: id, language: text, text }).strict(),
    ),
  })
  .strict()
export type FrozenWitness = z.infer<typeof witnessSchema>
export const sharedSourceSchema = z
  .object({
    sourceVideoId: id,
    recommendations: z
      .array(
        z
          .object({
            sourceVideoId: id,
            targetVideoId: id,
            rank: z.number().int().positive(),
            connection: text,
            watchingValue: text,
            sourceEvidence: frozenEvidenceSchema,
            targetEvidence: frozenEvidenceSchema,
          })
          .strict(),
      )
      .max(8),
    fewerThanFiveReason: z.string().nullable(),
    witnesses: z.array(witnessSchema).min(1),
    provenance: z.record(z.string(), z.unknown()),
  })
  .strict()
export type SharedImportSource = z.infer<typeof sharedSourceSchema>
export const sharedManifestSchema = z
  .object({
    version: z.literal(SHARED_IMPORT_VERSION),
    scope: z.enum(["private_pilot", "full_catalog"]),
    modelId: z.literal("gpt-6-astra"),
    inputCutoff: z.string().datetime({ offset: true }),
    corpusFileSha256: hash,
    corpusDigest: hash,
    referenceDigest: hash,
    eligibleVideoIds: z.array(id).min(1),
    sources: z
      .array(
        z
          .object({
            sourceVideoId: id,
            payloadDigest: hash,
            fewerThanFiveReason: z.string().nullable(),
          })
          .strict(),
      )
      .min(1),
    calls: z
      .array(
        z
          .object({ origin: hash, payloadDigest: hash, rowDigest: hash })
          .strict(),
      )
      .min(1),
    provenance: z.record(z.string(), z.unknown()),
  })
  .strict()
export type SharedImportManifest = z.infer<typeof sharedManifestSchema>
export const sharedImportSubmissionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("shared_reading_start"),
      generationId: id,
      manifest: sharedManifestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("shared_reading_source"),
      generationId: id,
      inputDigest: hash,
      source: sharedSourceSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("shared_reading_call"),
      generationId: id,
      inputDigest: hash,
      call: physicalCallSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("shared_reading_complete"),
      generationId: id,
      inputDigest: hash,
    })
    .strict(),
])
export const storedSharedChoiceSchema = z
  .object({
    targetVideoId: id,
    kind: z.literal("direct"),
    rank: z.number().int().positive(),
    relationship: z.literal("shared-reading"),
    reasonEnglish: text,
    addedViewingValueEnglish: text,
    evidence: z.union([
      z.object({ basis: z.literal("metadata"), fields: z.array(text) }),
      z.object({
        basis: z.literal("transcript"),
        passages: z.array(
          z.object({ chunkId: id, videoId: id, language: text, excerpt: text }),
        ),
      }),
    ]),
    sharedReading: z
      .object({
        version: z.literal(SHARED_IMPORT_VERSION),
        sourceVideoId: id,
        corpusDigest: hash,
        sourceEvidence: frozenEvidenceSchema,
        targetEvidence: frozenEvidenceSchema,
        sourceReferences: z.array(
          z.object({ chunkId: id, transcriptId: id, language: text }),
        ),
        targetReferences: z.array(
          z.object({ chunkId: id, transcriptId: id, language: text }),
        ),
        privateSourceArtifactKey: text,
      })
      .strict(),
  })
  .strict()
export type StoredSharedChoice = z.infer<typeof storedSharedChoiceSchema>

export class SharedImportValidationError extends Error {}
function requireValid(value: unknown, reason: string): asserts value {
  if (!value) throw new SharedImportValidationError(reason)
}
const unique = (values: string[]) => new Set(values).size === values.length
export function validateSharedManifest(manifest: SharedImportManifest): void {
  const eligible = new Set(manifest.eligibleVideoIds)
  requireValid(unique(manifest.eligibleVideoIds), "duplicate eligible ID")
  requireValid(
    unique(manifest.sources.map((s) => s.sourceVideoId)),
    "duplicate source ID",
  )
  requireValid(
    unique(manifest.calls.map((c) => c.origin)),
    "duplicate physical origin",
  )
  requireValid(
    manifest.sources.every((s) => eligible.has(s.sourceVideoId)),
    "source outside corpus",
  )
  if (manifest.scope === "full_catalog")
    requireValid(
      manifest.sources.length === eligible.size,
      "catalog is incomplete",
    )
}

/** Same normalized fields on the producer wire and the persisted model-call row. */
export function physicalCallRow(call: ImportedPhysicalCall) {
  return {
    callId: call.origin,
    sourceVideoId: call.sourceVideoId,
    stage: call.stage,
    status: call.status,
    modelId: call.modelId,
    inputDigest: call.requestDigest,
    outputDigest: call.status === "failed" ? null : call.responseDigest,
    receiptDigest: call.receiptDigest,
    errorCode: call.status === "failed" ? "shared_reading_failed" : null,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cachedInputTokens: call.cachedInputTokens,
    startedAt: new Date(call.startedAt).toISOString(),
    finishedAt: new Date(call.finishedAt).toISOString(),
  }
}
export function validatePhysicalCall(
  call: ImportedPhysicalCall,
  manifest: SharedImportManifest,
): void {
  requireValid(
    unique(call.sourceVideoIds) &&
      call.sourceVideoIds.includes(call.sourceVideoId),
    "invalid call attribution",
  )
  requireValid(
    call.sourceVideoIds.every((id) =>
      manifest.sources.some((source) => source.sourceVideoId === id),
    ),
    "call source outside declared source set",
  )
  requireValid(
    call.cachedInputTokens <= call.inputTokens &&
      (call.reasoningTokens === null ||
        call.reasoningTokens <= call.outputTokens),
    "invalid usage subsets",
  )
  requireValid(
    new Date(call.finishedAt) >= new Date(call.startedAt),
    "invalid call interval",
  )
  requireValid(
    createHash("sha256").update(call.receiptJson).digest("hex") ===
      call.receiptDigest,
    "receipt byte digest mismatch",
  )
  const r = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(call.receiptJson))
  requireValid(
    r.origin === call.origin &&
      r.requestDigest === call.requestDigest &&
      r.reserved === true &&
      r.consumptionUnknown === false &&
      r.status === call.status &&
      r.modelId === call.modelId &&
      r.finishedAt === call.finishedAt,
    "receipt binding mismatch",
  )
  const u = r.usage as Record<string, unknown> | null
  requireValid(
    u &&
      (u.costUsd === undefined || u.costUsd === 0) &&
      u.inputTokens === call.inputTokens &&
      u.outputTokens === call.outputTokens &&
      u.cachedInputTokens === call.cachedInputTokens &&
      (u.reasoningTokens ?? null) === call.reasoningTokens &&
      (r.responseDigest ?? null) === call.responseDigest,
    "receipt usage mismatch",
  )
}

/** No legacy evidence limits or fuzzy/family exclusions. Witnesses are authenticated
 * producer attestations from the hash-bound frozen corpus, not current DB text. */
export function validateSharedSource(
  source: SharedImportSource,
  manifest: SharedImportManifest,
): void {
  requireValid(
    manifest.sources.some((s) => s.sourceVideoId === source.sourceVideoId),
    "undeclared source",
  )
  requireValid(
    unique(source.witnesses.map((v) => v.videoId)),
    "duplicate witness",
  )
  const videos = new Map(source.witnesses.map((v) => [v.videoId, v]))
  requireValid(
    unique(source.witnesses.flatMap((w) => w.chunks.map((c) => c.id))),
    "duplicate witness chunk identity",
  )
  const owner = videos.get(source.sourceVideoId)
  requireValid(owner, "missing source witness")
  requireValid(
    source.recommendations.length >= 5 ||
      (source.fewerThanFiveReason?.trim().length ?? 0) >= 12,
    "unexplained shortfall",
  )
  requireValid(
    unique(source.recommendations.map((r) => r.targetVideoId)),
    "duplicate target",
  )
  const cores = new Set<string>(),
    slugs = new Set<string>()
  for (const [index, rec] of source.recommendations.entries()) {
    const target = videos.get(rec.targetVideoId)
    requireValid(
      target && manifest.eligibleVideoIds.includes(rec.targetVideoId),
      "missing target",
    )
    requireValid(
      rec.rank === index + 1 && rec.sourceVideoId === source.sourceVideoId,
      "invalid rank/source",
    )
    requireValid(
      target.videoId !== owner.videoId &&
        !(owner.coreId && owner.coreId === target.coreId) &&
        !(owner.slug && owner.slug === target.slug),
      "self or duplicate identity",
    )
    requireValid(
      !(target.coreId && cores.has(target.coreId)) &&
        !(target.slug && slugs.has(target.slug)),
      "duplicate target identity",
    )
    if (target.coreId) cores.add(target.coreId)
    if (target.slug) slugs.add(target.slug)
    for (const [evidence, video] of [
      [rec.sourceEvidence, owner],
      [rec.targetEvidence, target],
    ] as const) {
      if (evidence.basis === "metadata") {
        for (const field of evidence.fields) {
          const value = video.metadata[field.field]
          requireValid(
            Array.isArray(value)
              ? value.includes(field.value)
              : value === field.value,
            "metadata evidence mismatch",
          )
        }
      } else {
        for (const passage of evidence.passages) {
          const chunk = video.chunks.find((c) => c.id === passage.chunkId)
          requireValid(
            chunk && chunk.text.includes(passage.excerpt),
            "transcript evidence ownership/content mismatch",
          )
        }
      }
    }
  }
}
