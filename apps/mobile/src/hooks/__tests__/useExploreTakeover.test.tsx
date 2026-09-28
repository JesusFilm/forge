/**
 * U10's session takeover against the REAL mini-player and request stores. A
 * floating session comes from a watch page's slot detaching, as on device, so
 * the session, the retained request, and the hold are the stores' own states.
 * Only the host is modelled: its transport, and the `playing` flag it
 * publishes from the player's own events.
 */

import { StrictMode, act, type ReactElement } from "react"

import {
  getPlaybackRequestStore,
  type PlaybackRequest,
  type PlaybackSessionDescriptor,
} from "../../lib/miniPlayer/playbackRequest"
import {
  getMiniPlayerStore,
  type MiniPlayerEndEvent,
} from "../../lib/miniPlayer/store"
import {
  resetPlaybackTransportForTests,
  setPlaybackTransport,
} from "../../lib/playbackInterruption"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  useExploreTakeover,
  type ExploreTakeover,
  type ExploreTakeoverInput,
} from "../useExploreTakeover"

const sessionStore = getMiniPlayerStore()
const requestStore = getPlaybackRequestStore()

const TWENTY_MINUTES = 1_200

const MAGDALENA: PlaybackSessionDescriptor = {
  videoId: "video-magdalena",
  videoSlug: "magdalena",
  title: "Magdalena",
  titleFromRecord: true,
  posterUrl: null,
  languageSlug: "english",
  originPattern: "watch/[slug]",
}

const JESUS: PlaybackSessionDescriptor = {
  ...MAGDALENA,
  videoId: "video-jesus",
  videoSlug: "jesus",
  title: "JESUS",
}

function watchRequest(session: PlaybackSessionDescriptor): PlaybackRequest {
  return {
    streamingUrl: `https://stream.mux.com/${session.videoSlug}.m3u8`,
    posterUrl: null,
    subtitleVttSrc: null,
    fullscreen: false,
    autostart: true,
    resumeAtSeconds: null,
    progressVideoId: session.videoId,
    progressVideoSlug: session.videoSlug,
    progressLanguageSlug: session.languageSlug,
    onToggleFullscreen: null,
    castActive: false,
    cast: null,
    progressFeedRef: null,
    session,
  }
}

// ── The host, modelled ──────────────────────────────────────────────

let rootPlaying = false

/** PlaybackHost's transport. A pause lands in the store only via `rootPlays`. */
const transport = {
  isPlaying: jest.fn(() => rootPlaying),
  pause: jest.fn(() => {
    rootPlaying = false
  }),
  play: jest.fn(() => {
    rootPlaying = true
  }),
}

/** The host publishes the player's own playing state (PlaybackHost). */
function rootPlays(next: boolean) {
  rootPlaying = next
  act(() => {
    requestStore.setPlaying(next)
  })
}

/** A watch page has played `session` to `positionSeconds`. Returns its slot. */
function openWatchPage(
  session: PlaybackSessionDescriptor,
  positionSeconds = TWENTY_MINUTES,
): number {
  let slot!: number
  act(() => {
    requestStore.setPlaybackFactsSource({
      hasPlaybackStarted: () => true,
      hasReachedEnd: () => false,
      readPosition: () => positionSeconds,
      readDuration: () => 7_200,
    })
    slot = requestStore.attachSlot(watchRequest(session))
  })
  return slot
}

/** The committed back press: the slot detaches and the video floats (U6). */
function backOut(slot: number) {
  act(() => {
    requestStore.detachSlot(slot)
  })
}

function floating(session: PlaybackSessionDescriptor = MAGDALENA) {
  backOut(openWatchPage(session))
}

function setPipHold(held: boolean) {
  act(() => {
    sessionStore.setPipHold(held)
  })
}

/** The window's exit animation ends (PlaybackHost's exit effect). */
function exitCompletes() {
  act(() => {
    sessionStore.reportExitComplete()
  })
}

// ── Harness ─────────────────────────────────────────────────────────

