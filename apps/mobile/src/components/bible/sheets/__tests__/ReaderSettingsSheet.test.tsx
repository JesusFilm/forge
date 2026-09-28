/** The reader settings sheet (feat-553 U10, R33, R34, KTD6): six settings, "Show
 *  arrow buttons" on phones only, and the credits. The two sliders are native
 *  (owner, 2026-09-28); ReaderStepSlider.test.tsx drives their touches. */

// tsconfig maps `react` to its .d.ts; re-point it (see AccountSection.test.tsx).
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
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => {} }),
}))

import { act } from "react"
import Slider from "@react-native-community/slider"
import { StyleSheet } from "react-native"

import type { ReaderLayout } from "../../../../lib/bible/reader/chrome"
import { READER_TOUCH_TARGET } from "../../../../lib/bible/reader/chrome"
import { READER_SHEET_COPY } from "../../../../lib/bible/sheets/copy"
import {
  DEFAULT_READER_SETTINGS,
  READER_LINE_SPACING_STEPS,
  READER_TEXT_SIZE_STEPS,
  type ReaderSettings,
} from "../../../../lib/bible/settings/snapshot"
import { readerTokens } from "../../../../lib/bible/theme/palettes"
import {
  TestRenderer,
  hasText,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import { ReaderSettingsSheet } from "../ReaderSettingsSheet"
import {
  ReaderStepSlider,
  type ReaderStepSliderProps,
} from "../ReaderStepSlider"

const COPY = READER_SHEET_COPY.settings
const TOKENS = readerTokens("dark")
const SIZES = READER_TEXT_SIZE_STEPS.length
const SPACINGS = READER_LINE_SPACING_STEPS.length

let mounted: TestInstance | null = null

async function render(
  options: {
    settings?: ReaderSettings
    layout?: ReaderLayout
    currentCredit?: { name: string; credit: string } | null
  } = {},
) {
  const onChange = jest.fn()
  const onClose = jest.fn()
  await act(async () => {
    mounted = TestRenderer.create(
      <ReaderSettingsSheet
        tokens={TOKENS}
        settings={options.settings ?? { ...DEFAULT_READER_SETTINGS }}
        layout={options.layout ?? "phone"}
        currentCredit={options.currentCredit ?? null}
        onChange={onChange}
        onClose={onClose}
      />,
    )
  })
  return { renderer: mounted!, onChange, onClose }
}

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

function control(
  renderer: TestInstance,
  label: string,
  handler: "onPress" | "onValueChange" = "onPress",
): RenderedNode | undefined {
  return renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityLabel === label &&
      typeof node.props[handler] === "function",
  )[0]
}

async function press(renderer: TestInstance, label: string): Promise<void> {
  const target = control(renderer, label)
  if (!target) throw new Error(`no option "${label}"`)
  await act(async () => {
    target.props.onPress?.()
  })
}

async function toggle(
  renderer: TestInstance,
  label: string,
  value: boolean,
): Promise<void> {
  const target = control(renderer, label, "onValueChange")
  if (!target) throw new Error(`no switch "${label}"`)
  await act(async () => {
    ;(target.props.onValueChange as (next: boolean) => void)(value)
  })
}

function slider(renderer: TestInstance, label: string): ReaderStepSliderProps {
  const [found] = renderer.root.findAll(
    (node) => node.type === ReaderStepSlider && node.props.label === label,
  )
  if (!found) throw new Error(`no slider "${label}"`)
  return found.props as ReaderStepSliderProps
}

/** The native slider view, which a screen reader lands on. */
function nativeSlider(renderer: TestInstance, label: string): RenderedNode {
  const [found] = renderer.root.findAll(
    (node) =>
      node.type === "RNCSlider" && node.props.accessibilityLabel === label,
  )
  if (!found) throw new Error(`no native slider "${label}"`)
  return found
}

/** A drag to a step, as the native view reports it. */
async function slideTo(renderer: TestInstance, label: string, step: number) {
  await act(async () => {
    ;(
      nativeSlider(renderer, label).props.onRNCSliderValueChange as (
        event: unknown,
      ) => void
    )({ nativeEvent: { value: step, fromUser: true } })
  })
}

