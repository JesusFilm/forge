// Job types — copied verbatim from the original VideoForge repo.
// Forge extension: muxPlaybackId added to JobRecord (stored at job creation).
// Forge uses a subset of the original VideoForge workflow steps, but the full
// union is kept so the original UI components compile unchanged.

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
  | "seo_improvements"
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

export type EmbeddingSyncStatus =
  | "applied_missing"
  | "skipped_existing"
  | "override_applied"
  | "failed"
  | "unsupported"

export type EmbeddingSyncGeneratedSummary = {
  model: string
  dimensions: number
  chunkCount: number
  generatedAt?: string
  contentFingerprint: string
  hasMetadataEmbedding: boolean
}

export type EmbeddingSyncCmsSummary = {
  resolvedVideoId: number
  hasEmbeddings: boolean
  chunkCount: number
  model?: string
  contentFingerprint?: string
}

export type EmbeddingSyncOverrideSummary = {
  approvedByUserId: string
  approvedAt: string
}

export type EmbeddingSyncReport = {
  domain: "embeddings"
  videoDocumentId?: string
  status: EmbeddingSyncStatus
  reason?: string
  generated: EmbeddingSyncGeneratedSummary
  cms?: EmbeddingSyncCmsSummary
  override?: EmbeddingSyncOverrideSummary
}

export type SceneEmbeddingSyncStatus =
  | "indexed"
  | "skipped_empty"
  | "failed"
  | "unsupported"

export type SceneEmbeddingSyncReport = {
  domain: "scene_embeddings"
  videoDocumentId?: string
  resolvedVideoId?: number
  status: SceneEmbeddingSyncStatus
  reason?: string
  model?: string
  dimensions?: number
  generatedSceneCount: number
  indexableSceneCount: number
  indexedSceneCount?: number
  skippedEmptySceneIndexes?: number[]
  embeddingTokens?: number
}

export type MuxSyncStatus =
  | "synced"
  | "skipped_existing_mux_data"
  | "skipped_missing_generated_data"
  | "override_pending"
  | "override_applied"
  | "reconciliation_required"
  | "failed"

export type MuxSyncComparison = {
  artifactKey: string
  targetLanguage: string
  muxTargetType: "text_track"
  muxTargetKey: string
  status: MuxSyncStatus
  explanation: string
  generatedPreview?: string
  muxPreview?: string
  muxTrackId?: string
  canOverride?: boolean
  updatedAt?: string
}

export type MuxSyncOverrideAuditEntry = {
  artifactKey: string
  targetLanguage: string
  at: string
  action: "override_subtitle_track"
}

export type MuxSyncReport = {
  comparisons: MuxSyncComparison[]
  overrideHistory?: MuxSyncOverrideAuditEntry[]
  updatedAt: string
}

export type RequestedTranscriptionProvider = "automatic" | "elevenlabs" | "mux"

export type ResolvedTranscriptionProvider = "elevenlabs" | "mux"

export type TranscriptionAttemptStatus =
  | "running"
  | "completed"
  | "failed"
  | "fallback_completed"

export type TranscriptionDiarizationSegment = {
  speakerId: string
  start: number
  end: number
  text?: string
}

export type TranscriptionDiarizationSummary = {
  speakerCount?: number
  segments?: TranscriptionDiarizationSegment[]
}

export type TranscriptionAttempt = {
  attemptId: string
  requestedProvider: RequestedTranscriptionProvider
  resolvedProvider: ResolvedTranscriptionProvider
  status: TranscriptionAttemptStatus
  sourceLanguageCode?: string
  decisionReason?: string
  fallbackFromProvider?: "elevenlabs"
  fallbackReason?: string
  startedAt: string
  finishedAt?: string
}

export type TranscriptionRoutingReport = {
  sourceInputUrl?: string
  sourceInputHost?: string
  currentAttemptId?: string
  attempts: TranscriptionAttempt[]
  finalProvider?: ResolvedTranscriptionProvider
  finalSourceLanguageCode?: string
  fallbackReason?: string
  diarization?: TranscriptionDiarizationSummary
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
  videoDocumentId?: string
  languages: string[]
  sourceLanguageId?: string
  sourceLanguageCode?: string
  sourceSelectionReason?: string
  primaryRequestedTargetLanguageCode?: string
  resolvedTargetLanguageCodes?: string[]
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
