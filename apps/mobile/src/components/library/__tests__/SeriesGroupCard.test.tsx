// A series card opens itself when the Downloads screen asks (KTD5), with no
// layout animation, and a header tap still toggles it. The `react` re-points
// follow src/components/profile/__tests__/MyWatchHeader.test.tsx.

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
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../DownloadRow", () => ({
  DownloadRow: function MockDownloadRow() {
    return null
  },
}))
jest.mock("../SelectionCheckbox", () => ({ SelectionCheckbox: () => null }))
jest.mock("../../ui/AnimatedChevron", () => ({
  AnimatedChevron: () => null,
  animateLayout: jest.fn(),
}))

import { act } from "react"

import { DownloadRow } from "../DownloadRow"
import { SeriesGroupCard, type SeriesGroupCardProps } from "../SeriesGroupCard"
import { animateLayout } from "../../ui/AnimatedChevron"
import { buildLibraryViewModel } from "../../../lib/libraryDownloads"
import type { OfflineDownloadRecord } from "../../../lib/offlineManifest"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockedAnimateLayout = jest.mocked(animateLayout)

function episode(videoSlug: string, index: number): OfflineDownloadRecord {
  return {
    version: 1,
    videoSlug,
    dubDocumentId: `dub-${videoSlug}`,
    renditionDocumentId: `rendition-${videoSlug}`,
    qualityLabel: "High",
    title: videoSlug,
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: `/downloads/${videoSlug}.mp4`,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 1024,
    totalBytes: 1024,
    seriesSlug: "the-chosen",
    seriesTitle: "The Chosen",
    seriesEpisodeIndex: index,
  }
}

const GROUP = buildLibraryViewModel([episode("ep-1", 1), episode("ep-2", 2)])
  .seriesGroups[0]!
const HEADER_LABEL = "The Chosen, 2 videos"

function element(overrides: Partial<SeriesGroupCardProps> = {}) {
  return (
    <SeriesGroupCard
      group={GROUP}
      onRowPress={() => {}}
      onRetry={() => {}}
      onResume={() => {}}
      {...overrides}
    />
  )
}

async function render(
  overrides: Partial<SeriesGroupCardProps> = {},
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element(overrides))
  })
  return renderer
}

function episodeRows(renderer: TestInstance): number {
  return renderer.root.findAll((node) => node.type === DownloadRow).length
}

afterEach(() => {
  mockedAnimateLayout.mockClear()
})

describe("SeriesGroupCard video count", () => {
  /** The meta line interpolates the count, so its children are an array. */
  function metaHas(renderer: TestInstance, text: string): boolean {
    return (
      renderer.root.findAll(
        (node) =>
          Array.isArray(node.props.children) &&
          (node.props.children as unknown[]).includes(text),
      ).length > 0
    )
  }

  it("says 1 video for a one-episode series, in the row and in its label", async () => {
    const single = buildLibraryViewModel([episode("ep-1", 1)]).seriesGroups[0]!
    const renderer = await render({ group: single })

    expect(metaHas(renderer, "1 video")).toBe(true)
    expect(pressableByLabel(renderer, "The Chosen, 1 video")).toBeTruthy()
    await unmount(renderer)
  })

  it("says 2 videos for a two-episode series", async () => {
    const renderer = await render()

    expect(metaHas(renderer, "2 videos")).toBe(true)
    expect(pressableByLabel(renderer, HEADER_LABEL)).toBeTruthy()
    await unmount(renderer)
  })
})

describe("SeriesGroupCard expansion", () => {
  it("renders collapsed without the input", async () => {
    const renderer = await render()
    expect(episodeRows(renderer)).toBe(0)
    expect(
      pressableByLabel(renderer, HEADER_LABEL).props.accessibilityState,
    ).toEqual({ expanded: false })
    await unmount(renderer)
  })

  it("renders expanded with the input, with no layout animation", async () => {
    const renderer = await render({ initiallyExpanded: true })
    expect(episodeRows(renderer)).toBe(2)
    expect(
      pressableByLabel(renderer, HEADER_LABEL).props.accessibilityState,
    ).toEqual({ expanded: true })
    // Instant, so Reduce Motion needs no special case (KTD5).
    expect(mockedAnimateLayout).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("still toggles on a header tap after it opened itself", async () => {
    const renderer = await render({ initiallyExpanded: true })

    await press(pressableByLabel(renderer, HEADER_LABEL))
    expect(episodeRows(renderer)).toBe(0)
    await press(pressableByLabel(renderer, HEADER_LABEL))
    expect(episodeRows(renderer)).toBe(2)
    expect(mockedAnimateLayout).toHaveBeenCalledTimes(2)
    await unmount(renderer)
  })

  it("opens a mounted card when the input turns true later", async () => {
    // A reused Downloads screen that gets a new `series` value.
    const renderer = await render()
    expect(episodeRows(renderer)).toBe(0)

    await act(async () => {
      renderer.update(element({ initiallyExpanded: true }))
    })

    expect(episodeRows(renderer)).toBe(2)
    expect(mockedAnimateLayout).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("reports its slug and y, so the screen can scroll to it", async () => {
    const onCardLayout = jest.fn()
    const renderer = await render({ onCardLayout })
    const withLayout = renderer.root.findAll(
      (node) =>
        node.type === "View" && typeof node.props.onLayout === "function",
    )
    expect(withLayout.length).toBe(1)
    const onLayout = withLayout[0]!.props.onLayout as (event: unknown) => void

    await act(async () => {
      onLayout({
        nativeEvent: { layout: { x: 0, y: 212, width: 370, height: 82 } },
      })
    })

    expect(onCardLayout).toHaveBeenCalledWith("the-chosen", 212)
    await unmount(renderer)
  })
})
