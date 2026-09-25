/**
 * Behavioural coverage for Explore's per-clip autostart gate (U16, KTD14,
 * KTD21).
 *
 * The harness holds the REAL feed reducer, so every veil state here comes from
 * the events the players and the pager send, not from a hand-built phase. The
 * hook owns only the timer; the reducer owns the phases. The cases that matter
 * most are the divergence paths: an error and a timeout must clear the poster
 * and the still on the same predicate as the veil
 * (docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md).
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

import { StrictMode, act, useCallback, useReducer } from "react"
import type React from "react"

import { AUTOSTART_VEIL_TIMEOUT_MS } from "../useAutostartPlayback"
import {
  clipPosterUri,
  useClipAutostart,
  type ClipAutostart,
} from "../useClipAutostart"
import {
  INITIAL_FEED_STATE,
  activeSlot,
  feedReducer,
  toFeedClip,
  type FeedEvent,
  type FeedState,
} from "../../lib/explore/feedState"
import type { PlayerMode } from "../../lib/explore/playerMode"
import { clipYieldsToRoot } from "../../lib/explore/takeover"
import type { ReadyClip } from "../../lib/explore/types"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

// ── Fixtures ────────────────────────────────────────────────────────

function clip(
  n: number,
  imageUrl: string | null = `https://images.example/${n}.jpg`,
): ReadyClip {
  return {
    videoId: `video-${n}`,
    coreId: `core-${n}`,
    slug: `slug-${n}`,
    label: "shortFilm",
    availability: "AUDIO",
    durationSeconds: 600,
    // Alphanumeric, as a real Mux id is, so the poster derivative can build.
    muxPlaybackId: `mux${n}`,
    watchLanguageSlug: "swahili",
    title: `Title ${n}`,
    description: `Description ${n}`,
    imageUrl,
    feedLanguageSlug: "swahili",
    streamUrl: `https://stream.mux.com/mux${n}.m3u8`,
    audioLanguageSlug: "swahili",
    subtitleLanguageSlug: "swahili",
    subtitleVttSrc: `https://subtitles.example/${n}.vtt`,
    subtitleOnly: false,
    window: { startSeconds: 100 + n, endSeconds: 130 + n },
    cut: "sentence",
  }
}

/**
 * Admin's pre-generated `WATCH_HERO_POSTER_RECIPE` derivative, pinned byte for
 * byte (apps/admin/src/services/mux-image-derivative.service.ts).
 */
function derivative(n: number): string {
  return `https://image.mux.com/mux${n}/thumbnail.webp?width=1280&time=2`
}

function stillOf(n: number): string {
  return `https://stills.example/${n}.webp`
}

/** The first clip, veiled, as the first focus and the queue leave it. */
function veiled(playerMode: PlayerMode, first: ReadyClip = clip(1)): FeedState {
  const events: FeedEvent[] = [
    { type: "focus", playerMode },
    { type: "clipQueued", clip: first },
  ]
  return events.reduce(feedReducer, INITIAL_FEED_STATE)
}

// ── Harness ─────────────────────────────────────────────────────────

type GateProps = {
  yieldsToRoot: boolean
  stillUri: string | null
  stillLoaded: boolean
  /** A new dispatch function on every render, as an inline wrapper makes. */
  unstableDispatch: boolean
}

const DEFAULT_PROPS: GateProps = {
  yieldsToRoot: false,
  stillUri: null,
  stillLoaded: false,
  unstableDispatch: false,
}

