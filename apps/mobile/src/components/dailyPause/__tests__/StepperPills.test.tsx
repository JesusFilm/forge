// The WATCH, REFLECT, and PRAY stepper (R11) as a path down from a top node
// (the owner, 2026-10-06). Each screen plays one arrival step. Jest cannot move
// a native animation, so these tests pin the start of each step and its end
// under Reduce Motion.
import { act } from "react"
import { AccessibilityInfo, StyleSheet, type ViewStyle } from "react-native"

import { pauseColors } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { pauseTestFont as font } from "../../../test-utils/dailyPause"
import { StepperPills, type StepperStage } from "../StepperPills"

let renderer: TestInstance | null = null

beforeEach(() => {
  jest.useFakeTimers()
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  jest.restoreAllMocks()
  jest.useRealTimers()
})

async function render(arrival: StepperStage) {
  await act(async () => {
    renderer = TestRenderer.create(
      <StepperPills arrival={arrival} font={font} />,
    )
  })
  await act(async () => {})
  return renderer!
}

async function reduceMotion() {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true)
}

function byId(testID: string): RenderedNode {
  const [found] = renderer!.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )
  if (!found) throw new Error(`no view "${testID}"`)
  return found
}

function style(testID: string): ViewStyle {
  return StyleSheet.flatten(byId(testID).props.style as ViewStyle)
}

function opacity(testID: string): number {
  return Number(style(testID).opacity ?? 1)
}

/** How far a line has drawn, from its fill's scale. */
function scaleY(testID: string): number {
  const transform = (style(`${testID}-fill`).transform ??
    []) as unknown as Record<string, number>[]
  const entry = transform.find((one) => "scaleY" in one)
  return Number(entry?.scaleY ?? 1)
}

/** The look that shows: the layer at full opacity. */
function look(stage: string): string {
  const shown = ["active", "done", "upcoming"].filter(
    (one) => opacity(`stepper-${stage}-${one}`) === 1,
  )
  if (shown.length !== 1) throw new Error(`${stage} shows ${shown.join(",")}`)
  return shown[0]!
}

function labels(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessible === true &&
        typeof node.props.accessibilityLabel === "string",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

const STAGES = ["watch", "reflect", "pray"]

describe("the end state of each arrival step (Reduce Motion)", () => {
  it.each<[StepperStage, string[], string[], number[]]>([
    [
      "watch",
      ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"],
      ["active", "upcoming", "upcoming"],
      [1, 0, 0],
    ],
    [
      "reflect",
      ["Watch, done", "Reflect, current step", "Pray, upcoming"],
      ["done", "active", "upcoming"],
      [1, 1, 0],
    ],
    [
      "pray",
      ["Watch, done", "Reflect, done", "Pray, current step"],
      ["done", "done", "active"],
      [1, 1, 1],
    ],
  ])(
    "after the %s step, shows the pills, the lines, and the top node lit up to it",
    async (arrival, spoken, looks, lines) => {
      await reduceMotion()
      await render(arrival)

      expect(labels()).toEqual(spoken)
      expect(STAGES.map(look)).toEqual(looks)
      expect([0, 1, 2].map((i) => scaleY(`stepper-line-${i}`))).toEqual(lines)
      expect(opacity("stepper-node-top-fill")).toBe(1)
    },
  )

  // The owner (2026-10-06) found the bottom node strange, floating below PRAY.
  it("ends the path at PRAY, with no line below it and no bottom node", async () => {
    await reduceMotion()
    await render("pray")
    const ids = renderer!.root
      .findAll(
        (node) =>
          typeof node.type === "string" &&
          typeof node.props.testID === "string" &&
          /^stepper-(node|line)-[a-z0-9]+$/.test(node.props.testID),
      )
      .map((node) => node.props.testID as string)
    expect(ids).toEqual([
      "stepper-node-top",
      "stepper-line-0",
      "stepper-line-1",
      "stepper-line-2",
    ])
  })

  it("gives each look its Figma fill", async () => {
    await reduceMotion()
    await render("reflect")
    expect(style("stepper-watch-done")).toMatchObject({
      backgroundColor: pauseColors.raised,
    })
    expect(style("stepper-reflect-active")).toMatchObject({
      backgroundColor: pauseColors.ink,
    })
    expect(style("stepper-pray-upcoming")).toMatchObject({
      backgroundColor: pauseColors.background,
      borderColor: pauseColors.pillBorder,
    })
  })

  // The owner (2026-10-06) saw a seam between the fill and the outline. The
  // lit disc now has the outline's own outer edge, so no inner edge is left.
  it("draws a lit node as one disc over the outline, edge to edge", async () => {
    await reduceMotion()
    await render("watch")
    const node = "stepper-node-top"
    expect(style(node).borderWidth ?? 0).toBe(0)
    expect(style(`${node}-fill`)).toMatchObject({
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: Number(style(node).width) / 2,
      backgroundColor: pauseColors.ink,
    })
  })

  it("hides the nodes and the lines from VoiceOver", async () => {
    await reduceMotion()
    await render("watch")
    for (const testID of ["stepper-node-top", "stepper-line-0"]) {
      expect(byId(testID).props.importantForAccessibility).toBe(
        "no-hide-descendants",
      )
      expect(byId(testID).props.accessibilityElementsHidden).toBe(true)
    }
  })
})

describe("the start of each arrival step (motion on)", () => {
  it("starts the Watch step from an unlit top node, no line, and WATCH unlit", async () => {
    await render("watch")
    expect(opacity("stepper-node-top-fill")).toBe(0)
    expect(scaleY("stepper-line-0")).toBe(0)
    expect(look("watch")).toBe("upcoming")
  })

  it("starts the Reflect step from WATCH lit and no line to REFLECT", async () => {
    await render("reflect")
    expect(opacity("stepper-node-top-fill")).toBe(1)
    expect(scaleY("stepper-line-0")).toBe(1)
    expect(scaleY("stepper-line-1")).toBe(0)
    expect(STAGES.map(look)).toEqual(["active", "upcoming", "upcoming"])
  })
})
