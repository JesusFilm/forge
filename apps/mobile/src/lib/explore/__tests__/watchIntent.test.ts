/**
 * "Keep watching" (KTD11): the one-shot intent, the start it gives the watch
 * page, and the languages it hands the watch session. The page-level wiring
 * is pinned in `app/watch/__tests__/keepWatchingIntent.test.tsx`.
 */

import { decodeWatchSeed } from "../../watchSeed"
import {
  KEEP_WATCHING_OFFER_DURATION_MS,
  WATCH_INTENT_TTL_MS,
  advanceKeepWatching,
  createWatchIntentStore,
  keepWatchingAfterChoice,
  keepWatchingLanguages,
  keepWatchingProgressHold,
  keepWatchingStartSeconds,
  keepWatchingStateFor,
  openKeepWatching,
  rankStartSeconds,
  type KeepWatchingClip,
  type KeepWatchingState,
  type WatchIntent,
} from "../watchIntent"

const T0 = 1_700_000_000_000

/** AE6: a JESUS clip at 0:12:00–0:12:30, played in its English dub. */
const JESUS_CLIP: KeepWatchingClip = {
  slug: "jesus",
  title: "JESUS",
  imageUrl: "https://images.example/jesus.jpg",
  muxPlaybackId: "jesusEnglishDub",
  audioLanguageSlug: "english",
  subtitleLanguageSlug: "english",
  subtitleOnly: false,
  window: { startSeconds: 720, endSeconds: 750 },
}

/** A subtitle-only clip: the audio is the fallback dub, the text the viewer's. */
const SUBTITLE_ONLY_CLIP: KeepWatchingClip = {
  ...JESUS_CLIP,
  audioLanguageSlug: "english",
  subtitleLanguageSlug: "thai",
  subtitleOnly: true,
}

function intent(over: Partial<WatchIntent> = {}): WatchIntent {
  return {
    videoSlug: "jesus",
    startSeconds: 740,
    audioLanguageSlug: "english",
    subtitleLanguageSlug: null,
    subtitleOnly: false,
    origin: "explore",
    createdAt: T0,
    ...over,
  }
}

function state(over: Partial<WatchIntent> = {}): KeepWatchingState {
  const next = keepWatchingStateFor(intent(over))
  if (next == null) throw new Error("fixture builds no state")
  return next
}

const SEED_URL = "https://stream.mux.com/jesusEnglishDub.m3u8"
const CANONICAL_URL = "https://stream.mux.com/jesusEnglishCanonical.m3u8"
const DUB_URL = "https://stream.mux.com/jesusSpanishDub.m3u8"

describe("the intent store", () => {
  it("hands a fresh intent to the route of its own slug only", () => {
    let now = T0
    const store = createWatchIntentStore(() => now)
    const put = store.put({
      videoSlug: "jesus",
      startSeconds: 740,
      audioLanguageSlug: "english",
      subtitleLanguageSlug: null,
      subtitleOnly: false,
      origin: "explore",
    })

    expect(put.createdAt).toBe(T0)
    now = T0 + 1_000
    expect(store.peek("magdalena")).toBeNull()
    expect(store.peek("jesus")).toBe(put)
  })

  it("lets a render peek twice: a peek never consumes", () => {
    const store = createWatchIntentStore(() => T0)
    const put = store.put(intent())

    expect(store.peek("jesus")).toBe(put)
    expect(store.peek("jesus")).toBe(put)
  })

  it("is one-shot once the route consumes it", () => {
    const store = createWatchIntentStore(() => T0)
    const put = store.put(intent())

    store.consume(put)

    expect(store.peek("jesus")).toBeNull()
  })

  it("keeps a newer intent when the route consumes an older one", () => {
    const store = createWatchIntentStore(() => T0)
    const older = store.put(intent())
    const newer = store.put(intent({ startSeconds: 12 }))

    store.consume(older)

    expect(store.peek("jesus")).toBe(newer)
  })

  it("ignores an intent older than its time-to-live", () => {
    let now = T0
    const store = createWatchIntentStore(() => now)
    store.put(intent())

    now = T0 + WATCH_INTENT_TTL_MS - 1
    expect(store.peek("jesus")).not.toBeNull()
    now = T0 + WATCH_INTENT_TTL_MS
    expect(store.peek("jesus")).toBeNull()
  })

  it("covers only the tap to the first render (KTD11 starts at 30 s)", () => {
    expect(WATCH_INTENT_TTL_MS).toBe(30_000)
  })
})

