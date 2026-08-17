/**
 * R9/R10's two predicates.
 *
 * `miniPlayerHoldsVideo` is driven through a REAL store rather than snapshot
 * literals: the phase it reads is produced by the store's own transitions, so a
 * transition that stopped producing "playing" cannot leave this green.
 */

import { heroPlaybackPaused, miniPlayerHoldsVideo } from "../heroYield"
import { createMiniPlayerStore } from "../store"

const SESSION = {
  videoId: "video-a",
  videoSlug: "video-a-slug",
  title: "Video A",
}

function playingStore() {
  const store = createMiniPlayerStore()
  store.start(SESSION)
  return store
}

describe("miniPlayerHoldsVideo", () => {
  it("is false with no session — nothing is competing for the decoder", () => {
    expect(miniPlayerHoldsVideo(createMiniPlayerStore().getSnapshot())).toBe(
      false,
    )
  })

  it("is true while the window is playing", () => {
    expect(miniPlayerHoldsVideo(playingStore().getSnapshot())).toBe(true)
  })

  it("is false once playback ends in place: the window shows a thumbnail", () => {
    const store = playingStore()
    store.markEnded("playToEnd")

    // The session is still there and undismissed — keying on its EXISTENCE is
    // what would freeze the hero for as long as the viewer ignores the window.
    expect(store.getSnapshot().session).not.toBeNull()
    expect(store.getSnapshot().dismissal).toBe("none")
    expect(miniPlayerHoldsVideo(store.getSnapshot())).toBe(false)
  })

  it("is false when an unrecoverable failure ends the session", () => {
    const store = playingStore()
    store.markEnded("failure")

    expect(miniPlayerHoldsVideo(store.getSnapshot())).toBe(false)
  })

  it("is true again after a replay from the ended state", () => {
    const store = playingStore()
    store.markEnded("playToEnd")
    store.markPlaying()

    expect(miniPlayerHoldsVideo(store.getSnapshot())).toBe(true)
  })

  it("holds through the exit animation and releases when the window clears", () => {
    const store = playingStore()
    store.requestDismiss()

    // Exiting still draws a video surface; only reportExitComplete gives it up.
    expect(store.getSnapshot().dismissal).toBe("exiting")
    expect(miniPlayerHoldsVideo(store.getSnapshot())).toBe(true)

    store.reportExitComplete()
    expect(miniPlayerHoldsVideo(store.getSnapshot())).toBe(false)
  })
})

describe("heroPlaybackPaused", () => {
  // [scrolledPast, focused, windowHoldsVideo, expected]. Every term alone, and
  // then every combination of them — the whole truth table, in order.
  type Case = [boolean, boolean, boolean, boolean]
  const cases: Case[] = [
    [false, true, false, false],
    [true, true, false, true],
    [false, false, false, true],
    [false, true, true, true],
    [true, false, false, true],
    [true, true, true, true],
    [false, false, true, true],
    [true, false, true, true],
  ]

  it.each(cases)(
    "scrolledPast=%s focused=%s window=%s → paused=%s",
    (scrolledPast, focused, windowHoldsVideo, paused) => {
      expect(
        heroPlaybackPaused({ scrolledPast, focused, windowHoldsVideo }),
      ).toBe(paused)
    },
  )

  it("keeps the hero paused when Home refocuses under a live window", () => {
    // The pop that opens the window fires Home's focus listener in the same
    // commit, so focus alone must never be the resume condition.
    expect(
      heroPlaybackPaused({
        scrolledPast: false,
        focused: true,
        windowHoldsVideo: true,
      }),
    ).toBe(true)
  })
})
