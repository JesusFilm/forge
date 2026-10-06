import { timingSafeEqual } from "node:crypto"
import { env } from "@/env"
import {
  readWatchPublicObservationHours,
  watchPublicObservationHour,
} from "@/lib/recommendation-public-observation"

export const dynamic = "force-dynamic"
export const revalidate = 0

const HOUR_MS = 3_600_000
const MAX_HOURS = 35 * 24
const UTC_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/
const JSON_HEADERS = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
}

function error(status: number, reason: string) {
  return new Response(JSON.stringify({ reason }), {
    status,
    headers: JSON_HEADERS,
  })
}

function authorized(request: Request): boolean {
  const secret = env.WATCH_RECOMMENDATION_MEASUREMENT_API_KEY
  if (!secret || secret.length < 32) return false
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ") || header.length > 256) return false
  const supplied = Buffer.from(header.slice(7), "utf8")
  const expected = Buffer.from(secret, "utf8")
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  )
}

function parseHour(value: string | null): number | null {
  if (!value || !UTC_HOUR.test(value)) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === value
    ? timestamp
    : null
}

export async function GET(request: Request) {
  if (!authorized(request)) return error(401, "unauthorized")
  const url = new URL(request.url)
  const startParam = url.searchParams.getAll("startHour")
  const endParam = url.searchParams.getAll("endHourExclusive")
  if (startParam.length !== 1 || endParam.length !== 1)
    return error(400, "invalid_range")
  const start = parseHour(startParam[0]!)
  const end = parseHour(endParam[0]!)
  const currentHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS
  if (
    start == null ||
    end == null ||
    end <= start ||
    end - start > MAX_HOURS * HOUR_MS ||
    end > currentHour
  )
    return error(400, "invalid_range")

  const hours = Array.from({ length: (end - start) / HOUR_MS }, (_, index) =>
    watchPublicObservationHour(new Date(start + index * HOUR_MS)),
  )
  const observations = await readWatchPublicObservationHours(hours)
  if (!observations) return error(503, "observation_unavailable")
  const missingHours = observations
    .filter((observation) => observation.counters === null)
    .map((observation) => observation.hour)
  return new Response(
    JSON.stringify({
      contractVersion: "watch-public-measurement-v1",
      observedAt: new Date().toISOString(),
      startHour: startParam[0],
      endHourExclusive: endParam[0],
      requestedHours: hours.length,
      coveredHours: hours.length - missingHours.length,
      missingHours,
      hours: observations,
    }),
    { headers: JSON_HEADERS },
  )
}
