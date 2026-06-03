// Manager artifact reader — downloads scene-analysis.json and
// transcript.json artifacts from
// manager's Railway S3 bucket (MANAGER_ARTIFACTS_S3_*) and
// Zod-validates against the expected shape before returning.
//
// Scene embeddings read `{assetId}/scene-analysis.json` and launch Mastra;
// Admin stores Mastra-generated vectors through scene-specific ingest.
// feat-132 transcript embeddings read `{assetId}/transcript.json` and
// launch Mastra; Admin no longer imports manager-generated transcript vectors.
//
// Source references (shapes mirrored here):
//   apps/manager/src/services/sceneAnalysis.ts (scene-analysis write)
//   apps/manager/src/services/sceneEmbeddingSync.ts (scene-analysis read)
//   apps/manager/src/services/transcription.ts (transcript write)

import { z } from "zod"
import { readManagerArtifact } from "@/storage/s3"

export const SceneAnalysisSchema = z
  .object({
    sceneIndex: z.number().int().nonnegative(),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nullable().optional(),
    chapterTitle: z.string().nullable().optional(),
    description: z.string(),
    themes: z.array(z.string()),
    bibleVerses: z.array(z.string()),
    demographics: z.array(z.string()),
    spiritualContext: z.array(z.string()),
  })
  .strict()

export const SceneAnalysisResultSchema = z
  .object({
    scenes: z.array(SceneAnalysisSchema),
    totalInputTokens: z.number().finite().optional(),
    totalOutputTokens: z.number().finite().optional(),
    provenance: z
      .object({
        artifactKey: z.string().min(1),
        generationMode: z.enum(["source", "raw-localized"]),
        requestedLocale: z.string().min(1).nullable(),
        inputLanguageBcp47: z.string().min(1),
        mediaSource: z
          .object({
            kind: z.literal("mux"),
            muxAssetId: z.string().min(1),
            playbackId: z.string().min(1),
          })
          .passthrough(),
        transcriptSource: z
          .object({
            kind: z.enum(["subtitle-url", "mux-transcription"]),
            languageBcp47: z.string().min(1),
            subtitleUrl: z.string().min(1).optional(),
            muxAssetId: z.string().min(1).optional(),
          })
          .passthrough(),
        generatedAt: z.string().min(1),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type SceneAnalysis = z.infer<typeof SceneAnalysisSchema>
export type SceneAnalysisResult = z.infer<typeof SceneAnalysisResultSchema>

export const TranscriptSourceSegmentSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string(),
  })
  .strict()

export const TranscriptSourceArtifactSchema = z
  .object({
    text: z.string(),
    segments: z.array(TranscriptSourceSegmentSchema),
    language: z.string().min(1),
    resolvedProvider: z.enum(["elevenlabs", "mux"]).optional(),
    routingReport: z.unknown().optional(),
  })
  .passthrough()

export type TranscriptSourceArtifact = z.infer<
  typeof TranscriptSourceArtifactSchema
>

export class ManagerArtifactError extends Error {
  constructor(
    readonly code:
      | "artifact_missing"
      | "artifact_invalid"
      | "artifact_read_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ManagerArtifactError"
  }
}

/**
 * Decide whether a thrown error from `readManagerArtifact` represents a
 * genuinely-missing artifact (manager hasn't enriched this asset yet)
 * vs an actual transport / config failure.
 *
 * Order matters: typed surface FIRST (stable across AWS SDK message
 * rewordings — historically AWS has rephrased the textual NoSuchKey
 * message at least once), regex backstop SECOND (covers local-fallback
 * `ENOENT` and any future alt-storage backends that don't carry an AWS
 * SDK-typed shape).
 *
 * The regex is deliberately TIGHT — narrower than the legacy
 * `/not found|missing|no such key|ENOENT|NoSuchKey/i` it replaces.
 * Tokens dropped:
 *   - `NoSuchKey` / `no such key`: typed branch above covers AWS SDK
 *     verbatim; the regex would over-match unrelated S3-shaped errors.
 *   - `missing` (bare): too loose — matches "missing field 'foo'" and
 *     other unrelated bug messages, mis-demoting real failures to
 *     skipped. The remaining tokens (`not found`, `does not exist`,
 *     `ENOENT`) are specific enough that no observed-in-practice error
 *     message has been mis-classified.
 *
 * Tests must throw the REAL typed shape (`Object.assign(new Error(...),
 * { name: "NoSuchKey" })`), not a generic `new Error("NoSuchKey: ...")`
 * — otherwise the regex backstop satisfies the test while the typed
 * branch stays untested, which is the trap captured in
 * `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`
 * generalized to mocks. See also
 * `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`.
 */
function isArtifactMissing(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name
    if (name === "NoSuchKey" || name === "NotFound") return true
    const code = (error as { Code?: unknown }).Code
    if (code === "NoSuchKey" || code === "NotFound") return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /not found|does not exist|ENOENT/i.test(message)
}

/**
 * Read a scene-analysis artifact from manager's Railway S3 bucket
 * (MANAGER_ARTIFACTS_S3_*) or local
 * `.tmp/artifacts/{assetId}/scene-analysis.json` fallback and return
 * the parsed, Zod-validated result.
 *
 * @param assetId  The integer cms video id as a string — this is the
 *                 key manager used when writing the artifact. Admin's
 *                 Video.coreId must be mapped to this via the core-id
 *                 mapping file before calling.
 */
export async function readSceneAnalysisArtifact(
  assetId: string,
  targetLocale?: string | null,
): Promise<SceneAnalysisResult> {
  const artifactType = sceneAnalysisArtifactType(targetLocale)
  let bytes: Uint8Array
  try {
    bytes = await readManagerArtifact(assetId, artifactType, "json")
  } catch (error) {
    if (isArtifactMissing(error)) {
      throw new ManagerArtifactError(
        "artifact_missing",
        `scene-analysis artifact not found for assetId=${assetId}${targetLocale ? ` targetLocale=${targetLocale}` : ""}`,
        error,
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new ManagerArtifactError(
      "artifact_read_failed",
      `failed to read scene-analysis artifact for assetId=${assetId}${targetLocale ? ` targetLocale=${targetLocale}` : ""}: ${message}`,
      error,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `scene-analysis artifact for assetId=${assetId}${targetLocale ? ` targetLocale=${targetLocale}` : ""} is not valid JSON`,
      error,
    )
  }

  const parsed = SceneAnalysisResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `scene-analysis artifact for assetId=${assetId}${targetLocale ? ` targetLocale=${targetLocale}` : ""} failed schema validation: ${parsed.error.message}`,
      parsed.error,
    )
  }

  assertLocalizedSceneArtifactProvenance(parsed.data, targetLocale)
  return parsed.data
}

export function sceneAnalysisArtifactType(
  targetLocale: string | null | undefined,
): string {
  const normalized = normalizeSceneAnalysisLocale(targetLocale)
  return normalized ? `scene-analysis-${normalized}` : "scene-analysis"
}

export function sceneAnalysisArtifactKey(
  assetId: string | number,
  targetLocale: string | null | undefined,
): string {
  return `${assetId}/${sceneAnalysisArtifactType(targetLocale)}.json`
}

export function normalizeSceneAnalysisLocale(
  targetLocale: string | null | undefined,
): string | null {
  const normalized = targetLocale?.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `invalid scene-analysis target locale: ${targetLocale}`,
    )
  }
  return normalized
}

