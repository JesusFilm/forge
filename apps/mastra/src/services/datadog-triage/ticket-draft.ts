import type { DatadogTriageServiceProfile } from "../../config/env"
import { datadogAppBaseUrl } from "../../config/env"

import type { TriageAnalysis } from "./analyze"
import type { TriageCandidate, TriageEvidence } from "./detect"
import { triageActionDraftSchema, type TriageActionDraft } from "./schema"

/**
 * Ticket drafting (U5, KTD8).
 *
 * Two rules govern this whole module, and they are the reason the deep link
 * and the idempotency marker are assembled AFTER sanitization rather than
 * inside the body text:
 *
 *  1. Datadog-sourced text is untrusted and goes through `safeTriageText`.
 *  2. `safeTriageText` deliberately strips URLs and HTML comments — so a link
 *     or a marker routed through it would be destroyed. Both are therefore
 *     built from a trusted template plus validated ids, never extracted from
 *     evidence text.
 */

export const TRIAGE_MARKER_PREFIX = "datadog-triage-key:"

/** Ids safe to interpolate into a Datadog URL path. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u

/**
 * Neutralize untrusted evidence for a Linear body: drop HTML comments (they
 * would forge an idempotency marker), replace URLs (they would render as live
 * links to attacker-chosen destinations), strip control characters, and escape
 * the markdown metacharacters that could restructure the issue body.
 */
export function safeTriageText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/https?:\/\/[^\s]+/giu, "[URL omitted]")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/[\\`*_<>#|@]/gu, "\\$&")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replace(/\s+/gu, " ")
    .trim()
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
    const errorType = input.evidence.errorType
    const message = input.evidence.errorMessage
    if (errorType && message) return `${errorType}: ${message}`
    return errorType ?? message ?? input.analysis.suspectedArea
  }
  if (input.evidence.kind === "monitor") {
    return input.evidence.name ?? `Monitor ${input.evidence.monitorId} alerting`
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
  const title = `${prefix}${safeTriageText(
    candidateTitle({
      analysis: input.analysis,
      evidence: input.candidate.evidence,
    }),
  )}`.slice(0, 200)

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
