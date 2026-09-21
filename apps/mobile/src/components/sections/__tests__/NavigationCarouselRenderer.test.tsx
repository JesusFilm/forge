/**
 * The card's category label is drawn in capitals, so it needs letter spacing
 * of at least 5% of its font size (0.8 at caption size).
 */
jest.mock("expo-image", () => ({ __esModule: true, Image: () => null }))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

import { act } from "react"
import { StyleSheet } from "react-native"

import type { AdminBlock } from "../../../lib/queries"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { NavigationCarouselRenderer } from "../NavigationCarouselRenderer"

const SECTION = {
  __typename: "NavigationCarouselBlock",
  items: [
    { contentId: "c1", title: "The True Meaning", category: "Short Video" },
  ],
} as unknown as AdminBlock

function render(): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      <NavigationCarouselRenderer section={SECTION} />,
    )
  })
  return renderer
}

describe("NavigationCarouselRenderer category label", () => {
  it("is drawn in capitals with at least 5% letter spacing", () => {
    const [label] = render().root.findAll(
      (node) => node.type === "Text" && node.props.children === "SHORT VIDEO",
    )
    const style = StyleSheet.flatten(label.props.style) as {
      fontSize: number
      letterSpacing: number
    }

    expect(style.letterSpacing).toBe(0.8)
    expect(style.letterSpacing / style.fontSize).toBeGreaterThanOrEqual(0.05)
  })
})
