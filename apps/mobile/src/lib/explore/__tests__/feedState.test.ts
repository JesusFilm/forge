import {
  BLUR_RELEASE_GRACE_MS,
  INITIAL_FEED_STATE,
  activeSlot,
  activeWantsPlay,
  audiblePlayer,
  canSwipeNext,
  canSwipePrevious,
  currentClip,
  feedReducer,
  isClipFailed,
  needsClip,
  nextClip,
  previousClip,
  releaseRequest,
  standbySlot,
  toFeedClip,
  veilVisible,
  type FeedEvent,
  type FeedPhase,
  type FeedState,
} from "../feedState"
import type { PlayerMode } from "../playerMode"
import type { ReadyClip } from "../types"

// ── Fixtures ────────────────────────────────────────────────────────

function clip(n: number): ReadyClip {
  return {
    videoId: `video-${n}`,
    coreId: `core-${n}`,
    slug: `slug-${n}`,
    label: "shortFilm",
    availability: "AUDIO",
    durationSeconds: 600,
    muxPlaybackId: `mux-${n}`,
    watchLanguageSlug: "swahili",
    title: `Title ${n}`,
    description: `Description ${n}`,
    imageUrl: `https://images.example/${n}.jpg`,
    feedLanguageSlug: "swahili",
    streamUrl: `https://stream.mux.com/mux-${n}.m3u8`,
    audioLanguageSlug: "swahili",
    subtitleLanguageSlug: "swahili",
    subtitleVttSrc: `https://subtitles.example/${n}.vtt`,
    subtitleOnly: false,
    window: { startSeconds: 100 + n, endSeconds: 130 + n },
    cut: "sentence",
  }
}

function run(state: FeedState, ...events: FeedEvent[]): FeedState {
  return events.reduce(feedReducer, state)
}

function activeToken(state: FeedState): number {
  const slot = activeSlot(state)
  if (slot == null) throw new Error("no active slot")
  return slot.token
}

function standbyToken(state: FeedState): number {
  const slot = standbySlot(state)
  if (slot == null) throw new Error("no standby slot")
  return slot.token
}

function slugOf(state: FeedState): string | undefined {
  return currentClip(state)?.slug
}

const focus = (playerMode: PlayerMode = "two"): FeedEvent => ({
  type: "focus",
  playerMode,
})
const queue = (n: number): FeedEvent => ({ type: "clipQueued", clip: clip(n) })
const blur: FeedEvent = { type: "blur", positionSeconds: null }

function preparing(playerMode: PlayerMode = "two"): FeedState {
  return run(INITIAL_FEED_STATE, focus(playerMode))
}

function veiled(playerMode: PlayerMode = "two"): FeedState {
  return run(preparing(playerMode), queue(1))
}

/** Plays the players' role: the active clip loads and confirms motion. */
function startActive(state: FeedState): FeedState {
  const loaded = feedReducer(state, {
    type: "loaded",
    token: activeToken(state),
  })
  return feedReducer(loaded, { type: "playing", token: activeToken(loaded) })
}

function playing(playerMode: PlayerMode = "two"): FeedState {
  return startActive(veiled(playerMode))
}

function paused(): FeedState {
  return feedReducer(playing(), { type: "tap" })
}

function clipFailed(): FeedState {
  const state = veiled()
  return feedReducer(state, {
    type: "error",
    token: activeToken(state),
    msSinceSourceSet: 1_000,
  })
}

function readyStandby(state: FeedState): FeedState {
  return feedReducer(state, { type: "loaded", token: standbyToken(state) })
}

/**
 * One swipe up on the two-player path, driven through real events: the queue
 * supplies the next clip when it is asked, the standby loads, the viewer
 * swipes, the pager rests, and the incoming player confirms motion.
 */
function advance(state: FeedState, n: number): FeedState {
  const queued = needsClip(state) ? feedReducer(state, queue(n)) : state
  const swiped = run(
    readyStandby(queued),
    { type: "swipeNext" },
    { type: "rest" },
  )
  return feedReducer(swiped, { type: "playing", token: activeToken(swiped) })
}

function historyOf(count: number): FeedState {
  let state = playing()
  for (let n = 2; n <= count; n++) state = advance(state, n)
  return state
}

// ── First focus (R46) ───────────────────────────────────────────────

