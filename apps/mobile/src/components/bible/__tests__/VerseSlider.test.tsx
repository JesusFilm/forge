// The verse slide across a chapter load (owner, 2026-09-25): the old verse
// waits in place while the next chapter loads, for at most 0.3 s. A scrub
// changes the verse with the same fade, faster (owner, 2026-09-28).

import { act } from "react"
import {
  Animated,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { VerseSlide } from "../../../lib/bible/movement/useReaderMovement"
import type { ChapterPosition } from "../../../lib/bible/text/types"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import { VERSE_SLIDE_SHIFT } from "../../../lib/bible/movement/verseStage"
import {
  VERSE_SCRUB_SLIDE_MS,
  VERSE_SLIDE_HOLD_MS,
  VERSE_SLIDE_MS,
  VerseSlider,
  type LiveVerse,
  type VerseSliderProps,
} from "../VerseSlider"
import type { VerseAppearance } from "../VerseView"

const TOKENS = readerTokens("dark")
const APPEARANCE: VerseAppearance = {
  chosenSize: 30,
  osFontScale: 1,
  typeface: "serif",
  lineSpacing: 1.4,
  verseNumbers: true,
}
const COLUMN_WIDTH = 300

function verse(number: number, text: string): ChapterPosition {
  return { kind: "verse", verse: { number, lines: [{ text }] } }
}

const LAST = verse(36, "Whoever believes in the Son has eternal life.")
const FIRST = verse(1, "Now Jesus learned that the Pharisees had heard.")

function live(key: string, stop: ChapterPosition): LiveVerse {
  const [chapterKey = key, index = "0"] = key.split(":")
  return {
    key,
    chapterKey,
    index: Number(index),
    view: {
      stop,
      textDirection: "ltr",
      appearance: APPEARANCE,
      tokens: TOKENS,
      boxes: {
        centered: { top: 200, height: 400 },
        free: { top: 112, height: 576 },
      },
      columnWidth: COLUMN_WIDTH,
    },
  }
}

const FORWARD: VerseSlide = { id: 1, direction: "forward" }

function props(overrides: Partial<VerseSliderProps>): VerseSliderProps {
  return {
    live: null,
    loading: false,
    slide: null,
    scrubbing: false,
    reduceMotion: false,
    clip: { top: 100, height: 600, containerHeight: 900 },
    appearance: APPEARANCE,
    tokens: TOKENS,
    columnWidth: COLUMN_WIDTH,
    ...overrides,
  }
}

let mounted: TestInstance | null = null

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
  jest.useRealTimers()
})

