export type AutomationTemplate =
  | "source_subtitles_missing"
  | "target_subtitles_missing"
  | "metadata_missing"
  | "transcript_embeddings_missing"
  | "scene_embeddings_missing"

export type AutomationStatus = "active" | "paused"

export type AutomationRefreshMode = "missing_only" | "refresh_ai_generated"

export type AutomationRunStatus =
  | "claimed"
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "no_op"

export type AutomationSchedule =
  | { kind: "every_minute"; timezone: string }
  | { kind: "hourly"; minute: number; timezone: string }
  | { kind: "daily"; hour: number; minute: number; timezone: string }
  | {
      kind: "weekly"
      weekday: "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"
      hour: number
      minute: number
      timezone: string
    }

export type ClaimedAutomation = {
  documentId: string
  name: string
  template: AutomationTemplate
  status: AutomationStatus
  schedule: AutomationSchedule
  refreshMode: AutomationRefreshMode
  targetLanguageIds: string[]
  maxVideosPerRun: number
  nextRunAt: string | null
  lastRunAt?: string | null
  lastRunStatus?: AutomationRunStatus | null
  leaseToken?: string | null
  leaseExpiresAt?: string | null
}

export type AutomationRunDispatchResult = {
  status: Exclude<AutomationRunStatus, "claimed" | "running">
  eligibleCount: number
  enqueuedCount: number
  skippedDuplicateCount: number
  errorCount: number
  jobDocumentIds: string[]
  errors: string[]
  summary: string
}