describe("openKeepWatching", () => {
  it("writes the intent, then opens the watch page with the clip's seed", () => {
    const store = createWatchIntentStore(() => T0)
    const order: string[] = []
    const navigate = jest.fn((href: string) => {
      // The route peeks on its first render, so the intent must exist first.
      order.push(store.peek("jesus") == null ? "navigate-empty" : "navigate")
      return href
    })

    const written = openKeepWatching({
      clip: JESUS_CLIP,
      positionSeconds: 740,
      navigate,
      store,
    })

    expect(order).toEqual(["navigate"])
    expect(written).toEqual({
      videoSlug: "jesus",
      startSeconds: 740,
      audioLanguageSlug: "english",
      subtitleLanguageSlug: "english",
      subtitleOnly: false,
      origin: "explore",
      createdAt: T0,
    })
    const href = navigate.mock.calls[0][0]
    const [path, query] = href.split("?seed=")
    expect(path).toBe("/watch/jesus")
    // The seed carries the clip's own stream, so the page plays at once.
    expect(decodeWatchSeed(query)).toEqual({
      slug: "jesus",
      title: "JESUS",
      imageUrl: "https://images.example/jesus.jpg",
      playbackId: "jesusEnglishDub",
    })
  })

  it("carries no mute state: the page starts with sound (R43)", () => {
    const written = openKeepWatching({
      clip: JESUS_CLIP,
      positionSeconds: 740,
      navigate: () => {},
      store: createWatchIntentStore(() => T0),
    })

    expect(Object.keys(written).sort()).toEqual(
      [
        "audioLanguageSlug",
        "createdAt",
        "origin",
        "startSeconds",
        "subtitleLanguageSlug",
        "subtitleOnly",
        "videoSlug",
      ].sort(),
    )
  })

  it("encodes a slug that needs it", () => {
    const navigate = jest.fn()
    openKeepWatching({
      clip: { ...JESUS_CLIP, slug: "jesus/english" },
      positionSeconds: 740,
      navigate,
      store: createWatchIntentStore(() => T0),
    })

    expect(navigate.mock.calls[0][0]).toMatch(/^\/watch\/jesus%2Fenglish\?/)
  })
})

describe("keepWatchingStartSeconds", () => {
  const window = JESUS_CLIP.window

  it("starts at the point the viewer reached in the clip", () => {
    expect(keepWatchingStartSeconds(window, 740)).toBe(740)
  })

  it("starts at the clip start during the veil (no position yet)", () => {
    expect(keepWatchingStartSeconds(window, null)).toBe(720)
    expect(keepWatchingStartSeconds(window, Number.NaN)).toBe(720)
    // A player not yet seeked to the window still reads the asset start.
    expect(keepWatchingStartSeconds(window, 0)).toBe(720)
  })

  it("never starts past the clip", () => {
    expect(keepWatchingStartSeconds(window, 900)).toBe(750)
  })
})

describe("rankStartSeconds", () => {
  it("picks the intent start over saved progress", () => {
    // AE6: saved 1:10:00, tap at 0:12:20.
    expect(rankStartSeconds(state().start, 4200)).toBe(740)
  })

  it("picks saved progress over nothing", () => {
    expect(rankStartSeconds(null, 4200)).toBe(4200)
  })

  it("gives nothing for a deep link with no intent and no progress", () => {
    expect(rankStartSeconds(null, null)).toBeNull()
  })

  it("gives nothing once the start is spent, never the saved position", () => {
    const spent = advanceKeepWatching(
      advanceKeepWatching(state(), { url: CANONICAL_URL, settled: true }),
      { url: DUB_URL, settled: true },
    )

    expect(spent.start.phase).toBe("spent")
    expect(rankStartSeconds(spent.start, 4200)).toBeNull()
  })
})

