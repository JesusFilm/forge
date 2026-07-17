import type { WatchHomeMuxInsertConfig } from "../watchHome/config"
import type {
  WatchHomeMuxSlide,
  WatchHomeVideoSlide,
} from "../watchHome/carouselSequence"
import {
  WATCH_HOME_IMAGE_SLIDE_DWELL_MS,
  WATCH_HOME_MAX_DWELL_MS,
  activeSlide,
  createInitialPagerState,
  pagerReducer,
  shouldReissueSwap,
  showsPagerChrome,
  timersRunning,
  type PagerEvent,
  type PagerState,
} from "../watchHome/pagerReducer"

// ── Fixtures ────────────────────────────────────────────────────────────────

function videoSlide(
  id: string,
  overrides: Partial<WatchHomeVideoSlide> = {},
): WatchHomeVideoSlide {
  return {
    kind: "video",
    id,
    title: id,
    description: null,
    label: "Feature film",
    slug: `${id}-slug`,
    parentSlug: null,
    posterUrl: `https://img.example/${id}.jpg`,
    thumbnailUrl: `https://img.example/${id}-thumb.jpg`,
    imageAlt: id,
    playbackId: null,
    durationSeconds: 60,
    ...overrides,
  }
}

const insertFixture = {
  id: "welcome-start",
  enabled: true,
  playbackIds: ["pb-a"],
  durationSeconds: 9,
  label: "Faith & Scripture",
  title: "Today's Video Picks",
  collectionTitle: "Daily Inspirations",
  description: null,
  action: null,
  logo: true,
  posterOverride: null,
  trigger: { type: "sequence-start" },
} satisfies WatchHomeMuxInsertConfig

function muxSlide(id: string): WatchHomeMuxSlide {
  return {
    kind: "mux",
    id: `mux-${id}`,
    insert: { ...insertFixture, id },
    title: insertFixture.title,
    description: insertFixture.description,
    label: insertFixture.label,
    collectionTitle: insertFixture.collectionTitle,
    action: insertFixture.action,
    posterUrl: "https://image.mux.com/pb-a/thumbnail.jpg",
    thumbnailUrl: "https://image.mux.com/pb-a/thumbnail.jpg",
    imageAlt: insertFixture.title,
    src: "https://stream.mux.com/pb-a.m3u8",
    playbackId: "pb-a",
    durationSeconds: 9,
    logo: true,
    playbackIndex: 0,
    prefixTitleWithDate: false,
  }
}

const twoVideos = [videoSlide("v1"), videoSlide("v2")]
const mixedQueue = [videoSlide("v1"), muxSlide("welcome"), videoSlide("v2")]

function run(state: PagerState, ...events: PagerEvent[]): PagerState {
  return events.reduce(pagerReducer, state)
}

// ── Timing constants ────────────────────────────────────────────────────────

describe("pager timing constants", () => {
  it("uses the plan's 7s image dwell and ~20s max dwell", () => {
    expect(WATCH_HOME_IMAGE_SLIDE_DWELL_MS).toBe(7000)
    expect(WATCH_HOME_MAX_DWELL_MS).toBe(20000)
  })
})

// ── AE2: single-slide queue ─────────────────────────────────────────────────

describe("single-slide queue (AE2)", () => {
  const single = createInitialPagerState([videoSlide("only")])

  it("hides chips and dots", () => {
    expect(showsPagerChrome(single)).toBe(false)
    expect(showsPagerChrome(createInitialPagerState(twoVideos))).toBe(true)
  })

  it("stops auto-advance timers", () => {
    expect(timersRunning(single)).toBe(false)
    expect(timersRunning(createInitialPagerState(twoVideos))).toBe(true)
  })

  it("does not advance on play-to-end, timer, or max dwell", () => {
    expect(pagerReducer(single, { type: "PLAY_TO_END" })).toBe(single)
    expect(pagerReducer(single, { type: "MAX_DWELL_ELAPSED" })).toBe(single)

    const singleMux = createInitialPagerState([muxSlide("welcome")])
    expect(pagerReducer(singleMux, { type: "IMAGE_TIMER_ELAPSED" })).toBe(
      singleMux,
    )
  })
})

// ── AE3: chip taps ──────────────────────────────────────────────────────────

