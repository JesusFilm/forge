// Per-(video, edition) artifact-load step boundaries.
//
// These functions live OUTSIDE the workflow file by design. The
// useworkflow build plugin treats any module imported into a workflow
// file as part of "workflow scope" and rejects transitive reachability
// to Node-only modules — even when the actual call happens inside a
// `"use step"` function. `s3.ts` imports `node:fs/promises` and
// `node:path` for its local-fallback path, so importing
// `readTranscriptSourceArtifact` directly into the workflow file fails
// the build plugin check.
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
  readTranscriptSourceArtifact,
  type TranscriptSourceArtifact,
} from "@/services/manager-artifacts.service"

/**
 * Per-(video, edition) transcript-source artifact load. feat-132 uses
 * `{assetId}/transcript.json` as Mastra input. Manager no longer owns
 * transcript embedding generation.
 */
export async function stepLoadTranscriptSourceArtifact(
  cmsVideoId: number,
): Promise<TranscriptSourceArtifact> {
  "use step"
  return readTranscriptSourceArtifact(String(cmsVideoId))
}
