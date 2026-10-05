// The WATCH, REFLECT, and PRAY stepper (R11) as a path from a top node to a
// bottom node (the owner, 2026-10-06). Each screen plays one arrival step. Jest
// cannot move a native animation, so these tests pin the start of each step,
// its end under Reduce Motion, and the end step's own clock.
import { act } from "react"
import { AccessibilityInfo, StyleSheet, type ViewStyle } from "react-native"

import type { PauseFace } from "../../../lib/dailyPause/fonts"
import { pauseColors } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  STEPPER_END_MS,
  StepperPills,
  type StepperArrival,
} from "../StepperPills"

const font = (face: PauseFace) => ({ fontFamily: face })

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

async function render(arrival: StepperArrival, onArrived?: () => void) {
  await act(async () => {
    renderer = TestRenderer.create(
      <StepperPills arrival={arrival} font={font} onArrived={onArrived} />,
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
  it.each<[StepperArrival, string[], string[], number[], [number, number]]>([
    [
      "watch",
      ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"],
      ["active", "upcoming", "upcoming"],
      [1, 0, 0, 0],
      [1, 0],
    ],
    [
      "reflect",
      ["Watch, done", "Reflect, current step", "Pray, upcoming"],
      ["done", "active", "upcoming"],
      [1, 1, 0, 0],
      [1, 0],
    ],
    [
      "pray",
      ["Watch, done", "Reflect, done", "Pray, current step"],
      ["done", "done", "active"],
      [1, 1, 1, 0],
      [1, 0],
    ],
    [
      "end",
      ["Watch, done", "Reflect, done", "Pray, done"],
      ["done", "done", "done"],
      [1, 1, 1, 1],
      [1, 1],
    ],
  ])(
    "after the %s step, shows the pills, the lines, and the nodes lit up to it",
    async (arrival, spoken, looks, lines, [top, bottom]) => {
      await reduceMotion()
      await render(arrival)

      expect(labels()).toEqual(spoken)
      expect(STAGES.map(look)).toEqual(looks)
      expect([0, 1, 2, 3].map((i) => scaleY(`stepper-line-${i}`))).toEqual(
        lines,
      )
      expect(opacity("stepper-node-top-fill")).toBe(top)
      expect(opacity("stepper-node-bottom-fill")).toBe(bottom)
    },
  )

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
    await render("end")
    for (const node of ["stepper-node-top", "stepper-node-bottom"]) {
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
    }
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

  it("starts the end step from PRAY lit and an unlit bottom node", async () => {
    await render("end")
    expect(scaleY("stepper-line-3")).toBe(0)
    expect(opacity("stepper-node-bottom-fill")).toBe(0)
    expect(STAGES.map(look)).toEqual(["done", "done", "active"])
  })
})

describe("the end step's clock", () => {
  it("reports the end once, when the step has played", async () => {
    const onArrived = jest.fn()
    await render("end", onArrived)

    await act(async () => {
      jest.advanceTimersByTime(STEPPER_END_MS - 1)
    })
    expect(onArrived).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(onArrived).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(STEPPER_END_MS)
    })
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it("reports the end at once under Reduce Motion", async () => {
    await reduceMotion()
    const onArrived = jest.fn()
    await render("end", onArrived)
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it("never reports an end for the other steps", async () => {
    const onArrived = jest.fn()
    await render("pray", onArrived)
    await act(async () => {
      jest.advanceTimersByTime(STEPPER_END_MS * 2)
    })
    expect(onArrived).not.toHaveBeenCalled()
  })
})