function renderGate(
  initial: FeedState,
  props: Partial<GateProps> = {},
  options: { strict?: boolean } = {},
) {
  /** Only what the HOOK dispatched; the test's own events go around it. */
  const sent: FeedEvent[] = []
  const seen: ClipAutostart[] = []
  let feedState = initial
  let feedDispatch: (event: FeedEvent) => void = () => undefined

  function Harness(p: GateProps) {
    const [state, dispatch] = useReducer(feedReducer, initial)
    const stable = useCallback((event: FeedEvent) => {
      sent.push(event)
      dispatch(event)
    }, [])
    const unstable = (event: FeedEvent) => {
      sent.push(event)
      dispatch(event)
    }
    feedState = state
    feedDispatch = dispatch
    seen.push(
      useClipAutostart({
        state,
        dispatch: p.unstableDispatch ? unstable : stable,
        yieldsToRoot: p.yieldsToRoot,
        stillUri: p.stillUri,
        stillLoaded: p.stillLoaded,
      }),
    )
    return null
  }

  let current: GateProps = { ...DEFAULT_PROPS, ...props }
  const element = (p: GateProps) => {
    const harness = <Harness {...p} />
    const tree = options.strict ? <StrictMode>{harness}</StrictMode> : harness
    return tree as unknown as React.ReactElement
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(element(current))
  })

  const token = () => {
    const slot = activeSlot(feedState)
    if (slot == null) throw new Error("no active slot")
    return slot.token
  }
  return {
    latest: () => seen[seen.length - 1],
    state: () => feedState,
    token,
    /** Sends each event in its own act, so a token read sees the last one. */
    send: (...events: Array<FeedEvent | (() => FeedEvent)>) => {
      for (const event of events) {
        act(() => {
          feedDispatch(typeof event === "function" ? event() : event)
        })
      }
    },
    rerender: (next: Partial<GateProps>) => {
      current = { ...current, ...next }
      act(() => {
        renderer.update(element(current))
      })
    },
    advance: (ms: number) => {
      act(() => {
        jest.advanceTimersByTime(ms)
      })
    },
    timeouts: () => sent.filter((event) => event.type === "timeout"),
    unmount: () => {
      act(() => {
        renderer.unmount()
      })
    },
  }
}

type Gate = ReturnType<typeof renderGate>

/** Plays the active player's role: the source loads, then motion starts. */
function start(gate: Gate) {
  gate.send(
    () => ({ type: "loaded", token: gate.token() }),
    () => ({ type: "playing", token: gate.token() }),
  )
}

/** The queue supplies clip `n`, the viewer swipes up, and the pager rests. */
function swipeTo(gate: Gate, next: ReadyClip) {
  gate.send(
    { type: "clipQueued", clip: next },
    { type: "swipeNext" },
    { type: "rest" },
  )
}

const HOLD = { rootPlaying: true, rootHasRequest: true, pipHold: true }
const HOLD_PAUSED = { rootPlaying: false, rootHasRequest: true, pipHold: true }

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

// ── The poster rule ─────────────────────────────────────────────────

describe("clipPosterUri", () => {
  it("prefers the authored image", () => {
    expect(clipPosterUri(toFeedClip(clip(1)))).toBe(
      "https://images.example/1.jpg",
    )
  })

  it("falls to the poster derivative for a null, blank, or bad image", () => {
    for (const imageUrl of [null, "", "   ", "not a url"]) {
      expect(clipPosterUri(toFeedClip(clip(2, imageUrl)))).toBe(derivative(2))
    }
  })

  it("gives null when there is no image and no usable playback id", () => {
    const bare = { ...toFeedClip(clip(3, null)), muxPlaybackId: "mux3 " }
    expect(clipPosterUri(bare)).toBeNull()
  })
})

// ── The gate ────────────────────────────────────────────────────────

