/**
 * Render and impression evidence for a delivered slate (feat-516). Each fact
 * is one fire-and-forget mutation, deduplicated per request, item and kind,
 * carrying the delivery capability the slate arrived with. Impression
 * ELIGIBILITY (50% visible for one continuous second) is the UI's decision;
 * this module only records what the UI has already qualified.
 */
import type {
  UserRecommendationItem,
  UserRecommendationSlate,
} from "./delivery"
import { rateLimitDelayMs, toRecommendationClientError } from "./errors"
import {
  RECOMMENDATION_EVIDENCE_CONTRACT,
  RECORD_RECOMMENDATION_EVIDENCE,
  WATCH_FOR_YOU_SURFACE,
} from "./operations"
import { randomEventId } from "./random"
import { reportRecommendationEvidence } from "./telemetry"
import { EVIDENCE_DEADLINE_MS, mutateWithDeadline } from "./transport"
import type {
  RecommendationIdentity,
  ViewerIdentityResult,
} from "./viewerIdentity"
import { viewerIdentityBridge } from "./viewerIdentityClient"

export type EvidenceKind = "render" | "impression"

export type EvidenceReceipt = { eventId: string; status: string }

export type EvidenceVariables = {
  contractVersion: string
  capability: string
  requestId: string
  itemId: string
  viewerToken: string
  sessionToken: string
  events: Array<{
    eventId: string
    kind: EvidenceKind
    occurredAt: string
    payload: { surfacePolicy: string } | { visibilityPolicy: string }
  }>
}

/** Admin rejects an impression whose visibility policy differs from the
 *  slate's surface version, so both literals are the surface itself. */
export function evidencePayload(
  kind: EvidenceKind,
): EvidenceVariables["events"][number]["payload"] {
  return kind === "impression"
    ? { visibilityPolicy: WATCH_FOR_YOU_SURFACE }
    : { surfacePolicy: WATCH_FOR_YOU_SURFACE }
}

export function buildEvidenceVariables(
  identity: RecommendationIdentity,
  slate: Pick<UserRecommendationSlate, "requestId">,
  item: Pick<UserRecommendationItem, "id" | "capability">,
  kind: EvidenceKind,
  event: { eventId: string; occurredAt: string },
): EvidenceVariables {
  return {
    contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
    capability: item.capability,
    requestId: slate.requestId,
    itemId: item.id,
    viewerToken: identity.viewerToken,
    sessionToken: identity.sessionToken,
    events: [
      {
        eventId: event.eventId,
        kind,
        occurredAt: event.occurredAt,
        payload: evidencePayload(kind),
      },
    ],
  }
}

export type EvidenceLedger = ReturnType<typeof createEvidenceLedger>

/** One fact per request, item and kind for the slate's lifetime. */
export function createEvidenceLedger() {
  const seen = new Set<string>()
  return {
    claim(requestId: string, itemId: string, kind: EvidenceKind): boolean {
      const key = `${requestId}:${itemId}:${kind}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
    size(): number {
      return seen.size
    },
  }
}

export type EvidenceDeps = {
  getIdentity: () => Promise<ViewerIdentityResult>
  send: (variables: EvidenceVariables) => Promise<EvidenceReceipt[]>
  invalidateIdentity: () => Promise<void>
  touch: () => void
  now?: () => number
  eventId?: (kind: EvidenceKind, itemId: string) => string
  report?: (kind: EvidenceKind, outcome: string) => void
  /** Test seam for the single transient retry's backoff. */
  wait?: (ms: number) => Promise<void>
}

export const EVIDENCE_RETRY_BACKOFF_MS = 100

export type EvidenceOutcome =
  | "sent"
  | "duplicate"
  | "skipped"
  | "receipt_invalid"
  | "failed"

const ACCEPTED_STATUSES = new Set(["accepted", "replay", "conflict"])

/**
 * Record one fact. Never throws: the outcome is returned for tests and
 * telemetry, and a failure costs nothing but this one fact.
 */
export async function recordEvidence(
  kind: EvidenceKind,
  slate: Pick<UserRecommendationSlate, "requestId">,
  item: Pick<UserRecommendationItem, "id" | "capability">,
  ledger: EvidenceLedger,
  deps: EvidenceDeps,
): Promise<EvidenceOutcome> {
  const report = deps.report ?? reportRecommendationEvidence
  if (!ledger.claim(slate.requestId, item.id, kind)) return "duplicate"
  const identity = await deps.getIdentity()
  if (identity.kind !== "ready") return "skipped"
  const eventId = (deps.eventId ?? randomEventId)(kind, item.id)
  const occurredAt = new Date((deps.now ?? Date.now)()).toISOString()
  const variables = buildEvidenceVariables(
    identity.identity,
    slate,
    item,
    kind,
    {
      eventId,
      occurredAt,
    },
  )
  const wait =
    deps.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const receipts = await deps.send(variables)
      deps.touch()
      const receipt = receipts.find((entry) => entry.eventId === eventId)
      if (!receipt || !ACCEPTED_STATUSES.has(receipt.status)) {
        report(kind, "receipt_invalid")
        return "receipt_invalid"
      }
      report(kind, "sent")
      return "sent"
    } catch (error) {
      const failure = toRecommendationClientError(error)
      if (failure.code === "UNAUTHENTICATED") await deps.invalidateIdentity()
      if (failure.definitive || attempt === 2) {
        report(kind, failure.code.toLowerCase())
        return "failed"
      }
      // A limited answer retries after the limiter's window, never inside
      // it: a 100 ms retry only spends a second slot of the shared bucket.
      await wait(
        failure.code === "RATE_LIMITED"
          ? rateLimitDelayMs(failure)
          : EVIDENCE_RETRY_BACKOFF_MS,
      )
    }
  }
  return "failed"
}

let defaultDeps: EvidenceDeps | null = null

export function getEvidenceDeps(): EvidenceDeps {
  if (!defaultDeps) {
    defaultDeps = {
      ...viewerIdentityBridge(),
      send: async (variables) => {
        const data = await mutateWithDeadline(
          RECORD_RECOMMENDATION_EVIDENCE,
          variables,
          EVIDENCE_DEADLINE_MS,
        )
        return data.recordSemanticRecommendationEvidence
      },
    }
  }
  return defaultDeps
}
