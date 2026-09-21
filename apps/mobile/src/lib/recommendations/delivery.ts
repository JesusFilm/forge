/**
 * Source-free slate delivery (feat-516). The pure half validates Admin's answer
 * strictly — the API never returns a normal undersized or wrong-language slate
 * to make a row, so a slate that fails these checks is a fault, not content.
 * The impure half threads the viewer identity and the deadline-bounded query.
 */
import type { AdminResultOf } from "@forge/admin-graphql"

import { validateActionUrl } from "../validateUrl"
import {
  USER_RECOMMENDATIONS,
  USER_RECOMMENDATION_CONTRACT,
  USER_RECOMMENDATION_DEFAULT_COUNT,
  USER_RECOMMENDATION_MAX_COUNT,
  USER_RECOMMENDATION_MIN_COUNT,
  WATCH_FOR_YOU_SURFACE,
} from "./operations"
import { toRecommendationClientError } from "./errors"
import { reportRecommendationDelivery } from "./telemetry"
import { DELIVERY_DEADLINE_MS, queryWithDeadline } from "./transport"
import { viewerIdentityBridge } from "./viewerIdentityClient"
import type {
  RecommendationIdentity,
  ViewerIdentityResult,
} from "./viewerIdentity"

export type RawUserRecommendationDelivery = AdminResultOf<
  typeof USER_RECOMMENDATIONS
>["userRecommendations"]

export type UserRecommendationItem = {
  id: string
  position: number
  targetMediaId: string
  canonicalHref: string
  /** Opaque delivery capability: kept in memory, never persisted or logged. */
  capability: string
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  description: string
  durationSeconds: number | null
  generator: string
  poolVersion: string | null
  poolKey: string | null
}

export type UserRecommendationSlate = {
  requestId: string
  expiresAt: string | null
  cohort: string
  profileCount: number
  curatedCount: number
  poolVersion: string | null
  items: UserRecommendationItem[]
}

/**
 * The response's `expiresAt` is the consumer's authority on the item
 * capabilities (ten minutes today). Evidence and selection on an expired slate
 * would only be rejected, so callers refresh instead.
 */
