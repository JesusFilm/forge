// @vitest-environment jsdom
//
// Page-weight guards for /watch/<lang>.html/videos. This page renders the whole
// inventory in one document (WATCH_LANGUAGE_INVENTORY_LIMIT = 1000), so every
// per-item attribute and every per-group request is multiplied by ~1,000 and
// ~111 respectively. Each assertion here stands for a measured regression, not
// a style preference.

import { act } from "react"
import type { Route } from "next"
import { getImageProps } from "next/image"
import { setRequestLocale } from "next-intl/server"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/image")>()
  return {
    ...actual,
    // Forwards the sizing props the assertions below care about, so a revert
    // to `fill` + a pixel-only `sizes` is visible in the rendered markup.
    default: ({
      src,
      alt,
      className,
      sizes,
      width,
      height,
      fill,
    }: {
      src: string
      alt: string
      className?: string
      sizes?: string
      width?: number
      height?: number
      fill?: boolean
    }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={className}
        sizes={sizes}
        width={width}
        height={height}
        data-fill={fill ? "" : undefined}
      />
    ),
  }
})
vi.mock("../LanguageCollectionSwitcher", () => ({
  LanguageCollectionSwitcher: () => null,
}))

import { LanguageInventoryPage } from "../LanguageInventoryPage"
import type {
  WatchLanguageInventoryCard,
  WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"

// The exact transformation string admin's authored artwork arrives with.
const AUTHORED_ARTWORK =
  "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/4e98172e-d6be-46c2-8173-f17a983fe000/f=jpg,w=1280,h=600,q=95"
const BLURRED_BACKDROP_DERIVATIVE =
  "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/4e98172e-d6be-46c2-8173-f17a983fe000/f=jpg,w=128,h=60,q=50"

function card(
  overrides: Partial<WatchLanguageInventoryCard> & { id: string },
): WatchLanguageInventoryCard {
  return {
    coreId: overrides.id,
    slug: overrides.id,
    title: overrides.id,
    description: null,
    imageUrl: null,
    imageAlt: overrides.id,
    muxPlaybackId: null,
    label: "SHORT_FILM",
    availability: "AUDIO",
    href: "/video.html" as Route,
    watchLanguageSlug: "english",
    parentSlug: null,
    parentTitle: null,
    parentOrder: null,
    durationSeconds: 60,
    childCount: 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function model(
  overrides: Partial<WatchLanguageInventoryModel>,
): WatchLanguageInventoryModel {
  return {
    languageSlug: "english",
    languageName: "English",
    languageNativeName: "English",
    switcherLanguages: [],
    counts: {
      audioCollections: 0,
      audioVideos: 0,
      subtitleOnlyVideos: 0,
      total: 0,
    },
    promoted: [],
    audioCollections: [],
    audioVideos: [],
    subtitleOnlyVideos: [],
    collectionLanguageCounts: {},
    ...overrides,
  }
}

// The claim the compact row's `width`/`height` rests on is a fact about
// next/image, not about this component, so it is pinned at next/image's own
// layer. Every assertion in the component suite below asserts on markup, which
// cannot contradict it: if Next changed how it derives candidates, those would
// still pass while the 2.8 MB of srcset came back.
describe("next/image candidate-width derivation", () => {
  const src = "https://image.mux.com/playback/thumbnail.jpg?width=448"

  it("expands a pixel-only `sizes` to every configured width", () => {
    const { props } = getImageProps({
      src,
      alt: "",
      fill: true,
      sizes: "(max-width: 640px) 80px, 96px",
    })
    // 15 candidates x ~180 bytes x 1,000 rows was 2.81 MB of the live English
    // page's 9.44 MB of HTML.
    expect(props.srcSet?.split(", ").length).toBeGreaterThan(8)
    expect(props.srcSet).toContain("3840w")
  })

  it("emits two candidates for an explicitly sized image", () => {
    const { props } = getImageProps({ src, alt: "", width: 96, height: 54 })
    expect(props.srcSet?.split(", ")).toHaveLength(2)
    expect(props.sizes).toBeUndefined()
    // The widths the browser picks are unchanged: a 80/96 CSS px slot resolves
    // to 96w at 1 dpr and 256w at 2 and 3 dpr under either form.
    expect(props.srcSet).toContain("&w=96&q=75 1x")
    expect(props.srcSet).toContain("&w=256&q=75 2x")
  })

  it("emits two candidates for an explicitly sized portrait row", () => {
    const { props } = getImageProps({ src, alt: "", width: 37, height: 56 })
    expect(props.srcSet?.split(", ")).toHaveLength(2)
    expect(props.srcSet).toContain("&w=48&q=75 1x")
    expect(props.srcSet).toContain("&w=96&q=75 2x")
  })
})

describe("LanguageInventoryPage page weight", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setRequestLocale("en")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderGroup(episode: Partial<WatchLanguageInventoryCard> = {}) {
    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            audioCollections: [
              card({
                id: "series",
                href: "/series.html" as Route,
                childCount: 1,
                imageUrl: AUTHORED_ARTWORK,
              }),
            ],
            audioVideos: [
              card({
                id: "episode",
                parentSlug: "series",
                muxPlaybackId: "mux-episode",
                ...episode,
              }),
            ],
          })}
        />,
      )
    })
  }

  function compactRowImage(): HTMLImageElement {
    const row = container.querySelector<HTMLElement>("[data-inv-item]")
    expect(row).not.toBeNull()
    const image = row?.querySelector("img")
    expect(image).not.toBeNull()
    return image as HTMLImageElement
  }

  it("sizes the compact row thumbnail explicitly instead of with a pixel-only `sizes`", () => {
    renderGroup()
    const image = compactRowImage()
    expect(image.getAttribute("width")).toBe("96")
    expect(image.getAttribute("height")).toBe("54")
    // Both halves matter: `sizes` is what re-expands the candidate list, and
    // `fill` is what forces `sizes` back.
    expect(image.hasAttribute("sizes")).toBe(false)
    expect(image.hasAttribute("data-fill")).toBe(false)
    // `fill`'s inline positioning has to be reproduced by class, or the
    // thumbnail stops filling its box.
    expect(image.className).toContain("absolute inset-0 h-full w-full")
    expect(image.className).toContain("object-cover")
  })

  it("sizes a portrait compact row thumbnail explicitly too", () => {
    renderGroup({ slug: "vertical-episode" })
    const image = compactRowImage()
    expect(image.getAttribute("width")).toBe("37")
    expect(image.getAttribute("height")).toBe("56")
    expect(image.hasAttribute("sizes")).toBe(false)
    expect(image.className).toContain("object-center")
  })

  it("skips rendering for off-screen compact rows", () => {
    renderGroup()
    const row = container.querySelector<HTMLElement>("[data-inv-item]")
    // jsdom has no layout, so this can only assert the rule is applied. The
    // placeholder height was tuned against a real browser: 56px of content box
    // plus the row's `py-4` reproduces the document's real height.
    expect(row?.className).toContain("[content-visibility:auto]")
    expect(row?.className).toContain("[contain-intrinsic-size:auto_56px]")
  })

  it("requests the blur-sized derivative for the collection backdrop only", () => {
    renderGroup()
    const backdrop = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-collection-backdrop"]',
    )
    expect(backdrop?.style.backgroundImage).toBe(
      `url("${BLURRED_BACKDROP_DERIVATIVE}")`,
    )
    // Slot identity: the panel thumbnail beside it is a real, sharp image and
    // must keep the full-resolution source. Shrinking both would be the easy
    // wrong edit.
    const panel = container.querySelector<HTMLImageElement>(
      '[data-testid="language-inventory-collection-overview"] img',
    )
    expect(panel?.getAttribute("src")).toBe(AUTHORED_ARTWORK)
  })

  it("leaves a Mux-frame backdrop on its pre-generated derivative", () => {
    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            audioCollections: [
              card({
                id: "series",
                href: "/series.html" as Route,
                childCount: 1,
                muxPlaybackId: "mux-collection",
              }),
            ],
            audioVideos: [card({ id: "episode", parentSlug: "series" })],
          })}
        />,
      )
    })
    const backdrop = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-collection-backdrop"]',
    )
    expect(backdrop?.style.backgroundImage).toContain("width=448&height=252")
  })
})
