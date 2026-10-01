// The reader's top bar. The download button moved into the translation sheet
// (owner, 2026-10-01), so the translation pill shows a download's state.

import { act } from "react"
import { AccessibilityInfo } from "react-native"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { READER_COPY } from "../../../lib/bible/reader/copy"
import type { TranslationLabel } from "../../../lib/bible/reader/labels"
import type { PillDownloadStatus } from "../../../lib/bible/reader/labels"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import { ReaderTopBar, STAND_IN_TIP_MS } from "../ReaderTopBar"

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
  accessibilityLabel: READER_COPY.translation("Berean Standard Bible"),
  note: null,
  noteKey: null,
}

async function render(
  status: PillDownloadStatus | null,
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
        translationStatus={status}
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

/** The accessibility labels of a node and its owners, nearest first. */
function ownerLabels(node: RenderedNode): unknown[] {
  const labels: unknown[] = []
  for (let at: RenderedNode | null = node; at; at = at.parent ?? null) {
    labels.push(at.props.accessibilityLabel)
  }
  return labels
}

function textCount(renderer: TestInstance, text: string): number {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === text,
  ).length
}

describe("ReaderTopBar translation pill download status", () => {
  const inPill = (renderer: TestInstance, testID: string) =>
    renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === testID &&
        ownerLabels(node).includes(BSB_LABEL.accessibilityLabel),
    )

  it("has no download button: it moved into the translation sheet", async () => {
    const renderer = await render(null)
    expect(
      buttons(renderer).map((node) => node.props.accessibilityLabel),
    ).toEqual([
      READER_COPY.choosePassage("John 3:16"),
      BSB_LABEL.accessibilityLabel,
      READER_COPY.settings,
    ])
  })

  // The owner (2026-10-01): a ring in the pill while a download runs.
  it("shows a ring in the pill while a download runs, and no percent text", async () => {
    const renderer = await render({ kind: "downloading", progress: 0.45 })
    const [ring] = inPill(renderer, "reader-pill-download-ring")
    expect(ring).toBeDefined()
    const progress = renderer.root.findAll(
      (node) => typeof node.type !== "string" && node.props.progress === 0.45,
    )
    expect(progress).toHaveLength(1)
    expect(textCount(renderer, "45%")).toBe(0)
  })

  it("shows nothing in the pill with no status", async () => {
    const renderer = await render(null)
    expect(inPill(renderer, "reader-pill-download-ring")).toHaveLength(0)
    // The owner dropped a cloud-check for a finished download (2026-10-01).
    expect(iconCount(renderer, "cloud-done-outline")).toBe(0)
  })
})

// The owner moved the translation pill from the footer to the top bar
// (2026-09-27).
describe("ReaderTopBar translation pill", () => {
  it("sits right after the passage pill, before settings", async () => {
    const renderer = await render(null)
    expect(
      buttons(renderer).map((node) => node.props.accessibilityLabel),
    ).toEqual([
      READER_COPY.choosePassage("John 3:16"),
      BSB_LABEL.accessibilityLabel,
      READER_COPY.settings,
    ])
    expect(textCount(renderer, "BSB")).toBe(1)
  })

  it("opens the translation picker on a tap (R23)", async () => {
    const onPress = jest.fn()
    const renderer = await render(null, BSB_LABEL, onPress)
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
    const renderer = await render(null)
    expect(iconCount(renderer, "information-circle-outline")).toBe(0)
  })

  it("is disabled while the translation is not known yet", async () => {
    const renderer = await render(null, null)
    const [, translation] = buttons(renderer)
    expect(translation!.props.accessibilityLabel).toBe(
      READER_COPY.chooseTranslationWaiting,
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
    const renderer = await render(null, STAND_IN)
    expect(
      buttons(renderer).map((node) => node.props.accessibilityLabel),
    ).toEqual([
      READER_COPY.choosePassage("John 3:16"),
      READER_COPY.translation("Berean Standard Bible"),
      NOTE,
      READER_COPY.settings,
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
      READER_COPY.translation("Berean Standard Bible"),
    )
  })

  it("shows the note on a tap, says it aloud, and hides it on the next tap", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {})
    const renderer = await render(null, STAND_IN)
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
    const renderer = await render(null, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    await act(async () => {
      jest.advanceTimersByTime(STAND_IN_TIP_MS)
    })
    expect(tips(renderer)).toHaveLength(0)

    await pressInfo(renderer)
    expect(tips(renderer)).toHaveLength(1)
    // The reader moves to a book the pick has: no note, no button.
    await render(null, BSB_LABEL)
    expect(tips(renderer)).toHaveLength(0)
    expect(iconCount(renderer, "information-circle-outline")).toBe(0)
    jest.useRealTimers()
  })

  // The note names the book as the shown text does, and that name can load
  // after the tap. The tip follows the stand-in, not its text (code review).
  it("keeps the tip open when the same stand-in's note text changes", async () => {
    const renderer = await render(null, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    const loaded = NOTE.replace("Deuteronomy", "Второзаконие")
    await render(null, { ...STAND_IN, note: loaded })
    expect(tips(renderer)).toHaveLength(1)
    expect(textCount(renderer, loaded)).toBe(1)
  })

  it("does not open the tip by itself when the same stand-in returns", async () => {
    const renderer = await render(null, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    await render(null, BSB_LABEL)
    await render(null, STAND_IN)
    await layout(renderer)
    expect(tips(renderer)).toHaveLength(0)
  })

  it("closes the tip when another stand-in takes over", async () => {
    const renderer = await render(null, STAND_IN)
    await layout(renderer)
    await pressInfo(renderer)
    await render(null, { ...STAND_IN, noteKey: "offline-stand-in:BSB" })
    expect(tips(renderer)).toHaveLength(0)
  })
})
