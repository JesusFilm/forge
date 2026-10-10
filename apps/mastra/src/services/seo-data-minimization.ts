import { isIP } from "node:net"

import { parse, type DefaultTreeAdapterTypes } from "parse5"

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const PHONE = /(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/gu
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu
const IPV6_CANDIDATE =
  /\[[0-9A-Fa-f:.]{2,64}\]|(?<![0-9A-Fa-f:.])[0-9A-Fa-f:.]{2,64}(?![0-9A-Fa-f:.])/gu
const SECRET =
  /\b(?:bearer\s+\S+|(?:sk|ghp|github_pat|xox[baprs])-?[a-z0-9_-]{12,}|(?:api[_ -]?key|token|secret|password|cookie)\s*[:=]\s*\S+)/giu
const CANARY = /\b(?:canary|honeytoken)[-_:\w]*/giu
const EMBEDDED_URL = /https?:\/\/[^\s<>"']+/giu
const TOKEN_LIKE = /\b[A-Za-z0-9_-]{40,}\b/gu

const SENSITIVE_KEY =
  /token|secret|password|authorization|cookie|header|credential|api[_-]?key|prompt|rawbody/i

const NON_CONTENT_ELEMENTS = new Set([
  "noscript",
  "script",
  "style",
  "template",
])

function redactIpv6Candidate(value: string): string {
  const bracketed = value.startsWith("[") && value.endsWith("]")
  const candidate = bracketed ? value.slice(1, -1) : value.replace(/\.+$/u, "")
  const suffix = bracketed ? "" : value.slice(candidate.length)
  return isIP(candidate) === 6 ? `[REDACTED_IP]${suffix}` : value
}

function isSensitiveSeoKey(key: string): boolean {
  if (SENSITIVE_KEY.test(key)) return true
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((word) => word.toLowerCase())
  return words.some((word) => word === "ip" || word === "ipaddress")
}

function collectVisibleHtmlText(
  root: DefaultTreeAdapterTypes.Node,
  chunks: string[],
): void {
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node) continue
    if ("tagName" in node && NON_CONTENT_ELEMENTS.has(node.tagName)) continue
    if (node.nodeName === "#text" && "value" in node) chunks.push(node.value)
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index]
        if (child) pending.push(child)
      }
    }
  }
}

export function minimizeSeoText(value: string, maxCharacters = 4_000): string {
  const redacted = value
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(IPV6_CANDIDATE, redactIpv6Candidate)
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

export function minimizeSeoQuery(value: string, maxCharacters = 500): string {
  return minimizeSeoText(
    value
      .replace(EMBEDDED_URL, "[REDACTED_URL]")
      .replace(TOKEN_LIKE, "[REDACTED_TOKEN]"),
    maxCharacters,
  )
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

function minimizeSeoPersistenceUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    url.username = ""
    url.password = ""
    if (minimizeSeoText(url.hostname) !== url.hostname) {
      url.hostname = "redacted.invalid"
    }
    url.pathname = minimizeSeoText(url.pathname)
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
  if (depth > 6) return "[depth_limit]"
  if (typeof value === "string") {
    return minimizeSeoPersistenceUrl(value) ?? minimizeSeoText(value)
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
        .filter(([key]) => !isSensitiveSeoKey(key))
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
  const chunks: string[] = []
  collectVisibleHtmlText(parse(value), chunks)
  return minimizeSeoText(chunks.join(" ").replace(/\s+/gu, " ").trim(), 100_000)
}