describe("before the first focus", () => {
  const everyEventButFocus: FeedEvent[] = [
    blur,
    { type: "background", positionSeconds: null },
    { type: "keepWatching", positionSeconds: null },
    { type: "graceExpired" },
    queue(1),
    { type: "offline" },
    { type: "empty" },
    { type: "retry" },
    { type: "swipeNext" },
    { type: "swipePrevious" },
    { type: "rest" },
    { type: "loaded", token: 1 },
    { type: "playing", token: 1 },
    { type: "error", token: 1, msSinceSourceSet: 1_000 },
    { type: "timeout", token: 1 },
    { type: "tap" },
    { type: "systemPause" },
    { type: "overlayOpen" },
    { type: "overlayClose" },
  ]

  it.each(everyEventButFocus.map((event) => [event.type, event] as const))(
    "%s leaves Unvisited unchanged",
    (_type, event) => {
      expect(feedReducer(INITIAL_FEED_STATE, event)).toBe(INITIAL_FEED_STATE)
    },
  )

  it("asks for no clip and names no player until the first focus", () => {
    expect(INITIAL_FEED_STATE.phase).toBe("unvisited")
    expect(needsClip(INITIAL_FEED_STATE)).toBe(false)
    expect(activeSlot(INITIAL_FEED_STATE)).toBeNull()
    expect(standbySlot(INITIAL_FEED_STATE)).toBeNull()
  })

  it("leaves Unvisited on the first focus and asks the queue for a clip", () => {
    const state = preparing()
    expect(state.phase).toBe("preparing")
    expect(needsClip(state)).toBe(true)
  })

  it("applies the focus event's player mode at the first focus only", () => {
    const state = run(veiled("two"), blur, focus("one"))
    expect(state.playerMode).toBe("two")
  })

  it("ignores a second focus while the feed already has focus", () => {
    const state = playing()
    expect(feedReducer(state, focus())).toBe(state)
  })
})

// ── The state diagram ───────────────────────────────────────────────

type Transition = {
  name: string
  from: FeedPhase
  to: FeedPhase
  setup: () => FeedState
  event: (state: FeedState) => FeedEvent
}

const withinGraceReturn = (setup: () => FeedState) => () =>
  feedReducer(setup(), blur)

