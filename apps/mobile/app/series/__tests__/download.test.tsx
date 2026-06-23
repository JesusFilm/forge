// Route-level RN rendering isn't set up in apps/mobile (no @testing-library/
// react-native). Per the plan, the series sheet's load-bearing logic — the
// aggregate storage gate, the result-derived enqueue routing/buckets, and the
// request builder — is factored into src/lib/seriesDownloadEnqueue.ts and unit-
// tested here. These cover AE1/AE3/AE4/AE5/AE6/AE8 at the orchestration layer.
import {
  buildEpisodeRequest,
  enqueueResolvedEpisodes,
  evaluateStorageGate,
  formatEnqueueSummary,
} from "../../../src/lib/seriesDownloadEnqueue"
import {
  resolveSeriesDownload,
  type SeriesResolveDeps,
  type SeriesEpisodeResolution,
} from "../../../src/lib/seriesDownloadResolver"
import type { OfflineDownloadRecord } from "../../../src/lib/offlineManifest"
import type {
  StartDownloadRequest,
  StartDownloadResult,
} from "../../../src/contexts/DownloadsProvider"
import type {
  VariantMedia,
  WatchDownload,
  WatchEpisode,
  WatchVariant,
} from "../../../src/lib/normalizeVideo"

const RESERVE = 250 * 1024 * 1024

// ── Fixtures ────────────────────────────────────────────────────────

const episode = (slug: string): WatchEpisode => ({
  documentId: `${slug}-doc`,
  slug,
  label: null,
  title: `Title ${slug}`,
  posterUrl: `poster-${slug}`,
})

const variant = (languageSlug: string, documentId: string): WatchVariant => ({
  documentId,
  slug: `${documentId}-slug`,
  published: true,
  hls: "hls://x",
  duration: 100,
  languageCoreId: null,
  languageBcp47: null,
  languageSlug,
  languageName: languageSlug,
  languageNameNative: null,
  muxPlaybackId: null,
})

const dl = (id: string, quality: string, size: string): WatchDownload => ({
  documentId: id,
  quality,
  size,
  url: `url-${id}`,
})

const media = (downloads: WatchDownload[]): VariantMedia => ({
  downloads,
  subtitles: [],
})

const resolvedEpisode = (
  slug: string,
  dubDocumentId: string,
  sizeBytes: number,
): SeriesEpisodeResolution => ({
  slug,
  title: `Title ${slug}`,
  posterUrl: `poster-${slug}`,
  status: "resolved",
  dubDocumentId,
  rendition: dl(`${slug}-r`, "high", String(sizeBytes)),
  resolvedTier: "Highest",
  subtitleUrl: null,
  subtitleMissing: false,
  sizeBytes,
  sizeUnknown: false,
})

const record = (
  videoSlug: string,
  dubDocumentId: string,
  state: OfflineDownloadRecord["state"],
  totalBytes = 0,
): OfflineDownloadRecord => ({
  version: 1,
  videoSlug,
  dubDocumentId,
  renditionDocumentId: "r",
  qualityLabel: "high",
  title: "",
  subtitleLanguageSlug: null,
  state,
  committedPath: state === "downloaded" ? `/committed/${videoSlug}` : null,
  pendingPath: null,
  posterPath: null,
  bytesWritten: 0,
  totalBytes,
})

// A SeriesDownloadResolution from a list of resolved episodes.
function resolutionOf(resolved: SeriesEpisodeResolution[]) {
  return {
    episodes: resolved,
    resolved,
    resolvedCount: resolved.length,
    skippedLanguageCount: 0,
    skippedNoRenditionCount: 0,
    failedCount: 0,
    totalBytes: resolved.reduce((s, e) => s + (e.sizeBytes ?? 0), 0),
    totalIsLowerBound: resolved.some((e) => e.sizeUnknown === true),
  }
}

const ctx = { subtitleLanguageSlug: null, allowCellular: true }

// ── AE1: total shown pre-confirm + request shape ────────────────────

