import type {
  EngineTask,
  MediaDownloadHandlers,
  MediaDownloadSpec,
} from "../downloadEngine"
import {
  createDownloadLifecycle,
  retryFailedDownload,
  type DownloadLifecycleDeps,
  type StartDownloadRequest,
} from "../downloadLifecycle"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
} from "../offlineManifest"

// Characterization tests for the lifecycle extracted from DownloadsProvider
// (todo 013): every expectation encodes the provider's pre-extraction behavior.

const ROOT = "file:///offline"
const GOOD_URL = "https://cdn.example/fresh.mp4"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeRequest(
  overrides: Partial<StartDownloadRequest> = {},
): StartDownloadRequest {
  return {
    videoSlug: "washi-gospel-1",
    title: "Washi Gospel — Episode 1",
    dubDocumentId: "dub-1",
    rendition: {
      documentId: "rend-1",
      quality: "High",
      size: "1000",
      url: "https://cdn.example/page.mp4",
    },
    subtitleLanguageSlug: null,
    subtitleUrl: null,
    posterUrl: null,
    allowCellular: false,
    ...overrides,
  }
}

function makeRecord(
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug: "washi-gospel-1",
    dubDocumentId: "dub-1",
    renditionDocumentId: "rend-1",
    qualityLabel: "High",
    title: "Washi Gospel — Episode 1",
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: `${ROOT}/washi-gospel-1/media.rend-1.mp4`,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 1000,
    totalBytes: 1000,
    ...overrides,
  }
}

type HarnessOptions = {
  records?: OfflineDownloadRecord[]
  freeBytes?: number
  /** Existing on-disk uris for fs.fileExists. */
  files?: string[]
  resolveImpl?: DownloadLifecycleDeps["reresolveMediaUrl"]
  engineStartImpl?: (
    spec: MediaDownloadSpec,
    handlers: MediaDownloadHandlers,
  ) => EngineTask
  ensureVideoDirImpl?: (videoSlug: string) => Promise<unknown>
  downloadToFileImpl?: (url: string, destination: string) => Promise<unknown>
  allowCellularForRestart?: boolean
}

function makeHarness(options: HarnessOptions = {}) {
  const records = new Map<string, OfflineDownloadRecord>(
    (options.records ?? []).map((record) => [record.videoSlug, record]),
  )
  const writes: OfflineDownloadRecord[] = []
  const removals: string[] = []
  const calls: string[] = []
  const files = new Set(options.files ?? [])
  const started: Array<{
    spec: MediaDownloadSpec
    handlers: MediaDownloadHandlers
  }> = []

  const fakeTask = (id: string) => ({ id }) as unknown as EngineTask

  const resolveMock = jest.fn(
    options.resolveImpl ??
      (async () => ({ mediaUrl: GOOD_URL, subtitleUrl: null })),
  )
  const engineStart = jest.fn(
    options.engineStartImpl ??
      ((spec: MediaDownloadSpec, handlers: MediaDownloadHandlers) => {
        started.push({ spec, handlers })
        calls.push(`engineStart:${spec.id}`)
        return fakeTask(spec.id)
      }),
  )
  const enginePause = jest.fn(async () => {
    calls.push("enginePause")
  })
  const engineResume = jest.fn(async () => {
    calls.push("engineResume")
  })
  const engineStop = jest.fn(
    async (_task: EngineTask, opts?: { supersede?: boolean }) => {
      calls.push(opts?.supersede ? "engineStop:supersede" : "engineStop")
    },
  )
  const engineWire = jest.fn(
    (task: EngineTask, handlers: MediaDownloadHandlers) => {
      started.push({ spec: { id: "" } as MediaDownloadSpec, handlers })
      calls.push("engineWire")
    },
  )

  const deps: DownloadLifecycleDeps = {
    getRecord: (videoSlug) => records.get(videoSlug),
    writeRecord: async (record) => {
      records.set(record.videoSlug, record)
      writes.push(record)
    },
    removeRecord: async (videoSlug) => {
      records.delete(videoSlug)
      removals.push(videoSlug)
    },
    reresolveMediaUrl: resolveMock,
    allowCellularForRestart: () => options.allowCellularForRestart ?? false,
    onLeaveBatchScope: (videoSlug) => calls.push(`leaveScope:${videoSlug}`),
    onSupersedeScope: (videoSlug) => calls.push(`supersedeScope:${videoSlug}`),
    offlineRoot: ROOT,
    engine: {
      start: engineStart,
      wire: engineWire,
      pause: enginePause,
      resume: engineResume,
      stop: engineStop,
    },
    fs: {
      ensureVideoDir:
        options.ensureVideoDirImpl ?? (async () => calls.push("ensureDir")),
      freeDiskBytes: async () => options.freeBytes ?? Number.MAX_SAFE_INTEGER,
      fileExists: async (uri) => files.has(uri),
      moveFile: async (from, to) => {
        files.delete(from)
        files.add(to)
        calls.push(`moveFile:${to}`)
      },
      removeUri: async (uri) => {
        calls.push(`removeUri:${uri}`)
      },
      removeVideoDir: async (videoSlug) => {
        calls.push(`removeVideoDir:${videoSlug}`)
      },
      downloadToFile:
        options.downloadToFileImpl ??
        (async (_url, destination) => {
          calls.push(`downloadToFile:${destination}`)
        }),
    },
    notifyIosBackgroundComplete: (jobId) => calls.push(`notifyIos:${jobId}`),
  }

  return {
    lifecycle: createDownloadLifecycle(deps),
    records,
    writes,
    removals,
    calls,
    files,
    started,
    resolveMock,
    engineStart,
    enginePause,
    engineResume,
    engineStop,
    fakeTask,
  }
}

