// Job types — copied verbatim from the original VideoForge repo.
// Forge extension: muxPlaybackId added to JobRecord (stored at job creation).
// Forge uses a subset of the VideoForge workflow steps but keeps the full union
// so the original UI components compile unchanged.

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
  | "audio_cleanup"
  | "voiceover"
  | "artifact_upload"
  | "mux_upload"
  | "theology_validation_bible_quotes"
  | "seo_improvements"
  | "cms_notify"
  | "smart_crop_fingerprint"
  | "smart_crop_plan"
  | "smart_crop_align"
  | "smart_crop_preview_render"
  | "smart_crop_qa"
  | "smart_crop_render"
  | "smart_crop_mux_output"

export type SmartCropKind = "canonical" | "localized"

export type SmartCropCropMode =
  | "auto"
  | "speaker"
  | "group"
  | "object"
  | "slide_aware"

// Job options discriminator for Smart Crop jobs (plan 2026-06-09-002).
// `assetId` is the operator-facing storage-key prefix; smart-crop artifacts
// live under this id, which MAY differ from the job's muxAssetId. The
// artifact download route resolves the storage prefix from this field.
export type SmartCropJobOptions = {
  kind: SmartCropKind
  assetId: string
  targetAspectRatio: "9:16"
  cropMode: SmartCropCropMode
  canonicalAssetId?: string
  language?: string
  model?: string
  force?: boolean
}

export interface JobOptions {
  generateVoiceover?: boolean
  uploadMux?: boolean
  notifyCms?: boolean
  smartCrop?: SmartCropJobOptions
}

// ---------------------------------------------------------------------------
// Smart Crop metadata artifact entry (plan 2026-06-09-002 "Job options
// discriminator"): live phase data mirrored into the `smartCrop` metadata
// artifact entry for the UI.
// ---------------------------------------------------------------------------

export type SmartCropPhase =
  | "queued"
  | "fingerprint"
  | "plan"
  | "align"
  | "preview_render"
  | "qa"
  | "render"
  | "mux_output"
  | "completed"
  | "failed"

export type SmartCropQaVerdict = "pass" | "needs_repair" | "fail"

export type SmartCropAlignmentSummary = {
  overallConfidence: number
  unmappedDurationPercent: number
  gatePassed: boolean
}

export type SmartCropPlanSummary = {
  segmentCount: number
  approved: boolean
}

export type SmartCropOutputSummary = {
  muxAssetId: string
  playbackId?: string
}

export type SmartCropUsageSummary = {
  inputTokens: number
  outputTokens: number
}

// `qa` carries either a real verdict or the reason the QA step was skipped
// as advisory (mastra config gap such as frame_host_not_allowed — a config
// problem, not a content verdict).
export type SmartCropQaSummary = {
  verdict?: SmartCropQaVerdict
  unavailableReason?: string
}

export type SmartCropJobReport = {
  domain: "smart_crop"
  kind: SmartCropKind
  phase: SmartCropPhase
  alignment?: SmartCropAlignmentSummary
  qa?: SmartCropQaSummary
  plan?: SmartCropPlanSummary
  output?: SmartCropOutputSummary
  usage?: SmartCropUsageSummary
}

export type TranslationLanguageResult = {
  lang: string
  status: "completed" | "failed"
  error?: string
}

export type SceneEmbeddingSyncStatus =
  | "source_ready"
  | "skipped_empty"
  | "failed"
  | "unsupported"

export type SceneEmbeddingSyncReport = {
  domain: "scene_embeddings"
  status: SceneEmbeddingSyncStatus
  reason?: string
  generatedSceneCount: number
  indexableSceneCount: number
  skippedEmptySceneIndexes?: number[]
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
  // Live crop-worker render progress (0..1) + human-readable message,
  // written throttled by the smart-crop workflow steps.
  progress?: number
  message?: string
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
