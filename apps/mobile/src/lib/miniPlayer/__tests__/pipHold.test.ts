/**
 * R24's pure rule. The three render decisions that read it are proved in
 * `PlaybackHost.test.tsx` and `MiniPlayerWindow.test.tsx`.
 */

import { pictureInPictureHold } from "../pipHold"

describe("pictureInPictureHold", () => {
  it("passes the live value through while nothing is showing", () => {
    expect(pictureInPictureHold("next", "held", false)).toBe("next")
  })

  it("holds the previous value while the OS window is showing", () => {
    expect(pictureInPictureHold("next", "held", true)).toBe("held")
  })

  it("releases to the live value on the first render after it stops", () => {
    // The held value is what the SAME decision returned last render, not a
    // snapshot taken when the latch armed, so the release needs no unwind.
    let held: boolean | undefined = true
    held = pictureInPictureHold(false, held, true)
    expect(held).toBe(true)

    held = pictureInPictureHold(false, held, false)

    expect(held).toBe(false)
  })

  it("keeps holding across several renders", () => {
    let held = "floating"
    for (const live of ["none", "full", "none"]) {
      held = pictureInPictureHold(live, held, true)
    }

    expect(held).toBe("floating")
  })

  it("holds a live value against a null successor", () => {
    // The host holds `resolveActivePlayback(...)`, whose end state IS null, so
    // the hold has to survive a `next` of null.
    expect(pictureInPictureHold(null, { videoId: "a" }, true)).toEqual({
      videoId: "a",
    })
  })

  it("never freezes the ABSENCE of a value", () => {
    // Picture-in-picture can start from the FOREGROUND, where the host owns no
    // player yet. Holding that `null` pinned "no session" and every later claim
    // was discarded: no player, no surface, a loading poster with no way out.
    expect(pictureInPictureHold({ videoId: "b" }, null, true)).toEqual({
      videoId: "b",
    })
    expect(pictureInPictureHold({ videoId: "b" }, undefined, true)).toEqual({
      videoId: "b",
    })
  })

  it("still holds `false`, which is a value and not an absence", () => {
    // The window's surface decisions are booleans, and `false` there means
    // "another surface owns the view" — a live state worth protecting.
    expect(pictureInPictureHold(true, false, true)).toBe(false)
  })
})
