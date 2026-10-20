import { BACK_SWIPE_EDGE_WIDTH } from "../../../backSwipe"
import { READER_TOP_BAR_HEIGHT, readerFooterHeight } from "../../reader/chrome"
import {
  READER_SWIPE,
  chapterDirection,
  claimSwipe,
  mayStartReaderSwipe,
  readerTouchZones,
  releaseSwipe,
} from "../gesture"

// iPhone 17 Pro Max, pushed reader.
const SCREEN = { width: 440, height: 956, top: 62, bottom: 34 }

function zones(edgeGuardWidth = BACK_SWIPE_EDGE_WIDTH) {
  return readerTouchZones({
    safeAreaTop: SCREEN.top,
    bottomInset: SCREEN.bottom,
    containerHeight: SCREEN.height,
    edgeGuardWidth,
  })
}

const MIDDLE = { x: SCREEN.width / 2, y: SCREEN.height / 2 }

describe("readerTouchZones + mayStartReaderSwipe (KTD13)", () => {
  it("takes a touch that starts in the middle of the screen", () => {
    expect(mayStartReaderSwipe(MIDDLE, zones())).toBe(true)
  })

  it("declines a touch that starts in the 24-point left strip", () => {
    expect(mayStartReaderSwipe({ x: 0, y: MIDDLE.y }, zones())).toBe(false)
    expect(
      mayStartReaderSwipe(
        { x: BACK_SWIPE_EDGE_WIDTH - 1, y: MIDDLE.y },
        zones(),
      ),
    ).toBe(false)
    // The strip ends where the pop's response distance ends.
    expect(
      mayStartReaderSwipe({ x: BACK_SWIPE_EDGE_WIDTH, y: MIDDLE.y }, zones()),
    ).toBe(true)
  })

  it("keeps the left strip when the host has no back swipe", () => {
    expect(mayStartReaderSwipe({ x: 4, y: MIDDLE.y }, zones(0))).toBe(true)
  })

  it("declines a touch that starts in the top bar", () => {
    const topBarBottom = SCREEN.top + READER_TOP_BAR_HEIGHT
    expect(
      mayStartReaderSwipe({ x: MIDDLE.x, y: topBarBottom - 1 }, zones()),
    ).toBe(false)
    expect(mayStartReaderSwipe({ x: MIDDLE.x, y: topBarBottom }, zones())).toBe(
      true,
    )
  })

  it("declines a touch that starts in the footer", () => {
    const footerTop = SCREEN.height - readerFooterHeight() - SCREEN.bottom
    expect(mayStartReaderSwipe({ x: MIDDLE.x, y: footerTop }, zones())).toBe(
      false,
    )
    expect(
      mayStartReaderSwipe({ x: MIDDLE.x, y: footerTop - 1 }, zones()),
    ).toBe(true)
  })

  it("declines a touch that starts on another control (U9's scrubber or selection bar)", () => {
    const bar = { x: 20, y: 700, width: 400, height: 60 }
    const withBar = readerTouchZones({
      safeAreaTop: SCREEN.top,
      bottomInset: SCREEN.bottom,
      containerHeight: SCREEN.height,
      edgeGuardWidth: BACK_SWIPE_EDGE_WIDTH,
      excluded: [bar],
    })
    expect(mayStartReaderSwipe({ x: 200, y: 730 }, withBar)).toBe(false)
    expect(mayStartReaderSwipe({ x: 200, y: 690 }, withBar)).toBe(true)
  })
})

