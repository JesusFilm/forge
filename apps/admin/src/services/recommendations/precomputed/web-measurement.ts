import { env } from "@/config/env"

const HOUR_MS = 3_600_000
const MAX_HOURS_PER_READ = 840
const MAX_RESPONSE_BYTES = 2_000_000
export const WEB_WATCH_MEASUREMENT_CONTRACT = "watch-public-measurement-v1"
export const WEB_WATCH_COUNTERS = [
  "delivery_attempt",
  "delivery_excluded",
  "delivery_unknown",
  "delivery_missing_identity",
  "delivery_verification_required",
  "delivery_verification_rejected",
  "delivery_verification_unavailable",
  "delivery_qualified",
  "delivery_inactive",
  "delivery_private",
  "delivery_unavailable",
  "delivery_rejected",
  "click_attempt",
  "click_ack",
  "click_unavailable",
] as const

export type WebWatchCounter = (typeof WEB_WATCH_COUNTERS)[number]
export type WebWatchCounters = Record<WebWatchCounter, number>
export type WebWatchMeasurement = {
  status: "complete" | "incomplete"
  contractVersion: typeof WEB_WATCH_MEASUREMENT_CONTRACT
  startHour: string
  endHourExclusive: string
  observedAt: string
  requestedHours: number
  coveredHours: number
  missingHours: string[]
  imbalancedHours: string[]
  counters: WebWatchCounters
  counterUnit: "web_request_attempts_not_distinct_visits"
}
export type WebWatchMeasurementRead =
  | WebWatchMeasurement
  | { status: "unavailable"; reason: string }

type MeasurementTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>
type ReadOptions = {
  url?: string
  apiKey?: string
  transport?: MeasurementTransport
  now?: Date
}

const terminalDeliveryCounters = WEB_WATCH_COUNTERS.filter(
  (key) => key.startsWith("delivery_") && key !== "delivery_attempt",
)
const HOUR_KEY = /^\d{10}$/

function hourKey(date: Date): string {
  return date.toISOString().slice(0, 13).replaceAll("-", "").replace("T", "")
}

function emptyCounters(): WebWatchCounters {
  return Object.fromEntries(
    WEB_WATCH_COUNTERS.map((key) => [key, 0]),
  ) as WebWatchCounters
}

function isoHour(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(value)
  )
    return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function endpoint(value: string): URL | null {
  try {
    const url = new URL(value)
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith(
        "/watch/api/internal/recommendations/precomputed-measurement",
      ) ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      return null
    return url
  } catch {
    return null
  }
}

type ParsedHour = { hour: string; counters: WebWatchCounters | null }
type ParsedPage = {
  observedAt: string
  requestedHours: number
  coveredHours: number
  missingHours: string[]
  hours: ParsedHour[]
}

function parsePage(
  value: unknown,
  start: Date,
  end: Date,
  now: Date,
): ParsedPage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const expectedKeys = [
    "contractVersion",
    "observedAt",
    "startHour",
    "endHourExclusive",
    "requestedHours",
    "coveredHours",
    "missingHours",
    "hours",
  ]
  if (
    Object.keys(row).sort().join(",") !== expectedKeys.sort().join(",") ||
    row.contractVersion !== WEB_WATCH_MEASUREMENT_CONTRACT ||
    row.startHour !== start.toISOString() ||
    row.endHourExclusive !== end.toISOString() ||
    !isoHour(row.startHour) ||
    !isoHour(row.endHourExclusive) ||
    typeof row.observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.observedAt) ||
    !Number.isFinite(new Date(row.observedAt).getTime()) ||
    new Date(row.observedAt).toISOString() !== row.observedAt ||
    new Date(row.observedAt).getTime() < end.getTime() ||
    now.getTime() - new Date(row.observedAt).getTime() > 5 * 60_000 ||
    new Date(row.observedAt).getTime() > now.getTime() + 60_000 ||
    !Number.isSafeInteger(row.requestedHours) ||
    row.requestedHours !== (end.getTime() - start.getTime()) / HOUR_MS ||
    !Number.isSafeInteger(row.coveredHours) ||
    typeof row.coveredHours !== "number" ||
    row.coveredHours < 0 ||
    !Array.isArray(row.missingHours) ||
    !Array.isArray(row.hours) ||
    row.hours.length !== row.requestedHours
  )
    return null

  const missingHours: string[] = []
  const hours: ParsedHour[] = []
  for (let index = 0; index < row.hours.length; index += 1) {
    const item = row.hours[index]
    if (!item || typeof item !== "object" || Array.isArray(item)) return null
    const hour = item as Record<string, unknown>
    const expectedHour = hourKey(new Date(start.getTime() + index * HOUR_MS))
    if (
      Object.keys(hour).sort().join(",") !== "counters,hour" ||
      hour.hour !== expectedHour ||
      !HOUR_KEY.test(expectedHour)
    )
      return null
    if (hour.counters === null) {
      missingHours.push(expectedHour)
      hours.push({ hour: expectedHour, counters: null })
      continue
    }
    if (
      !hour.counters ||
      typeof hour.counters !== "object" ||
      Array.isArray(hour.counters)
    )
      return null
    const counters = hour.counters as Record<string, unknown>
    const observedKeys = Object.keys(counters)
    if (
      observedKeys.length === 0 ||
      observedKeys.some(
        (key) =>
          !WEB_WATCH_COUNTERS.includes(key as WebWatchCounter) ||
          typeof counters[key] !== "number" ||
          !Number.isSafeInteger(counters[key]) ||
          (counters[key] as number) < 0,
      )
    )
      return null
    hours.push({
      hour: expectedHour,
      counters: { ...emptyCounters(), ...counters } as WebWatchCounters,
    })
  }
  if (
    row.coveredHours !== hours.length - missingHours.length ||
    row.missingHours.length !== missingHours.length ||
    row.missingHours.some((item, index) => item !== missingHours[index])
  )
    return null
  return {
    observedAt: row.observedAt,
    requestedHours: row.requestedHours as number,
    coveredHours: row.coveredHours,
    missingHours,
    hours,
  }
}

