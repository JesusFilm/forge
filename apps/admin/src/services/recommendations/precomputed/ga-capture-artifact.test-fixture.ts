import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"

export const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export function validArtifact(
  input: {
    generationId?: string
    generationInputDigest?: string
    sourceSetDigest?: string
    inputCutoff?: string
    physicalHttpAttempts?: number
    physicalSucceededCalls?: number
  } = {},
) {
  const sourceAvailability = {
    coverage: "partial_source_history",
    requestedStart: "2022-06-21",
    requestedEnd: "2026-10-05",
    usableStart: "2022-08-08",
    usableEnd: "2026-10-05",
    truncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
    truncationDate: "2022-08-07",
    unavailablePrefixStart: "2022-06-21",
    unavailablePrefixEnd: "2022-08-07",
    observedFirstMonth: "202209",
    observedLastMonth: "202610",
  }
  const baseQualification = {
    evidenceKind: "referrer_navigation_v1",
    sourceResource: "properties/320198532",
    sourceAvailability,
    watchScope: {
      version: "jesusfilm-watch-v1",
      hosts: ["jesusfilm.org", "www.jesusfilm.org"],
      pathRule: "watch-route-and-children",
      eventName: "videostarts",
      includedEvents: 0,
      totalEvents: null,
      missingUrlEvents: null,
      malformedUrlEvents: null,
      excludedHostEvents: null,
      excludedPathEvents: null,
    },
    mediaComponentIdCoverage: {
      sourceDimension: "customEvent:mediacomponentid",
      inScopeEvents: 0,
      withMediaComponentIdEvents: 0,
      canonicalVideoMappedEvents: null,
    },
    engagement: {
      definitionVersion: "watch-videostarts-v1",
      botBasis: "unverified",
      overlapIdentity: "unknown",
      exposures: "unavailable",
    },
    transitions: { status: "unavailable", reason: "missing_session_identity" },
    navigation: {
      status: "available",
      definitionVersion: "watch-referrer-v1",
      basis: "same_event_page_referrer_to_page_path",
      interpretation: "navigation_not_playback_sequence",
      botBasis: "unverified",
      overlapIdentity: "unknown",
    },
    mapping: {
      basis: "current_catalog_cutoff_fenced",
      historicalOwnership: "unverified",
    },
  }
  const rawBlocks = [
    Buffer.from("[]"),
    Buffer.from("[]"),
    Buffer.from(canonical({ sourcePatterns: [], pagesBySourcePattern: [] })),
  ]
  const compressed = rawBlocks.map((raw) => gzipSync(raw))
  const blocks = compressed.map((bytes, index) => ({
    kind: ["start_page", "referrer_page", "locator_index"][index],
    pageOffset: index < 2 ? 0 : null,
    rowCount: index < 2 ? 0 : null,
    compressedBytes: bytes.length,
    compressedSha256: sha(bytes),
    rawBytes: rawBlocks[index]!.length,
    rawSha256: sha(rawBlocks[index]!),
  }))
  const header = {
    version: "ga_watch_capture_v1",
    generationId: input.generationId ?? "unit-generation",
    generationInputDigest: input.generationInputDigest ?? "a".repeat(64),
    sourceSetDigest: input.sourceSetDigest ?? "b".repeat(64),
    inputCutoff: input.inputCutoff ?? "2026-10-06T00:00:00.000Z",
    selectedCorpusDigest: "c".repeat(64),
    candidatePoolDigest: "d".repeat(64),
    routeMappingDigest: "e".repeat(64),
    querySpecDigest: "f".repeat(64),
    sourcePatternTableDigest: sha(
      canonical({
        version: "ga_watch_source_patterns_v1",
        routeMappingDigest: "e".repeat(64),
        patterns: [],
      }),
    ),
    propertyId: "320198532",
    propertyTimeZone: "America/New_York",
    requestedStart: sourceAvailability.requestedStart,
    requestedEnd: sourceAvailability.requestedEnd,
    usableStart: sourceAvailability.usableStart,
    usableEnd: sourceAvailability.usableEnd,
    sourceAvailability,
    baseQualification,
    baseQualificationDigest: sha(canonical(baseQualification)),
    requestedCoverageDigest: "2".repeat(64),
    usableCoverageDigest: "3".repeat(64),
    captureStartedAt: "2026-10-06T01:00:00.000Z",
    captureCompletedAt: "2026-10-06T01:10:00.000Z",
    verification: "two_matching_passes",
    startRows: 0,
    referrerRows: 0,
    startPages: 1,
    referrerPages: 1,
    startContentDigest: sha(
      canonical({
        version: "ga_watch_content_v1",
        kind: "start_page",
        pages: [{ pageOffset: 0, rowCount: 0, rawSha256: sha(rawBlocks[0]!) }],
      }),
    ),
    referrerContentDigest: sha(
      canonical({
        version: "ga_watch_content_v1",
        kind: "referrer_page",
        pages: [{ pageOffset: 0, rowCount: 0, rawSha256: sha(rawBlocks[1]!) }],
      }),
    ),
    physicalHttpAttempts: input.physicalHttpAttempts ?? 7,
    physicalSucceededCalls: input.physicalSucceededCalls ?? 6,
    blocks,
  }
  const headerBytes = Buffer.from(canonical(header))
  const prefix = Buffer.alloc(12)
  prefix.write("FORGEGA1")
  prefix.writeUInt32BE(headerBytes.length, 8)
  return Buffer.concat([prefix, headerBytes, ...compressed])
}