describe("start", () => {
  it("refuses a live non-placeholder record with `exists`", async () => {
    const h = makeHarness({ records: [makeRecord()] })
    expect(await h.lifecycle.start(makeRequest())).toEqual({
      ok: false,
      reason: "exists",
    })
    expect(h.engineStart).not.toHaveBeenCalled()
    expect(h.writes).toHaveLength(0)
  })

  it("adopts the batch's own bare-queued placeholder and drives it to downloading", async () => {
    const placeholder = makeRecord({
      state: "queued",
      committedPath: null,
      pendingPath: null,
      bytesWritten: 0,
    })
    const h = makeHarness({ records: [placeholder] })
    expect(await h.lifecycle.start(makeRequest())).toEqual({ ok: true })
    expect(h.records.get("washi-gospel-1")?.state).toBe("downloading")
    expect(h.engineStart).toHaveBeenCalledTimes(1)
  })

  it("storage gate blocks and cleans up only the adopted placeholder", async () => {
    const placeholder = makeRecord({
      state: "queued",
      committedPath: null,
      pendingPath: null,
    })
    const h = makeHarness({ records: [placeholder], freeBytes: 1 })
    expect(await h.lifecycle.start(makeRequest())).toEqual({
      ok: false,
      reason: "insufficient-storage",
    })
    expect(h.removals).toEqual(["washi-gospel-1"])
  })

  it("storage gate leaves a pre-existing terminal record alone", async () => {
    const failed = makeRecord({ state: "failed", committedPath: null })
    const h = makeHarness({ records: [failed], freeBytes: 1 })
    expect(await h.lifecycle.start(makeRequest())).toEqual({
      ok: false,
      reason: "insufficient-storage",
    })
    expect(h.removals).toEqual([])
    expect(h.records.get("washi-gospel-1")).toBe(failed)
  })

  it("bails `canceled` when a mid-await cancel removed the adopted placeholder (review #1)", async () => {
    const placeholder = makeRecord({
      state: "queued",
      committedPath: null,
      pendingPath: null,
    })
    const h: ReturnType<typeof makeHarness> = makeHarness({
      records: [placeholder],
      ensureVideoDirImpl: async () => {
        h.records.delete("washi-gospel-1")
      },
    })
    expect(await h.lifecycle.start(makeRequest())).toEqual({
      ok: false,
      reason: "canceled",
    })
    expect(h.engineStart).not.toHaveBeenCalled()
    expect(h.writes).toHaveLength(0)
  })

  it("bails `canceled` when a cancel lands during the URL re-resolve (review #1)", async () => {
    const h: ReturnType<typeof makeHarness> = makeHarness({
      resolveImpl: async () => {
        h.records.delete("washi-gospel-1")
        return { mediaUrl: GOOD_URL, subtitleUrl: null }
      },
    })
    expect(await h.lifecycle.start(makeRequest())).toEqual({
      ok: false,
      reason: "canceled",
    })
    expect(h.engineStart).not.toHaveBeenCalled()
  })

  it("falls back to the request URL when the re-resolve fails (U4)", async () => {
    const h = makeHarness({ resolveImpl: async () => null })
    expect(await h.lifecycle.start(makeRequest())).toEqual({ ok: true })
    expect(h.started[0].spec.url).toBe("https://cdn.example/page.mp4")
  })

  it("drops the provisional record when no safe URL exists", async () => {
    const request = makeRequest()
    request.rendition = { ...request.rendition, url: "javascript:alert(1)" }
    const h = makeHarness({ resolveImpl: async () => null })
    expect(await h.lifecycle.start(request)).toEqual({
      ok: false,
      reason: "error",
    })
    expect(h.removals).toEqual(["washi-gospel-1"])
  })

  it("drops the provisional record when the engine start throws", async () => {
    const h = makeHarness({
      engineStartImpl: () => {
        throw new Error("no native module")
      },
    })
    expect(await h.lifecycle.start(makeRequest())).toEqual({
      ok: false,
      reason: "error",
    })
    expect(h.removals).toEqual(["washi-gospel-1"])
  })

  it("starts the engine with the fresh URL, pending destination, and request cellular flag", async () => {
    const h = makeHarness()
    const request = makeRequest({ allowCellular: true })
    expect(await h.lifecycle.start(request)).toEqual({ ok: true })
    const { spec } = h.started[0]
    expect(spec.id).toBe("washi-gospel-1")
    expect(spec.url).toBe(GOOD_URL)
    expect(spec.allowCellular).toBe(true)
    expect(spec.destination).toBe(h.records.get("washi-gospel-1")?.pendingPath)
  })
})