describe("AE1 — resolved total and request shape", () => {
  it("resolveSeriesDownload sums resolved rendition sizes for the size panel", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [variant("es", `${slug}-es`)],
      getDubMedia: async (dubId) => media([dl(`${dubId}-hi`, "high", "1500")]),
    }
    const res = await resolveSeriesDownload(
      [episode("a"), episode("b")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.resolvedCount).toBe(2)
    expect(res.totalBytes).toBe(3000)
    expect(res.totalIsLowerBound).toBe(false)
  })

  it("buildEpisodeRequest mirrors the per-video request shape", () => {
    const ep = resolvedEpisode("a", "dub-a", 1000)
    const req = buildEpisodeRequest(ep, {
      subtitleLanguageSlug: "fr",
      allowCellular: false,
    })
    expect(req).toMatchObject({
      videoSlug: "a",
      title: "Title a",
      dubDocumentId: "dub-a",
      subtitleLanguageSlug: null, // this episode has no fr track → degraded
      subtitleUrl: null,
      allowCellular: false,
      posterUrl: "poster-a",
    })
    expect(req?.rendition.size).toBe("1000")
  })

  it("keeps the subtitle slug when the episode carries the chosen track", () => {
    const ep: SeriesEpisodeResolution = {
      ...resolvedEpisode("a", "dub-a", 1000),
      subtitleUrl: "vtt-fr",
    }
    const req = buildEpisodeRequest(ep, {
      subtitleLanguageSlug: "fr",
      allowCellular: true,
    })
    expect(req?.subtitleLanguageSlug).toBe("fr")
    expect(req?.subtitleUrl).toBe("vtt-fr")
  })
})

// ── AE3: storage gate blocks won't-fit / lower-bound / free=0 ────────

describe("AE3 — storage gate (KTD6)", () => {
  const noRecord = () => null

  it("blocks when required (new + reserve) exceeds free space", () => {
    const resolution = resolutionOf([resolvedEpisode("a", "dub-a", 1000)])
    const gate = evaluateStorageGate({
      resolution,
      getRecord: noRecord,
      freeBytes: RESERVE, // exactly the reserve — 1000 over budget
      reserveBytes: RESERVE,
    })
    expect(gate.kind).toBe("insufficient")
  })

  it("budgets the on-disk size of swap targets, not just the new renditions", () => {
    const resolution = resolutionOf([resolvedEpisode("a", "dub-NEW", 1000)])
    // Episode already downloaded in a DIFFERENT dub → a swap; its old 5000 bytes
    // live alongside the new until verified, so they count toward the required.
    const getRecord = (slug: string) =>
      slug === "a" ? record("a", "dub-OLD", "downloaded", 5000) : null
    const free = RESERVE + 1000 + 4999 // covers new+reserve but NOT the old copy
    const gate = evaluateStorageGate({
      resolution,
      getRecord,
      freeBytes: free,
      reserveBytes: RESERVE,
    })
    expect(gate.kind).toBe("insufficient")
    if (gate.kind === "insufficient") {
      expect(gate.requiredBytes).toBe(RESERVE + 1000 + 5000)
    }
  })

  it("blocks an unverifiable (lower-bound) total even when free space is huge", () => {
    const resolution = {
      ...resolutionOf([resolvedEpisode("a", "dub-a", 0)]),
      totalIsLowerBound: true,
    }
    const gate = evaluateStorageGate({
      resolution,
      getRecord: noRecord,
      freeBytes: Number.MAX_SAFE_INTEGER,
      reserveBytes: RESERVE,
    })
    expect(gate.kind).toBe("unverifiable-total")
  })

  it("blocks when free space is unreadable (freeDiskBytes returned 0)", () => {
    const resolution = resolutionOf([resolvedEpisode("a", "dub-a", 1000)])
    const gate = evaluateStorageGate({
      resolution,
      getRecord: noRecord,
      freeBytes: 0,
      reserveBytes: RESERVE,
    })
    expect(gate.kind).toBe("unreadable-free")
  })

  it("passes when everything fits and the total is verifiable", () => {
    const resolution = resolutionOf([resolvedEpisode("a", "dub-a", 1000)])
    const gate = evaluateStorageGate({
      resolution,
      getRecord: noRecord,
      freeBytes: RESERVE + 1_000_000,
      reserveBytes: RESERVE,
    })
    expect(gate.kind).toBe("ok")
  })
})

// ── AE4 / AE5 / AE6: enqueue routing + result-derived buckets ───────

type Calls = {
  start: string[]
  swap: string[]
  delete: string[]
}

function makeDeps(
  records: Record<string, OfflineDownloadRecord>,
  results: {
    start?: (req: StartDownloadRequest) => StartDownloadResult
    swap?: (req: StartDownloadRequest) => StartDownloadResult
  } = {},
) {
  const calls: Calls = { start: [], swap: [], delete: [] }
  const deps = {
    getRecord: (slug: string) => records[slug] ?? null,
    startDownload: async (req: StartDownloadRequest) => {
      calls.start.push(req.videoSlug)
      return results.start?.(req) ?? ({ ok: true } as StartDownloadResult)
    },
    swapDownload: async (req: StartDownloadRequest) => {
      calls.swap.push(req.videoSlug)
      return results.swap?.(req) ?? ({ ok: true } as StartDownloadResult)
    },
    deleteDownload: async (slug: string) => {
      calls.delete.push(slug)
    },
  }
  return { deps, calls }
}