const transitions: Transition[] = [
  {
    name: "first focus",
    from: "unvisited",
    to: "preparing",
    setup: () => INITIAL_FEED_STATE,
    event: () => focus(),
  },
  {
    name: "first clip queued",
    from: "preparing",
    to: "veiled",
    setup: () => preparing(),
    event: () => queue(1),
  },
  {
    name: "no network or admin unreachable",
    from: "preparing",
    to: "offline",
    setup: () => preparing(),
    event: () => ({ type: "offline" }),
  },
  {
    name: "definitive, no eligible video",
    from: "preparing",
    to: "empty",
    setup: () => preparing(),
    event: () => ({ type: "empty" }),
  },
  {
    name: "retry",
    from: "offline",
    to: "preparing",
    setup: () => run(preparing(), { type: "offline" }),
    event: () => ({ type: "retry" }),
  },
  {
    name: "playback starts",
    from: "veiled",
    to: "playing",
    setup: () => veiled(),
    event: (state) => ({ type: "playing", token: activeToken(state) }),
  },
  {
    name: "return, viewer had paused (veil lifts with no play)",
    from: "veiled",
    to: "paused",
    setup: () => run(paused(), blur, { type: "graceExpired" }, focus()),
    event: (state) => ({ type: "loaded", token: activeToken(state) }),
  },
  {
    name: "source error or missed start seek",
    from: "veiled",
    to: "clipFailed",
    setup: () => veiled(),
    event: (state) => ({
      type: "error",
      token: activeToken(state),
      msSinceSourceSet: 1_000,
    }),
  },
  {
    name: "timeout",
    from: "veiled",
    to: "clipFailed",
    setup: () => veiled(),
    event: (state) => ({ type: "timeout", token: activeToken(state) }),
  },
  {
    name: "swipe",
    from: "clipFailed",
    to: "veiled",
    setup: () => run(clipFailed(), queue(2)),
    event: () => ({ type: "swipeNext" }),
  },
  {
    name: "viewer tap",
    from: "playing",
    to: "paused",
    setup: () => playing(),
    event: () => ({ type: "tap" }),
  },
  {
    name: "viewer tap",
    from: "paused",
    to: "playing",
    setup: () => paused(),
    event: () => ({ type: "tap" }),
  },
  {
    name: "swipe with preload miss",
    from: "playing",
    to: "veiled",
    setup: () => run(playing(), queue(2)),
    event: () => ({ type: "swipeNext" }),
  },
  {
    name: "swipe in one-player mode",
    from: "playing",
    to: "veiled",
    setup: () => run(playing("one"), queue(2)),
    event: () => ({ type: "swipeNext" }),
  },
  {
    name: "swipe up with a ready standby (no veil)",
    from: "playing",
    to: "playing",
    setup: () => readyStandby(run(playing(), queue(2))),
    event: () => ({ type: "swipeNext" }),
  },
  {
    name: "swipe",
    from: "paused",
    to: "veiled",
    setup: () => run(paused(), queue(2)),
    event: () => ({ type: "swipeNext" }),
  },
  ...(["playing", "paused"] as const).flatMap((from): Transition[] => {
    const setup = from === "playing" ? () => playing() : () => paused()
    return [
      { name: "tab switch", from, to: "blurred", setup, event: () => blur },
      {
        name: "Keep watching",
        from,
        to: "blurred",
        setup,
        event: () => ({ type: "keepWatching", positionSeconds: null }),
      },
      {
        name: "background",
        from,
        to: "blurred",
        setup,
        event: () => ({ type: "background", positionSeconds: null }),
      },
    ]
  }),
  {
    name: "blur",
    from: "veiled",
    to: "blurred",
    setup: () => veiled(),
    event: () => blur,
  },
  {
    name: "blur",
    from: "clipFailed",
    to: "blurred",
    setup: () => clipFailed(),
    event: () => blur,
  },
  {
    name: "blur",
    from: "preparing",
    to: "blurred",
    setup: () => preparing(),
    event: () => blur,
  },
  {
    name: "blur",
    from: "offline",
    to: "blurred",
    setup: () => run(preparing(), { type: "offline" }),
    event: () => blur,
  },
  {
    name: "blur",
    from: "empty",
    to: "blurred",
    setup: () => run(preparing(), { type: "empty" }),
    event: () => blur,
  },
  {
    name: "return within the grace, clip was playing",
    from: "blurred",
    to: "playing",
    setup: withinGraceReturn(() => playing()),
    event: () => focus(),
  },
  {
    name: "return within the grace, clip was system-paused",
    from: "blurred",
    to: "playing",
    setup: withinGraceReturn(() => run(playing(), { type: "systemPause" })),
    event: () => focus(),
  },
  {
    name: "return within the grace, viewer had paused",
    from: "blurred",
    to: "paused",
    setup: withinGraceReturn(() => paused()),
    event: () => focus(),
  },
  {
    name: "return after a release",
    from: "blurred",
    to: "veiled",
    setup: () => run(playing(), blur, { type: "graceExpired" }),
    event: () => focus(),
  },
]

describe("the state diagram", () => {
  it.each(transitions.map((t) => [t.from, t.to, t.name, t] as const))(
    "%s → %s: %s",
    (from, to, _name, transition) => {
      const state = transition.setup()
      expect(state.phase).toBe(from)
      expect(feedReducer(state, transition.event(state)).phase).toBe(to)
    },
  )

  it("reaches every state of the diagram", () => {
    // A Record, so a new phase fails to compile until it is listed here.
    const phases: Record<FeedPhase, true> = {
      unvisited: true,
      preparing: true,
      offline: true,
      empty: true,
      veiled: true,
      playing: true,
      paused: true,
      clipFailed: true,
      blurred: true,
    }
    const reached = new Set(transitions.flatMap((t) => [t.from, t.to]))
    expect([...reached].sort()).toEqual(Object.keys(phases).sort())
  })
})

// ── Two players, one sound (KTD2) ───────────────────────────────────