describe("swap", () => {
  it("delegates to a fresh start when nothing downloaded exists", async () => {
    const h = makeHarness()
    expect(await h.lifecycle.swap(makeRequest())).toEqual({ ok: true })
    expect(h.records.get("washi-gospel-1")?.swapFrom).toBeUndefined()
  })

  it("returns `exists` for an identical rendition + subtitle", async () => {
    const h = makeHarness({ records: [makeRecord()] })
    expect(await h.lifecycle.swap(makeRequest())).toEqual({
      ok: false,
      reason: "exists",
    })
    expect(h.writes).toHaveLength(0)
  })

  it("snapshots the old copy and writes the mid-swap downloading record", async () => {
    const existing = makeRecord()
    const h = makeHarness({ records: [existing] })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    expect(await h.lifecycle.swap(request)).toEqual({ ok: true })
    const midSwap = h.writes[0]
    expect(midSwap.state).toBe("downloading")
    expect(midSwap.renditionDocumentId).toBe("rend-2")
    expect(midSwap.swapFrom).toEqual({
      committedPath: existing.committedPath,
      renditionDocumentId: "rend-1",
      qualityLabel: "High",
      subtitleLanguageSlug: null,
      totalBytes: 1000,
      posterPath: null,
    })
  })

  // U1 regression: swap() spreads `...existing`, so it must preserve the five
  // series/ordering fields without any explicit copy line.
  it("preserves series/ordering metadata across a swap rewrite (U1 regression)", async () => {
    const existing = makeRecord({
      seriesSlug: "storyclubs",
      seriesTitle: "StoryClubs",
      seriesEpisodeIndex: 2,
      durationSeconds: 725,
      enqueuedAt: 1_753_000_000_000,
    })
    const h = makeHarness({ records: [existing] })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    expect(await h.lifecycle.swap(request)).toEqual({ ok: true })
    const midSwap = h.writes[0]
    expect(midSwap.seriesSlug).toBe("storyclubs")
    expect(midSwap.seriesTitle).toBe("StoryClubs")
    expect(midSwap.seriesEpisodeIndex).toBe(2)
    expect(midSwap.durationSeconds).toBe(725)
    expect(midSwap.enqueuedAt).toBe(1_753_000_000_000)
  })

  // Review #11: a watch-route original has no index/duration; a later batch
  // swap's request does — the swap must adopt them or the episode sorts last.
  it("adopts the request's seriesEpisodeIndex/durationSeconds when the existing record lacks them", async () => {
    const existing = makeRecord({ seriesSlug: "storyclubs" })
    const h = makeHarness({ records: [existing] })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    request.seriesEpisodeIndex = 4
    request.durationSeconds = 300
    expect(await h.lifecycle.swap(request)).toEqual({ ok: true })
    const midSwap = h.writes[0]
    expect(midSwap.seriesEpisodeIndex).toBe(4)
    expect(midSwap.durationSeconds).toBe(300)
  })

  it("bails `canceled` when a cancel reverted the record during re-resolve", async () => {
    const existing = makeRecord()
    const h: ReturnType<typeof makeHarness> = makeHarness({
      records: [existing],
      resolveImpl: async () => {
        // Simulate cancel's revert landing mid-await: back to the old copy.
        h.records.set("washi-gospel-1", existing)
        return { mediaUrl: GOOD_URL, subtitleUrl: null }
      },
    })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    expect(await h.lifecycle.swap(request)).toEqual({
      ok: false,
      reason: "canceled",
    })
    expect(h.engineStart).not.toHaveBeenCalled()
  })

  it("restores the pre-swap record when no safe URL exists (old copy untouched)", async () => {
    const existing = makeRecord()
    const h = makeHarness({
      records: [existing],
      resolveImpl: async () => null,
    })
    const request = makeRequest()
    request.rendition = {
      ...request.rendition,
      documentId: "rend-2",
      url: "javascript:alert(1)",
    }
    expect(await h.lifecycle.swap(request)).toEqual({
      ok: false,
      reason: "error",
    })
    expect(h.records.get("washi-gospel-1")).toEqual(existing)
  })

  it("restores the pre-swap record when the engine start throws", async () => {
    const existing = makeRecord()
    const h = makeHarness({
      records: [existing],
      engineStartImpl: () => {
        throw new Error("session init failure")
      },
    })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    expect(await h.lifecycle.swap(request)).toEqual({
      ok: false,
      reason: "error",
    })
    expect(h.records.get("washi-gospel-1")).toEqual(existing)
  })
})