let ends: MiniPlayerEndEvent[] = []
let stopEnds: (() => void) | null = null
let mounted: TestInstance | null = null

function endsSeen(): Array<[string, string, number]> {
  return ends.map((event) => [
    event.reason,
    event.session.videoSlug,
    event.session.positionSeconds,
  ])
}

function renderTakeover(
  initial: ExploreTakeoverInput,
  options: { strict?: boolean } = {},
) {
  const seen: ExploreTakeover[] = []

  function Harness(props: ExploreTakeoverInput) {
    seen.push(useExploreTakeover(props))
    return null
  }

  const element = (props: ExploreTakeoverInput) => {
    const harness = <Harness {...props} />
    const tree = options.strict ? <StrictMode>{harness}</StrictMode> : harness
    return tree as unknown as ReactElement
  }

  let current = initial
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(element(current))
  })
  mounted = renderer

  return {
    yieldsToRoot: () => seen[seen.length - 1].yieldsToRoot,
    rerender: (next: Partial<ExploreTakeoverInput>) => {
      current = { ...current, ...next }
      act(() => {
        renderer.update(element(current))
      })
    },
    unmount: () => {
      act(() => {
        renderer.unmount()
      })
      mounted = null
    },
  }
}

function resetStores() {
  requestStore.reset()
  sessionStore.setPipHold(false)
  sessionStore.end("abandoned")
}

beforeEach(() => {
  resetStores()
  resetPlaybackTransportForTests()
  setPlaybackTransport(transport)
  rootPlaying = false
  transport.isPlaying.mockClear()
  transport.pause.mockClear()
  transport.play.mockClear()
  ends = []
  stopEnds = sessionStore.onEnd((event) => ends.push(event))
})

afterEach(() => {
  if (mounted != null) {
    const renderer = mounted
    act(() => {
      renderer.unmount()
    })
    mounted = null
  }
  stopEnds?.()
  stopEnds = null
  resetStores()
  resetPlaybackTransportForTests()
})

// ── The continuous yield ────────────────────────────────────────────

describe("useExploreTakeover — the continuous yield (KTD10)", () => {
  it.each(["after", "before"] as const)(
    "AE7: dismisses Magdalena at 20:00 when the focus runs %s the watch page's slot detaches, and frees the clip once no request remains",
    (order) => {
      const onSystemPause = jest.fn()
      const slot = openWatchPage(MAGDALENA)
      rootPlays(true)

      let takeover: ReturnType<typeof renderTakeover>
      if (order === "after") {
        backOut(slot)
        takeover = renderTakeover({ focused: false, onSystemPause })
        expect(endsSeen()).toEqual([])
        takeover.rerender({ focused: true })
      } else {
        takeover = renderTakeover({ focused: true, onSystemPause })
        expect(endsSeen()).toEqual([])
        backOut(slot)
      }

      // A dismiss, never "replaced": the adapter maps "dismissed" to the
      // `dismiss` flush trigger (useManagedVideoPlayer.test.tsx pins that).
      expect(endsSeen()).toEqual([["dismissed", "magdalena", TWENTY_MINUTES]])
      expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
      // Without a hold the store's own dismiss stops the player (R6).
      expect(transport.pause).not.toHaveBeenCalled()
      expect(takeover.yieldsToRoot()).toBe(true)

      // The host's dismiss pause lands; the window's request stays while it
      // animates away, so the clip still waits.
      rootPlays(false)
      expect(requestStore.getSnapshot().request).not.toBeNull()
      expect(takeover.yieldsToRoot()).toBe(true)

      exitCompletes()
      expect(requestStore.getSnapshot().request).toBeNull()
      expect(takeover.yieldsToRoot()).toBe(false)
      expect(onSystemPause).not.toHaveBeenCalled()
    },
  )

  it("dismisses every floating session that appears while Explore stays focused", () => {
    const takeover = renderTakeover({ focused: true, onSystemPause: jest.fn() })
    expect(takeover.yieldsToRoot()).toBe(false)

    floating(MAGDALENA)
    exitCompletes()
    floating(JESUS)

    expect(endsSeen()).toEqual([
      ["dismissed", "magdalena", TWENTY_MINUTES],
      ["dismissed", "jesus", TWENTY_MINUTES],
    ])
    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
  })
})

