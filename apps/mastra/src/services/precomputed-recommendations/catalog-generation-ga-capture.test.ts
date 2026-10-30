import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { buildCandidateRetrieval } from "./candidate-retrieval"
import { runPrecomputedCatalog } from "./catalog-generation"
import {
  gaCaptureContentDigest,
  gaCaptureDigest,
  sealGaWatchCaptureArtifact,
  writeGaWatchCapturePage,
} from "./ga-watch-capture-artifact"
import {
  gaWatchCaptureQuerySpec,
  gaWatchRouteMappingDigest,
  routePatterns,
} from "./ga-watch-history"
import { gaWatchClosedRangeEnd } from "./ga-watch-history-range"

const cutoff = "2022-11-01T00:00:00.000Z"
const video = {
  id: "source",
  coreId: "source-core",
  slug: "source",
  locale: null,
  title: "Source video",
  description: "A story about courage and mercy.",
  descriptionTruncated: false,
  keywords: [],
  keywordsTruncated: false,
  bibleCitations: [],
  bibleCitationsTruncated: false,
  parentVideoIds: [],
  childVideoIds: [],
  transcriptLanguages: [],
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced" as const,
    parentSlugs: [],
    playableAudioLanguageSlugs: ["english"],
    truncated: false,
  },
}
const target = {
  ...video,
  id: "target",
  coreId: "target-core",
  slug: "target",
  title: "Target video",
}
const catalog = {
  async catalog() {
    return { videos: [video, target], nextCursor: null }
  },
  async video({ videoId }: { videoId: string }) {
    return videoId === video.id ? video : target
  },
  async chunks() {
    return { chunks: [], nextCursor: null }
  },
}
const capacity = {
  measuredAt: "2022-11-01T00:01:00.000Z",
  clusterSystemId: "1234567890",
  observedDbBytes: 1_000_000,
  availableBytes: 10_000_000_000,
  reserveBytes: 5_000_000_000,
  projectedBytes: 1_000_000,
  sampleSourceCount: 1,
  sampleBytes: 1000,
  source: "operator_verified_pgdata_df" as const,
}

