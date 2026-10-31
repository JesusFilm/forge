/**
 * The clip's one-line description (R15). "more" shows only once the hidden copy
 * MEASURES an overflow. The toggles animate and report, and never pause.
 */

import { act, createRef } from "react"
import { LayoutAnimation, type GestureResponderEvent } from "react-native"

const mockReduceMotion = jest.fn(() => false)
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockReduceMotion(),
}))

import {
  ClipDescription,
  DESCRIPTION_TOGGLE_ANIMATION,
} from "../ClipDescription"
import { ExplorePager, type ExplorePagerHandle } from "../ExplorePager"
import {
  TestRenderer,
  hasText,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { tapActionName } from "../../../test-utils/uiLocaleFixture"

const LONG =
  "Jesus teaches his followers to love their enemies, to pray for those who hurt them, and to trust God for what they need each day."
const SHORT = "A short line."

const mounted: TestInstance[] = []

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
})

function render(
  description: string | null,
  handlers = { onExpand: jest.fn(), onCollapse: jest.fn() },
) {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      <ClipDescription description={description} {...handlers} />,
    )
  })
  mounted.push(renderer)
  return { renderer, ...handlers }
}

function measuringCopy(renderer: TestInstance): RenderedNode {
  const nodes = renderer.root.findAll(
    (n) => typeof n.props.onTextLayout === "function",
  )
  expect(nodes.length).toBeGreaterThan(0)
  return nodes[0]
}

function measure(renderer: TestInstance, lineCount: number) {
  const lines = Array.from({ length: lineCount }, (_, i) => ({ text: `${i}` }))
  act(() => {
    ;(measuringCopy(renderer).props.onTextLayout as (e: unknown) => void)({
      nativeEvent: { lines },
    })
  })
}

/** The visible copy: it carries the text, and never the layout listener. */
function visibleCopy(renderer: TestInstance, text: string): RenderedNode {
  const nodes = renderer.root.findAll(
    (n) =>
      n.props.children === text && typeof n.props.onTextLayout !== "function",
  )
  expect(nodes.length).toBeGreaterThan(0)
  return nodes[0]
}

function toggle(renderer: TestInstance, label: string): RenderedNode[] {
  return renderer.root.findAll(
    (n) =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === "function",
  )
}

function press(renderer: TestInstance, label: string) {
  const [node] = toggle(renderer, label)
  expect(node).toBeDefined()
  act(() => {
    node.props.onPress?.()
  })
}

/** The touch target around the description text, by its test id. */
function textTap(renderer: TestInstance, testID: string): RenderedNode[] {
  return renderer.root.findAll(
    (n) => n.props.testID === testID && typeof n.props.onPress === "function",
  )
}

function tapText(renderer: TestInstance, testID: string) {
  const [node] = textTap(renderer, testID)
  expect(node).toBeDefined()
  expect(node.props.disabled).not.toBe(true)
  act(() => {
    node.props.onPress?.()
  })
}

