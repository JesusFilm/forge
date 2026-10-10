import { captionMeetsBox, type CaptionBox } from "../captionBox"

/** The Mute button on an iPhone 17 Explore page: right edge, above the title. */
const MUTE: CaptionBox = { left: 328, right: 388, bottom: 286, top: 360 }

describe("captionMeetsBox", () => {
  it("meets a box it covers in both directions", () => {
    const caption = { left: 40, right: 340, bottom: 300, top: 380 }
    expect(captionMeetsBox(caption, [MUTE])).toBe(true)
  })

  it("does not meet a box beside it: same height, clear to the left", () => {
    const caption = { left: 40, right: 320, bottom: 300, top: 380 }
    expect(captionMeetsBox(caption, [MUTE])).toBe(false)
  })

  it("does not meet a box below it: same width, clear above", () => {
    const caption = { left: 40, right: 362, bottom: 370, top: 430 }
    expect(captionMeetsBox(caption, [MUTE])).toBe(false)
  })

  it("does not count edges that only touch", () => {
    expect(
      captionMeetsBox({ left: 40, right: 328, bottom: 300, top: 380 }, [MUTE]),
    ).toBe(false)
    expect(
      captionMeetsBox({ left: 40, right: 362, bottom: 360, top: 420 }, [MUTE]),
    ).toBe(false)
  })

  it("meets when any one box of several is covered", () => {
    const share: CaptionBox = { left: 332, right: 384, bottom: 200, top: 274 }
    const caption = { left: 40, right: 362, bottom: 230, top: 262 }
    expect(captionMeetsBox(caption, [MUTE, share])).toBe(true)
    expect(captionMeetsBox(caption, [])).toBe(false)
  })
})
