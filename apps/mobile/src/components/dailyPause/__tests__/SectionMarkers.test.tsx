// The section markers of the video parts (v2 plan R2-R4, AE1, KTD4). The run
// screen's suite pins where the row sits beside the close (R5).
import { act } from "react"
import { StyleSheet, type TextStyle } from "react-native"

import { pauseColors } from "../../../lib/dailyPause/theme"
import { pauseTestFont as font } from "../../../test-utils/dailyPause"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { MARKER_MAX_SCALE, SectionMarkers } from "../SectionMarkers"
import type { StepperStage } from "../StepperPills"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))

let renderer: TestInstance | null = null

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
})

async function mount(section: StepperStage) {
  await act(async () => {
    renderer = TestRenderer.create(
      <SectionMarkers section={section} font={font} />,
    )
  })
}

/** The host text nodes of the row, left to right. */
function markers(): RenderedNode[] {
  return renderer!.root.findAll(
    (node) => node.type === "Text" && typeof node.props.children === "string",
  )
}

/** Each marker's text and color. */
function looks(): [string, unknown][] {
  return markers().map((node) => [
    node.props.children as string,
    StyleSheet.flatten(node.props.style as TextStyle).color,
  ])
}

function row(): RenderedNode {
  const [one] = renderer!.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.testID === "section-markers",
  )
  return one!
}

const GOLD = pauseColors.accent
const PLAIN = pauseColors.ink

it("shows REFLECT in gold, and WATCH and PRAY plain, on the teaching part (AE1)", async () => {
  await mount("reflect")
  expect(looks()).toEqual([
    ["WATCH", PLAIN],
    ["REFLECT", GOLD],
    ["PRAY", PLAIN],
  ])
})

it.each<[StepperStage, [string, unknown][]]>([
  [
    "watch",
    [
      ["WATCH", GOLD],
      ["REFLECT", PLAIN],
      ["PRAY", PLAIN],
    ],
  ],
  [
    "pray",
    [
      ["WATCH", PLAIN],
      ["REFLECT", PLAIN],
      ["PRAY", GOLD],
    ],
  ],
])("shows only the %s marker in gold (R3)", async (section, expected) => {
  await mount(section)
  expect(looks()).toEqual(expected)
})

it.each<[StepperStage, string]>([
  ["watch", "Watch section"],
  ["reflect", "Reflect section"],
  ["pray", "Pray section"],
])(
  "gives a screen reader one text element for the %s section",
  async (section, label) => {
    await mount(section)
    const spoken = renderer!.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.accessibilityLabel === "string",
    )
    expect(spoken).toHaveLength(1)
    expect(spoken[0]!.props).toMatchObject({
      accessible: true,
      accessibilityRole: "text",
      accessibilityLabel: label,
    })
  },
)

it("takes no touch, so a tap reaches the video under it (R4)", async () => {
  await mount("reflect")
  expect(row().props.pointerEvents).toBe("none")
})

it("caps the text scale of every marker", async () => {
  await mount("reflect")
  expect(MARKER_MAX_SCALE).toBeGreaterThan(1)
  expect(Number.isFinite(MARKER_MAX_SCALE)).toBe(true)
  const caps = markers().map((node) => node.props.maxFontSizeMultiplier)
  expect(caps).toEqual([MARKER_MAX_SCALE, MARKER_MAX_SCALE, MARKER_MAX_SCALE])
})