function assertLocalizedSceneArtifactProvenance(
  artifact: SceneAnalysisResult,
  targetLocale: string | null | undefined,
): void {
  const normalizedTarget = normalizeSceneAnalysisLocale(targetLocale)
  if (!normalizedTarget) return

  const provenance = artifact.provenance
  if (!provenance) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `localized scene-analysis artifact missing provenance for targetLocale=${targetLocale}`,
    )
  }

  if (provenance.generationMode !== "raw-localized") {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `localized scene-analysis artifact has generationMode=${provenance.generationMode}; expected raw-localized`,
    )
  }

  const requestedLocale = normalizeSceneAnalysisLocale(
    provenance.requestedLocale,
  )
  const inputLanguage = normalizeSceneAnalysisLocale(
    provenance.inputLanguageBcp47,
  )
  const transcriptLanguage = normalizeSceneAnalysisLocale(
    provenance.transcriptSource.languageBcp47,
  )
  if (
    requestedLocale !== normalizedTarget ||
    inputLanguage !== normalizedTarget ||
    transcriptLanguage !== normalizedTarget
  ) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `localized scene-analysis provenance does not match targetLocale=${targetLocale}`,
    )
  }
}

export async function readTranscriptSourceArtifact(
  assetId: string,
): Promise<TranscriptSourceArtifact> {
  let bytes: Uint8Array
  try {
    bytes = await readManagerArtifact(assetId, "transcript", "json")
  } catch (error) {
    if (isArtifactMissing(error)) {
      throw new ManagerArtifactError(
        "artifact_missing",
        `transcript artifact not found for assetId=${assetId}`,
        error,
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new ManagerArtifactError(
      "artifact_read_failed",
      `failed to read transcript artifact for assetId=${assetId}: ${message}`,
      error,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `transcript artifact for assetId=${assetId} is not valid JSON`,
      error,
    )
  }

  const parsed = TranscriptSourceArtifactSchema.safeParse(raw)
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        event: "transcript_artifact_invalid",
        assetId,
        zodMessage: parsed.error.message,
      }),
    )
    throw new ManagerArtifactError(
      "artifact_invalid",
      `transcript artifact for assetId=${assetId} failed schema validation`,
      parsed.error,
    )
  }

  return parsed.data
}
