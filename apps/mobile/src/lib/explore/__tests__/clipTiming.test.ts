/**
 * Clip timing acquisition (KTD20, KTD24). The cases run the real cue cache
 * over a fake fetch, with real production tracks, unless a case needs a byte
 * count that the cache's cap would refuse; those cases inject a loader.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// The module's singleton binds AsyncStorage at import; the cases never reach it.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { parseVtt } from "../../parseVtt"
import {
  peekVttCues,
  resetVttCacheForTests,
  VTT_FETCH_TIMEOUT_MS,
  VTT_MAX_BYTES,
  type VttLoadResult,
} from "../../vttCache"
import {
  CLIP_TIMING_HYDRATE_TIMEOUT_MS,
  CLIP_TIMING_MAX_AGE_MS,
  CLIP_TIMING_MAX_VERDICTS,
  CLIP_TIMING_STORAGE_KEY,
  CLIP_TIMING_VERSION,
  createClipTimingSource,
  eligibleStartsSlot,
  parseStoredClipTimingVerdicts,
  PROBE_MAX_CONSECUTIVE_FAILURES,
  PROBE_MAX_FAILED_BYTES,
  serializeClipTimingVerdicts,
  type ClipTimingRequest,
  type ClipTimingResult,
  type ClipTimingSource,
  type ClipTimingSourceDeps,
  type ClipTimingVerdictEntry,
} from "../clipTiming"
import { eligibleStartsOnce } from "../clipWindow"
import * as timingTrackModule from "../timingTrack"
import type { TimingSubtitle } from "../timingTrack"

declare const __dirname: string

const fs = jest.requireActual<{
  readFileSync: (path: string, encoding: string) => string
}>("node:fs")
const path = jest.requireActual<{ join: (...parts: string[]) => string }>(
  "node:path",
)

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
}

// Real production tracks (each file's NOTE names its source). U1 found that the
// Arabic track fails the 20% rule and the English primary track then passes.
const ARABIC_VTT = fixture("jesus-arabic-modern-standard.excerpt.vtt")
const ENGLISH_VTT = fixture("jesus-english.vtt")
const HINDI_VTT = fixture("jesus-hindi.excerpt.vtt")
const JESUS_SECONDS = 7673.727

const ARABIC = "arabic-modern-standard"
const SRC = {
  arabic: "https://api-media-core.jesusfilm.org/jesus/arabic.vtt",
  english: "https://api-media-core.jesusfilm.org/jesus/english.vtt",
  hindi: "https://api-media-core.jesusfilm.org/jesus/hindi.vtt",
  french: "https://api-media-core.jesusfilm.org/jesus/french.vtt",
}

const APP = "1.4.0"
const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime()
const DAY_MS = 24 * 60 * 60 * 1000

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

const routes = new Map<string, () => Response>()
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>()
const originalFetch = globalThis.fetch

function serve(src: string, body: string) {
  routes.set(src, () => new Response(body))
}

function serveStatus(src: string, status: number) {
  routes.set(src, () => new Response(null, { status }))
}

function fetchedSources(): string[] {
  return fetchMock.mock.calls.map(([src]) => src)
}

function track(slug: string, src: string, primary = false): TimingSubtitle {
  return { vttSrc: src, primary, aiGenerated: false, language: { slug } }
}

function dubWith(subtitles: TimingSubtitle[]) {
  return { videoEdition: { subtitles } }
}

/** JESUS in an Arabic feed: the Arabic track first, then the English primary. */
function jesus(
  overrides: Partial<ClipTimingRequest<TimingSubtitle>> = {},
): ClipTimingRequest<TimingSubtitle> {
  return {
    videoId: "jesus",
    editionId: "edition-jesus",
    playingDub: dubWith([
      track(ARABIC, SRC.arabic),
      track("english", SRC.english, true),
    ]),
    feedLanguageSlug: ARABIC,
    dubDurationSeconds: JESUS_SECONDS,
    ...overrides,
  }
}

