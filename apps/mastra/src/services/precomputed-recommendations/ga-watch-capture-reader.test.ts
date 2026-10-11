import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  gaCaptureContentDigest,
  gaCaptureDigest,
  openGaWatchCaptureArtifact,
  sealGaWatchCaptureArtifact,
  writeGaWatchCapturePage,
} from "./ga-watch-capture-artifact"
import { createSealedGaWatchHistoryReader } from "./ga-watch-capture"
import { gaWatchRouteMappingDigest, routePatterns } from "./ga-watch-history"

const source = {
  id: "source",
  coreId: "source-core",
  slug: "source",
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced" as const,
    parentSlugs: [],
    playableAudioLanguageSlugs: ["english"],
    truncated: false,
  },
}
const target = {
  id: "target",
  coreId: "target-core",
  slug: "target",
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced" as const,
    parentSlugs: [],
    playableAudioLanguageSlugs: ["english"],
    truncated: false,
  },
}

describe("sealed GA Watch reader", () => {
  it("derives a chosen candidate pair with no GA transport and honest virtual usage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-sealed-reader-"))
    try {
      const patterns = [...new Set([source, target].flatMap(routePatterns))]
      const firstStarts = await writeGaWatchCapturePage({
        directory,
        kind: "start_page",
        pageOffset: 0,
        rowCount: 500,
        rows: Array.from({ length: 500 }, (_, index) => ({
          pagePath: "/watch/target.html/english.html",
          mediaComponentId: `media-${index}`,
          starts: 1,
          rowIdentityDigest: index.toString(16).padStart(64, "0"),
        })),
      })
      const lastTargetStart = await writeGaWatchCapturePage({
        directory,
        kind: "start_page",
        pageOffset: 500,
        rowCount: 1,
        rows: [
          {
            pagePath: "/watch/target.html/english.html",
            mediaComponentId: "media-500",
            starts: 1,
            rowIdentityDigest: "500".padStart(64, "0"),
          },
        ],
      })
      const unrelatedStart = await writeGaWatchCapturePage({
        directory,
        kind: "start_page",
        pageOffset: 501,
        rowCount: 1,
        rows: [
          {
            pagePath: "/watch/unrelated.html/english.html",
            mediaComponentId: "unrelated",
            starts: 1,
            rowIdentityDigest: "501".padStart(64, "0"),
          },
        ],
      })
      const referrers = await writeGaWatchCapturePage({
        directory,
        kind: "referrer_page",
        pageOffset: 0,
        rowCount: 1,
        rows: [
          {
            sourcePath: "/watch/source.html/english.html",
            targetPath: "/watch/target.html/english.html",
            pagePath: "/watch/target.html/english.html",
            sourcePatternIds: [0],
            status: "candidate",
            mediaComponentId: "media",
            starts: 3,
            rowIdentityDigest: "b".repeat(64),
          },
        ],
      })
      const baseQualification = {
        sourceAvailability: {
          requestedStart: "2022-08-06",
          requestedEnd: "2022-10-31",
          usableStart: "2022-08-08",
          usableEnd: "2022-10-31",
        },
      }
      const routeMappingDigest = gaWatchRouteMappingDigest([source, target])
      const sealed = await sealGaWatchCaptureArtifact({
        directory,
        header: {
          version: "ga_watch_capture_v1",
          generationId: "g-one",
          generationInputDigest: "1".repeat(64),
          sourceSetDigest: "2".repeat(64),
          inputCutoff: "2022-11-01T00:00:00.000Z",
          selectedCorpusDigest: "3".repeat(64),
          candidatePoolDigest: "4".repeat(64),
          routeMappingDigest,
          querySpecDigest: "5".repeat(64),
          sourcePatternTableDigest: gaCaptureDigest({
            version: "ga_watch_source_patterns_v1",
            routeMappingDigest,
            patterns,
          }),
          propertyId: "320198532",
          propertyTimeZone: "America/New_York",
          requestedStart: "2022-08-06",
          requestedEnd: "2022-10-31",
          usableStart: "2022-08-08",
          usableEnd: "2022-10-31",
          sourceAvailability: baseQualification.sourceAvailability,
          baseQualification,
          baseQualificationDigest: gaCaptureDigest(baseQualification),
          requestedCoverageDigest: "6".repeat(64),
          usableCoverageDigest: "7".repeat(64),
          captureStartedAt: "2022-11-01T00:01:00.000Z",
          captureCompletedAt: "2022-11-01T00:02:00.000Z",
          verification: "two_matching_passes",
          startRows: 502,
          referrerRows: 1,
          startPages: 3,
          referrerPages: 1,
          startContentDigest: gaCaptureContentDigest("start_page", [
            firstStarts,
            lastTargetStart,
            unrelatedStart,
          ]),
          referrerContentDigest: gaCaptureContentDigest("referrer_page", [
            referrers,
          ]),
          physicalHttpAttempts: 6,
          physicalSucceededCalls: 6,
        },
        pages: [firstStarts, lastTargetStart, unrelatedStart, referrers],
        locatorIndex: {
          sourcePatterns: patterns,
          pagesBySourcePattern: [[0], []],
        },
      })
      const artifact = await openGaWatchCaptureArtifact({
        path: sealed.path,
        expectedSha256: sealed.artifactSha256,
        expectedBytes: sealed.artifactBytes,
      })
      const readPage = vi.fn(artifact.readPage)
      const reader = await createSealedGaWatchHistoryReader({
        artifact: { ...artifact, readPage },
        artifactSha256: sealed.artifactSha256,
      })
      readPage.mockClear()
      const definition = await reader.describe()
      const snapshot = await reader.readNavigationSnapshot!({
        definition: definition as never,
        catalog: [source, target],
        routeCatalog: [source, target],
        sourceVideoId: source.id,
        selectedVideoIds: [target.id],
        includeSourceEngagement: false,
        cutoff: "2022-11-01T00:00:00.000Z",
      })
      expect(snapshot.signal(target.id)?.views).toBe(501)
      expect(snapshot.navigation?.(source.id, target.id)).toBe(3)
      expect(snapshot.provenance).toMatchObject({
        captureMode: "capture_derived_v1",
        pageCountKind: "virtual_validation",
        queryExecutionCount: 0,
        navigationCoverage: { candidateEvents: 3, qualifiedEvents: 3 },
      })
      expect(snapshot.queryUsage.size).toBe(0)
      const requestedStartOffsets = readPage.mock.calls
        .filter(([block]) => block.kind === "start_page")
        .map(([block]) => block.pageOffset)
      expect(requestedStartOffsets).toEqual([0, 500, 0, 500])
      expect(snapshot.provenance.pageCount).toBe(3)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
