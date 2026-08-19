import {
  ACCESSIBILITY_MIN_TARGET,
  CONTROL_GAP,
  DEFAULT_CORNER,
  MIN_VIDEO_WIDTH,
  allowedCorners,
  defaultCornerFrame,
  miniPlayerCornerFrame,
  miniPlayerCornerFrames,
  miniPlayerMinWidth,
  miniPlayerWindowSize,
  snapToCorner,
  type MiniPlayerCorner,
  type MiniPlayerLayoutConfig,
} from "../layout"

/** An iPhone-shaped screen with a notch, home indicator, and the tab bar. */
const PHONE: MiniPlayerLayoutConfig = {
  screen: { width: 390, height: 844 },
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
  chrome: { top: 0, bottom: 49 },
}

describe("KTD6 minimum width", () => {
  it("is the MAXIMUM of the control row and the video minimum, never the sum", () => {
    const controlRow = ACCESSIBILITY_MIN_TARGET * 2 + CONTROL_GAP
    expect(controlRow).toBe(104)
    expect(MIN_VIDEO_WIDTH).toBe(160)
    // The two terms differ, so a sum would read 264 and a max reads 160.
    expect(miniPlayerMinWidth()).toBe(160)
    expect(miniPlayerMinWidth()).not.toBe(controlRow + MIN_VIDEO_WIDTH)
  })

  it("lets the control row win when it is the larger term", () => {
    expect(
      miniPlayerMinWidth({
        minTouchTarget: 80,
        controlGap: 10,
        minVideoWidth: 160,
      }),
    ).toBe(170)
  })

  it("lets the video minimum win when it is the larger term", () => {
    expect(
      miniPlayerMinWidth({
        minTouchTarget: 40,
        controlGap: 4,
        minVideoWidth: 200,
      }),
    ).toBe(200)
  })

  it("returns the shared value when both terms are equal", () => {
    expect(
      miniPlayerMinWidth({
        minTouchTarget: 48,
        controlGap: 8,
        minVideoWidth: 104,
      }),
    ).toBe(104)
  })
})

describe("window size", () => {
  it("takes its share of the screen width at 16:9", () => {
    expect(miniPlayerWindowSize(PHONE)).toEqual({ width: 164, height: 92 })
  })

  it("never falls below the KTD6 floor on a narrow screen", () => {
    const size = miniPlayerWindowSize({
      ...PHONE,
      screen: { width: 200, height: 500 },
    })
    expect(size.width).toBe(miniPlayerMinWidth())
  })

  it("respects a caller's width fraction", () => {
    const size = miniPlayerWindowSize({ ...PHONE, widthFraction: 0.6 })
    expect(size.width).toBe(234)
    expect(size.height).toBe(132)
  })
})

