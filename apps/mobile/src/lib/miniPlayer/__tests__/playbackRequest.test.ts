/**
 * The root player's request store (U6). Every case runs against a fresh store
 * with its own session store injected, so no module singleton crosses a case.
 */

import {
  createPlaybackRequestStore,
  samePlaybackRequest,
  sameSessionContent,
  shouldOriginateSession,
  sourceForRequest,
  type PlaybackRequest,
  type PlaybackSessionDescriptor,
} from "../playbackRequest"
import { createMiniPlayerStore, type MiniPlayerEndEvent } from "../store"

const SESSION_A: PlaybackSessionDescriptor = {
  videoId: "video-a",
  videoSlug: "video-a-slug",
  title: "Video A",
  posterUrl: "https://images.example/a.jpg",
  languageSlug: "english",
  originPattern: "watch/[slug]",
}

const SESSION_B: PlaybackSessionDescriptor = {
  ...SESSION_A,
  videoId: "video-b",
  videoSlug: "video-b-slug",
  title: "Video B",
}

// Downloaded playback has no admin id — the slug is its only on-device key
// (R20, KTD8).
const SESSION_LOCAL: PlaybackSessionDescriptor = {
  videoId: null,
  videoSlug: "downloaded-slug",
  title: "A downloaded video",
  posterUrl: null,
  languageSlug: null,
  originPattern: "watch/[slug]",
}

function makeRequest(
  overrides: Partial<PlaybackRequest> = {},
): PlaybackRequest {
  return {
    streamingUrl: "https://stream.mux.com/assetAAA111.m3u8",
    posterUrl: null,
    subtitleVttSrc: null,
    fullscreen: false,
    autostart: true,
    resumeAtSeconds: null,
    progressVideoId: "video-a",
    progressVideoSlug: null,
    progressLanguageSlug: "english",
    onToggleFullscreen: null,
    session: SESSION_A,
    ...overrides,
  }
}

function makeStores(
  facts: {
    started: boolean
    position: number
    duration: number
    reachedEnd?: boolean
  } = {
    started: false,
    position: 0,
    duration: 0,
  },
) {
  const sessionStore = createMiniPlayerStore()
  const store = createPlaybackRequestStore({ sessionStore })
  store.setPlaybackFactsSource({
    hasPlaybackStarted: () => facts.started,
    hasReachedEnd: () => facts.reachedEnd ?? false,
    readPosition: () => facts.position,
    readDuration: () => facts.duration,
  })
  return { store, sessionStore, facts }
}

describe("shouldOriginateSession (the admission predicate)", () => {
  it("refuses a video that never played, whatever its route", () => {
    expect(
      shouldOriginateSession({
        hasPlaybackStarted: false,
        hasReachedEnd: false,
        hasSource: true,
        session: SESSION_A,
      }),
    ).toBe(false)
  })

  it("refuses a surface that carries no session descriptor", () => {
    expect(
      shouldOriginateSession({
        hasPlaybackStarted: true,
        hasReachedEnd: false,
        hasSource: true,
        session: null,
      }),
    ).toBe(false)
  })

  it("refuses an R19-excluded origin route", () => {
    expect(
      shouldOriginateSession({
        hasPlaybackStarted: true,
        hasReachedEnd: false,
        hasSource: true,
        session: { ...SESSION_A, originPattern: "video/[sectionKey]" },
      }),
    ).toBe(false)
  })

  it("refuses a video that already ran to its end", () => {
    // A finished video has nothing left to continue watching, so it earns no
    // window — the same reason a video that never started earns none.
    expect(
      shouldOriginateSession({
        hasPlaybackStarted: true,
        hasReachedEnd: true,
        hasSource: true,
        session: SESSION_A,
      }),
    ).toBe(false)
  })

  it("refuses a surface that never had a stream, however live the player is", () => {
    // `hasPlaybackStarted` reads the ONE player, which may be running the
    // series trailer beneath or the outgoing episode of an Up Next replace.
    // Without this the window would carry a video that never played a frame.
    expect(
      shouldOriginateSession({
        hasPlaybackStarted: true,
        hasReachedEnd: false,
        hasSource: false,
        session: SESSION_A,
      }),
    ).toBe(false)
  })

  it("admits a played video from a route that may originate one", () => {
    expect(
      shouldOriginateSession({
        hasPlaybackStarted: true,
        hasReachedEnd: false,
        hasSource: true,
        session: SESSION_A,
      }),
    ).toBe(true)
  })
})

