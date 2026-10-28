import { createHash } from "node:crypto"
import { createRecommendationEventEnvelope } from "./event-history/envelope"

export class WatchEventCodecError extends Error {
  constructor() {
    super("Watch event export preparation failed")
    this.name = "WatchEventCodecError"
  }
}

export type WatchHistoryFact = {
  eventId: string
  rankId: string
  windowId: string
  surface: string
  block: string
  presentation: string
  placement: string
  policyVersion: string
  position: number
  itemPath: string
  kind: string
  visibilityCapability: string | null
  occurredAt: Date
  receivedAt: Date
  expiresAt: Date
  duplicateCount: number
  revision: number
}

const fields = [
  "eventId",
  "rankId",
  "windowId",
  "surface",
  "block",
  "presentation",
  "placement",
  "policyVersion",
  "position",
  "itemPath",
  "kind",
  "visibilityCapability",
  "occurredAt",
  "receivedAt",
  "expiresAt",
  "duplicateCount",
] as const

export function watchExactDigest(
  fact: Pick<
    WatchHistoryFact,
    | "windowId"
    | "surface"
    | "block"
    | "presentation"
    | "placement"
    | "policyVersion"
    | "position"
    | "itemPath"
    | "kind"
    | "visibilityCapability"
    | "occurredAt"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        fact.windowId,
        fact.surface,
        fact.block,
        fact.presentation,
        fact.placement,
        fact.policyVersion,
        fact.position,
        fact.itemPath,
        fact.kind,
        fact.visibilityCapability,
        fact.occurredAt.getTime(),
      ]),
    )
    .digest("hex")
}

export function watchGroupDigest(
  fact: Pick<
    WatchHistoryFact,
    | "windowId"
    | "surface"
    | "block"
    | "presentation"
    | "placement"
    | "policyVersion"
    | "position"
    | "itemPath"
    | "kind"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        fact.windowId,
        fact.surface,
        fact.block,
        fact.presentation,
        fact.placement,
        fact.policyVersion,
        fact.position,
        fact.itemPath,
        fact.kind,
      ]),
    )
    .digest("hex")
}

/** Accepted revision time is immutable; original receivedAt stays in the payload. */
export function encodeWatchHistoryFact(
  fact: WatchHistoryFact,
  acceptedAt: Date,
) {
  try {
    const { revision, ...payload } = fact
    return createRecommendationEventEnvelope({
      family: "watch-exposure",
      logicalId: fact.eventId,
      revision,
      occurredAt: fact.occurredAt,
      acceptedAt,
      expiresAt: fact.expiresAt,
      payload: {
        ...payload,
        occurredAt: fact.occurredAt.toISOString(),
        receivedAt: fact.receivedAt.toISOString(),
        expiresAt: fact.expiresAt.toISOString(),
      },
      allowedFields: fields,
    })
  } catch {
    throw new WatchEventCodecError()
  }
}
