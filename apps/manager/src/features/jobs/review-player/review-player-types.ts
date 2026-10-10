import type {
  MuxSyncComparison,
  SubtitleValidationStepSummary,
} from "@/types/job"
import type { TranscriptScriptureCorrectionStepSummary } from "@/lib/transcript-scripture-correction"

export type ReviewMode = "after" | "before"

export type ReviewTrackSource = "artifact" | "mux" | "cms"

export type ReviewTextTrack = {
  languageCode: string
  label: string
  src: string
  source: ReviewTrackSource
  isGenerated: boolean
}

export type ReviewMetadataValue = {
  title?: string
  description?: string
  tags?: string[]
  topics?: string[]
  speakers?: string[]
  language?: string
}

export type ReviewChapter = {
  title: string
  startSeconds: number
  endSeconds?: number | null
  summary?: string
}

export type ReviewChapterTrack = {
  languageCode: string
  label: string
  src: string
  source: "artifact"
  isGenerated: true
}

export type ReviewSubtitleDomain =
  | {
      status: "available"
      tracks: ReviewTextTrack[]
    }
  | {
      status: "unavailable"
      reason: string
    }
  | {
      status: "failed"
      message: string
    }

export type ReviewMetadataDomain =
  | {
      status: "available"
      value: ReviewMetadataValue
    }
  | {
      status: "unavailable"
      reason: string
    }
  | {
      status: "failed"
      message: string
    }

export type ReviewChaptersDomain =
  | {
      status: "available"
      value: {
        chapters: ReviewChapter[]
        track?: ReviewChapterTrack
      }
    }
  | {
      status: "unavailable"
      reason: string
    }
  | {
      status: "failed"
      message: string
    }

export type ReviewSubtitleValidationArtifact = {
  key: string
  href: string
  languageCode: string
}

export type ReviewSubtitleValidationDomain =
  | {
      status: "available"
      summary: SubtitleValidationStepSummary
      artifacts: ReviewSubtitleValidationArtifact[]
    }
  | {
      status: "unavailable"
      reason: string
    }

export type ReviewTranscriptCorrectionArtifact = {
  key: string
  href: string
  kind: "report" | "raw_transcript" | "raw_subtitles"
}

export type ReviewTranscriptCorrectionDomain =
  | {
      status: "available"
      summary: TranscriptScriptureCorrectionStepSummary
      artifacts: ReviewTranscriptCorrectionArtifact[]
    }
  | {
      status: "unavailable"
      reason: string
    }

export type JobReviewSnapshot = {
  subtitles: ReviewSubtitleDomain
  metadata: ReviewMetadataDomain
  chapters: ReviewChaptersDomain
  validation?: ReviewSubtitleValidationDomain
  transcriptCorrection?: ReviewTranscriptCorrectionDomain
}

export type JobReviewContext = {
  playbackUrl: string
  before: JobReviewSnapshot
  after: JobReviewSnapshot
  compare: {
    muxSyncComparison?: MuxSyncComparison
  }
}

export type JobReviewContextResult =
  | {
      status: "ready"
      context: JobReviewContext
    }
  | {
      status: "unsupported"
      message: string
    }
  | {
      status: "failed"
      message: string
    }

export type ReviewLanguageOption = {
  code: string
  label: string
  beforeAvailable: boolean
  afterAvailable: boolean
}

export type ReviewPlayerReadyState = {
  status: "ready" | "loaded_empty"
  mode: ReviewMode
  language: string | null
  languages: ReviewLanguageOption[]
  player: {
    src: string
    track: ReviewTextTrack | null
    chapterTrack: ReviewChapterTrack | null
    emptyMessage?: string
  }
  metadata: ReviewMetadataDomain
  chapters: ReviewChaptersDomain
  compare: JobReviewContext["compare"]
}

export type ReviewPlayerState =
  | ReviewPlayerReadyState
  | {
      status: "unsupported"
      message: string
    }
  | {
      status: "failed"
      message: string
    }