describe("a swipe up on the two-player path", () => {
  it("makes the ready standby current, shows no veil, and points the other player at the next clip", () => {
    const before = readyStandby(run(playing(), queue(2)))
    expect(activeSlot(before)?.player).toBe("a")
    expect(standbySlot(before)?.player).toBe("b")

    const swiped = feedReducer(before, { type: "swipeNext" })
    expect(swiped.phase).toBe("playing")
    expect(veilVisible(swiped)).toBe(false)
    expect(activeSlot(swiped)?.player).toBe("b")
    expect(activeSlot(swiped)?.token).toBe(standbyToken(before))
    expect(slugOf(swiped)).toBe("slug-2")

    const next = feedReducer(swiped, queue(3))
    expect(standbySlot(next)?.player).toBe("a")
    expect(standbySlot(next)?.clip.slug).toBe("slug-3")
    expect(standbySlot(next)?.token).not.toBe(activeToken(before))
  })

  it("never gives sound to two players, and gives the incoming one sound only on confirmed motion", () => {
    const before = readyStandby(run(playing(), queue(2)))
    const outgoingToken = activeToken(before)
    expect(audiblePlayer(before)).toBe("a")

    const swiped = feedReducer(before, { type: "swipeNext" })
    // A late tick from the outgoing clip must not hand sound back to it.
    const lateTick = feedReducer(swiped, {
      type: "playing",
      token: outgoingToken,
    })
    const confirmed = feedReducer(lateTick, {
      type: "playing",
      token: activeToken(lateTick),
    })

    expect(
      [before, swiped, lateTick, confirmed].map((state) =>
        audiblePlayer(state),
      ),
    ).toEqual(["a", null, null, "b"])
  })

  it("never gives the standby sound, even when it reports motion", () => {
    const state = readyStandby(run(playing(), queue(2)))
    const next = feedReducer(state, {
      type: "playing",
      token: standbyToken(state),
    })
    expect(audiblePlayer(next)).toBe("a")
  })

  it("goes to Veiled when the standby is not ready, and a playing event returns to Playing", () => {
    const swiped = run(playing(), queue(2), { type: "swipeNext" })
    expect(swiped.phase).toBe("veiled")
    expect(veilVisible(swiped)).toBe(true)
    expect(activeWantsPlay(swiped)).toBe(true)
    expect(audiblePlayer(swiped)).toBeNull()

    const moving = feedReducer(swiped, {
      type: "playing",
      token: activeToken(swiped),
    })
    expect(moving.phase).toBe("playing")
    expect(audiblePlayer(moving)).toBe("b")
  })

  it("clears the viewer's pause on a swipe from Paused", () => {
    const swiped = run(paused(), queue(2), { type: "swipeNext" })
    expect(swiped.phase).toBe("veiled")
    expect(swiped.viewerPaused).toBe(false)
    expect(activeWantsPlay(swiped)).toBe(true)
  })

  it("plays a ready standby with no veil on a swipe from Paused", () => {
    const swiped = run(readyStandby(run(paused(), queue(2))), {
      type: "swipeNext",
    })
    expect(swiped.phase).toBe("playing")
    expect(swiped.viewerPaused).toBe(false)
  })

  it("marks the pager moving on a swipe and at rest on the rest event", () => {
    const swiped = run(playing(), queue(2), { type: "swipeNext" })
    expect(swiped.pagerAtRest).toBe(false)
    expect(feedReducer(swiped, { type: "rest" }).pagerAtRest).toBe(true)
  })

  it("does nothing on a swipe up with no next clip", () => {
    const state = playing()
    expect(canSwipeNext(state)).toBe(false)
    expect(feedReducer(state, { type: "swipeNext" })).toBe(state)
  })
})

// ── History (R41, KTD25) ────────────────────────────────────────────

