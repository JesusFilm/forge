import {
  getTranscriptionRoutingReport,
  hasUnresolvedElevenLabsFailure,
} from "@/lib/transcription-routing-report"
import { formatStepName } from "@/lib/workflow-steps"
import type {
  JobRecord,
  JobStatus,
  JobStepState,
  StepStatus,
} from "@/types/job"

export type LanguageBadge = { key: string; text: string }

export type JobsByDayGroup = {
  dayKey: string
  dayLabel: string
  jobs: JobRecord[]
}

const LANGUAGE_FLAG_BY_CODE: Record<string, string> = {
  ar: "🇸🇦",
  de: "🇩🇪",
  en: "🇺🇸",
  es: "🇪🇸",
  fa: "🇮🇷",
  fi: "🇫🇮",
  fr: "🇫🇷",
  he: "🇮🇱",
  hi: "🇮🇳",
  id: "🇮🇩",
  it: "🇮🇹",
  ja: "🇯🇵",
  ko: "🇰🇷",
  nl: "🇳🇱",
  no: "🇳🇴",
  pl: "🇵🇱",
  pt: "🇧🇷",
  ro: "🇷🇴",
  ru: "🇷🇺",
  sv: "🇸🇪",
  th: "🇹🇭",
  tr: "🇹🇷",
  uk: "🇺🇦",
  vi: "🇻🇳",
  zh: "🇨🇳",
}

export function formatTime(iso?: string): string {
  if (!iso) return "n/a"

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}

function formatDayLabel(date: Date, includeYear: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date)
}

export function groupJobsByDay(jobs: JobRecord[]): JobsByDayGroup[] {
  const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const grouped = new Map<string, { date: Date; jobs: JobRecord[] }>()

  for (const job of jobs) {
    const createdDate = new Date(job.createdAt)
    const dayKey = dayKeyFormatter.format(createdDate)
    const existing = grouped.get(dayKey)
    if (existing) {
      existing.jobs.push(job)
      continue
    }
    grouped.set(dayKey, {
      date: createdDate,
      jobs: [job],
    })
  }

  const groups = Array.from(grouped.entries()).map(([dayKey, value]) => ({
    dayKey,
    date: value.date,
    jobs: value.jobs,
  }))

  return groups.map((group, index) => {
    const previous = groups[index - 1]?.date
    const next = groups[index + 1]?.date
    const year = group.date.getFullYear()
    const month = group.date.getMonth()
    const isYearBoundary =
      (previous && previous.getFullYear() !== year) ||
      (next && next.getFullYear() !== year)
    const includeYear = Boolean(isYearBoundary && (month === 11 || month === 0))

    return {
      dayKey: group.dayKey,
      dayLabel: formatDayLabel(group.date, includeYear),
      jobs: group.jobs,
    }
  })
}

function normalizeLanguageLabel(
  value: string,
  languageLabelsById: ReadonlyMap<string, string>,
): string {
  const clean = value.trim()
  if (!clean) return ""

  const resolvedLabel =
    languageLabelsById.get(clean) ??
    languageLabelsById.get(clean.toLowerCase()) ??
    languageLabelsById.get(clean.toUpperCase())
  if (resolvedLabel) return resolvedLabel
  if (/^[a-z]{2,3}(-[a-z]{2})?$/i.test(clean)) {
    return clean.split("-")[0].toUpperCase()
  }
  if (/^[A-Z]{2,4}$/.test(clean) || /^\d+$/.test(clean)) {
    return clean
  }
  return clean
}

