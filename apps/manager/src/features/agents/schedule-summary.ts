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

function getLocalParts(date: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date)

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

function localTimeToUtc(local: LocalDateTime, timeZone: string): Date {
  const desired = localTimeValue(local)
  let candidate = new Date(desired)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localTimeValue(getLocalParts(candidate, timeZone))
    const delta = actual - desired
    if (delta === 0) return candidate
    candidate = new Date(candidate.getTime() - delta)
  }

  return candidate
}

function localWeekday(local: LocalDateTime): number {
  return new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()
}

function ensureFuture(candidate: Date, from: Date, add: () => Date): Date {
  if (candidate > from) return candidate
  return add()
}

export function computeNextRunAt(
  schedule: AutomationSchedule,
  from = new Date(),
): Date {
  const timeZone = normalizeTimeZone(schedule.timezone)
  const fromLocal = getLocalParts(from, timeZone)

  if (schedule.kind === "every_minute") {
    const next = new Date(from)
    next.setUTCSeconds(0, 0)
    next.setUTCMinutes(next.getUTCMinutes() + 1)
    return next
  }

  if (schedule.kind === "hourly") {
    const local = { ...fromLocal, minute: schedule.minute }
    const next = localTimeToUtc(local, timeZone)
    return ensureFuture(next, from, () =>
      localTimeToUtc(addLocalTime(local, { hours: 1 }), timeZone),
    )
  }

  if (schedule.kind === "daily") {
    const local = {
      ...fromLocal,
      hour: schedule.hour,
      minute: schedule.minute,
    }
    const next = localTimeToUtc(local, timeZone)
    return ensureFuture(next, from, () =>
      localTimeToUtc(addLocalTime(local, { days: 1 }), timeZone),
    )
  }

  const local = {
    ...fromLocal,
    hour: schedule.hour,
    minute: schedule.minute,
  }
  const daysUntil =
    (WEEKDAY_INDEX[schedule.weekday] - localWeekday(local) + 7) % 7
  const nextLocal = addLocalTime(local, { days: daysUntil })
  const next = localTimeToUtc(nextLocal, timeZone)

  return ensureFuture(next, from, () =>
    localTimeToUtc(addLocalTime(nextLocal, { days: 7 }), timeZone),
  )
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