// ── Picture-in-picture ──────────────────────────────────────────────

describe("useExploreTakeover — under a picture-in-picture hold (R42)", () => {
  function heldAndFocused() {
    floating(MAGDALENA)
    setPipHold(true)
    rootPlays(true)
    const onSystemPause = jest.fn()
    const takeover = renderTakeover({ focused: true, onSystemPause })
    return { takeover, onSystemPause }
  }

  it("pauses the root player through the transport, defers no dismiss, and frees the clip once the pause lands", () => {
    const { takeover } = heldAndFocused()

    expect(transport.pause).toHaveBeenCalledTimes(1)
    expect(sessionStore.getSnapshot().dismissal).toBe("none")
    expect(endsSeen()).toEqual([])
    expect(takeover.yieldsToRoot()).toBe(true)

    rootPlays(false)
    // The watch page's request stays in the store under the hold.
    expect(requestStore.getSnapshot().request).not.toBeNull()
    expect(takeover.yieldsToRoot()).toBe(false)

    // Later store notifications do not pause the root player again.
    act(() => {
      sessionStore.publishPosition({ positionSeconds: TWENTY_MINUTES + 1 })
    })
    expect(transport.pause).toHaveBeenCalledTimes(1)
    expect(sessionStore.getSnapshot().dismissal).toBe("none")
  })

  it("dismisses at the hold's end while Explore keeps focus and the session names the same video", () => {
    heldAndFocused()
    rootPlays(false)

    setPipHold(false)
    expect(endsSeen()).toEqual([["dismissed", "magdalena", TWENTY_MINUTES]])
    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
  })

  it("dismisses nothing at the hold's end after a blur, and a later focus dismisses", () => {
    const { takeover } = heldAndFocused()
    rootPlays(false)

    takeover.rerender({ focused: false })
    setPipHold(false)
    expect(endsSeen()).toEqual([])
    expect(sessionStore.getSnapshot().dismissal).toBe("none")
    expect(sessionStore.getSnapshot().session?.videoSlug).toBe("magdalena")

    takeover.rerender({ focused: true })
    expect(endsSeen()).toEqual([["dismissed", "magdalena", TWENTY_MINUTES]])
  })

  it("follows a video that replaces the session under the hold, and dismisses that video at the hold's end", () => {
    const { onSystemPause } = heldAndFocused()
    rootPlays(false)
    // The viewer plays inside the OS window: a system pause for the clip.
    rootPlays(true)
    expect(onSystemPause).toHaveBeenCalledTimes(1)

    // Every store commit reaches the subscription, so the pending takeover
    // follows the new video. The pure suite pins the stale-pending step
    // (another video at the hold's end is not dismissed on that step).
    act(() => {
      sessionStore.start({
        videoId: JESUS.videoId,
        videoSlug: JESUS.videoSlug,
        title: JESUS.title,
      })
    })
    expect(transport.pause).toHaveBeenCalledTimes(2)
    expect(sessionStore.getSnapshot().dismissal).toBe("none")

    setPipHold(false)
    expect(endsSeen()).toEqual([
      ["replaced", "magdalena", TWENTY_MINUTES],
      ["dismissed", "jesus", 0],
    ])
  })
})

// ── The root playing edge ───────────────────────────────────────────

