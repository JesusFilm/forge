import { Prisma, type PrismaClient } from "@prisma/client"
import { isValidMastraRecommendationIngestBearer } from "@/auth/mastra-ingest-bearer"
import { readObject, writeObject } from "@/storage/s3"
import { PrecomputedRecommendationError } from "./contract"
import {
  SharedImportValidationError,
  canonicalImportJson,
  importDigest,
  physicalCallRow,
  sharedImportSubmissionSchema,
  sharedManifestSchema,
  SHARED_IMPORT_VERSION,
  validatePhysicalCall,
  validateSharedManifest,
  validateSharedSource,
  type SharedImportManifest,
  type SharedImportSource,
  type StoredSharedChoice,
} from "./shared-reading-import-contract"

export function sharedImportKey(
  generationId: string,
  digest: string,
  suffix = "manifest.json",
): string {
  return `recommendations/private/shared-reading-v1/${importDigest(generationId)}/${digest}/${suffix}`
}
function reject(
  code: "invalid" | "conflict" | "not_found",
  message: string,
): never {
  throw new PrecomputedRecommendationError(code, message)
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
async function manifestFor(
  generationId: string,
  digest: string,
): Promise<SharedImportManifest> {
  const bytes = await readObject(sharedImportKey(generationId, digest))
  const manifest = sharedManifestSchema.parse(
    JSON.parse(Buffer.from(bytes).toString("utf8")),
  )
  if (importDigest(manifest) !== digest)
    reject("conflict", "Private manifest changed")
  return manifest
}
export async function loadSharedReviewProvenance(
  generationId: string,
  digest: string,
  sourceVideoId: string,
) {
  const manifest = await manifestFor(generationId, digest)
  return {
    scope: manifest.scope,
    declaredSourceCount: manifest.sources.length,
    eligibleTargetCount: manifest.eligibleVideoIds.length,
    fewerThanFiveReason:
      manifest.sources.find((s) => s.sourceVideoId === sourceVideoId)
        ?.fewerThanFiveReason ?? null,
    manifestKey: sharedImportKey(generationId, digest),
  }
}
export function sharedChoices(
  source: SharedImportSource,
  manifest: SharedImportManifest,
  artifactKey: string,
): StoredSharedChoice[] {
  const witnesses = new Map(source.witnesses.map((w) => [w.videoId, w]))
  return source.recommendations.map((rec) => {
    function refs(videoId: string, evidence: typeof rec.sourceEvidence) {
      return evidence.basis === "metadata"
        ? []
        : evidence.passages.map((p) => {
            const c = witnesses
              .get(videoId)!
              .chunks.find((c) => c.id === p.chunkId)!
            return {
              chunkId: c.id,
              transcriptId: c.transcriptId,
              language: c.language,
            }
          })
    }
    return {
      targetVideoId: rec.targetVideoId,
      kind: "direct",
      rank: rec.rank,
      relationship: "shared-reading",
      reasonEnglish: rec.connection,
      addedViewingValueEnglish: rec.watchingValue,
      evidence:
        rec.targetEvidence.basis === "metadata"
          ? {
              basis: "metadata",
              fields: rec.targetEvidence.fields.map((f) => f.field),
            }
          : {
              basis: "transcript",
              passages: rec.targetEvidence.passages.map((p) => ({
                ...p,
                videoId: rec.targetVideoId,
                language: witnesses
                  .get(rec.targetVideoId)!
                  .chunks.find((c) => c.id === p.chunkId)!.language,
              })),
            },
      sharedReading: {
        version: SHARED_IMPORT_VERSION,
        sourceVideoId: rec.sourceVideoId,
        corpusDigest: manifest.corpusDigest,
        sourceEvidence: rec.sourceEvidence,
        targetEvidence: rec.targetEvidence,
        sourceReferences: refs(rec.sourceVideoId, rec.sourceEvidence),
        targetReferences: refs(rec.targetVideoId, rec.targetEvidence),
        privateSourceArtifactKey: artifactKey,
      },
    }
  })
}

/** Uses the existing bearer and protocol-1 storage, with a reserved version so
 * legacy source/complete actions cannot bypass these manifest commitments. */
export async function submitSharedReadingImport(
  db: PrismaClient,
  raw: unknown,
  authorization: string | null,
) {
  if (!isValidMastraRecommendationIngestBearer(authorization))
    throw new PrecomputedRecommendationError(
      "unauthorized",
      "Authorization required",
    )
  const parsed = sharedImportSubmissionSchema.safeParse(raw)
  if (!parsed.success)
    reject("invalid", "Invalid shared-reading import payload")
  const input = parsed.data
  try {
    if (input.action === "shared_reading_start") {
      validateSharedManifest(input.manifest)
      const digest = importDigest(input.manifest)
      // Content-addressed; identical replays write identical bytes, never an old run.
      await writeObject(
        sharedImportKey(input.generationId, digest),
        canonicalImportJson(input.manifest),
        "application/json",
      )
      return db.$transaction(async (tx) => {
        if (
          await tx.recommendationPrecomputedGenerationRetentionProof.findUnique(
            { where: { generationId: input.generationId } },
          )
        )
          reject("conflict", "Generation ID was retired")
        const inserted =
          await tx.recommendationPrecomputedGeneration.createMany({
            data: [
              {
                id: input.generationId,
                protocolVersion: 1,
                modelId: input.manifest.modelId,
                promptVersion: SHARED_IMPORT_VERSION,
                inputDigest: digest,
                sourceSetDigest: importDigest(
                  input.manifest.sources.map((s) => s.sourceVideoId).sort(),
                ),
                inputCutoff: new Date(input.manifest.inputCutoff),
                expectedSourceCount: input.manifest.sources.length,
                inputMode: "content_only",
                // Frozen evidence is verified by the producer. Current DB freshness and
                // historical/public qualification are deliberately not asserted.
                inputSnapshotMode: "preflight_failed",
                executionBackend: "codex_chatgpt_subscription",
                historicalProvenance: Prisma.DbNull,
              },
            ],
            skipDuplicates: true,
          })
        const generation =
          await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
            where: { id: input.generationId },
          })
        if (
          generation.promptVersion !== SHARED_IMPORT_VERSION ||
          generation.protocolVersion !== 1 ||
          generation.inputDigest !== digest ||
          generation.inputMode !== "content_only" ||
          generation.modelId !== input.manifest.modelId ||
          generation.expectedSourceCount !== input.manifest.sources.length ||
          generation.sourceSetDigest !==
            importDigest(
              input.manifest.sources.map((s) => s.sourceVideoId).sort(),
            ) ||
          generation.inputCutoff.getTime() !==
            new Date(input.manifest.inputCutoff).getTime() ||
          generation.inputSnapshotMode !== "preflight_failed" ||
          generation.executionBackend !== "codex_chatgpt_subscription"
        )
          reject("conflict", "Generation identity has different input")
        if (!["incomplete", "complete"].includes(generation.status))
          reject("conflict", "Generation is not importable")
        return {
          generationId: generation.id,
          state: generation.status,
          replay: inserted.count === 0,
          inputDigest: digest,
        }
      })
    }
    const manifest = await manifestFor(input.generationId, input.inputDigest)
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM recommendation_precomputed_generation WHERE id = ${input.generationId} FOR UPDATE`
      const generation =
        await tx.recommendationPrecomputedGeneration.findUnique({
          where: { id: input.generationId },
        })
      if (!generation) reject("not_found", "Generation not found")
      if (
        generation.protocolVersion !== 1 ||
        generation.promptVersion !== SHARED_IMPORT_VERSION ||
        generation.inputDigest !== input.inputDigest ||
        generation.inputMode !== "content_only" ||
        generation.modelId !== manifest.modelId ||
        generation.inputSnapshotMode !== "preflight_failed" ||
        generation.expectedSourceCount !== manifest.sources.length ||
        !["incomplete", "complete"].includes(generation.status)
      )
        reject("conflict", "Generation identity/state mismatch")
      if (input.action === "shared_reading_source") {
        const commitment = manifest.sources.find(
          (s) => s.sourceVideoId === input.source.sourceVideoId,
        )
        if (
          !commitment ||
          commitment.payloadDigest !== importDigest(input.source) ||
          commitment.fewerThanFiveReason !== input.source.fewerThanFiveReason
        )
          reject("conflict", "Source differs from manifest")
        validateSharedSource(input.source, manifest)
        const videos = await tx.video.findMany({
          where: {
            id: { in: input.source.witnesses.map((w) => w.videoId) },
            deletedAt: null,
          },
          select: { id: true, coreId: true, slug: true },
        })
        for (const witness of input.source.witnesses) {
          const video = videos.find((v) => v.id === witness.videoId)
          if (
            !video ||
            (video.coreId || null) !== witness.coreId ||
            video.slug !== witness.slug
          )
            reject("conflict", "Video identity differs from frozen witness")
        }
        const where = {
          generationId_sourceVideoId: {
            generationId: input.generationId,
            sourceVideoId: input.source.sourceVideoId,
          },
        }
        const previous = await tx.recommendationPrecomputedSource.findUnique({
          where,
        })
        if (previous) {
          if (
            previous.status !== "complete" ||
            previous.submissionDigest !== commitment.payloadDigest
          )
            reject("conflict", "Source replay differs")
          return { state: generation.status, replay: true }
        }
        if (generation.status !== "incomplete")
          reject("conflict", "Generation already complete")
        const key = sharedImportKey(
          input.generationId,
          input.inputDigest,
          `sources/${commitment.payloadDigest}.json`,
        )
        await writeObject(
          key,
          canonicalImportJson(input.source),
          "application/json",
        )
        const payload = sharedChoices(input.source, manifest, key)
        await tx.recommendationPrecomputedSource.create({
          data: {
            generationId: input.generationId,
            sourceVideoId: input.source.sourceVideoId,
            payload: json(payload),
            submissionDigest: commitment.payloadDigest,
            acceptedCount: payload.length,
            status: "complete",
          },
        })
        return { state: "incomplete", replay: false }
      }
      if (input.action === "shared_reading_call") {
        const commitment = manifest.calls.find(
          (c) => c.origin === input.call.origin,
        )
        const row = physicalCallRow(input.call)
        if (
          !commitment ||
          commitment.payloadDigest !== importDigest(input.call) ||
          commitment.rowDigest !== importDigest(row)
        )
          reject("conflict", "Call differs from manifest")
        validatePhysicalCall(input.call, manifest)
        const where = {
          generationId_callId: {
            generationId: input.generationId,
            callId: input.call.origin,
          },
        }
        const previous = await tx.recommendationPrecomputedModelCall.findUnique(
          { where },
        )
        if (previous) {
          const {
            callId,
            sourceVideoId,
            stage,
            status,
            modelId,
            inputDigest,
            outputDigest,
            receiptDigest,
            errorCode,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            startedAt,
            finishedAt,
          } = previous
          if (
            importDigest({
              callId,
              sourceVideoId,
              stage,
              status,
              modelId,
              inputDigest,
              outputDigest,
              receiptDigest,
              errorCode,
              inputTokens,
              outputTokens,
              cachedInputTokens,
              startedAt: startedAt.toISOString(),
              finishedAt: finishedAt?.toISOString(),
            }) !== commitment.rowDigest
          )
            reject("conflict", "Call replay differs")
          return { state: generation.status, replay: true }
        }
        if (generation.status !== "incomplete")
          reject("conflict", "Generation already complete")
        await writeObject(
          sharedImportKey(
            input.generationId,
            input.inputDigest,
            `calls/${commitment.payloadDigest}.json`,
          ),
          canonicalImportJson(input.call),
          "application/json",
        )
        await tx.recommendationPrecomputedModelCall.create({
          data: {
            generationId: input.generationId,
            ...row,
            startedAt: new Date(row.startedAt),
            finishedAt: new Date(row.finishedAt),
          },
        })
        return { state: "incomplete", replay: false }
      }
      const [sources, calls] = await Promise.all([
        tx.recommendationPrecomputedSource.findMany({
          where: { generationId: input.generationId },
        }),
        tx.recommendationPrecomputedModelCall.findMany({
          where: { generationId: input.generationId },
        }),
      ])
      if (
        sources.length !== manifest.sources.length ||
        sources.some(
          (s) =>
            s.status !== "complete" ||
            !manifest.sources.some(
              (e) =>
                e.sourceVideoId === s.sourceVideoId &&
                e.payloadDigest === s.submissionDigest,
            ),
        )
      )
        reject("conflict", "Declared source set is incomplete")
      if (calls.length !== manifest.calls.length)
        reject("conflict", "Physical call set is incomplete")
      for (const call of calls) {
        const {
          callId,
          sourceVideoId,
          stage,
          status,
          modelId,
          inputDigest,
          outputDigest,
          receiptDigest,
          errorCode,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          startedAt,
          finishedAt,
        } = call
        const row = {
          callId,
          sourceVideoId,
          stage,
          status,
          modelId,
          inputDigest,
          outputDigest,
          receiptDigest,
          errorCode,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt?.toISOString(),
        }
        if (
          !manifest.calls.some(
            (c) => c.origin === callId && c.rowDigest === importDigest(row),
          ) ||
          inputTokens === null ||
          outputTokens === null
        )
          reject("conflict", "Call binding/usage is unresolved")
      }
      await tx.recommendationPrecomputedGeneration.update({
        where: { id: input.generationId },
        data: {
          status: "complete",
          completedAt: generation.completedAt ?? new Date(),
        },
      })
      return {
        generationId: input.generationId,
        state: "complete",
        replay: generation.status === "complete",
        scope: manifest.scope,
      }
    })
  } catch (cause) {
    if (cause instanceof PrecomputedRecommendationError) throw cause
    if (
      cause instanceof SharedImportValidationError ||
      (cause instanceof Error && cause.name === "ZodError")
    )
      reject("invalid", cause.message)
    throw cause
  }
}
