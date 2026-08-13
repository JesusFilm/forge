import type { WatchSearchComparisonResult } from "./typesense-watch-search-comparison.service"

export const SEARCH_TRACE_RULE_LABEL_SOURCE = "rules"
export const SEARCH_TRACE_RULE_LABEL_VERSION = "search-query-labels/v1"

export type SearchTraceQueryQualityLabel =
  | "valid_viewer_intent"
  | "empty_too_short"
  | "navigational"
  | "catalog_lookup"
  | "malformed"
  | "unknown_ambiguous"

export type SearchTraceAbuseLabel =
  | "none"
  | "repeated_spam"
  | "abusive"
  | "prompt_injection_like"

export type SearchTraceSensitiveQueryLabel =
  | "none"
  | "email"
  | "phone"
  | "credential"
  | "token"
  | "cookie"
  | "ip"
  | "user_identifier"
  | "mixed"

export type SearchTracePrivacyResult = {
  queryText: string
  queryQualityLabel: SearchTraceQueryQualityLabel
  sensitiveQueryLabel: SearchTraceSensitiveQueryLabel
  abuseLabel: SearchTraceAbuseLabel
  sampleEligible: boolean
  labelSource: typeof SEARCH_TRACE_RULE_LABEL_SOURCE
  labelVersion: typeof SEARCH_TRACE_RULE_LABEL_VERSION
  labeledAt: Date
}

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
const PROMPT_INJECTION_RE =
  /(?:<\s*script\b|drop\s+table|union\s+select|ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|system\s+prompt|developer\s+message|jailbreak|do\s+anything\s+now|\bDAN\b)/gi
const ABUSIVE_RE =
  /\b(?:kill\s+yourself|i\s+will\s+kill|fuck\s+you|porn|xxx|nude(?:s)?|scam)\b/gi
const URL_OR_DOMAIN_RE =
  /^(?:https?:\/\/|www\.|\/[A-Za-z0-9_-]|[A-Za-z0-9-]+\.[A-Za-z]{2,})(?:\S*)$/i
