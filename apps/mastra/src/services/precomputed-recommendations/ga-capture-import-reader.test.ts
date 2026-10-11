import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { createGaCaptureImportClient } from "./ga-capture-import-client"
import {
  gaCaptureContentDigest,
  gaCaptureDigest,
  sealGaWatchCaptureArtifact,
  writeGaWatchCapturePage,
} from "./ga-watch-capture-artifact"
import { gaWatchRouteMappingDigest, routePatterns } from "./ga-watch-history"
import { loadImportedGaWatchHistory } from "./ga-capture-import-reader"

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
  ...source,
  id: "target",
  coreId: "target-core",
  slug: "target",
}
const routeCatalog = [source, target]

async function fixture(directory: string) {
  const starts = await writeGaWatchCapturePage({
    directory,
    kind: "start_page",
    pageOffset: 0,
    rowCount: 1,
    rows: [
      {
        pagePath: "/watch/target.html/english.html",
        mediaComponentId: "target-media",
        starts: 7,
        rowIdentityDigest: "a".repeat(64),
      },
    ],
  })
  const refs = await writeGaWatchCapturePage({
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
        mediaComponentId: "target-media",
        starts: 3,
        rowIdentityDigest: "b".repeat(64),
      },
    ],
  })
  const sourceAvailability = {
    coverage: "partial_source_history",
    requestedStart: "2022-08-06",
    requestedEnd: "2022-10-31",
    truncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
    truncationDate: "2022-08-07",
    unavailablePrefixStart: "2022-08-06",
    unavailablePrefixEnd: "2022-08-07",
    usableStart: "2022-08-08",
    usableEnd: "2022-10-31",
    observedFirstMonth: "202208",
    observedLastMonth: "202210",
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
      includedEvents: 7,
      totalEvents: null,
      missingUrlEvents: null,
      malformedUrlEvents: null,
      excludedHostEvents: null,
      excludedPathEvents: null,
    },
    mediaComponentIdCoverage: {
      sourceDimension: "customEvent:mediacomponentid",
      inScopeEvents: 7,
      withMediaComponentIdEvents: 7,
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
  const patterns = [...new Set(routeCatalog.flatMap(routePatterns))]
  const routeMappingDigest = gaWatchRouteMappingDigest(routeCatalog)
  const identity = {
    generationId: "origin",
    generationInputDigest: "1".repeat(64),
    sourceSetDigest: "2".repeat(64),
    inputCutoff: "2022-11-01T00:00:00.000Z",
    selectedCorpusDigest: "3".repeat(64),
    candidatePoolDigest: "4".repeat(64),
    routeMappingDigest,
    sourcePatternTableDigest: gaCaptureDigest({
      version: "ga_watch_source_patterns_v1",
      routeMappingDigest,
      patterns,
    }),
    querySpecDigest: "5".repeat(64),
    propertyId: "320198532" as const,
    propertyTimeZone: "America/New_York" as const,
    requestedStart: "2022-08-06",
    requestedEnd: "2022-10-31",
    usableStart: "2022-08-08",
    usableEnd: "2022-10-31",
    requestedCoverageDigest: "6".repeat(64),
    usableCoverageDigest: "7".repeat(64),
  }
  const baseQualificationDigest = gaCaptureDigest(baseQualification)
  const sealed = await sealGaWatchCaptureArtifact({
    directory,
    header: {
      ...identity,
      version: "ga_watch_capture_v1",
      sourceAvailability,
      baseQualification,
      baseQualificationDigest,
      captureStartedAt: "2022-11-01T00:01:00.000Z",
      captureCompletedAt: "2022-11-01T00:02:00.000Z",
      verification: "two_matching_passes",
      startRows: 1,
      referrerRows: 1,
      startPages: 1,
      referrerPages: 1,
      startContentDigest: gaCaptureContentDigest("start_page", [starts]),
      referrerContentDigest: gaCaptureContentDigest("referrer_page", [refs]),
      physicalHttpAttempts: 8,
      physicalSucceededCalls: 8,
    },
    pages: [starts, refs],
    locatorIndex: { sourcePatterns: patterns, pagesBySourcePattern: [[0], []] },
  })
  const copy = {
    artifactSha256: sealed.artifactSha256,
    artifactBytes: sealed.artifactBytes,
    headerSha256: sealed.headerSha256,
  }
  const origin = {
    ...identity,
    ...copy,
    baseQualificationDigest,
    physicalHttpAttempts: 8,
    physicalSucceededCalls: 8,
  }
  const destination = {
    ...identity,
    generationId: "destination",
    generationInputDigest: "8".repeat(64),
    candidatePoolDigest: "9".repeat(64),
    qualificationPolicy: "referrer_navigation_v1" as const,
  }
  const binding = {
    version: "ga_capture_import_v1" as const,
    destination,
    origin,
    copy,
  }
  const status = {
    version: "ga_capture_import_v1" as const,
    state: "bound" as const,
    preparedDigest: gaCaptureDigest({
      version: "ga_capture_import_prepare_v1",
      destination,
    }),
    importBinding: { ...binding, bindingDigest: gaCaptureDigest(binding) },
    qualificationDigest: "f".repeat(64),
  }
  const download = vi.fn(async (input: { directory: string }) => {
    const path = join(input.directory, "destination.bin")
    await copyFile(sealed.path, path)
    return path
  })
  return { destination, status, sealed, download, baseQualification }
}

