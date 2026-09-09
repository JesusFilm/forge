/**
 * R16, R24 and R30 on the RENDERED series control. The row's tap is what must
 * never reach the pause-all handler while a raw export runs, so every assertion
 * reads the rendered Pressable and the glyph inside it (KTD6).
 */

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
// Ionicons requires native font modules at import time under jest. The stand-in
// records what the row asked for, so the glyph is assertable.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: (props: { name: string; color: string }) => {
    mockIcons.push({ name: props.name, color: props.color })
    return null
  },
}))
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  __esModule: true,
  default: () => null,
}))

import { act } from "react"

import { SeriesActionRow } from "../SeriesActionRow"
import { EXPORT_IN_PROGRESS_COLOR } from "../../../lib/downloadGlyph"
import type { SeriesDownloadState } from "../../../lib/seriesDownloadAggregate"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockIcons: { name: string; color: string }[] = []

const state = (
  overrides: Partial<SeriesDownloadState> = {},
): SeriesDownloadState => ({
  downloaded: 0,
  total: 3,
  inProgress: false,
  pausedAggregate: false,
  inFlightSlugs: [],
  progress: 0,
  exporting: false,
  exportProgress: 0,
  exportingSlugs: [],
  ...overrides,
})

const onDownload = jest.fn()
const onCancelExport = jest.fn()

// `null` means the route wired no cancel handler. It cannot be `undefined`: a
// default parameter fires for an explicit undefined, restoring the handler.
async function render(
  downloadState: SeriesDownloadState,
  cancel: (() => void) | null = onCancelExport,
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <SeriesActionRow
        onLanguage={() => {}}
        onSubtitles={() => {}}
        onDownload={onDownload}
        onShare={() => {}}
        downloadState={downloadState}
        onCancelExport={cancel ?? undefined}
      />,
    )
  })
  return renderer
}

/** The one label on the download-all control, whatever state it is in. */
function downloadLabel(renderer: TestInstance): string {
  const labels = renderer.root
    .findAll(
      (n) =>
        typeof n.props.accessibilityLabel === "string" &&
        n.props.accessibilityLabel !== "Share" &&
        !n.props.accessibilityLabel.startsWith("Language,") &&
        !n.props.accessibilityLabel.startsWith("Subtitles,"),
    )
    .map((n) => String(n.props.accessibilityLabel))
  expect(labels.length).toBeGreaterThan(0)
  return labels[0]
}

function labelled(renderer: TestInstance, label: string): RenderedNode[] {
  return renderer.root.findAll((n) => n.props.accessibilityLabel === label)
}

async function pressAll(nodes: RenderedNode[]) {
  await act(async () => {
    for (const node of nodes) node.props.onPress?.()
  })
}

beforeEach(() => {
  mockIcons.length = 0
  onDownload.mockClear()
  onCancelExport.mockClear()
})

describe("SeriesActionRow download-all control", () => {
  describe("with a raw export in flight", () => {
    const exporting = state({
      exporting: true,
      exportProgress: 0.4,
      exportingSlugs: ["b"],
    })

    it("names the export and never speaks of a pause (R16, R24)", async () => {
      const renderer = await render(exporting)
      const label = downloadLabel(renderer)
      expect(label).toBe("Saving to Photos. Tap to cancel")
      expect(label.toLowerCase()).not.toContain("pause")
    })

    it("draws the export glyph in the ring", async () => {
      await render(exporting)
      const names = mockIcons.map((icon) => icon.name)
      expect(names).toContain("arrow-up")
      expect(names).not.toContain("pause")
      expect(mockIcons.find((icon) => icon.name === "arrow-up")?.color).toBe(
        EXPORT_IN_PROGRESS_COLOR,
      )
    })

    it("reaches the cancel control, never the pause-all handler (R30)", async () => {
      const renderer = await render(exporting)
      await pressAll(labelled(renderer, "Saving to Photos. Tap to cancel"))
      expect(onCancelExport).toHaveBeenCalledTimes(1)
      expect(onDownload).not.toHaveBeenCalled()
    })

    it("shows the export over live episode downloads (R16)", async () => {
      const renderer = await render(
        state({
          exporting: true,
          exportProgress: 0.4,
          exportingSlugs: ["b"],
          inProgress: true,
          inFlightSlugs: ["a"],
          progress: 0.7,
        }),
      )
      expect(downloadLabel(renderer)).toBe("Saving to Photos. Tap to cancel")
      await pressAll(labelled(renderer, "Saving to Photos. Tap to cancel"))
      expect(onDownload).not.toHaveBeenCalled()
    })

    it("shows the export over a fully downloaded series (R16)", async () => {
      const renderer = await render(
        state({
          downloaded: 3,
          exporting: true,
          exportProgress: 0.4,
          exportingSlugs: ["b"],
        }),
      )
      expect(downloadLabel(renderer)).toBe("Saving to Photos. Tap to cancel")
      expect(mockIcons.map((icon) => icon.name)).not.toContain(
        "checkmark-circle-outline",
      )
    })

    it("promises no tap it cannot honour when no cancel is wired", async () => {
      const renderer = await render(exporting, null)
      const label = downloadLabel(renderer)
      expect(label).toBe("Saving to Photos")
      const nodes = labelled(renderer, label)
      expect(nodes.some((n) => typeof n.props.onPress === "function")).toBe(
        false,
      )
      await pressAll(nodes)
      expect(onDownload).not.toHaveBeenCalled()
    })
  })

  // Anti-vacuous controls: without an export the same rendered control still
  // pauses, resumes and opens the download sheet.
  describe("without an export", () => {
    it("keeps the pause-all affordance while episodes download", async () => {
      const renderer = await render(
        state({ inProgress: true, inFlightSlugs: ["a"], progress: 0.3 }),
      )
      const label = downloadLabel(renderer)
      expect(label).toBe("Pause downloads")
      expect(mockIcons.map((icon) => icon.name)).toContain("pause")
      await pressAll(labelled(renderer, label))
      expect(onDownload).toHaveBeenCalledTimes(1)
      expect(onCancelExport).not.toHaveBeenCalled()
    })

    it("keeps the resume affordance while episodes are paused", async () => {
      const renderer = await render(
        state({
          inProgress: true,
          pausedAggregate: true,
          inFlightSlugs: ["a"],
        }),
      )
      const label = downloadLabel(renderer)
      expect(label).toBe("Downloads paused. Tap for resume or cancel options")
      expect(mockIcons.map((icon) => icon.name)).toContain("play")
      await pressAll(labelled(renderer, label))
      expect(onDownload).toHaveBeenCalledTimes(1)
    })

    it("keeps the idle download-all tap", async () => {
      const renderer = await render(state())
      const label = downloadLabel(renderer)
      expect(label).toBe("Download all")
      await pressAll(labelled(renderer, label))
      expect(onDownload).toHaveBeenCalledTimes(1)
    })
  })
})
