/**
 * Selecting a recommended item (feat-516). The selection mutation binds a
 * fresh claim nonce to the item; the playback recorder redeems that nonce
 * when the video opens, so the resulting episode is attributed to this slate.
 *
 * The pending claim is stored BEFORE the mutation is sent and the caller may
 * navigate as soon as the promise settles: a slow or failed selection must
 * never keep the viewer from watching what they tapped.
 */
import type {
  UserRecommendationItem,
  UserRecommendationSlate,
} from "./delivery"
import { toRecommendationClientError } from "./errors"
import {
  RECOMMENDATION_EVIDENCE_CONTRACT,
  SELECT_RECOMMENDATION,
} from "./operations"
import { randomClaimNonce, randomEventId } from "./random"
import { reportRecommendationEvidence } from "./telemetry"
import { SELECTION_DEADLINE_MS, mutateWithDeadline } from "./transport"
import type {
  RecommendationIdentity,
  ViewerIdentityResult,
} from "./viewerIdentity"
import { viewerIdentityBridge } from "./viewerIdentityClient"

/** A selection older than this no longer explains a playback. */
export const PENDING_CLAIM_TTL_MS = 10 * 60 * 1_000

/**
 * Only these receipt statuses bind the nonce. Admin's status is a plain
 * string, so an unknown value is NOT acknowledged; the recorder's claim
 * attempt decides, exactly as for a conflict.
 */
export const ACKNOWLEDGED_SELECTION_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "replay",
])

export type PendingRecommendationClaim = {
  mediaId: string
  claimNonce: string
  selectedAt: number
}

export type PendingClaimStore = ReturnType<typeof createPendingClaimStore>

/** Holds at most one claim; a take consumes it, so it is redeemed once. */
export function createPendingClaimStore(now: () => number = Date.now) {
  let pending: PendingRecommendationClaim | null = null
  const fresh = (claim: PendingRecommendationClaim) =>
    now() - claim.selectedAt < PENDING_CLAIM_TTL_MS
  return {
    set(claim: PendingRecommendationClaim): void {
      pending = claim
    },
    /** The nonce for this media, or null; consumed on a hit. */
    take(mediaId: string): string | null {
      if (!pending) return null
      if (!fresh(pending)) {
        pending = null
        return null
      }
      if (pending.mediaId !== mediaId) return null
      const nonce = pending.claimNonce
      pending = null
      return nonce
    },
    /**
     * Puts a taken nonce back after an abandoned claim. A newer selection,
     * for any media, outranks it: the viewer has moved on.
     */
    restore(claim: PendingRecommendationClaim): void {
      if (pending && fresh(pending)) return
      pending = claim
    },
    peek(): PendingRecommendationClaim | null {
      return pending && fresh(pending) ? pending : null
    },
    clear(): void {
      pending = null
    },
  }
}

let pendingClaims: PendingClaimStore | null = null

export function getPendingClaimStore(): PendingClaimStore {
  pendingClaims ??= createPendingClaimStore()
  return pendingClaims
}

export type SelectionVariables = {
  contractVersion: string
  capability: string
  requestId: string
  itemId: string
  viewerToken: string
  sessionToken: string
  eventId: string
  occurredAt: string
  claimNonce: string
}

/** No `tabDigest`: that correlates browser tabs, which a phone has none of. */
export function buildSelectionVariables(
  identity: RecommendationIdentity,
  slate: Pick<UserRecommendationSlate, "requestId">,
  item: Pick<UserRecommendationItem, "id" | "capability">,
  event: { eventId: string; occurredAt: string; claimNonce: string },
): SelectionVariables {
  return {
    contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
    capability: item.capability,
    requestId: slate.requestId,
    itemId: item.id,
    viewerToken: identity.viewerToken,
    sessionToken: identity.sessionToken,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    claimNonce: event.claimNonce,
  }
}

export type SelectionReceipt = {
  status: string
  claimNonce: string | null
  canonicalHref: string
  targetMediaId: string
}

export type SelectionDeps = {
  getIdentity: () => Promise<ViewerIdentityResult>
  send: (variables: SelectionVariables) => Promise<SelectionReceipt>
  invalidateIdentity: () => Promise<void>
  touch: () => void
  pendingClaims: PendingClaimStore
  now?: () => number
  claimNonce?: () => string
  eventId?: (kind: string, itemId: string) => string
  report?: (kind: string, outcome: string) => void
}

export type SelectionResult = {
  videoSlug: string
  targetMediaId: string
  claimNonce: string
  /** False when the selection was not acknowledged; playback still opens. */
  acknowledged: boolean
}

export async function selectRecommendation(
  slate: Pick<UserRecommendationSlate, "requestId">,
  item: Pick<
    UserRecommendationItem,
    "id" | "capability" | "targetMediaId" | "videoSlug"
  >,
  deps: SelectionDeps,
): Promise<SelectionResult> {
  const report = deps.report ?? reportRecommendationEvidence
  const now = deps.now ?? Date.now
  const claimNonce = (deps.claimNonce ?? randomClaimNonce)()
  const result: SelectionResult = {
    videoSlug: item.videoSlug,
    targetMediaId: item.targetMediaId,
    claimNonce,
    acknowledged: false,
  }
  deps.pendingClaims.set({
    mediaId: item.targetMediaId,
    claimNonce,
    selectedAt: now(),
  })
  const identity = await deps.getIdentity()
  if (identity.kind !== "ready") {
    report("selection", "skipped")
    return result
  }
  try {
    const receipt = await deps.send(
      buildSelectionVariables(identity.identity, slate, item, {
        eventId: (deps.eventId ?? randomEventId)("selection", item.id),
        occurredAt: new Date(now()).toISOString(),
        claimNonce,
      }),
    )
    deps.touch()
    // A conflict means this event id already exists with different content;
    // the binding is not ours to rely on. The pending claim stays, and the
    // recorder's claim attempt decides (a rejected nonce falls back to a
    // playback context).
    if (!ACKNOWLEDGED_SELECTION_STATUSES.has(receipt.status)) {
      report(
        "selection",
        receipt.status === "conflict" ? "conflict" : "unacknowledged",
      )
      return result
    }
    // Admin's answer is the binding the claim will be checked against; a
    // replayed selection can carry an earlier nonce, so prefer the receipt.
    if (
      typeof receipt.claimNonce === "string" &&
      receipt.claimNonce.length >= 16 &&
      receipt.claimNonce !== claimNonce
    ) {
      deps.pendingClaims.set({
        mediaId: item.targetMediaId,
        claimNonce: receipt.claimNonce,
        selectedAt: now(),
      })
      result.claimNonce = receipt.claimNonce
    }
    report("selection", "sent")
    return { ...result, acknowledged: true }
  } catch (error) {
    const failure = toRecommendationClientError(error)
    if (failure.code === "UNAUTHENTICATED") await deps.invalidateIdentity()
    report("selection", failure.code.toLowerCase())
    return result
  }
}

let defaultDeps: SelectionDeps | null = null

export function getSelectionDeps(): SelectionDeps {
  if (!defaultDeps) {
    defaultDeps = {
      ...viewerIdentityBridge(),
      send: async (variables) => {
        const data = await mutateWithDeadline(
          SELECT_RECOMMENDATION,
          variables,
          SELECTION_DEADLINE_MS,
        )
        return data.selectSemanticRecommendation
      },
      pendingClaims: getPendingClaimStore(),
    }
  }
  return defaultDeps
}
