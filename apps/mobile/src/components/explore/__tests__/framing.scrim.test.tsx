/**
 * Both framing treatments (KTD18), each with its text over the scrim (R39). The
 * suite flips the constant on the mocked module, so neither guard can go dark.
 */

import { act } from "react"
import type { VideoPlayer } from "expo-video"

jest.mock("../../../lib/explore/framing", () => ({
  ...jest.requireActual("../../../lib/explore/framing"),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 83, left: 0 }),
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-linear-gradient", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    __esModule: true,
    LinearGradient: (props: object) => createElement("LinearGradient", props),
  }
})
jest.mock("expo-image", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    __esModule: true,
    Image: (props: object) => createElement("ExpoImage", props),
  }
})
jest.mock("../../watch/SubtitleOverlay", () => ({
  SubtitleOverlay: () => null,
}))

import { BLACK } from "../../../lib/color"
import type * as framing from "../../../lib/explore/framing"
import { ClipOverlay } from "../ClipOverlay"
import type { FeedClip } from "../../../lib/explore/types"
import { makeFakePlayer } from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

// The module object the component reads. `import * as` would hand back an
// interop COPY, and a flip on the copy never reaches the component.
const mockFraming = jest.requireMock("../../../lib/explore/framing") as {
  EXPLORE_FRAMING: framing.ExploreFraming
}
const ACTUAL = jest.requireActual(
  "../../../lib/explore/framing",
) as typeof framing

const CLIP: FeedClip = {
  videoId: "video-1",
  coreId: "1_jf-0-0",
  slug: "the-birth-of-jesus",
  title: "The Birth of Jesus",
  description: "Mary and Joseph travel to Bethlehem.",
  imageUrl: "https://images.example/1.jpg",
  muxPlaybackId: "mux-1",
  streamUrl: "https://stream.mux.com/mux-1.m3u8",
  feedLanguageSlug: "swahili",
  audioLanguageSlug: "swahili",
  subtitleLanguageSlug: "swahili",
  subtitleVttSrc: "https://subtitles.example/1.vtt",
  subtitleOnly: false,
  window: { startSeconds: 724, endSeconds: 751 },
  cut: "sentence",
}

type JsonNode = {
  type: string
  props: Record<string, unknown>
  children: (JsonNode | string)[] | null
}

const mounted: TestInstance[] = []

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  mockFraming.EXPLORE_FRAMING = ACTUAL.EXPLORE_FRAMING
})

function render(
  treatment: framing.ExploreFraming,
  videoTrack?: { size: { width: number; height: number } },
): JsonNode {
  mockFraming.EXPLORE_FRAMING = treatment
  const player = Object.assign(makeFakePlayer(), {
    videoTrack: videoTrack ?? null,
  })
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      <ClipOverlay
        clip={CLIP}
        player={player as unknown as VideoPlayer}
        muted={false}
        paused={false}
        onToggleMute={() => {}}
        onSeek={() => {}}
        onKeepWatching={() => {}}
        onOverlayOpen={() => {}}
        onOverlayClose={() => {}}
      />,
    )
  })
  mounted.push(renderer)
  return renderer.toJSON() as JsonNode
}

function nodes(root: JsonNode, predicate: (n: JsonNode) => boolean) {
  const out: JsonNode[] = []
  const walk = (n: JsonNode | string) => {
    if (typeof n === "string") return
    if (predicate(n)) out.push(n)
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return out
}

function byId(root: JsonNode, id: string): JsonNode {
  const [hit] = nodes(root, (n) => n.props.testID === id)
  if (hit == null) throw new Error(`no node with testID ${id}`)
  return hit
}

function kids(node: JsonNode): JsonNode[] {
  return (node.children ?? []).filter(
    (c): c is JsonNode => typeof c !== "string",
  )
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle))
  return style != null && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {}
}

// ── WCAG, read off the RENDERED colours ───────────────────────────────

type Rgba = { r: number; g: number; b: number; a: number }

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex?.[1] != null) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim())
  if (rgba?.[1] == null) throw new Error(`unparsed colour ${value}`)
  const [r, g, b, a] = rgba[1].split(",").map((s) => Number(s.trim()))
  return { r, g, b, a: a ?? 1 }
}