describe("AE4 — start vs swap vs cancel+start routing", () => {
  it("routes each episode to the right provider primitive", async () => {
    const resolved = [
      resolvedEpisode("new", "dub-new", 1000), // no record → start
      resolvedEpisode("dl", "dub-spanish", 1000), // downloaded in english → swap
      resolvedEpisode("prog", "dub-spanish", 1000), // downloading in english → switch
      resolvedEpisode("same", "dub-spanish", 1000), // already spanish → skip
    ]
    const { deps, calls } = makeDeps({
      dl: record("dl", "dub-english", "downloaded", 2000),
      prog: record("prog", "dub-english", "downloading", 2000),
      same: record("same", "dub-spanish", "downloaded", 2000),
    })
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)

    expect(calls.start.sort()).toEqual(["new", "prog"]) // start + switch both start
    expect(calls.swap).toEqual(["dl"])
    expect(calls.delete).toEqual(["prog"]) // switch cancels the in-flight first
    expect(summary.started).toBe(1) // "new"
    expect(summary.switched).toBe(2) // "dl" swap + "prog" switch
    expect(summary.alreadyPresent).toBe(1) // "same"
  })

  it("a swap whose new download fails is reported couldn't-start, not switched", async () => {
    const resolved = [resolvedEpisode("dl", "dub-new", 1000)]
    const { deps } = makeDeps(
      { dl: record("dl", "dub-old", "downloaded", 2000) },
      { swap: () => ({ ok: false, reason: "insufficient-storage" }) },
    )
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(summary.switched).toBe(0)
    expect(summary.couldntStart).toBe(1)
  })
})

describe("AE5 — in-progress same-language counts already-present", () => {
  it("does not re-enqueue an episode already downloading in the chosen dub", async () => {
    const resolved = [resolvedEpisode("a", "dub-spanish", 1000)]
    const { deps, calls } = makeDeps({
      a: record("a", "dub-spanish", "downloading", 2000),
    })
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(calls.start).toEqual([])
    expect(calls.swap).toEqual([])
    expect(summary.alreadyPresent).toBe(1)
    expect(summary.allOk).toBe(false) // a skip is not an "all enqueued" batch
  })
})

describe("AE6 — summary buckets from results, not the decision", () => {
  it("a swap that returns exists counts already-present, not switched", async () => {
    const resolved = [resolvedEpisode("dl", "dub-new", 1000)]
    const { deps } = makeDeps(
      { dl: record("dl", "dub-old", "downloaded", 2000) },
      { swap: () => ({ ok: false, reason: "exists" }) },
    )
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(summary.switched).toBe(0)
    expect(summary.alreadyPresent).toBe(1)
  })

  it("formats an enqueue-framed line, suppressing zero buckets", () => {
    const line = formatEnqueueSummary({
      results: [],
      started: 12,
      switched: 1,
      alreadyPresent: 3,
      couldntStart: 0,
      allOk: false,
    })
    expect(line).toBe("12 started · 1 switched · 3 already downloaded")
    expect(line).not.toContain("couldn't start")
  })

  it("an all-ok batch (every episode started or switched) sets allOk", async () => {
    const resolved = [
      resolvedEpisode("a", "dub-a", 1000),
      resolvedEpisode("b", "dub-b", 1000),
    ]
    const { deps } = makeDeps({})
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(summary.allOk).toBe(true)
    expect(summary.started).toBe(2)
  })
})

// ── AE8: all-skipped → no resolved episodes → Confirm disabled ──────

describe("AE8 — all-skipped resolution", () => {
  it("yields an empty resolved set when the language is absent everywhere", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async () => [variant("en", "en-1")],
      getDubMedia: async (dubId) => media([dl(`${dubId}-hi`, "high", "1000")]),
    }
    const res = await resolveSeriesDownload(
      [episode("a"), episode("b")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    // resolvedCount === 0 is what disables Confirm and shows the
    // "none available in {language}" message (distinct from a network error).
    expect(res.resolvedCount).toBe(0)
    expect(res.skippedLanguageCount).toBe(2)
    expect(res.failedCount).toBe(0)
  })
})