describe("restart", () => {
  const paused = makeRecord({
    state: "paused",
    committedPath: null,
    pendingPath: `${ROOT}/washi-gospel-1/media.n1.pending`,
    bytesWritten: 400,
  })

  it("dedupes concurrent restarts (U3 double-tap resume)", async () => {
    let release!: (value: null) => void
    const gate = new Promise<null>((resolve) => {
      release = resolve
    })
    const h = makeHarness({
      records: [paused],
      resolveImpl: () => gate,
    })
    const first = h.lifecycle.restart(paused)
    const second = h.lifecycle.restart(paused)
    release(null)
    await Promise.all([first, second])
    expect(h.resolveMock).toHaveBeenCalledTimes(1)
  })

  it("leaves the record untouched when the re-resolve fails (next launch retries)", async () => {
    const h = makeHarness({ records: [paused], resolveImpl: async () => null })
    await h.lifecycle.restart(paused)
    expect(h.writes).toHaveLength(0)
    expect(h.engineStart).not.toHaveBeenCalled()
  })

  // D2: a delete/cancel racing the re-resolve must not resurrect the record a
  // retry-tap just deleted (only latent while restart was single-flight-only).
  it("bails when the record was deleted during the re-resolve — no write, no engine start", async () => {
    const h: ReturnType<typeof makeHarness> = makeHarness({
      records: [paused],
      resolveImpl: async () => {
        h.records.delete("washi-gospel-1")
        return { mediaUrl: GOOD_URL, subtitleUrl: null }
      },
    })
    await h.lifecycle.restart(paused)
    expect(h.writes).toHaveLength(0)
    expect(h.engineStart).not.toHaveBeenCalled()
    expect(h.records.has("washi-gospel-1")).toBe(false)
  })

  // D2 identity gap: delete-then-fresh-start installs a NEW record object at
  // the same slug during the re-resolve — an existence check alone would pass
  // and clobber it. Only reference-identity catches this interleaving.
  it("bails when the record was replaced (a fresh start) during the re-resolve — the fresh record survives untouched", async () => {
    const fresh = makeRecord({
      state: "downloading",
      committedPath: null,
      pendingPath: `${ROOT}/washi-gospel-1/media.fresh.pending`,
      bytesWritten: 0,
    })
    const h: ReturnType<typeof makeHarness> = makeHarness({
      records: [paused],
      resolveImpl: async () => {
        h.records.set("washi-gospel-1", fresh)
        return { mediaUrl: GOOD_URL, subtitleUrl: null }
      },
    })
    await h.lifecycle.restart(paused)
    expect(h.writes).toHaveLength(0)
    expect(h.engineStart).not.toHaveBeenCalled()
    expect(h.records.get("washi-gospel-1")).toBe(fresh)
  })

  it("reuses the record's pending path and the live cellular preference", async () => {
    const h = makeHarness({ records: [paused], allowCellularForRestart: true })
    await h.lifecycle.restart(paused)
    const { spec } = h.started[0]
    expect(spec.destination).toBe(paused.pendingPath)
    expect(spec.allowCellular).toBe(true)
    expect(h.records.get("washi-gospel-1")?.state).toBe("downloading")
    expect(h.records.get("washi-gospel-1")?.bytesWritten).toBe(0)
  })

  it("marks the record failed when the engine start throws (no phantom downloading)", async () => {
    const h = makeHarness({
      records: [paused],
      engineStartImpl: () => {
        throw new Error("boom")
      },
    })
    await h.lifecycle.restart(paused)
    expect(h.records.get("washi-gospel-1")?.state).toBe("failed")
  })

  // U1 regression: restart() spreads `...record`, so it must preserve the
  // five series/ordering fields without any explicit copy line.
  it("preserves series/ordering metadata across a restart rewrite (U1 regression)", async () => {
    const pausedWithSeries = makeRecord({
      state: "paused",
      committedPath: null,
      pendingPath: `${ROOT}/washi-gospel-1/media.n1.pending`,
      bytesWritten: 400,
      seriesSlug: "storyclubs",
      seriesTitle: "StoryClubs",
      seriesEpisodeIndex: 2,
      durationSeconds: 725,
      enqueuedAt: 1_753_000_000_000,
    })
    const h = makeHarness({ records: [pausedWithSeries] })
    await h.lifecycle.restart(pausedWithSeries)
    const record = h.records.get("washi-gospel-1")
    expect(record?.seriesSlug).toBe("storyclubs")
    expect(record?.seriesTitle).toBe("StoryClubs")
    expect(record?.seriesEpisodeIndex).toBe(2)
    expect(record?.durationSeconds).toBe(725)
    expect(record?.enqueuedAt).toBe(1_753_000_000_000)
  })
})

