import { CORNER_PREFERENCE, dismissMode, isTopCorner } from "../layout"

describe("dismissMode", () => {
  it("fades a window dismissed from either top corner", () => {
    expect(dismissMode("topLeft")).toBe("fade")
    expect(dismissMode("topRight")).toBe("fade")
  })

  it("slides a window dismissed from either bottom corner", () => {
    expect(dismissMode("bottomLeft")).toBe("slide")
    expect(dismissMode("bottomRight")).toBe("slide")
  })

  // The exit reads this for whichever corner the drag left the window in, so a
  // corner added later must get an answer rather than fall through to
  // undefined — which would arm neither animation and strand the window.
  it("answers for every corner the window can occupy", () => {
    for (const corner of CORNER_PREFERENCE) {
      expect(["fade", "slide"]).toContain(dismissMode(corner))
    }
  })
})

describe("isTopCorner", () => {
  // The frame arithmetic reads the SAME predicate, so a disagreement here would
  // fade a window the layout treats as sitting on the bottom edge.
  it("splits the corners by screen edge", () => {
    expect(CORNER_PREFERENCE.filter(isTopCorner)).toEqual([
      "topRight",
      "topLeft",
    ])
    expect(CORNER_PREFERENCE.filter((c) => !isTopCorner(c))).toEqual([
      "bottomRight",
      "bottomLeft",
    ])
  })
})