describe("chip taps (AE3)", () => {
  it("swaps the hero in place without navigating", () => {
    const initial = createInitialPagerState(mixedQueue)
    const next = pagerReducer(initial, { type: "CHIP_TAPPED", index: 2 })

    expect(next.currentIndex).toBe(2)
    expect(next.phase).toBe("poster")
    expect(activeSlide(next)?.id).toBe("v2")
    // The reducer's surface is state-only: same queue, same shape, no
    // navigation side channel for the component to act on.
    expect(next.slides).toBe(initial.slides)
    expect(Object.keys(next).sort()).toEqual(Object.keys(initial).sort())
  })

  it("is a no-op on the current index", () => {
    const initial = createInitialPagerState(mixedQueue)
    expect(pagerReducer(initial, { type: "CHIP_TAPPED", index: 0 })).toBe(
      initial,
    )
  })

  it("is ignored while a swap is in flight (serialized swaps)", () => {
    const swapping = run(createInitialPagerState(mixedQueue), {
      type: "SWAP_STARTED",
    })
    expect(pagerReducer(swapping, { type: "CHIP_TAPPED", index: 2 })).toBe(
      swapping,
    )
  })
})

// ── Swipe (SLIDE_SHOWN) ─────────────────────────────────────────────────────

describe("swipe settling (SLIDE_SHOWN)", () => {
  it("moves to the settled index and resets to poster", () => {
    const playing = run(
      createInitialPagerState(twoVideos),
      { type: "PLAY_STARTED" },
      { type: "SLIDE_SHOWN", index: 1 },
    )
    expect(playing.currentIndex).toBe(1)
    expect(playing.phase).toBe("poster")
  })

  it("clamps out-of-range momentum indexes", () => {
    const next = pagerReducer(createInitialPagerState(twoVideos), {
      type: "SLIDE_SHOWN",
      index: 9,
    })
    expect(next.currentIndex).toBe(1)
  })

  it("records a pending swap when the move interrupts an in-flight swap", () => {
    const next = run(
      createInitialPagerState(twoVideos),
      { type: "SWAP_STARTED" },
      { type: "SLIDE_SHOWN", index: 1 },
    )
    expect(next.pendingSwap).toBe(true)
    // Still in flight: the re-issue waits for SWAP_FINISHED.
    expect(shouldReissueSwap(next)).toBe(false)
    expect(
      shouldReissueSwap(pagerReducer(next, { type: "SWAP_FINISHED" })),
    ).toBe(true)
  })
})

// ── Swipe gesture (SWIPED) ──────────────────────────────────────────────────

describe("swipe gesture (SWIPED)", () => {
  it("commits the move during an in-flight swap and records pendingSwap", () => {
    const next = run(
      createInitialPagerState(twoVideos),
      { type: "SWAP_STARTED" },
      { type: "SWIPED", index: 1 },
    )
    // Unlike CHIP_TAPPED, the swipe is never dropped: the user physically
    // moved the pager, so the reducer must follow.
    expect(next.currentIndex).toBe(1)
    expect(next.pendingSwap).toBe(true)
  })

  it("is an identity no-op on the current index", () => {
    const initial = createInitialPagerState(twoVideos)
    expect(pagerReducer(initial, { type: "SWIPED", index: 0 })).toBe(initial)
  })
})

// ── Auto-advance ────────────────────────────────────────────────────────────

describe("auto-advance", () => {
  it("advances a video slide on play-to-end", () => {
    const next = pagerReducer(createInitialPagerState(twoVideos), {
      type: "PLAY_TO_END",
    })
    expect(next.currentIndex).toBe(1)
    expect(next.phase).toBe("poster")
  })

  it("ignores play-to-end on a mux slide", () => {
    const onMux = run(createInitialPagerState(mixedQueue), {
      type: "SLIDE_SHOWN",
      index: 1,
    })
    expect(pagerReducer(onMux, { type: "PLAY_TO_END" })).toBe(onMux)
  })

  it("advances a mux slide on the image timer", () => {
    const onMux = run(createInitialPagerState(mixedQueue), {
      type: "SLIDE_SHOWN",
      index: 1,
    })
    const next = pagerReducer(onMux, { type: "IMAGE_TIMER_ELAPSED" })
    expect(next.currentIndex).toBe(2)
  })

  it("ignores the image timer on a video slide", () => {
    const initial = createInitialPagerState(mixedQueue)
    expect(pagerReducer(initial, { type: "IMAGE_TIMER_ELAPSED" })).toBe(initial)
  })

  it("wraps to the start at the end of the queue", () => {
    const atEnd = run(createInitialPagerState(twoVideos), {
      type: "SLIDE_SHOWN",
      index: 1,
    })
    const next = pagerReducer(atEnd, { type: "PLAY_TO_END" })
    expect(next.currentIndex).toBe(0)
  })
})

