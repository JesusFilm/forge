/**
 * The hero pager in a right-to-left layout (feat-692 U5). The list counts an
 * offset from its content's right edge, so a scroll waits for the slides' width.
 * The jest ScrollView fires no layout event, so the suite drives both by hand.
 */

// Visual leaves only — none take part in the scroll offsets.
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))
jest.mock("../HomePagerDots", () => ({ HomePagerDots: () => null }))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock("expo", () => ({
  useEvent: (_player: unknown, _event: string, initial: unknown) => initial,
}))
// A player that never loads: the hero stays on its poster, which keeps the
// pager's playback rules out of the scroll calls under test.
jest.mock("expo-video", () => {
  const player = {
    muted: true,
    loop: false,
    playing: false,
    currentTime: 0,
    play: () => {},
    pause: () => {},
    replay: () => {},
    replaceAsync: () => new Promise<void>(() => {}),
    addListener: () => ({ remove: () => {} }),
  }
  return {
    VideoView: () => null,
    useVideoPlayer: (_source: unknown, setup?: (p: typeof player) => void) => {
      setup?.(player)
      return player
    },
  }
})
jest.mock("../../../hooks/useHeroStream", () => ({
  prefetchHeroStream: jest.fn(),
  useHeroStream: () => ({ streamUrl: null, resolving: true, failed: false }),
}))

import { act, createRef, type ReactElement, type Ref } from "react"
import { Dimensions, I18nManager, ScrollView } from "react-native"

import { HomeHeroPager, type HomeHeroPagerHandle } from "../HomeHeroPager"
import type { WatchHomeVideoSlide } from "../../../lib/watchHome/carouselSequence"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

jest.setTimeout(20_000)

const PAGE = Dimensions.get("window").width
const HEIGHT = 480
const RTL_WARNING =
  "scrollToOffset may not be called in RTL before content is laid out"

// The jest ScrollView mock puts its methods on the prototype, so every list
// shares this one scrollTo.
const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock })
  .scrollTo

function videoSlide(n: number): WatchHomeVideoSlide {
  return {
    kind: "video",
    id: `v${n}`,
    title: `Title ${n}`,
    description: null,
    label: "featureFilm",
    slug: `film-${n}`,
    parentSlug: null,
    posterUrl: null,
    thumbnailUrl: null,
    imageAlt: `Alt ${n}`,
    playbackId: null,
    durationSeconds: 120,
  }
}

const slides = (count: number) =>
  Array.from({ length: count }, (_, i) => videoSlide(i + 1))

const JEST_IS_RTL = I18nManager.isRTL

function setListIsRtl(value: boolean) {
  Object.defineProperty(I18nManager, "isRTL", {
    value,
    configurable: true,
    writable: true,
  })
}

/** Both readers of the direction: the list reads `isRTL`, the app the constants. */
function layoutIs(isRTL: boolean) {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({
    ...I18nManager.getConstants(),
    isRTL,
  })
  setListIsRtl(isRTL)
}

let warn: jest.SpyInstance
let mounted: TestInstance | null = null
beforeEach(() => {
  jest.clearAllMocks()
  warn = jest.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(async () => {
  // Unmount inside act, so the pager's dwell timers stop with the test.
  await act(async () => {
    mounted?.unmount()
  })
  mounted = null
  jest.restoreAllMocks()
  setListIsRtl(JEST_IS_RTL)
})

function pager(
  queue: readonly WatchHomeVideoSlide[],
  ref?: Ref<HomeHeroPagerHandle>,
): ReactElement {
  return (
    <HomeHeroPager
      slides={queue}
      heroHeight={HEIGHT}
      paused={false}
      muted
      ref={ref}
    />
  )
}

async function render(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  mounted = renderer
  return renderer
}

/** The list's own layout events, in the order the device sends them. */
async function layOut(renderer: TestInstance, slideCount: number) {
  const [list] = renderer.root.findAll(
    (node: RenderedNode) => node.type === ScrollView,
  )
  const props = list.props as {
    onLayout: (e: unknown) => void
    onContentSizeChange: (width: number, height: number) => void
  }
  await act(async () => {
    props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: PAGE, height: HEIGHT } },
    })
    props.onContentSizeChange(slideCount * PAGE, HEIGHT)
  })
}

const rtlWarnings = () =>
  warn.mock.calls.filter(([message]) => message === RTL_WARNING)

describe("HomeHeroPager scroll offsets in a right-to-left layout", () => {
  it("scrolls to the first hero only once the content is laid out", async () => {
    layoutIs(true)
    const renderer = await render(pager(slides(2)))

    expect(rtlWarnings()).toEqual([])
    expect(scrollTo).not.toHaveBeenCalled()

    await layOut(renderer, 2)
    // From the left edge: the first hero is the right-most page.
    expect(scrollTo.mock.calls).toEqual([[{ animated: false, x: PAGE }]])
  })

  it("scrolls to the right hero after a swipe once laid out", async () => {
    layoutIs(true)
    const ref = createRef<HomeHeroPagerHandle>()
    const renderer = await render(pager(slides(3), ref))
    await layOut(renderer, 3)
    scrollTo.mockClear()

    await act(async () => {
      ref.current?.swipeToSlide(2)
    })
    // The third hero is the left-most page.
    expect(scrollTo.mock.calls).toEqual([[{ animated: true, x: 0 }]])
  })

  it("waits for the new content width after a queue rebuild", async () => {
    layoutIs(true)
    const renderer = await render(pager(slides(2)))
    await layOut(renderer, 2)
    scrollTo.mockClear()

    const rebuilt = slides(3)
    await act(async () => {
      renderer.update(pager(rebuilt))
    })
    // A scroll now would use the two-hero width and land on the second hero.
    expect(scrollTo).not.toHaveBeenCalled()

    await layOut(renderer, 3)
    expect(scrollTo.mock.calls).toEqual([[{ animated: false, x: 2 * PAGE }]])
    expect(rtlWarnings()).toEqual([])
  })
})

describe("HomeHeroPager scroll offsets in a left-to-right layout", () => {
  it("keeps today's scrolls", async () => {
    layoutIs(false)
    const ref = createRef<HomeHeroPagerHandle>()
    const renderer = await render(pager(slides(3), ref))
    expect(scrollTo.mock.calls).toEqual([[{ animated: true, x: 0 }]])

    await layOut(renderer, 3)
    await act(async () => {
      ref.current?.swipeToSlide(2)
    })
    expect(scrollTo.mock.calls).toEqual([
      [{ animated: true, x: 0 }],
      [{ animated: true, x: 2 * PAGE }],
    ])
  })
})
