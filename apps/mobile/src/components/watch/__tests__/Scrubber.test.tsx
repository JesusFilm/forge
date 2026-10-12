/**
 * The seek bar in a right-to-left layout (feat-694 R12, KTD7, AE6) keeps a
 * left-to-right layout, so its thumb sits on the x that the drag reads. The
 * mocks re-point `react` at the real package (CLAUDE.md, render tests).
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

import { act } from "react"
import { I18nManager, StyleSheet } from "react-native"

import { Scrubber } from "../Scrubber"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { directionAbove } from "../../../test-utils/layoutDirection"

function layoutIsRtl() {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({
    ...I18nManager.getConstants(),
    isRTL: true,
  })
  jest.replaceProperty(I18nManager, "isRTL", true)
}

function hostById(renderer: TestInstance, id: string): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => n.props.testID === id && typeof n.type === "string",
  )
  if (node == null) throw new Error(`no host node with testID ${id}`)
  return node
}

async function renderMeasured(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <Scrubber currentTime={30} duration={120} onSeek={() => {}} />,
    )
  })
  // The thumb draws only once the track has a width.
  const [bar] = renderer.root.findAll(
    (n) =>
      n.props.accessibilityLabel === "Seek bar" && typeof n.type === "string",
  )
  await act(async () => {
    ;(bar.props.onLayout as (e: unknown) => void)({
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 44 } },
    })
  })
  return renderer
}

beforeEach(() => {
  layoutIsRtl()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("Scrubber — in a right-to-left layout (feat-694 R12, AE6)", () => {
  it("fills from the left edge, inside a left-to-right container", async () => {
    const renderer = await renderMeasured()
    const fill = hostById(renderer, "scrubber-fill")

    expect(directionAbove(fill)).toBe("ltr")
    expect(StyleSheet.flatten(fill.props.style as never)).toMatchObject({
      transformOrigin: "left center",
    })
    await unmount(renderer)
  })

  it("places the thumb from the left edge, inside a left-to-right container", async () => {
    const renderer = await renderMeasured()
    const thumb = hostById(renderer, "scrubber-thumb")

    expect(directionAbove(thumb)).toBe("ltr")
    expect(StyleSheet.flatten(thumb.props.style as never)).toMatchObject({
      left: 0,
    })
    await unmount(renderer)
  })
})
