/**
 * The Library summary shows only the downloads count, over a 1pt separator
 * line. The total size and the device-capacity usage bar are gone.
 */
import { act } from "react"
import { StyleSheet } from "react-native"

import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { DownloadsSummary } from "../DownloadsSummary"

function render(count: number): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(<DownloadsSummary count={count} />)
  })
  return renderer
}

function hostTexts(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll((node) => node.type === "Text")
}

describe("DownloadsSummary", () => {
  it("shows only the count, with no size", () => {
    const texts = hostTexts(render(5))

    expect(texts).toHaveLength(1)
    expect(texts[0].props.children).toBe("5 downloads")
  })

  it("uses the singular for one download", () => {
    expect(hostTexts(render(1))[0].props.children).toBe("1 download")
  })

  it("draws one 1pt separator line, and no usage bar", () => {
    const renderer = render(5)

    const views = renderer.root.findAll((node) => node.type === "View")
    // Root + separator. A usage bar would add a track and a fill view.
    expect(views).toHaveLength(2)
    const [separator] = views.filter(
      (node) => node.props.testID === "downloads-summary-separator",
    )
    expect(StyleSheet.flatten(separator.props.style)).toMatchObject({
      height: 1,
      backgroundColor: "rgba(255, 255, 255, 0.1)",
    })
  })
})