describe("useExploreTakeover — the root playing edge (R45)", () => {
  it("calls onSystemPause once for each rise of the root player's playing flag", () => {
    const onSystemPause = jest.fn()
    renderTakeover({ focused: true, onSystemPause })

    rootPlays(true)
    expect(onSystemPause).toHaveBeenCalledTimes(1)

    // A request-store commit that does not move the flag is not an edge.
    act(() => {
      requestStore.setLoadFailed(true)
    })
    expect(onSystemPause).toHaveBeenCalledTimes(1)

    rootPlays(false)
    expect(onSystemPause).toHaveBeenCalledTimes(1)
    rootPlays(true)
    expect(onSystemPause).toHaveBeenCalledTimes(2)
  })

  it("reads a root player already playing at the focus as no edge, and sends none while Explore is not focused", () => {
    const onSystemPause = jest.fn()
    rootPlays(true)
    const takeover = renderTakeover({ focused: true, onSystemPause })
    // A commit while the root still plays is where a wrong seed would fire.
    act(() => {
      requestStore.setLoadFailed(true)
    })
    expect(onSystemPause).not.toHaveBeenCalled()

    takeover.rerender({ focused: false })
    rootPlays(false)
    rootPlays(true)
    expect(onSystemPause).not.toHaveBeenCalled()

    takeover.rerender({ focused: true })
    act(() => {
      requestStore.setLoadFailed(false)
    })
    expect(onSystemPause).not.toHaveBeenCalled()
  })

  it("calls the latest callback when the caller passes a new one each render", () => {
    const first = jest.fn()
    const second = jest.fn()
    const takeover = renderTakeover({ focused: true, onSystemPause: first })
    takeover.rerender({ onSystemPause: second })

    rootPlays(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

// ── Without focus ───────────────────────────────────────────────────

describe("useExploreTakeover — while Explore is not focused", () => {
  it("dismisses nothing and pauses nothing", () => {
    floating(MAGDALENA)
    rootPlays(true)
    const takeover = renderTakeover({
      focused: false,
      onSystemPause: jest.fn(),
    })

    setPipHold(true)
    act(() => {
      sessionStore.publishPosition({ positionSeconds: TWENTY_MINUTES + 1 })
    })
    setPipHold(false)
    floating(JESUS)

    // Only the store's own replacement ends Magdalena.
    expect(endsSeen()).toEqual([["replaced", "magdalena", TWENTY_MINUTES + 1]])
    expect(sessionStore.getSnapshot().dismissal).toBe("none")
    expect(transport.pause).not.toHaveBeenCalled()
    expect(takeover.yieldsToRoot()).toBe(true)
  })

  it("stops at unmount", () => {
    const onSystemPause = jest.fn()
    const takeover = renderTakeover({ focused: true, onSystemPause })
    takeover.unmount()

    floating(MAGDALENA)
    rootPlays(true)
    expect(endsSeen()).toEqual([])
    expect(onSystemPause).not.toHaveBeenCalled()
  })
})

// ── Remount safety ──────────────────────────────────────────────────

describe("useExploreTakeover — under an element-level <StrictMode> (remount safety)", () => {
  it("dismisses a floating session once", () => {
    floating(MAGDALENA)
    renderTakeover(
      { focused: true, onSystemPause: jest.fn() },
      { strict: true },
    )
    expect(endsSeen()).toEqual([["dismissed", "magdalena", TWENTY_MINUTES]])
  })

  it("pauses under a hold once, then dismisses once at the hold's end", () => {
    floating(MAGDALENA)
    setPipHold(true)
    rootPlays(true)
    renderTakeover(
      { focused: true, onSystemPause: jest.fn() },
      { strict: true },
    )
    expect(transport.pause).toHaveBeenCalledTimes(1)
    expect(sessionStore.getSnapshot().dismissal).toBe("none")

    rootPlays(false)
    setPipHold(false)
    expect(endsSeen()).toEqual([["dismissed", "magdalena", TWENTY_MINUTES]])
  })

  it("keeps one edge subscription through the setup, cleanup, setup cycle", () => {
    const onSystemPause = jest.fn()
    renderTakeover({ focused: true, onSystemPause }, { strict: true })

    rootPlays(true)
    expect(onSystemPause).toHaveBeenCalledTimes(1)
  })
})