describe("the session history", () => {
  it("restarts the previous clip at its own start on a swipe down", () => {
    const atTwo = historyOf(2)
    const oldTokens = [activeToken(atTwo), standbySlot(atTwo)?.token]

    const back = feedReducer(atTwo, { type: "swipePrevious" })
    expect(slugOf(back)).toBe("slug-1")
    expect(back.phase).toBe("veiled")
    expect(activeSlot(back)?.startAtSeconds).toBe(clip(1).window.startSeconds)
    expect(oldTokens).not.toContain(activeToken(back))
  })

  it("restarts a clip at its own start when the player that just played it becomes the standby", () => {
    const atTwo = historyOf(2)
    const playedToken = activeToken(atTwo)
    expect(activeSlot(atTwo)?.status).toBe("ready")

    // Player b played clip 2 part-way; as the standby it must reload clip 2.
    const back = feedReducer(atTwo, { type: "swipePrevious" })
    const standby = standbySlot(back)
    expect(standby?.player).toBe("b")
    expect(standby?.clip.slug).toBe("slug-2")
    expect(standby?.token).not.toBe(playedToken)
    expect(standby?.status).toBe("pending")
    expect(standby?.startAtSeconds).toBe(clip(2).window.startSeconds)
  })

  it("does nothing on a swipe down with empty history", () => {
    const state = playing()
    expect(canSwipePrevious(state)).toBe(false)
    expect(feedReducer(state, { type: "swipePrevious" })).toBe(state)
  })

  it("covers AE14: back through 20 clips, then forward through the seen clips, then new clips", () => {
    // The queue already computed clip 22; it stays reserved for the end.
    let state = feedReducer(historyOf(21), queue(22))
    expect(slugOf(state)).toBe("slug-21")

    for (let i = 0; i < 20; i++) {
      state = feedReducer(state, { type: "swipePrevious" })
      expect(state.pagerAtRest).toBe(false)
    }
    state = feedReducer(state, { type: "rest" })
    expect(slugOf(state)).toBe("slug-1")
    expect(state.cursor).toBe(0)
    expect(activeSlot(state)?.clip.slug).toBe("slug-1")
    expect(activeSlot(state)?.startAtSeconds).toBe(clip(1).window.startSeconds)
    state = startActive(state)

    const replayed: string[] = []
    for (let i = 0; i < 20; i++) {
      expect(needsClip(state)).toBe(false)
      // A clip the queue offers mid-history never displaces the reserved one.
      state = feedReducer(state, queue(99))
      state = run(readyStandby(state), { type: "swipeNext" }, { type: "rest" })
      expect(state.phase).toBe("playing")
      replayed.push(slugOf(state) ?? "")
      state = feedReducer(state, { type: "playing", token: activeToken(state) })
    }
    expect(replayed).toEqual(
      Array.from({ length: 20 }, (_, i) => `slug-${i + 2}`),
    )

    state = run(readyStandby(state), { type: "swipeNext" })
    expect(slugOf(state)).toBe("slug-22")
    expect(needsClip(state)).toBe(true)
  })

  it("points the standby in the direction of travel", () => {
    const atThree = historyOf(3)

    const backOnce = feedReducer(atThree, { type: "swipePrevious" })
    expect(slugOf(backOnce)).toBe("slug-2")
    expect(standbySlot(backOnce)?.clip.slug).toBe("slug-1")

    // No clip before the first one, so the standby takes the next clip.
    const backTwice = feedReducer(backOnce, { type: "swipePrevious" })
    expect(slugOf(backTwice)).toBe("slug-1")
    expect(standbySlot(backTwice)?.clip.slug).toBe("slug-2")

    const forward = feedReducer(backTwice, { type: "swipeNext" })
    expect(slugOf(forward)).toBe("slug-2")
    expect(standbySlot(forward)?.clip.slug).toBe("slug-3")
  })

  it("names the neighbour clips for the pager's outer slots", () => {
    const state = feedReducer(historyOf(3), { type: "swipePrevious" })
    expect(previousClip(state)?.slug).toBe("slug-1")
    expect(nextClip(state)?.slug).toBe("slug-3")
  })

  it("keeps only what a replay needs in a history entry, and no hydration object", () => {
    const hydrated = {
      ...clip(1),
      hydration: { dubs: [{ id: "dub-1" }], editions: [{ id: "edition-1" }] },
    }
    const state = run(preparing(), { type: "clipQueued", clip: hydrated })
    const entry = currentClip(state)

    expect(entry).toEqual({
      videoId: "video-1",
      coreId: "core-1",
      slug: "slug-1",
      title: "Title 1",
      description: "Description 1",
      imageUrl: "https://images.example/1.jpg",
      muxPlaybackId: "mux-1",
      streamUrl: "https://stream.mux.com/mux-1.m3u8",
      feedLanguageSlug: "swahili",
      audioLanguageSlug: "swahili",
      subtitleLanguageSlug: "swahili",
      subtitleVttSrc: "https://subtitles.example/1.vtt",
      subtitleOnly: false,
      window: { startSeconds: 101, endSeconds: 131 },
      cut: "sentence",
    })
    expect(entry).not.toHaveProperty("hydration")
    expect(toFeedClip(hydrated)).toEqual(entry)
  })
})

