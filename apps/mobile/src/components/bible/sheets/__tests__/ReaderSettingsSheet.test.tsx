/**
 * The reader settings sheet (feat-551 U10, R33, R34, KTD6): seven settings,
 * "Show arrow buttons" on phones only, and the "About the text" credits.
 */

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
import { StyleSheet } from "react-native"

import type { ReaderLayout } from "../../../../lib/bible/reader/chrome"
import { READER_TOUCH_TARGET } from "../../../../lib/bible/reader/chrome"
import { READER_SHEET_COPY } from "../../../../lib/bible/sheets/copy"
import {
  DEFAULT_READER_SETTINGS,
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

const COPY = READER_SHEET_COPY.settings
const TOKENS = readerTokens("classic", "dark")
const STEPS = READER_TEXT_SIZE_STEPS.length

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
    ["Palette", COPY.palettes.trueDark, { palette: "trueDark" }],
    ["Typeface", COPY.typefaces.sans, { typeface: "sans" }],
    ["Line spacing", COPY.lineSpacings.relaxed, { lineSpacing: "relaxed" }],
    ["Line spacing", COPY.lineSpacings.compact, { lineSpacing: "compact" }],
    ["Text size", COPY.textSizeStep(STEPS, STEPS), { textSizeStep: STEPS - 1 }],
    ["Text size", COPY.textSizeStep(1, STEPS), { textSizeStep: 0 }],
  ])("%s: %s sends its change", async (_group, label, patch) => {
    const { renderer, onChange } = await render()
    await press(renderer, label)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(patch)
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
        mode: "dark",
        palette: "trueDark",
        typeface: "sans",
        lineSpacing: "compact",
        textSizeStep: 1,
        verseNumbers: false,
        showArrows: true,
      },
    })
    expect(selected(renderer, COPY.modes.dark)).toBe(true)
    expect(selected(renderer, COPY.modes.system)).toBe(false)
    expect(selected(renderer, COPY.palettes.trueDark)).toBe(true)
    expect(selected(renderer, COPY.typefaces.sans)).toBe(true)
    expect(selected(renderer, COPY.lineSpacings.compact)).toBe(true)
    expect(selected(renderer, COPY.textSizeStep(2, STEPS))).toBe(true)
    expect(selected(renderer, COPY.textSizeStep(3, STEPS))).toBe(false)
    expect(
      control(renderer, COPY.verseNumbers, "onValueChange")?.props.value,
    ).toBe(false)
    expect(
      control(renderer, COPY.showArrows, "onValueChange")?.props.value,
    ).toBe(true)
  })

  it("shows all seven settings on a phone", async () => {
    const { renderer } = await render({ layout: "phone" })
    for (const group of [
      COPY.mode,
      COPY.textSize,
      COPY.palette,
      COPY.typeface,
      COPY.lineSpacing,
    ]) {
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

  it("gives every option a 44-point touch target", async () => {
    const { renderer } = await render()
    const options = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "radio",
    )
    expect(options.length).toBe(3 + STEPS + 2 + 2 + 3)
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
