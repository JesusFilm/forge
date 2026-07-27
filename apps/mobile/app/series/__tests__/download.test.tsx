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
  runSeriesBatchEnqueue,
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
  // Defaults to the rendition resolvedEpisode() produces (`${slug}-r`) so a
  // same-dub record reads as "already present" unless a test opts into a change.
  renditionDocumentId = `${videoSlug}-r`,
  subtitleLanguageSlug: string | null = null,
): OfflineDownloadRecord => ({
  version: 1,
  videoSlug,
  dubDocumentId,
  renditionDocumentId,
  qualityLabel: "high",
  title: "",
  subtitleLanguageSlug,
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
    tierTotals: {
      Highest: { bytes: 0, isLowerBound: false },
      High: { bytes: 0, isLowerBound: false },
      Low: { bytes: 0, isLowerBound: false },
    },
  }
}

const ctx = {
  subtitleLanguageSlug: null,
  allowCellular: true,
  seriesSlug: "storyclubs",
  seriesTitle: "StoryClubs",
  enqueuedAt: 1_753_000_000_000,
}

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
      ...ctx,
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

  // U1: seriesSlug/seriesTitle/enqueuedAt come from ctx (batch-level);
  // seriesEpisodeIndex/durationSeconds come from the resolved episode itself.
  it("attaches series/ordering metadata to the built request", () => {
    const ep: SeriesEpisodeResolution = {
      ...resolvedEpisode("a", "dub-a", 1000),
      seriesEpisodeIndex: 3,
      durationSeconds: 725,
    }
    const req = buildEpisodeRequest(ep, ctx)
    expect(req?.seriesSlug).toBe("storyclubs")
    expect(req?.seriesTitle).toBe("StoryClubs")
    expect(req?.seriesEpisodeIndex).toBe(3)
    expect(req?.durationSeconds).toBe(725)
    expect(req?.enqueuedAt).toBe(1_753_000_000_000)
  })

  it("keeps the subtitle slug when the episode carries the chosen track", () => {
    const ep: SeriesEpisodeResolution = {
      ...resolvedEpisode("a", "dub-a", 1000),
      subtitleUrl: "vtt-fr",
    }
    const req = buildEpisodeRequest(ep, { ...ctx, subtitleLanguageSlug: "fr" })
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
      subtitleLanguageSlug: null,
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
      subtitleLanguageSlug: null,
    })
    expect(gate.kind).toBe("insufficient")
    if (gate.kind === "insufficient") {
      expect(gate.requiredBytes).toBe(RESERVE + 1000 + 5000)
    }
  })

  it("does NOT budget the old bytes of a switch target (it reclaims first)", () => {
    const resolution = resolutionOf([resolvedEpisode("a", "dub-NEW", 1000)])
    // Episode is IN-PROGRESS in a different dub → a switch, which deletes the old
    // copy before starting. Those 5000 old bytes are reclaimed, so they must NOT
    // count toward required — unlike the swap test above, which DOES retain them.
    const getRecord = (slug: string) =>
      slug === "a" ? record("a", "dub-OLD", "downloading", 5000) : null
    const free = RESERVE + 1000 + 1 // covers ONLY new + reserve, not the old copy
    const gate = evaluateStorageGate({
      resolution,
      getRecord,
      freeBytes: free,
      reserveBytes: RESERVE,
      subtitleLanguageSlug: null,
    })
    expect(gate.kind).toBe("ok")
    if (gate.kind === "ok") {
      expect(gate.requiredBytes).toBe(RESERVE + 1000) // no old bytes added
    }
  })

  it("allows a lower-bound total that fits, flagging it (KTD6/R12 relax)", () => {
    const resolution = {
      ...resolutionOf([resolvedEpisode("a", "dub-a", 0)]),
      totalIsLowerBound: true,
    }
    const gate = evaluateStorageGate({
      resolution,
      getRecord: noRecord,
      freeBytes: Number.MAX_SAFE_INTEGER,
      reserveBytes: RESERVE,
      subtitleLanguageSlug: null,
    })
    expect(gate.kind).toBe("ok")
    if (gate.kind === "ok") expect(gate.lowerBound).toBe(true)
  })

  it("still blocks a lower-bound total when the known sum won't fit", () => {
    const resolution = {
      ...resolutionOf([resolvedEpisode("a", "dub-a", 1000)]),
      totalIsLowerBound: true,
    }
    const gate = evaluateStorageGate({
      resolution,
      getRecord: noRecord,
      freeBytes: RESERVE, // 1000 over budget
      reserveBytes: RESERVE,
      subtitleLanguageSlug: null,
    })
    expect(gate.kind).toBe("insufficient")
  })

  it("blocks when free space is unreadable (freeDiskBytes returned 0)", () => {
    const resolution = resolutionOf([resolvedEpisode("a", "dub-a", 1000)])
    const gate = evaluateStorageGate({
      resolution,
      getRecord: noRecord,
      freeBytes: 0,
      reserveBytes: RESERVE,
      subtitleLanguageSlug: null,
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
      subtitleLanguageSlug: null,
    })
    expect(gate.kind).toBe("ok")
  })
})

// ── AE4 / AE5 / AE6: enqueue routing + result-derived buckets ───────

type Calls = {
  start: string[]
  supersede: string[]
  delete: string[]
  queue: string[]
  /** Interleaved log of provider calls so a test can assert ordering. */
  order: string[]
}