// ── Failed clips (R38, R40) ─────────────────────────────────────────

describe("a clip that cannot play", () => {
  it("stays failed until a swipe, with no auto-advance", () => {
    const failed = clipFailed()
    expect(isClipFailed(failed)).toBe(true)
    expect(veilVisible(failed)).toBe(false)
    expect(activeWantsPlay(failed)).toBe(false)

    const token = activeSlot(failed)?.token ?? -1
    const later = run(
      failed,
      queue(2),
      { type: "rest" },
      { type: "loaded", token },
      { type: "playing", token },
      { type: "timeout", token },
      { type: "tap" },
      { type: "systemPause" },
    )
    expect(later.phase).toBe("clipFailed")
    expect(slugOf(later)).toBe("slug-1")

    const swiped = feedReducer(later, { type: "swipeNext" })
    expect(swiped.phase).toBe("veiled")
    expect(slugOf(swiped)).toBe("slug-2")
  })

  it("fails on the 12 s timeout in Veiled", () => {
    const state = veiled()
    const next = feedReducer(state, {
      type: "timeout",
      token: activeToken(state),
    })
    expect(next.phase).toBe("clipFailed")
  })

  it("fails a clip whose start seek misses after its first playing tick", () => {
    const state = playing()
    const next = feedReducer(state, {
      type: "error",
      token: activeToken(state),
      msSinceSourceSet: 3_000,
    })
    expect(next.phase).toBe("clipFailed")
    expect(audiblePlayer(next)).toBeNull()
  })

  it("drops an error or a timeout from a clip that is no longer current", () => {
    const first = veiled()
    const staleToken = activeToken(first)
    const moved = run(first, queue(2), { type: "swipeNext" })

    expect(
      feedReducer(moved, {
        type: "error",
        token: staleToken,
        msSinceSourceSet: 500,
      }),
    ).toBe(moved)
    expect(feedReducer(moved, { type: "timeout", token: staleToken })).toBe(
      moved,
    )
  })
})

// ── Blur and release (R3, KTD13) ────────────────────────────────────