describe("corner frames", () => {
  it("insets inside the safe area, the live top chrome and the live bottom chrome", () => {
    const config: MiniPlayerLayoutConfig = {
      ...PHONE,
      chrome: { top: 96, bottom: 83 },
    }
    const { width, height } = miniPlayerWindowSize(config)
    const top = miniPlayerCornerFrame(config, "topLeft")
    const bottom = miniPlayerCornerFrame(config, "bottomRight")

    expect(top.y).toBeGreaterThanOrEqual(config.insets.top + config.chrome.top)
    expect(bottom.y + height).toBeLessThanOrEqual(
      config.screen.height - config.insets.bottom - config.chrome.bottom,
    )
    expect(bottom.x + width).toBeLessThanOrEqual(
      config.screen.width - config.insets.right,
    )
    expect(top.x).toBeGreaterThanOrEqual(config.insets.left)
  })

  it("moves inward when the live chrome grows", () => {
    const withoutChrome = miniPlayerCornerFrame(
      { ...PHONE, chrome: { top: 0, bottom: 0 } },
      "bottomRight",
    )
    const withChrome = miniPlayerCornerFrame(
      { ...PHONE, chrome: { top: 0, bottom: 83 } },
      "bottomRight",
    )
    expect(withChrome.y).toBeLessThan(withoutChrome.y)
    expect(withoutChrome.y - withChrome.y).toBe(83)
  })

  it.each<[label: string, config: MiniPlayerLayoutConfig]>([
    ["notched phone with a tab bar", PHONE],
    [
      "landscape with side insets",
      {
        screen: { width: 844, height: 390 },
        insets: { top: 0, right: 59, bottom: 21, left: 59 },
        chrome: { top: 0, bottom: 0 },
      },
    ],
    [
      "insetless Android",
      {
        screen: { width: 412, height: 915 },
        insets: { top: 24, right: 0, bottom: 0, left: 0 },
        chrome: { top: 0, bottom: 56 },
      },
    ],
  ])("places the window in each corner for a %s", (_label, config) => {
    const margin = 12
    const { width, height } = miniPlayerWindowSize(config)
    const left = config.insets.left + margin
    const right = config.screen.width - config.insets.right - margin - width
    const top = config.insets.top + config.chrome.top + margin
    const bottom =
      config.screen.height -
      config.insets.bottom -
      config.chrome.bottom -
      margin -
      height

    // Released hard into each screen corner, the window settles at that corner.
    expect(snapToCorner(config, { x: -50, y: -50 })).toEqual({
      corner: "topLeft",
      x: left,
      y: top,
      width,
      height,
    })
    expect(
      snapToCorner(config, { x: config.screen.width + 50, y: -50 }),
    ).toMatchObject({ corner: "topRight", x: right, y: top })
    expect(
      snapToCorner(config, { x: -50, y: config.screen.height + 50 }),
    ).toMatchObject({ corner: "bottomLeft", x: left, y: bottom })
    expect(
      snapToCorner(config, {
        x: config.screen.width + 50,
        y: config.screen.height + 50,
      }),
    ).toMatchObject({ corner: "bottomRight", x: right, y: bottom })
  })

  it("defaults to the corner that obscures no focusable control", () => {
    expect(DEFAULT_CORNER).toBe("bottomRight")
    expect(defaultCornerFrame(PHONE)).toMatchObject({ corner: "bottomRight" })
  })
})

describe("snap thresholds", () => {
  it("switches side at the midpoint of each axis's own travel", () => {
    // Midpoints for PHONE: x 113, y 364.
    expect(snapToCorner(PHONE, { x: 112, y: 363 }).corner).toBe("topLeft")
    expect(snapToCorner(PHONE, { x: 114, y: 363 }).corner).toBe("topRight")
    expect(snapToCorner(PHONE, { x: 112, y: 365 }).corner).toBe("bottomLeft")
    expect(snapToCorner(PHONE, { x: 114, y: 365 }).corner).toBe("bottomRight")
  })

  it("honours a caller's snap bias", () => {
    const config = { ...PHONE, snapBias: 0.9 }
    expect(snapToCorner(PHONE, { x: 150, y: 0 }).corner).toBe("topRight")
    expect(snapToCorner(config, { x: 150, y: 0 }).corner).toBe("topLeft")
  })
})

describe("excluded corners", () => {
  const excluded: MiniPlayerLayoutConfig = {
    ...PHONE,
    excludedCorners: ["bottomRight"],
  }

  it("leaves the other three reachable", () => {
    const frames = miniPlayerCornerFrames(excluded)
    expect(frames.map((frame) => frame.corner)).toEqual([
      "bottomLeft",
      "topRight",
      "topLeft",
    ])
    expect(snapToCorner(excluded, { x: -50, y: -50 }).corner).toBe("topLeft")
    expect(snapToCorner(excluded, { x: 400, y: -50 }).corner).toBe("topRight")
    expect(snapToCorner(excluded, { x: -50, y: 900 }).corner).toBe("bottomLeft")
  })

  it("sends a release in the excluded quadrant to the nearest allowed corner", () => {
    const frame = snapToCorner(excluded, { x: 350, y: 800 })
    expect(frame.corner).toBe("bottomLeft")
  })

  it("keeps the default corner when every corner is excluded", () => {
    const corners: MiniPlayerCorner[] = [
      "topLeft",
      "topRight",
      "bottomLeft",
      "bottomRight",
    ]
    const config = { ...PHONE, excludedCorners: corners }
    expect(allowedCorners(config)).toEqual([DEFAULT_CORNER])
    expect(snapToCorner(config, { x: 0, y: 0 }).corner).toBe(DEFAULT_CORNER)
  })
})