function makeDeps(
  records: Record<string, OfflineDownloadRecord>,
  results: {
    start?: (req: StartDownloadRequest) => StartDownloadResult
  } = {},
) {
  const calls: Calls = {
    start: [],
    supersede: [],
    delete: [],
    queue: [],
    order: [],
  }
  // start AND swap both flow through startDownload (the sequential queue); the
  // pump decides start-vs-swap at run time, so tests assert via the summary.
  const deps = {
    getRecord: (slug: string) => records[slug] ?? null,
    startDownload: async (req: StartDownloadRequest) => {
      calls.start.push(req.videoSlug)
      calls.order.push(`start:${req.videoSlug}`)
      return results.start?.(req) ?? ({ ok: true } as StartDownloadResult)
    },
    supersedeDownload: async (slug: string) => {
      calls.supersede.push(slug)
      calls.order.push(`supersede:${slug}`)
    },
    deleteDownload: async (slug: string) => {
      calls.delete.push(slug)
      calls.order.push(`delete:${slug}`)
    },
    queueBatchRecords: async (reqs: StartDownloadRequest[]) => {
      for (const req of reqs) {
        calls.queue.push(req.videoSlug)
        calls.order.push(`queue:${req.videoSlug}`)
      }
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

    // start, swap AND switch all flow through the sequential queue (startDownload).
    expect(calls.start.sort()).toEqual(["dl", "new", "prog"])
    expect(calls.delete).toEqual(["prog"]) // switch cancels the in-flight first
    expect(summary.started).toBe(1) // "new"
    expect(summary.switched).toBe(2) // "dl" swap + "prog" switch
    expect(summary.alreadyPresent).toBe(1) // "same"
  })

  it("swaps a same-language episode when only the quality (rendition) changed", async () => {
    // Downloaded in the SAME dub but a DIFFERENT rendition → re-download at the
    // new quality (swap → queue), not a skip. This is the "Change quality" case.
    const resolved = [resolvedEpisode("q", "dub-x", 1000)] // rendition "q-r"
    const { deps, calls } = makeDeps({
      q: record("q", "dub-x", "downloaded", 2000, "q-OLD"),
    })
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(calls.start).toEqual(["q"]) // queued for a sequential swap
    expect(summary.switched).toBe(1)
    expect(summary.alreadyPresent).toBe(0)
  })

  it("a swap whose queue accept fails is reported couldn't-start, not switched", async () => {
    const resolved = [resolvedEpisode("dl", "dub-new", 1000)]
    const { deps } = makeDeps(
      { dl: record("dl", "dub-old", "downloaded", 2000) },
      { start: () => ({ ok: false, reason: "insufficient-storage" }) },
    )
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(summary.switched).toBe(0)
    expect(summary.couldntStart).toBe(1)
  })

  it("a start that returns insufficient-storage is bucketed couldn't-start", async () => {
    const resolved = [resolvedEpisode("new", "dub-new", 1000)]
    const { deps } = makeDeps(
      {}, // no record → start path
      { start: () => ({ ok: false, reason: "insufficient-storage" }) },
    )
    const summary = await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(summary.started).toBe(0)
    expect(summary.couldntStart).toBe(1)
    expect(summary.allOk).toBe(false)
  })

  it("the switch path supersedes the old task, then clears + restarts (U4/AE2)", async () => {
    // In-progress in the old language → switch: supersede the old task (stop +
    // neutralize) BEFORE clearing its record and starting fresh, so the old
    // task's async cancel can't delete the replacement on the reused slug; then
    // persist a recoverable queued placeholder so a kill in the gap is recoverable.
    const resolved = [resolvedEpisode("prog", "dub-spanish", 1000)]
    const { deps, calls } = makeDeps({
      prog: record("prog", "dub-english", "downloading", 2000),
    })
    await enqueueResolvedEpisodes(resolved, ctx, deps)
    expect(calls.supersede).toEqual(["prog"])
    expect(calls.delete).toEqual(["prog"])
    expect(calls.queue).toEqual(["prog"])
    expect(calls.start).toEqual(["prog"])
    // Order matters: supersede → delete → queue → start (F2 fix).
    expect(calls.order).toEqual([
      "supersede:prog",
      "delete:prog",
      "queue:prog",
      "start:prog",
    ])
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
    expect(summary.alreadyPresent).toBe(1)
    expect(summary.allOk).toBe(false) // a skip is not an "all enqueued" batch
  })
})

describe("AE6 — summary buckets from results, not the decision", () => {
  it("a swap that returns exists counts already-present, not switched", async () => {
    const resolved = [resolvedEpisode("dl", "dub-new", 1000)]
    const { deps } = makeDeps(
      { dl: record("dl", "dub-old", "downloaded", 2000) },
      { start: () => ({ ok: false, reason: "exists" }) },
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

describe("R10 — runSeriesBatchEnqueue snapshots before writing placeholders", () => {
  it("a fresh episode still starts even though queueBatchRecords writes its placeholder", async () => {
    // A live store models the provider: queueBatchRecords writes a `queued`
    // placeholder (in the chosen dub) into it, getRecord reads from it. If the
    // snapshot ran AFTER the queue, the loop would read that placeholder, see the
    // same dub, and SKIP — zero starts. Snapshot-first must keep the start.
    const store: Record<string, OfflineDownloadRecord> = {}
    const started: string[] = []
    const resolved = [resolvedEpisode("new", "dub-a", 1000)]
    const summary = await runSeriesBatchEnqueue(resolved, ctx, {
      getRecord: (slug) => store[slug] ?? null,
      startDownload: async (req: StartDownloadRequest) => {
        started.push(req.videoSlug)
        return { ok: true } as StartDownloadResult
      },
      supersedeDownload: async () => {},
      deleteDownload: async (slug: string) => {
        delete store[slug]
      },
      queueBatchRecords: async (reqs: StartDownloadRequest[]) => {
        for (const req of reqs) {
          store[req.videoSlug] = record(
            req.videoSlug,
            req.dubDocumentId,
            "queued",
          )
        }
      },
    })
    expect(started).toEqual(["new"])
    expect(summary.started).toBe(1)
  })
})
