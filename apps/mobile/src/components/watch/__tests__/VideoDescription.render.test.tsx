/**
 * The watch page's three-line description, rendered on the shared overflow
 * hook. `videoDescription.test.ts` pins the source shape; this pins behaviour.
 */

import { act } from "react"

import { VideoDescription } from "../VideoDescription"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const LONG = "A description long enough to need the toggle. ".repeat(6)
const OTHER = "A different description for the next video."

const mounted: TestInstance[] = []

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
})

function render(description: string | null): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      <VideoDescription description={description} />,
    )
  })
  mounted.push(renderer)
  return renderer
}

function measure(renderer: TestInstance, lineCount: number) {
  const [copy] = renderer.root.findAll(
    (n) => typeof n.props.onTextLayout === "function",
  )
  expect(copy).toBeDefined()
  const lines = Array.from({ length: lineCount }, (_, i) => ({ text: `${i}` }))
  act(() => {
    ;(copy.props.onTextLayout as (e: unknown) => void)({
      nativeEvent: { lines },
    })
  })
}

function toggles(renderer: TestInstance, label: string): RenderedNode[] {
  return renderer.root.findAll(
    (n) =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === "function",
  )
}

function visibleLines(renderer: TestInstance, text: string): unknown {
  const [node] = renderer.root.findAll(
    (n) =>
      n.props.children === text && typeof n.props.onTextLayout !== "function",
  )
  return node?.props.numberOfLines
}

describe("VideoDescription on the shared overflow hook", () => {
  it("shows no toggle until measured, and none for three lines", () => {
    const renderer = render(LONG)
    expect(toggles(renderer, "Read more")).toHaveLength(0)
    measure(renderer, 3)
    expect(toggles(renderer, "Read more")).toHaveLength(0)
    expect(visibleLines(renderer, LONG)).toBe(3)
  })

  it("expands past three lines and collapses again", () => {
    const renderer = render(LONG)
    measure(renderer, 4)
    act(() => {
      toggles(renderer, "Read more")[0]?.props.onPress?.()
    })
    expect(visibleLines(renderer, LONG)).toBeUndefined()
    act(() => {
      toggles(renderer, "Show less")[0]?.props.onPress?.()
    })
    expect(visibleLines(renderer, LONG)).toBe(3)
    expect(toggles(renderer, "Read more")).not.toHaveLength(0)
  })

  it("re-measures new text, so a stale toggle never stays up", () => {
    const renderer = render(LONG)
    measure(renderer, 5)
    act(() => {
      toggles(renderer, "Read more")[0]?.props.onPress?.()
    })
    act(() => {
      renderer.update(<VideoDescription description={OTHER} />)
    })
    expect(toggles(renderer, "Read more")).toHaveLength(0)
    expect(toggles(renderer, "Show less")).toHaveLength(0)
    expect(visibleLines(renderer, OTHER)).toBe(3)
  })

  it("renders nothing without a description", () => {
    expect(render(null).toJSON()).toBeNull()
    expect(render("").toJSON()).toBeNull()
  })
})
