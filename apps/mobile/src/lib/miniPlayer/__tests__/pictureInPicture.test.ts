/**
 * The picture-in-picture helper (U9): the four props every eligible video view
 * spreads, and the rule a viewer-initiated SDUI player applies before it opens
 * a second decoder.
 *
 * The store is the real one — the helper's whole job is reaching it.
 */

import {
  endSessionForViewerInitiatedPlayback,
  pictureInPictureViewProps,
} from "../pictureInPicture"
import { getMiniPlayerStore, type MiniPlayerEndEvent } from "../store"

const store = getMiniPlayerStore()

function startSession() {
  store.start({
    videoId: "video-a",
    videoSlug: "video-a-slug",
    title: "Video A",
  })
}

beforeEach(() => {
  store.setPipHold(false)
  store.end("abandoned")
})

describe("the view props", () => {
  it("allows picture-in-picture and carries the automatic flag it is given", () => {
    expect(pictureInPictureViewProps({ automatic: true })).toMatchObject({
      allowsPictureInPicture: true,
      startsPictureInPictureAutomatically: true,
    })
    expect(
      pictureInPictureViewProps({ automatic: false })
        .startsPictureInPictureAutomatically,
    ).toBe(false)
  })

  it("sets the latch on start and releases it on stop", () => {
    const props = pictureInPictureViewProps({ automatic: true })
    expect(store.getSnapshot().pipHold).toBe(false)

    props.onPictureInPictureStart()
    expect(store.getSnapshot().pipHold).toBe(true)

    props.onPictureInPictureStop()
    expect(store.getSnapshot().pipHold).toBe(false)
  })

  it("reaches the SAME latch from a second view, so one window has one hold", () => {
    // R14: the host and the two SDUI players are different call sites. A helper
    // that closed over a per-call store would leave the second one inert.
    const host = pictureInPictureViewProps({ automatic: true })
    const sdui = pictureInPictureViewProps({ automatic: false })

    sdui.onPictureInPictureStart()
    expect(store.getSnapshot().pipHold).toBe(true)

    host.onPictureInPictureStop()
    expect(store.getSnapshot().pipHold).toBe(false)
  })

  it("defers a dismiss requested under the hold, and promotes it on release (AE12)", () => {
    startSession()
    const props = pictureInPictureViewProps({ automatic: true })
    props.onPictureInPictureStart()

    store.requestDismiss()
    expect(store.getSnapshot().dismissal).toBe("deferred")

    props.onPictureInPictureStop()
    expect(store.getSnapshot().dismissal).toBe("exiting")
  })
})

describe("viewer-initiated playback on an R19-excluded route", () => {
  it("ends the live session as replaced and creates none in its place", () => {
    startSession()
    const endings: MiniPlayerEndEvent[] = []
    const unsubscribe = store.onEnd((event) => endings.push(event))

    endSessionForViewerInitiatedPlayback()

    expect(endings.map((e) => e.reason)).toEqual(["replaced"])
    expect(endings[0].session.videoId).toBe("video-a")
    expect(store.getSnapshot().session).toBeNull()
    unsubscribe()
  })

  it("is a no-op with no session open, so a replayed effect reports nothing", () => {
    const endings: MiniPlayerEndEvent[] = []
    const unsubscribe = store.onEnd((event) => endings.push(event))

    endSessionForViewerInitiatedPlayback()
    endSessionForViewerInitiatedPlayback()

    expect(endings).toEqual([])
    unsubscribe()
  })
})