function inferLanguageCode(rawValue: string, label: string): string | null {
  const raw = rawValue.trim().toLowerCase()
  const match = raw.match(/^([a-z]{2,3})(?:-[a-z]{2})?$/i)
  if (match?.[1]) return match[1].slice(0, 2).toLowerCase()

  const normalizedLabel = label.trim().toLowerCase()
  if (!normalizedLabel) return null
  if (normalizedLabel.includes("arabic")) return "ar"
  if (normalizedLabel.includes("chinese")) return "zh"
  if (normalizedLabel.includes("dutch")) return "nl"
  if (normalizedLabel.includes("english")) return "en"
  if (normalizedLabel.includes("farsi") || normalizedLabel.includes("persian"))
    return "fa"
  if (normalizedLabel.includes("finnish")) return "fi"
  if (normalizedLabel.includes("french")) return "fr"
  if (normalizedLabel.includes("german")) return "de"
  if (normalizedLabel.includes("hebrew")) return "he"
  if (normalizedLabel.includes("hindi")) return "hi"
  if (normalizedLabel.includes("indonesian")) return "id"
  if (normalizedLabel.includes("italian")) return "it"
  if (normalizedLabel.includes("japanese")) return "ja"
  if (normalizedLabel.includes("korean")) return "ko"
  if (normalizedLabel.includes("norwegian")) return "no"
  if (normalizedLabel.includes("polish")) return "pl"
  if (normalizedLabel.includes("portuguese")) return "pt"
  if (normalizedLabel.includes("romanian")) return "ro"
  if (normalizedLabel.includes("russian")) return "ru"
  if (normalizedLabel.includes("spanish")) return "es"
  if (normalizedLabel.includes("swedish")) return "sv"
  if (normalizedLabel.includes("thai")) return "th"
  if (normalizedLabel.includes("turkish")) return "tr"
  if (normalizedLabel.includes("ukrainian")) return "uk"
  if (normalizedLabel.includes("vietnamese")) return "vi"
  return null
}

export function getLanguageBadges(
  job: JobRecord,
  languageLabelsById: ReadonlyMap<string, string>,
): LanguageBadge[] {
  const source = [
    ...job.languages,
    ...(job.requestedLanguageAbbreviations ?? []),
  ]
  const badges: LanguageBadge[] = []
  const seen = new Set<string>()

  for (const value of source) {
    const label = normalizeLanguageLabel(value, languageLabelsById)
    if (!label) continue
    const code = inferLanguageCode(value, label)
    const flag = code ? LANGUAGE_FLAG_BY_CODE[code] : ""
    const key = label.toLowerCase()
    const dedupeKey = code ? `code:${code}` : `label:${key}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    badges.push({
      key,
      text: flag ? `${flag} ${label}` : label,
    })
  }

  return badges
}

export function getSourceTitle(job: JobRecord): string {
  const collectionTitle = job.sourceCollectionTitle?.trim()
  const mediaTitle = job.sourceMediaTitle?.trim()
  if (collectionTitle && mediaTitle) {
    return `${collectionTitle} — ${mediaTitle}`
  }
  if (collectionTitle) return collectionTitle
  if (mediaTitle) return mediaTitle
  return "Untitled source"
}

export function getDisplayedJobStatus(job: JobRecord): JobStatus {
  if (
    job.status === "completed" &&
    hasUnresolvedElevenLabsFailure(getTranscriptionRoutingReport(job.artifacts))
  ) {
    return "failed"
  }

  return job.status
}

export function getDisplayedStepStatus(
  job: JobRecord,
  step: JobStepState,
): StepStatus {
  if (
    step.name === "transcription" &&
    hasUnresolvedElevenLabsFailure(getTranscriptionRoutingReport(job.artifacts))
  ) {
    return "failed"
  }

  return step.status
}

export function getProgressSummary(job: JobRecord): string {
  const displayedJobStatus = getDisplayedJobStatus(job)
  if (displayedJobStatus === "completed") return "Completed"

  const failedStep = job.steps.find(
    (step) => getDisplayedStepStatus(job, step) === "failed",
  )
  if (displayedJobStatus === "failed") {
    return `Failed at ${formatStepName(failedStep?.name ?? job.currentStep ?? "transcription")}`
  }

  if (displayedJobStatus === "running") {
    return `In progress at ${formatStepName(job.currentStep ?? "download_video")}`
  }

  return "Queued"
}

export function getStepDotSymbol(status: StepStatus): string {
  if (status === "completed") return "✓"
  if (status === "failed") return "×"
  if (status === "skipped") return "−"
  if (status === "running") return "•"
  return ""
}
