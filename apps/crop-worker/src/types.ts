// Shared local types for the Smart Crop wire contracts.
// Source of truth: docs/plans/2026-06-09-002-feat-smart-crop-plan.md.
// Literals here are cross-app contracts with apps/manager and apps/mastra —
// do not rename without updating the plan and both consumers.

export type RenderMode = "preview" | "full"

export type JobKind = "fingerprint" | "render"

export type WorkerJobStatus = "queued" | "running" | "completed" | "failed"

export type ArtifactRef = {
  assetId: string
  artifactType: string
  ext: string
}

export type SourceDimensions = {
  width: number
  height: number
  durationSeconds: number
}

export type RepresentativeHash = {
  time: number
  dhash: string
}

export type FingerprintShot = {
  shotId: string
  start: number
  end: number
  representativeHashes: RepresentativeHash[]
}

export type FingerprintArtifact = {
  version: 1
  kind: "smart-crop-fingerprint"
  assetId: string
  source: SourceDimensions
  sampling: { hashFps: number; hashSize: number; sceneThreshold: number }
  shots: FingerprintShot[]
  tool: "crop-worker-fingerprint-v1"
  generatedAt: string
}

export type FingerprintSummary = {
  shotCount: number
  durationSeconds: number
  width: number
  height: number
}

export type CropKeyframe = {
  progress: number
  x: number
  y: number
  width: number
  height: number
}

export type RenderSegment = {
  shotId: string
  start: number
  end: number
  durationSeconds: number
  keyframes: CropKeyframe[]
}

export type RenderedReportSegment = {
  shotId: string
  sourceStartSeconds: number
  sourceEndSeconds: number
  outputStartSeconds: number
  outputEndSeconds: number
  durationSeconds: number
}

export type RenderReport = {
  version: 1
  kind: "smart-crop-render-report"
  assetId: string
  mode: RenderMode
  cropPlanArtifactType: string
  artifactSuffix?: string
  target: { aspectRatio: "9:16"; width: number; height: number }
  segmentsRendered: number
  segmentsPlanned: number
  renderedSegments: RenderedReportSegment[]
  outputDurationSeconds: number
  outputBytes: number
  renderSeconds: number
  previewFrameArtifactTypes: string[]
  warnings: string[]
  tool: "crop-worker-render-v1"
  generatedAt: string
}

export type JobResult = {
  artifacts: ArtifactRef[]
  report: RenderReport | FingerprintSummary
}

export type JobStatusBody = {
  workerJobId: string
  kind: JobKind
  status: WorkerJobStatus
  progress: number
  message: string | null
  error: string | null
  result: JobResult | null
}
