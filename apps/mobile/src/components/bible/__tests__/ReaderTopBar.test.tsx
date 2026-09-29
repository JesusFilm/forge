// The reader's top bar shows a running download's progress as a ring in the
// download button (feat-553 R29), and the icon for every other state.

import { act } from "react"
import { AccessibilityInfo } from "react-native"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { TranslationLabel } from "../../../lib/bible/reader/labels"
import type { TranslationDownloadState } from "../../../lib/bible/repository/translationDownloads"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import { ReaderTopBar, STAND_IN_TIP_MS } from "../ReaderTopBar"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { getT } from "../../../i18n/useT"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"

const readerT = getT("BibleReader")

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
// A fixture `ru` catalog joins the real set; English cases never start the
// store, so they read en.json as before.
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        ru: {
          Common: { goBackAriaLabel: "Назад" },
          BibleReader: {
            settingsAriaLabel: "Настройки чтения",
            choosePassageAriaLabel: "{passage}. Выбрать отрывок",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["ru"],
    ),
)
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => false,
  isGlassEffectAPIAvailable: () => false,
}))
// Liquid Glass is off above, so the button's content renders inside this.
jest.mock("../../ui/PlatformBlur", () => ({
  PlatformBlur: ({ children }: { children: unknown }) => children,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: (props: { name: string }) => props.name,
}))

const TOKENS = readerTokens("dark")

let mounted: TestInstance | null = null

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

const BSB_LABEL: TranslationLabel = {
  text: "BSB",
  accessibilityLabel: readerT("translationAriaLabel", {
    name: "Berean Standard Bible",
  }),
  note: null,
  noteKey: null,
}

async function render(
  state: TranslationDownloadState | null,
  translation: TranslationLabel | null = BSB_LABEL,
  onPressTranslation: () => void = () => {},
) {
  await act(async () => {
    const bar = (
      <ReaderTopBar
        tokens={TOKENS}
        safeAreaTop={0}
        passage="John 3:16"
        onPressPassage={() => {}}
        pulse={0}
        reduceMotion
        translation={translation}
        onPressTranslation={onPressTranslation}
        download={{ state, accessibilityLabel: "Download" }}
        onPressDownload={() => {}}
        onPressSettings={() => {}}
      />
    )
    // A second render updates the same bar, as a parent's new props do.
    if (mounted) mounted.update(bar)
    else mounted = TestRenderer.create(bar)
  })
  return mounted!
}

function buttons(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button",
  )
}

// The Ionicons mock renders its name as a raw string, so match the element.
function iconCount(renderer: TestInstance, name: string): number {
  return renderer.root.findAll(
    (node) => typeof node.type !== "string" && node.props.name === name,
  ).length
}

function textCount(renderer: TestInstance, text: string): number {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === text,
  ).length
}

describe("ReaderTopBar download button", () => {
  const rings = (renderer: TestInstance) =>
    renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === "reader-download-ring",
    )

  // A ring, as on the watch page, and no percent text (owner, 2026-09-28).
  it("shows a ring, not a percent, while a download runs", async () => {
    const renderer = await render({
      kind: "downloading",
      phase: "transfer",
      percent: 45,
      bytesWritten: 450,
      totalBytes: 1000,
    })
    expect(rings(renderer)).toHaveLength(1)
    expect(textCount(renderer, "45%")).toBe(0)
  })

  it("shows no ring when the translation is on the device", async () => {
    const renderer = await render({ kind: "bundled" })
    expect(rings(renderer)).toHaveLength(0)
    expect(iconCount(renderer, "cloud-done-outline")).toBe(1)
  })
})

