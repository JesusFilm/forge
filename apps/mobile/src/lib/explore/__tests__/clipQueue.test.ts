/**
 * The clip queue (U5). A small driver plays the hook: it runs each effect
 * against a fake world, feeds the result back, and takes each clip. Hydrations
 * follow the production shape (checked 2026-09-25), trailing `hls` newline too.
 */

import type { ExploreClipCandidatesData } from "../../queries"
import type { ClipRecordStore } from "../clipRecord"
import type {
  ClipTimingResult,
  ClipTimingSource,
  eligibleStartsSlot,
} from "../clipTiming"
import type { EligibleStartsMemo, MemoSlot } from "../clipWindow"
import {
  CLIP_QUEUE_AHEAD,
  FIRST_CLIP_MAX_SECONDS,
  HYDRATION_BATCH_SIZE,
  advance,
  applyHydration,
  applyRelease,
  applyTiming,
  changeLanguage,
  createClipQueue,
  hydrationFailed,
  needsRetry,
  nextStorableClip,
  poolFailed,
  retry,
  seedClip,
  setPool,
  setSlate,
  takeClip,
  type ClipQueueContext,
  type ClipQueueEffect,
  type ClipQueueRecord,
  type ClipQueueState,
} from "../clipQueue"
import type { ExplorePool, PoolCandidate } from "../pool"
import { deriveClipTiming, type ClipTiming } from "../sentenceTiming"
import type { ClipWindow, ReadyClip } from "../types"

type CandidateVideo = ExploreClipCandidatesData["watchHomeVideos"][number]

// Compile-time pins: U6's store and U21's source plug into the queue's ports
// with no adapter. `tsc` fails here if either side drifts.
export const recordPort = (store: ClipRecordStore): ClipQueueRecord => store
export const slotPort: ClipQueueContext["eligibleStartsSlot"] =
  null as unknown as typeof eligibleStartsSlot
export const acquirePort = (
  source: ClipTimingSource,
  effect: Extract<ClipQueueEffect, { kind: "acquire" }>,
): Promise<ClipTimingResult> => source.acquire(effect.request)

const SW = "swahili"
const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime()

// ── Fixtures ────────────────────────────────────────────────────────

function candidate(
  id: string,
  overrides: Partial<PoolCandidate> = {},
): PoolCandidate {
  return {
    videoId: `video-${id}`,
    coreId: `core-${id}`,
    slug: `slug-${id}`,
    label: "segment",
    availability: "AUDIO",
    durationSeconds: 300,
    muxPlaybackId: `mux${id}`,
    watchLanguageSlug: SW,
    title: `Title ${id}`,
    description: `About ${id}`,
    ...overrides,
  }
}

/** A stored ready clip, as a warm open reads it. */
function readyFrom(c: PoolCandidate): ReadyClip {
  const id = c.videoId.replace("video-", "")
  return {
    ...c,
    imageUrl: null,
    feedLanguageSlug: SW,
    streamUrl: `https://stream.mux.com/stream${id}.m3u8`,
    audioLanguageSlug: SW,
    subtitleLanguageSlug: null,
    subtitleVttSrc: null,
    subtitleOnly: false,
    window: { startSeconds: 12, endSeconds: 42 },
    cut: "fallback",
  }
}

function subtitleCandidate(id: string): PoolCandidate {
  return candidate(id, {
    availability: "SUBTITLE_ONLY",
    watchLanguageSlug: "english",
  })
}

function poolOf(
  dubbed: PoolCandidate[],
  subtitleOnly: PoolCandidate[] = [],
  languageSlug = SW,
): ExplorePool {
  return { languageSlug, fetchedAt: T0, dubbed, subtitleOnly }
}

/**
 * A track with `portions` sentence-cut windows: each starts at k * 40 s and
 * ends at the long pause after k * 40 + 24 s (window [k*40, k*40+25]).
 */
