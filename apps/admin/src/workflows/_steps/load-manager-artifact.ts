// Per-(video, edition) artifact-load step boundaries.
//
// These functions live OUTSIDE the workflow file by design. The
// useworkflow build plugin treats any module imported into a workflow
// file as part of "workflow scope" and rejects transitive reachability
// to Node-only modules — even when the actual call happens inside a
// `"use step"` function. `s3.ts` imports `node:fs/promises` and
// `node:path` for its local-fallback path, so importing
// `readSceneAnalysisArtifact` / `readTranscriptSourceArtifact` directly
// into the workflow file fails the build plugin check.
//
// Putting the step wrappers in this separate module side-steps the
// scope check — the workflow file only imports the step wrappers (whose
// bodies the plugin treats as step-runtime, where Node modules are
// available). The wrappers themselves can freely import the readers.
//
// Each function is intentionally a thin one-liner. The artifact's
// classification (artifact_missing → skipped, anything else → failed)
// is the caller's responsibility; the step just propagates the typed
// error from the underlying reader.

import {
  readSceneAnalysisArtifact,
  readTranscriptSourceArtifact,
  type SceneAnalysisResult,
  type TranscriptSourceArtifact,
} from "@/services/manager-artifacts.service"

/**
 * Per-(video, edition) scene-analysis artifact load. Throws
 * `ManagerArtifactError` on S3 failures; the workflow's `processGroup`
 * catches and cascades the classification per-locale.
 *
 * MUST be a `"use step"` because `readSceneAnalysisArtifact`
 * transitively imports `node:fs/promises` and `node:path` (in the
 * local-fallback path of `s3.ts`).
 *
 * Side-effect of the step boundary: the ~250 KB artifact JSON is
 * journaled per group on every call. Operators monitoring useworkflow
 * journal size should be aware.
 */
export async function stepLoadSceneAnalysisArtifact(
  cmsVideoId: number,
): Promise<SceneAnalysisResult> {
  "use step"
  return readSceneAnalysisArtifact(String(cmsVideoId))
}

/**
 * Per-(video, edition) transcript-source artifact load. feat-132 uses
 * `{assetId}/transcript.json` as Mastra input instead of importing
 * manager-generated `{assetId}/embeddings.json` vectors.
 */
export async function stepLoadTranscriptSourceArtifact(
  cmsVideoId: number,
): Promise<TranscriptSourceArtifact> {
  "use step"
  return readTranscriptSourceArtifact(String(cmsVideoId))
}