const ROUTE_LIKE_RE =
  /^\/?(?:watch|search|login|logout|admin|dashboard|api|graphql)(?:[/?#].*)?$/i
const SEARCH_OPERATOR_RE =
  /\b(?:site|filetype|inurl|intitle|cache|related):\S+/i
const SCRIPTURE_REFERENCE_RE =
  /\b(?:genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs|ecclesiastes|song of songs|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation)\s+\d{1,3}(?::\d{1,3})?\b/i
const KNOWN_CATALOG_LOOKUP_RE =
  /\b(?:jesus\s+film|the\s+chosen|bible\s+project|life\s+of\s+jesus|book\s+of\s+john|gospel\s+of\s+(?:john|luke|mark|matthew))\b/i

const VALID_QUERY_LABELS = new Set<SearchTraceQueryQualityLabel>([
  "valid_viewer_intent",
  "empty_too_short",
  "navigational",
  "catalog_lookup",
  "malformed",
  "unknown_ambiguous",
])

const VALID_SENSITIVE_LABELS = new Set<SearchTraceSensitiveQueryLabel>([
  "none",
  "email",
  "phone",
  "credential",
  "token",
  "cookie",
  "ip",
  "user_identifier",
  "mixed",
])

const VALID_ABUSE_LABELS = new Set<SearchTraceAbuseLabel>([
  "none",
  "repeated_spam",
  "abusive",
  "prompt_injection_like",
])

export function isSearchTraceQueryQualityLabel(
  value: string,
): value is SearchTraceQueryQualityLabel {
  return VALID_QUERY_LABELS.has(value as SearchTraceQueryQualityLabel)
}

export function isSearchTraceSensitiveQueryLabel(
  value: string,
): value is SearchTraceSensitiveQueryLabel {
  return VALID_SENSITIVE_LABELS.has(value as SearchTraceSensitiveQueryLabel)
}

export function isSearchTraceAbuseLabel(
  value: string,
): value is SearchTraceAbuseLabel {
  return VALID_ABUSE_LABELS.has(value as SearchTraceAbuseLabel)
}

export function allSearchTraceQueryQualityLabels(): SearchTraceQueryQualityLabel[] {
  return Array.from(VALID_QUERY_LABELS)
}

export function allSearchTraceSensitiveQueryLabels(): SearchTraceSensitiveQueryLabel[] {
  return Array.from(VALID_SENSITIVE_LABELS)
}

export function allSearchTraceAbuseLabels(): SearchTraceAbuseLabel[] {
  return Array.from(VALID_ABUSE_LABELS)
}

function normalizeQueryText(query: string): string {
  return query.replace(/\s+/g, " ").trim()
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

function mostlyPunctuation(query: string): boolean {
  if (query.length === 0) return false
  const punctuation = query.replace(/[\p{L}\p{N}\s]/gu, "").length
  return punctuation / query.length > 0.5
}

function repeatedCharacterRun(query: string): boolean {
  return /(.)\1{8,}/u.test(query)
}

function repeatedTokenSpam(query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (tokens.length < 4) return false

  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return Array.from(counts.values()).some((count) => count >= 4)
}

function tokenCount(query: string): number {
  return query.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length
}

function classifyAbuse(redactedQuery: string): SearchTraceAbuseLabel {
  if (hasMatch(PROMPT_INJECTION_RE, redactedQuery)) {
    return "prompt_injection_like"
  }
  if (repeatedTokenSpam(redactedQuery) || repeatedCharacterRun(redactedQuery)) {
    return "repeated_spam"
  }
  if (hasMatch(ABUSIVE_RE, redactedQuery)) return "abusive"
  return "none"
}

function redactAbuse(query: string, abuseLabel: SearchTraceAbuseLabel): string {
  if (abuseLabel === "prompt_injection_like") {
    return query.replace(PROMPT_INJECTION_RE, "[redacted-abuse]")
  }
  if (abuseLabel === "abusive") {
    return query.replace(ABUSIVE_RE, "[redacted-abuse]")
  }
  return query
}

function classifyQuality(
  normalizedQuery: string,
  redactedQuery: string,
  abuseLabel: SearchTraceAbuseLabel,
): SearchTraceQueryQualityLabel {
  const lower = redactedQuery.toLowerCase()
  if (normalizedQuery.length < 2) return "empty_too_short"
  if (abuseLabel !== "none") return "malformed"
  if (
    hasMatch(URL_OR_DOMAIN_RE, redactedQuery) ||
    hasMatch(ROUTE_LIKE_RE, lower)
  ) {
    return "navigational"
  }
  if (
    hasMatch(SEARCH_OPERATOR_RE, redactedQuery) ||
    mostlyPunctuation(redactedQuery) ||
    /^[{}[\]":,.\s-]+$/.test(redactedQuery)
  ) {
    return "malformed"
  }
  if (
    hasMatch(SCRIPTURE_REFERENCE_RE, redactedQuery) ||
    (tokenCount(redactedQuery) <= 3 &&
      hasMatch(KNOWN_CATALOG_LOOKUP_RE, redactedQuery))
  ) {
    return "catalog_lookup"
  }
  if (redactedQuery.length > 200) return "unknown_ambiguous"
  return "valid_viewer_intent"
}

export function classifySearchTraceQuery(
  query: string,
  now: Date = new Date(),
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

  const abuseLabel = classifyAbuse(redacted)
  redacted = redactAbuse(redacted, abuseLabel)

  const sensitiveQueryLabel = sensitiveLabel(sensitiveLabels)
  const queryQualityLabel = classifyQuality(normalized, redacted, abuseLabel)
  const sampleEligible =
    sensitiveQueryLabel === "none" &&
    abuseLabel === "none" &&
    queryQualityLabel === "valid_viewer_intent"

  return {
    queryText: truncateQueryText(redacted),
    queryQualityLabel,
    sensitiveQueryLabel,
    abuseLabel,
    sampleEligible,
    labelSource: SEARCH_TRACE_RULE_LABEL_SOURCE,
    labelVersion: SEARCH_TRACE_RULE_LABEL_VERSION,
    labeledAt: now,
  }
}

/** JSON-safe, bounded projection for the dedicated comparison endpoint. */
export function projectWatchSearchComparisonResult(
  comparison: WatchSearchComparisonResult,
) {
  const privacy = classifySearchTraceQuery(comparison.input.query)
  const projectSide = (side: WatchSearchComparisonResult["current"]) => {
    if (side.status === "error") return side
    return {
      status: side.status,
      response: {
        query: privacy.queryText,
        results: side.response.results.slice(0, 50).map((result) => ({
          type: result.type,
          id: result.id,
          slug: result.slug,
          title: result.title,
          imageUrl: result.imageUrl,
          playbackId: result.playbackId,
          startSeconds: result.startSeconds,
          score: result.score,
          label: result.label,
          durationSeconds: result.durationSeconds,
          childCount: result.childCount,
          languageSlug: result.languageSlug,
          languageEnglishName: result.languageEnglishName,
          availability: result.availability,
          evidence: result.evidence,
          action: result.action,
          fallback: result.fallback,
        })),
        hasMore: side.response.hasMore,
        nextOffset: side.response.nextOffset,
        searchMode: side.response.searchMode,
        requestId: side.response.requestId,
        degraded: side.response.degraded,
        latencyMs: side.response.latencyMs,
        laneStatuses: side.response.laneStatuses,
        languageInterpretation: side.response.languageInterpretation,
      },
      diagnostics: {
        ...side.diagnostics,
        rankingAnchor:
          side.diagnostics.rankingAnchor == null
            ? null
            : {
                sourceCanonicalVideoId:
                  side.diagnostics.rankingAnchor.sourceCanonicalVideoId,
                matchKind: side.diagnostics.rankingAnchor.matchKind,
              },
        transcriptProjectionRevision:
          side.diagnostics.transcriptProjectionRevision?.toString() ?? null,
      },
    }
  }

  return {
    comparisonId: comparison.comparisonId,
    input: { ...comparison.input, query: privacy.queryText },
    current: projectSide(comparison.current),
    candidate: projectSide(comparison.candidate),
  }
}