describe("ClipDescription", () => {
  it("shows the description on one line", () => {
    const { renderer } = render(LONG)
    expect(visibleCopy(renderer, LONG).props.numberOfLines).toBe(1)
  })

  it("measures an unconstrained copy that is hidden from touch and screen readers", () => {
    const { renderer } = render(LONG)
    const copy = measuringCopy(renderer)
    expect(copy.props.numberOfLines).toBeUndefined()
    const hidden = renderer.root.findAll(
      (n) =>
        n.props.pointerEvents === "none" &&
        n.props.accessibilityElementsHidden === true &&
        n.props.importantForAccessibility === "no-hide-descendants",
    )
    expect(hidden.length).toBeGreaterThan(0)
  })

  it("shows no 'more' before the measure, and none for a short description", () => {
    const { renderer } = render(SHORT)
    expect(toggle(renderer, "Show the full description")).toHaveLength(0)
    measure(renderer, 1)
    expect(toggle(renderer, "Show the full description")).toHaveLength(0)
  })

  it("shows 'more' at the end of the first line when the text overflows", () => {
    const { renderer } = render(LONG)
    measure(renderer, 3)
    expect(toggle(renderer, "Show the full description")).not.toHaveLength(0)
    expect(hasText(renderer, "more")).toBe(true)

    // "At the end of the line": the toggle is the next sibling of the one-line
    // copy's tap target in a row, not a control on a line of its own.
    const json = renderer.toJSON() as JsonNode
    const row = findJson(json, (n) =>
      (n.children ?? []).some(
        (c) =>
          typeof c !== "string" && c.props.testID === "clip-description-text",
      ),
    )
    expect(row).not.toBeNull()
    expect(flatStyle(row?.props.style).flexDirection).toBe("row")
    const kids = (row?.children ?? []).filter(
      (c): c is JsonNode => typeof c !== "string",
    )
    expect(kids).toHaveLength(2)
    const [line] = (kids[0].children ?? []).filter(
      (c): c is JsonNode => typeof c !== "string",
    )
    expect(line.props.numberOfLines).toBe(1)
    expect(kids[1].props.accessibilityLabel).toBe("Show the full description")
  })

  it("animates the open and the close, and skips the animation under reduced motion", () => {
    const configureNext = jest
      .spyOn(LayoutAnimation, "configureNext")
      .mockImplementation(() => {})
    try {
      const { renderer } = render(LONG)
      measure(renderer, 3)
      press(renderer, "Show the full description")
      expect(configureNext).toHaveBeenCalledTimes(1)
      expect(configureNext).toHaveBeenLastCalledWith(
        DESCRIPTION_TOGGLE_ANIMATION,
      )
      press(renderer, "Show less of the description")
      expect(configureNext).toHaveBeenCalledTimes(2)

      mockReduceMotion.mockReturnValue(true)
      const still = render(LONG)
      measure(still.renderer, 3)
      press(still.renderer, "Show the full description")
      press(still.renderer, "Show less of the description")
      expect(configureNext).toHaveBeenCalledTimes(2)
    } finally {
      mockReduceMotion.mockReturnValue(false)
      configureNext.mockRestore()
    }
  })

  it("expands on 'more' and collapses on 'less', and reports each", () => {
    const { renderer, onExpand, onCollapse } = render(LONG)
    measure(renderer, 3)

    press(renderer, "Show the full description")
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(onCollapse).not.toHaveBeenCalled()
    expect(visibleCopy(renderer, LONG).props.numberOfLines).toBeUndefined()
    expect(toggle(renderer, "Show the full description")).toHaveLength(0)

    press(renderer, "Show less of the description")
    expect(onCollapse).toHaveBeenCalledTimes(1)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(visibleCopy(renderer, LONG).props.numberOfLines).toBe(1)
  })

  // The owner (2026-10-15): a tap on the text works as "more" and "less".
  it("expands on a tap on the cut text and collapses on a tap on the open text", () => {
    const { renderer, onExpand, onCollapse } = render(LONG)
    measure(renderer, 3)

    tapText(renderer, "clip-description-text")
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(visibleCopy(renderer, LONG).props.numberOfLines).toBeUndefined()
    expect(textTap(renderer, "clip-description-text")).toHaveLength(0)

    tapText(renderer, "clip-description-open-text")
    expect(onCollapse).toHaveBeenCalledTimes(1)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(visibleCopy(renderer, LONG).props.numberOfLines).toBe(1)
  })

  it("animates a text tap as it animates 'more'", () => {
    const configure = jest.spyOn(LayoutAnimation, "configureNext")
    const { renderer } = render(LONG)
    measure(renderer, 3)
    configure.mockClear()

    tapText(renderer, "clip-description-text")
    expect(configure).toHaveBeenCalledWith(DESCRIPTION_TOGGLE_ANIMATION)
    configure.mockRestore()
  })

  it("keeps the tap on the text inert until the text measures as cut", () => {
    const { renderer } = render(SHORT)
    const [beforeMeasure] = textTap(renderer, "clip-description-text")
    expect(beforeMeasure.props.disabled).toBe(true)

    measure(renderer, 1)
    const [fits] = textTap(renderer, "clip-description-text")
    expect(fits.props.disabled).toBe(true)

    act(() => {
      renderer.update(
        <ClipDescription
          description={LONG}
          onExpand={jest.fn()}
          onCollapse={jest.fn()}
        />,
      )
    })
    measure(renderer, 3)
    const [cut] = textTap(renderer, "clip-description-text")
    expect(cut.props.disabled).toBe(false)
  })

  it("leaves 'more' and 'less' as the screen reader's controls, and the text as text", () => {
    const { renderer } = render(LONG)
    measure(renderer, 3)
    const [cut] = textTap(renderer, "clip-description-text")
    expect(cut.props).toMatchObject({ accessible: false, focusable: false })
    expect(cut.props.accessibilityRole).toBeUndefined()

    tapText(renderer, "clip-description-text")
    const [open] = textTap(renderer, "clip-description-open-text")
    expect(open.props).toMatchObject({ accessible: false, focusable: false })
    expect(toggle(renderer, "Show less of the description")).toHaveLength(1)
  })

  it("re-measures a new description, and a reset raises no resume", () => {
    // The reducer clears the pause on a swipe. A collapse event here would
    // arrive after that and act on the next clip.
    const handlers = { onExpand: jest.fn(), onCollapse: jest.fn() }
    const { renderer } = render(LONG, handlers)
    measure(renderer, 3)
    press(renderer, "Show the full description")

    act(() => {
      renderer.update(<ClipDescription description={SHORT} {...handlers} />)
    })
    expect(toggle(renderer, "Show the full description")).toHaveLength(0)
    expect(toggle(renderer, "Show less of the description")).toHaveLength(0)
    expect(visibleCopy(renderer, SHORT).props.numberOfLines).toBe(1)
    expect(handlers.onCollapse).not.toHaveBeenCalled()
  })

  it("renders nothing for a missing or empty description", () => {
    expect(render(null).renderer.toJSON()).toBeNull()
    expect(render("").renderer.toJSON()).toBeNull()
  })

  // KTD15: the labels come from the catalog, so the RUM names are fixed.
  it("gives each toggle a tap name that no language changes", () => {
    const { renderer } = render(LONG)
    measure(renderer, 3)
    const [more] = toggle(renderer, "Show the full description")
    expect(tapActionName(more)).toBe("explore-description-more")

    press(renderer, "Show the full description")
    const [less] = toggle(renderer, "Show less of the description")
    expect(tapActionName(less)).toBe("explore-description-less")
  })

  it("names the text taps apart from 'more' and 'less'", () => {
    const { renderer } = render(LONG)
    measure(renderer, 3)
    const [cut] = textTap(renderer, "clip-description-text")
    expect(tapActionName(cut)).toBe("explore-description-text-more")

    tapText(renderer, "clip-description-text")
    const [open] = textTap(renderer, "clip-description-open-text")
    expect(tapActionName(open)).toBe("explore-description-text-less")
  })
})