describe("retryFailedDownload (DownloadsProvider retry guard — Part A)", () => {
  const failed = makeRecord({
    state: "failed",
    committedPath: null,
    pendingPath: `${ROOT}/washi-gospel-1/media.n1.pending`,
  })

  it("retries a failed record: restart runs and it goes downloading", async () => {
    const h = makeHarness({ records: [failed] })
    await retryFailedDownload(
      {
        getRecord: (slug) => h.records.get(slug),
        restart: h.lifecycle.restart,
      },
      "washi-gospel-1",
    )
    expect(h.records.get("washi-gospel-1")?.state).toBe("downloading")
    expect(h.engineStart).toHaveBeenCalledTimes(1)
  })

  // Review #2: release the batch slot before restarting, or a retried episode
  // re-occupies the sequential batch slot and stalls still-queued siblings.
  it("releases the batch scope before restarting a failed record", async () => {
    const h = makeHarness({ records: [failed] })
    const events: string[] = []
    const onLeaveBatchScope = jest.fn((slug: string) => {
      events.push(`scope:${slug}`)
    })
    await retryFailedDownload(
      {
        getRecord: (slug) => h.records.get(slug),
        restart: async (record) => {
          events.push("restart")
          await h.lifecycle.restart(record)
        },
        onLeaveBatchScope,
      },
      "washi-gospel-1",
    )
    expect(onLeaveBatchScope).toHaveBeenCalledWith("washi-gospel-1")
    expect(events).toEqual(["scope:washi-gospel-1", "restart"])
  })

  it("leaves the batch scope untouched for a non-failed record", async () => {
    const record = makeRecord({ state: "queued" })
    const h = makeHarness({ records: [record] })
    const onLeaveBatchScope = jest.fn()
    await retryFailedDownload(
      {
        getRecord: (slug) => h.records.get(slug),
        restart: h.lifecycle.restart,
        onLeaveBatchScope,
      },
      "washi-gospel-1",
    )
    expect(onLeaveBatchScope).not.toHaveBeenCalled()
  })

  it.each(["downloaded", "downloading", "queued", "paused"] as const)(
    "no-ops on a %s record (restart not called)",
    async (state) => {
      const record = makeRecord({ state })
      const h = makeHarness({ records: [record] })
      await retryFailedDownload(
        {
          getRecord: (slug) => h.records.get(slug),
          restart: h.lifecycle.restart,
        },
        "washi-gospel-1",
      )
      expect(h.engineStart).not.toHaveBeenCalled()
      expect(h.resolveMock).not.toHaveBeenCalled()
      expect(h.records.get("washi-gospel-1")).toBe(record)
    },
  )

  it("no-ops on a missing record", async () => {
    const h = makeHarness()
    await retryFailedDownload(
      {
        getRecord: (slug) => h.records.get(slug),
        restart: h.lifecycle.restart,
      },
      "washi-gospel-1",
    )
    expect(h.engineStart).not.toHaveBeenCalled()
    expect(h.resolveMock).not.toHaveBeenCalled()
  })

  // AE8: a null re-resolution leaves restart's existing no-write behavior
  // untouched — the retry wrapper adds no delete/removal of its own.
  it("AE8: a null re-resolution leaves the record failed, untouched", async () => {
    const h = makeHarness({ records: [failed], resolveImpl: async () => null })
    await retryFailedDownload(
      {
        getRecord: (slug) => h.records.get(slug),
        restart: h.lifecycle.restart,
      },
      "washi-gospel-1",
    )
    expect(h.records.get("washi-gospel-1")).toBe(failed)
    expect(h.removals).toHaveLength(0)
    expect(h.engineStart).not.toHaveBeenCalled()
  })
})