describe("advanceKeepWatching", () => {
  it("keeps the start live over the seed, then over the canonical stream", () => {
    const seed = advanceKeepWatching(state(), {
      url: SEED_URL,
      settled: false,
    })
    expect(seed.start).toEqual({
      phase: "live",
      seconds: 740,
      canonicalUrl: null,
    })

    const canonical = advanceKeepWatching(seed, {
      url: CANONICAL_URL,
      settled: true,
    })
    expect(canonical.start).toEqual({
      phase: "live",
      seconds: 740,
      canonicalUrl: CANONICAL_URL,
    })
  })

  it("returns the same state when nothing moved, so a render loop cannot start", () => {
    const canonical = advanceKeepWatching(state(), {
      url: CANONICAL_URL,
      settled: true,
    })

    expect(
      advanceKeepWatching(canonical, { url: CANONICAL_URL, settled: true }),
    ).toBe(canonical)
    const seed = state()
    expect(advanceKeepWatching(seed, { url: SEED_URL, settled: false })).toBe(
      seed,
    )
  })

  it("spends the start when a later dub leaves the canonical stream", () => {
    const canonical = advanceKeepWatching(state(), {
      url: CANONICAL_URL,
      settled: true,
    })

    const dub = advanceKeepWatching(canonical, { url: DUB_URL, settled: true })

    expect(dub.start).toEqual({ phase: "spent" })
    expect(
      advanceKeepWatching(dub, { url: CANONICAL_URL, settled: true }),
    ).toBe(dub)
  })

  it("does not take a settled dub with no stream as the canonical stream", () => {
    const next = advanceKeepWatching(state(), { url: null, settled: true })

    expect(next.start).toEqual({
      phase: "live",
      seconds: 740,
      canonicalUrl: null,
    })
  })
})

describe("keepWatchingAfterChoice (the R17 offer's hook, U11)", () => {
  it("replaces the start when the choice comes before the swap", () => {
    const seed = advanceKeepWatching(state(), {
      url: SEED_URL,
      settled: false,
    })

    const chosen = keepWatchingAfterChoice(seed, 4200)
    const canonical = advanceKeepWatching(chosen, {
      url: CANONICAL_URL,
      settled: true,
    })

    expect(rankStartSeconds(canonical.start, 4200)).toBe(4200)
    expect(rankStartSeconds(keepWatchingAfterChoice(seed, 0).start, 4200)).toBe(
      0,
    )
  })

  it("ends the progress hold", () => {
    expect(keepWatchingProgressHold(state())).not.toBeNull()

    expect(keepWatchingProgressHold(keepWatchingAfterChoice(state(), 0))).toBe(
      null,
    )
  })

  it("never reopens a spent start", () => {
    const spent = advanceKeepWatching(
      advanceKeepWatching(state(), { url: CANONICAL_URL, settled: true }),
      { url: DUB_URL, settled: true },
    )

    expect(keepWatchingAfterChoice(spent, 4200).start).toEqual({
      phase: "spent",
    })
  })
})

describe("keepWatchingProgressHold (KTD12)", () => {
  it("names one hold per intent and lasts the offer's duration", () => {
    const hold = keepWatchingProgressHold(state())

    expect(hold).toEqual({
      id: `keep-watching:jesus:${T0}`,
      durationMs: KEEP_WATCHING_OFFER_DURATION_MS,
    })
    // Stable across renders: the same id never restarts the hold's clock.
    expect(keepWatchingProgressHold(state())).toEqual(hold)
    expect(keepWatchingProgressHold(state({ createdAt: T0 + 1 }))?.id).not.toBe(
      hold?.id,
    )
  })

  it("holds nothing for a page with no intent", () => {
    expect(keepWatchingProgressHold(null)).toBeNull()
  })
})

describe("keepWatchingLanguages (R16, R43)", () => {
  it("keeps the clip's dub and the saved subtitle setting after a dubbed clip", () => {
    // The clip's captions were a mute aid; they do not carry over.
    expect(
      keepWatchingLanguages(intent({ subtitleLanguageSlug: "english" })),
    ).toEqual({
      audioLanguageSlug: "english",
      subtitleLanguageSlug: null,
      subtitlesOn: false,
    })
  })

  it("turns subtitles on in the clip's subtitle language after a subtitle-only clip", () => {
    const written = openKeepWatching({
      clip: SUBTITLE_ONLY_CLIP,
      positionSeconds: 740,
      navigate: () => {},
      store: createWatchIntentStore(() => T0),
    })

    expect(keepWatchingLanguages(written)).toEqual({
      audioLanguageSlug: "english",
      subtitleLanguageSlug: "thai",
      subtitlesOn: true,
    })
  })

  it("turns nothing on for a subtitle-only clip with no track", () => {
    expect(
      keepWatchingLanguages(
        intent({ subtitleOnly: true, subtitleLanguageSlug: null }),
      ),
    ).toEqual({
      audioLanguageSlug: "english",
      subtitleLanguageSlug: null,
      subtitlesOn: false,
    })
  })
})

describe("keepWatchingStateFor", () => {
  it("is null with no intent", () => {
    expect(keepWatchingStateFor(null)).toBeNull()
  })

  it("keeps the Explore origin in page state for telemetry", () => {
    expect(state().intent.origin).toBe("explore")
    expect(state().holdActive).toBe(true)
  })
})