/** Read complete UTC hours only. A one-month trial plus late cutoff is split
 * into at most 35-day authenticated reads; missing Redis buckets stay missing. */
export async function loadWebWatchMeasurement(
  startHour: Date,
  endHourExclusive: Date,
  options: ReadOptions = {},
): Promise<WebWatchMeasurementRead> {
  const now = options.now ?? new Date()
  const completedThrough = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS
  if (
    !Number.isFinite(startHour.getTime()) ||
    !Number.isFinite(endHourExclusive.getTime()) ||
    startHour.getTime() % HOUR_MS !== 0 ||
    endHourExclusive.getTime() % HOUR_MS !== 0 ||
    startHour >= endHourExclusive ||
    endHourExclusive.getTime() > completedThrough ||
    !Number.isSafeInteger(
      (endHourExclusive.getTime() - startHour.getTime()) / HOUR_MS,
    )
  )
    return { status: "unavailable", reason: "invalid_hour_window" }
  const url = endpoint(
    options.url ?? env.PRECOMPUTED_WATCH_MEASUREMENT_URL ?? "",
  )
  const apiKey = options.apiKey ?? env.WATCH_RECOMMENDATION_MEASUREMENT_API_KEY
  if (!url || !apiKey || apiKey.length < 32)
    return { status: "unavailable", reason: "measurement_not_configured" }
  const transport = options.transport ?? fetch
  const missingHours: string[] = []
  const imbalancedHours: string[] = []
  const totals = emptyCounters()
  let coveredHours = 0
  let observedAt = new Date(0).toISOString()
  for (
    let pageStart = startHour.getTime();
    pageStart < endHourExclusive.getTime();
  ) {
    const pageEnd = Math.min(
      pageStart + MAX_HOURS_PER_READ * HOUR_MS,
      endHourExclusive.getTime(),
    )
    const start = new Date(pageStart)
    const end = new Date(pageEnd)
    const requestUrl = new URL(url)
    requestUrl.searchParams.set("startHour", start.toISOString())
    requestUrl.searchParams.set("endHourExclusive", end.toISOString())
    let response: Response
    try {
      response = await transport(requestUrl.toString(), {
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(3_000),
      })
    } catch {
      return {
        status: "unavailable",
        reason: "measurement_transport_unavailable",
      }
    }
    if (!response.ok)
      return {
        status: "unavailable",
        reason:
          response.status === 401 || response.status === 403
            ? "measurement_authentication_failed"
            : "measurement_endpoint_unavailable",
      }
    if (
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return { status: "unavailable", reason: "measurement_contract_invalid" }
    let json: unknown
    try {
      const body = await response.text()
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES)
        return { status: "unavailable", reason: "measurement_contract_invalid" }
      json = JSON.parse(body)
    } catch {
      return { status: "unavailable", reason: "measurement_contract_invalid" }
    }
    const page = parsePage(json, start, end, now)
    if (!page)
      return { status: "unavailable", reason: "measurement_contract_invalid" }
    observedAt = page.observedAt > observedAt ? page.observedAt : observedAt
    coveredHours += page.coveredHours
    missingHours.push(...page.missingHours)
    for (const hour of page.hours) {
      if (!hour.counters) continue
      for (const key of WEB_WATCH_COUNTERS) {
        totals[key] += hour.counters[key]
        if (!Number.isSafeInteger(totals[key]))
          return {
            status: "unavailable",
            reason: "measurement_counter_overflow",
          }
      }
      const deliveryTerminals = terminalDeliveryCounters.reduce(
        (sum, key) => sum + hour.counters![key],
        0,
      )
      if (
        hour.counters.delivery_attempt !== deliveryTerminals ||
        hour.counters.click_attempt !==
          hour.counters.click_ack + hour.counters.click_unavailable
      )
        imbalancedHours.push(hour.hour)
    }
    pageStart = pageEnd
  }
  const requestedHours =
    (endHourExclusive.getTime() - startHour.getTime()) / HOUR_MS
  return {
    status:
      missingHours.length || imbalancedHours.length ? "incomplete" : "complete",
    contractVersion: WEB_WATCH_MEASUREMENT_CONTRACT,
    startHour: startHour.toISOString(),
    endHourExclusive: endHourExclusive.toISOString(),
    observedAt,
    requestedHours,
    coveredHours,
    missingHours,
    imbalancedHours,
    counters: totals,
    counterUnit: "web_request_attempts_not_distinct_visits",
  }
}
