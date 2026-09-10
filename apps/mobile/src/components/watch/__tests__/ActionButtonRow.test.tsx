/**
 * AE12 / R16 / R24 on the RENDERED control. The resolver's return value is not
 * the seam KTD6 names: this row used to compute its own in-progress glyph and
 * label, so a widened resolver alone would leave the ring offering a pause.
 * Every assertion here reads the rendered Pressable and the glyph inside it.
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

import { ActionButtonRow } from "../ActionButtonRow"
import { EXPORT_IN_PROGRESS_COLOR } from "../../../lib/downloadGlyph"
import type { ExportSessionEntry } from "../../../lib/exportSession"
import type { OfflineDownloadState } from "../../../lib/offlineManifest"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockIcons: { name: string; color: string }[] = []

const exportEntry = (
  overrides: Partial<ExportSessionEntry> = {},
): ExportSessionEntry => ({
  target: "birth-of-jesus",
  runId: "run-1",
  title: "The Birth of Jesus",
  seriesSlug: null,
  progress: 0.42,
  cancelRequested: false,
  ...overrides,
})

type RowProps = {
  downloadState?: OfflineDownloadState | null
  downloadProgress?: number | null
  exportEntry?: ExportSessionEntry | null
}

const onDownload = jest.fn()

async function render(props: RowProps = {}): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <ActionButtonRow
        onDownload={onDownload}
        onLanguage={() => {}}
        onSubtitles={() => {}}
        onShare={() => {}}
        downloadState={props.downloadState ?? null}
        downloadProgress={props.downloadProgress ?? null}
        exportEntry={props.exportEntry ?? null}
      />,
    )
  })
  return renderer
}

/** Every node carrying this spoken label — the composite and its host view. */
function labelled(renderer: TestInstance, label: string): RenderedNode[] {
  return renderer.root.findAll((n) => n.props.accessibilityLabel === label)
}

/** The one label on the download control, whatever state it is in. */
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

async function pressAll(nodes: RenderedNode[]) {
  await act(async () => {
    for (const node of nodes) node.props.onPress?.()
  })
}

beforeEach(() => {
  mockIcons.length = 0
  onDownload.mockClear()
})

describe("ActionButtonRow download control", () => {
  describe("with a raw export in flight (AE12)", () => {
    it("names the export and never speaks of a pause", async () => {
      const renderer = await render({ exportEntry: exportEntry() })
      const label = downloadLabel(renderer)
      expect(label).toBe("Saving to Photos, 42%")
      expect(label.toLowerCase()).not.toContain("pause")
    })

    it("neither opens the sheet nor pauses the transfer when pressed", async () => {
      const renderer = await render({ exportEntry: exportEntry() })
      const nodes = labelled(renderer, "Saving to Photos, 42%")
      expect(nodes.length).toBeGreaterThan(0)
      expect(nodes.some((n) => typeof n.props.onPress === "function")).toBe(
        false,
      )
      expect(nodes.some((n) => n.props.disabled === true)).toBe(true)
      await pressAll(nodes)
      expect(onDownload).not.toHaveBeenCalled()
    })

    it("draws the export glyph in the ring, not a download one", async () => {
      await render({ exportEntry: exportEntry() })
      const names = mockIcons.map((icon) => icon.name)
      expect(names).toContain("arrow-up")
      expect(names).not.toContain("pause")
      expect(names).not.toContain("arrow-down")
      expect(mockIcons.find((icon) => icon.name === "arrow-up")?.color).toBe(
        EXPORT_IN_PROGRESS_COLOR,
      )
    })

    it("shows the export over an existing offline copy (R16)", async () => {
      const renderer = await render({
        downloadState: "downloaded",
        exportEntry: exportEntry(),
      })
      expect(downloadLabel(renderer)).toBe("Saving to Photos, 42%")
      const names = mockIcons.map((icon) => icon.name)
      expect(names).toContain("arrow-up")
      expect(names).not.toContain("checkmark-circle-outline")
    })

    it("shows the export over a live offline transfer (R16)", async () => {
      const renderer = await render({
        downloadState: "downloading",
        downloadProgress: 0.9,
        exportEntry: exportEntry(),
      })
      expect(downloadLabel(renderer)).toBe("Saving to Photos, 42%")
      expect(mockIcons.map((icon) => icon.name)).not.toContain("pause")
    })
  })

  // Anti-vacuous controls: the assertions above must be able to fail. Without an
  // export the same rendered control still pauses, resumes and opens the sheet.
  describe("without an export", () => {
    it("keeps the pause affordance while a download runs", async () => {
      const renderer = await render({
        downloadState: "downloading",
        downloadProgress: 0.5,
      })
      const label = downloadLabel(renderer)
      expect(label).toBe("Downloading, 50%. Tap to pause")
      expect(mockIcons.map((icon) => icon.name)).toContain("pause")
      await pressAll(labelled(renderer, label))
      expect(onDownload).toHaveBeenCalledTimes(1)
    })

    it("keeps the resume affordance while a download is paused", async () => {
      const renderer = await render({
        downloadState: "paused",
        downloadProgress: 0.5,
      })
      const label = downloadLabel(renderer)
      expect(label).toBe("Download paused. Tap to resume or remove")
      expect(mockIcons.map((icon) => icon.name)).toContain("play")
      await pressAll(labelled(renderer, label))
      expect(onDownload).toHaveBeenCalledTimes(1)
    })

    it("keeps the idle download tap", async () => {
      const renderer = await render()
      const label = downloadLabel(renderer)
      expect(label).toBe("Download")
      expect(mockIcons.map((icon) => icon.name)).toContain("download-outline")
      await pressAll(labelled(renderer, label))
      expect(onDownload).toHaveBeenCalledTimes(1)
    })
  })
})