describe("destination-bound imported Watch history", () => {
  it("uses an unchanged verified copy for a new candidate pool with zero destination GA calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-import-reader-test-"))
    try {
      const f = await fixture(directory)
      const originalBytes = await readFile(f.sealed.path)
      const imported = await loadImportedGaWatchHistory({
        destination: f.destination,
        client: createGaCaptureImportClient(async () => f.status),
        transport: { download: f.download },
        directory,
      })
      expect(f.download).toHaveBeenCalledWith(
        expect.objectContaining({
          generationId: "destination",
          generationInputDigest: f.destination.generationInputDigest,
          artifactSha256: f.sealed.artifactSha256,
        }),
      )
      const snapshot = await imported.reader.readNavigationSnapshot!({
        definition: imported.definition,
        catalog: routeCatalog,
        routeCatalog,
        sourceVideoId: source.id,
        selectedVideoIds: [target.id],
        includeSourceEngagement: false,
        cutoff: f.destination.inputCutoff,
      })
      expect(snapshot.signal(target.id)?.views).toBe(7)
      expect(snapshot.navigation?.(source.id, target.id)).toBe(3)
      expect(snapshot.provenance).toMatchObject({
        captureMode: "imported_capture_derived_v1",
        importBindingDigest: f.status.importBinding.bindingDigest,
        queryExecutionCount: 0,
        pageCountKind: "virtual_validation",
      })
      expect(snapshot.queryUsage.size).toBe(0)
      expect(snapshot.definitionsForModel.qualification).toEqual(
        f.baseQualification,
      )
      expect(imported.qualificationDigest).toBe(f.status.qualificationDigest)
      expect(imported.importBinding.origin.generationId).toBe("origin")
      await imported.dispose()
      expect(await readFile(f.sealed.path)).toEqual(originalBytes)
      expect(
        (await readdir(directory)).filter((name) =>
          name.startsWith("ga-import-copy-"),
        ),
      ).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it("refuses an unbound copy before any file is downloaded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-import-reader-test-"))
    try {
      const f = await fixture(directory)
      await expect(
        loadImportedGaWatchHistory({
          destination: f.destination,
          client: createGaCaptureImportClient(async () => ({
            version: "ga_capture_import_v1",
            state: "absent",
          })),
          transport: { download: f.download },
          directory,
        }),
      ).rejects.toMatchObject({ code: "ga_import_identity_mismatch" })
      expect(f.download).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("rejects even a self-consistent binding when the copied header has another origin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-import-reader-test-"))
    try {
      const f = await fixture(directory)
      const { version, destination, origin, copy } = f.status.importBinding
      const binding = { version, destination, origin, copy }
      binding.origin = { ...binding.origin, generationId: "other-origin" }
      const changed = {
        ...f.status,
        importBinding: { ...binding, bindingDigest: gaCaptureDigest(binding) },
      }
      await expect(
        loadImportedGaWatchHistory({
          destination: f.destination,
          client: createGaCaptureImportClient(async () => changed),
          transport: { download: f.download },
          directory,
        }),
      ).rejects.toMatchObject({ code: "ga_import_artifact_mismatch" })
      expect(
        (await readdir(directory)).filter((name) =>
          name.startsWith("ga-import-copy-"),
        ),
      ).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("verifies downloaded bytes and removes a corrupted temporary copy", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-import-reader-test-"))
    try {
      const f = await fixture(directory)
      const download = async (input: { directory: string }) => {
        const path = await f.download(input)
        const bytes = await readFile(path)
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
        await writeFile(path, bytes)
        return path
      }
      await expect(
        loadImportedGaWatchHistory({
          destination: f.destination,
          client: createGaCaptureImportClient(async () => f.status),
          transport: { download },
          directory,
        }),
      ).rejects.toThrow()
      expect(
        (await readdir(directory)).filter((name) =>
          name.startsWith("ga-import-copy-"),
        ),
      ).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("never reads or deletes a file supplied outside its owned copy directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-import-reader-test-"))
    try {
      const f = await fixture(directory)
      await expect(
        loadImportedGaWatchHistory({
          destination: f.destination,
          client: createGaCaptureImportClient(async () => f.status),
          transport: { download: async () => f.sealed.path },
          directory,
        }),
      ).rejects.toMatchObject({ code: "ga_import_artifact_mismatch" })
      expect((await readFile(f.sealed.path)).length).toBe(
        f.sealed.artifactBytes,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
