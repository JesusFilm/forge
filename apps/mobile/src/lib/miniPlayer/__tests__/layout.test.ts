import {
  CORNERS,
  DEFAULT_CORNER,
  MIN_TOUCH_TARGET,
  MIN_WINDOW_WIDTH,
  WINDOW_MARGIN,
  allowedCorners,
  cornerHasClearance,
  cornerOrigin,
  miniPlayerSize,
  snapCorner,
  type Chrome,
  type Size,
} from "../layout"

// An iPhone 17-shaped screen with a notch, a tab bar and a home indicator.
const SCREEN: Size = { width: 393, height: 852 }
const CHROME: Chrome = { top: 59, bottom: 83, left: 0, right: 0 }

const WINDOW = miniPlayerSize(SCREEN.width)

// The same phone on its side, under chrome tall enough that NO corner clears —
// a bottom sheet or keyboard over a landscape player.
const LANDSCAPE: Size = { width: 852, height: 393 }
const TALL_BOTTOM: Chrome = { top: 24, bottom: 300, left: 0, right: 0 }
const WIDE_WINDOW = miniPlayerSize(LANDSCAPE.width)

describe("miniPlayerSize (KTD6)", () => {
  it("never goes below the width its two controls need", () => {
    // The floor is derived, not chosen: two accessibility-minimum targets plus
    // spacing either side and between them.
    expect(MIN_WINDOW_WIDTH).toBe(MIN_TOUCH_TARGET * 2 + 8 * 3)
    expect(miniPlayerSize(200).width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    // A phone narrower than any shipping device still clears the floor.
    expect(miniPlayerSize(240).width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
  })

  it("caps its width on a large screen instead of scaling forever", () => {
    expect(miniPlayerSize(1024).width).toBeLessThanOrEqual(220)
  })

  it("is 16:9", () => {
    const size = miniPlayerSize(SCREEN.width)
    expect(size.width / size.height).toBeCloseTo(16 / 9, 1)
  })
})

describe("cornerOrigin (R7)", () => {
  it("insets inside the live top chrome, not just the screen edge", () => {
    const origin = cornerOrigin("topLeft", SCREEN, WINDOW, CHROME)
    expect(origin.y).toBe(CHROME.top + WINDOW_MARGIN)
    // Falsification anchor: a screen-edge inset would put this at WINDOW_MARGIN
    // alone, under the notch.
    expect(origin.y).toBeGreaterThan(WINDOW_MARGIN)
  })

  it("insets inside the live bottom chrome, not just the screen edge", () => {
    const origin = cornerOrigin("bottomLeft", SCREEN, WINDOW, CHROME)
    expect(origin.y + WINDOW.height).toBe(
      SCREEN.height - CHROME.bottom - WINDOW_MARGIN,
    )
    // Without the bottom inset the window would overlap the tab bar.
    expect(origin.y + WINDOW.height).toBeLessThan(SCREEN.height - CHROME.bottom)
  })

  it("places all four corners inside the chrome box", () => {
    for (const corner of CORNERS) {
      const origin = cornerOrigin(corner, SCREEN, WINDOW, CHROME)
      expect(origin.x).toBeGreaterThanOrEqual(CHROME.left)
      expect(origin.y).toBeGreaterThanOrEqual(CHROME.top)
      expect(origin.x + WINDOW.width).toBeLessThanOrEqual(
        SCREEN.width - CHROME.right,
      )
      expect(origin.y + WINDOW.height).toBeLessThanOrEqual(
        SCREEN.height - CHROME.bottom,
      )
    }
  })

  it("respects left and right chrome on a landscape safe area", () => {
    const landscape: Size = { width: 852, height: 393 }
    const sideChrome: Chrome = { top: 0, bottom: 21, left: 59, right: 59 }
    const size = miniPlayerSize(landscape.width)
    const left = cornerOrigin("topLeft", landscape, size, sideChrome)
    const right = cornerOrigin("topRight", landscape, size, sideChrome)
    expect(left.x).toBe(sideChrome.left + WINDOW_MARGIN)
    expect(right.x + size.width).toBe(
      landscape.width - sideChrome.right - WINDOW_MARGIN,
    )
  })
})

describe("snapCorner (R2)", () => {
  it.each(CORNERS)("settles a release near %s into that corner", (corner) => {
    const origin = cornerOrigin(corner, SCREEN, WINDOW, CHROME)
    // Release a few points off the corner, as a real drag would land.
    const released = { x: origin.x + 6, y: origin.y + 6 }
    expect(snapCorner(released, SCREEN, WINDOW, CHROME)).toBe(corner)
  })

  it("settles a mid-screen release into the nearest corner, not the default", () => {
    // Just above and left of centre → topLeft.
    const nearTopLeft = { x: SCREEN.width * 0.2, y: SCREEN.height * 0.2 }
    expect(snapCorner(nearTopLeft, SCREEN, WINDOW, CHROME)).toBe("topLeft")
  })

  it("never returns an excluded corner", () => {
    const corner = snapCorner(
      cornerOrigin("bottomRight", SCREEN, WINDOW, CHROME),
      SCREEN,
      WINDOW,
      CHROME,
      ["bottomRight"],
    )
    expect(corner).not.toBe("bottomRight")
  })
})

describe("allowedCorners (R7)", () => {
  it("keeps all four reachable on an ordinary screen", () => {
    expect(allowedCorners(SCREEN, WINDOW, CHROME)).toEqual([...CORNERS])
  })

  it("excludes one corner while the other three stay reachable", () => {
    const allowed = allowedCorners(SCREEN, WINDOW, CHROME, ["topRight"])
    expect(allowed).toHaveLength(3)
    expect(allowed).not.toContain("topRight")
    // The point of R7: excluding one corner must not strand the window.
    expect(allowed).toEqual(
      expect.arrayContaining(["topLeft", "bottomLeft", "bottomRight"]),
    )
  })

  it("drops a corner with no clearance rather than clamping it under chrome", () => {
    // Chrome so tall the window cannot fit between top and bottom.
    const crushing: Chrome = { top: 400, bottom: 400, left: 0, right: 0 }
    expect(cornerHasClearance("topLeft", SCREEN, WINDOW, crushing)).toBe(false)
  })

  it("falls back to the default corner when every corner is excluded", () => {
    // A window with nowhere to go is worse than one in a poor corner.
    expect(allowedCorners(SCREEN, WINDOW, CHROME, [...CORNERS])).toEqual([
      DEFAULT_CORNER,
    ])
  })

  it("does not fall back onto an EXCLUDED corner when no corner has clearance", () => {
    // Landscape with a tall bottom sheet: 393 - 24 - 300 leaves 69 points for a
    // 124-point window, so clearance fails everywhere at once and the fallback
    // fires. Returning the one corner the caller reserved is the whole defect.
    expect(
      cornerHasClearance("topLeft", LANDSCAPE, WIDE_WINDOW, TALL_BOTTOM),
    ).toBe(false)

    const allowed = allowedCorners(LANDSCAPE, WIDE_WINDOW, TALL_BOTTOM, [
      "bottomRight",
    ])
    expect(allowed).not.toContain("bottomRight")
    expect(allowed).toHaveLength(1)
  })

  it("still prefers the default corner in that fallback when it is free", () => {
    // Anti-vacuous companion: the fix must not swap one arbitrary corner for
    // another. DEFAULT_CORNER clears the back button and the hero call to
    // action, so it stays the choice whenever the caller has not reserved it.
    expect(
      allowedCorners(LANDSCAPE, WIDE_WINDOW, TALL_BOTTOM, ["topLeft"]),
    ).toEqual([DEFAULT_CORNER])
  })
})

describe("snapCorner with no clearance anywhere (R7 + KTD6)", () => {
  it("never settles on the corner the caller excluded", () => {
    const corner = snapCorner(
      cornerOrigin("bottomRight", LANDSCAPE, WIDE_WINDOW, TALL_BOTTOM),
      LANDSCAPE,
      WIDE_WINDOW,
      TALL_BOTTOM,
      ["bottomRight"],
    )
    expect(corner).not.toBe("bottomRight")
  })
})
