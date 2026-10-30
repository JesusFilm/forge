// Retained devotional worker wire contracts; legacy Shorts jobs are retired.

export type JobKind = "devotional-render"

export type WorkerJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

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

export type DevotionalRenderOutput = {
  artifact: ArtifactRef
  outputDurationSec: number
  width: number
  height: number
}

export type DevotionalRenderReport = {
  portrait: DevotionalRenderOutput
  wide: DevotionalRenderOutput
}

export type JobResult = {
  artifacts: ArtifactRef[]
  report: DevotionalRenderReport
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

export type DevotionalRenderMetaArtifact = {
  schemaVersion: "1"
  runId: string
  inputAssetId: string
  inputHash: string
  portrait: DevotionalRenderOutput
  wide: DevotionalRenderOutput
  generatedAt: string
}
