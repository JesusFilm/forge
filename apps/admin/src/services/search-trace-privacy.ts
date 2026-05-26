export type SearchTracePrivacyResult = {
  queryText: string
  queryQualityLabel: "empty" | "short" | "normal" | "long"
  sensitiveQueryLabel: SearchTraceSensitiveQueryLabel
  abuseLabel: "none" | "injection_probe" | "spam"
  sampleEligible: boolean
}

type SearchTraceSensitiveQueryLabel =
  | "none"
  | "email"
  | "phone"
  | "credential"
  | "token"
  | "cookie"
  | "ip"
  | "user_identifier"
  | "mixed"

type ConcreteSensitiveQueryLabel = Exclude<
  SearchTraceSensitiveQueryLabel,
  "none" | "mixed"
>

const MAX_QUERY_TEXT_LENGTH = 1024
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g
const CREDENTIAL_RE =
  /\b(?:password|passwd|pwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|token|bearer)\s*(?::|=|\s+)\S+/gi
const BEARER_TOKEN_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g
const TOKEN_RE =
  /\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g
const COOKIE_RE =
  /\b(?:cookie|set-cookie)\s*[:=]\s*[^;\s=]+=[^;\s]+(?:\s*;\s*[^;\s=]+=[^;\s]+){0,8}|\b(?:session(?:id)?|session_id|sid|cf_clearance|jwt|authorization|auth(?:entication)?|access[_-]?token|refresh[_-]?token)\s*=\s*[^;\s]{6,}/gi
const IPV4_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g
const USER_IDENTIFIER_RE =
  /\b(?:user[_-]?id|userid|uid|account[_-]?id|subject|sub)\s*(?::|=|\s+)[A-Za-z0-9][A-Za-z0-9._-]{5,}\b/gi
const INJECTION_RE = /(?:<\s*script\b|drop\s+table|union\s+select)/gi
const SPAM_RE = /\b(?:spam|scam)\b(?:\W+\b(?:spam|scam)\b){2,}/gi

function normalizeQueryText(query: string): string {
  return query.replace(/\s+/g, " ").trim()
}

function classifyQuality(
  query: string,
): SearchTracePrivacyResult["queryQualityLabel"] {
  if (query.length === 0) return "empty"
  if (query.length < 3) return "short"
  if (query.length > 160) return "long"
  return "normal"
}

function uniqueLabels<T extends string>(labels: T[]): T[] {
  return Array.from(new Set(labels))
}

function hasMatch(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0
  const matched = pattern.test(value)
  pattern.lastIndex = 0
  return matched
}

function sensitiveLabel(
  labels: ConcreteSensitiveQueryLabel[],
): SearchTraceSensitiveQueryLabel {
  const unique = uniqueLabels(labels)
  if (unique.length === 0) return "none"
  if (unique.length === 1) return unique[0]
  return "mixed"
}

function truncateQueryText(query: string): string {
  if (query.length <= MAX_QUERY_TEXT_LENGTH) return query
  return query.slice(0, MAX_QUERY_TEXT_LENGTH)
}

export function classifySearchTraceQuery(
  query: string,
): SearchTracePrivacyResult {
  const normalized = normalizeQueryText(query)
  const sensitiveLabels: ConcreteSensitiveQueryLabel[] = []
  let redacted = normalized

  if (hasMatch(EMAIL_RE, redacted)) sensitiveLabels.push("email")
  redacted = redacted.replace(EMAIL_RE, "[redacted-email]")

  if (hasMatch(BEARER_TOKEN_RE, redacted)) sensitiveLabels.push("token")
  redacted = redacted.replace(BEARER_TOKEN_RE, "[redacted-token]")

  if (hasMatch(JWT_RE, redacted)) sensitiveLabels.push("token")
  redacted = redacted.replace(JWT_RE, "[redacted-token]")

  if (hasMatch(CREDENTIAL_RE, redacted)) sensitiveLabels.push("credential")
  redacted = redacted.replace(CREDENTIAL_RE, "[redacted-credential]")

  if (hasMatch(COOKIE_RE, redacted)) sensitiveLabels.push("cookie")
  redacted = redacted.replace(COOKIE_RE, "[redacted-cookie]")

  if (hasMatch(USER_IDENTIFIER_RE, redacted)) {
    sensitiveLabels.push("user_identifier")
  }
  redacted = redacted.replace(USER_IDENTIFIER_RE, "[redacted-user-id]")

  if (hasMatch(TOKEN_RE, redacted)) sensitiveLabels.push("token")
  redacted = redacted.replace(TOKEN_RE, "[redacted-token]")

  if (hasMatch(IPV4_RE, redacted)) sensitiveLabels.push("ip")
  redacted = redacted.replace(IPV4_RE, "[redacted-ip]")

  if (hasMatch(PHONE_RE, redacted)) sensitiveLabels.push("phone")
  redacted = redacted.replace(PHONE_RE, "[redacted-phone]")

  let abuseLabel: SearchTracePrivacyResult["abuseLabel"] = "none"
  if (hasMatch(INJECTION_RE, redacted)) {
    abuseLabel = "injection_probe"
    redacted = redacted.replace(INJECTION_RE, "[redacted-abuse]")
  } else if (hasMatch(SPAM_RE, redacted)) {
    abuseLabel = "spam"
  }

  const sensitiveQueryLabel = sensitiveLabel(sensitiveLabels)
  const sampleEligible =
    sensitiveQueryLabel === "none" &&
    abuseLabel === "none" &&
    normalized.length > 0

  return {
    queryText: truncateQueryText(redacted),
    queryQualityLabel: classifyQuality(normalized),
    sensitiveQueryLabel,
    abuseLabel,
    sampleEligible,
  }
}