// The owner (2026-10-01): a drag on an open description that scrolls moved
// the pager to the next clip. A finger on the text now holds the pager.
describe("a finger on the open description", () => {
  type PagerPan = {
    onStartShouldSetResponderCapture: (e: GestureResponderEvent) => boolean
    onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => boolean
    onMoveShouldSetResponder: (e: GestureResponderEvent) => boolean
  }

  let clock = 1000
  /** One finger at (0, y) from (0, 0), as PanResponder reads it. */
  function touch(y: number): GestureResponderEvent {
    clock += 16
    return {
      nativeEvent: { touches: [{}], changedTouches: [], pageX: 0, pageY: y },
      touchHistory: {
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: clock,
        touchBank: [
          {
            touchActive: true,
            startPageX: 0,
            startPageY: 0,
            startTimeStamp: clock - 16,
            currentPageX: 0,
            currentPageY: y,
            currentTimeStamp: clock,
            previousPageX: 0,
            previousPageY: 0,
            previousTimeStamp: clock - 16,
          },
        ],
      },
    } as unknown as GestureResponderEvent
  }

  /** The real pager, with the description on its current page. */
  function renderInPager(
    description: string,
    handle = createRef<ExplorePagerHandle>(),
  ): TestInstance {
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(
        <ExplorePager
          ref={handle}
          canSwipeNext
          canSwipePrevious
          onMove={() => {}}
          onRest={() => {}}
          onGestureLatchChange={() => {}}
          renderSlot={(slot) =>
            slot.role === "current" ? (
              <ClipDescription
                description={description}
                onExpand={() => {}}
                onCollapse={() => {}}
              />
            ) : null
          }
        />,
      )
    })
    mounted.push(renderer)
    return renderer
  }

  /** Whether the pager takes a new 40 pt vertical drag. */
  function pagerClaims(renderer: TestInstance): boolean {
    const [root] = renderer.root.findAll(
      (n) =>
        typeof n.type === "string" &&
        typeof n.props.onMoveShouldSetResponder === "function",
    )
    const pan = root.props as unknown as PagerPan
    pan.onStartShouldSetResponderCapture(touch(0))
    const move = touch(-40)
    pan.onMoveShouldSetResponderCapture(move)
    return pan.onMoveShouldSetResponder(move)
  }

  function scrollBox(renderer: TestInstance): RenderedNode {
    const [node] = renderer.root.findAll(
      (n) =>
        n.props.nestedScrollEnabled === true &&
        typeof n.props.onContentSizeChange === "function",
    )
    expect(node).toBeDefined()
    return node
  }

  function open(renderer: TestInstance, viewport: number, content: number) {
    measure(renderer, 3)
    press(renderer, "Show the full description")
    const box = scrollBox(renderer)
    act(() => {
      ;(box.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: viewport } },
      })
      ;(box.props.onContentSizeChange as (w: number, h: number) => void)(
        300,
        content,
      )
    })
  }

  /** A touch event on the scroll view, with the fingers still down after it. */
  /** Finger ids: the fingers this event changed, every finger still down on
   *  the surface after it, and (iOS only) the fingers on the event's view. */
  type Fingers = { changed: string[]; down: string[]; target?: string[] }
  const ONE_DOWN: Fingers = { changed: ["1"], down: ["1"], target: ["1"] }
  const ONE_UP: Fingers = { changed: ["1"], down: [], target: ["1"] }

  function fire(
    renderer: TestInstance,
    name: "onTouchStart" | "onTouchEnd" | "onTouchCancel",
    fingers: Fingers = name === "onTouchStart" ? ONE_DOWN : ONE_UP,
  ) {
    const handler = scrollBox(renderer).props[name] as (e: unknown) => void
    const touch = (identifier: string) => ({ identifier })
    act(() => {
      handler({
        nativeEvent: {
          touches: fingers.down.map(touch),
          changedTouches: fingers.changed.map(touch),
          ...(fingers.target && { targetTouches: fingers.target.map(touch) }),
        },
      })
    })
  }

  // Touch events, not the responder: while the text coasts, the scroll view
  // takes the touch start before any child. Only a device shows that case.
  it("holds the pager while a finger is on text that scrolls", () => {
    const renderer = renderInPager(LONG)
    expect(pagerClaims(renderer)).toBe(true)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart")
    expect(pagerClaims(renderer)).toBe(false)
    fire(renderer, "onTouchEnd")
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("keeps the hold while a second finger on the text stays down", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart")
    fire(renderer, "onTouchStart", {
      changed: ["2"],
      down: ["1", "2"],
      target: ["1", "2"],
    })
    fire(renderer, "onTouchEnd", {
      changed: ["1"],
      down: ["2"],
      target: ["1", "2"],
    })
    expect(pagerClaims(renderer)).toBe(false)
    fire(renderer, "onTouchEnd", { changed: ["2"], down: [], target: ["2"] })
    expect(pagerClaims(renderer)).toBe(true)
  })

  // Code review (2026-10-01): iOS sends a finger's events only to the view it
  // started on, so the surface's `touches` never empties for this view.
  it("lets go when its own finger lifts, while a finger elsewhere stays down", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart")
    // Finger 2 lands on the video; that start never reaches this view.
    fire(renderer, "onTouchEnd", { changed: ["1"], down: ["2"], target: ["1"] })
    expect(pagerClaims(renderer)).toBe(true)
  })

  // iOS names every finger that changed in the batch, on any view.
  it("takes only its own fingers from a start that changed several", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart", {
      changed: ["1", "2"],
      down: ["1", "2"],
      target: ["1"],
    })
    expect(pagerClaims(renderer)).toBe(false)
    fire(renderer, "onTouchEnd", { changed: ["1"], down: ["2"], target: ["1"] })
    expect(pagerClaims(renderer)).toBe(true)
  })

  // Android sends no `targetTouches`: every finger of a gesture goes to the
  // view its first finger started on.
  it("counts every finger a gesture sends here, with no targetTouches", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart", { changed: ["1"], down: ["1"] })
    fire(renderer, "onTouchStart", { changed: ["2"], down: ["1", "2"] })
    fire(renderer, "onTouchEnd", { changed: ["1"], down: ["2"] })
    expect(pagerClaims(renderer)).toBe(false)
    fire(renderer, "onTouchEnd", { changed: ["2"], down: [] })
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("lets go on a cancelled touch", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart")
    fire(renderer, "onTouchCancel")
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("lets go when 'less' closes the text under the finger", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart")
    press(renderer, "Show less of the description")
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("leaves the drag to the pager while the open text fits", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 180, 180)

    fire(renderer, "onTouchStart")
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("leaves the drag to the pager before the scroll view measures", () => {
    const renderer = renderInPager(LONG)
    measure(renderer, 3)
    press(renderer, "Show the full description")

    fire(renderer, "onTouchStart")
    expect(pagerClaims(renderer)).toBe(true)
  })

  // The owner (2026-10-01): the clip loops, so the reader keeps the text.
  it("makes a clip end wait while the text is open, whatever its length", () => {
    const handle = createRef<ExplorePagerHandle>()
    const renderer = renderInPager(LONG, handle)
    open(renderer, 180, 180)

    let moved = true
    act(() => {
      moved = handle.current!.requestMove("next")
    })
    expect(moved).toBe(false)
    press(renderer, "Show less of the description")
    act(() => {
      moved = handle.current!.requestMove("next")
    })
    expect(moved).toBe(true)
  })

  it("holds nothing, and does not throw, with no pager above it", () => {
    const { renderer } = render(LONG)
    open(renderer, 200, 480)
    fire(renderer, "onTouchStart")
    fire(renderer, "onTouchEnd")
    expect(toggle(renderer, "Show less of the description")).toHaveLength(1)
  })
})

type JsonNode = {
  type: string
  props: Record<string, unknown> & { style?: unknown }
  children: (JsonNode | string)[] | null
}

function findJson(
  node: JsonNode | null,
  predicate: (n: JsonNode) => boolean,
): JsonNode | null {
  if (node == null) return null
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    if (typeof child === "string") continue
    const hit = findJson(child, predicate)
    if (hit) return hit
  }
  return null
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flatStyle))
  }
  return style != null && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {}
}
