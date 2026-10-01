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
import { EXPLORE_COPY } from "../../../lib/explore/copy"
import {
  TestRenderer,
  hasText,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

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
    expect(toggle(renderer, EXPLORE_COPY.descriptionMoreLabel)).toHaveLength(0)
    measure(renderer, 1)
    expect(toggle(renderer, EXPLORE_COPY.descriptionMoreLabel)).toHaveLength(0)
  })

  it("shows 'more' at the end of the first line when the text overflows", () => {
    const { renderer } = render(LONG)
    measure(renderer, 3)
    expect(
      toggle(renderer, EXPLORE_COPY.descriptionMoreLabel),
    ).not.toHaveLength(0)
    expect(hasText(renderer, EXPLORE_COPY.descriptionMore)).toBe(true)

    // "At the end of the line": the toggle is the one-line copy's next sibling
    // in a row, not a control on a line of its own.
    const json = renderer.toJSON() as JsonNode
    const row = findJson(json, (n) =>
      (n.children ?? []).some(
        (c) => typeof c !== "string" && c.props.numberOfLines === 1,
      ),
    )
    expect(row).not.toBeNull()
    expect(flatStyle(row?.props.style).flexDirection).toBe("row")
    const kids = (row?.children ?? []).filter(
      (c): c is JsonNode => typeof c !== "string",
    )
    expect(kids).toHaveLength(2)
    expect(kids[0].props.numberOfLines).toBe(1)
    expect(kids[1].props.accessibilityLabel).toBe(
      EXPLORE_COPY.descriptionMoreLabel,
    )
  })

  it("animates the open and the close, and skips the animation under reduced motion", () => {
    const configureNext = jest
      .spyOn(LayoutAnimation, "configureNext")
      .mockImplementation(() => {})
    try {
      const { renderer } = render(LONG)
      measure(renderer, 3)
      press(renderer, EXPLORE_COPY.descriptionMoreLabel)
      expect(configureNext).toHaveBeenCalledTimes(1)
      expect(configureNext).toHaveBeenLastCalledWith(
        DESCRIPTION_TOGGLE_ANIMATION,
      )
      press(renderer, EXPLORE_COPY.descriptionLessLabel)
      expect(configureNext).toHaveBeenCalledTimes(2)

      mockReduceMotion.mockReturnValue(true)
      const still = render(LONG)
      measure(still.renderer, 3)
      press(still.renderer, EXPLORE_COPY.descriptionMoreLabel)
      press(still.renderer, EXPLORE_COPY.descriptionLessLabel)
      expect(configureNext).toHaveBeenCalledTimes(2)
    } finally {
      mockReduceMotion.mockReturnValue(false)
      configureNext.mockRestore()
    }
  })

  it("expands on 'more' and collapses on 'less', and reports each", () => {
    const { renderer, onExpand, onCollapse } = render(LONG)
    measure(renderer, 3)

    press(renderer, EXPLORE_COPY.descriptionMoreLabel)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(onCollapse).not.toHaveBeenCalled()
    expect(visibleCopy(renderer, LONG).props.numberOfLines).toBeUndefined()
    expect(toggle(renderer, EXPLORE_COPY.descriptionMoreLabel)).toHaveLength(0)

    press(renderer, EXPLORE_COPY.descriptionLessLabel)
    expect(onCollapse).toHaveBeenCalledTimes(1)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(visibleCopy(renderer, LONG).props.numberOfLines).toBe(1)
  })

  it("re-measures a new description, and a reset raises no resume", () => {
    // The reducer clears the pause on a swipe. A collapse event here would
    // arrive after that and act on the next clip.
    const handlers = { onExpand: jest.fn(), onCollapse: jest.fn() }
    const { renderer } = render(LONG, handlers)
    measure(renderer, 3)
    press(renderer, EXPLORE_COPY.descriptionMoreLabel)

    act(() => {
      renderer.update(<ClipDescription description={SHORT} {...handlers} />)
    })
    expect(toggle(renderer, EXPLORE_COPY.descriptionMoreLabel)).toHaveLength(0)
    expect(toggle(renderer, EXPLORE_COPY.descriptionLessLabel)).toHaveLength(0)
    expect(visibleCopy(renderer, SHORT).props.numberOfLines).toBe(1)
    expect(handlers.onCollapse).not.toHaveBeenCalled()
  })

  it("renders nothing for a missing or empty description", () => {
    expect(render(null).renderer.toJSON()).toBeNull()
    expect(render("").renderer.toJSON()).toBeNull()
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
    press(renderer, EXPLORE_COPY.descriptionMoreLabel)
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
  function fire(
    renderer: TestInstance,
    name: "onTouchStart" | "onTouchEnd" | "onTouchCancel",
    fingersDown: number,
  ) {
    const handler = scrollBox(renderer).props[name] as (e: unknown) => void
    const touches = Array.from({ length: fingersDown }, () => ({}))
    act(() => {
      handler({ nativeEvent: { touches, changedTouches: [{}] } })
    })
  }

  // Touch events, not the responder: while the text coasts, the scroll view
  // takes the touch start before any child. Only a device shows that case.
  it("holds the pager while a finger is on text that scrolls", () => {
    const renderer = renderInPager(LONG)
    expect(pagerClaims(renderer)).toBe(true)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart", 1)
    expect(pagerClaims(renderer)).toBe(false)
    fire(renderer, "onTouchEnd", 0)
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("keeps the hold while another finger stays down", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart", 1)
    fire(renderer, "onTouchStart", 2)
    fire(renderer, "onTouchEnd", 1)
    expect(pagerClaims(renderer)).toBe(false)
    // One hold per touch run: the last finger up releases it.
    fire(renderer, "onTouchEnd", 0)
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("lets go on a cancelled touch", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart", 1)
    fire(renderer, "onTouchCancel", 0)
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("lets go when 'less' closes the text under the finger", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 200, 480)

    fire(renderer, "onTouchStart", 1)
    press(renderer, EXPLORE_COPY.descriptionLessLabel)
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("leaves the drag to the pager while the open text fits", () => {
    const renderer = renderInPager(LONG)
    open(renderer, 180, 180)

    fire(renderer, "onTouchStart", 1)
    expect(pagerClaims(renderer)).toBe(true)
  })

  it("leaves the drag to the pager before the scroll view measures", () => {
    const renderer = renderInPager(LONG)
    measure(renderer, 3)
    press(renderer, EXPLORE_COPY.descriptionMoreLabel)

    fire(renderer, "onTouchStart", 1)
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
    press(renderer, EXPLORE_COPY.descriptionLessLabel)
    act(() => {
      moved = handle.current!.requestMove("next")
    })
    expect(moved).toBe(true)
  })

  it("holds nothing, and does not throw, with no pager above it", () => {
    const { renderer } = render(LONG)
    open(renderer, 200, 480)
    fire(renderer, "onTouchStart", 1)
    fire(renderer, "onTouchEnd", 0)
    expect(toggle(renderer, EXPLORE_COPY.descriptionLessLabel)).toHaveLength(1)
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
