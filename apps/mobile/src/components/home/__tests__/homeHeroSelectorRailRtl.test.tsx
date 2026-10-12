/**
 * The hero selector rail in a right-to-left layout (feat-694 U5). The list
 * counts an offset from its content's right edge, so centering waits for that
 * width. The jest ScrollView fires no layout event, so the suite drives both.
 */
jest.mock("expo-image", () => ({ Image: () => null }))

import { act, type ReactElement } from "react"
import { Dimensions, I18nManager, ScrollView } from "react-native"

import { HomeHeroSelectorRail } from "../HomeHeroSelectorRail"
import type { WatchHomeVideoSlide } from "../../../lib/watchHome/carouselSequence"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const VIEWPORT = Dimensions.get("window").width
// The rail's own layout: 0.3-width cards, 10 between them, 16 at each end.
const CARD = Math.round(VIEWPORT * 0.3)
const GAP = 10
const PAD = 16
const contentWidth = (count: number) =>
  2 * PAD + count * CARD + (count - 1) * GAP
/** How far the list scrolls from its start edge to center card `index`. */
const centeredStart = (index: number) =>
  Math.max(0, PAD + (CARD + GAP) * index - (VIEWPORT - CARD) / 2)

const RTL_WARNING =
  "scrollToOffset may not be called in RTL before content is laid out"

// The jest ScrollView mock puts its methods on the prototype.
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
  await act(async () => {
    mounted?.unmount()
  })
  mounted = null
  jest.restoreAllMocks()
  setListIsRtl(JEST_IS_RTL)
})

function rail(count: number, activeIndex: number): ReactElement {
  return (
    <HomeHeroSelectorRail
      slides={slides(count)}
      activeIndex={activeIndex}
      onSelectSlide={() => {}}
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

async function update(renderer: TestInstance, element: ReactElement) {
  await act(async () => {
    renderer.update(element)
  })
}

/** The list's own layout events, in the order the device sends them. */
async function layOut(renderer: TestInstance, count: number) {
  const [list] = renderer.root.findAll(
    (node: RenderedNode) => node.type === ScrollView,
  )
  const props = list.props as {
    onLayout: (e: unknown) => void
    onContentSizeChange: (width: number, height: number) => void
  }
  await act(async () => {
    props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: VIEWPORT, height: 160 } },
    })
    props.onContentSizeChange(contentWidth(count), 160)
  })
}

/** The scroll x from the left edge that shows `start` from the right edge. */
const fromLeft = (count: number, start: number) =>
  contentWidth(count) - VIEWPORT - start

const rtlWarnings = () =>
  warn.mock.calls.filter(([message]) => message === RTL_WARNING)

describe("HomeHeroSelectorRail scroll in a right-to-left layout", () => {
  it("centers the active card only once the content is laid out", async () => {
    layoutIs(true)
    const renderer = await render(rail(6, 0))

    expect(rtlWarnings()).toEqual([])
    expect(scrollTo).not.toHaveBeenCalled()

    await layOut(renderer, 6)
    expect(scrollTo.mock.calls).toEqual([
      [{ animated: false, x: fromLeft(6, 0) }],
    ])
  })

  it("centers a new active card at once after layout", async () => {
    layoutIs(true)
    const renderer = await render(rail(6, 0))
    await layOut(renderer, 6)
    scrollTo.mockClear()

    await update(renderer, rail(6, 3))
    expect(scrollTo.mock.calls).toEqual([
      [{ animated: true, x: fromLeft(6, centeredStart(3)) }],
    ])
  })

  it("waits for the new content width after a queue rebuild", async () => {
    layoutIs(true)
    const renderer = await render(rail(6, 0))
    await layOut(renderer, 6)
    scrollTo.mockClear()

    await update(renderer, rail(8, 0))
    // A scroll now would use the six-card width and miss the first card.
    expect(scrollTo).not.toHaveBeenCalled()

    await layOut(renderer, 8)
    expect(scrollTo.mock.calls).toEqual([
      [{ animated: false, x: fromLeft(8, 0) }],
    ])
    expect(rtlWarnings()).toEqual([])
  })
})

describe("HomeHeroSelectorRail scroll in a left-to-right layout", () => {
  it("keeps today's centering scroll", async () => {
    layoutIs(false)
    const renderer = await render(rail(6, 0))
    await layOut(renderer, 6)
    scrollTo.mockClear()

    await update(renderer, rail(6, 3))
    expect(scrollTo.mock.calls).toEqual([
      [{ animated: true, x: centeredStart(3) }],
    ])
  })
})
