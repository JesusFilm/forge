import type { AutomationSchedule } from "./automation-contract"

const WEEKDAY_LABELS: Record<
  Extract<AutomationSchedule, { kind: "weekly" }>["weekday"],
  string
> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
}

const WEEKDAY_INDEX: Record<
  Extract<AutomationSchedule, { kind: "weekly" }>["weekday"],
  number
> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

type LocalDateTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function formatTime(hour: number, minute: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)))
}

function normalizeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date())
    return timeZone
  } catch {
    return "UTC"
  }
}

function getLocalParts(
  date: Date,
  formatter: Intl.DateTimeFormat,
): LocalDateTime {
  const parts = formatter.formatToParts(date)

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  )

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  }
}

function localTimeValue(local: LocalDateTime): number {
  return Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    0,
    0,
  )
}

function addLocalTime(
  local: LocalDateTime,
  input: { hours?: number; days?: number },
): LocalDateTime {
  const date = new Date(localTimeValue(local))
  date.setUTCHours(date.getUTCHours() + (input.hours ?? 0))
  date.setUTCDate(date.getUTCDate() + (input.days ?? 0))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }
}

function localTimeToUtc(
  local: LocalDateTime,
  formatter: Intl.DateTimeFormat,
): Date[] {
  const desired = localTimeValue(local)
  const offsets = new Set<number>()
  // Sample both sides of transitions, including half-hour DST changes and a
  // skipped calendar day. Validate every resulting instant by round trip:
  // gaps have no matches; folds can have two. Never guess a gap's UTC offset.
  for (const hours of [-36, 0, 36]) {
    const instant = desired + hours * 3_600_000
    offsets.add(
      localTimeValue(getLocalParts(new Date(instant), formatter)) - instant,
    )
  }
  return [...offsets]
    .map((offset) => new Date(desired - offset))
    .filter(
      (candidate) =>
        localTimeValue(getLocalParts(candidate, formatter)) === desired,
    )
    .sort((a, b) => a.getTime() - b.getTime())
}

function localWeekday(local: LocalDateTime): number {
  return new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()
}

export function computeNextRunAt(
  schedule: AutomationSchedule,
  from = new Date(),
): Date {
  const timeZone = normalizeTimeZone(schedule.timezone)

  if (schedule.kind === "every_minute") {
    const next = new Date(from)
    next.setUTCSeconds(0, 0)
    next.setUTCMinutes(next.getUTCMinutes() + 1)
    return next
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
  const fromLocal = getLocalParts(from, formatter)
  const increment =
    schedule.kind === "hourly"
      ? { hours: 1 }
      : { days: schedule.kind === "daily" ? 1 : 7 }
  let local = {
    ...fromLocal,
    hour: schedule.kind === "hourly" ? fromLocal.hour : schedule.hour,
    minute: schedule.minute,
  }
  if (schedule.kind === "weekly") {
    local = addLocalTime(local, {
      days: (WEEKDAY_INDEX[schedule.weekday] - localWeekday(local) + 7) % 7,
    })
  }

  // Skip nonexistent wall-clock occurrences rather than shifting the requested
  // hour/minute. Every return is strictly future, including the second fold.
  while (true) {
    const next = localTimeToUtc(local, formatter).find(
      (candidate) => candidate > from,
    )
    if (next) return next
    local = addLocalTime(local, increment)
  }
}

export function formatScheduleSummary(schedule: AutomationSchedule): string {
  switch (schedule.kind) {
    case "every_minute":
      return "Every minute"
    case "hourly":
      return `Hourly at :${String(schedule.minute).padStart(2, "0")}`
    case "daily":
      return `Daily at ${formatTime(schedule.hour, schedule.minute)}`
    case "weekly":
      return `Weekly on ${WEEKDAY_LABELS[schedule.weekday]} at ${formatTime(
        schedule.hour,
        schedule.minute,
      )}`
  }
}
