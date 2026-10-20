/** feat-695: a progress ring fills clockwise in every layout (Material
 *  bidirectionality: the circular direction of time is not mirrored). React
 *  Native swaps a half's `left` in a right-to-left layout, so each ring draws
 *  in one left-to-right layer, and its center keeps the app's direction. */

// tsconfig maps `react` to its .d.ts; re-point it (see MyWatchHeader.test.tsx).
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

import { act, type ReactElement } from "react"
import { StyleSheet, View, type ViewStyle } from "react-native"

import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { ReaderProgressRing } from "../bible/ReaderProgressRing"
import { DownloadProgressRing } from "../watch/DownloadProgressRing"

let mounted: TestInstance | null = null

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = null
})

async function render(element: ReactElement): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(element)
  })
  return mounted!
}

function flat(node: RenderedNode): ViewStyle {
  return (StyleSheet.flatten(node.props.style as ViewStyle) ?? {}) as ViewStyle
}

function hostNodes(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll((node) => typeof node.type === "string")
}

function hostByTestID(renderer: TestInstance, testID: string): RenderedNode[] {
  return hostNodes(renderer).filter((node) => node.props.testID === testID)
}

function isInside(node: RenderedNode, ancestor: RenderedNode): boolean {
  for (let at = node.parent; at != null; at = at.parent) {
    if (at === ancestor) return true
  }
  return false
}

const CASES = [
  {
    name: "DownloadProgressRing",
    drawingID: "download-progress-ring-drawing",
    element: () => (
      <DownloadProgressRing
        size={26}
        strokeWidth={2.5}
        progress={0.25}
        color="#ff0000"
        trackColor="#333333"
        cutoutColor="#000000"
      >
        <View testID="ring-center" />
      </DownloadProgressRing>
    ),
  },
  {
    name: "ReaderProgressRing",
    drawingID: "reader-progress-ring-drawing",
    element: () => (
      <ReaderProgressRing
        size={26}
        strokeWidth={2.5}
        progress={0.25}
        color="#ff0000"
        trackColor="#333333"
      >
        <View testID="ring-center" />
      </ReaderProgressRing>
    ),
  },
]

describe.each(CASES)("$name direction", ({ drawingID, element }) => {
  it("draws in one left-to-right layer", async () => {
    const renderer = await render(element())
    const drawing = hostByTestID(renderer, drawingID)
    expect(drawing).toHaveLength(1)
    expect(flat(drawing[0]).direction).toBe("ltr")
  })

  it("puts both half clips inside that layer", async () => {
    const renderer = await render(element())
    const [drawing] = hostByTestID(renderer, drawingID)
    const clips = hostNodes(renderer).filter(
      (node) => flat(node).overflow === "hidden",
    )
    expect(clips).toHaveLength(2)
    expect(clips.filter((clip) => isInside(clip, drawing))).toHaveLength(2)
  })

  it("keeps the center outside that layer, in the app's direction", async () => {
    const renderer = await render(element())
    const [drawing] = hostByTestID(renderer, drawingID)
    const center = hostByTestID(renderer, "ring-center")
    expect(center).toHaveLength(1)
    expect(isInside(center[0], drawing)).toBe(false)
    const [root] = hostNodes(renderer)
    expect(flat(root).direction).toBeUndefined()
  })
})