describe("leaving and returning", () => {
  const exits: [FeedPhase, () => FeedState][] = [
    ["preparing", () => preparing()],
    ["offline", () => run(preparing(), { type: "offline" })],
    ["empty", () => run(preparing(), { type: "empty" })],
    ["veiled", () => veiled()],
    ["playing", () => playing()],
    ["paused", () => paused()],
    ["clipFailed", () => clipFailed()],
  ]

  it.each(exits)(
    "%s has a blur exit and a return within the grace restores it",
    (phase, setup) => {
      const blurred = feedReducer(setup(), blur)
      expect(blurred.phase).toBe("blurred")
      expect(feedReducer(blurred, focus()).phase).toBe(phase)
    },
  )

  it("mutes and pauses at once, releases the standby at once, and the active player after the grace", () => {
    const state = readyStandby(run(playing(), queue(2)))
    expect(releaseRequest(state)).toEqual({ standby: "keep", active: "keep" })

    const blurred = feedReducer(state, blur)
    expect(audiblePlayer(blurred)).toBeNull()
    expect(activeWantsPlay(blurred)).toBe(false)
    expect(standbySlot(blurred)).toBeNull()
    expect(activeSlot(blurred)).not.toBeNull()
    expect(releaseRequest(blurred)).toEqual({
      standby: "release",
      active: "afterGrace",
    })
    expect(BLUR_RELEASE_GRACE_MS).toBe(10_000)

    const expired = feedReducer(blurred, { type: "graceExpired" })
    expect(activeSlot(expired)).toBeNull()
    expect(releaseRequest(expired)).toEqual({
      standby: "release",
      active: "release",
    })
  })

  it("releases both players at once on Keep watching", () => {
    const state = readyStandby(run(playing(), queue(2)))
    const left = feedReducer(state, {
      type: "keepWatching",
      positionSeconds: 110,
    })
    expect(activeSlot(left)).toBeNull()
    expect(standbySlot(left)).toBeNull()
    expect(releaseRequest(left)).toEqual({
      standby: "release",
      active: "release",
    })
  })

  it("releases at once when Keep watching lands after the tab's blur, and a blur after it changes nothing", () => {
    const blurFirst = run(playing(), blur, {
      type: "keepWatching",
      positionSeconds: 110,
    })
    expect(activeSlot(blurFirst)).toBeNull()

    const keepFirst = run(playing(), {
      type: "keepWatching",
      positionSeconds: 110,
    })
    expect(feedReducer(keepFirst, blur)).toBe(keepFirst)
  })

  it("covers AE13 within the grace: a viewer pause stays paused, a system pause plays", () => {
    expect(run(paused(), blur, focus()).phase).toBe("paused")
    expect(run(playing(), { type: "systemPause" }, blur, focus()).phase).toBe(
      "playing",
    )
  })

  it("covers AE13 after a release: the veil lifts with no play when the viewer had paused", () => {
    const returned = run(paused(), blur, { type: "graceExpired" }, focus())
    expect(returned.phase).toBe("veiled")
    expect(activeWantsPlay(returned)).toBe(false)

    const lifted = feedReducer(returned, {
      type: "loaded",
      token: activeToken(returned),
    })
    expect(lifted.phase).toBe("paused")
    expect(veilVisible(lifted)).toBe(false)
    expect(activeWantsPlay(lifted)).toBe(false)
  })

  it("plays again after a release when the system had paused the clip", () => {
    const returned = run(
      playing(),
      { type: "systemPause" },
      blur,
      { type: "graceExpired" },
      focus(),
    )
    expect(returned.phase).toBe("veiled")
    expect(activeWantsPlay(returned)).toBe(true)
  })

  it("reloads the clip at the saved clip position after a release", () => {
    const window = clip(1).window
    const inside = run(
      playing(),
      { type: "blur", positionSeconds: window.startSeconds + 9 },
      { type: "graceExpired" },
      focus(),
    )
    expect(activeSlot(inside)?.startAtSeconds).toBe(window.startSeconds + 9)

    const outside = run(
      playing(),
      { type: "blur", positionSeconds: window.endSeconds + 5 },
      { type: "graceExpired" },
      focus(),
    )
    expect(activeSlot(outside)?.startAtSeconds).toBe(window.startSeconds)
  })

  it("reloads the standby on a return, and gives sound back only on confirmed motion", () => {
    const state = readyStandby(run(playing(), queue(2)))
    const returned = run(state, blur, focus())
    expect(standbySlot(returned)?.clip.slug).toBe("slug-2")
    expect(standbySlot(returned)?.token).not.toBe(standbyToken(state))
    expect(audiblePlayer(returned)).toBeNull()

    const moving = feedReducer(returned, {
      type: "playing",
      token: activeToken(returned),
    })
    expect(audiblePlayer(moving)).toBe("a")
  })

  it("holds a first clip that lands while blurred until the return", () => {
    const blurred = run(preparing(), blur, queue(1))
    expect(blurred.phase).toBe("blurred")
    expect(activeSlot(blurred)).toBeNull()
    expect(needsClip(blurred)).toBe(false)

    const returned = feedReducer(blurred, focus())
    expect(returned.phase).toBe("veiled")
    expect(activeSlot(returned)?.clip.slug).toBe("slug-1")
  })

  it("shows an offline answer that lands while blurred on the return", () => {
    const returned = run(preparing(), blur, { type: "offline" }, focus())
    expect(returned.phase).toBe("offline")
  })

  it("drops a grace expiry that arrives after the return", () => {
    const returned = run(playing(), blur, focus())
    expect(feedReducer(returned, { type: "graceExpired" })).toBe(returned)
  })
})

// ── Pause intent (R10, R44, R45) ────────────────────────────────────

