/**
 * The clip's one-line description (R15). "more" shows only once the hidden copy
 * MEASURES an overflow. The toggles animate and report, and never pause.
 */

import { act } from "react"
import { LayoutAnimation } from "react-native"

const mockReduceMotion = jest.fn(() => false)
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockReduceMotion(),
}))

import {
  ClipDescription,
  DESCRIPTION_TOGGLE_ANIMATION,
} from "../ClipDescription"
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