function timingWith(portions: number): ClipTiming {
  const cues = []
  for (let k = 0; k < portions; k++) {
    cues.push({ start: k * 40, end: k * 40 + 12, text: "Habari za" })
    cues.push({ start: k * 40 + 13, end: k * 40 + 24, text: "asubuhi." })
  }
  const timing = deriveClipTiming(cues)
  if (timing == null) throw new Error("fixture is over the cue cap")
  return timing
}

type Track = {
  slug: string
  vttSrc?: string
  primary?: boolean
  aiGenerated?: boolean
}

type VideoSpec = {
  /** The language `preferredPlayableDub` answers with. */
  dubLanguage?: string
  seconds?: number
  tracks?: Track[]
  hls?: string | null
  /** Omit the video from the response, as an unknown core id is. */
  missing?: boolean
}

function vtt(id: string, slug: string): string {
  return `https://api-media-core.jesusfilm.org/${id}/editions/base/${slug}.vtt`
}

function hydrated(
  c: PoolCandidate,
  spec: VideoSpec,
  audioSlug: string,
): CandidateVideo {
  const id = c.videoId.replace("video-", "")
  const seconds = spec.seconds ?? 300
  return {
    documentId: c.videoId,
    coreId: c.coreId,
    images: [
      {
        documentId: `image-${id}`,
        thumbnail: null,
        mobileCinematicHigh: "   ",
        mobileCinematicLow: null,
        videoStill: `https://imagedelivery.net/x/${id}.videoStill.jpg/f=jpg,w=1920`,
      },
    ],
    preferredPlayableDub: {
      documentId: `dub-${id}`,
      hls:
        spec.hls === undefined
          ? `https://stream.mux.com/stream${id}.m3u8\n`
          : spec.hls,
      duration: Math.round(seconds),
      lengthInMilliseconds: String(Math.round(seconds * 1000)),
      language: { slug: spec.dubLanguage ?? audioSlug },
      muxVideo: { playbackId: `stream${id}` },
      videoEdition: {
        documentId: `edition-${id}`,
        subtitles: (spec.tracks ?? []).map((t, i) => ({
          documentId: `sub-${id}-${i}`,
          vttSrc: t.vttSrc ?? vtt(id, t.slug),
          primary: t.primary ?? false,
          aiGenerated: t.aiGenerated ?? false,
          language: { slug: t.slug },
        })),
      },
    },
  }
}

/** The record as U6's store keeps it, reduced to what the queue reads. */
class FakeRecord implements ClipQueueRecord {
  entries: { videoId: string; languageSlug: string; window: ClipWindow }[] = []
  version = 0
  releases: { languageSlug: string; count: number }[] = []

  add(videoId: string, languageSlug: string, window: ClipWindow): void {
    this.entries.push({ videoId, languageSlug, window })
    this.version += 1
  }

  getWindows(videoId: string): ClipWindow[] {
    return this.entries
      .filter((e) => e.videoId === videoId)
      .map((e) => e.window)
      .sort((a, b) => a.startSeconds - b.startSeconds)
  }

  getVersion(): number {
    return this.version
  }

  getEntries() {
    return this.entries.map((e) => ({
      videoId: e.videoId,
      languageSlug: e.languageSlug,
    }))
  }

  releaseOldestForLanguage(languageSlug: string, count: number): number {
    this.releases.push({ languageSlug, count })
    let released = 0
    this.entries = this.entries.filter((e) => {
      if (released >= count || e.languageSlug !== languageSlug) return true
      released += 1
      return false
    })
    if (released > 0) this.version += 1
    return released
  }
}

type World = {
  pool: ExplorePool
  videos: Map<string, VideoSpec>
  /** Timing per video id; a function answers per call. */
  timing: Map<string, ClipTimingResult | (() => ClipTimingResult)>
  record: FakeRecord
  random: () => number
  slots: Map<string, EligibleStartsMemo>
  hydrations: { audioLanguageSlug: string; coreIds: string[] }[]
  acquisitions: string[]
}

function world(pool: ExplorePool, videos: Record<string, VideoSpec> = {}) {
  const w: World = {
    pool,
    videos: new Map(Object.entries(videos)),
    timing: new Map(),
    record: new FakeRecord(),
    // Zero keeps every shuffle in pool order; a case that needs spread seeds it.
    random: () => 0,
    slots: new Map(),
    hydrations: [],
    acquisitions: [],
  }
  return w
}