// ── AE5: skip rules ─────────────────────────────────────────────────────────

describe("skip rules (AE5)", () => {
  it("skips to the next slide on stream error and clears the in-flight swap", () => {
    const next = run(
      createInitialPagerState(twoVideos),
      { type: "SWAP_STARTED" },
      { type: "STREAM_ERROR" },
    )
    expect(next.currentIndex).toBe(1)
    expect(next.swapInFlight).toBe(false)
    // The interrupted swap died with its slide — no stale re-issue.
    expect(next.pendingSwap).toBe(false)
  })

  it("falls back to the poster on stream error with a single slide", () => {
    const single = run(createInitialPagerState([videoSlide("only")]), {
      type: "STREAM_RESOLVING",
    })
    const next = pagerReducer(single, { type: "STREAM_ERROR" })
    expect(next.currentIndex).toBe(0)
    expect(next.phase).toBe("poster")
  })

  it("skips a stuck slide on max dwell", () => {
    const resolving = run(createInitialPagerState(twoVideos), {
      type: "STREAM_RESOLVING",
    })
    const next = pagerReducer(resolving, { type: "MAX_DWELL_ELAPSED" })
    expect(next.currentIndex).toBe(1)
  })

  it("never cuts off a playing slide on max dwell", () => {
    const playing = run(createInitialPagerState(twoVideos), {
      type: "PLAY_STARTED",
    })
    expect(pagerReducer(playing, { type: "MAX_DWELL_ELAPSED" })).toBe(playing)
  })
})

// ── AE6: suspension ─────────────────────────────────────────────────────────

describe("suspension (AE6)", () => {
  it("stops timers while suspended", () => {
    const suspended = pagerReducer(createInitialPagerState(twoVideos), {
      type: "SUSPEND",
      reason: "scroll",
    })
    expect(timersRunning(suspended)).toBe(false)
  })

  it("ignores PLAY_TO_END and IMAGE_TIMER_ELAPSED while suspended", () => {
    const suspended = pagerReducer(createInitialPagerState(twoVideos), {
      type: "SUSPEND",
      reason: "blur",
    })
    expect(pagerReducer(suspended, { type: "PLAY_TO_END" })).toBe(suspended)

    const suspendedMux = run(
      createInitialPagerState(mixedQueue),
      { type: "SLIDE_SHOWN", index: 1 },
      { type: "SUSPEND", reason: "scroll" },
    )
    expect(pagerReducer(suspendedMux, { type: "IMAGE_TIMER_ELAPSED" })).toBe(
      suspendedMux,
    )
  })

  it("defers MAX_DWELL_ELAPSED advance while suspended (sets pendingSkip)", () => {
    const suspended = pagerReducer(createInitialPagerState(twoVideos), {
      type: "SUSPEND",
      reason: "blur",
    })
    // MAX_DWELL_ELAPSED while suspended records a deferred skip instead of
    // dropping the event — so RESUME can advance promptly (AE5).
    const afterDwell = pagerReducer(suspended, { type: "MAX_DWELL_ELAPSED" })
    expect(afterDwell.currentIndex).toBe(0) // not advanced yet
    expect(afterDwell.pendingSkip).toBe(true)
    // Idempotent: second fire does not toggle or clear the flag.
    expect(pagerReducer(afterDwell, { type: "MAX_DWELL_ELAPSED" })).toBe(
      afterDwell,
    )
  })

  it("records an in-flight swap on suspend and re-issues it after resume", () => {
    const suspendedMidSwap = run(
      createInitialPagerState(twoVideos),
      { type: "SWAP_STARTED" },
      { type: "SUSPEND", reason: "scroll" },
    )
    expect(suspendedMidSwap.pendingSwap).toBe(true)

    // The native replaceAsync completes while suspended.
    const settled = pagerReducer(suspendedMidSwap, { type: "SWAP_FINISHED" })
    expect(shouldReissueSwap(settled)).toBe(false) // still suspended

    const resumed = pagerReducer(settled, { type: "RESUME" })
    expect(resumed.suspended).toBeNull()
    expect(resumed.currentIndex).toBe(0) // same slide restored
    expect(shouldReissueSwap(resumed)).toBe(true)
  })

  it("records a stream that resolved while suspended for the resume swap", () => {
    const suspended = pagerReducer(createInitialPagerState(twoVideos), {
      type: "SUSPEND",
      reason: "blur",
    })
    const ready = pagerReducer(suspended, { type: "STREAM_READY" })
    expect(ready.pendingSwap).toBe(true)
    expect(shouldReissueSwap(pagerReducer(ready, { type: "RESUME" }))).toBe(
      true,
    )
  })

  it("resumes on the current slide", () => {
    const next = run(
      createInitialPagerState(mixedQueue),
      { type: "SLIDE_SHOWN", index: 2 },
      { type: "SUSPEND", reason: "scroll" },
      { type: "RESUME" },
    )
    expect(next.currentIndex).toBe(2)
    expect(next.suspended).toBeNull()
    expect(timersRunning(next)).toBe(true)
  })
})