describe("claimSwipe (R12)", () => {
  const past = READER_SWIPE.activatePx + 1

  it("claims a mostly vertical drag past the threshold as a verse move", () => {
    expect(claimSwipe({ dx: 2, dy: -past }, null)).toBe("verse")
    expect(claimSwipe({ dx: -2, dy: past }, null)).toBe("verse")
  })

  it("claims a mostly horizontal drag past the threshold as a chapter move", () => {
    expect(claimSwipe({ dx: -past, dy: 3 }, null)).toBe("chapter")
    expect(claimSwipe({ dx: past, dy: -3 }, null)).toBe("chapter")
  })

  it("leaves a short drag and a diagonal drag alone", () => {
    const short = READER_SWIPE.activatePx - 1
    expect(claimSwipe({ dx: 0, dy: -short }, null)).toBeNull()
    expect(claimSwipe({ dx: -short, dy: 0 }, null)).toBeNull()
    expect(claimSwipe({ dx: 30, dy: 30 }, null)).toBeNull()
  })

  it("leaves a vertical drag to a long verse's scroll view until it reaches the edge", () => {
    const up = { dx: 0, dy: -past }
    const down = { dx: 0, dy: past }
    const middle = { atTop: false, atBottom: false }
    expect(claimSwipe(up, middle)).toBeNull()
    expect(claimSwipe(down, middle)).toBeNull()
    // Past the bottom, a swipe up moves the verse; past the top, a swipe down.
    expect(claimSwipe(up, { atTop: false, atBottom: true })).toBe("verse")
    expect(claimSwipe(down, { atTop: true, atBottom: false })).toBe("verse")
    expect(claimSwipe(down, { atTop: false, atBottom: true })).toBeNull()
    // A chapter swipe never belongs to the scroll view.
    expect(claimSwipe({ dx: -past, dy: 0 }, middle)).toBe("chapter")
  })
})

describe("releaseSwipe (R12, R14)", () => {
  const far = READER_SWIPE.commitPx
  const still = { vx: 0, vy: 0 }
  const LTR = 1
  const RTL = -1

  it("maps each direction to its move in a left-to-right layout", () => {
    expect(releaseSwipe("verse", { dx: 0, dy: -far }, still, LTR)).toEqual({
      axis: "verse",
      direction: "forward",
    })
    expect(releaseSwipe("verse", { dx: 0, dy: far }, still, LTR)).toEqual({
      axis: "verse",
      direction: "back",
    })
    expect(releaseSwipe("chapter", { dx: -far, dy: 0 }, still, LTR)).toEqual({
      axis: "chapter",
      direction: "forward",
    })
    expect(releaseSwipe("chapter", { dx: far, dy: 0 }, still, LTR)).toEqual({
      axis: "chapter",
      direction: "back",
    })
  })

  it("covers AE6: a drag to the right opens the next chapter in a right-to-left layout", () => {
    expect(releaseSwipe("chapter", { dx: far, dy: 0 }, still, RTL)).toEqual({
      axis: "chapter",
      direction: "forward",
    })
    expect(releaseSwipe("chapter", { dx: -far, dy: 0 }, still, RTL)).toEqual({
      axis: "chapter",
      direction: "back",
    })
    // A swipe up is still the next verse.
    expect(releaseSwipe("verse", { dx: 0, dy: -far }, still, RTL)).toEqual({
      axis: "verse",
      direction: "forward",
    })
  })

  it("commits nothing for a short, slow drag", () => {
    expect(
      releaseSwipe("verse", { dx: 0, dy: -(far - 1) }, still, LTR),
    ).toBeNull()
    expect(
      releaseSwipe("chapter", { dx: far - 1, dy: 0 }, still, LTR),
    ).toBeNull()
  })

  it("commits a short, fast flick in the direction it moves", () => {
    const flick = { dx: 0, dy: -READER_SWIPE.flickPx }
    const fast = { vx: 0, vy: -READER_SWIPE.flickVelocity }
    expect(releaseSwipe("verse", flick, fast, LTR)).toEqual({
      axis: "verse",
      direction: "forward",
    })
    // A flick back against the drag commits nothing.
    expect(
      releaseSwipe(
        "verse",
        flick,
        { vx: 0, vy: READER_SWIPE.flickVelocity },
        LTR,
      ),
    ).toBeNull()
  })

  it("reads only the claimed axis", () => {
    expect(releaseSwipe("verse", { dx: -200, dy: 0 }, still, LTR)).toBeNull()
    expect(releaseSwipe("chapter", { dx: 0, dy: -200 }, still, LTR)).toBeNull()
  })
})

// The chapter swipe preview (R13) and the release read this one rule, so the
// preview always names the chapter that the release opens.
describe("chapterDirection (R14)", () => {
  it("opens the next chapter on a drag to the left in a left-to-right layout", () => {
    expect(chapterDirection(-30, 1)).toBe("forward")
    expect(chapterDirection(30, 1)).toBe("back")
  })

  it("opens the next chapter on a drag to the right in a right-to-left layout", () => {
    expect(chapterDirection(30, -1)).toBe("forward")
    expect(chapterDirection(-30, -1)).toBe("back")
  })
})