export function isSlateExpired(
  slate: Pick<UserRecommendationSlate, "expiresAt">,
  now: number = Date.now(),
): boolean {
  if (slate.expiresAt == null) return false
  const expiresAt = Date.parse(slate.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= now
}

export type DeliveryResult =
  | { kind: "served"; slate: UserRecommendationSlate }
  | { kind: "unavailable"; reason: string; retryable: boolean }
  | { kind: "disabled" }
  | { kind: "unprovisioned" }

/** Admin answers these on a slate that may succeed shortly; one delayed retry. */
export const TRANSIENT_DELIVERY_REASONS: ReadonlySet<string> = new Set([
  "cooldown",
  "in_flight",
  "admission_unavailable",
  "delivery_timeout",
  "service_unavailable",
])

export type DeliveryVariables = {
  viewerToken: string
  sessionToken: string
  locale: string
  audioLanguageSlug: string
  count: number
}

/** Mobile sends viewer tokens ONLY: no digest of any kind ever rides here. */
export function buildDeliveryVariables(
  identity: RecommendationIdentity,
  input: { locale: string; audioLanguageSlug: string; count: number },
): DeliveryVariables {
  return {
    viewerToken: identity.viewerToken,
    sessionToken: identity.sessionToken,
    locale: input.locale,
    audioLanguageSlug: input.audioLanguageSlug,
    count: input.count,
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function toItem(raw: unknown, index: number): UserRecommendationItem | null {
  if (raw == null || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  if (
    !nonEmpty(item.id) ||
    !nonEmpty(item.targetMediaId) ||
    !nonEmpty(item.capability) ||
    !nonEmpty(item.videoSlug) ||
    !nonEmpty(item.videoTitle) ||
    typeof item.canonicalHref !== "string" ||
    item.position !== index
  ) {
    return null
  }
  const imageUrl =
    typeof item.imageUrl === "string" && validateActionUrl(item.imageUrl)
      ? item.imageUrl
      : null
  const durationSeconds =
    typeof item.durationSeconds === "number" &&
    Number.isFinite(item.durationSeconds) &&
    item.durationSeconds > 0
      ? item.durationSeconds
      : null
  return {
    id: item.id,
    position: index,
    targetMediaId: item.targetMediaId,
    canonicalHref: item.canonicalHref,
    capability: item.capability,
    videoSlug: item.videoSlug,
    videoTitle: item.videoTitle,
    imageUrl,
    description: typeof item.description === "string" ? item.description : "",
    durationSeconds,
    generator: typeof item.generator === "string" ? item.generator : "",
    poolVersion: typeof item.poolVersion === "string" ? item.poolVersion : null,
    poolKey: typeof item.poolKey === "string" ? item.poolKey : null,
  }
}

/**
 * A served slate is accepted only whole: the contract and surface versions
 * match, a request id exists, the item count equals the requested count,
 * every position is its index, and target media are distinct.
 */
export function validateServedSlate(
  delivery: RawUserRecommendationDelivery,
  requestedCount: number,
): UserRecommendationSlate | null {
  if (
    delivery.result !== "served" ||
    delivery.contractVersion !== USER_RECOMMENDATION_CONTRACT ||
    delivery.surfaceVersion !== WATCH_FOR_YOU_SURFACE ||
    !nonEmpty(delivery.requestId) ||
    !Array.isArray(delivery.items) ||
    delivery.items.length !== requestedCount
  ) {
    return null
  }
  const items: UserRecommendationItem[] = []
  const seen = new Set<string>()
  for (const [index, raw] of delivery.items.entries()) {
    const item = toItem(raw, index)
    if (!item || seen.has(item.targetMediaId)) return null
    seen.add(item.targetMediaId)
    items.push(item)
  }
  return {
    requestId: delivery.requestId,
    expiresAt: delivery.expiresAt ?? null,
    cohort: delivery.cohort,
    profileCount: delivery.profileCount,
    curatedCount: delivery.curatedCount,
    poolVersion: delivery.poolVersion ?? null,
    items,
  }
}

/**
 * Pure mapping from Admin's envelope to the client's result. Only a `served`
 * envelope is validated: `fallback`, `empty` and `unavailable` carry Admin's
 * own reason, which the log keeps apart from a genuinely malformed answer.
 */
export function classifyDelivery(
  delivery: RawUserRecommendationDelivery,
  requestedCount: number,
): DeliveryResult {
  if (delivery.result !== "served") {
    const reason = delivery.reason ?? delivery.result ?? "unavailable"
    if (reason === "environment_disabled") return { kind: "disabled" }
    return {
      kind: "unavailable",
      reason,
      retryable: TRANSIENT_DELIVERY_REASONS.has(reason),
    }
  }
  const slate = validateServedSlate(delivery, requestedCount)
  if (!slate) {
    return { kind: "unavailable", reason: "invalid_delivery", retryable: false }
  }
  return { kind: "served", slate }
}

export function assertValidCount(count: number): void {
  if (
    !Number.isInteger(count) ||
    count < USER_RECOMMENDATION_MIN_COUNT ||
    count > USER_RECOMMENDATION_MAX_COUNT
  ) {
    throw new RangeError(
      `recommendation count must be an integer in [${USER_RECOMMENDATION_MIN_COUNT}, ${USER_RECOMMENDATION_MAX_COUNT}]`,
    )
  }
}

export type DeliveryDeps = {
  getIdentity: () => Promise<ViewerIdentityResult>
  query: (
    variables: DeliveryVariables,
  ) => Promise<RawUserRecommendationDelivery>
  /** Admin rejected the handle: drop it so the next attempt bootstraps. */
  invalidateIdentity: () => Promise<void>
  touch: () => void
  report?: (result: string, reason: string, attempt: number) => void
}

export type FetchUserRecommendationsInput = {
  locale: string
  audioLanguageSlug: string
  count?: number
  /** For telemetry only: which attempt of the hook's retry loop this is. */
  attempt?: number
}

/**
 * One delivery attempt. Never throws for a network or Admin failure — every
 * outcome is a `DeliveryResult` — but rejects a malformed `count` up front.
 */
export async function fetchUserRecommendations(
  input: FetchUserRecommendationsInput,
  deps: DeliveryDeps,
): Promise<DeliveryResult> {
  const count = input.count ?? USER_RECOMMENDATION_DEFAULT_COUNT
  assertValidCount(count)
  const attempt = input.attempt ?? 1
  const report = deps.report ?? reportRecommendationDelivery
  const identity = await deps.getIdentity()
  if (identity.kind === "disabled") return { kind: "disabled" }
  if (identity.kind === "unprovisioned") return { kind: "unprovisioned" }
  if (identity.kind === "unavailable") {
    report("unavailable", "identity_unavailable", attempt)
    return {
      kind: "unavailable",
      reason: "identity_unavailable",
      retryable: true,
    }
  }
  try {
    const delivery = await deps.query(
      buildDeliveryVariables(identity.identity, {
        locale: input.locale,
        audioLanguageSlug: input.audioLanguageSlug,
        count,
      }),
    )
    deps.touch()
    const result = classifyDelivery(delivery, count)
    report(
      result.kind === "served" ? "served" : result.kind,
      result.kind === "served"
        ? "served"
        : result.kind === "unavailable"
          ? result.reason
          : result.kind,
      attempt,
    )
    return result
  } catch (error) {
    const failure = toRecommendationClientError(error)
    if (failure.code === "UNAUTHENTICATED") {
      await deps.invalidateIdentity()
      report("unavailable", "identity_rejected", attempt)
      return {
        kind: "unavailable",
        reason: "identity_rejected",
        retryable: true,
      }
    }
    const reason = failure.definitive ? "rejected" : failure.code.toLowerCase()
    report("unavailable", reason, attempt)
    return { kind: "unavailable", reason, retryable: !failure.definitive }
  }
}

let defaultDeps: DeliveryDeps | null = null

/** Real wiring: the viewer store and the deadline-bounded Apollo query. */
export function getDeliveryDeps(): DeliveryDeps {
  if (!defaultDeps) {
    defaultDeps = {
      ...viewerIdentityBridge(),
      query: async (variables) => {
        const data = await queryWithDeadline(
          USER_RECOMMENDATIONS,
          variables,
          DELIVERY_DEADLINE_MS,
        )
        return data.userRecommendations
      },
    }
  }
  return defaultDeps
}
