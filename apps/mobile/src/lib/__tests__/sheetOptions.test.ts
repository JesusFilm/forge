/**
 * Native form sheets on iOS 26 (feat-705 U9, KTD7, R14). The helper drops the
 * solid fill and the custom corner, so UIKit draws its glass sheet. The watch
 * and series layouts read it at module scope, so each case loads them fresh.
 */

// The `mock` prefix lets the hoisted factory read this object. The factory
// runs again in each isolated registry, so the state must live out here.
const mockGate = { glass: true }
jest.mock("../liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
// The layouts only build elements here; nothing renders them.
jest.mock("expo-router", () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
}))
jest.mock("../../contexts/WatchSessionProvider", () => ({
  WatchSessionProvider: () => null,
}))
jest.mock("../../contexts/SeriesSessionProvider", () => ({
  SeriesSessionProvider: () => null,
}))

import { BACK_SWIPE_RESPONSE_DISTANCE } from "../backSwipe"
import { BG_COLOR } from "../color"
import {
  formSheetBaseOptions,
  formSheetOptions,
  sheetBackground,
} from "../sheetOptions"

type Options = Record<string, unknown>
type Element = {
  props: {
    children?: unknown
    name?: string
    options?: Options
    screenOptions?: Options
  }
}

beforeEach(() => {
  mockGate.glass = true
})

describe("the form sheet helper", () => {
  it("leaves the corner and the fill to iOS 26", () => {
    const options = formSheetBaseOptions()
    expect(options).not.toHaveProperty("sheetCornerRadius")
    expect(options).toEqual({
      headerShown: false,
      presentation: "formSheet",
      sheetInitialDetentIndex: 0,
      sheetGrabberVisible: true,
    })
    expect(formSheetOptions()).toEqual({
      ...options,
      contentStyle: { backgroundColor: "transparent" },
    })
  })

  it("keeps today's 16 pt corner and solid fill without Liquid Glass", () => {
    mockGate.glass = false
    expect(formSheetBaseOptions()).toEqual({
      headerShown: false,
      presentation: "formSheet",
      sheetInitialDetentIndex: 0,
      sheetGrabberVisible: true,
      sheetCornerRadius: 16,
    })
    expect(formSheetOptions()).toEqual({
      ...formSheetBaseOptions(),
      contentStyle: { backgroundColor: BG_COLOR },
    })
  })

  it("turns a caller's solid fill transparent only on iOS 26", () => {
    expect(sheetBackground("#000000")).toBe("transparent")
    mockGate.glass = false
    expect(sheetBackground("#000000")).toBe("#000000")
    expect(sheetBackground()).toBe(BG_COLOR)
  })

  // KTD7: the reader's sheets take the system corner too. Their fill follows
  // the reader's theme in each route (readerSheetRoutes.test.tsx).
  it.each([
    [true, undefined],
    [false, 16],
  ])(
    "gives the reader sheets the shared corner (glass %s)",
    (glass, radius) => {
      mockGate.glass = glass
      let options!: Options
      jest.isolateModules(() => {
        options = jest.requireActual<{ READER_SHEET_SCREEN_OPTIONS: Options }>(
          "../bible/sheets/screenOptions",
        ).READER_SHEET_SCREEN_OPTIONS
      })
      expect(options.sheetCornerRadius).toBe(radius)
      expect(options).toMatchObject({
        presentation: "formSheet",
        sheetAllowedDetents: [0.65, 1],
      })
      expect(options).not.toHaveProperty("contentStyle")
    },
  )
})

const LAYOUTS = {
  watch: () =>
    jest.requireActual<{ default: () => Element }>(
      "../../../app/watch/_layout",
    ),
  series: () =>
    jest.requireActual<{ default: () => Element }>(
      "../../../app/series/_layout",
    ),
} as const

/** The layout's Stack options and each named screen's options. */
function loadLayout(layout: keyof typeof LAYOUTS, glass: boolean) {
  mockGate.glass = glass
  let root!: Element
  jest.isolateModules(() => {
    root = LAYOUTS[layout]().default()
  })
  const screens: Record<string, Options> = {}
  let stackOptions: Options | undefined
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (node == null || typeof node !== "object" || !("props" in node)) return
    const { props } = node as Element
    if (props.screenOptions) stackOptions = props.screenOptions
    if (typeof props.name === "string")
      screens[props.name] = props.options ?? {}
    visit(props.children)
  }
  visit(root)
  return { screens, stackOptions }
}

const SHEETS = ["language", "subtitle", "download"] as const

describe.each(["watch", "series"] as const)("the %s layout", (layout) => {
  it("gives each sheet the glass sheet on iOS 26", () => {
    const { screens } = loadLayout(layout, true)
    for (const name of SHEETS) {
      expect(screens[name]).not.toHaveProperty("sheetCornerRadius")
      expect(screens[name]).toMatchObject({
        presentation: "formSheet",
        contentStyle: { backgroundColor: "transparent" },
      })
    }
  })

  it("keeps each sheet's corner and solid fill without Liquid Glass", () => {
    const { screens } = loadLayout(layout, false)
    for (const name of SHEETS) {
      expect(screens[name]).toMatchObject({
        presentation: "formSheet",
        sheetCornerRadius: 16,
        contentStyle: { backgroundColor: BG_COLOR },
      })
    }
  })

  it.each([true, false])(
    "keeps each sheet's detents (Liquid Glass %s)",
    (glass) => {
      const { screens } = loadLayout(layout, glass)
      for (const name of ["language", "subtitle"]) {
        expect(screens[name]).toMatchObject({
          sheetAllowedDetents: [0.65, 1],
          sheetExpandsWhenScrolledToEdge: false,
        })
      }
      expect(screens.download).toMatchObject({
        sheetAllowedDetents: [0.65, 1],
      })
      expect(screens.download).not.toHaveProperty(
        "sheetExpandsWhenScrolledToEdge",
      )
    },
  )

  it("keeps the page's solid fill and edge back-swipe on iOS 26", () => {
    const { screens, stackOptions } = loadLayout(layout, true)
    expect(stackOptions).toEqual({
      contentStyle: { backgroundColor: BG_COLOR },
    })
    expect(screens["[slug]"]).not.toHaveProperty("contentStyle")
    expect(screens["[slug]"]).toMatchObject({
      gestureResponseDistance: BACK_SWIPE_RESPONSE_DISTANCE,
    })
  })
})
