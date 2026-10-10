import { z } from "zod"

export const AUTOMATION_TEMPLATES = [
  "source_subtitles_missing",
  "target_subtitles_missing",
  "metadata_missing",
  "transcript_embeddings_missing",
] as const

export type AutomationTemplate = (typeof AUTOMATION_TEMPLATES)[number]

export const CREATABLE_AUTOMATION_TEMPLATES = [
  "source_subtitles_missing",
  "target_subtitles_missing",
  "metadata_missing",
] as const satisfies readonly AutomationTemplate[]

export const AUTOMATION_TEMPLATE_LABELS: Record<AutomationTemplate, string> = {
  source_subtitles_missing: "Source subtitles",
  target_subtitles_missing: "Target subtitles",
  metadata_missing: "Metadata",
  transcript_embeddings_missing: "Transcript embeddings",
}

export type AutomationStatus = "active" | "paused"
export type AutomationRefreshMode = "missing_only" | "refresh_ai_generated"
export type AutomationRunMode = "live" | "dry_run"

export const AUTOMATION_RUN_MODE_LABELS: Record<AutomationRunMode, string> = {
  live: "Live",
  dry_run: "Dry run",
}

export const AUTOMATION_REFRESH_MODE_LABELS: Record<
  AutomationRefreshMode,
  string
> = {
  missing_only: "Missing only",
  refresh_ai_generated: "Refresh AI-generated too",
}

export type AutomationRunStatus =
  | "claimed"
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "no_op"

export type AutomationDryRunReport = {
  kind: "metadata"
  data: {
    runMode: "dry_run"
    automationDocumentId: string
    automationRunDocumentId: string
    template: AutomationTemplate
    refreshMode: AutomationRefreshMode
    targetLanguageIds: string[]
    maxVideosPerRun: number
    eligibleCount: number
    skippedDuplicateCount: number
    wouldEnqueueCount: number
    selectedCandidates: Array<{
      videoDocumentId: string
      coreId: string
      outputOwner: "missing" | "ai" | "human"
      automationKey: string
    }>
    suppressedOperations: string[]
    summary: string
    generatedAt: string
  }
}

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

export type EnrichmentAutomationRun = {
  documentId: string
  status: AutomationRunStatus
  runMode: AutomationRunMode
  scheduledFor: string
  startedAt?: string | null
  finishedAt?: string | null
  eligibleCount: number
  enqueuedCount: number
  skippedDuplicateCount: number
  errorCount: number
  jobDocumentIds: string[]
  errors: string[]
  summary?: string | null
  report?: AutomationDryRunReport | null
}

export type EnrichmentAutomation = {
  documentId: string
  name: string
  template: AutomationTemplate
  status: AutomationStatus
  runMode: AutomationRunMode
  schedule: AutomationSchedule
  scheduleSummary?: string | null
  timezone: string
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastRunStatus?: Exclude<AutomationRunStatus, "claimed" | "running"> | null
  refreshMode: AutomationRefreshMode
  targetLanguageIds: string[]
  maxVideosPerRun: number
  leaseToken?: string | null
  leaseExpiresAt?: string | null
  runs: EnrichmentAutomationRun[]
}

const timezoneSchema = z.string().trim().min(1)

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("every_minute"),
    timezone: timezoneSchema,
  }),
  z.object({
    kind: z.literal("hourly"),
    minute: z.number().int().min(0).max(59),
    timezone: timezoneSchema,
  }),
  z.object({
    kind: z.literal("daily"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    timezone: timezoneSchema,
  }),
  z.object({
    kind: z.literal("weekly"),
    weekday: z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    timezone: timezoneSchema,
  }),
])

export const automationDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  template: z.enum(AUTOMATION_TEMPLATES),
  runMode: z.enum(["live", "dry_run"]).default("live"),
  refreshMode: z.enum(["missing_only", "refresh_ai_generated"]),
  schedule: automationScheduleSchema,
  targetLanguageIds: z.array(z.string().trim().min(1)).max(20).default([]),
  maxVideosPerRun: z.number().int().min(1).max(100),
})

export type AutomationDraft = z.infer<typeof automationDraftSchema>

export function templateRequiresTargetLanguages(
  template: AutomationTemplate,
): boolean {
  return template === "target_subtitles_missing"
}

export function isCreatableAutomationTemplate(
  template: AutomationTemplate,
): boolean {
  return CREATABLE_AUTOMATION_TEMPLATES.includes(
    template as (typeof CREATABLE_AUTOMATION_TEMPLATES)[number],
  )
}

export type AutomationDraftValidationResult =
  | { success: true; data: AutomationDraft }
  | { success: false; errors: string[] }

export function validateAutomationDraft(
  input: unknown,
  availableLanguageIds?: Iterable<string>,
): AutomationDraftValidationResult {
  const parsed = automationDraftSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    }
  }

  const errors: string[] = []
  const draft = parsed.data

  if (!isCreatableAutomationTemplate(draft.template)) {
    errors.push(
      "Embedding automations are not available until embedding coverage is enabled.",
    )
  }

  if (
    templateRequiresTargetLanguages(draft.template) &&
    draft.targetLanguageIds.length === 0
  ) {
    errors.push("Target languages are required for subtitle automations.")
  }

  if (
    templateRequiresTargetLanguages(draft.template) &&
    draft.targetLanguageIds.length > 1
  ) {
    errors.push("Choose one target language for subtitle automations.")
  }

  if (availableLanguageIds) {
    const available = new Set(availableLanguageIds)
    const missing = draft.targetLanguageIds.filter(
      (languageId) => !available.has(languageId),
    )
    if (missing.length > 0) {
      errors.push(`Unknown target language id(s): ${missing.join(", ")}`)
    }
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, data: draft }
}

export function normalizeTargetLanguageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean),
    ),
  )
}

export function normalizeErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}
