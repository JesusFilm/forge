/**
 * R16 on the third indicator: the episode grid badge. An export in flight must
 * render its own glyph and speak the export, not the offline state beneath it.
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
// records what the card asked for, so the glyph is assertable.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: (props: { name: string; color: string }) => {
    mockIcons.push({ name: props.name, color: props.color })
    return null
  },
}))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))

import { act } from "react"

import { SeriesEpisodeCard } from "../SeriesEpisodeCard"
import { EXPORT_IN_PROGRESS_COLOR } from "../../../lib/downloadGlyph"
import type { EpisodeBadgeState } from "../../../lib/seriesDownloadAggregate"
import type { WatchEpisode } from "../../../lib/normalizeVideo"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockIcons: { name: string; color: string }[] = []

const EPISODE: WatchEpisode = {
  documentId: "doc-1",
  slug: "episode-one",
  label: null,
  title: "Episode One",
  posterUrl: null,
}

async function render(downloadState?: EpisodeBadgeState) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <SeriesEpisodeCard
        episode={EPISODE}
        onSelect={() => {}}
        downloadState={downloadState}
      />,
    )
  })
  return renderer
}

function cardLabel(renderer: TestInstance): string {
  const nodes = renderer.root.findAll(
    (n) => typeof n.props.accessibilityLabel === "string",
  )
  expect(nodes.length).toBeGreaterThan(0)
  return String(nodes[0].props.accessibilityLabel)
}

beforeEach(() => {
  mockIcons.length = 0
})

describe("SeriesEpisodeCard download badge", () => {
  it("draws the export badge and speaks the export (R16)", async () => {
    const renderer = await render("exporting")
    expect(cardLabel(renderer)).toBe("Episode One, saving to Photos")
    expect(mockIcons.map((icon) => icon.name)).toEqual(["arrow-up-circle"])
    expect(mockIcons[0].color).toBe(EXPORT_IN_PROGRESS_COLOR)
  })

  // Anti-vacuous control: the offline badges still render their own glyphs.
  it("keeps the saved badge when nothing is exporting", async () => {
    const renderer = await render("saved")
    expect(cardLabel(renderer)).toBe("Episode One, saved offline")
    expect(mockIcons.map((icon) => icon.name)).toEqual(["checkmark-circle"])
  })

  it("draws no badge for an episode with no download state", async () => {
    const renderer = await render("none")
    expect(cardLabel(renderer)).toBe("Episode One")
    expect(mockIcons).toEqual([])
  })
})
