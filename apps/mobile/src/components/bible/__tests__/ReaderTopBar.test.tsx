// The reader's top bar shows a running download's progress in the download
// button (feat-553 R29), and the icon for every other state.

import { act } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
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

async function render(state: TranslationDownloadState | null) {
  await act(async () => {
    mounted = TestRenderer.create(
      <ReaderTopBar
        tokens={TOKENS}
        safeAreaTop={0}
        passage="John 3:16"
        onPressPassage={() => {}}
        pulse={0}
        reduceMotion
        download={{ state, accessibilityLabel: "Download" }}
        onPressDownload={() => {}}
        onPressSettings={() => {}}
      />,
    )
  })
  return mounted!
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