describe("useClipAutostart", () => {
  it("veils the first clip over its authored poster, with the spinner", () => {
    const gate = renderGate(veiled("two"))
    expect(gate.latest()).toEqual({
      veilVisible: true,
      spinnerVisible: true,
      image: { kind: "poster", uri: "https://images.example/1.jpg" },
      failed: false,
      stillWanted: false,
    })
  })

  it("lifts the veil and the poster together when playback starts", () => {
    const gate = renderGate(veiled("two"))
    start(gate)
    expect(gate.state().phase).toBe("playing")
    expect(gate.latest()).toEqual({
      veilVisible: false,
      spinnerVisible: false,
      image: null,
      failed: false,
      stillWanted: false,
    })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS * 2)
    expect(gate.timeouts()).toEqual([])
  })

  it("re-arms for a new clip that has not loaded", () => {
    const gate = renderGate(veiled("two"))
    start(gate)
    // The standby holds clip 2 but has not loaded it, so the swipe veils.
    swipeTo(gate, clip(2))
    const second = gate.token()
    expect(gate.state().phase).toBe("veiled")
    expect(gate.latest().veilVisible).toBe(true)
    expect(gate.latest().image).toEqual({
      kind: "poster",
      uri: "https://images.example/2.jpg",
    })

    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: second }])
    expect(gate.latest().failed).toBe(true)
  })

  it("clears the veil, the spinner, and the still into the failed state on a source error", () => {
    const gate = renderGate(veiled("one"), {
      stillUri: stillOf(1),
      stillLoaded: true,
    })
    expect(gate.latest().image).toEqual({ kind: "still", uri: stillOf(1) })

    gate.send(() => ({
      type: "error",
      token: gate.token(),
      msSinceSourceSet: 500,
    }))
    expect(gate.state().phase).toBe("clipFailed")
    expect(gate.latest()).toEqual({
      veilVisible: false,
      spinnerVisible: false,
      image: null,
      failed: true,
      stillWanted: true,
    })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS * 2)
    expect(gate.timeouts()).toEqual([])
  })

  // The anti-strand case: a load that neither starts nor errors must still
  // release, and the poster must clear with the veil.
  it("clears the veil and the poster into the failed state at the 12 s timeout", () => {
    const gate = renderGate(veiled("two"))
    const first = gate.token()

    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS - 1)
    expect(gate.timeouts()).toEqual([])
    expect(gate.latest().veilVisible).toBe(true)

    gate.advance(1)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: first }])
    expect(gate.state().phase).toBe("clipFailed")
    expect(gate.latest()).toEqual({
      veilVisible: false,
      spinnerVisible: false,
      image: null,
      failed: true,
      stillWanted: false,
    })
  })

  it("lifts the veil with no play on a return to a clip the viewer paused (R45)", () => {
    const gate = renderGate(veiled("two"))
    start(gate)
    gate.send(
      { type: "tap" },
      { type: "blur", positionSeconds: 110 },
      { type: "graceExpired" },
    )
    expect(gate.latest().veilVisible).toBe(false)

    // The source was released, so the return reloads behind the veil.
    gate.send({ type: "focus", playerMode: "two" })
    expect(gate.state().phase).toBe("veiled")
    expect(gate.latest().veilVisible).toBe(true)

    gate.send(() => ({ type: "loaded", token: gate.token() }))
    expect(gate.state().phase).toBe("paused")
    expect(gate.latest()).toEqual({
      veilVisible: false,
      spinnerVisible: false,
      image: null,
      failed: false,
      stillWanted: false,
    })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS * 2)
    expect(gate.timeouts()).toEqual([])
  })

  it("shows the still under the veil in one-player mode once it has loaded", () => {
    const gate = renderGate(veiled("one"), { stillUri: stillOf(1) })
    expect(gate.latest().stillWanted).toBe(true)
    // The still is a cold Mux render, so the poster covers until it loads.
    expect(gate.latest().image).toEqual({
      kind: "poster",
      uri: "https://images.example/1.jpg",
    })

    gate.rerender({ stillLoaded: true })
    expect(gate.latest().image).toEqual({ kind: "still", uri: stillOf(1) })
    expect(gate.latest().veilVisible).toBe(true)

    start(gate)
    expect(gate.latest().image).toBeNull()
  })

  it("wants no still in two-player mode, and never shows one", () => {
    const gate = renderGate(veiled("two"), {
      stillUri: stillOf(1),
      stillLoaded: true,
    })
    expect(gate.latest().stillWanted).toBe(false)
    expect(gate.latest().image).toEqual({
      kind: "poster",
      uri: "https://images.example/1.jpg",
    })
  })

  it("veils a clip replayed from history over its poster derivative", () => {
    // Clip 1 carries a blank authored image, a real production shape.
    const gate = renderGate(veiled("two", clip(1, "")))
    start(gate)
    swipeTo(gate, clip(2))
    start(gate)
    expect(gate.state().phase).toBe("playing")

    gate.send({ type: "swipePrevious" }, { type: "rest" })
    expect(gate.state().phase).toBe("veiled")
    expect(gate.latest().veilVisible).toBe(true)
    expect(gate.latest().image).toEqual({ kind: "poster", uri: derivative(1) })
  })

  it("keeps the veil and the spinner for a clip with no image at all", () => {
    const bare = { ...clip(1, null), muxPlaybackId: null }
    const gate = renderGate(veiled("two", bare))
    expect(gate.latest().veilVisible).toBe(true)
    expect(gate.latest().spinnerVisible).toBe(true)
    expect(gate.latest().image).toBeNull()

    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS)
    expect(gate.latest().failed).toBe(true)
  })

  it("holds the timer while the clip yields to the root player, and arms it on release under a picture-in-picture hold", () => {
    const gate = renderGate(veiled("two"), {
      yieldsToRoot: clipYieldsToRoot(HOLD),
    })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS * 3)
    expect(gate.timeouts()).toEqual([])
    expect(gate.latest().veilVisible).toBe(true)
    expect(gate.latest().failed).toBe(false)

    // The transport pause lands; the watch page's request stays in the store.
    gate.rerender({ yieldsToRoot: clipYieldsToRoot(HOLD_PAUSED) })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS - 1)
    expect(gate.timeouts()).toEqual([])
    gate.advance(1)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: gate.token() }])
  })

  it("holds the timer between a swipe and the pager's rest, because no load starts before it", () => {
    const gate = renderGate(veiled("two"))
    start(gate)
    gate.send({ type: "clipQueued", clip: clip(2) }, { type: "swipeNext" })
    expect(gate.state().pagerAtRest).toBe(false)
    expect(gate.latest().veilVisible).toBe(true)

    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS * 2)
    expect(gate.timeouts()).toEqual([])

    gate.send({ type: "rest" })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: gate.token() }])
  })

  it("clears the old clip's timer on a new clip, so a stale token is never dispatched", () => {
    const gate = renderGate(veiled("one"))
    const first = gate.token()
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS / 2)

    swipeTo(gate, clip(2))
    const second = gate.token()
    expect(second).not.toBe(first)
    expect(jest.getTimerCount()).toBe(1)

    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS / 2)
    expect(gate.timeouts()).toEqual([])
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS / 2)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: second }])
  })

  it("clears the timer on unmount", () => {
    const gate = renderGate(veiled("two"))
    expect(jest.getTimerCount()).toBe(1)
    gate.unmount()
    expect(jest.getTimerCount()).toBe(0)
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS * 2)
    expect(gate.timeouts()).toEqual([])
  })

  // A caller that wraps dispatch inline hands a new function every render. If
  // that restarted the timer, any re-render inside 12 s would strand the veil.
  it("keeps one timer across re-renders with a new dispatch function", () => {
    const gate = renderGate(veiled("two"), { unstableDispatch: true })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS / 2)
    gate.rerender({ stillUri: stillOf(1) })
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS / 2)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: gate.token() }])
  })
})

// StrictMode runs setup, cleanup, setup on mount. A cleanup that did not clear
// its timer would leave two live timers and dispatch the timeout twice.
describe("useClipAutostart under StrictMode", () => {
  it("dispatches the timeout once for the first clip", () => {
    const gate = renderGate(veiled("two"), {}, { strict: true })
    expect(jest.getTimerCount()).toBe(1)
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: gate.token() }])
    expect(gate.latest().failed).toBe(true)
  })

  it("re-arms once for a new clip", () => {
    const gate = renderGate(veiled("one"), {}, { strict: true })
    start(gate)
    expect(gate.latest().veilVisible).toBe(false)

    swipeTo(gate, clip(2))
    expect(gate.latest().veilVisible).toBe(true)
    expect(jest.getTimerCount()).toBe(1)
    gate.advance(AUTOSTART_VEIL_TIMEOUT_MS)
    expect(gate.timeouts()).toEqual([{ type: "timeout", token: gate.token() }])
  })
})