function hosts(predicate: (node: RenderedNode) => boolean) {
  return mounted!.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

const copies = () =>
  hosts((node) => node.props.testID === "bible-verse-outgoing")

function textOf(node: RenderedNode): string {
  const { children } = node.props
  if (typeof children === "string") return children
  if (Array.isArray(children)) {
    return children.filter((child) => typeof child === "string").join("")
  }
  return ""
}

const copyText = () =>
  hosts((node) => node.props.testID === "bible-verse-outgoing-line")
    .map(textOf)
    .join(" ")

async function render(next: VerseSliderProps) {
  await act(async () => {
    if (mounted) mounted.update(<VerseSlider {...next} />)
    else mounted = TestRenderer.create(<VerseSlider {...next} />)
  })
}

/** Answers the fit's measuring copies, so the live verse shows. A height
 *  over the box makes the verse scroll. */
async function settle(height = 100) {
  for (let pass = 0; pass < 12; pass += 1) {
    const measuring = hosts((node) =>
      String(node.props.testID ?? "").startsWith("bible-verse-measure-"),
    )
    if (measuring.length === 0) return
    await act(async () => {
      for (const copy of measuring) {
        const onLayout = copy.props.onLayout as (event: unknown) => void
        onLayout({
          nativeEvent: {
            layout: { x: 0, y: 0, width: COLUMN_WIDTH, height },
          },
        })
      }
    })
  }
}

describe("VerseSlider across a chapter load", () => {
  it("keeps the old verse in place while the chapter loads, then slides it out", async () => {
    await render(props({ live: live("JHN.3:35", LAST) }))
    await settle()
    expect(copies()).toHaveLength(0)

    await render(props({ live: null, loading: true, slide: FORWARD }))
    expect(copies()).toHaveLength(1)
    expect(copyText()).toContain("eternal life")

    await render(props({ live: live("JHN.4:0", FIRST), slide: FORWARD }))
    await settle()
    expect(copies()).toHaveLength(1)
    expect(copyText()).toContain("eternal life")
  })

  it("lets the old verse go after 0.3 s, and then does not slide", async () => {
    jest.useFakeTimers()
    await render(props({ live: live("JHN.3:35", LAST) }))
    await settle()
    await render(props({ live: null, loading: true, slide: FORWARD }))
    expect(copies()).toHaveLength(1)

    await act(async () => {
      jest.advanceTimersByTime(VERSE_SLIDE_HOLD_MS)
    })
    expect(copies()).toHaveLength(0)

    await render(props({ live: live("JHN.4:0", FIRST), slide: FORWARD }))
    await settle()
    expect(copies()).toHaveLength(0)
  })

  it("holds nothing while a failure shows", async () => {
    await render(props({ live: live("JHN.3:35", LAST) }))
    await settle()
    await render(props({ live: null, loading: false, slide: FORWARD }))
    expect(copies()).toHaveLength(0)
  })

  it("ends the move when the load fails, so a later load does not slide", async () => {
    await render(props({ live: live("JHN.3:35", LAST) }))
    await settle()
    await render(props({ live: null, loading: true, slide: FORWARD }))
    expect(copies()).toHaveLength(1)
    // The chapter fails before the hold ends.
    await render(props({ live: null, loading: false, slide: FORWARD }))
    expect(copies()).toHaveLength(0)

    // Retry, a chapter swipe, or a jump loads again with the same slide id.
    await render(props({ live: null, loading: true, slide: FORWARD }))
    expect(copies()).toHaveLength(0)
    await render(props({ live: live("JHN.4:0", FIRST), slide: FORWARD }))
    await settle()
    expect(copies()).toHaveLength(0)
  })
})

describe("VerseSlider's verse label", () => {
  const MERGED: ChapterPosition = {
    kind: "verse",
    verse: {
      number: 6,
      through: 8,
      lines: [{ text: "Jesus sat by the well." }],
    },
  }

  it.each<[string, ChapterPosition, string]>([
    [
      "one verse",
      LAST,
      "Verse 36. Whoever believes in the Son has eternal life.",
    ],
    ["a merged range", MERGED, "Verses 6 to 8. Jesus sat by the well."],
  ])("names %s by its numbers", async (_case, stop, label) => {
    await render(props({ live: live("JHN.4:0", stop) }))
    await settle()
    const [shown] = hosts((node) => node.props.testID === "bible-verse")
    expect(shown!.props.accessibilityLabel).toBe(label)
  })
})

describe("VerseSlider during a scrub", () => {
  type Timing = {
    duration: number
    value: Animated.Value
    finish: () => void
  }
  let timings: Timing[] = []

  beforeEach(() => {
    timings = []
    jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
      let callback: Animated.EndCallback | undefined
      timings.push({
        duration: config.duration ?? 0,
        value: value as Animated.Value,
        finish: () => callback?.({ finished: true }),
      })
      return {
        start: (cb?: Animated.EndCallback) => {
          callback = cb
        },
        stop: () => {},
        reset: () => {},
      } as unknown as Animated.CompositeAnimation
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const V5 = verse(5, "In the beginning was the Word.")
  const V6 = verse(6, "There came a man sent from God.")
  const V7 = verse(7, "He came as a witness to testify.")

  const liveText = () =>
    hosts((node) => node.props.testID === "bible-verse-line")
      .map(textOf)
      .join(" ")

  /** The opacity and translateY of the nearest animated layer above a node. */
  function layerOf(node: RenderedNode): { opacity: number; y: number } {
    let current: RenderedNode | null = node
    while (current) {
      const style: ViewStyle =
        StyleSheet.flatten(current.props.style as StyleProp<ViewStyle>) ?? {}
      const transform = style.transform as { translateY?: number }[] | undefined
      const y = transform?.find((step) => "translateY" in step)?.translateY
      if (typeof y === "number") {
        return { opacity: Number(style.opacity ?? 1), y }
      }
      current = current.parent ?? null
    }
    throw new Error("no animated layer above the node")
  }
  const liveLayer = () =>
    layerOf(hosts((node) => node.props.testID === "bible-verse")[0]!)
  const copyLayer = () => layerOf(copies()[0]!)

  async function finishLast() {
    await act(async () => timings[timings.length - 1]!.finish())
    await settle()
  }

  /** The plain view between the animated layer and the live verse. */
  function gate(): ViewStyle {
    const [node] = hosts((host) => host.props.testID === "bible-verse-gate")
    expect(node).toBeDefined()
    return StyleSheet.flatten(node!.props.style as StyleProp<ViewStyle>) ?? {}
  }
  const gateOpacity = () => Number(gate().opacity ?? 1)
  const columnOpacity = () => {
    const [column] = hosts((node) => node.props.testID === "bible-verse")
    const style = StyleSheet.flatten(
      column!.props.style as StyleProp<ViewStyle>,
    )
    return Number(style?.opacity ?? 1)
  }

  /** The event native Animated sends after it draws a frame of the change. */
  async function nativeFrame(timing: Timing, progress: number) {
    const value = timing.value as unknown as {
      __onAnimatedValueUpdateReceived: (next: number) => void
    }
    await act(async () => value.__onAnimatedValueUpdateReceived(progress))
  }

  it("fades each new verse in at the scrub pace, a few points from below", async () => {
    await render(props({ live: live("JHN.1:5", V5) }))
    await settle()

    await render(props({ live: live("JHN.1:6", V6), scrubbing: true }))
    await settle()
    expect(timings.map((timing) => timing.duration)).toEqual([
      VERSE_SCRUB_SLIDE_MS,
    ])
    expect(copyText()).toContain("the Word")
    expect(liveText()).toContain("sent from God")
    // The change starts with the old verse in place and the new one hidden.
    expect(copyLayer()).toEqual({ opacity: 1, y: 0 })
    expect(liveLayer()).toEqual({ opacity: 0, y: VERSE_SLIDE_SHIFT })

    await finishLast()
    expect(copies()).toHaveLength(0)
    expect(liveLayer()).toEqual({ opacity: 1, y: 0 })
  })

  // A reset of one shared value reached the native side a frame late, so each
  // change began with one frame where both verses were hidden. Jest cannot
  // see that frame; this pins the mechanism that removed it.
  it("starts each change on a new value, never a reset of the old one", async () => {
    const setValue = jest.spyOn(Animated.Value.prototype, "setValue")
    await render(props({ live: live("JHN.1:5", V5) }))
    await settle()
    await render(props({ live: live("JHN.1:6", V6), scrubbing: true }))
    await settle()
    expect(copyLayer()).toEqual({ opacity: 1, y: 0 })
    await finishLast()
    await render(props({ live: live("JHN.1:7", V7), scrubbing: true }))
    await settle()
    expect(copyLayer()).toEqual({ opacity: 1, y: 0 })
    expect(setValue).not.toHaveBeenCalled()
  })

  // iOS ignores React's opacity and transform on a view that native Animated
  // has driven. A verse seen again has a cached fit and showed at rest over
  // the old verse for a frame (iPhone 17 simulator, 2026-09-30).
  it("hides a verse seen again behind a gate React owns until its first native frame", async () => {
    await render(props({ live: live("JHN.1:5", V5) }))
    await settle()
    expect(gateOpacity()).toBe(1)
    await render(props({ live: live("JHN.1:6", V6), slide: FORWARD }))
    await settle()
    await nativeFrame(timings[0]!, 0.1)
    await finishLast()
    expect(gateOpacity()).toBe(1)

    // Back to verse 5: its fit is cached, so its column shows at once.
    await render(
      props({
        live: live("JHN.1:5", V5),
        slide: { id: 2, direction: "back" },
      }),
    )
    expect(liveText()).toContain("the Word")
    expect(columnOpacity()).toBe(1)
    expect(copyText()).toContain("sent from God")
    expect(gateOpacity()).toBe(0)
    // The gate is not animated, so iOS applies what React commits.
    expect(gate().transform).toBeUndefined()

    await settle()
    expect(timings).toHaveLength(2)
    expect(gateOpacity()).toBe(0)
    await nativeFrame(timings[1]!, 0.05)
    expect(gateOpacity()).toBe(1)
  })

  it("closes the gate again for a newer verse that interrupts the change", async () => {
    jest.useFakeTimers()
    await render(props({ live: live("JHN.1:5", V5) }))
    await settle()
    await render(props({ live: live("JHN.1:6", V6), scrubbing: true }))
    await settle()
    await nativeFrame(timings[0]!, 0.1)
    expect(gateOpacity()).toBe(1)
    await act(async () => {
      jest.advanceTimersByTime(VERSE_SCRUB_SLIDE_MS * 0.8)
    })

    await render(props({ live: live("JHN.1:7", V7), scrubbing: true }))
    await settle()
    expect(liveText()).toContain("witness to testify")
    expect(timings).toHaveLength(2)
    expect(gateOpacity()).toBe(0)
    await nativeFrame(timings[1]!, 0.1)
    expect(gateOpacity()).toBe(1)
  })

  it("opens the gate when a change ends, even with no frame event", async () => {
    await render(props({ live: live("JHN.1:5", V5) }))
    await settle()
    await render(props({ live: live("JHN.1:6", V6), slide: FORWARD }))
    await settle()
    expect(gateOpacity()).toBe(0)
    await finishLast()
    expect(gateOpacity()).toBe(1)
  })

  // The owner (2026-09-28): a fast scrub must not finish a verse the thumb
  // has left. The progress comes from the clock, so fake timers set it.
  it("interrupts the running change, and verse 6 leaves from where it is", async () => {
    jest.useFakeTimers()
    await render(props({ live: live("JHN.1:5", V5) }))
    await settle()
    await render(props({ live: live("JHN.1:6", V6), scrubbing: true }))
    await settle()
    // 80% through: verse 5 is gone, and verse 6 is most of the way in.
    await act(async () => {
      jest.advanceTimersByTime(VERSE_SCRUB_SLIDE_MS * 0.8)
    })
    await render(props({ live: live("JHN.1:7", V7), scrubbing: true }))
    await settle()

    expect(liveText()).toContain("witness to testify")
    expect(copyText()).toContain("sent from God")
    const leaving = copyLayer()
    expect(leaving.opacity).toBeGreaterThan(0.5)
    expect(leaving.opacity).toBeLessThan(1)
    expect(leaving.y).toBeGreaterThan(0)
    expect(leaving.y).toBeLessThan(VERSE_SLIDE_SHIFT)
    // The new change starts at once, and it is shorter: verse 6 is faint.
    expect(timings).toHaveLength(2)
    expect(timings[1]!.duration).toBeLessThan(VERSE_SCRUB_SLIDE_MS)
  })

  it("keeps the old verse fading when the thumb moves on before the new one shows", async () => {
    jest.useFakeTimers()
    await render(props({ live: live("JHN.1:5", V5) }))
    await settle()
    await render(props({ live: live("JHN.1:6", V6), scrubbing: true }))
    await settle()
    await act(async () => {
      jest.advanceTimersByTime(VERSE_SCRUB_SLIDE_MS * 0.2)
    })
    await render(props({ live: live("JHN.1:7", V7), scrubbing: true }))
    await settle()

    // Verse 6 never showed, so verse 5 is still the one leaving.
    expect(liveText()).toContain("witness to testify")
    expect(copyText()).toContain("the Word")
    expect(copyLayer().opacity).toBeLessThan(1)
    expect(copyLayer().y).toBeLessThan(0)
  })

  it("changes in place with Reduce Motion on", async () => {
    await render(props({ live: live("JHN.1:5", V5), reduceMotion: true }))
    await settle()
    await render(
      props({
        live: live("JHN.1:6", V6),
        scrubbing: true,
        reduceMotion: true,
      }),
    )
    await settle()
    expect(copies()).toHaveLength(0)
    expect(timings).toHaveLength(0)
    expect(liveText()).toContain("sent from God")
    expect(gateOpacity()).toBe(1)
  })
})

// The owner (2026-09-28): a swipe past the end of a long verse (Esther 8:9)
// played the scroll view's bounce back under the verse change, and the copy
// jumped to the verse's top. The copy now leaves from where the verse stood.
describe("VerseSlider after a long verse scrolls", () => {
  const LONG = verse(9, "Then were the king's scribes called at that time.")
  const NEXT = verse(10, "And he wrote in the name of king Ahasuerus.")
  const FORWARD_MOVE: VerseSlide = { id: 1, direction: "forward" }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  /** The live scroll view reports an offset, as a drag does. */
  async function scrollTo(y: number) {
    const [scroll] = hosts((node) => node.props.testID === "bible-verse-scroll")
    expect(scroll).toBeDefined()
    await act(async () => {
      ;(scroll!.props.onScroll as (event: unknown) => void)({
        nativeEvent: {
          contentOffset: { x: 0, y },
          contentSize: { width: COLUMN_WIDTH, height: 2000 },
          layoutMeasurement: { width: COLUMN_WIDTH, height: 576 },
        },
      })
    })
  }

  // A margin, never a transform: on the iPhone 17 Pro Max simulator the
  // renderer skipped lines laid out below the clip, and a transform does not
  // move the layout, so the copy lost its last four lines (2026-09-28).
  function copyOffset(): number {
    const [content] = hosts(
      (node) => node.props.testID === "bible-verse-outgoing-content",
    )
    expect(content).toBeDefined()
    const style = (StyleSheet.flatten(content!.props.style) ?? {}) as ViewStyle
    expect(style.transform).toBeUndefined()
    return Number(style.marginTop ?? 0)
  }

  it("leaves from the offset it stood at, past the end included", async () => {
    await render(props({ live: live("EST.8:9", LONG) }))
    await settle(2000)
    // The drag carried the verse 60 points past its end (2000 - 576).
    await scrollTo(1484)
    await render(props({ live: live("EST.8:10", NEXT), slide: FORWARD_MOVE }))
    await settle()
    expect(copies()).toHaveLength(1)
    expect(copyOffset()).toBe(-1484)
  })

  // An interrupt remounts the copy, and by then the next verse has written
  // its own offset. The copy must still find the offset of the verse it shows.
  it("keeps the offset when a newer verse interrupts the change", async () => {
    jest.useFakeTimers()
    jest.spyOn(Animated, "timing").mockImplementation(
      () =>
        ({
          start: () => {},
          stop: () => {},
          reset: () => {},
        }) as unknown as Animated.CompositeAnimation,
    )
    await render(props({ live: live("EST.8:9", LONG) }))
    await settle(2000)
    await scrollTo(1484)
    await render(props({ live: live("EST.8:10", NEXT), slide: FORWARD_MOVE }))
    await settle()
    expect(copyOffset()).toBe(-1484)

    // 20% through: 8:9 is still fading out when the viewer moves on.
    await act(async () => {
      jest.advanceTimersByTime(VERSE_SLIDE_MS * 0.2)
    })
    await render(
      props({
        live: live("EST.8:11", verse(11, "The king granted the Jews.")),
        slide: { id: 2, direction: "forward" },
      }),
    )
    await settle()
    expect(copyText()).toContain("king's scribes")
    expect(copyOffset()).toBe(-1484)
  })

  it("leaves from its top when the viewer never scrolled it", async () => {
    await render(props({ live: live("EST.8:9", LONG) }))
    await settle(2000)
    await render(props({ live: live("EST.8:10", NEXT), slide: FORWARD_MOVE }))
    await settle()
    expect(copyOffset()).toBe(0)
  })

  it("starts a verse seen again at its top, not at its old offset", async () => {
    await render(props({ live: live("EST.8:9", LONG) }))
    await settle(2000)
    await scrollTo(900)
    await render(props({ live: live("EST.8:10", NEXT), slide: FORWARD_MOVE }))
    await settle()
    // Back to 8:9: its new scroll view starts at the top.
    await render(
      props({
        live: live("EST.8:9", LONG),
        slide: { id: 2, direction: "back" },
      }),
    )
    await settle(2000)
    await render(
      props({
        live: live("EST.8:8", verse(8, "Write ye also for the Jews.")),
        slide: { id: 3, direction: "back" },
      }),
    )
    await settle()
    expect(copyText()).toContain("king's scribes")
    expect(copyOffset()).toBe(0)
  })
})