function sentence(portions: number, vttSrc = "track"): ClipTimingResult {
  return {
    status: "sentence",
    vttSrc,
    tier: "feedLanguage",
    timing: timingWith(portions),
  }
}

const NO_TRACK: ClipTimingResult = {
  status: "fallback",
  reason: "no_track",
  failures: [],
}

function context(w: World, clipsAheadInFeed = 0): ClipQueueContext {
  return {
    random: w.random,
    record: w.record,
    clipsAheadInFeed,
    eligibleStartsSlot: (vttSrc, videoId): MemoSlot<EligibleStartsMemo> => {
      const key = `${vttSrc}|${videoId}`
      return {
        get: () => w.slots.get(key),
        set: (value) => {
          w.slots.set(key, value)
        },
      }
    },
  }
}

function fulfil(
  w: World,
  state: ClipQueueState,
  effect: ClipQueueEffect,
): ClipQueueState {
  switch (effect.kind) {
    case "hydrate": {
      w.hydrations.push({
        audioLanguageSlug: effect.audioLanguageSlug,
        coreIds: [...effect.coreIds],
      })
      const all = [...w.pool.dubbed, ...w.pool.subtitleOnly]
      const videos = effect.coreIds.flatMap((coreId) => {
        const c = all.find((x) => x.coreId === coreId)
        const spec = c && w.videos.get(c.videoId.replace("video-", ""))
        if (c == null || spec?.missing) return []
        return [hydrated(c, spec ?? {}, effect.audioLanguageSlug)]
      })
      return applyHydration(state, effect.token, videos)
    }
    case "acquire": {
      w.acquisitions.push(effect.videoId)
      const answer = w.timing.get(effect.videoId) ?? NO_TRACK
      return applyTiming(
        state,
        effect.token,
        typeof answer === "function" ? answer() : answer,
      )
    }
    case "release": {
      w.record.releaseOldestForLanguage(effect.languageSlug, effect.count)
      return applyRelease(state, effect.token)
    }
  }
}

type Run = {
  state: ClipQueueState
  clips: ReadyClip[]
  signals: string[]
  effects: ClipQueueEffect[]
}

/**
 * Plays the hook: take a clip as soon as the queue holds one. By default the
 * clip also plays at once, so the record takes its window.
 */
function drive(
  w: World,
  start: ClipQueueState,
  count: number,
  { play = true }: { play?: boolean } = {},
): Run {
  let state = start
  const clips: ReadyClip[] = []
  const signals: string[] = []
  const effects: ClipQueueEffect[] = []
  for (let i = 0; i < 1000 && clips.length < count; i++) {
    if (state.ahead.length > 0) {
      const taken = takeClip(state)
      state = taken.state
      if (taken.clip != null) {
        clips.push(taken.clip)
        if (play) w.record.add(taken.clip.videoId, SW, taken.clip.window)
      }
      continue
    }
    const step = advance(state, context(w))
    state = step.state
    if (step.signal != null) signals.push(step.signal)
    if (step.effect == null) {
      if (state.ahead.length === 0) break
      continue
    }
    effects.push(step.effect)
    state = fulfil(w, state, step.effect)
  }
  return { state, clips, signals, effects }
}

function started(w: World, language = SW): ClipQueueState {
  return setPool(createClipQueue(language), w.pool, w.random)
}

