/**
 * HomeCard's own press path, the one feat-517's `onPressOverride` replaces. A
 * card with no override pushes the watch route with a seed and reports under
 * the default RUM action name, so the recommendations row's override is a
 * departure from a pinned baseline rather than from an untested one.
 */
jest.mock("expo-image", () => ({ __esModule: true, Image: () => null }))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
// One router for the file: a fresh `push` per call could not be asserted on.
jest.mock("expo-router", () => {
  const router = { push: jest.fn(), navigate: jest.fn() }
  return { useRouter: () => router, __router: router }
})
jest.mock("../../watch/WatchProgressBar", () => ({
  WatchProgressBar: () => null,
  progressAccessibilityText: () => null,
}))
jest.mock("../../../hooks/useWatchProgressEntry", () => ({
  useWatchProgressEntry: () => null,
}))
jest.mock("../../../hooks/useHeroStream", () => ({
  prefetchHeroStream: jest.fn(),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { act } from "react"

import type { WatchHomeCard } from "../../../lib/watchHome/model"
import { decodeWatchSeed } from "../../../lib/watchSeed"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { HomeCard } from "../HomeCard"

const { __router: router } = jest.requireMock("expo-router") as {
  __router: { push: jest.Mock; navigate: jest.Mock }
}

const CARD = {
  id: "c1-0",
  videoId: "v1",
  slug: "lumo-mark",
  title: "LUMO - Mark 1:1-45",
  imageUrl: "https://cdn.example.org/lumo-mark.jpg",
  imageAlt: "LUMO - Mark 1:1-45",
  playbackId: "abc123XYZ456",
  // rawLabel + childCount are what the series branch reads; a plain video has
  // neither, so this card routes to /watch.
  rawLabel: null,
  childCount: 0,
  metaLabel: null,
} as unknown as WatchHomeCard

afterEach(() => {
  jest.clearAllMocks()
})

function renderCard(): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(<HomeCard card={CARD} variant="landscape" />)
  })
  return renderer
}

/** Pressable keeps `onPress` on the composite node, so do not filter on type. */
function pressable(renderer: TestInstance): RenderedNode {
  const [node] = renderer.root.findAll(
    (candidate: RenderedNode) =>
      candidate.props.accessibilityLabel === CARD.title &&
      typeof candidate.props.onPress === "function",
  )
  expect(node).toBeDefined()
  return node!
}

describe("a card with no press override", () => {
  it("pushes the watch route with a seed", () => {
    const renderer = renderCard()
    act(() => {
      pressable(renderer).props.onPress!()
    })

    expect(router.push).toHaveBeenCalledTimes(1)
    const [href] = router.push.mock.calls[0]! as [string]
    expect(href.startsWith("/watch/lumo-mark?seed=")).toBe(true)
    expect(decodeWatchSeed(href.slice(href.indexOf("seed=") + 5))).toEqual({
      slug: "lumo-mark",
      title: "LUMO - Mark 1:1-45",
      imageUrl: "https://cdn.example.org/lumo-mark.jpg",
      playbackId: "abc123XYZ456",
    })
  })

  it("reports under the default RUM action name", () => {
    // Low-cardinality by design: the auto-tracker would otherwise send the
    // title, which the accessibility label carries (KTD10).
    expect(pressable(renderCard()).props["dd-action-name"]).toBe("home-card")
  })
})