describe("snapshot-backed catalog generation", () => {
  it("resumes after a model failure from the immutable artifact with no GA calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-catalog-resume-"))
    const artifactDir = join(directory, "artifact")
    const end = gaWatchClosedRangeEnd(cutoff)
    const baseQualification = {
      evidenceKind: "referrer_navigation_v1",
      sourceResource: "properties/320198532",
      sourceAvailability: {
        coverage: "partial_source_history",
        requestedStart: "2022-06-21",
        requestedEnd: end,
        truncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
        truncationDate: "2022-08-05",
        unavailablePrefixStart: "2022-06-21",
        unavailablePrefixEnd: "2022-08-05",
        usableStart: "2022-08-06",
        usableEnd: end,
        observedFirstMonth: null,
        observedLastMonth: null,
      },
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
      transitions: {
        status: "unavailable",
        reason: "missing_session_identity",
      },
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
    const retrieval = await buildCandidateRetrieval(
      catalog,
      [video, target],
      cutoff,
    )
    const gaFetch = vi.fn(async () => {
      throw new Error("live GA forbidden")
    })
    const model = {
      generate: vi.fn(async () => {
        throw new Error("provider down")
      }),
    }
    let claims = 0
    let revision = 0
    let capacityFresh = true
    let boundOnStatus = true
    let bound: { snapshotRef: Record<string, unknown> } | null = null
    let sealed: Awaited<ReturnType<typeof sealGaWatchCaptureArtifact>>
    const actions: string[] = []
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as Record<string, unknown>
      actions.push(String(call.action))
      switch (call.action) {
        case "start": {
          expect(call.protocolVersion).toBe(3)
          expect(call.inputSnapshotMode).toBe("ga_aggregate_capture_v1")
          const starts = await writeGaWatchCapturePage({
            directory: artifactDir,
            kind: "start_page",
            pageOffset: 0,
            rowCount: 0,
            rows: [],
          })
          const referrers = await writeGaWatchCapturePage({
            directory: artifactDir,
            kind: "referrer_page",
            pageOffset: 0,
            rowCount: 0,
            rows: [],
          })
          const routeMappingDigest = gaWatchRouteMappingDigest([video, target])
          const patterns = [...new Set([video, target].flatMap(routePatterns))]
          sealed = await sealGaWatchCaptureArtifact({
            directory: artifactDir,
            header: {
              version: "ga_watch_capture_v1",
              generationId: "generation-one",
              generationInputDigest: String(call.inputDigest),
              sourceSetDigest: String(call.sourceSetDigest),
              inputCutoff: cutoff,
              selectedCorpusDigest: retrieval.selectedCorpusDigest,
              candidatePoolDigest: retrieval.candidatePoolDigest,
              routeMappingDigest,
              querySpecDigest: gaCaptureDigest(
                gaWatchCaptureQuerySpec({
                  propertyId: "320198532",
                  rangeStart: "2022-08-06",
                  rangeEnd: end,
                }),
              ),
              sourcePatternTableDigest: gaCaptureDigest({
                version: "ga_watch_source_patterns_v1",
                routeMappingDigest,
                patterns,
              }),
              propertyId: "320198532",
              propertyTimeZone: "America/New_York",
              requestedStart: "2022-06-21",
              requestedEnd: end,
              usableStart: "2022-08-06",
              usableEnd: end,
              sourceAvailability: baseQualification.sourceAvailability,
              baseQualification,
              baseQualificationDigest: gaCaptureDigest(baseQualification),
              requestedCoverageDigest: "1".repeat(64),
              usableCoverageDigest: "2".repeat(64),
              captureStartedAt: "2022-11-01T00:01:00.000Z",
              captureCompletedAt: "2022-11-01T00:02:00.000Z",
              verification: "two_matching_passes",
              startRows: 0,
              referrerRows: 0,
              startPages: 1,
              referrerPages: 1,
              startContentDigest: gaCaptureContentDigest("start_page", [
                starts,
              ]),
              referrerContentDigest: gaCaptureContentDigest("referrer_page", [
                referrers,
              ]),
              physicalHttpAttempts: 0,
              physicalSucceededCalls: 0,
            },
            pages: [starts, referrers],
            locatorIndex: {
              sourcePatterns: patterns,
              pagesBySourcePattern: patterns.map(() => []),
            },
          })
          const compact = Object.fromEntries(
            Object.entries(sealed.header).filter(
              ([key]) =>
                ![
                  "blocks",
                  "baseQualification",
                  "startContentDigest",
                  "referrerContentDigest",
                  "requestedCoverageDigest",
                  "usableCoverageDigest",
                ].includes(key),
            ),
          )
          bound = {
            snapshotRef: {
              ...compact,
              storageKey: "private/test",
              artifactSha256: sealed.artifactSha256,
              artifactBytes: sealed.artifactBytes,
              headerSha256: sealed.headerSha256,
            },
          }
          return { state: "incomplete" }
        }
        case "manifest":
          return { state: "incomplete", pendingSourceCount: 2 }
        case "capacity_probe":
          return {
            observedDbBytes: 1,
            clusterSystemId: "1",
            availableBytes: null,
          }
        case "capacity":
          return { state: "incomplete" }
        case "status":
          return {
            generationProtocolVersion: 3,
            inputSnapshotMode: "ga_aggregate_capture_v1",
            capacityFresh,
            historicalQualification: boundOnStatus
              ? { ...baseQualification, ...bound }
              : null,
            historicalQualificationDigest: boundOnStatus
              ? "a".repeat(64)
              : null,
            historyCallCounts: { pending: 0, succeeded: 0, failed: 0 },
          }
        case "history_call_start":
          return { state: "pending", callId: call.callId }
        case "history_call":
          return { receiptStored: true }
        case "claim":
          claims += 1
          return call.sourceVideoId === video.id && claims === 1
            ? {
                sourceState: "claimed",
                leaseToken: "550e8400-e29b-41d4-a716-446655440000",
                checkpointRevision: 0,
                checkpoint: null,
              }
            : { sourceState: "complete_empty", leaseToken: null }
        case "heartbeat":
          return { sourceState: "claimed" }
        case "checkpoint":
          return { checkpointRevision: ++revision }
        case "model_call_start":
          return { state: "pending", callId: call.callId }
        case "model_call":
          return {
            receiptStored: true,
            checkpointApplied: true,
            staleLease: false,
            checkpointRevision: ++revision,
          }
        case "complete":
          return { state: "complete" }
        default:
          throw new Error(`unexpected action ${String(call.action)}`)
      }
    })
    const gaCaptureTransport = {
      async upload() {
        throw new Error("sealed generation must not upload")
      },
      async download() {
        return sealed.path
      },
    }
    const input = {
      generationId: "generation-one",
      inputCutoff: cutoff,
      historyRequired: true,
      snapshotMode: "ga_aggregate_capture_v1" as const,
      capacity,
    }
    const dependencies = {
      catalog,
      ingest,
      model,
      gaCaptureTransport,
      gaCaptureDirectory: directory,
      gaTransport: {
        fetchImpl: gaFetch as typeof fetch,
        serviceAccountEmail:
          "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
        tokenProvider: async () => ({ ok: true as const, accessToken: "test" }),
      },
    }
    try {
      await expect(runPrecomputedCatalog(input, dependencies)).rejects.toThrow(
        "provider_unavailable",
      )
      expect(model.generate).toHaveBeenCalled()
      expect(gaFetch).not.toHaveBeenCalled()
      capacityFresh = false
      const claimsBeforePause = claims
      const modelCallsBeforePause = model.generate.mock.calls.length
      const paused = await runPrecomputedCatalog(input, dependencies)
      expect(paused.state).toBe("incomplete")
      expect(claims).toBe(claimsBeforePause)
      expect(model.generate).toHaveBeenCalledTimes(modelCallsBeforePause)
      capacityFresh = true
      const resumed = await runPrecomputedCatalog(input, dependencies)
      expect(resumed.state).toBe("complete")
      expect(gaFetch).not.toHaveBeenCalled()
      expect(
        actions.filter((action) => action === "history_call_start"),
      ).toHaveLength(0)
      boundOnStatus = false
      const modelCallsBeforeUnsealed = model.generate.mock.calls.length
      const claimsBeforeUnsealed = claims
      await expect(
        runPrecomputedCatalog(input, dependencies),
      ).rejects.toMatchObject({
        code: "analytics_unavailable",
      })
      expect(gaFetch).toHaveBeenCalled()
      expect(model.generate).toHaveBeenCalledTimes(modelCallsBeforeUnsealed)
      expect(claims).toBe(claimsBeforeUnsealed)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