function selected(renderer: TestInstance, label: string): boolean {
  const state = control(renderer, label)?.props.accessibilityState as
    | { selected?: boolean }
    | undefined
  return state?.selected === true
}

describe("ReaderSettingsSheet", () => {
  it.each<[string, string, Partial<ReaderSettings>]>([
    ["Mode", COPY.modes.light, { mode: "light" }],
    ["Mode", COPY.modes.system, { mode: "system" }],
    ["Mode", COPY.modes.trueDark, { mode: "trueDark" }],
    ["Typeface", COPY.typefaces.sans, { typeface: "sans" }],
  ])("%s: %s sends its change", async (_group, label, patch) => {
    const { renderer, onChange } = await render()
    await press(renderer, label)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(patch)
  })

  it("offers True Dark next to Dark, and has no palette row", async () => {
    const { renderer } = await render()
    const modes = renderer.root
      .findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.accessibilityRole === "radio",
      )
      .map((node) => node.props.accessibilityLabel as string)
    expect(modes.slice(0, 4)).toEqual([
      COPY.modes.system,
      COPY.modes.light,
      COPY.modes.dark,
      COPY.modes.trueDark,
    ])
    expect(hasText(renderer, "Palette")).toBe(false)
    expect(hasText(renderer, "Classic")).toBe(false)
  })

  it("gives text size eleven steps and line spacing five", async () => {
    const { renderer } = await render()
    expect(slider(renderer, COPY.textSize).spokenValues).toHaveLength(11)
    expect(slider(renderer, COPY.lineSpacing).spokenValues).toHaveLength(5)
    expect(nativeSlider(renderer, COPY.textSize).props.maximumValue).toBe(10)
    expect(nativeSlider(renderer, COPY.lineSpacing).props.maximumValue).toBe(4)
  })

  it.each<[string, number, Partial<ReaderSettings>]>([
    [COPY.textSize, SIZES - 1, { textSizeStep: SIZES - 1 }],
    [COPY.textSize, 0, { textSizeStep: 0 }],
    [COPY.lineSpacing, SPACINGS - 1, { lineSpacingStep: SPACINGS - 1 }],
    [COPY.lineSpacing, 0, { lineSpacingStep: 0 }],
  ])("%s: step %i sends its change", async (label, step, patch) => {
    const { renderer, onChange } = await render()
    await slideTo(renderer, label, step)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(patch)
  })

  it("puts line spacing right below text size", async () => {
    const { renderer } = await render()
    const groups: string[] = [
      COPY.mode,
      COPY.textSize,
      COPY.lineSpacing,
      COPY.typeface,
    ]
    const order = renderer.root
      .findAll((node) => node.type === "Text")
      .map((node) => node.props.children)
      .filter((text) => typeof text === "string" && groups.includes(text))
    expect(order).toEqual(groups)
  })

  it("tells a screen reader the size in points and the spacing in percent", async () => {
    const { renderer } = await render()
    const size = nativeSlider(renderer, COPY.textSize).props
    const spacing = nativeSlider(renderer, COPY.lineSpacing).props
    expect(size.accessibilityUnits).toBe("points")
    expect(size.accessibilityIncrements).toEqual(
      READER_TEXT_SIZE_STEPS.map(String),
    )
    expect(spacing.accessibilityUnits).toBe("percent")
    expect(spacing.accessibilityIncrements).toEqual([
      "120",
      "130",
      "140",
      "150",
      "160",
    ])
  })

  it("turns the verse numbers off and the arrow buttons on", async () => {
    const { renderer, onChange } = await render()
    await toggle(renderer, COPY.verseNumbers, false)
    await toggle(renderer, COPY.showArrows, true)
    expect(onChange.mock.calls).toEqual([
      [{ verseNumbers: false }],
      [{ showArrows: true }],
    ])
  })

  it("marks the current value of each setting", async () => {
    const { renderer } = await render({
      settings: {
        ...DEFAULT_READER_SETTINGS,
        mode: "trueDark",
        typeface: "sans",
        lineSpacingStep: 0,
        textSizeStep: 1,
        verseNumbers: false,
        showArrows: true,
      },
    })
    expect(selected(renderer, COPY.modes.trueDark)).toBe(true)
    expect(selected(renderer, COPY.modes.dark)).toBe(false)
    expect(selected(renderer, COPY.modes.system)).toBe(false)
    expect(selected(renderer, COPY.typefaces.sans)).toBe(true)
    expect(slider(renderer, COPY.lineSpacing).value).toBe(0)
    expect(slider(renderer, COPY.textSize).value).toBe(1)
    expect(
      control(renderer, COPY.verseNumbers, "onValueChange")?.props.value,
    ).toBe(false)
    expect(
      control(renderer, COPY.showArrows, "onValueChange")?.props.value,
    ).toBe(true)
  })

  it("shows all six settings on a phone", async () => {
    const { renderer } = await render({ layout: "phone" })
    for (const label of [COPY.textSize, COPY.lineSpacing]) {
      expect(nativeSlider(renderer, label)).toBeDefined()
    }
    for (const group of [COPY.mode, COPY.typeface]) {
      expect(
        renderer.root.findAll(
          (node) =>
            typeof node.type === "string" &&
            node.props.accessibilityRole === "radiogroup" &&
            node.props.accessibilityLabel === group,
        ),
      ).toHaveLength(1)
    }
    expect(control(renderer, COPY.verseNumbers, "onValueChange")).toBeDefined()
    expect(control(renderer, COPY.showArrows, "onValueChange")).toBeDefined()
  })

  it("hides Show arrow buttons on a tablet layout (R11)", async () => {
    const { renderer } = await render({ layout: "tablet" })
    expect(control(renderer, COPY.showArrows, "onValueChange")).toBeUndefined()
    expect(hasText(renderer, COPY.showArrows)).toBe(false)
    expect(control(renderer, COPY.verseNumbers, "onValueChange")).toBeDefined()
  })

  it("gives every option and slider a 44-point touch target", async () => {
    const { renderer } = await render()
    const options = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "radio",
    )
    const sliders = renderer.root.findAll((node) => node.type === Slider)
    expect(options.length).toBe(4 + 2)
    expect(sliders).toHaveLength(2)
    for (const slider of sliders) {
      const style = StyleSheet.flatten(slider.props.style as never) as {
        height?: number
      }
      expect(style.height ?? 0).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
    }
    for (const option of options) {
      const style = StyleSheet.flatten(option.props.style as never) as {
        minHeight?: number
      }
      expect(style.minHeight ?? 0).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
    }
  })

  it("credits BSB, the catalog, and the verse mappings", async () => {
    const { renderer } = await render()
    expect(hasText(renderer, COPY.aboutTitle)).toBe(true)
    expect(hasText(renderer, COPY.bsbCredit)).toBe(true)
    expect(hasText(renderer, COPY.catalogCredit)).toBe(true)
    expect(hasText(renderer, "Copenhagen Alliance, CC BY-SA 4.0")).toBe(true)
  })

  it("credits the translation that shows", async () => {
    const { renderer } = await render({
      currentCredit: {
        name: "Синодальный перевод",
        credit: "public domain",
      },
    })
    expect(
      hasText(
        renderer,
        COPY.currentCredit("Синодальный перевод", "public domain"),
      ),
    ).toBe(true)
  })

  it("closes from a button", async () => {
    const { renderer, onClose } = await render()
    await press(renderer, READER_SHEET_COPY.close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("draws on the reader's page color", async () => {
    const { renderer } = await render()
    const [root] = renderer.root.findAll(
      (node) => node.props.testID === "reader-settings-sheet",
    )
    const style = StyleSheet.flatten(root?.props.style as never) as {
      backgroundColor?: string
    }
    expect(style.backgroundColor).toBe(TOKENS.background)
  })
})