// ── videoReady latch ────────────────────────────────────────────────────────

describe("videoReady latch", () => {
  it("latches on play start and stays latched across advances and errors", () => {
    const playing = pagerReducer(createInitialPagerState(twoVideos), {
      type: "PLAY_STARTED",
    })
    expect(playing.videoReady).toBe(true)

    const advanced = pagerReducer(playing, { type: "PLAY_TO_END" })
    expect(advanced.videoReady).toBe(true)

    const errored = pagerReducer(advanced, { type: "STREAM_ERROR" })
    expect(errored.videoReady).toBe(true)
  })
})

// ── Queue replacement ───────────────────────────────────────────────────────

describe("slides set", () => {
  it("replaces the queue and resets to the first slide", () => {
    const session = run(
      createInitialPagerState(twoVideos),
      { type: "PLAY_TO_END" }, // advances past v1, now on v2
    )
    const fresh = [videoSlide("v3"), videoSlide("v4")]
    const next = pagerReducer(session, { type: "SLIDES_SET", slides: fresh })

    expect(next.slides).toBe(fresh)
    expect(next.currentIndex).toBe(0)
    expect(next.phase).toBe("poster")
  })

  it("yields no active slide for an empty queue", () => {
    const empty = pagerReducer(createInitialPagerState(twoVideos), {
      type: "SLIDES_SET",
      slides: [],
    })
    expect(activeSlide(empty)).toBeNull()
    expect(showsPagerChrome(empty)).toBe(false)
    expect(timersRunning(empty)).toBe(false)
  })
})

// ── Swap serialization mechanics ────────────────────────────────────────────

describe("swap serialization", () => {
  it("clears the pending swap when a new swap starts", () => {
    const next = run(
      createInitialPagerState(twoVideos),
      { type: "SWAP_STARTED" },
      { type: "SLIDE_SHOWN", index: 1 }, // pendingSwap = true
      { type: "SWAP_FINISHED" },
      { type: "SWAP_STARTED" }, // the re-issued swap
    )
    expect(next.swapInFlight).toBe(true)
    expect(next.pendingSwap).toBe(false)
  })

  it("treats repeated resolving/ready signals as no-ops", () => {
    const resolving = pagerReducer(createInitialPagerState(twoVideos), {
      type: "STREAM_RESOLVING",
    })
    expect(pagerReducer(resolving, { type: "STREAM_RESOLVING" })).toBe(
      resolving,
    )
    expect(pagerReducer(resolving, { type: "STREAM_READY" })).toBe(resolving)
  })

  it("SLIDES_SET while swapInFlight preserves pendingSwap = true", () => {
    // Start from a real in-flight swap, then replace the queue.
    const inFlight = run(createInitialPagerState(twoVideos), {
      type: "SWAP_STARTED",
    })
    expect(inFlight.swapInFlight).toBe(true)

    const fresh = [videoSlide("v3"), videoSlide("v4")]
    const next = pagerReducer(inFlight, { type: "SLIDES_SET", slides: fresh })

    // The interrupted swap must be remembered so the component re-issues it
    // for the new slide (preservation branch: `|| state.swapInFlight`).
    expect(next.pendingSwap).toBe(true)
    expect(next.slides).toBe(fresh)
    expect(next.currentIndex).toBe(0)
  })
})

