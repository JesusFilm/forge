import type { DatadogTriageServiceProfile } from "../../config/env"
import { datadogAppBaseUrl } from "../../config/env"

import type { TriageAnalysis } from "./analyze"
import type { TriageCandidate, TriageEvidence } from "./detect"
import {
  triageActionDraftSchema,
  TRIAGE_TITLE_MAX_CHARS,
  type TriageActionDraft,
} from "./schema"

/**
 * Ticket drafting (U5, KTD8).
 *
 * Two rules govern this whole module, and they are the reason the deep link
 * and the idempotency marker are assembled AFTER sanitization rather than
 * inside the body text:
 *
 *  1. Datadog-sourced text is untrusted: `safeTriageText` for the body,
 *     `safeTriageTitleText` for the plain-text title.
 *  2. Both deliberately strip URLs and HTML comments — so a link or a marker
 *     routed through either would be destroyed. Both are therefore built from
 *     a trusted template plus validated ids, never extracted from evidence
 *     text.
 */

export const TRIAGE_MARKER_PREFIX = "datadog-triage-key:"

/** Ids safe to interpolate into a Datadog URL path. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u

/** Shared by both sanitizers; `.replace` resets `lastIndex`, so /g is safe. */
const HTML_COMMENT = /<!--[\s\S]*?-->/gu

const BODY_URL_PLACEHOLDER = "[URL omitted]"
/** Bracket-free: the title path removes brackets, which would gut this form. */
const TITLE_URL_PLACEHOLDER = "(URL omitted)"

/**
 * Drop HTML comments (they would forge an idempotency marker) and DELETE
 * format characters. Deleting is the security-relevant half: a zero-width
 * character inside a scheme (`https:<U+200B>//host`) used to survive until the
 * later strip turned it into a SPACE, which broke the URL match and leaked the
 * host and query string as readable text.
 */
function stripInvisibleStructure(value: string): string {
  return value.replace(HTML_COMMENT, " ").replace(/\p{Cf}+/gu, "")
}

/**
 * Replace URLs (they would render as live links to attacker-chosen
 * destinations) and turn real control characters into separators. Runs AFTER
 * `stripInvisibleStructure`, never before.
 */
function neutralizeTriageText(value: string, urlPlaceholder: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/giu, urlPlaceholder)
    .replace(/\p{Cc}+/gu, " ")
}

/**
 * Neutralize untrusted evidence for a Linear body, then escape the markdown
 * metacharacters that could restructure the issue body.
 */