// The owner moved the translation pill from the footer to the top bar
// (2026-09-27).
describe("ReaderTopBar translation pill", () => {
  it("sits right after the passage pill, before download and settings", async () => {
    const renderer = await render({ kind: "bundled" })
    expect(
      buttons(renderer).map((node) => node.props.accessibilityLabel),
    ).toEqual([
      readerT("choosePassageAriaLabel", { passage: "John 3:16" }),
      BSB_LABEL.accessibilityLabel,
      "Download",
      readerT("settingsAriaLabel"),
    ])
    expect(textCount(renderer, "BSB")).toBe(1)
  })

  it("opens the translation picker on a tap (R23)", async () => {
    const onPress = jest.fn()
    const renderer = await render({ kind: "bundled" }, BSB_LABEL, onPress)
    // The Pressable itself holds `onPress`; its host View does not.
    const [pressable] = renderer.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.props.accessibilityLabel === BSB_LABEL.accessibilityLabel,
    )
    await act(async () => (pressable!.props.onPress as () => void)())
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("has no info button for the viewer's own translation", async () => {
    const renderer = await render({ kind: "bundled" })
    expect(iconCount(renderer, "information-circle-outline")).toBe(0)
  })

  it("is disabled while the translation is not known yet", async () => {
    const renderer = await render(null, null)
    const [, translation] = buttons(renderer)
    expect(translation!.props.accessibilityLabel).toBe(
      readerT("chooseTranslationWaitingAriaLabel"),
    )
    expect(translation!.props.accessibilityState).toMatchObject({
      disabled: true,
    })
  })
})

// The owner (2026-09-28): the stand-in's info icon sits right of the pill, not
// inside it, and a tap shows why in a small note (R25, R41).
describe("ReaderTopBar stand-in note", () => {
  const NOTE =
    "KAMIITHARI ÑAANTSI does not include Deuteronomy. The reader shows it in Berean Standard Bible."
  const STAND_IN: TranslationLabel = {
    ...BSB_LABEL,
    note: NOTE,
    noteKey: "book-fallback:BSB",
  }

  const tips = (renderer: TestInstance) =>
    renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === "bible-stand-in-tip",
    )

  /** The renderer has no layout: report the bar's rows by hand. */
  async function layout(renderer: TestInstance) {
    const measured = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.onLayout === "function",
    )
    await act(async () => {
      for (const node of measured) {
        ;(node.props.onLayout as (event: unknown) => void)({
          nativeEvent: { layout: { x: 20, y: 4, width: 44, height: 44 } },
        })
      }
    })
  }

  async function pressInfo(renderer: TestInstance) {
    const [info] = renderer.root.findAll(
      (node) =>
        node.props.testID === "bible-stand-in-info" &&
        typeof node.props.onPress === "function",
    )
    await act(async () => (info!.props.onPress as () => void)())
  }

  it("puts the info button right of the pill, with the note as its label", async () => {
    const renderer = await render({ kind: "bundled" }, STAND_IN)
    expect(
      buttons(renderer).map((node) => node.props.accessibilityLabel),
    ).toEqual([
      readerT("choosePassageAriaLabel", { passage: "John 3:16" }),
      readerT("translationAriaLabel", { name: "Berean Standard Bible" }),
      NOTE,
      "Download",
      readerT("settingsAriaLabel"),
    ])
    // The icon is inside its own button, not inside the translation pill.
    expect(iconCount(renderer, "information-circle-outline")).toBe(1)
    const [icon] = renderer.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.name === "information-circle-outline",
    )
    // The renderer wraps each node anew, so compare the owners' labels.
    const owners: unknown[] = []
    for (let node = icon?.parent ?? null; node; node = node.parent ?? null) {
      owners.push(node.props.accessibilityLabel)
    }
    expect(owners).toContain(NOTE)
    expect(owners).not.toContain(
      readerT("translationAriaLabel", { name: "Berean Standard Bible" }),
    )
  })

  it("shows the note on a tap, says it aloud, and hides it on the next tap", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {})
    const renderer = await render({ kind: "bundled" }, STAND_IN)
    await layout(renderer)
    expect(tips(renderer)).toHaveLength(0)

    await pressInfo(renderer)
    expect(tips(renderer)).toHaveLength(1)
    expect(textCount(renderer, NOTE)).toBe(1)
    expect(announce).toHaveBeenCalledWith(NOTE)

    await pressInfo(renderer)
    expect(tips(renderer)).toHaveLength(0)
    announce.mockRestore()
  })

  it("hides the note after a few seconds, and when the stand-in ends", async () => {
    jest.useFakeTimers()
    const renderer = await render({ kind: "bundled" }, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    await act(async () => {
      jest.advanceTimersByTime(STAND_IN_TIP_MS)
    })
    expect(tips(renderer)).toHaveLength(0)

    await pressInfo(renderer)
    expect(tips(renderer)).toHaveLength(1)
    // The reader moves to a book the pick has: no note, no button.
    await render({ kind: "bundled" }, BSB_LABEL)
    expect(tips(renderer)).toHaveLength(0)
    expect(iconCount(renderer, "information-circle-outline")).toBe(0)
    jest.useRealTimers()
  })

  // The note names the book as the shown text does, and that name can load
  // after the tap. The tip follows the stand-in, not its text (code review).
  it("keeps the tip open when the same stand-in's note text changes", async () => {
    const renderer = await render({ kind: "bundled" }, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    const loaded = NOTE.replace("Deuteronomy", "Второзаконие")
    await render({ kind: "bundled" }, { ...STAND_IN, note: loaded })
    expect(tips(renderer)).toHaveLength(1)
    expect(textCount(renderer, loaded)).toBe(1)
  })

  it("does not open the tip by itself when the same stand-in returns", async () => {
    const renderer = await render({ kind: "bundled" }, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    await render({ kind: "bundled" }, BSB_LABEL)
    await render({ kind: "bundled" }, STAND_IN)
    await layout(renderer)
    expect(tips(renderer)).toHaveLength(0)
  })

  it("closes the tip when another stand-in takes over", async () => {
    const renderer = await render({ kind: "bundled" }, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    await render(
      { kind: "bundled" },
      { ...STAND_IN, noteKey: "offline-stand-in:BSB" },
    )
    expect(tips(renderer)).toHaveLength(0)
  })
})

describe("ReaderTopBar in another UI language", () => {
  afterEach(() => {
    resetLocaleStoreForTests()
    mockGetLocales.mockReset()
  })

  function buttonLabelled(renderer: TestInstance, label: string) {
    const [button] = buttons(renderer).filter(
      (node) => node.props.accessibilityLabel === label,
    )
    if (!button) throw new Error(`no button labelled "${label}"`)
    return button
  }

  it("keeps each control's Datadog name when its label changes language", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    const renderer = await render({ kind: "bundled" })
    const english = [
      tapActionName(buttonLabelled(renderer, "Reader settings")),
      tapActionName(buttonLabelled(renderer, "John 3:16. Choose a passage")),
    ]

    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    await act(async () => {
      refreshLocale()
    })

    const russian = [
      tapActionName(buttonLabelled(renderer, "Настройки чтения")),
      tapActionName(buttonLabelled(renderer, "John 3:16. Выбрать отрывок")),
    ]
    expect(english).toEqual(["bible-reader-settings", "bible-reader-passage"])
    expect(russian).toEqual(english)
  })
})
