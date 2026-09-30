// The settings sheet's native step slider (owner, 2026-09-28); a JS slider
// lost its touch after about 10 pt of drift. Each render is in <StrictMode>,
// and value reports go through the library's handler, as the native view's do.

import { StrictMode, act } from "react"

import { readerTokens } from "../../../../lib/bible/theme/palettes"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import {
  ReaderStepSlider,
  type ReaderStepSliderProps,
} from "../ReaderStepSlider"

const TOKENS = readerTokens("light")
const SIZES = [22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42]
const ID = "size"

let mounted: TestInstance | null = null

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

async function render(overrides: Partial<ReaderStepSliderProps> = {}) {
  const onChange = jest.fn<void, [number]>()
  const all: ReaderStepSliderProps = {
    tokens: TOKENS,
    label: "Text size",
    spokenValues: SIZES,
    unit: "points",
    value: 4,
    onChange,
    start: null,
    end: null,
    testID: ID,
    ...overrides,
  }
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <ReaderStepSlider {...all} />
      </StrictMode>,
    )
  })
  return { renderer: mounted!, onChange, all }
}

/** The native view the library renders. */
function nativeSlider(renderer: TestInstance): RenderedNode {
  const [found] = renderer.root.findAll(
    (node) => node.type === "RNCSlider" && node.props.testID === ID,
  )
  expect(found).toBeDefined()
  return found!
}

/** A value report, as the native view sends it during a drag. */
async function report(renderer: TestInstance, value: number) {
  await act(async () => {
    ;(
      nativeSlider(renderer).props.onRNCSliderValueChange as (
        event: unknown,
      ) => void
    )({ nativeEvent: { value, fromUser: true } })
  })
}

describe("ReaderStepSlider", () => {
  it("is the native slider, with one step per spoken value", async () => {
    const { renderer } = await render()
    expect(nativeSlider(renderer).props).toMatchObject({
      minimumValue: 0,
      maximumValue: SIZES.length - 1,
      step: 1,
      value: 4,
      tapToSeek: true,
    })
  })

  it("sends each new step once as the native slider reports a drag", async () => {
    const { renderer, onChange } = await render({ value: 4 })
    for (const value of [4, 5, 5, 7, 6]) await report(renderer, value)
    // 4 is the step it shows, and a repeat of a step sends nothing.
    expect(onChange.mock.calls).toEqual([[5], [7], [6]])
  })

  it("rounds a report between steps, and keeps the ends", async () => {
    const { renderer, onChange } = await render({ value: 4 })
    for (const value of [4.4, 5.6, 99, -3]) await report(renderer, value)
    expect(onChange.mock.calls).toEqual([[6], [SIZES.length - 1], [0]])
  })

  it("takes a new value from the parent as the step it shows", async () => {
    const { renderer, onChange, all } = await render({ value: 4 })
    await act(async () => {
      renderer.update(
        <StrictMode>
          <ReaderStepSlider {...all} value={8} />
        </StrictMode>,
      )
    })
    await report(renderer, 8)
    expect(onChange).not.toHaveBeenCalled()
    expect(nativeSlider(renderer).props.value).toBe(8)
  })

  it("says each step as a number and a unit to a screen reader", async () => {
    const { renderer } = await render()
    const slider = nativeSlider(renderer).props
    expect(slider.accessibilityLabel).toBe("Text size")
    expect(slider.accessibilityUnits).toBe("points")
    // Android reads each entry with Integer.parseInt, so each must be a
    // whole number, and the library needs one entry per step.
    expect(slider.accessibilityIncrements).toEqual(SIZES.map(String))
    for (const spoken of slider.accessibilityIncrements as string[]) {
      expect(spoken).toMatch(/^\d+$/)
    }
  })

  it("hides the end glyphs from a screen reader", async () => {
    const { renderer } = await render()
    const hidden = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityElementsHidden === true &&
        node.props.importantForAccessibility === "no-hide-descendants",
    )
    expect(hidden).toHaveLength(2)
  })

  it("fills the track to the thumb with the reader's accent", async () => {
    const { renderer } = await render()
    const slider = nativeSlider(renderer).props
    expect(slider.minimumTrackTintColor).toBe(TOKENS.icon)
    expect(slider.maximumTrackTintColor).toBe(TOKENS.progressTrack)
  })
})