export function safeTriageText(value: string): string {
  return neutralizeTriageText(
    stripInvisibleStructure(value),
    BODY_URL_PLACEHOLDER,
  )
    .replace(/[\\`*_<>#|@]/gu, "\\$&")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replace(/\s+/gu, " ")
    .trim()
}

/** Line terminators `\p{Cc}` misses: U+2028/U+2029 are Zl/Zp, not controls. */
const TITLE_LINE_BREAK = /[\n\r\u2028\u2029]/u

/**
 * Characters that can carry a destination, an identity, or an element. The
 * title replaces them with a space rather than escaping: nothing downstream
 * can render a character that is gone, and no `\` is left for a cut to dangle.
 * `*`, `_` and `#` stay — they can only style, and removing them would mangle
 * the identifiers this field carries.
 */
const TITLE_STRUCTURAL_CHARS = /[\\`<>|@[\]]/gu

/**
 * A title can never exceed 200 characters, and the comment scan is O(k·n) on
 * input with many unclosed `<!--`. Datadog messages are unbounded, so read a
 * generous prefix instead of the whole body.
 */
const TITLE_SOURCE_MAX_CHARS = 4096

/**
 * Neutralize untrusted evidence for a Linear TITLE, a plain-text field. Keeps
 * the first non-blank line, because the rest of a Datadog error message is its
 * stack trace. Blankness is judged AFTER invisible characters are removed, so
 * a leading zero-width line cannot swallow the real message below it.
 */
export function safeTriageTitleText(value: string): string {
  const source = stripInvisibleStructure(value.slice(0, TITLE_SOURCE_MAX_CHARS))
  const firstLine =
    source.split(TITLE_LINE_BREAK).find((line) => line.trim() !== "") ?? ""
  // URL replacement runs before structural removal: dropping `@` first would
  // split `https://user@host/path` and leak the host as plain text.
  return neutralizeTriageText(firstLine, TITLE_URL_PLACEHOLDER)
    .replace(TITLE_STRUCTURAL_CHARS, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

/**
 * First line with visible content, once invisible characters are gone. Used on
 * each title component separately, so one blank component cannot discard the
 * others.
 */
function firstNonBlankLine(value: string | undefined): string {
  if (!value) return ""
  return (
    stripInvisibleStructure(value.slice(0, TITLE_SOURCE_MAX_CHARS))
      .split(TITLE_LINE_BREAK)
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  )
}

/** Accept a word cut only when it loses fewer than this many trailing units. */
const TITLE_WORD_CUT_LOOKBACK = 24
const TITLE_ELLIPSIS = "…"

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** Drop a trailing unpaired high surrogate, which encodes as U+FFFD on the wire. */
function dropDanglingSurrogate(value: string): string {
  return isHighSurrogate(value.charCodeAt(value.length - 1))
    ? value.slice(0, -1)
    : value
}

/**
 * Cut a title subject to `max` UTF-16 units on a word boundary. An unbroken
 * tail (a minified frame, CJK) takes the hard cut rather than lose the line.
 */
function truncateTitleSubject(value: string, max: number): string {
  if (max <= 0) return ""
  if (value.length <= max) return value
  let cut = max - TITLE_ELLIPSIS.length
  const lastSpace = value.lastIndexOf(" ", cut)
  // `lastSpace > 0` is not decoration: without it a no-space subject yields
  // -1, which passes the lookback test and makes `cut` negative.
  if (lastSpace > 0 && lastSpace > cut - TITLE_WORD_CUT_LOOKBACK)
    cut = lastSpace
  const head = dropDanglingSurrogate(value.slice(0, cut)).trimEnd()
  return head.length === 0 ? "" : `${head}${TITLE_ELLIPSIS}`
}

export function triageIdempotencyKey(
  candidate: Pick<TriageCandidate, "signalKind" | "signalId" | "epoch">,
): string {
  return `datadog-triage:${candidate.signalKind}:${candidate.signalId}:${candidate.epoch}`
}

export function triageMarker(idempotencyKey: string): string {
  return `<!-- ${TRIAGE_MARKER_PREFIX}${idempotencyKey} -->`
}

/**
 * Build the one-click deep link the success criterion depends on. Every path
 * segment is a validated id and every query value is encoded, so no evidence
 * text can steer the destination. Returns undefined rather than a guessed URL
 * when an id fails its shape gate.
 */
export function triageDeepLink(input: {
  site: string
  service: string
  evidence: TriageEvidence
  windowStart: string
  windowEnd: string
}): string | undefined {
  const base = datadogAppBaseUrl(input.site)
  if (input.evidence.kind === "issue") {
    if (!SAFE_ID_PATTERN.test(input.evidence.issueId)) return undefined
    return `${base}/error-tracking/issue/${input.evidence.issueId}`
  }
  if (input.evidence.kind === "monitor") {
    if (!SAFE_ID_PATTERN.test(input.evidence.monitorId)) return undefined
    return `${base}/monitors/${input.evidence.monitorId}`
  }
  const fromMs = Date.parse(input.windowStart)
  const toMs = Date.parse(input.windowEnd)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return undefined
  const query = new URLSearchParams({
    query: `service:${input.service}`,
    from_ts: String(fromMs),
    to_ts: String(toMs),
    live: "false",
  })
  return `${base}/logs?${query.toString()}`
}

function evidenceLines(evidence: TriageEvidence): string[] {
  if (evidence.kind === "issue") {
    return [
      `**Signal:** Error Tracking issue \`${safeTriageText(evidence.issueId)}\``,
      `**Error:** ${safeTriageText(evidence.errorType ?? "unknown")} — ${safeTriageText(
        evidence.errorMessage ?? "no message recorded",
      ).slice(0, 500)}`,
      `**Where:** ${safeTriageText(evidence.functionName ?? "unknown function")} in ${safeTriageText(
        evidence.filePath ?? "unknown file",
      ).slice(0, 300)}`,
      `**Occurrences in window:** ${evidence.windowCount} (${evidence.windowRatePerHour.toFixed(2)}/hour)`,
      `**Baseline before this window:** ${evidence.baselineRatePerHour.toFixed(2)}/hour`,
      `**Crash:** ${evidence.isCrash ? "yes" : "no"}`,
      `**Last seen on version:** ${safeTriageText(evidence.lastSeenVersion ?? "unknown")}`,
      evidence.regression
        ? "**Why now:** activity regressed past the configured multiplier of its recorded baseline."
        : "**Why now:** this fingerprint had not been seen before.",
    ]
  }
  if (evidence.kind === "monitor") {
    return [
      `**Signal:** monitor \`${safeTriageText(evidence.monitorId)}\``,
      `**Monitor:** ${safeTriageText(evidence.name ?? "unnamed monitor")}`,
      `**State:** ${safeTriageText(evidence.overallState ?? "unknown")}`,
      `**Episode started:** ${safeTriageText(evidence.episodeStartedAt ?? "unknown")}`,
      "**Why now:** a new alert episode opened for this monitor.",
    ]
  }
  return [
    `**Signal:** activity spike in \`${safeTriageText(evidence.spikeClass)}\``,
    `**Occurrences in window:** ${evidence.windowCount} (${evidence.windowRatePerHour.toFixed(2)}/hour)`,
    `**Trailing baseline:** ${evidence.baselineRatePerHour.toFixed(2)}/hour`,
    "**Why now:** the window cleared the configured multiple of the trailing baseline.",
  ]
}

function candidateTitle(input: {
  analysis: TriageAnalysis
  evidence: TriageEvidence
}): string {
  if (input.evidence.kind === "issue") {
    // Reduce each part to its own first line BEFORE joining. Reducing the
    // joined string instead lets a leading newline in the message cut the
    // title at the seam and throw the message away entirely.
    const errorType = firstNonBlankLine(input.evidence.errorType)
    const message = firstNonBlankLine(input.evidence.errorMessage)
    if (errorType && message) return `${errorType}: ${message}`
    return errorType || message || input.analysis.suspectedArea
  }
  if (input.evidence.kind === "monitor") {
    // `||` not `??`: a whitespace-only name is present but useless.
    return (
      firstNonBlankLine(input.evidence.name) ||
      `Monitor ${input.evidence.monitorId} alerting`
    )
  }
  return `Activity spike in ${input.evidence.spikeClass}`
}

/**
 * R9's Linear conventions: bracketed surface prefix, `[P#]` severity, a
 * Bug-class label, and NO priority or assignee field — those stay a human
 * decision, so the draft simply has nowhere to carry them.
 */
export function buildTriageTicketDraft(input: {
  candidate: TriageCandidate
  analysis: TriageAnalysis
  serviceProfile: DatadogTriageServiceProfile
  site: string
  labelId?: string
}): TriageActionDraft {
  const idempotencyKey = triageIdempotencyKey(input.candidate)
  const prefix = `${input.serviceProfile.surfacePrefix} [${input.analysis.severity}] `
  // Sanitizing can consume every character, and a prefix-only title tells a
  // triager nothing. `suspectedArea` is model text, so keep signalKind last.
  const subject =
    safeTriageTitleText(
      candidateTitle({
        analysis: input.analysis,
        evidence: input.candidate.evidence,
      }),
    ) ||
    safeTriageTitleText(input.analysis.suspectedArea) ||
    input.candidate.signalKind
  // Budget against the prefix so the cut can never eat it. The final slice is
  // a backstop only: an over-length title throws in the schema below, and a
  // withheld candidate would re-fail every hour forever.
  const title = dropDanglingSurrogate(
    `${prefix}${truncateTitleSubject(
      subject,
      TRIAGE_TITLE_MAX_CHARS - prefix.length,
    )}`
      .trimEnd()
      .slice(0, TRIAGE_TITLE_MAX_CHARS),
  )

  const deepLink = triageDeepLink({
    site: input.site,
    service: input.candidate.service,
    evidence: input.candidate.evidence,
    windowStart: input.candidate.windowStart,
    windowEnd: input.candidate.windowEnd,
  })

  const description = [
    "> Filed by the Forge Datadog mobile triage agent. A human owns validation, priority, assignment, and resolution.",
    "",
    "## What fired",
    ...evidenceLines(input.candidate.evidence),
    `**Service:** ${safeTriageText(input.candidate.service)}`,
    `**Window:** ${input.candidate.windowStart} to ${input.candidate.windowEnd}`,
    "",
    "## Agent assessment",
    safeTriageText(input.analysis.summary),
    "",
    `**Classification:** ${input.analysis.classification}`,
    `**Suspected area:** ${safeTriageText(input.analysis.suspectedArea)}`,
    `**Confidence:** ${input.analysis.confidence.toFixed(2)}`,
    `**Actionability:** ${input.analysis.actionability.toFixed(2)}`,
    "",
    "## Verify in Datadog",
    // Built from the trusted template above — never routed through the
    // sanitizer, which strips URLs.
    deepLink ?? "No deep link could be built for this signal.",
    "",
    triageMarker(idempotencyKey),
  ].join("\n")

  return triageActionDraftSchema.parse({
    idempotencyKey,
    service: input.candidate.service,
    signalKind: input.candidate.signalKind,
    signalId: input.candidate.signalId,
    epoch: input.candidate.epoch,
    title,
    description: description.slice(0, 12_000),
    labelId: input.labelId,
  })
}
