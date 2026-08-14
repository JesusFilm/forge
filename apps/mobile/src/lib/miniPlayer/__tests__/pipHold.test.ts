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

  it("holds null as a value, not as an absence", () => {
    // The host holds `resolveActivePlayback(...)`, whose end state IS null.
    // A nullish-coalescing implementation would let that unmount through.
    expect(pictureInPictureHold(null, { videoId: "a" }, true)).toEqual({
      videoId: "a",
    })
    expect(pictureInPictureHold({ videoId: "b" }, null, true)).toBeNull()
  })
})