describe("native handlers", () => {
  async function startAndGetHandlers(
    harnessOptions: HarnessOptions = {},
    request = makeRequest(),
  ) {
    const h = makeHarness(harnessOptions)
    expect(await h.lifecycle.start(request)).toEqual({ ok: true })
    const { spec, handlers } = h.started[0]
    return { h, spec, handlers }
  }

  it("onBegin prefers the OS size, falling back to the request size", async () => {
    const { h, handlers } = await startAndGetHandlers()
    handlers.onBegin?.({ expectedBytes: 5000 })
    expect(h.records.get("washi-gospel-1")?.totalBytes).toBe(5000)
    handlers.onBegin?.({ expectedBytes: 0 })
    expect(h.records.get("washi-gospel-1")?.totalBytes).toBe(1000)
  })

  it("onProgress patches byte counters", async () => {
    const { h, handlers } = await startAndGetHandlers()
    handlers.onProgress({ bytesDownloaded: 250, bytesTotal: 2000 })
    const record = h.records.get("washi-gospel-1")
    expect(record?.bytesWritten).toBe(250)
    expect(record?.totalBytes).toBe(2000)
  })

  it("onDone commits: pending → committed move, downloaded record, iOS signal last", async () => {
    const { h, spec, handlers } = await startAndGetHandlers()
    h.files.add(spec.destination)
    handlers.onDone({ location: spec.destination, bytesTotal: 1000 })
    await settle()
    const record = h.records.get("washi-gospel-1")
    expect(record?.state).toBe("downloaded")
    expect(record?.committedPath).toBe(`${ROOT}/washi-gospel-1/rend-1.mp4`)
    expect(record?.pendingPath).toBeNull()
    const moveIndex = h.calls.findIndex((call) => call.startsWith("moveFile:"))
    const notifyIndex = h.calls.indexOf("notifyIos:washi-gospel-1")
    expect(moveIndex).toBeGreaterThanOrEqual(0)
    expect(notifyIndex).toBeGreaterThan(moveIndex)
  })

  it("onDone degrades a terminally-failed subtitle instead of failing the bundle (KTD4)", async () => {
    const request = makeRequest({
      subtitleLanguageSlug: "korean",
      subtitleUrl: "https://cdn.example/s.vtt",
    })
    const { h, spec, handlers } = await startAndGetHandlers(
      {
        downloadToFileImpl: async () => {
          throw new Error("subtitle fetch failed")
        },
      },
      request,
    )
    h.files.add(spec.destination)
    handlers.onDone({ location: spec.destination, bytesTotal: 1000 })
    await settle()
    const record = h.records.get("washi-gospel-1")
    expect(record?.state).toBe("downloaded")
    expect(record?.subtitleLanguageSlug).toBeNull()
  })

  it("onDone after a swap deletes the old file only when paths differ", async () => {
    const existing = makeRecord({
      committedPath: `${ROOT}/washi-gospel-1/media.rend-old.mp4`,
      renditionDocumentId: "rend-old",
    })
    const h = makeHarness({ records: [existing] })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    expect(await h.lifecycle.swap(request)).toEqual({ ok: true })
    const { spec, handlers } = h.started[0]
    h.files.add(spec.destination)
    handlers.onDone({ location: spec.destination, bytesTotal: 1000 })
    await settle()
    expect(h.calls).toContain(
      `removeUri:${ROOT}/washi-gospel-1/media.rend-old.mp4`,
    )
    expect(h.records.get("washi-gospel-1")?.swapFrom).toBeNull()
  })

  it("subtitle-only swap keeps the just-committed file — same-path guard, no delete", async () => {
    // Same rendition, different subtitle: new committedPath EQUALS the old, so
    // the "remove superseded old file" step must NOT delete what it just wrote.
    const committed = `${ROOT}/washi-gospel-1/rend-1.mp4`
    const existing = makeRecord({
      renditionDocumentId: "rend-1",
      committedPath: committed,
      subtitleLanguageSlug: null,
    })
    const h = makeHarness({ records: [existing] })
    const request = makeRequest({
      subtitleLanguageSlug: "korean",
      subtitleUrl: "https://cdn.example/s.vtt",
    })
    expect(await h.lifecycle.swap(request)).toEqual({ ok: true })
    const { spec, handlers } = h.started[0]
    h.files.add(spec.destination)
    handlers.onDone({ location: spec.destination, bytesTotal: 1000 })
    await settle()
    expect(h.calls).not.toContain(`removeUri:${committed}`)
    const record = h.records.get("washi-gospel-1")
    expect(record?.state).toBe("downloaded")
    expect(record?.committedPath).toBe(committed)
    expect(record?.swapFrom).toBeNull()
  })

  it("onDone with an unresolvable requested subtitle fails the bundle (incomplete branch)", async () => {
    // Subtitle requested, no persisted URL, and the start path has no lazy
    // resolver → resolveBundle returns "incomplete" → the record fails.
    const request = makeRequest({
      subtitleLanguageSlug: "korean",
      subtitleUrl: null,
    })
    const { h, spec, handlers } = await startAndGetHandlers({}, request)
    h.files.add(spec.destination)
    handlers.onDone({ location: spec.destination, bytesTotal: 1000 })
    await settle()
    expect(h.records.get("washi-gospel-1")?.state).toBe("failed")
  })

  it("onDone incomplete-bundle reverts an in-flight swap to the old copy (AE2)", async () => {
    const existing = makeRecord({ renditionDocumentId: "rend-old" })
    const h = makeHarness({ records: [existing] })
    const request = makeRequest({
      subtitleLanguageSlug: "korean",
      subtitleUrl: null,
    })
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    expect(await h.lifecycle.swap(request)).toEqual({ ok: true })
    const { spec, handlers } = h.started[0]
    h.files.add(spec.destination)
    handlers.onDone({ location: spec.destination, bytesTotal: 1000 })
    await settle()
    const record = h.records.get("washi-gospel-1")
    expect(record?.state).toBe("downloaded")
    expect(record?.renditionDocumentId).toBe("rend-old")
    expect(record?.swapFrom).toBeNull()
  })

  it("onDone with no file anywhere reverts a swap to the old copy (AE2)", async () => {
    const existing = makeRecord({ renditionDocumentId: "rend-old" })
    const h = makeHarness({ records: [existing] })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    expect(await h.lifecycle.swap(request)).toEqual({ ok: true })
    const { spec, handlers } = h.started[0]
    handlers.onDone({ location: spec.destination, bytesTotal: 1000 })
    await settle()
    const record = h.records.get("washi-gospel-1")
    expect(record?.state).toBe("downloaded")
    expect(record?.renditionDocumentId).toBe("rend-old")
    expect(record?.swapFrom).toBeNull()
    expect(h.calls).toContain(`removeUri:${spec.destination}`)
  })

  it("onInterruption `canceled` BEFORE onBegin never deletes (KTD3 supersede stale terminal)", async () => {
    const { h, handlers } = await startAndGetHandlers()
    handlers.onInterruption({ state: "canceled", keepBytes: false })
    await settle()
    expect(h.records.has("washi-gospel-1")).toBe(true)
    expect(h.calls).not.toContain("removeVideoDir:washi-gospel-1")
  })

  it("onInterruption `canceled` on a paused record never deletes (KTD2 pause-as-cancel)", async () => {
    const { h, handlers } = await startAndGetHandlers()
    handlers.onBegin?.({ expectedBytes: 1000 })
    const current = h.records.get("washi-gospel-1")!
    h.records.set("washi-gospel-1", { ...current, state: "paused" })
    handlers.onInterruption({ state: "canceled", keepBytes: false })
    await settle()
    expect(h.records.has("washi-gospel-1")).toBe(true)
  })

  it("onInterruption genuine cancel deletes the download and leaves the batch scope", async () => {
    const { h, handlers } = await startAndGetHandlers()
    handlers.onBegin?.({ expectedBytes: 1000 })
    handlers.onInterruption({ state: "canceled", keepBytes: false })
    await settle()
    expect(h.records.has("washi-gospel-1")).toBe(false)
    expect(h.calls).toContain("leaveScope:washi-gospel-1")
    expect(h.calls).toContain("removeVideoDir:washi-gospel-1")
  })

  it("onInterruption failure patches the classified state; a swap reverts instead", async () => {
    const { h, handlers } = await startAndGetHandlers()
    handlers.onInterruption({ state: "failed", keepBytes: true })
    await settle()
    expect(h.records.get("washi-gospel-1")?.state).toBe("failed")

    const existing = makeRecord({ renditionDocumentId: "rend-old" })
    const h2 = makeHarness({ records: [existing] })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    await h2.lifecycle.swap(request)
    h2.started[0].handlers.onInterruption({ state: "paused", keepBytes: true })
    await settle()
    expect(h2.records.get("washi-gospel-1")?.renditionDocumentId).toBe(
      "rend-old",
    )
    expect(h2.records.get("washi-gospel-1")?.state).toBe("downloaded")
  })
})