function over(top: Rgba, ground: Rgba): Rgba {
  const mix = (t: number, g: number) => t * top.a + g * (1 - top.a)
  return {
    r: mix(top.r, ground.r),
    g: mix(top.g, ground.g),
    b: mix(top.b, ground.b),
    a: 1,
  }
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE_FRAME: Rgba = { r: 255, g: 255, b: 255, a: 1 }

describe("Explore framing (KTD18)", () => {
  it("ships the whole-frame band by default", () => {
    expect(ACTUAL.EXPLORE_FRAMING).toBe("band")
    expect(ACTUAL.clipContentFit("crop")).toBe("cover")
    expect(ACTUAL.clipContentFit("band")).toBe("contain")
  })

  describe.each(["crop", "band"] as const)("the %s treatment", (treatment) => {
    it("renders its own backdrop", () => {
      // Anti-vacuous: proves the treatment flip reached the component.
      const root = render(treatment)
      const backdrop = nodes(
        root,
        (n) => n.props.testID === "clip-band-backdrop",
      )
      if (treatment === "crop") {
        expect(backdrop).toHaveLength(0)
        return
      }
      expect(backdrop).toHaveLength(1)
      // Solid black above and below the band, and no image behind it.
      expect(nodes(backdrop[0], (n) => n.type === "ExpoImage")).toHaveLength(0)
      const bars = nodes(backdrop[0], (n) => n.props.testID === "clip-band-bar")
      expect(bars).toHaveLength(2)
      for (const bar of bars) {
        expect(flatStyle(bar.props.style).backgroundColor).toBe(BLACK)
      }
    })

    it("draws the scrim first, so the text and the rail sit over it", () => {
      const root = render(treatment)
      const bottom = byId(root, "clip-overlay-bottom")
      const [scrim, row] = kids(bottom)
      expect(scrim?.props.testID).toBe("clip-overlay-scrim")
      expect(scrim?.props.pointerEvents).toBe("none")
      expect(row?.props.testID).toBe("clip-overlay-row")
      expect(
        nodes(row, (n) => n.props.testID === "clip-overlay-info"),
      ).toHaveLength(1)
      expect(
        nodes(row, (n) => n.props.testID === "clip-overlay-rail"),
      ).toHaveLength(1)
      expect(flatStyle(scrim.props.style).zIndex ?? 0).toBe(0)

      // The ramp starts clear and ends at the solid colour, with no seam.
      const [ramp] = nodes(scrim, (n) => n.type === "LinearGradient")
      const colors = ramp?.props.colors as string[]
      const solid = nodes(
        scrim,
        (n) => n.props.testID === "clip-overlay-scrim-solid",
      )[0]
      const solidColor = flatStyle(solid?.props.style).backgroundColor as string
      expect(parseColor(colors[0] ?? "").a).toBe(0)
      expect(colors[colors.length - 1]).toBe(solidColor)
    })

    it("holds the title and description at AA over a white frame", () => {
      const root = render(treatment)
      const bottom = byId(root, "clip-overlay-bottom")
      const solid = byId(bottom, "clip-overlay-scrim-solid")
      const ground = over(
        parseColor(flatStyle(solid.props.style).backgroundColor as string),
        WHITE_FRAME,
      )
      // The scrim starts at the title (owner, 2026-09-26), so only the text
      // from the title down sits on it; the rail labels above sit on the video.
      const info = byId(bottom, "clip-overlay-info")
      const texts = nodes(info, (n) => n.type === "Text")
      expect(texts.length).toBeGreaterThanOrEqual(2)
      for (const text of texts) {
        const color = flatStyle(text.props.style).color as string
        expect(
          contrast(over(parseColor(color), ground), ground),
        ).toBeGreaterThanOrEqual(4.5)
      }
    })
  })

  it("sizes the band from the playing track, and from 16:9 until it loads", () => {
    const spacer = (root: JsonNode) =>
      flatStyle(byId(root, "clip-band-frame").props.style).aspectRatio
    expect(spacer(render("band"))).toBeCloseTo(16 / 9, 5)
    expect(
      spacer(render("band", { size: { width: 1080, height: 1920 } })),
    ).toBeCloseTo(9 / 16, 5)
  })
})
