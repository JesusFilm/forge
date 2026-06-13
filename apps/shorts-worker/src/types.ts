// Shared local types for the Shorts Studio worker wire contracts.
// Source of truth: docs/plans/2026-06-11-002-feat-manager-shorts-studio-plan.md.
// Literals here are cross-app contracts with apps/manager — do not rename
// without updating the plan and the manager client.

export type JobKind = "prepare" | "render"

export type WorkerJobStatus = "queued" | "running" | "completed" | "failed"

export type ArtifactRef = {
  assetId: string
  artifactType: string
  ext: string
}

// Structured job error surfaced on GET /jobs/{workerJobId}. `retryable` is
// advisory for the manager client (it classifies into FatalError vs SDK
// retry on its side); deterministic worker failures report false.
export type JobErrorBody = {
  reason: string
  messages: string[]
  retryable: boolean
}

// Phase annotations recorded in the captions artifact + prepare report.
export type TranscriptionAnnotation =
  | "transcription_skipped_no_audio"
  | "transcription_unsupported_language"

export type PrepareReport = {
  hasAudio: boolean
  clipDurationSec: number
  captionsCount: number
  annotation: TranscriptionAnnotation | null
}

export type RenderReport = {
  outputDurationSec: number
  width: number
  height: number
}

export type JobResult = {
  artifacts: ArtifactRef[]
  report: PrepareReport | RenderReport
}

export type JobStatusBody = {
  workerJobId: string
  kind: JobKind
  status: WorkerJobStatus
  progress: number
  message: string | null
  error: JobErrorBody | null
  result: JobResult | null
}

// ---------------------------------------------------------------------------
// Artifact JSON shapes ({assetId}/{artifactType}.json)
// ---------------------------------------------------------------------------

// shorts-clip-meta-v1.json — host-only source provenance (never the full
// URL; presigned/loopback URLs must not be persisted).
export type ClipMetaArtifact = {
  sourceHost: string
  clip: { startSec: number; endSec: number }
  durationSec: number
  fps: number
  width: number
  height: number
  hasAudio: boolean
  generatedAt: string
}

// shorts-captions-v1.json — whisper word-level captions (immutable; operator
// edits live in manager's draft artifact, never here).
export type CaptionsArtifactCaption = {
  text: string
  startMs: number
  endMs: number
  timestampMs: number | null
  confidence: number | null
}

export type CaptionsArtifact = {
  captions: CaptionsArtifactCaption[]
  language: string | null
  model: "large-v3-turbo" | null
  annotation: TranscriptionAnnotation | null
  generatedAt: string
}

// shorts-render-meta-v1.json — propsHash is the manager's opaque dedupe
// token (passed through verbatim, never recomputed here).
export type RenderMetaArtifact = {
  propsHash: string
  renderedDraftVersion: number
  compositionsVersion: string
  generatedAt: string
}