// ── AE5: pendingSkip (deferred skip on stream error while suspended) ─────────

describe("pendingSkip (AE5 deferred skip)", () => {
  it("records pendingSkip on STREAM_ERROR while suspended, then advances on RESUME", () => {
    // Scenario: SWAP_STARTED → STREAM_RESOLVING → SUSPEND → STREAM_ERROR
    const afterError = run(
      createInitialPagerState(twoVideos),
      { type: "SWAP_STARTED" },
      { type: "STREAM_RESOLVING" },
      { type: "SUSPEND", reason: "scroll" },
      { type: "STREAM_ERROR" },
    )

    expect(afterError.phase).toBe("poster")
    expect(afterError.currentIndex).toBe(0) // not advanced yet
    expect(afterError.swapInFlight).toBe(false) // swap cleared
    expect(afterError.pendingSkip).toBe(true)

    const resumed = pagerReducer(afterError, { type: "RESUME" })
    expect(resumed.suspended).toBeNull()
    expect(resumed.currentIndex).toBe(1) // deferred skip executed
    expect(resumed.pendingSkip).toBe(false)
  })

  it("records pendingSkip on MAX_DWELL_ELAPSED while suspended, then advances on RESUME", () => {
    const afterDwell = run(
      createInitialPagerState(twoVideos),
      { type: "STREAM_RESOLVING" },
      { type: "SUSPEND", reason: "blur" },
      { type: "MAX_DWELL_ELAPSED" },
    )

    expect(afterDwell.currentIndex).toBe(0) // not advanced yet
    expect(afterDwell.pendingSkip).toBe(true)

    const resumed = pagerReducer(afterDwell, { type: "RESUME" })
    expect(resumed.currentIndex).toBe(1)
    expect(resumed.pendingSkip).toBe(false)
  })

  it("chip tap while pendingSkip is set clears it without double-advancing", () => {
    const afterError = run(
      createInitialPagerState(twoVideos),
      { type: "SUSPEND", reason: "scroll" },
      { type: "STREAM_ERROR" },
    )
    expect(afterError.pendingSkip).toBe(true)

    // User explicitly taps chip index 1 while still suspended.
    const tapped = pagerReducer(afterError, { type: "CHIP_TAPPED", index: 1 })
    expect(tapped.currentIndex).toBe(1)
    expect(tapped.pendingSkip).toBe(false)

    // RESUME after an explicit move must NOT advance a second time.
    const resumed = pagerReducer(
      { ...tapped, suspended: null },
      { type: "RESUME" },
    )
    expect(resumed.currentIndex).toBe(1)
    expect(resumed.pendingSkip).toBe(false)
  })

  it("SLIDE_SHOWN to a different index clears pendingSkip; RESUME does not advance again", () => {
    const afterError = run(
      createInitialPagerState(mixedQueue),
      { type: "SUSPEND", reason: "scroll" },
      { type: "STREAM_ERROR" },
    )
    expect(afterError.pendingSkip).toBe(true)

    const shown = pagerReducer(afterError, { type: "SLIDE_SHOWN", index: 1 })
    expect(shown.currentIndex).toBe(1)
    expect(shown.pendingSkip).toBe(false)

    const resumed = pagerReducer(shown, { type: "RESUME" })
    expect(resumed.currentIndex).toBe(1) // no double-advance
    expect(resumed.pendingSkip).toBe(false)
  })

  it("SLIDES_SET with a new queue clears pendingSkip", () => {
    const afterError = run(
      createInitialPagerState(twoVideos),
      { type: "SUSPEND", reason: "scroll" },
      { type: "STREAM_ERROR" },
    )
    expect(afterError.pendingSkip).toBe(true)

    const fresh = [videoSlide("v3"), videoSlide("v4")]
    const next = pagerReducer(afterError, { type: "SLIDES_SET", slides: fresh })
    expect(next.pendingSkip).toBe(false)
  })
})