describe("the source an incoming request should play (R4)", () => {
  const LOADED = {
    url: "https://stream.mux.com/loaded.m3u8",
    languageSlug: "english",
  }
  const REQUESTED = "https://cdn.example.org/other-form.m3u8"

  it("keeps what the player holds when a live session names the same video", () => {
    expect(
      sourceForRequest({
        requested: REQUESTED,
        loaded: LOADED,
        language: null,
        adoptable: true,
      }),
    ).toBe(LOADED.url)
  })

  it("keeps it when the request names the dub already playing", () => {
    expect(
      sourceForRequest({
        requested: REQUESTED,
        loaded: LOADED,
        language: "english",
        adoptable: true,
      }),
    ).toBe(LOADED.url)
  })

  it("hands over a dub the viewer actually changed to", () => {
    expect(
      sourceForRequest({
        requested: REQUESTED,
        loaded: LOADED,
        language: "spanish",
        adoptable: true,
      }),
    ).toBe(REQUESTED)
  })

  it("hands over anything when no live session owns this content", () => {
    expect(
      sourceForRequest({
        requested: REQUESTED,
        loaded: LOADED,
        language: null,
        adoptable: false,
      }),
    ).toBe(REQUESTED)
  })

  it("hands over the request when the player holds nothing yet", () => {
    expect(
      sourceForRequest({
        requested: REQUESTED,
        loaded: null,
        language: null,
        adoptable: true,
      }),
    ).toBe(REQUESTED)
  })

  it("names no source for a surface that has none, adoptable or not", () => {
    // The adapter swaps on a source CHANGE, and a null never reaches it as one
    // — so what the player already holds survives the gap either way.
    for (const adoptable of [true, false])
      expect(
        sourceForRequest({
          requested: null,
          loaded: LOADED,
          language: null,
          adoptable,
        }),
      ).toBeNull()
  })

  it("matches one video across the keys a remount happens to carry", () => {
    const byId = { videoId: "video-a", videoSlug: "life-of-jesus" }
    expect(sameSessionContent(byId, { ...byId })).toBe(true)
    // Before its record lands a screen has only the slug; after, only the id
    // compare would call this a different video and replace the session.
    expect(
      sameSessionContent({ videoId: null, videoSlug: "life-of-jesus" }, byId),
    ).toBe(true)
    expect(
      sameSessionContent({ videoId: "video-b", videoSlug: "other" }, byId),
    ).toBe(false)
    expect(
      sameSessionContent({ videoId: null, videoSlug: "other" }, byId),
    ).toBe(false)
  })
})

describe("slot ownership", () => {
  it("hands the player to the newest slot and back when it goes", () => {
    const { store } = makeStores()
    const lower = store.attachSlot(makeRequest())
    store.setSlotRect(lower, { x: 0, y: 0, width: 390, height: 219 })
    const upper = store.attachSlot(
      makeRequest({ streamingUrl: "https://stream.mux.com/assetBBB222.m3u8" }),
    )

    expect(store.getSnapshot().slotId).toBe(upper)
    expect(store.getSnapshot().request?.streamingUrl).toContain("assetBBB222")
    // The rect belongs to the owning slot, so the view cannot be drawn into a
    // screen that no longer owns the player.
    expect(store.getSnapshot().rect).toBeNull()

    store.detachSlot(upper)

    expect(store.getSnapshot().slotId).toBe(lower)
    expect(store.getSnapshot().request?.streamingUrl).toContain("assetAAA111")
    expect(store.getSnapshot().rect).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 219,
    })
  })

  it("republishes only when a field actually changed", () => {
    const { store } = makeStores()
    const id = store.attachSlot(makeRequest())
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })

    store.updateSlot(id, makeRequest())
    expect(notifications).toBe(0)

    store.updateSlot(id, makeRequest({ subtitleVttSrc: "https://vtt/a.vtt" }))
    expect(notifications).toBe(1)
    expect(store.getSnapshot().request?.subtitleVttSrc).toBe(
      "https://vtt/a.vtt",
    )
  })

  it("compares the session descriptor, not its object identity", () => {
    expect(
      samePlaybackRequest(
        makeRequest({ session: { ...SESSION_A } }),
        makeRequest({ session: { ...SESSION_A } }),
      ),
    ).toBe(true)
    expect(
      samePlaybackRequest(
        makeRequest({ session: SESSION_A }),
        makeRequest({ session: { ...SESSION_A, title: "Renamed" } }),
      ),
    ).toBe(false)
  })
})

