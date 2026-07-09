// Job types — copied verbatim from the original VideoForge repo.
// Forge extension: muxPlaybackId added to JobRecord (stored at job creation).
// Forge uses a subset of the VideoForge workflow steps but keeps the full union
// so the original UI components compile unchanged.

export type JobStatus = "pending" | "running" | "completed" | "failed"

import type {
  SubtitleValidationBasis,
  SubtitleValidationLanguageSummary,
  SubtitleValidationStepSummary,
  SubtitleValidationVerdict,
} from "@/lib/subtitle-validation"
import type { TranscriptScriptureCorrectionStepSummary } from "@/lib/transcript-scripture-correction"

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

export const WORKFLOW_STEP_NAMES = [
  "download_video",
  "transcription",
  "structured_transcript",
  "subtitle_post_process",
  "chapters",
  "metadata",
  "embeddings",
  "translation",
  "audio_cleanup",
  "voiceover",
  "artifact_upload",
  "mux_upload",
  "theology_validation_bible_quotes",
  "seo_improvements",
  "cms_notify",
  "smart_crop_fingerprint",
  "smart_crop_plan",
  "smart_crop_align",
  "smart_crop_preview_render",
  "smart_crop_qa",
  "smart_crop_render",
  "smart_crop_mux_output",
  "shorts_prepare",
  "shorts_render",
  "shorts_mux_output",
] as const

export type WorkflowStepName = (typeof WORKFLOW_STEP_NAMES)[number]

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

// Job options discriminator for Shorts Studio jobs (plan 2026-06-11-002).
// `assetId` is the per-short storage-key prefix ("{muxAssetId}-short-{suffix}",
// plan decision 1) — shorts artifacts live under this id, NOT the job's
// muxAssetId. `language.whisper` is the pre-resolved whisper ISO-639-1 code
// (null = unsupported → worker skips transcription with the
// transcription_unsupported_language annotation).
export type ShortsJobOptions = {
  assetId: string
  sourceMuxAssetId: string
  sourcePlaybackId: string
  sourceCoreId?: string
  sourceSlug?: string
  sourceTitle?: string
  clip: { startSec: number; endSec: number }
  language: { bcp47: string | null; whisper: string | null }
  requestedBy?: string
}

export interface JobOptions {
  generateVoiceover?: boolean
  uploadMux?: boolean
  notifyCms?: boolean
  smartCrop?: SmartCropJobOptions
  shorts?: ShortsJobOptions
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

export type SmartCropAttemptsSummary = {
  latestAttemptIndex: number
  selectedAttemptIndex?: number
  maxRepairAttempts: number
  repairCount: number
  manifestDigest?: string
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
  attempts?: SmartCropAttemptsSummary
  output?: SmartCropOutputSummary
  usage?: SmartCropUsageSummary
}

// ---------------------------------------------------------------------------
// Shorts Studio metadata artifact entry (plan 2026-06-11-002 decision 2):
// the `shorts` metadata artifact entry is the UI/API source of truth for the
// shorts phase state machine — JobStatus stays closed. Single-writer rule:
// workflows own all phase transitions; routes only set launching intents.
// ---------------------------------------------------------------------------

export type ShortsPhase =
  | "queued"
  | "preparing"
  | "ready_for_review"
  | "rendering"
  | "mux_processing"
  | "completed"
  | "prepare_failed"
  | "render_failed"

export type ShortsJobReport = {
  domain: "shorts"
  phase: ShortsPhase
  // transcription_skipped_no_audio | transcription_unsupported_language
  // (worker-defined annotation literals — kept open as string for forward
  // compatibility with new worker annotations).
  annotation: string | null
  hasAudio: boolean | null
  clipDurationSec: number | null
  captionsCount: number | null
  // Current draft artifact version (0 = no draft written yet).
  draftVersion: number
  lastRenderedDraftVersion: number | null
  lastRenderedPropsHash: string | null
  output: {
    muxAssetId: string | null
    playbackId: string | null
    ready: boolean
  }
  updatedAt: string
}

export type TranslationLanguageResult = {
  lang: string
  status: "completed" | "failed"
  error?: string
}

export type {
  SubtitleValidationBasis,
  SubtitleValidationLanguageSummary,
  SubtitleValidationStepSummary,
  SubtitleValidationVerdict,
}

export type MastraStepCorrelation = {
  runId: string
  status?: string
  reason?: string
  retryable?: boolean
  provider?: string
  model?: string
  chunks?: number
  totalTokens?: number
  sourceContentHash?: string
  languages?: string[]
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
  subtitleValidation?: SubtitleValidationStepSummary
  transcriptCorrection?: TranscriptScriptureCorrectionStepSummary
  mastra?: MastraStepCorrelation
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
