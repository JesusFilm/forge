const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const PHONE = /(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/gu
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu
const SECRET =
  /\b(?:bearer\s+\S+|(?:api[_ -]?key|token|secret|password|cookie)\s*[:=]\s*\S+)/giu
const CANARY = /\b(?:canary|honeytoken)[-_:\w]*/giu

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "cookies",
  "headers",
  "ip",
  "ipaddress",
  "password",
  "prompt",
  "rawbody",
  "secret",
  "token",
])

export function minimizeSeoText(value: string, maxCharacters = 4_000): string {
  const redacted = value
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(PHONE, "[REDACTED_PHONE]")
    .replace(IPV4, "[REDACTED_IP]")
    .replace(SECRET, "[REDACTED_CREDENTIAL]")
    .replace(CANARY, "[REDACTED_CANARY]")
    .replaceAll("\u0000", "")
  const codepoints = Array.from(redacted)
  return codepoints.length <= maxCharacters
    ? redacted
    : `${codepoints.slice(0, Math.max(0, maxCharacters - 3)).join("")}...`
}

export function minimizeSeoUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return null
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

export function minimizeSeoValue(
  value: unknown,
  options: { depth?: number; maxArray?: number; maxKeys?: number } = {},
): unknown {
  const depth = options.depth ?? 0
  const maxArray = options.maxArray ?? 50
  const maxKeys = options.maxKeys ?? 50
  if (depth > 6) return "[TRUNCATED_DEPTH]"
  if (typeof value === "string") {
    return minimizeSeoUrl(value) ?? minimizeSeoText(value)
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean" || value == null) return value
  if (Array.isArray(value)) {
    return value
      .slice(0, maxArray)
      .map((item) =>
        minimizeSeoValue(item, { depth: depth + 1, maxArray, maxKeys }),
      )
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEYS.has(key.toLowerCase()))
        .slice(0, maxKeys)
        .map(([key, item]) => [
          key,
          minimizeSeoValue(item, { depth: depth + 1, maxArray, maxKeys }),
        ]),
    )
  }
  return null
}

export function normalizeSeoPageText(value: string): string {
  return minimizeSeoText(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
    100_000,
  )
}