describe("a surface that never originates a session (the series trailer)", () => {
  it("takes the player when nothing is playing in a window", () => {
    const { store } = makeStores()
    const trailer = store.attachSlot(
      makeRequest({ session: null, streamingUrl: "https://trailer.m3u8" }),
    )

    expect(store.getSnapshot().slotId).toBe(trailer)
    expect(store.getSnapshot().request?.streamingUrl).toBe(
      "https://trailer.m3u8",
    )
  })

  it("is refused while a session holds the player, and never ends it", () => {
    const { store, sessionStore } = makeStores()
    const watch = store.attachSlot(makeRequest())
    store.setPlaybackFactsSource({
      hasPlaybackStarted: () => true,
      hasReachedEnd: () => false,
      readPosition: () => 61,
      readDuration: () => 600,
    })
    store.detachSlot(watch)
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")

    store.attachSlot(
      makeRequest({ session: null, streamingUrl: "https://trailer.m3u8" }),
    )

    expect(store.getSnapshot().slotId).toBeNull()
    expect(store.getSnapshot().request?.streamingUrl).toContain("assetAAA111")
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
  })

  /**
   * The heroes yield only while the window holds a LIVE video (R9), because
   * each owns a decoder of its own. The trailer's rule is stricter: it shares
   * the ONE hoisted player, and an ended window still needs it to offer a
   * replay (R27), so the trailer stays refused for as long as the session does.
   */
  it("stays refused while the window's session is ENDED, so a replay still has its player", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 61,
      duration: 600,
    })
    store.detachSlot(store.attachSlot(makeRequest()))
    sessionStore.markEnded("playToEnd")

    store.attachSlot(
      makeRequest({ session: null, streamingUrl: "https://trailer.m3u8" }),
    )

    expect(store.getSnapshot().slotId).toBeNull()
    expect(store.getSnapshot().request?.streamingUrl).toContain("assetAAA111")
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
  })

  it("takes the player, and its autostart, once the dismissed window has gone", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 61,
      duration: 600,
    })
    store.detachSlot(store.attachSlot(makeRequest()))
    const trailer = store.attachSlot(
      makeRequest({ session: null, streamingUrl: "https://trailer.m3u8" }),
    )
    expect(store.getSnapshot().slotId).toBeNull()

    sessionStore.requestDismiss()
    // Mid-exit the window still owns the player.
    expect(store.getSnapshot().slotId).toBeNull()
    sessionStore.reportExitComplete()

    expect(store.getSnapshot().slotId).toBe(trailer)
    expect(store.getSnapshot().request).toMatchObject({
      streamingUrl: "https://trailer.m3u8",
      autostart: true,
    })
  })
})

describe("a surface that owns the player before its stream resolves", () => {
  it("keeps the series trailer beneath from staying current", () => {
    // The series page pushes an episode whose seed carries no playbackId, so
    // the watch screen mounts source-less. With no slot of its own the trailer
    // stayed newest-admissible and the host painted it over the watch screen.
    const { store } = makeStores()
    const trailer = store.attachSlot(
      makeRequest({ session: null, streamingUrl: "https://trailer.m3u8" }),
    )
    const watch = store.attachSlot(makeRequest({ streamingUrl: null }))

    expect(store.getSnapshot().slotId).toBe(watch)
    expect(store.getSnapshot().request?.streamingUrl).toBeNull()
    expect(store.getSnapshot().slotId).not.toBe(trailer)
  })

  it("publishes no session across a non-null → null → non-null source", () => {
    // Up Next replaces the route in place: the screen drops its video, so the
    // source goes null mid-route. Unmounting the slot there would read as a
    // committed back press and shrink the OUTGOING video into a window.
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const id = store.attachSlot(makeRequest())

    store.updateSlot(
      id,
      makeRequest({ streamingUrl: null, session: SESSION_B }),
    )
    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(store.getSnapshot().slotId).toBe(id)

    store.updateSlot(
      id,
      makeRequest({
        streamingUrl: "https://stream.mux.com/assetBBB222.m3u8",
        session: SESSION_B,
      }),
    )

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(store.getSnapshot().slotId).toBe(id)
    expect(store.getSnapshot().request?.streamingUrl).toContain("assetBBB222")
  })

  it("publishes no session when it goes while the player runs another video", () => {
    // The facts source says "started" because the ONE player is playing the
    // trailer. A window for a video with no stream would replay nothing.
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const id = store.attachSlot(makeRequest({ streamingUrl: null }))

    store.detachSlot(id)

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(store.getSnapshot().request).toBeNull()
  })
})

describe("replacement (R12)", () => {
  it("ends the live session as replaced before any subscriber sees the new request", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const first = store.attachSlot(makeRequest())
    store.detachSlot(first)
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")

    const endings: MiniPlayerEndEvent[] = []
    sessionStore.onEnd((event) => endings.push(event))
    // The ordering pin: the departing video's flush rides this ending, and the
    // adapter re-keys its recorder off the request. If the request changed
    // first, the flush would land on the arriving video's recorder.
    const seenDuringNotify: Array<string | null> = []
    store.subscribe(() => {
      seenDuringNotify.push(sessionStore.getSnapshot().session?.videoId ?? null)
    })

    store.attachSlot(
      makeRequest({ session: SESSION_B, progressVideoId: "video-b" }),
    )

    expect(endings.map((e) => e.reason)).toEqual(["replaced"])
    expect(endings[0].session.videoId).toBe("video-a")
    expect(seenDuringNotify).toEqual([null])
    expect(store.getSnapshot().request?.progressVideoId).toBe("video-b")
  })

  it("leaves a session alone when the same video takes the slot back (R4)", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const first = store.attachSlot(makeRequest())
    store.detachSlot(first)
    const endings: MiniPlayerEndEvent[] = []
    sessionStore.onEnd((event) => endings.push(event))

    store.attachSlot(makeRequest())

    expect(endings).toEqual([])
    expect(sessionStore.getSnapshot().session?.positionSeconds).toBe(42)
  })
})

