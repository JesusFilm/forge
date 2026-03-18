import { formatStepName } from "@/lib/workflow-steps"
import type { JobRecord, StepStatus } from "@/types/job"

export type JobsByDayGroup = {
  dayKey: string
  dayLabel: string
  jobs: JobRecord[]
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

export function getSourceTitle(job: JobRecord): string {
  const muxId = job.muxAssetId?.trim()
  if (muxId) {
    return muxId.length > 20 ? `${muxId.slice(0, 20)}...` : muxId
  }
  return "Untitled source"
}

export function getProgressSummary(job: JobRecord): string {
  if (job.status === "completed") return "Completed"

  const failedStep = job.steps.find((step) => step.status === "failed")
  if (job.status === "failed") {
    return `Failed at ${formatStepName(failedStep?.name ?? job.currentStep ?? "transcription")}`
  }

  if (job.status === "running") {
    return `In progress at ${formatStepName(job.currentStep ?? "transcription")}`
  }

  return "Queued"
}

export function getStepDotSymbol(status: StepStatus): string {
  if (status === "completed") return "\u2713"
  if (status === "failed") return "\u00d7"
  if (status === "skipped") return "\u2212"
  if (status === "running") return "\u2022"
  return ""
}