/** A video whose dub has one track, at `src`. */
function oneTrack(
  videoId: string,
  src: string,
  feedLanguageSlug = "english",
): ClipTimingRequest<TimingSubtitle> {
  return {
    videoId,
    editionId: `edition-${videoId}`,
    playingDub: dubWith([track(feedLanguageSlug, src)]),
    feedLanguageSlug,
    dubDurationSeconds: JESUS_SECONDS,
  }
}

function noTrack(videoId: string): ClipTimingRequest<TimingSubtitle> {
  return {
    videoId,
    editionId: `edition-${videoId}`,
    playingDub: dubWith([]),
    feedLanguageSlug: "english",
    dubDurationSeconds: 120,
  }
}

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(CLIP_TIMING_STORAGE_KEY, seed)
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

type Storage = ReturnType<typeof makeStorage>

const sources: ClipTimingSource[] = []

function makeSource(
  options: {
    seed?: string | null
    storage?: Storage
    appVersion?: string
    at?: number
    loadCues?: ClipTimingSourceDeps["loadCues"]
  } = {},
) {
  const storage = options.storage ?? makeStorage(options.seed ?? null)
  const clock = { now: options.at ?? T0 }
  const source = createClipTimingSource({
    getItem: storage.getItem,
    setItem: storage.setItem,
    now: () => new Date(clock.now),
    appVersion: options.appVersion ?? APP,
    loadCues: options.loadCues,
  })
  sources.push(source)
  return { source, storage, clock }
}

function storedVerdicts(storage: Storage, at = T0): ClipTimingVerdictEntry[] {
  const raw = storage.items.get(CLIP_TIMING_STORAGE_KEY) ?? null
  return parseStoredClipTimingVerdicts(raw, new Date(at), APP)
}

/** A cold launch: the stored blob survives, the cue cache does not. */
async function relaunch(
  first: { source: ClipTimingSource; storage: Storage },
  options: { appVersion?: string; at?: number } = {},
) {
  await first.source.flushNow()
  const seed = first.storage.items.get(CLIP_TIMING_STORAGE_KEY) ?? null
  expect(seed).not.toBeNull()
  resetVttCacheForTests()
  fetchMock.mockClear()
  return makeSource({ seed, ...options })
}

