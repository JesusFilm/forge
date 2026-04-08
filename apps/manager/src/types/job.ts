// Job types — copied verbatim from the original VideoForge repo.
// Forge extension: muxPlaybackId added to JobRecord (stored at job creation).
// Forge uses only 5 of the 12 workflow steps (transcription, translation,
// chapters, metadata, embeddings) but the full union is kept so the original
// UI components compile unchanged.

export type JobStatus = "pending" | "running" | "completed" | "failed"

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

export type WorkflowStepName =
  | "download_video"
  | "transcription"
  | "structured_transcript"
  | "subtitle_post_process"
  | "chapters"
  | "metadata"
  | "embeddings"
  | "translation"
  | "voiceover"
  | "artifact_upload"
  | "mux_upload"
  | "cms_notify"

export interface JobOptions {
  generateVoiceover?: boolean
  uploadMux?: boolean
  notifyCms?: boolean
}

export type TranslationLanguageResult = {
  lang: string
  status: "completed" | "failed"
  error?: string
}

export type JobStepDetails = {
  languageResults?: TranslationLanguageResult[]
}

export interface JobStepState {
  name: WorkflowStepName
  status: StepStatus
  retries: number
  startedAt?: string
  finishedAt?: string
  error?: string
  details?: JobStepDetails
}

export interface JobError {
  step: WorkflowStepName
  message: string
  at: string
  code?: string
  operatorHint?: string
  isDependencyError?: boolean
}

export type JobArtifactDownloadEntry = {
  kind: "downloadable"
}

export type JobArtifactMetadataEntry = {
  kind: "metadata"
  data: Record<string, unknown>
}

export type JobArtifactEntry =
  | JobArtifactDownloadEntry
  | JobArtifactMetadataEntry

export type JobArtifactManifest = Record<string, JobArtifactEntry>

export interface JobRecord {
  id: string
  muxAssetId: string
  muxPlaybackId: string // Forge extension — stored at job creation
  languages: string[]
  sourceCollectionTitle?: string
  sourceMediaTitle?: string
  requestedLanguageAbbreviations?: string[]
  options: JobOptions
  status: JobStatus
  currentStep?: WorkflowStepName
  retries: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  artifacts: JobArtifactManifest
  steps: JobStepState[]
  errors: JobError[]
}
