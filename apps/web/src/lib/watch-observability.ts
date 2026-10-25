type WatchServerLogLevel = "warn" | "error"

type WatchServerLogFieldValue =
  | string
  | number
  | boolean
  | Error
  | null
  | undefined

type WatchServerLogFields = Record<string, WatchServerLogFieldValue>

const MAX_LOG_VALUE_LENGTH = 500

function sanitizeToken(value: string, fallback: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "_")
  return sanitized || fallback
}

function sanitizeFieldValue(value: WatchServerLogFieldValue): string | null {
  if (value === null || value === undefined) return null

  const rawValue = value instanceof Error ? value.message : String(value)
  const normalized = rawValue.trim().replace(/\s+/g, "_")
  if (!normalized) return null

  const sanitized = normalized.replace(/["'\\]+/g, "_")
  return sanitized.length > MAX_LOG_VALUE_LENGTH
    ? `${sanitized.slice(0, MAX_LOG_VALUE_LENGTH - 3)}...`
    : sanitized
}

export function formatWatchServerLogLine(
  event: string,
  fields: WatchServerLogFields = {},
): string {
  const parts = [`[watch] event=${sanitizeToken(event, "unknown")}`]

  for (const [key, value] of Object.entries(fields)) {
    const sanitizedValue = sanitizeFieldValue(value)
    if (sanitizedValue === null) continue

    parts.push(`${sanitizeToken(key, "field")}=${sanitizedValue}`)
  }

  return parts.join(" ")
}

export function logWatchServerEvent(
  event: string,
  fields: WatchServerLogFields = {},
  options: { level?: WatchServerLogLevel } = {},
): void {
  const line = formatWatchServerLogLine(event, fields)

  if (options.level === "error") {
    console.error(line)
    return
  }

  console.warn(line)
}
