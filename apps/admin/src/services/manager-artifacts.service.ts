// Manager artifact reader — downloads scene-analysis.json (and future
// manager-produced artifacts) from the shared Railway S3 bucket and
// Zod-validates against the expected shape before returning.
//
// Per R1 of the admin migration playbook: admin reads apps/manager's
// {assetId}/scene-analysis.json artifacts during scene-embedding
// backfill. Admin does not run the upstream multimodal pipeline — it
// only indexes what manager has already written.
//
// Source reference (shape mirrored here):
//   apps/manager/src/services/sceneAnalysis.ts (write path)
//   apps/manager/src/services/sceneEmbeddingSync.ts (read + normalize)

import { z } from "zod"
import { readArtifact } from "@/storage/s3"

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
  })
  .passthrough()

export type SceneAnalysis = z.infer<typeof SceneAnalysisSchema>
export type SceneAnalysisResult = z.infer<typeof SceneAnalysisResultSchema>

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
 * Read a scene-analysis artifact from the shared Railway S3 bucket or
 * local `.tmp/artifacts/{assetId}/scene-analysis.json` fallback and
 * return the parsed, Zod-validated result.
 *
 * @param assetId  The integer cms video id as a string — this is the
 *                 key manager used when writing the artifact. Admin's
 *                 Video.coreId must be mapped to this via the core-id
 *                 mapping file before calling.
 */
export async function readSceneAnalysisArtifact(
  assetId: string,
): Promise<SceneAnalysisResult> {
  let bytes: Uint8Array
  try {
    bytes = await readArtifact(assetId, "scene-analysis", "json")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not found|missing|no such key|ENOENT|NoSuchKey/i.test(message)) {
      throw new ManagerArtifactError(
        "artifact_missing",
        `scene-analysis artifact not found for assetId=${assetId}`,
        error,
      )
    }
    throw new ManagerArtifactError(
      "artifact_read_failed",
      `failed to read scene-analysis artifact for assetId=${assetId}: ${message}`,
      error,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `scene-analysis artifact for assetId=${assetId} is not valid JSON`,
      error,
    )
  }

  const parsed = SceneAnalysisResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `scene-analysis artifact for assetId=${assetId} failed schema validation: ${parsed.error.message}`,
      parsed.error,
    )
  }

  return parsed.data
}
