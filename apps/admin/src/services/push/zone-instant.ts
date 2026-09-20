/**
 * The absolute instant on which a campaign's local hour falls in one zone.
 *
 * `Intl.DateTimeFormat` is the only zone database the runtime carries, so the
 * offset is read by formatting a guess and comparing it with the wall time we
 * want. A skipped hour rounds forward to the first valid instant; a repeated
 * hour takes its first occurrence.
 */
import { PushInputError, PushUnknownTimeZoneError } from "./errors"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    throw new PushUnknownTimeZoneError(timeZone)
  }
  formatters.set(timeZone, formatter)
  return formatter
}

type WallParts = Readonly<{
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}>

function wallPartsAt(timeZone: string, instant: Date): WallParts {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value
    return value ? Number(value) : 0
  }
  const era = parts.find((part) => part.type === "era")?.value
  const year = read("year")
  return {
    // A BC year counts backwards; no push campaign reaches one, and the sign
    // keeps the comparison below monotonic if one ever did.
    year: era === "B" || era === "BC" ? 1 - year : year,
    month: read("month"),
    day: read("day"),
    // Some ICU builds render midnight as hour 24 under hour12: false.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  }
}

/** The wall clock as if it were UTC, so two wall times can be subtracted. */
function wallAsUtc(parts: WallParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
}

function offsetAt(timeZone: string, instant: number): number {
  // The formatter stops at the second, so the instant does too. Otherwise a
  // millisecond remainder lands in the offset and the scan below never
  // recognises two instants as sharing one offset.
  const second = Math.floor(instant / 1000) * 1000
  return wallAsUtc(wallPartsAt(timeZone, new Date(second))) - second
}

function parseSendDate(sendDate: string): {
  year: number
  month: number
  day: number
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sendDate)) {
    throw new PushInputError(`The send date ${sendDate} reads year-month-day`)
  }
  const [year, month, day] = sendDate.split("-").map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== sendDate
  ) {
    throw new PushInputError(`The send date ${sendDate} is not a real day`)
  }
  return { year, month, day }
}

/** The first instant at which the zone's offset changes, inside (low, high]. */
function findTransition(
  timeZone: string,
  low: number,
  high: number,
  offsetLow: number,
): number {
  let before = low
  let after = high
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2)
    if (offsetAt(timeZone, middle) === offsetLow) before = middle
    else after = middle
  }
  return after
}

/**
 * KTD11's wave lands on this instant. Returns the UTC instant at which the
 * zone's clock reads `localHour:00` on `sendDate`.
 */
export function resolvePushZoneInstant(input: {
  timeZone: string
  sendDate: string
  localHour: number
}): Date {
  const { timeZone, sendDate, localHour } = input
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    throw new PushInputError(`The local hour ${localHour} is outside the day`)
  }
  const { year, month, day } = parseSendDate(sendDate)
  const target = Date.UTC(year, month - 1, day, localHour)

  // The offsets a day either side bracket any transition near the hour, so
  // the two candidates they produce are the only instants the wall time can
  // sit on.
  const before = target - offsetAt(timeZone, target - DAY_MS)
  const after = target - offsetAt(timeZone, target + DAY_MS)
  const holds = (instant: number) =>
    wallAsUtc(wallPartsAt(timeZone, new Date(instant))) === target

  if (holds(before) && holds(after)) return new Date(Math.min(before, after))
  if (holds(before)) return new Date(before)
  if (holds(after)) return new Date(after)

  // The hour was skipped. The first valid instant is the transition itself,
  // which sits between the two candidates.
  const low = Math.min(before, after)
  const high = Math.max(before, after)
  return new Date(findTransition(timeZone, low, high, offsetAt(timeZone, low)))
}

/** The phone's own calendar day for an instant, as `YYYY-MM-DD`. */
export function resolvePushLocalDay(timeZone: string, instant: Date): string {
  const parts = wallPartsAt(timeZone, instant)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}`
}
