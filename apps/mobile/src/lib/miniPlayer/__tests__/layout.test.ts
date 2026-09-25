import {
  ACCESSIBILITY_MIN_TARGET,
  CONTROL_GAP,
  DEFAULT_CORNER,
  MIN_VIDEO_WIDTH,
  allowedCorners,
  defaultCornerFrame,
  WINDOW_EDGE_MARGIN,
  miniPlayerCornerFrame,
  miniPlayerCornerFrames,
  miniPlayerMinWidth,
  miniPlayerWindowSize,
  readerCornerPolicy,
  snapToCorner,
  type MiniPlayerCorner,
  type MiniPlayerLayoutConfig,
} from "../layout"
import {
  TAB_BAR_OCCUPIED_HEIGHT,
  TAB_BAR_HEIGHT_IOS,
  tabBarOccupiedHeightFor,
} from "../../tabBar"
import {
  readerBottomInset,
  readerChromeBand,
  readerMovementBandHeight,
  type ReaderLayout,
} from "../../bible/reader/chrome"

/** An iPhone-shaped screen with a notch, home indicator, and the tab bar.
 *  The chrome height is READ from production — a literal here would drift. */
const PHONE: MiniPlayerLayoutConfig = {
  screen: { width: 390, height: 844 },
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
  chrome: { top: 0, bottom: TAB_BAR_OCCUPIED_HEIGHT },
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
    // Derived, not hand-copied: the y midpoint moves whenever the tab bar's
    // reserved height does, and a literal here silently re-tunes the gesture.
    const topLeft = miniPlayerCornerFrame(PHONE, "topLeft")
    const bottomRight = miniPlayerCornerFrame(PHONE, "bottomRight")
    const midX = (topLeft.x + bottomRight.x) / 2
    const midY = (topLeft.y + bottomRight.y) / 2

    expect(snapToCorner(PHONE, { x: midX - 1, y: midY - 1 }).corner).toBe(
      "topLeft",
    )
    expect(snapToCorner(PHONE, { x: midX + 1, y: midY - 1 }).corner).toBe(
      "topRight",
    )
    expect(snapToCorner(PHONE, { x: midX - 1, y: midY + 1 }).corner).toBe(
      "bottomLeft",
    )
    expect(snapToCorner(PHONE, { x: midX + 1, y: midY + 1 }).corner).toBe(
      "bottomRight",
    )
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

describe("the resting window clears the native tab bar", () => {
  // The gap is WINDOW_EDGE_MARGIN by construction whenever chrome.bottom and
  // the bar top come from the same constant, so asserting it against PHONE
  // alone proves nothing. Pin the constant, then show the assertion can fail.
  it("reserves the UIKit bar's own height on iOS", () => {
    expect(TAB_BAR_OCCUPIED_HEIGHT).toBe(TAB_BAR_HEIGHT_IOS)
  })

  it("leaves an oversized gap when the reservation still holds the retired pill's 68", () => {
    const stale = { ...PHONE, chrome: { top: 0, bottom: 68 } }
    const frame = defaultCornerFrame(stale)
    const windowBottom = frame.y + frame.height
    // The bar top comes from the REAL bar, never from the reservation, so an
    // over-reservation lifts the window: a 730pt bottom under a 761pt bar top.
    const barTop =
      stale.screen.height - stale.insets.bottom - TAB_BAR_HEIGHT_IOS
    expect(barTop - windowBottom).toBeGreaterThan(WINDOW_EDGE_MARGIN)
  })

  it("overlaps the bar when the reservation is smaller than the real bar", () => {
    const short = { ...PHONE, chrome: { top: 0, bottom: 30 } }
    const frame = defaultCornerFrame(short)
    const windowBottom = frame.y + frame.height
    // The other direction: an under-reservation drops the window onto the bar,
    // to a 768pt bottom below the same 761pt bar top.
    const barTop =
      short.screen.height - short.insets.bottom - TAB_BAR_HEIGHT_IOS
    expect(barTop - windowBottom).toBeLessThan(0)
  })

  it("leaves WINDOW_EDGE_MARGIN once the reservation matches the bar", () => {
    const frame = defaultCornerFrame(PHONE)
    const windowBottom = frame.y + frame.height
    const barTop =
      PHONE.screen.height - PHONE.insets.bottom - TAB_BAR_HEIGHT_IOS
    expect(barTop - windowBottom).toBe(WINDOW_EDGE_MARGIN)
  })
})

// feat-551 KTD11, KD9, KD26, R10, AE18.
describe("the reader corner policy", () => {
  const CORNERS: MiniPlayerCorner[] = [
    "topLeft",
    "topRight",
    "bottomLeft",
    "bottomRight",
  ]

  type Case = {
    label: string
    layout: ReaderLayout
    host: "tab" | "pushed"
    platform: "ios" | "android"
    screen: { width: number; height: number }
    /** The ROOT safe area, which is what the playback host reads. */
    insets: { top: number; right: number; bottom: number; left: number }
    band: number
  }

  const CASES: Case[] = [
    {
      label: "iPhone, pushed reader",
      layout: "phone",
      host: "pushed",
      platform: "ios",
      screen: { width: 440, height: 956 },
      insets: { top: 62, right: 0, bottom: 34, left: 0 },
      band: 0,
    },
    {
      label: "iPhone, Bible tab, hint showing",
      layout: "phone",
      host: "tab",
      platform: "ios",
      screen: { width: 440, height: 956 },
      insets: { top: 62, right: 0, bottom: 34, left: 0 },
      band: readerMovementBandHeight({ arrows: false, hint: true }),
    },
    {
      label: "iPad, pushed reader, arrows",
      layout: "tablet",
      host: "pushed",
      platform: "ios",
      screen: { width: 820, height: 1180 },
      insets: { top: 24, right: 0, bottom: 20, left: 0 },
      band: readerMovementBandHeight({ arrows: true, hint: false }),
    },
    {
      label: "iPad, Bible tab, arrows and hint",
      layout: "tablet",
      host: "tab",
      platform: "ios",
      screen: { width: 820, height: 1180 },
      insets: { top: 24, right: 0, bottom: 20, left: 0 },
      band: readerMovementBandHeight({ arrows: true, hint: true }),
    },
    {
      label: "Android phone, Bible tab",
      layout: "phone",
      host: "tab",
      platform: "android",
      screen: { width: 412, height: 915 },
      insets: { top: 24, right: 0, bottom: 24, left: 0 },
      band: 0,
    },
  ]

  function hostConfig(c: Case): MiniPlayerLayoutConfig {
    const policy = readerCornerPolicy({
      layout: c.layout,
      host: c.host,
      movementBand: c.band,
      tabBar: tabBarOccupiedHeightFor(c.platform),
    })
    return { screen: c.screen, insets: c.insets, chrome: policy.chrome }
  }

  /** The reader's OWN band, from the functions its verse box uses, so it can
   *  disagree with the policy. An iOS tab screen's inset holds the bar; the
   *  Android tab screen ends above its bar. */
  function readerBand(c: Case): { top: number; bottom: number } {
    const onAndroidTab = c.host === "tab" && c.platform === "android"
    const screenInset =
      c.host === "tab" && c.platform === "ios"
        ? c.insets.bottom + TAB_BAR_HEIGHT_IOS
        : c.insets.bottom
    const containerHeight = onAndroidTab
      ? c.screen.height - c.insets.bottom - tabBarOccupiedHeightFor("android")
      : c.screen.height
    const band = readerChromeBand({
      layout: c.layout,
      safeAreaTop: c.insets.top,
      bottomInset: readerBottomInset(c.host, c.platform, screenInset),
      containerHeight,
    })
    return { top: band.top, bottom: band.bottom - c.band }
  }

  it("starts at the top right on a phone and the bottom right on a tablet (KD9)", () => {
    const base = { host: "pushed" as const, movementBand: 0, tabBar: 49 }
    expect(readerCornerPolicy({ ...base, layout: "phone" }).startCorner).toBe(
      "topRight",
    )
    expect(readerCornerPolicy({ ...base, layout: "tablet" }).startCorner).toBe(
      "bottomRight",
    )
  })

  it.each(CASES.map((c) => [c.label, c] as const))(
    "excludes no corner: %s",
    (_label, c) => {
      expect([...allowedCorners(hostConfig(c))].sort()).toEqual(
        [...CORNERS].sort(),
      )
    },
  )

  it.each(CASES.map((c) => [c.label, c] as const))(
    "keeps every corner between the top bar and the footer: %s",
    (_label, c) => {
      const config = hostConfig(c)
      const band = readerBand(c)
      for (const corner of CORNERS) {
        const frame = miniPlayerCornerFrame(config, corner)
        expect(frame.y).toBeGreaterThanOrEqual(band.top)
        expect(frame.y + frame.height).toBeLessThanOrEqual(band.bottom)
      }
      // R10's "just under" and "just above": one edge margin, no more.
      const top = miniPlayerCornerFrame(config, "topLeft")
      const bottom = miniPlayerCornerFrame(config, "bottomLeft")
      expect(top.y - band.top).toBe(WINDOW_EDGE_MARGIN)
      expect(band.bottom - (bottom.y + bottom.height)).toBe(WINDOW_EDGE_MARGIN)
    },
  )

  it("reserves the tab bar in the Bible tab only", () => {
    const input = { layout: "phone" as const, movementBand: 0, tabBar: 49 }
    const tab = readerCornerPolicy({ ...input, host: "tab" })
    const pushed = readerCornerPolicy({ ...input, host: "pushed" })
    expect(tab.chrome.bottom - pushed.chrome.bottom).toBe(49)
    expect(tab.chrome.top).toBe(pushed.chrome.top)
  })

  it("lifts the bottom corners by the reader's band above the footer", () => {
    const input = { layout: "phone" as const, host: "pushed" as const }
    const clear = readerCornerPolicy({ ...input, movementBand: 0, tabBar: 49 })
    const banded = readerCornerPolicy({
      ...input,
      movementBand: 84,
      tabBar: 49,
    })
    expect(banded.chrome.bottom - clear.chrome.bottom).toBe(84)
  })
})
