/**
 * The download button's glyph (feat-551 U10, R29, R30): the progress in
 * numbers while a download runs, else an icon for the state. The button
 * around it carries the accessible name, so the glyph adds none.
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

import { act } from "react"
import { StyleSheet } from "react-native"

import type { TranslationDownloadState } from "../../../../lib/bible/repository/translationDownloads"
import { readerTokens } from "../../../../lib/bible/theme/palettes"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import {
  ReaderDownloadGlyph,
  downloadGlyphIcon,
  downloadProgressText,
} from "../ReaderDownloadGlyph"

const TOKENS = readerTokens("classic", "light")

let mounted: TestInstance | null = null

async function render(state: TranslationDownloadState | null) {
  await act(async () => {
    mounted = TestRenderer.create(
      <ReaderDownloadGlyph state={state} tokens={TOKENS} />,
    )
  })
  return mounted!
}

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

const RUNNING: TranslationDownloadState = {
  kind: "downloading",
  phase: "transfer",
  percent: 44.6,
  bytesWritten: 446,
  totalBytes: 1000,
}

describe("ReaderDownloadGlyph", () => {
  it("shows the progress while a download runs", async () => {
    const renderer = await render(RUNNING)
    const texts = renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.children === "45%",
    )
    expect(texts).toHaveLength(1)
    const style = StyleSheet.flatten(texts[0]?.props.style as never) as {
      color?: string
    }
    expect(style.color).toBe(TOKENS.icon)
    expect(renderer.root.findAll((node) => "name" in node.props)).toHaveLength(
      0,
    )
  })

  it("adds no second accessible name inside the button", async () => {
    const renderer = await render(RUNNING)
    const named = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.accessibilityLabel === "string",
    )
    expect(named).toHaveLength(0)
    const [text] = renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.children === "45%",
    )
    expect(text?.props.accessible).toBe(false)
  })

  it.each<[string, TranslationDownloadState | null, string]>([
    ["BSB", { kind: "bundled" }, "cloud-done-outline"],
    [
      "a download",
      {
        kind: "downloaded",
        sha256: "a".repeat(64),
        books: new Set(),
        bytes: 1,
      },
      "cloud-done-outline",
    ],
    [
      "a stopped download",
      { kind: "failed", reason: "network" },
      "alert-circle-outline",
    ],
    ["no download", { kind: "not-downloaded" }, "cloud-download-outline"],
    ["the first check", { kind: "checking" }, "cloud-download-outline"],
    ["no translation yet", null, "cloud-download-outline"],
  ])("shows an icon for %s", async (_name, state, icon) => {
    expect(downloadGlyphIcon(state)).toBe(icon)
    const renderer = await render(state)
    const icons = renderer.root.findAll((node) => node.props.name === icon)
    expect(icons).toHaveLength(1)
    expect(icons[0]?.props.color).toBe(TOKENS.icon)
  })

  it("rounds the percent and keeps it between 0 and 100", () => {
    expect(downloadProgressText(RUNNING)).toBe("45%")
    expect(
      downloadProgressText({ ...RUNNING, phase: "install", percent: 100 }),
    ).toBe("100%")
    expect(downloadProgressText({ ...RUNNING, percent: -3 })).toBe("0%")
    expect(downloadProgressText({ ...RUNNING, percent: 180 })).toBe("100%")
    expect(downloadProgressText({ kind: "bundled" })).toBeNull()
    expect(downloadProgressText(null)).toBeNull()
  })
})