/** mulberry32: a small seeded generator, so a failing seed replays exactly. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ids = (clips: readonly ReadyClip[]) =>
  clips.map((c) => c.videoId.replace("video-", ""))

// ── Hydration ───────────────────────────────────────────────────────

describe("hydration", () => {
  it("makes a video whose preferred dub is in another language not dubbed-eligible", () => {
    const w = world(poolOf([candidate("a"), candidate("b")]), {
      a: { dubLanguage: "english" },
      b: {},
    })
    const run = drive(w, started(w), 3)
    expect(ids(run.clips)).toEqual(["b", "b", "b"])
  })

  it("signals empty when every candidate proves ineligible", () => {
    const w = world(poolOf([candidate("a"), candidate("b")]), {
      a: { dubLanguage: "english" },
      b: { missing: true },
    })
    const run = drive(w, started(w), 1)
    expect(run.clips).toEqual([])
    expect(run.signals).toContain("empty")
  })

  it("builds the clip from the hydrated dub, not the inventory row", () => {
    const w = world(poolOf([candidate("a", { durationSeconds: null })]), {
      a: {
        seconds: 7673.728,
        tracks: [
          { slug: "english", primary: true },
          { slug: SW, aiGenerated: true },
          { slug: SW },
        ],
      },
    })
    w.timing.set("video-a", sentence(3, vtt("a", SW)))
    const [clip] = drive(w, started(w), 1).clips
    expect(clip).toMatchObject({
      videoId: "video-a",
      feedLanguageSlug: SW,
      audioLanguageSlug: SW,
      // The JESUS English dub carries a trailing newline in production.
      streamUrl: "https://stream.mux.com/streama.m3u8",
      muxPlaybackId: "streama",
      durationSeconds: 7673.728,
      // A blank cinematic field falls through to the still.
      imageUrl: "https://imagedelivery.net/x/a.videoStill.jpg/f=jpg,w=1920",
      // R13: the human-made track in the feed language.
      subtitleLanguageSlug: SW,
      subtitleVttSrc: vtt("a", SW),
      subtitleOnly: false,
      cut: "sentence",
    })
  })

  it("sends U21 the edition id, the dub length, and at most one track per tier", () => {
    const w = world(poolOf([candidate("a")]), {
      a: {
        seconds: 219.5,
        tracks: [
          { slug: "french" },
          { slug: SW },
          { slug: "english", primary: true },
          { slug: "german", aiGenerated: true },
          { slug: "hindi" },
        ],
      },
    })
    const step1 = advance(started(w), context(w))
    if (step1.effect?.kind !== "hydrate") throw new Error("expected hydrate")
    const state = fulfil(w, step1.state, step1.effect)
    const step2 = advance(state, context(w))
    expect(step2.effect).toMatchObject({
      kind: "acquire",
      videoId: "video-a",
      request: {
        videoId: "video-a",
        editionId: "edition-a",
        feedLanguageSlug: SW,
        dubDurationSeconds: 219.5,
      },
    })
    if (step2.effect?.kind !== "acquire") throw new Error("expected acquire")
    const slugs = (
      step2.effect.request.playingDub?.videoEdition?.subtitles ?? []
    ).map((t) => t.language?.slug)
    // KTD5: feed language, primary, human-made, then any (human-made first).
    expect(slugs).toEqual([SW, "english", "french", "hindi"])
  })

  it("asks for a few queued candidates per request, in one audio language", () => {
    const w = world(
      poolOf(["a", "b", "c", "d", "e"].map((id) => candidate(id))),
    )
    const step = advance(started(w), context(w))
    expect(step.effect).toMatchObject({
      kind: "hydrate",
      audioLanguageSlug: SW,
    })
    if (step.effect?.kind !== "hydrate") throw new Error("expected hydrate")
    expect(step.effect.coreIds).toHaveLength(HYDRATION_BATCH_SIZE)
  })

  it("keeps one request in flight", () => {
    const w = world(poolOf([candidate("a"), candidate("b")]))
    const first = advance(started(w), context(w))
    expect(first.effect?.kind).toBe("hydrate")
    expect(advance(first.state, context(w)).effect).toBeNull()
  })

  it("drops a late result whose token no longer matches", () => {
    const w = world(poolOf([candidate("a")]))
    const first = advance(started(w), context(w))
    if (first.effect?.kind !== "hydrate") throw new Error("expected hydrate")
    const stale = applyHydration(first.state, first.effect.token + 1, [
      hydrated(candidate("a"), {}, SW),
    ])
    expect(stale).toBe(first.state)
  })
})

// ── Tiers (R20, R21) ────────────────────────────────────────────────

describe("tiers", () => {
  it("covers AE5: only dubbed clips while dubbed portions remain, then a subtitle-only clip with subtitles on", () => {
    const w = world(
      poolOf([candidate("d1"), candidate("d2")], [subtitleCandidate("s1")]),
      {
        d1: { tracks: [{ slug: SW }] },
        d2: { tracks: [{ slug: SW }] },
        s1: { tracks: [{ slug: "english", primary: true }, { slug: SW }] },
      },
    )
    w.timing.set("video-d1", sentence(2))
    w.timing.set("video-d2", sentence(2))
    w.timing.set("video-s1", sentence(3))

    const run = drive(w, started(w), 5)
    expect(ids(run.clips)).toEqual(["d1", "d2", "d1", "d2", "s1"])
    expect(run.clips.slice(0, 4).every((c) => !c.subtitleOnly)).toBe(true)
    const subtitled = run.clips[4]
    expect(subtitled).toMatchObject({
      subtitleOnly: true,
      audioLanguageSlug: "english",
      feedLanguageSlug: SW,
      subtitleLanguageSlug: SW,
      subtitleVttSrc: vtt("s1", SW),
    })
    // The fallback audio's dub was asked for in its own language.
    expect(w.hydrations.at(-1)).toEqual({
      audioLanguageSlug: "english",
      coreIds: ["core-s1"],
    })
  })

  it("drops a subtitle-only video whose playing edition has no track in the feed language", () => {
    const w = world(poolOf([], [subtitleCandidate("s1")]), {
      s1: { tracks: [{ slug: "english", primary: true }] },
    })
    const run = drive(w, started(w), 1)
    expect(run.clips).toEqual([])
    expect(run.signals).toContain("empty")
  })

  it("covers AE10: a 20:00 dubbed video with no tracks gives a 30 s fallback clip after the sentence-cut clips and before any subtitle-only clip", () => {
    const w = world(
      poolOf(
        [candidate("s1"), candidate("s2"), candidate("f20")],
        [subtitleCandidate("t1")],
      ),
      {
        s1: { tracks: [{ slug: SW }] },
        s2: { tracks: [{ slug: SW }] },
        f20: { seconds: 20 * 60 },
        t1: { tracks: [{ slug: SW }] },
      },
    )
    w.timing.set("video-s1", sentence(1))
    w.timing.set("video-s2", sentence(1))
    w.timing.set("video-t1", sentence(1))

    const run = drive(w, started(w), 4)
    expect(ids(run.clips).slice(0, 2).sort()).toEqual(["s1", "s2"])
    expect(ids(run.clips).slice(2)).toEqual(["f20", "t1"])
    const fallback = run.clips[2]
    expect(fallback.cut).toBe("fallback")
    expect(fallback.window.startSeconds).toBeGreaterThanOrEqual(60)
    expect(fallback.window.startSeconds).toBeLessThanOrEqual(16 * 60)
    expect(fallback.window.endSeconds - fallback.window.startSeconds).toBe(30)
    // A video with no tracks needs no probe at all.
    expect(w.acquisitions).not.toContain("video-f20")
  })

  it("after the probe budget is exhausted, the next clip is a fallback clip from an already-probed candidate", () => {
    const w = world(poolOf([candidate("a"), candidate("b"), candidate("c")]), {
      a: { tracks: [{ slug: SW }] },
      b: {},
      c: { tracks: [{ slug: SW }] },
    })
    w.timing.set("video-a", { status: "budget_exhausted" })
    w.timing.set("video-c", { status: "budget_exhausted" })

    const run = drive(w, started(w), 1)
    // "a" hit the budget; "b" was hydrated and has no track: a known fallback.
    expect(run.clips[0]).toMatchObject({ videoId: "video-b", cut: "fallback" })
    expect(w.acquisitions).toEqual(["video-a"])
  })

  it("under an exhausted budget, a hydrated dubbed video gives a fallback clip before any subtitle-only clip", () => {
    const w = world(poolOf([candidate("a")], [subtitleCandidate("t1")]), {
      a: { tracks: [{ slug: SW }] },
      t1: { tracks: [{ slug: SW }] },
    })
    w.timing.set("video-a", { status: "budget_exhausted" })
    const run = drive(w, started(w), 1)
    expect(run.clips[0]).toMatchObject({ videoId: "video-a", cut: "fallback" })
  })

  it("prefers a short video for a cold first clip (KTD6)", () => {
    const long = ["l1", "l2", "l3", "l4"].map((id) =>
      candidate(id, { durationSeconds: 95 * 60 }),
    )
    const short = candidate("short", {
      durationSeconds: FIRST_CLIP_MAX_SECONDS,
    })
    const w = world(poolOf([...long, short]), {
      l1: {},
      l2: {},
      l3: {},
      l4: {},
      short: { seconds: FIRST_CLIP_MAX_SECONDS },
    })
    const step = advance(started(w), context(w))
    if (step.effect?.kind !== "hydrate") throw new Error("expected hydrate")
    expect(step.effect.coreIds[0]).toBe("core-short")
  })
})

// ── Recommendations first (R25) ─────────────────────────────────────

describe("the slate", () => {
  it("puts a slate of six first, in slate order, skipping ineligible ones; random fill follows", () => {
    const all = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"]
    const w = world(
      poolOf(all.map((id) => candidate(id))),
      Object.fromEntries(
        all.map((id) => [
          id,
          id === "v5" ? { dubLanguage: "english" } : { tracks: [{ slug: SW }] },
        ]),
      ),
    )
    for (const id of all) w.timing.set(`video-${id}`, sentence(3))
    const state = setSlate(started(w), [
      "video-v3",
      "video-v9",
      "video-not-in-pool",
      "video-v5",
      "video-v1",
      "video-v7",
    ])

    const run = drive(w, state, 7)
    expect(ids(run.clips).slice(0, 4)).toEqual(["v3", "v9", "v1", "v7"])
    // Random fill: every other video gets a clip before a slate video repeats.
    expect(ids(run.clips).slice(4)).toEqual(["v2", "v4", "v6"])
  })

  it("never waits for a slate: the first clip comes from random fill", () => {
    const w = world(poolOf([candidate("a")]), { a: {} })
    const run = drive(w, started(w), 1)
    expect(ids(run.clips)).toEqual(["a"])
  })

  it("skips a slate item that is the previous clip's video, and keeps it for later", () => {
    const w = world(poolOf([candidate("a"), candidate("b"), candidate("c")]), {
      a: { tracks: [{ slug: SW }] },
      b: { tracks: [{ slug: SW }] },
      c: { tracks: [{ slug: SW }] },
    })
    for (const id of ["a", "b", "c"]) w.timing.set(`video-${id}`, sentence(3))
    const warm = seedClip(started(w), readyFrom(candidate("c")))
    const state = setSlate(warm, ["video-c", "video-b"])
    const run = drive(w, state, 3)
    expect(ids(run.clips)).toEqual(["c", "b", "c"])
  })
})

// ── Variety (R30, R31) ──────────────────────────────────────────────

describe("variety", () => {
  // Tier order alone would give "a" every time: it is the only sentence-cut
  // video. R30 is what puts the fallback video between its clips.
  it("never gives two clips of one video in a row while another video is eligible", () => {
    const w = world(poolOf([candidate("a"), candidate("b")]), {
      a: { tracks: [{ slug: SW }] },
      b: { seconds: 20 * 60 },
    })
    w.timing.set("video-a", sentence(20))
    w.random = seeded(11)
    const run = drive(w, started(w), 8)
    expect(ids(run.clips)).toEqual(["a", "b", "a", "b", "a", "b", "a", "b"])
  })

  it("repeats a video when it is the only one, never repeating a window", () => {
    const w = world(poolOf([candidate("a")]), { a: { seconds: 600 } })
    const run = drive(w, started(w), 3)
    expect(ids(run.clips)).toEqual(["a", "a", "a"])
    const starts = run.clips.map((c) => c.window.startSeconds)
    expect(new Set(starts).size).toBe(3)
  })

  // The record takes a clip only when it plays. A clip the feed holds but has
  // not played must still keep the next clip off its window.
  it("keeps the next clip off the window of a clip the feed holds but has not played", () => {
    const w = world(poolOf([candidate("a")]), { a: { tracks: [{ slug: SW }] } })
    w.timing.set("video-a", sentence(3))
    const run = drive(w, started(w), 2, { play: false })
    expect(ids(run.clips)).toEqual(["a", "a"])
    expect(run.clips[1].window.startSeconds).not.toBe(
      run.clips[0].window.startSeconds,
    )
  })

  it("covers AE9: with every portion recorded, releases the oldest entries for the language once, and a clip comes out", () => {
    const w = world(poolOf([candidate("a"), candidate("b")]), {
      a: { seconds: 25 },
      b: { seconds: 25 },
    })
    // Each 25 s video plays whole, so one recorded clip fills it.
    w.record.add("video-a", SW, { startSeconds: 0, endSeconds: 25 })
    w.record.add("video-b", SW, { startSeconds: 0, endSeconds: 25 })
    w.record.add("video-x", "french", { startSeconds: 0, endSeconds: 9 })

    const run = drive(w, started(w), 1)
    expect(run.signals).not.toContain("empty")
    // The first request freed the oldest entry (a's) and took a clip from it.
    expect(ids(run.clips)).toEqual(["a"])
    // The second release belongs to the queue's second clip ahead: one each.
    expect(w.record.releases).toEqual([
      { languageSlug: SW, count: 1 },
      { languageSlug: SW, count: 1 },
    ])
    expect(w.record.entries.some((e) => e.languageSlug === "french")).toBe(true)
  })

  it("releases at most once per request", () => {
    const w = world(poolOf([candidate("a"), candidate("b")]), {
      a: { seconds: 25 },
      b: { seconds: 25 },
    })
    w.record.add("video-a", SW, { startSeconds: 0, endSeconds: 25 })
    w.record.add("video-b", SW, { startSeconds: 0, endSeconds: 25 })
    // A release that frees nothing leaves every portion recorded.
    w.record.releaseOldestForLanguage = (languageSlug, count) => {
      w.record.releases.push({ languageSlug, count })
      return 0
    }
    const run = drive(w, started(w), 1)
    expect(run.clips).toEqual([])
    expect(w.record.releases).toHaveLength(1)
    expect(run.signals).not.toContain("empty")
  })
})

// ── Signals (R37, R47) ──────────────────────────────────────────────

describe("signals", () => {
  it("signals empty for a definitive empty pool", () => {
    const w = world(poolOf([]))
    expect(advance(started(w), context(w)).signal).toBe("empty")
  })

  it("signals offline when admin is unreachable and there is no pool", () => {
    const w = world(poolOf([]))
    const state = poolFailed(createClipQueue(SW), "unreachable")
    expect(advance(state, context(w)).signal).toBe("offline")
  })

  it("signals neither for a transient pool failure", () => {
    const w = world(poolOf([]))
    const state = poolFailed(createClipQueue(SW), "transient")
    expect(advance(state, context(w))).toMatchObject({
      effect: null,
      signal: null,
    })
  })

  it("signals offline when the first hydration cannot reach admin, and retries", () => {
    const w = world(poolOf([candidate("a")]), { a: {} })
    const first = advance(started(w), context(w))
    if (first.effect?.kind !== "hydrate") throw new Error("expected hydrate")
    const failed = hydrationFailed(
      first.state,
      first.effect.token,
      "unreachable",
    )
    expect(advance(failed, context(w))).toMatchObject({
      effect: null,
      signal: "offline",
    })
    expect(needsRetry(failed)).toBe(true)
    expect(advance(retry(failed), context(w)).effect?.kind).toBe("hydrate")
  })

  it("signals neither for a transient hydration failure", () => {
    const w = world(poolOf([candidate("a")]), { a: {} })
    const first = advance(started(w), context(w))
    if (first.effect?.kind !== "hydrate") throw new Error("expected hydrate")
    const failed = hydrationFailed(first.state, first.effect.token, "transient")
    expect(advance(failed, context(w)).signal).toBeNull()
  })

  it("keeps a transient timing failure eligible for a later try", () => {
    const w = world(poolOf([candidate("a")]), { a: { tracks: [{ slug: SW }] } })
    let calls = 0
    w.timing.set("video-a", () =>
      calls++ === 0 ? { status: "transient", reason: "http_5xx" } : sentence(2),
    )
    const stuck = drive(w, started(w), 1)
    expect(stuck.clips).toEqual([])
    expect(stuck.signals).toEqual([])
    expect(needsRetry(stuck.state)).toBe(true)
    const run = drive(w, retry(stuck.state), 1)
    expect(run.clips[0]).toMatchObject({ videoId: "video-a", cut: "sentence" })
  })
})

// ── Warm open, ahead count, language change ─────────────────────────

describe("the queue around the feed", () => {
  it("keeps two computed clips ahead, counting the one the feed holds", () => {
    const w = world(poolOf(["a", "b", "c"].map((id) => candidate(id))))
    let state = started(w)
    for (let i = 0; i < 20; i++) {
      const step = advance(state, context(w))
      state = step.state
      if (step.effect == null) break
      state = fulfil(w, state, step.effect)
    }
    expect(state.ahead).toHaveLength(CLIP_QUEUE_AHEAD)
    const taken = takeClip(state).state
    expect(advance(taken, context(w, 1)).effect).toBeNull()
    expect(taken.ahead).toHaveLength(1)
  })

  it("starts a warm open from the stored clip with no request", () => {
    const w = world(poolOf([candidate("a"), candidate("b")]))
    const stored = readyFrom(candidate("a"))
    const state = seedClip(started(w), stored)
    expect(nextStorableClip(state)).toEqual(stored)
    const taken = takeClip(state)
    expect(taken.clip).toEqual(stored)
    expect(w.hydrations).toEqual([])
  })

  it("on a language change drops computed clips and asks for one pool fetch and one recommendations refresh", () => {
    const w = world(poolOf(["a", "b", "c"].map((id) => candidate(id))), {
      a: { tracks: [{ slug: SW }] },
      b: { tracks: [{ slug: SW }] },
      c: { tracks: [{ slug: SW }] },
    })
    for (const id of ["a", "b", "c"]) w.timing.set(`video-${id}`, sentence(3))
    let state = started(w)
    for (let i = 0; i < 20; i++) {
      const step = advance(state, context(w))
      state = step.state
      if (step.effect == null) break
      state = fulfil(w, state, step.effect)
    }
    const loaded = takeClip(state)
    state = loaded.state
    expect(state.ahead).toHaveLength(1)
    const inFlight = advance(state, context(w))
    expect(inFlight.effect?.kind).toBe("acquire")

    const changed = changeLanguage(inFlight.state, "french")
    expect(changed.effects).toEqual([
      { kind: "fetchPool", languageSlug: "french" },
      { kind: "refreshRecommendations", languageSlug: "french" },
    ])
    expect(changed.state.feedLanguageSlug).toBe("french")
    expect(changed.state.ahead).toEqual([])
    expect(changeLanguage(changed.state, "french").effects).toEqual([])

    // The old language's late timing result is dropped.
    if (inFlight.effect?.kind !== "acquire") throw new Error("expected acquire")
    const late = applyTiming(changed.state, inFlight.effect.token, sentence(3))
    expect(late).toBe(changed.state)

    // The clip the feed loaded stays the previous clip (R30).
    const french = world(
      poolOf(
        ["a", "b"].map((id) => candidate(id, { watchLanguageSlug: "french" })),
        [],
        "french",
      ),
    )
    const next = drive(
      french,
      setPool(changed.state, french.pool, french.random),
      1,
    )
    expect(next.clips[0].videoId).not.toBe(loaded.clip?.videoId)
    expect(next.clips[0].feedLanguageSlug).toBe("french")
  })

  it("ignores a pool for another language", () => {
    const w = world(poolOf([candidate("a")], [], "english"))
    const state = createClipQueue(SW)
    expect(setPool(state, w.pool, w.random)).toBe(state)
  })
})