describe("in-flight controls", () => {
  async function startedHarness() {
    const h = makeHarness()
    await h.lifecycle.start(makeRequest())
    return h
  }

  it("pause writes paused and pauses the live task; no-ops without one", async () => {
    const h = await startedHarness()
    await h.lifecycle.pause("washi-gospel-1")
    expect(h.records.get("washi-gospel-1")?.state).toBe("paused")
    expect(h.enginePause).toHaveBeenCalledTimes(1)

    const cold = makeHarness({ records: [makeRecord()] })
    await cold.lifecycle.pause("washi-gospel-1")
    expect(cold.enginePause).not.toHaveBeenCalled()
    expect(cold.writes).toHaveLength(0)
  })

  it("resume continues in place with a live task", async () => {
    const h = await startedHarness()
    await h.lifecycle.pause("washi-gospel-1")
    await h.lifecycle.resume("washi-gospel-1")
    expect(h.records.get("washi-gospel-1")?.state).toBe("downloading")
    expect(h.engineResume).toHaveBeenCalledTimes(1)
    expect(h.resolveMock).toHaveBeenCalledTimes(1) // start only, no restart
  })

  it("resume restarts cleanly when no task survived (R5/AE4)", async () => {
    const paused = makeRecord({
      state: "paused",
      committedPath: null,
      pendingPath: `${ROOT}/washi-gospel-1/media.n1.pending`,
    })
    const h = makeHarness({ records: [paused] })
    await h.lifecycle.resume("washi-gospel-1")
    expect(h.engineResume).not.toHaveBeenCalled()
    expect(h.engineStart).toHaveBeenCalledTimes(1)
    expect(h.records.get("washi-gospel-1")?.state).toBe("downloading")
  })

  it("cancel leaves the batch scope even when the record is a downloaded waiter (P2 fix)", async () => {
    const h = makeHarness({ records: [makeRecord()] })
    await h.lifecycle.cancel("washi-gospel-1")
    expect(h.calls).toEqual(["leaveScope:washi-gospel-1"])
    expect(h.records.get("washi-gospel-1")?.state).toBe("downloaded")
  })

  it("cancel mid-swap reverts to the old copy and drops the partial", async () => {
    const existing = makeRecord({ renditionDocumentId: "rend-old" })
    const h = makeHarness({ records: [existing] })
    const request = makeRequest()
    request.rendition = { ...request.rendition, documentId: "rend-2" }
    await h.lifecycle.swap(request)
    const pendingPath = h.records.get("washi-gospel-1")?.pendingPath
    await h.lifecycle.cancel("washi-gospel-1")
    const record = h.records.get("washi-gospel-1")
    expect(record?.state).toBe("downloaded")
    expect(record?.renditionDocumentId).toBe("rend-old")
    expect(record?.swapFrom).toBeNull()
    expect(h.calls).toContain(`removeUri:${pendingPath}`)
    expect(h.engineStop).toHaveBeenCalledTimes(1)
  })

  it("cancel of a fresh in-flight download stops the task and removes everything", async () => {
    const h = await startedHarness()
    await h.lifecycle.cancel("washi-gospel-1")
    expect(h.engineStop).toHaveBeenCalledWith(expect.anything())
    expect(h.calls).toContain("removeVideoDir:washi-gospel-1")
    expect(h.records.has("washi-gospel-1")).toBe(false)
  })

  it("supersede stops with neutralized callbacks and keeps the record (U4)", async () => {
    const h = await startedHarness()
    await h.lifecycle.supersede("washi-gospel-1")
    expect(h.calls).toContain("supersedeScope:washi-gospel-1")
    expect(h.calls).toContain("engineStop:supersede")
    expect(h.records.get("washi-gospel-1")?.state).toBe("downloading")

    // Scope teardown happens even when no live task exists.
    const cold = makeHarness()
    await cold.lifecycle.supersede("gone")
    expect(cold.calls).toEqual(["supersedeScope:gone"])
  })

  it("deleteDownload stops the live task before removing files and record (R1)", async () => {
    const h = await startedHarness()
    await h.lifecycle.deleteDownload("washi-gospel-1")
    const stopIndex = h.calls.indexOf("engineStop")
    const dirIndex = h.calls.indexOf("removeVideoDir:washi-gospel-1")
    expect(stopIndex).toBeGreaterThanOrEqual(0)
    expect(dirIndex).toBeGreaterThan(stopIndex)
    expect(h.records.has("washi-gospel-1")).toBe(false)
    expect(h.calls).toContain("leaveScope:washi-gospel-1")
  })
})

describe("wireTask (launch reattach)", () => {
  it("re-binds handlers so a post-relaunch done still commits (U6/R3)", async () => {
    const record = makeRecord({
      state: "downloading",
      committedPath: null,
      pendingPath: `${ROOT}/washi-gospel-1/media.n1.pending`,
      subtitleLanguageSlug: "korean",
    })
    const h = makeHarness({
      records: [record],
      resolveImpl: async () => ({
        mediaUrl: GOOD_URL,
        subtitleUrl: "https://cdn.example/fresh.vtt",
      }),
      files: [`${ROOT}/washi-gospel-1/media.n1.pending`],
    })
    h.lifecycle.wireTask(h.fakeTask("washi-gospel-1"), record)
    const { handlers } = h.started[0]
    handlers.onDone({
      location: `${ROOT}/washi-gospel-1/media.n1.pending`,
      bytesTotal: 1000,
    })
    await settle()
    const committed = h.records.get("washi-gospel-1")
    expect(committed?.state).toBe("downloaded")
    // The subtitle URL was re-resolved lazily at commit and fetched.
    expect(h.resolveMock).toHaveBeenCalledTimes(1)
    expect(committed?.subtitleLanguageSlug).toBe("korean")
  })
})
