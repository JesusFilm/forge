/**
 * The download button's glyph (feat-553 U10, R29, R30): a progress ring
 * while a download runs, else an icon for the state. The button
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
  downloadProgress,
} from "../ReaderDownloadGlyph"

const TOKENS = readerTokens("light")

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

/** The rotation a ring layer draws at, in degrees. */
function turnOf(renderer: TestInstance, testID: string): number {
  const [layer] = renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )
  const style = StyleSheet.flatten(layer?.props.style as never) as {
    transform?: { rotate?: string }[]
  }
  const rotate = style.transform?.find((step) => "rotate" in step)?.rotate
  return Number.parseFloat(rotate ?? "NaN")
}

describe("ReaderDownloadGlyph", () => {
  // The owner (2026-09-28): a ring, as on the watch page, and no percent text.
  // A Bible download only cancels, so the center is an X, not a pause.
  it("draws a ring with an X while a download runs", async () => {
    const renderer = await render(RUNNING)
    expect(
      renderer.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.testID === "reader-download-ring",
      ),
    ).toHaveLength(1)
    const cancel = renderer.root.findAll((node) => node.props.name === "close")
    expect(cancel).toHaveLength(1)
    expect(cancel[0]?.props.color).toBe(TOKENS.icon)
    for (const other of ["pause", "stop"]) {
      expect(
        renderer.root.findAll((node) => node.props.name === other),
      ).toHaveLength(0)
    }
    const percents = renderer.root.findAll(
      (node) =>
        typeof node.props.children === "string" &&
        node.props.children.endsWith("%"),
    )
    expect(percents).toHaveLength(0)
  })

  it("adds no second accessible name inside the button", async () => {
    const renderer = await render(RUNNING)
    const named = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.accessibilityLabel === "string",
    )
    expect(named).toHaveLength(0)
    const [ring] = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === "reader-download-ring",
    )
    expect(ring?.props.accessible).toBe(false)
    expect(ring?.props.importantForAccessibility).toBe("no-hide-descendants")
  })

  // The right half ring turns into view over the first half, the left half
  // over the second; 45deg shows the right half, 225deg the left half.
  it.each<[number, number, number]>([
    [0, -135, 45],
    [25, -45, 45],
    [50, 45, 45],
    [75, 45, 135],
    [100, 45, 225],
  ])("turns the arc to %d%%", async (percent, right, left) => {
    const renderer = await render({ ...RUNNING, percent })
    expect(turnOf(renderer, "reader-progress-ring-right")).toBeCloseTo(right)
    expect(turnOf(renderer, "reader-progress-ring-left")).toBeCloseTo(left)
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

  it("keeps the progress between 0 and 1", () => {
    expect(downloadProgress(RUNNING)).toBeCloseTo(0.446)
    expect(
      downloadProgress({ ...RUNNING, phase: "install", percent: 100 }),
    ).toBe(1)
    expect(downloadProgress({ ...RUNNING, percent: -3 })).toBe(0)
    expect(downloadProgress({ ...RUNNING, percent: 180 })).toBe(1)
    expect(downloadProgress({ kind: "bundled" })).toBeNull()
    expect(downloadProgress(null)).toBeNull()
  })
})