describe("admission on detach", () => {
  it("publishes no session when the video never played, and drops the request", () => {
    const { store, sessionStore } = makeStores({
      started: false,
      position: 0,
      duration: 0,
    })
    const id = store.attachSlot(makeRequest())

    store.detachSlot(id)

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(store.getSnapshot().request).toBeNull()
  })

  it("publishes a session carrying the video identity and position", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 137.5,
      duration: 1800,
    })
    const id = store.attachSlot(makeRequest())

    store.detachSlot(id)

    expect(sessionStore.getSnapshot().session).toMatchObject({
      videoId: "video-a",
      videoSlug: "video-a-slug",
      title: "Video A",
      languageSlug: "english",
      originPattern: "watch/[slug]",
      positionSeconds: 137.5,
      durationSeconds: 1800,
      phase: "playing",
    })
    // The player outlives the route: the request stays current with no slot.
    expect(store.getSnapshot().request?.progressVideoId).toBe("video-a")
    expect(store.getSnapshot().rect).toBeNull()
  })

  it("publishes no session for a video that already finished, and drops the request", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 600,
      duration: 600,
      reachedEnd: true,
    })
    const id = store.attachSlot(makeRequest())

    store.detachSlot(id)

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(store.getSnapshot().request).toBeNull()
  })

  it("carries the same identity and position shape for a slug-keyed local file", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 12,
      duration: 300,
    })
    const id = store.attachSlot(
      makeRequest({
        streamingUrl: "file:///offline/downloaded-slug/video.mp4",
        session: SESSION_LOCAL,
        progressVideoId: null,
        progressVideoSlug: "downloaded-slug",
        progressLanguageSlug: null,
      }),
    )

    store.detachSlot(id)

    expect(sessionStore.getSnapshot().session).toMatchObject({
      videoId: null,
      videoSlug: "downloaded-slug",
      positionSeconds: 12,
      durationSeconds: 300,
      phase: "playing",
    })
  })

  it("publishes a session when the surface beneath cannot originate one", () => {
    // The series page's trailer sits beneath the episode the viewer opened. It
    // is admissible only because no session exists YET, so counting it as a
    // successor would swallow the window the episode just earned (R1).
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const trailer = store.attachSlot(
      makeRequest({ session: null, streamingUrl: "https://trailer.m3u8" }),
    )
    const watch = store.attachSlot(makeRequest())

    store.detachSlot(watch)

    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
    // And the trailer is refused the moment that session exists, so the window
    // keeps the player rather than handing it straight back.
    expect(store.getSnapshot().slotId).toBeNull()
    expect(store.getSnapshot().request?.streamingUrl).toContain("assetAAA111")
    expect(trailer).toBeLessThan(watch)
  })

  it("hands the player to the trailer beneath only once the session has exited", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const trailer = store.attachSlot(
      makeRequest({ session: null, streamingUrl: "https://trailer.m3u8" }),
    )
    store.detachSlot(store.attachSlot(makeRequest()))
    expect(store.getSnapshot().slotId).toBeNull()

    sessionStore.requestDismiss()
    sessionStore.reportExitComplete()

    expect(store.getSnapshot().slotId).toBe(trailer)
    expect(store.getSnapshot().request?.streamingUrl).toBe(
      "https://trailer.m3u8",
    )
  })

  it("publishes no session when another surface is waiting to take the player back", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const lower = store.attachSlot(makeRequest())
    const upper = store.attachSlot(
      makeRequest({ session: SESSION_B, progressVideoId: "video-b" }),
    )

    store.detachSlot(upper)

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(store.getSnapshot().slotId).toBe(lower)
  })
})

describe("session teardown", () => {
  it("releases the retained request when the session ends", () => {
    const { store, sessionStore } = makeStores({
      started: true,
      position: 42,
      duration: 600,
    })
    const id = store.attachSlot(makeRequest())
    store.detachSlot(id)
    expect(store.getSnapshot().request).not.toBeNull()

    sessionStore.requestDismiss()
    sessionStore.reportExitComplete()

    expect(store.getSnapshot().request).toBeNull()
  })
})
