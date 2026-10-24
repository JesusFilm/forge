// Manager artifact reader — downloads transcript.json artifacts from
// manager's Railway S3 bucket (MANAGER_ARTIFACTS_S3_*) and
// Zod-validates against the expected shape before returning.
//
// feat-132 transcript embeddings read `{assetId}/transcript.json` and
// launch Mastra; Admin no longer imports manager-generated transcript vectors.
//
// Source references (shapes mirrored here):
//   apps/manager/src/services/transcription.ts (transcript write)

import { z } from "zod"
import { readManagerArtifact } from "@/storage/s3"

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
