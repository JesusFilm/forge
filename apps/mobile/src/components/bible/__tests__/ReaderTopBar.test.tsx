// The reader's top bar shows a running download's progress in the download
// button (feat-553 R29), and the icon for every other state.

import { act } from "react"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { READER_COPY } from "../../../lib/bible/reader/copy"
import type { TranslationLabel } from "../../../lib/bible/reader/labels"
import type { TranslationDownloadState } from "../../../lib/bible/repository/translationDownloads"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import { ReaderTopBar } from "../ReaderTopBar"

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

const TOKENS = readerTokens("classic", "dark")

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
  isFallback: false,
}

async function render(
  state: TranslationDownloadState | null,
  translation: TranslationLabel | null = BSB_LABEL,
  onPressTranslation: () => void = () => {},
) {
  await act(async () => {
    mounted = TestRenderer.create(
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
      />,
    )
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
  it("shows the percent while a download runs", async () => {
    const renderer = await render({
      kind: "downloading",
      phase: "transfer",
      percent: 45,
      bytesWritten: 450,
      totalBytes: 1000,
    })
    expect(textCount(renderer, "45%")).toBe(1)
  })

  it("shows no percent when the translation is on the device", async () => {
    const renderer = await render({ kind: "bundled" })
    expect(textCount(renderer, "45%")).toBe(0)
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
      READER_COPY.choosePassage("John 3:16"),
      BSB_LABEL.accessibilityLabel,
      "Download",
      READER_COPY.settings,
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

  it("marks a stand-in with the info icon and says why in its label (R25, R41)", async () => {
    const plain = await render({ kind: "bundled" })
    expect(iconCount(plain, "information-circle-outline")).toBe(0)
    await act(async () => mounted!.unmount())
    mounted = null

    const fallback: TranslationLabel = {
      text: "BSB",
      accessibilityLabel: READER_COPY.offlineStandInLabel(
        "Berean Standard Bible",
      ),
      isFallback: true,
    }
    const renderer = await render({ kind: "bundled" }, fallback)
    expect(iconCount(renderer, "information-circle-outline")).toBe(1)
    expect(textCount(renderer, "BSB")).toBe(1)
    expect(buttons(renderer)[1]!.props.accessibilityLabel).toBe(
      fallback.accessibilityLabel,
    )
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
