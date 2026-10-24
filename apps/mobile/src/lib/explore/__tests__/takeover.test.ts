/**
 * The takeover rules are driven through a REAL mini-player store, as the
 * hero-yield suite is: the hold, the session, and the dismissal they read are
 * produced by the store's own transitions, not by snapshot literals.
 */

import {
  createMiniPlayerStore,
  type MiniPlayerSessionInput,
  type MiniPlayerStore,
} from "../../miniPlayer/store"
import {
  clipYieldsToRoot,
  stepTakeover,
  type PendingTakeover,
} from "../takeover"

const MAGDALENA = {
  videoId: "video-magdalena",
  videoSlug: "magdalena",
  title: "Magdalena",
}
const JESUS = { videoId: "video-jesus", videoSlug: "jesus", title: "JESUS" }

function floating(
  session: MiniPlayerSessionInput = MAGDALENA,
): MiniPlayerStore {
  const store = createMiniPlayerStore()
  store.start(session)
  return store
}

function step(
  store: MiniPlayerStore,
  focused: boolean,
  pending: PendingTakeover | null = null,
) {
  return stepTakeover({ snapshot: store.getSnapshot(), focused, pending })
}

describe("clipYieldsToRoot", () => {
  // [rootPlaying, rootHasRequest, pipHold, yields]: the whole truth table.
  type Case = [boolean, boolean, boolean, boolean]
  const cases: Case[] = [
    [false, false, false, false],
    [true, false, false, true],
    [false, true, false, true],
    [false, false, true, false],
    [true, true, false, true],
    [true, false, true, true],
    [false, true, true, false],
    [true, true, true, true],
  ]

  it.each(cases)(
    "rootPlaying=%s request=%s hold=%s → yields=%s",
    (rootPlaying, rootHasRequest, pipHold, yields) => {
      expect(clipYieldsToRoot({ rootPlaying, rootHasRequest, pipHold })).toBe(
        yields,
      )
    },
  )

  it("holds the first clip while the root player plays", () => {
    expect(
      clipYieldsToRoot({
        rootPlaying: true,
        rootHasRequest: false,
        pipHold: false,
      }),
    ).toBe(true)
  })

  it("holds the first clip while a request remains and no hold is set", () => {
    expect(
      clipYieldsToRoot({
        rootPlaying: false,
        rootHasRequest: true,
        pipHold: false,
      }),
    ).toBe(true)
  })

  it("under a hold, releases the clip once the root player is paused, with the request still present", () => {
    // The watch page's request stays in the store under a hold, so waiting for
    // it to clear would hold the clip for as long as the window stays open.
    expect(
      clipYieldsToRoot({
        rootPlaying: false,
        rootHasRequest: true,
        pipHold: true,
      }),
    ).toBe(false)
  })
})

describe("stepTakeover", () => {
  it("dismisses a floating session while Explore is focused", () => {
    expect(step(floating(), true)).toEqual({
      pending: null,
      dismiss: true,
      pauseRoot: false,
    })
  })

  it("does nothing while Explore is not focused", () => {
    expect(step(floating(), false)).toEqual({
      pending: null,
      dismiss: false,
      pauseRoot: false,
    })
  })

  it("does nothing with no session", () => {
    expect(step(createMiniPlayerStore(), true).dismiss).toBe(false)
  })

  it("does nothing once the session is already exiting", () => {
    const store = floating()
    store.requestDismiss()
    expect(store.getSnapshot().dismissal).toBe("exiting")
    expect(step(store, true).dismiss).toBe(false)
  })

  it("under a hold, pauses the root player and remembers the video instead of deferring a dismiss", () => {
    const store = floating()
    store.setPipHold(true)

    const result = step(store, true)
    expect(result).toEqual({
      pending: { videoId: "video-magdalena", videoSlug: "magdalena" },
      dismiss: false,
      pauseRoot: true,
    })
    expect(store.getSnapshot().dismissal).toBe("none")

    // The next store notification must not pause the root player again.
    expect(step(store, true, result.pending)).toEqual({
      pending: result.pending,
      dismiss: false,
      pauseRoot: false,
    })
  })

  it("dismisses at the hold's end when Explore has focus and the session names the same video", () => {
    const store = floating()
    store.setPipHold(true)
    const { pending } = step(store, true)

    store.setPipHold(false)
    expect(step(store, true, pending)).toEqual({
      pending: null,
      dismiss: true,
      pauseRoot: false,
    })
  })

  it("matches the same video by slug when the session has no id yet", () => {
    const store = floating({ ...MAGDALENA, videoId: null })
    store.setPipHold(true)
    const { pending } = step(store, true)

    store.setPipHold(false)
    expect(step(store, true, pending).dismiss).toBe(true)
  })

  it("does not dismiss at the hold's end when the session names another video", () => {
    const store = floating()
    store.setPipHold(true)
    const { pending } = step(store, true)

    store.start(JESUS)
    store.setPipHold(false)
    expect(step(store, true, pending)).toEqual({
      pending: null,
      dismiss: false,
      pauseRoot: false,
    })
  })

  it("clears the pending takeover on a blur, so the hold's end dismisses nothing", () => {
    const store = floating()
    store.setPipHold(true)
    const { pending } = step(store, true)

    const blurred = step(store, false, pending)
    expect(blurred.pending).toBeNull()

    store.setPipHold(false)
    expect(step(store, false, blurred.pending).dismiss).toBe(false)
  })

  it("follows a new video that replaces the session under the hold", () => {
    const store = floating()
    store.setPipHold(true)
    const { pending } = step(store, true)

    store.start(JESUS)
    expect(step(store, true, pending)).toEqual({
      pending: { videoId: "video-jesus", videoSlug: "jesus" },
      dismiss: false,
      pauseRoot: true,
    })
  })
})
