import type {
  AutomationRefreshMode,
  AutomationSchedule,
  AutomationStatus,
  AutomationTemplate,
} from "./types"

const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  "source_subtitles_missing",
  "target_subtitles_missing",
  "metadata_missing",
  "transcript_embeddings_missing",
  "scene_embeddings_missing",
]

const CREATABLE_AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  "source_subtitles_missing",
  "target_subtitles_missing",
  "metadata_missing",
]

const AUTOMATION_STATUSES: readonly AutomationStatus[] = ["active", "paused"]
const AUTOMATION_REFRESH_MODES: readonly AutomationRefreshMode[] = [
  "missing_only",
  "refresh_ai_generated",
]
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

function validateSchedule(value: unknown): string[] {
  if (!isRecord(value)) return ["schedule must be an object"]
  if (
    typeof value.timezone !== "string" ||
    value.timezone.trim().length === 0
  ) {
    return ["schedule.timezone is required"]
  }

  if (value.kind === "every_minute") return []

  if (value.kind === "hourly") {
    return isIntegerInRange(value.minute, 0, 59)
      ? []
      : ["schedule.hourly.minute must be an integer from 0 to 59"]
  }

  if (value.kind === "daily") {
    const errors: string[] = []
    if (!isIntegerInRange(value.hour, 0, 23)) {
      errors.push("schedule.daily.hour must be an integer from 0 to 23")
    }
    if (!isIntegerInRange(value.minute, 0, 59)) {
      errors.push("schedule.daily.minute must be an integer from 0 to 59")
    }
    return errors
  }

  if (value.kind === "weekly") {
    const errors: string[] = []
    if (
      typeof value.weekday !== "string" ||
      !WEEKDAYS.includes(value.weekday as (typeof WEEKDAYS)[number])
    ) {
      errors.push("schedule.weekly.weekday must be a valid weekday")
    }
    if (!isIntegerInRange(value.hour, 0, 23)) {
      errors.push("schedule.weekly.hour must be an integer from 0 to 23")
    }
    if (!isIntegerInRange(value.minute, 0, 59)) {
      errors.push("schedule.weekly.minute must be an integer from 0 to 59")
    }
    return errors
  }

  return ["schedule.kind must be a supported automation schedule"]
}

function normalizeTemplate(value: unknown): AutomationTemplate | null {
  if (
    typeof value === "string" &&
    AUTOMATION_TEMPLATES.includes(value as AutomationTemplate)
  ) {
    return value as AutomationTemplate
  }
  return null
}

function validateTargetLanguageIds(input: {
  template: AutomationTemplate | null
  targetLanguageIds: unknown
}): string[] {
  if (input.targetLanguageIds == null) {
    return input.template === "target_subtitles_missing"
      ? ["target_subtitles_missing requires exactly one target language"]
      : []
  }

  if (
    !Array.isArray(input.targetLanguageIds) ||
    !input.targetLanguageIds.every(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    )
  ) {
    return ["targetLanguageIds must be an array of strings"]
  }

  if (
    input.template === "target_subtitles_missing" &&
    input.targetLanguageIds.length !== 1
  ) {
    return ["target_subtitles_missing requires exactly one target language"]
  }

  return []
}

export function getAutomationValidationErrors(
  data: Record<string, unknown>,
): string[] {
  const errors: string[] = []

  if (typeof data.name !== "string" || data.name.trim().length === 0) {
    errors.push("name is required")
  }

  const template = normalizeTemplate(data.template)
  if (!template) {
    errors.push("template must be a supported automation template")
  } else if (!CREATABLE_AUTOMATION_TEMPLATES.includes(template)) {
    errors.push(
      "Embedding automations are not available until embedding coverage is enabled",
    )
  }

  if (
    typeof data.status !== "string" ||
    !AUTOMATION_STATUSES.includes(data.status as AutomationStatus)
  ) {
    errors.push("status must be active or paused")
  }

  if (
    typeof data.refreshMode !== "string" ||
    !AUTOMATION_REFRESH_MODES.includes(
      data.refreshMode as AutomationRefreshMode,
    )
  ) {
    errors.push("refreshMode must be a supported automation refresh mode")
  }

  errors.push(...validateSchedule(data.schedule))
  errors.push(
    ...validateTargetLanguageIds({
      template,
      targetLanguageIds: data.targetLanguageIds,
    }),
  )

  if (!isIntegerInRange(data.maxVideosPerRun, 1, 100)) {
    errors.push("maxVideosPerRun must be an integer from 1 to 100")
  }

  return errors
}

export function validateAutomationData(data: Record<string, unknown>): boolean {
  return getAutomationValidationErrors(data).length === 0
}

export function assertValidAutomationData(
  data: Record<string, unknown>,
): asserts data is Record<string, unknown> & {
  schedule: AutomationSchedule
} {
  const errors = getAutomationValidationErrors(data)
  if (errors.length > 0) {
    throw new Error(`Invalid enrichment automation: ${errors.join("; ")}`)
  }
}
