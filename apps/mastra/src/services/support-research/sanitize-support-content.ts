import {
  sanitizedSupportConversationSchema,
  type SanitizedSupportConversation,
} from "./schema"

export type RawSupportConversation = {
  sourceId: string
  mailboxId: string
  createdAt: string
  sourceUrl?: string
  subject: string
  threadBodies: string[]
  truncated?: boolean
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const TOKEN_PATTERN =
  /\b(?:bearer\s+)?(?:sk-[A-Za-z0-9_-]{16,}|[A-F0-9]{32,}|[A-Za-z0-9_-]{40,})\b/giu
const PHONE_CANDIDATE_PATTERN = /(?<!\w)\+?[\d(][\d().\s-]{7,}\d(?!\w)/gu

function decodeCodePoint(value: number, fallback: string): string {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0x10ffff ||
    (value >= 0xd800 && value <= 0xdfff)
  ) {
    return fallback
  }
  return String.fromCodePoint(value)
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  }
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/giu,
    (match, entity: string) => {
      if (entity.startsWith("#x")) {
        const value = Number.parseInt(entity.slice(2), 16)
        return decodeCodePoint(value, match)
      }
      if (entity.startsWith("#")) {
        const value = Number.parseInt(entity.slice(1), 10)
        return decodeCodePoint(value, match)
      }
      return named[entity.toLowerCase()] ?? match
    },
  )
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
      .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/giu, " ")
      .replace(/<\s*br\s*\/?\s*>/giu, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  )
}

function removeQuotedHistoryAndSignature(value: string): string {
  return value
    .replace(
      /(?:^|\n)(?:-{2,}\s*Original Message\s*-{2,}|On .{0,200} wrote:|From:\s*.{0,200}\n)[\s\S]*$/iu,
      "",
    )
    .replace(/(?:^|\n)\s*--\s*\n[\s\S]*$/u, "")
    .replace(/(?:^|\n)Sent from my (?:iPhone|iPad|Android)[\s\S]*$/iu, "")
    .split("\n")
    .filter((line) => !/^\s*>/u.test(line))
    .join("\n")
}

function redact(value: string): { value: string; count: number } {
  let count = 0
  const replace = (replacement: string) => () => {
    count += 1
    return replacement
  }
  const redacted = value
    .replace(EMAIL_PATTERN, replace("[email redacted]"))
    .replace(TOKEN_PATTERN, replace("[token redacted]"))
    .replace(PHONE_CANDIDATE_PATTERN, (candidate) => {
      const digits = candidate.replace(/\D/gu, "")
      if (digits.length < 7 || digits.length > 15) return candidate
      count += 1
      return "[phone redacted]"
    })
  return { value: redacted, count }
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[\t\f\v ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
}

function normalizeWatchUrl(
  candidate: string,
  allowedHosts: ReadonlySet<string>,
): { url: string; redactionCount: number } | undefined {
  try {
    const url = new URL(candidate.replace(/[),.;!?]+$/gu, ""))
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowedHosts.has(url.hostname.toLowerCase())
    ) {
      return
    }
    const redactionCount = [...url.searchParams].length
    url.search = ""
    url.hash = ""
    return { url: url.href, redactionCount }
  } catch {
    return
  }
}

function sanitizeUrls(
  value: string,
  allowedHosts: ReadonlySet<string>,
  watchUrls: Set<string>,
): { value: string; count: number } {
  let count = 0
  return {
    value: value.replace(URL_PATTERN, (candidate) => {
      const normalized = normalizeWatchUrl(candidate, allowedHosts)
      count += 1 + (normalized?.redactionCount ?? 0)
      if (!normalized) return "[URL omitted]"
      if (watchUrls.size < 20) watchUrls.add(normalized.url)
      return normalized.url
    }),
    count,
  }
}

export function sanitizeSupportConversation(input: {
  conversation: RawSupportConversation
  allowedWatchHosts: string[]
  maxCharacters: number
}): SanitizedSupportConversation {
  const allowedHosts = new Set(
    input.allowedWatchHosts.map((host) => host.trim().toLowerCase()),
  )
  const watchUrls = new Set<string>()
  const subjectUrls = sanitizeUrls(
    normalizeWhitespace(
      removeQuotedHistoryAndSignature(htmlToText(input.conversation.subject)),
    ),
    allowedHosts,
    watchUrls,
  )
  const bodyUrls = sanitizeUrls(
    normalizeWhitespace(
      input.conversation.threadBodies
        .map((body) => removeQuotedHistoryAndSignature(htmlToText(body)))
        .filter(Boolean)
        .join("\n\n"),
    ),
    allowedHosts,
    watchUrls,
  )
  const subjectResult = redact(subjectUrls.value)
  const bodyResult = redact(bodyUrls.value)
  const truncated =
    Boolean(input.conversation.truncated) ||
    bodyResult.value.length > input.maxCharacters

  return sanitizedSupportConversationSchema.parse({
    sourceId: input.conversation.sourceId,
    mailboxId: input.conversation.mailboxId,
    createdAt: input.conversation.createdAt,
    sourceUrl: input.conversation.sourceUrl,
    subject: subjectResult.value.slice(0, 300),
    excerpt: bodyResult.value.slice(0, input.maxCharacters).trimEnd(),
    watchUrls: [...watchUrls],
    redactionCount:
      subjectResult.count +
      bodyResult.count +
      subjectUrls.count +
      bodyUrls.count,
    truncated,
  })
}
