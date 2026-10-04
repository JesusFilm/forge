// The WATCH, REFLECT, and PRAY pill stepper (R11). Each pill takes the Figma
// fill of its state, and VoiceOver reads the state with the step name.
import { act } from "react"
import { StyleSheet, type ViewStyle } from "react-native"

import type { PauseFace } from "../../../lib/dailyPause/fonts"
import { pauseColors } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { StepperPills, type StepperStage } from "../StepperPills"

const font = (face: PauseFace) => ({ fontFamily: face })

let renderer: TestInstance | null = null

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
})

async function render(active: StepperStage) {
  await act(async () => {
    renderer = TestRenderer.create(<StepperPills active={active} font={font} />)
  })
  return renderer!
}

/** The host pills, top to bottom. */
function pills(root: TestInstance): RenderedNode[] {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.accessibilityLabel === "string",
  )
}

function fill(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle)
}

function texts(node: RenderedNode): string[] {
  const out: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === "object" && "props" in value) {
      walk((value as { props: { children?: unknown } }).props.children)
    }
  }
  walk(node.props.children)
  return out
}

const ACTIVE = { backgroundColor: pauseColors.ink }
const DONE = { backgroundColor: pauseColors.raised }
const UPCOMING = {
  backgroundColor: pauseColors.background,
  borderWidth: 1,
  borderColor: pauseColors.pillBorder,
}

it.each<[StepperStage, string[], object[]]>([
  [
    "watch",
    ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"],
    [ACTIVE, UPCOMING, UPCOMING],
  ],
  [
    "reflect",
    ["Watch, done", "Reflect, current step", "Pray, upcoming"],
    [DONE, ACTIVE, UPCOMING],
  ],
  [
    "pray",
    ["Watch, done", "Reflect, done", "Pray, current step"],
    [DONE, DONE, ACTIVE],
  ],
])(
  "on the %s screen, gives every pill its Figma state",
  async (active, labels, fills) => {
    const shown = pills(await render(active))
    expect(shown.map((node) => node.props.accessibilityLabel)).toEqual(labels)
    shown.forEach((node, index) => {
      expect(fill(node)).toMatchObject(fills[index]!)
    })
  },
)

it("marks only the done pills with the check", async () => {
  const shown = pills(await render("pray"))
  expect(shown.map(texts)).toEqual([["✓", "WATCH"], ["✓", "REFLECT"], ["PRAY"]])
})