describe("pause intent", () => {
  it("pauses on a system pause and plays again on a viewer tap", () => {
    const held = feedReducer(playing(), { type: "systemPause" })
    expect(held.phase).toBe("paused")
    expect(held.systemPaused).toBe(true)
    expect(held.viewerPaused).toBe(false)

    const resumed = feedReducer(held, { type: "tap" })
    expect(resumed.phase).toBe("playing")
    expect(resumed.systemPaused).toBe(false)
  })

  it("resumes a clip that was playing when the overlay opened", () => {
    const opened = feedReducer(playing(), { type: "overlayOpen" })
    expect(opened.phase).toBe("paused")
    expect(opened.overlay).toEqual({ wasPlaying: true })
    expect(activeWantsPlay(opened)).toBe(false)

    const closed = feedReducer(opened, { type: "overlayClose" })
    expect(closed.phase).toBe("playing")
    expect(closed.overlay).toBeNull()
  })

  it("leaves a clip the viewer had paused paused when the overlay closes", () => {
    const opened = feedReducer(paused(), { type: "overlayOpen" })
    expect(opened.overlay).toEqual({ wasPlaying: false })

    const closed = feedReducer(opened, { type: "overlayClose" })
    expect(closed.phase).toBe("paused")
    expect(closed.viewerPaused).toBe(true)
  })

  it("ignores a tap on the video while an overlay holds the clip", () => {
    const opened = feedReducer(playing(), { type: "overlayOpen" })
    expect(feedReducer(opened, { type: "tap" })).toBe(opened)
  })

  it("lifts the veil with no play when the overlay opened during the veil", () => {
    const opened = feedReducer(veiled(), { type: "overlayOpen" })
    const lifted = feedReducer(opened, {
      type: "loaded",
      token: activeToken(opened),
    })
    expect(lifted.phase).toBe("paused")
    expect(feedReducer(lifted, { type: "overlayClose" }).phase).toBe("playing")
  })
})

// ── Player mode (R7, KTD3) ──────────────────────────────────────────

describe("player mode", () => {
  it("covers AE8's second half: one-player mode has no standby, and every swipe goes to Veiled", () => {
    let state = run(playing("one"), queue(2))
    expect(standbySlot(state)).toBeNull()

    state = feedReducer(state, { type: "swipeNext" })
    expect(state.phase).toBe("veiled")
    expect(activeSlot(state)?.player).toBe("a")
    expect(standbySlot(state)).toBeNull()

    state = run(startActive(state), queue(3), { type: "swipeNext" })
    expect(state.phase).toBe("veiled")
    expect(slugOf(state)).toBe("slug-3")
    expect(standbySlot(state)).toBeNull()

    state = feedReducer(state, { type: "swipePrevious" })
    expect(state.phase).toBe("veiled")
    expect(standbySlot(state)).toBeNull()
  })

  it("demotes the launch to one player after two standby errors within 8 s while the active player is healthy", () => {
    let state = run(playing(), queue(2))
    state = feedReducer(state, {
      type: "error",
      token: standbyToken(state),
      msSinceSourceSet: 2_000,
    })
    expect(state.playerMode).toBe("two")
    expect(state.standbyErrors).toBe(1)
    expect(standbySlot(state)?.status).toBe("failed")

    // The failed standby reloads as the active player on the swipe.
    state = startActive(feedReducer(state, { type: "swipeNext" }))
    state = feedReducer(state, queue(3))
    state = feedReducer(state, {
      type: "error",
      token: standbyToken(state),
      msSinceSourceSet: 7_000,
    })

    expect(state.playerMode).toBe("one")
    expect(state.demotedThisLaunch).toBe(true)
    expect(standbySlot(state)).toBeNull()
    expect(activeSlot(state)?.player).toBe("b")
    expect(state.phase).toBe("playing")
  })

  it("counts no standby error while the active player is not healthy", () => {
    let state = run(veiled(), queue(2))
    state = feedReducer(state, {
      type: "error",
      token: standbyToken(state),
      msSinceSourceSet: 1_000,
    })
    expect(state.standbyErrors).toBe(0)
  })

  it("never demotes on a slow load", () => {
    let state = run(playing(), queue(2))
    state = feedReducer(state, {
      type: "error",
      token: standbyToken(state),
      msSinceSourceSet: 9_000,
    })
    state = startActive(feedReducer(state, { type: "swipeNext" }))
    state = feedReducer(state, queue(3))
    state = feedReducer(state, {
      type: "error",
      token: standbyToken(state),
      msSinceSourceSet: 12_000,
    })
    expect(state.standbyErrors).toBe(0)
    expect(state.playerMode).toBe("two")
  })
})