function entry(
  videoId: string,
  overrides: Partial<ClipTimingVerdictEntry> = {},
): ClipTimingVerdictEntry {
  return {
    videoId,
    editionId: `edition-${videoId}`,
    feedLanguageSlug: "english",
    verdict: { kind: "fallback" },
    storedAt: T0,
    ...overrides,
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function tracked(promise: Promise<ClipTimingResult>) {
  const state: { result: ClipTimingResult | null } = { result: null }
  void promise.then((result) => {
    state.result = result
  })
  return state
}

/** A loader stub that reads a canned result per source and records calls. */
function stubLoader(results: Record<string, VttLoadResult>) {
  return jest.fn(async (src: string) => {
    const result = results[src]
    if (!result) throw new Error(`no stub for ${src}`)
    return result
  })
}

const ENGLISH_CUES = parseVtt(ENGLISH_VTT).sort((a, b) => a.start - b.start)
const ARABIC_CUES = parseVtt(ARABIC_VTT).sort((a, b) => a.start - b.start)

beforeEach(() => {
  resetVttCacheForTests()
  routes.clear()
  serve(SRC.arabic, ARABIC_VTT)
  serve(SRC.english, ENGLISH_VTT)
  serve(SRC.hindi, HINDI_VTT)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (src) => {
    const make = routes.get(src)
    return make ? make() : new Response(null, { status: 404 })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  for (const source of sources.splice(0)) source.reset()
  jest.useRealTimers()
})

afterAll(() => {
  resetVttCacheForTests()
  globalThis.fetch = originalFetch
})

describe("the budget constants", () => {
  it("are four failures in a row and 1 MB of failed reads, from U1", () => {
    // docs/validation/explore-clips-probe.md, "KTD24 probe budgets".
    expect(PROBE_MAX_CONSECUTIVE_FAILURES).toBe(4)
    expect(PROBE_MAX_FAILED_BYTES).toBe(1_000_000)
    expect(CLIP_TIMING_MAX_AGE_MS).toBe(7 * DAY_MS)
  })
})

describe("acquire — the track walk", () => {
  it("gives timing from a passing track, and stores the verdict for the video and edition", async () => {
    const { source, storage } = makeSource()
    const request = oneTrack("jesus", SRC.english)

    const result = await source.acquire(request)

    expect(result).toMatchObject({
      status: "sentence",
      vttSrc: SRC.english,
      tier: "feedLanguage",
    })
    if (result.status !== "sentence") throw new Error("not sentence-cut")
    expect(result.timing.ends.length).toBeGreaterThan(0)
    expect(source.peekVerdict("jesus", "edition-jesus", "english")).toEqual({
      kind: "sentence",
      vttSrc: SRC.english,
    })
    await source.flushNow()
    expect(storedVerdicts(storage)).toEqual([
      entry("jesus", { verdict: { kind: "sentence", vttSrc: SRC.english } }),
    ])
  })

  it("falls through a failing feed-language track to a passing primary track, and counts the failed read", async () => {
    const { source } = makeSource()

    const result = await source.acquire(jesus())

    expect(result).toMatchObject({
      status: "sentence",
      vttSrc: SRC.english,
      tier: "primary",
    })
    expect(fetchedSources()).toEqual([SRC.arabic, SRC.english])
    // The pass resets the run of failures; the failed bytes stay.
    expect(source.getBudget()).toEqual({
      exhausted: false,
      consecutiveFailures: 0,
      failedBytes: byteLength(ARABIC_VTT),
    })
  })

  it.each([
    ["a 404", (src: string) => serveStatus(src, 404), "http_4xx"],
    [
      "an empty parse",
      (src: string) => serve(src, "WEBVTT\n\n"),
      "parse_empty",
    ],
    [
      "an over-cap track",
      (src: string) => serve(src, "x".repeat(VTT_MAX_BYTES + 1)),
      "over_cap",
    ],
    [
      "a failed track check",
      (src: string) => serve(src, ARABIC_VTT),
      "few_sentence_ends",
    ],
  ])("stores a fallback verdict after %s", async (_name, arrange, reason) => {
    arrange(SRC.french)
    const { source, storage } = makeSource()

    const result = await source.acquire(oneTrack("video-a", SRC.french))

    expect(result).toEqual({
      status: "fallback",
      reason: "tracks_failed",
      failures: [reason],
    })
    expect(source.peekVerdict("video-a", "edition-video-a", "english")).toEqual(
      { kind: "fallback" },
    )
    await source.flushNow()
    expect(storedVerdicts(storage)).toEqual([entry("video-a")])
  })

  it("stores a fallback verdict for a dub with no subtitle track, with no fetch and no budget cost", async () => {
    const { source } = makeSource()
    const trackless: ClipTimingRequest<TimingSubtitle> = {
      ...noTrack("video-b"),
      playingDub: dubWith([{ ...track("english", ""), vttSrc: null }]),
    }

    expect(await source.acquire(noTrack("video-a"))).toEqual({
      status: "fallback",
      reason: "no_track",
      failures: [],
    })
    expect(await source.acquire(trackless)).toMatchObject({
      status: "fallback",
      reason: "no_track",
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(source.getBudget()).toEqual({
      exhausted: false,
      consecutiveFailures: 0,
      failedBytes: 0,
    })
    expect(source.peekVerdict("video-a", "edition-video-a", "english")).toEqual(
      { kind: "fallback" },
    )
  })

  it("stores nothing after a 503, even behind a definitive failure, and a later try passes", async () => {
    serveStatus(SRC.english, 503)
    const { source, storage } = makeSource()

    expect(await source.acquire(jesus())).toEqual({
      status: "transient",
      reason: "http_5xx",
    })
    expect(source.peekVerdict("jesus", "edition-jesus", ARABIC)).toBeNull()
    await source.flushNow()
    expect(storedVerdicts(storage)).toEqual([])

    serve(SRC.english, ENGLISH_VTT)
    expect(await source.acquire(jesus())).toMatchObject({
      status: "sentence",
      vttSrc: SRC.english,
    })
  })

  it("stores nothing after a timeout, and the candidate stays eligible", async () => {
    jest.useFakeTimers()
    const { source } = makeSource()
    fetchMock.mockImplementationOnce(
      (_src, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          })
        }),
    )

    const pending = source.acquire(oneTrack("jesus", SRC.english))
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(VTT_FETCH_TIMEOUT_MS)

    expect(await pending).toEqual({ status: "transient", reason: "timeout" })
    expect(source.peekVerdict("jesus", "edition-jesus", "english")).toBeNull()
    expect(source.getBudget().consecutiveFailures).toBe(0)

    jest.useRealTimers()
    expect(await source.acquire(oneTrack("jesus", SRC.english))).toMatchObject({
      status: "sentence",
    })
  })

  it("reads no track and stores nothing when the dub has no known length", async () => {
    const { source } = makeSource()

    const result = await source.acquire(
      jesus({ dubDurationSeconds: Number.NaN }),
    )

    expect(result).toEqual({
      status: "fallback",
      reason: "unknown_duration",
      failures: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(source.peekVerdict("jesus", "edition-jesus", ARABIC)).toBeNull()
  })

  it("never rejects, even when the loader throws", async () => {
    const { source } = makeSource({
      loadCues: async () => {
        throw new Error("boom")
      },
    })

    expect(await source.acquire(jesus())).toEqual({
      status: "transient",
      reason: "network_error",
    })
  })

  it("keys a verdict on the feed language too, so a new feed language walks its own order", async () => {
    serve(SRC.french, HINDI_VTT)
    const { source } = makeSource()
    const edition = dubWith([
      track("french", SRC.french),
      track("english", SRC.english, true),
    ])
    const english = {
      ...jesus(),
      playingDub: edition,
      feedLanguageSlug: "english",
    }

    expect(await source.acquire(english)).toMatchObject({
      vttSrc: SRC.english,
    })
    fetchMock.mockClear()
    const french = { ...english, feedLanguageSlug: "french" }

    expect(await source.acquire(french)).toMatchObject({
      status: "sentence",
      vttSrc: SRC.french,
      tier: "feedLanguage",
    })
    expect(fetchedSources()).toEqual([SRC.french])
  })
})

describe("acquire — stored verdicts", () => {
  it("skips every fetch for a stored fallback verdict younger than 7 days", async () => {
    serveStatus(SRC.french, 404)
    const first = makeSource()
    await first.source.acquire(oneTrack("video-a", SRC.french))

    const { source } = await relaunch(first, { at: T0 + 6 * DAY_MS })

    expect(await source.acquire(oneTrack("video-a", SRC.french))).toEqual({
      status: "fallback",
      reason: "stored_verdict",
      failures: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("goes straight to the stored sentence track, past the failing feed-language track", async () => {
    const first = makeSource()
    await first.source.acquire(jesus())

    const { source } = await relaunch(first, { at: T0 + 6 * DAY_MS })

    expect(await source.acquire(jesus())).toMatchObject({
      status: "sentence",
      vttSrc: SRC.english,
    })
    expect(fetchedSources()).toEqual([SRC.english])
    expect(source.getBudget().failedBytes).toBe(0)
  })

  it("makes no fetch for a stored sentence verdict whose cues are still cached", async () => {
    const { source } = makeSource()
    await source.acquire(jesus())
    fetchMock.mockClear()

    expect(await source.acquire(jesus())).toMatchObject({ status: "sentence" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("ignores a stored verdict from another app version", async () => {
    const first = makeSource({ appVersion: "1.3.0" })
    await first.source.acquire(jesus())

    const { source } = await relaunch(first)

    await source.acquire(jesus())
    expect(fetchedSources()).toEqual([SRC.arabic, SRC.english])
  })

  it("ignores a stored verdict older than 7 days", async () => {
    const first = makeSource()
    await first.source.acquire(jesus())

    const { source } = await relaunch(first, {
      at: T0 + CLIP_TIMING_MAX_AGE_MS + 1,
    })

    await source.acquire(jesus())
    expect(fetchedSources()).toEqual([SRC.arabic, SRC.english])
  })

  it("never fetches a stored track that the dub no longer lists", async () => {
    const unlisted = "https://elsewhere.example.com/x.vtt"
    const seed = serializeClipTimingVerdicts(
      [
        entry("jesus", {
          feedLanguageSlug: ARABIC,
          verdict: { kind: "sentence", vttSrc: unlisted },
        }),
      ],
      new Date(T0),
      APP,
    )
    const { source } = makeSource({ seed })

    expect(await source.acquire(jesus())).toMatchObject({
      vttSrc: SRC.english,
    })
    expect(fetchedSources()).toEqual([SRC.arabic, SRC.english])
  })

  it("drops a stored sentence verdict whose track now fails, and walks on", async () => {
    const first = makeSource()
    await first.source.acquire(jesus())
    const { source } = await relaunch(first)
    serveStatus(SRC.english, 404)
    const request = jesus({
      playingDub: dubWith([
        track(ARABIC, SRC.arabic),
        track("english", SRC.english, true),
        track("hindi", SRC.hindi),
      ]),
    })

    expect(await source.acquire(request)).toMatchObject({
      status: "sentence",
      vttSrc: SRC.hindi,
      tier: "humanMade",
    })
    expect(fetchedSources()).toEqual([SRC.english, SRC.arabic, SRC.hindi])
    expect(source.peekVerdict("jesus", "edition-jesus", ARABIC)).toEqual({
      kind: "sentence",
      vttSrc: SRC.hindi,
    })
  })

  it("reads a corrupt snapshot as empty, and acquire still works", async () => {
    const now = new Date(T0)
    const good = JSON.parse(
      serializeClipTimingVerdicts([entry("video-a")], now, APP),
    )
    for (const raw of [
      "{not json",
      "42",
      "[]",
      "null",
      JSON.stringify({ ...good, v: CLIP_TIMING_VERSION + 1 }),
      JSON.stringify({ ...good, e: "x" }),
    ]) {
      expect(parseStoredClipTimingVerdicts(raw, now, APP)).toEqual([])
    }

    const { source } = makeSource({ seed: "{not json" })
    expect(await source.acquire(jesus())).toMatchObject({ status: "sentence" })
  })

  it("drops a malformed stored entry and keeps the rest", () => {
    const raw = JSON.stringify({
      v: CLIP_TIMING_VERSION,
      app: APP,
      e: [
        ["video-a", "edition-video-a", "english", T0, null],
        ["", "edition-x", "english", T0, null], // empty video id
        ["video-x", "edition-x", "english", "soon", null], // bad time
        ["video-x", "edition-x", "english", T0, 7], // bad track
        ["video-x", "edition-x", "english", T0, ""], // empty track
        ["video-x", "edition-x", T0, null], // too short
        ["x".repeat(201), "edition-x", "english", T0, null], // id too long
      ],
    })
    expect(parseStoredClipTimingVerdicts(raw, new Date(T0), APP)).toEqual([
      entry("video-a"),
    ])
  })

  it("keeps at most the newest verdicts, oldest out first", async () => {
    const { source, storage } = makeSource()
    for (let i = 0; i <= CLIP_TIMING_MAX_VERDICTS; i++) {
      await source.acquire(noTrack(`video-${i}`))
    }

    expect(source.peekVerdict("video-0", "edition-video-0", "english")).toBe(
      null,
    )
    expect(source.peekVerdict("video-1", "edition-video-1", "english")).toEqual(
      { kind: "fallback" },
    )
    await source.flushNow()
    const stored = storedVerdicts(storage)
    expect(stored).toHaveLength(CLIP_TIMING_MAX_VERDICTS)
    expect(stored[0].videoId).toBe("video-1")
  })

  it("writes never throw, whether storage rejects or throws at once", async () => {
    for (const fault of [
      async () => {
        throw new Error("disk full")
      },
      () => {
        throw new Error("no bridge")
      },
    ]) {
      const storage = makeStorage()
      storage.setItem.mockImplementation(fault)
      const { source } = makeSource({ storage })
      expect(await source.acquire(noTrack("video-a"))).toMatchObject({
        status: "fallback",
      })
      await expect(source.flushNow()).resolves.toBeUndefined()
      expect(storage.setItem).toHaveBeenCalled()
    }
  })

  it("does not wait past the hydrate timeout for a hung read, and a late read still merges", async () => {
    jest.useFakeTimers()
    const read = deferred<string | null>()
    const storage = makeStorage()
    storage.getItem.mockImplementationOnce(() => read.promise)
    const { source } = makeSource({ storage })

    const state = tracked(source.acquire(noTrack("video-b")))
    await jest.advanceTimersByTimeAsync(CLIP_TIMING_HYDRATE_TIMEOUT_MS - 1)
    expect(state.result).toBeNull()
    await jest.advanceTimersByTimeAsync(1)
    expect(state.result).toMatchObject({ reason: "no_track" })

    const flushed = source.flushNow()
    read.resolve(
      serializeClipTimingVerdicts([entry("video-a")], new Date(T0), APP),
    )
    await flushed
    expect(storedVerdicts(storage).map((e) => e.videoId)).toEqual([
      "video-a",
      "video-b",
    ])
  })
})

describe("the probe budget", () => {
  it("is exhausted by four definitive failures in a row, and then stops new probes", async () => {
    const { source } = makeSource()
    for (let i = 0; i < PROBE_MAX_CONSECUTIVE_FAILURES; i++) {
      expect(source.getBudget().exhausted).toBe(false)
      await source.acquire(oneTrack(`video-${i}`, `${SRC.french}?v=${i}`))
    }
    expect(source.getBudget()).toMatchObject({
      exhausted: true,
      consecutiveFailures: PROBE_MAX_CONSECUTIVE_FAILURES,
    })
    fetchMock.mockClear()

    expect(await source.acquire(jesus())).toEqual({
      status: "budget_exhausted",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(source.peekVerdict("jesus", "edition-jesus", ARABIC)).toBeNull()
  })

  it("resets the run of failures on a pass", async () => {
    const { source } = makeSource()
    const fail = (i: number) =>
      source.acquire(oneTrack(`video-${i}`, `${SRC.french}?v=${i}`))
    for (let i = 0; i < PROBE_MAX_CONSECUTIVE_FAILURES - 1; i++) await fail(i)
    await source.acquire(oneTrack("jesus", SRC.english))
    expect(source.getBudget().consecutiveFailures).toBe(0)

    for (let i = 10; i < 10 + PROBE_MAX_CONSECUTIVE_FAILURES - 1; i++) {
      await fail(i)
    }
    expect(source.getBudget()).toMatchObject({
      exhausted: false,
      consecutiveFailures: PROBE_MAX_CONSECUTIVE_FAILURES - 1,
    })
    await fail(20)
    expect(source.getBudget().exhausted).toBe(true)
  })

  it("stops new probes once the bytes of failed reads reach the byte budget", async () => {
    const bigFail = { ok: true as const, cues: ARABIC_CUES, bytes: 600_000 }
    const loadCues = stubLoader({
      [SRC.arabic]: bigFail,
      [SRC.french]: bigFail,
      [SRC.english]: { ok: true, cues: ENGLISH_CUES, bytes: 40_000 },
    })
    const { source } = makeSource({ loadCues })

    await source.acquire(oneTrack("video-a", SRC.arabic, ARABIC))
    expect(source.getBudget()).toMatchObject({
      exhausted: false,
      failedBytes: 600_000,
    })
    await source.acquire(oneTrack("video-b", SRC.french, "french"))
    expect(source.getBudget()).toEqual({
      exhausted: true,
      consecutiveFailures: 2,
      failedBytes: 1_200_000,
    })
    loadCues.mockClear()

    expect(await source.acquire(oneTrack("jesus", SRC.english))).toEqual({
      status: "budget_exhausted",
    })
    expect(loadCues).not.toHaveBeenCalled()
  })

  it("charges nothing for a passing 1.4 MB track, so the next clip is still sentence-cut", async () => {
    const english = { ok: true as const, cues: ENGLISH_CUES, bytes: 1_400_000 }
    const loadCues = stubLoader({
      [SRC.arabic]: { ok: true, cues: ARABIC_CUES, bytes: 600_000 },
      [SRC.english]: english,
      [SRC.french]: english,
    })
    const { source } = makeSource({ loadCues })

    expect(await source.acquire(jesus())).toMatchObject({
      status: "sentence",
      vttSrc: SRC.english,
    })
    expect(source.getBudget()).toEqual({
      exhausted: false,
      consecutiveFailures: 0,
      failedBytes: 600_000,
    })
    expect(
      await source.acquire(oneTrack("video-b", SRC.french, "french")),
    ).toMatchObject({ status: "sentence", vttSrc: SRC.french })
  })

  it("charges nothing for a track URL it refuses, since no request is sent", async () => {
    const { source } = makeSource()
    const refused = oneTrack("video-a", "file:///downloads/track.vtt")

    expect(await source.acquire(refused)).toEqual({
      status: "fallback",
      reason: "tracks_failed",
      failures: ["unsafe_url"],
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(source.getBudget().consecutiveFailures).toBe(0)
  })

  it("counts each track once in a visit, however often the walk reaches it", async () => {
    serveStatus(SRC.english, 503)
    const { source } = makeSource()

    await source.acquire(jesus())
    await source.acquire(jesus())

    expect(source.getBudget()).toEqual({
      exhausted: false,
      consecutiveFailures: 1,
      failedBytes: byteLength(ARABIC_VTT),
    })
  })

  it("still serves stored verdicts while exhausted: a fallback with no fetch, a sentence cut from its own track", async () => {
    serveStatus(SRC.french, 404)
    const first = makeSource()
    await first.source.acquire(jesus())
    await first.source.acquire(oneTrack("video-a", SRC.french))
    const { source } = await relaunch(first)
    for (let i = 0; i < PROBE_MAX_CONSECUTIVE_FAILURES; i++) {
      await source.acquire(oneTrack(`video-${i + 10}`, `${SRC.french}?v=${i}`))
    }
    expect(source.getBudget().exhausted).toBe(true)
    fetchMock.mockClear()

    expect(await source.acquire(oneTrack("video-a", SRC.french))).toMatchObject(
      { status: "fallback", reason: "stored_verdict" },
    )
    expect(await source.acquire(jesus())).toMatchObject({
      status: "sentence",
      vttSrc: SRC.english,
    })
    expect(fetchedSources()).toEqual([SRC.english])
  })

  it("starts a fresh budget on a new visit", async () => {
    const { source } = makeSource()
    for (let i = 0; i < PROBE_MAX_CONSECUTIVE_FAILURES; i++) {
      await source.acquire(oneTrack(`video-${i}`, `${SRC.french}?v=${i}`))
    }
    expect(source.getBudget().exhausted).toBe(true)

    source.resetVisit()

    expect(source.getBudget()).toEqual({
      exhausted: false,
      consecutiveFailures: 0,
      failedBytes: 0,
    })
    expect(await source.acquire(jesus())).toMatchObject({ status: "sentence" })
  })
})

describe("the gesture latch", () => {
  it("starts no fetch while the latch is set, and starts when it clears", async () => {
    const { source } = makeSource()
    source.setGestureActive(true)

    const pending = source.acquire(oneTrack("jesus", SRC.english))
    await flushMicrotasks()
    expect(fetchMock).not.toHaveBeenCalled()

    source.setGestureActive(false)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await pending).toMatchObject({ status: "sentence" })
  })

  it("holds sentence analysis for a latch set while the fetch runs", async () => {
    const response = deferred<Response>()
    fetchMock.mockImplementationOnce(() => response.promise)
    const { source } = makeSource()

    const pending = source.acquire(oneTrack("jesus", SRC.english))
    const state = tracked(pending)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    source.setGestureActive(true)
    response.resolve(new Response(ENGLISH_VTT))
    // The cues land in the cache first, so the wait below is the latch's alone.
    for (let i = 0; i < 20 && peekVttCues(SRC.english) == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(peekVttCues(SRC.english)).toBeDefined()
    await flushMicrotasks()
    expect(state.result).toBeNull()

    source.setGestureActive(false)
    expect(await pending).toMatchObject({ status: "sentence" })
  })

  it("returns a transient abort, and stores nothing, when the caller aborts during the wait", async () => {
    const { source } = makeSource()
    const controller = new AbortController()
    source.setGestureActive(true)

    const pending = source.acquire(oneTrack("jesus", SRC.english, "english"))
    const aborted = source.acquire({
      ...oneTrack("video-a", SRC.english),
      signal: controller.signal,
    })
    await flushMicrotasks()
    controller.abort()

    expect(await aborted).toEqual({ status: "transient", reason: "aborted" })
    expect(source.peekVerdict("video-a", "edition-video-a", "english")).toBe(
      null,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    source.setGestureActive(false)
    expect(await pending).toMatchObject({ status: "sentence" })
  })
})

describe("the track check memo", () => {
  it("checks a cached track once per dub length, so a repeat candidate does no sentence analysis", async () => {
    const check = jest.spyOn(timingTrackModule, "checkTimingTrack")
    const { source } = makeSource()
    const request = oneTrack("jesus", SRC.english)

    await source.acquire(request)
    await source.acquire({ ...request, videoId: "jesus-again" })
    expect(check).toHaveBeenCalledTimes(1)

    await source.acquire({ ...request, dubDurationSeconds: 7000 })
    expect(check).toHaveBeenCalledTimes(2)
    check.mockRestore()
  })
})

describe("eligibleStartsSlot", () => {
  it("builds the list once per record version, per track and video, and the list leaves with the track", async () => {
    const { source } = makeSource()
    const result = await source.acquire(oneTrack("jesus", SRC.english))
    if (result.status !== "sentence") throw new Error("not sentence-cut")
    const record = { version: 1, windows: [] }

    const first = eligibleStartsOnce(
      eligibleStartsSlot(SRC.english, "jesus"),
      result.timing,
      record,
    )
    expect(first.length).toBeGreaterThan(0)
    expect(
      eligibleStartsOnce(
        eligibleStartsSlot(SRC.english, "jesus"),
        result.timing,
        record,
      ),
    ).toBe(first)
    expect(eligibleStartsSlot(SRC.english, "other-video").get()).toBeUndefined()

    resetVttCacheForTests()
    expect(eligibleStartsSlot(SRC.english, "jesus").get()).toBeUndefined()
  })
})
